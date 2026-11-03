/**
 * Tank renderer: chunky painted tanks built from cached 3x sprites (hull, dome, barrel, wheels,
 * tread band) plus cheap procedural motion (tread links, rotating wheels, spring antenna, recoil,
 * suspension), state overlays (hit flash, shield bubble, damage glow) and the wreck.
 *
 * Geometry matches the sim: ground contact at (x, y), hull rotated by tilt about it, barrel pivoting
 * at turretPivot() at the world-absolute angle, muzzle tip exactly at muzzlePoint().
 */
import type { TankDrawInfo, TankRendererApi } from '../contracts.ts';
import { DEG, TAU } from '../core/math.ts';
import type { TankState } from '../core/types.ts';
import { TankAnim } from './tanks/anim.ts';
import { type Sprite, drawSprite, shadowSprite } from './tanks/bake.ts';
import { TORN_X, TORN_Y } from './tanks/hull.ts';
import { type TankPalette, charPalette, tankPalette } from './tanks/palette.ts';
import {
  ANTENNA_BASE_X, ANTENNA_BASE_Y, ANTENNA_LEN, BARREL_ROOT_W, HEADLIGHT_X, HEADLIGHT_Y, LINK_PITCH, PIVOT_Y, RECOIL_SLIDE,
  ROAD_WHEELS, ROAD_WHEEL_R, ROAD_WHEEL_Y, SPROCKET_R, TREAD_CX, TREAD_CY, TREAD_R, domeExit,
} from './tanks/shape.ts';
import { SHIELD_R, type TankSprites, tankSprites } from './tanks/sprites.ts';

const HALF_PI = Math.PI / 2;
/** Link loop: centre-line radius and the derived link count so links tile seamlessly. */
const LINK_RL = TREAD_R - 0.75;
const LOOP_LEN = TREAD_CX * 4 + TAU * LINK_RL;
const LINK_N = Math.round(LOOP_LEN / LINK_PITCH);
const LINK_STEP = LOOP_LEN / LINK_N;
const ARC_LEN = Math.PI * LINK_RL;
const RUN_LEN = TREAD_CX * 2;

const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export class TankRenderer implements TankRendererApi {
  private anims: TankAnim[] = [];
  /** Wreck ember layout (hull space), fixed so embers don't jump around. */
  private readonly embers: Float32Array;

  constructor() {
    const n = 14;
    this.embers = new Float32Array(n * 4);
    let s = 1234567;
    const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      this.embers[i * 4] = -22 + rnd() * 44;
      this.embers[i * 4 + 1] = -20 + rnd() * 9;
      this.embers[i * 4 + 2] = rnd() * TAU;
      this.embers[i * 4 + 3] = 0.6 + rnd() * 1.6;
    }
  }

  /** Palette + sprite sets per tank index, re-resolved only when the team or biome changes. */
  private looks: { team: TankDrawInfo['team'] | null; biome: string; pal: TankPalette; sp: TankSprites; char: TankSprites | null }[] = [];

  private look(index: number, info: TankDrawInfo | null): { pal: TankPalette; sp: TankSprites; char: TankSprites | null } {
    let l = this.looks[index];
    if (info && (!l || l.team !== info.team || l.biome !== info.biome)) {
      const pal = tankPalette(info.team, info.biome);
      l = this.looks[index] = { team: info.team, biome: info.biome, pal, sp: tankSprites(pal), char: null };
    }
    return l;
  }

  /** Per-tank animation state (exposed for sandboxes and debugging). */
  anim(index: number): TankAnim {
    let a = this.anims[index];
    if (!a) a = this.anims[index] = new TankAnim();
    return a;
  }

  /** Bakes every sprite for a team/biome up front (avoids a first-frame hitch). */
  warm(info: Pick<TankDrawInfo, 'team' | 'biome'>): void {
    const pal = tankPalette(info.team, info.biome);
    tankSprites(pal);
    tankSprites(charPalette(pal));
  }

  draw(ctx: CanvasRenderingContext2D, tank: TankState, info: TankDrawInfo): void {
    const st = this.anim(tank.index);
    st.update(tank, info.dt);
    const look = this.look(tank.index, info);
    const pal = look.pal;
    const sp = look.sp;
    const time = info.time;
    const alive = tank.alive;

    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.tilt);

    // Contact shadow grounds the tank (fades out while airborne).
    const shadowA = 1 - st.air;
    if (shadowA > 0.02) {
      ctx.globalAlpha = shadowA * (pal.night ? 0.9 : 0.7);
      ctx.drawImage(shadowSprite(), -36, -4.5, 72, 9);
      ctx.globalAlpha = 1;
    }
    if (alive && info.active) this.drawActiveRing(ctx, sp, pal, time, info.aiming, false);

    // Airborne wobble pivots about the turret pivot so the barrel stays exact.
    const wob = st.air * Math.sin(time * 9 + tank.index * 2.1) * 0.06;
    if (wob !== 0) {
      ctx.translate(0, PIVOT_Y);
      ctx.rotate(wob);
      ctx.translate(0, -PIVOT_Y);
    }

    if (!alive) {
      this.drawWreck(ctx, tank, st, pal, time);
      ctx.restore();
      return;
    }

    const tier = tank.hp < 35 ? 2 : tank.hp < 60 ? 1 : 0;
    // The bubble takes the hit when shielded, so the hull only glints.
    const flash = tank.hitFlash * (tank.shield > 0 ? 0.3 : 1);
    // Turning around: the chassis swaps instantly while the sprung body squashes through a
    // narrow profile with a small hop, which reads as the hull swinging about on its tracks.
    const fsign = st.flip < 0 ? -1 : 1;
    const turn = 1 - Math.abs(st.flip);
    const flip = fsign * (1 - turn * 0.5);
    const gearFlip = fsign;
    // Tread phase in the (possibly mirrored) hull frame.
    const phase = tank.treadPhase * fsign;
    const moving = Math.min(1, Math.abs(st.speed) / 40);

    // Sprung-mass offset: idle breathing, drive judder, spring state, hit shake.
    const idle = Math.sin(time * 2.2 + tank.index * 1.7) * 0.22;
    const judder = moving * Math.sin(tank.treadPhase * 1.3) * 0.35;
    const shake = tank.hitFlash > 0 ? Math.sin(time * 95) * tank.hitFlash * 0.9 : 0;
    const bodyY = st.sy + idle + judder - turn * 1.8;
    const bodyPitch = st.pitch + moving * Math.sin(tank.treadPhase * 0.55) * 0.012;

    // --- Running gear (unsprung) -----------------------------------------------------
    ctx.save();
    ctx.scale(gearFlip, 1);
    this.drawRunningGear(ctx, sp, pal, phase, moving, false);
    ctx.restore();

    if (info.active) this.drawActiveRing(ctx, sp, pal, time, info.aiming, true);

    // --- Hull (sprung) ---------------------------------------------------------------------
    ctx.save();
    ctx.scale(flip, 1);
    ctx.translate(shake * fsign, bodyY);
    if (bodyPitch !== 0) {
      ctx.translate(0, -10);
      ctx.rotate(bodyPitch * fsign);
      ctx.translate(0, 10);
    }
    drawSprite(ctx, sp.hull[tier]);
    if (tier >= 2) this.drawTornGlow(ctx, sp, time);
    this.drawHeadlight(ctx, sp, pal, time);
    ctx.restore();

    // --- Barrel (exact pivot, world-absolute angle) --------------------------------------
    const phi = -tank.angle * DEG - tank.tilt - wob;
    const recoil = tank.recoil > 0 ? tank.recoil * tank.recoil * (3 - 2 * tank.recoil) : 0;
    ctx.save();
    ctx.translate(0, PIVOT_Y);
    ctx.rotate(phi);
    // Keep the barrel's lit side up when it points left.
    if (tank.angle > 90) ctx.scale(1, -1);
    ctx.translate(-recoil * RECOIL_SLIDE, 0);
    drawSprite(ctx, sp.barrel);
    if (flash > 0.02) {
      ctx.globalAlpha = Math.min(1, flash * 1.1);
      drawSprite(ctx, sp.barrelFlash);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // --- Dome, antenna (sprung) --------------------------------------------------------
    ctx.save();
    ctx.scale(flip, 1);
    ctx.translate(shake * fsign, bodyY);
    if (bodyPitch !== 0) {
      ctx.translate(0, -10);
      ctx.rotate(bodyPitch * fsign);
      ctx.translate(0, 10);
    }
    this.drawAntenna(ctx, sp, pal, st, tank, info, time, flip);
    drawSprite(ctx, sp.dome[tier]);
    if (flash > 0.02) {
      ctx.globalAlpha = Math.min(1, flash * 1.1);
      drawSprite(ctx, sp.hullFlash);
      drawSprite(ctx, sp.domeFlash);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Barrel collar where the gun leaves the dome (drawn over the dome edge).
    this.drawCollar(ctx, pal, phi, tank.angle > 90);

    if (tank.shield > 0 || st.shieldForm > 0) this.drawShield(ctx, sp, pal, tank, st, time);
    ctx.restore();
  }

  // ===================================================================================
  // Running gear
  // ===================================================================================

  /** Tread band, scrolling links and rotating wheels (hull frame, facing right). */
  private drawRunningGear(ctx: CanvasRenderingContext2D, sp: TankSprites, pal: TankPalette, phase: number, moving: number, wreck: boolean): void {
    drawSprite(ctx, sp.band);
    // Links: one path for the plates, one for their lit outer faces.
    ctx.fillStyle = pal.link;
    ctx.beginPath();
    this.linkPath(ctx, phase, 0.95, -0.8, 0.78);
    ctx.fill();
    ctx.fillStyle = pal.linkLight;
    ctx.beginPath();
    this.linkPath(ctx, phase, 0.95, 0.5, 0.6);
    ctx.fill();

    // Wheels.
    const jig = wreck ? 0 : moving;
    for (let i = 0; i < ROAD_WHEELS.length; i++) {
      const wx = ROAD_WHEELS[i];
      const wy = ROAD_WHEEL_Y + jig * Math.sin(phase * 0.9 + i * 1.9) * 0.28;
      this.drawWheel(ctx, sp.road, sp.roadShade, wx, wy, phase / ROAD_WHEEL_R);
    }
    this.drawWheel(ctx, sp.sprocket, sp.sprocketShade, TREAD_CX, TREAD_CY, phase / SPROCKET_R);
    this.drawWheel(ctx, sp.sprocket, sp.sprocketShade, -TREAD_CX, TREAD_CY, phase / SPROCKET_R + 0.3);
  }

  private drawWheel(ctx: CanvasRenderingContext2D, s: Sprite, shade: Sprite, x: number, y: number, rot: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    drawSprite(ctx, s);
    ctx.rotate(-rot);
    drawSprite(ctx, shade);
    ctx.restore();
  }

  /**
   * Appends one quad per link around the tread loop. `out`/`inn` are the outer/inner extents from
   * the link centre line along the outward normal; `hwScale` scales the half width.
   */
  private linkPath(ctx: CanvasRenderingContext2D, phase: number, out: number, inn: number, hwScale: number): void {
    const hw = LINK_STEP * 0.5 * hwScale;
    for (let i = 0; i < LINK_N; i++) {
      let s = posMod(i * LINK_STEP + phase, LOOP_LEN);
      let px: number, py: number, tx: number, ty: number, nx: number, ny: number;
      if (s < RUN_LEN) {
        px = -TREAD_CX + s; py = TREAD_CY - LINK_RL; tx = 1; ty = 0; nx = 0; ny = -1;
      } else if ((s -= RUN_LEN) < ARC_LEN) {
        const a = -HALF_PI + s / LINK_RL;
        nx = Math.cos(a); ny = Math.sin(a);
        px = TREAD_CX + nx * LINK_RL; py = TREAD_CY + ny * LINK_RL; tx = -ny; ty = nx;
      } else if ((s -= ARC_LEN) < RUN_LEN) {
        px = TREAD_CX - s; py = TREAD_CY + LINK_RL; tx = -1; ty = 0; nx = 0; ny = 1;
      } else {
        s -= RUN_LEN;
        const a = HALF_PI + s / LINK_RL;
        nx = Math.cos(a); ny = Math.sin(a);
        px = -TREAD_CX + nx * LINK_RL; py = TREAD_CY + ny * LINK_RL; tx = -ny; ty = nx;
      }
      const ox = nx * out, oy = ny * out, ix = nx * inn, iy = ny * inn;
      const hx = tx * hw, hy = ty * hw;
      ctx.moveTo(px + hx + ox, py + hy + oy);
      ctx.lineTo(px - hx + ox, py - hy + oy);
      ctx.lineTo(px - hx + ix, py - hy + iy);
      ctx.lineTo(px + hx + ix, py + hy + iy);
      ctx.closePath();
    }
  }

  // ===================================================================================
  // Details
  // ===================================================================================

  private drawHeadlight(ctx: CanvasRenderingContext2D, sp: TankSprites, pal: TankPalette, time: number): void {
    const a = pal.night ? 0.85 : 0.42;
    const flick = 0.94 + Math.sin(time * 23) * 0.03;
    ctx.globalCompositeOperation = 'lighter';
    // Forward beam cone, then the lens bloom.
    ctx.globalAlpha = a * 0.7 * flick;
    const bl = pal.night ? 34 : 22;
    ctx.drawImage(sp.beam, HEADLIGHT_X + 1.6, HEADLIGHT_Y - bl * 0.1875, bl, bl * 0.375);
    ctx.globalAlpha = a * flick;
    ctx.drawImage(sp.lampGlow, HEADLIGHT_X - 1.6, HEADLIGHT_Y - 2.6, 6.4, 5.2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Pulsing heat inside the torn panel (hp < 35). */
  private drawTornGlow(ctx: CanvasRenderingContext2D, sp: TankSprites, time: number): void {
    const p = 0.55 + Math.sin(time * 5.3) * 0.22 + Math.sin(time * 17.1) * 0.08;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p;
    ctx.drawImage(sp.heat, TORN_X - 6, TORN_Y - 6, 12, 12);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Spring antenna with a fluttering team pennant (hull frame, sprung). */
  private drawAntenna(ctx: CanvasRenderingContext2D, sp: TankSprites, pal: TankPalette, st: TankAnim, tank: TankState, info: TankDrawInfo, time: number, flip: number): void {
    const dir = flip < 0 ? -1 : 1;
    const sway = Math.sin(time * 1.6 + tank.index * 2.3) * 0.045 + Math.sin(time * 4.1 + tank.index) * 0.015;
    const air = st.air * Math.sin(time * 13 + tank.index) * 0.18;
    const bend = (st.ant + air) * dir + sway - 0.16;
    const bx = ANTENNA_BASE_X, by = ANTENNA_BASE_Y, L = ANTENNA_LEN;
    // Rod bends progressively: control point leans by a fraction of the tip angle.
    const cx = bx + Math.sin(bend * 0.35) * L * 0.55;
    const cy = by - Math.cos(bend * 0.35) * L * 0.55;
    const tx = bx + Math.sin(bend) * L;
    const ty = by - Math.cos(bend) * L * (1 - Math.abs(bend) * 0.08);
    // Mount.
    ctx.fillStyle = pal.metalDark;
    ctx.fillRect(bx - 1.5, by - 1.6, 3, 2.6);
    ctx.strokeStyle = pal.outline;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(cx, cy, tx, ty);
    ctx.stroke();
    ctx.strokeStyle = pal.metalLight;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Pennant hanging off the tip, trailing opposite the bend and fluttering.
    const flut = time * 9 + tank.index * 1.3;
    const trail = -1; // trails toward the hull rear
    const pd = 6.2 + Math.abs(st.speed) * 0.02;
    const px0 = tx + (cx - tx) * 0.06, py0 = ty + (cy - ty) * 0.06;
    const px1 = tx + (cx - tx) * 0.32, py1 = ty + (cy - ty) * 0.32;
    const ex = px0 + trail * pd, ey = py0 + 1.6 + Math.sin(flut) * 0.9;
    ctx.fillStyle = pal.paint;
    ctx.beginPath();
    ctx.moveTo(px0, py0);
    ctx.quadraticCurveTo(px0 + trail * pd * 0.5, py0 + Math.sin(flut + 1.2) * 1.1, ex, ey);
    ctx.quadraticCurveTo(px1 + trail * pd * 0.45, py1 + Math.sin(flut + 0.6) * 0.8, px1, py1);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    // Tip bead; blinks when it's this tank's turn.
    ctx.fillStyle = pal.outline;
    ctx.beginPath();
    ctx.arc(tx, ty, 1.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.paintLight;
    ctx.beginPath();
    ctx.arc(tx, ty, 0.75, 0, TAU);
    ctx.fill();
    if (info.active) {
      const blink = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + blink * 0.65;
      ctx.drawImage(sp.tipGlow, tx - 4, ty - 4, 8, 8);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Mantlet collar where the barrel leaves the dome (tilt frame). */
  private drawCollar(ctx: CanvasRenderingContext2D, pal: TankPalette, phi: number, mirrored: boolean): void {
    const d = domeExit(phi);
    ctx.save();
    ctx.translate(0, PIVOT_Y);
    ctx.rotate(phi);
    if (mirrored) ctx.scale(1, -1);
    const h = BARREL_ROOT_W + 2.2;
    ctx.fillStyle = pal.outline;
    ctx.beginPath();
    ctx.roundRect(d - 2.4, -h / 2 - 0.55, 3.8, h + 1.1, 1.2);
    ctx.fill();
    ctx.fillStyle = this.collarGrad(ctx, pal);
    ctx.beginPath();
    ctx.roundRect(d - 1.85, -h / 2, 2.7, h, 0.9);
    ctx.fill();
    ctx.restore();
  }

  private grads = new Map<string, CanvasGradient>();

  private collarGrad(ctx: CanvasRenderingContext2D, pal: TankPalette): CanvasGradient {
    let g = this.grads.get(pal.key);
    if (!g) {
      const h = BARREL_ROOT_W + 2.2;
      g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, pal.paintLight);
      g.addColorStop(0.3, pal.paint);
      g.addColorStop(1, pal.paintDeep);
      this.grads.set(pal.key, g);
    }
    return g;
  }

  // ===================================================================================
  // State overlays
  // ===================================================================================

  /**
   * Soft team-colour ring on the ground. Drawn in two passes so the treads sit inside it:
   * back half + glow before the tank, front half after the running gear.
   */
  private drawActiveRing(ctx: CanvasRenderingContext2D, sp: TankSprites, pal: TankPalette, time: number, aiming: boolean, front: boolean): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.4);
    const a = aiming ? 0.62 + pulse * 0.3 : 0.36 + pulse * 0.2;
    const rx = 37, ry = 6.2, cy = -0.6;
    const a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : TAU;
    if (!front) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.75;
      ctx.drawImage(sp.ringGlow, -48, cy - 11, 96, 22);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Expanding ripple while aiming.
    if (aiming) {
      const k = (time * 0.7) % 1;
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(0, cy, rx * (0.8 + k * 0.45), ry * (0.8 + k * 0.45), 0, a0, a1);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx, ry, 0, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = a * 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Hexagonal energy bubble: alpha ∝ shield, slow shimmer, bright ripple on hits (tilt frame). */
  private drawShield(ctx: CanvasRenderingContext2D, sp: TankSprites, pal: TankPalette, tank: TankState, st: TankAnim, time: number): void {
    const f = st.shieldForm;
    // Overshooting pop-in.
    const form = f >= 1 ? 1 : 1 + 2.2 * (f - 1) ** 3 + 1.2 * (f - 1) ** 2;
    if (form <= 0.01) return;
    const strength = Math.min(1, 0.4 + (tank.shield / 45) * 0.6);
    const R = SHIELD_R + 4;
    const breathe = 1 + Math.sin(time * 2.6 + tank.index) * 0.012;
    ctx.save();
    ctx.translate(0, -14);
    ctx.scale(form * breathe, form * breathe * 0.84);
    ctx.globalAlpha = strength * Math.min(1, f * 2);
    ctx.drawImage(sp.shield, -R, -R, R * 2, R * 2);
    // Shimmer: a slowly counter-rotating additive copy.
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(time * 0.35);
    ctx.globalAlpha = strength * (0.18 + 0.12 * Math.sin(time * 3.1));
    ctx.drawImage(sp.shield, -R, -R, R * 2, R * 2);
    ctx.rotate(-time * 0.35);
    const hit = tank.hitFlash;
    if (hit > 0.01) {
      // Whole bubble flares, and a bright ring races outward from the centre.
      ctx.globalAlpha = hit * 0.55;
      ctx.drawImage(sp.shield, -R, -R, R * 2, R * 2);
      const p = 1 - hit;
      ctx.globalAlpha = hit;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.6 * hit + 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, SHIELD_R * (0.25 + p * 0.8), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, SHIELD_R * (0.12 + p * 0.65), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ===================================================================================
  // Wreck
  // ===================================================================================

  private drawWreck(ctx: CanvasRenderingContext2D, tank: TankState, st: TankAnim, pal: TankPalette, time: number): void {
    const cp = charPalette(pal);
    const l = this.look(tank.index, null);
    // Wreck sprites are baked lazily: most tanks never need them.
    const sp = l.char ?? (l.char = tankSprites(cp));
    const flip = st.flip < 0 ? -1 : 1;
    ctx.save();
    ctx.scale(flip, 1);
    this.drawRunningGear(ctx, sp, cp, tank.treadPhase * flip, 0, true);
    // Slumped hull.
    ctx.translate(0, 0.6);
    drawSprite(ctx, sp.hull[3]);
    drawSprite(ctx, sp.wreckRing);
    ctx.restore();

    // Bent barrel stub from the pivot, drooping toward the ground.
    const phi = -tank.angle * DEG - tank.tilt;
    const left = tank.angle > 90;
    ctx.save();
    ctx.translate(0, PIVOT_Y + 1.2);
    ctx.rotate(phi);
    if (left) ctx.scale(1, -1);
    ctx.fillStyle = cp.outline;
    ctx.fillRect(1, -2.6, 10.5, 5.2);
    ctx.fillStyle = '#3a312d';
    ctx.fillRect(1.5, -2.0, 10, 4.0);
    ctx.fillStyle = '#5a4a42';
    ctx.fillRect(1.5, -2.0, 10, 0.9);
    ctx.translate(10.6, 0);
    ctx.rotate(0.75);
    ctx.fillStyle = cp.outline;
    ctx.beginPath();
    ctx.moveTo(-0.6, -2.5);
    ctx.lineTo(7.4, -2.0);
    ctx.lineTo(6.6, -0.6);
    ctx.lineTo(8.1, 0.4);
    ctx.lineTo(6.9, 2.4);
    ctx.lineTo(-0.6, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2d2623';
    ctx.beginPath();
    ctx.moveTo(0, -1.9);
    ctx.lineTo(6.8, -1.5);
    ctx.lineTo(6.0, -0.4);
    ctx.lineTo(7.3, 0.4);
    ctx.lineTo(6.3, 1.8);
    ctx.lineTo(0, 1.9);
    ctx.closePath();
    ctx.fill();
    // Glowing torn tip.
    ctx.globalCompositeOperation = 'lighter';
    const heat = Math.max(0.3, 1 - st.deadT / 7);
    ctx.globalAlpha = heat * (0.6 + 0.3 * Math.sin(time * 7));
    ctx.drawImage(sp.heat, 3.5, -3.5, 7, 7);
    ctx.restore();

    // Embers flickering over the charred hull, cooling with time.
    ctx.save();
    ctx.scale(flip, 1);
    ctx.globalCompositeOperation = 'lighter';
    const ember = sp.ember;
    const e = this.embers;
    for (let i = 0; i < e.length; i += 4) {
      const fl = 0.5 + 0.5 * Math.sin(time * e[i + 3] * 3.1 + e[i + 2]);
      const a = heat * (0.25 + 0.75 * fl * fl);
      if (a < 0.04) continue;
      const s = 1.6 + fl * 1.8;
      ctx.globalAlpha = a;
      ctx.drawImage(ember, e[i] - s, e[i + 1] - s, s * 2, s * 2);
    }
    // Hot turret ring and torn panel.
    ctx.globalAlpha = heat * (0.55 + 0.25 * Math.sin(time * 4.3));
    ctx.drawImage(ember, -11, PIVOT_Y - 3.5, 22, 6);
    ctx.drawImage(ember, TORN_X - 6, TORN_Y - 6, 12, 12);
    ctx.restore();
  }
}
