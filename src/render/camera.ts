/**
 * World camera: fits the 1920×1080 world into the canvas (contain), then layers trauma shake,
 * recoil kicks, focus punch-ins (kill-cam), automatic zoom-out for high shots and a slow
 * cinematic drift in attract mode. Produces a single affine transform world → device pixels.
 */
import { WORLD_H, WORLD_W } from '../core/constants.ts';
import { clamp, clamp01, damp, easeInOutCubic, lerp } from '../core/math.ts';
import { makeNoise1D } from '../core/rng.ts';

/** Fraction of the vertical letterbox slack placed above the world (sky) rather than below (bedrock). */
const SKY_BIAS = 0.8;
/** Lowest auto zoom while a projectile climbs above the view. */
const MIN_AUTO_ZOOM = 0.7;
/** World units kept between a high projectile and the top of the view. */
const HIGH_MARGIN = 110;

export class Camera {
  // --- Output (valid after update) --------------------------------------------------
  /** Device px per world unit, including zoom. */
  scale = 1;
  /** World point at the canvas centre. */
  cx = WORLD_W / 2;
  cy = WORLD_H / 2;
  /** Shake roll in radians. */
  roll = 0;
  /** Axis-aligned visible world rect (covers the rotated view). */
  left = 0;
  top = 0;
  right = WORLD_W;
  bottom = WORLD_H;
  /** Unrotated/unshaken top of the view (used to decide whether something is "above the view"). */
  calmTop = 0;

  // --- Inputs ---------------------------------------------------------------------
  private cw = 1;
  private ch = 1;
  private trauma = 0;
  private shakeScale = 1;
  private reducedMotion = false;
  private attract = false;
  /** Highest (smallest y) projectile, or +Infinity when none. */
  private highY = Infinity;

  // --- Animated state --------------------------------------------------------------
  private autoZoom = 1;
  private kickX = 0;
  private kickY = 0;
  private kickVX = 0;
  private kickVY = 0;
  private focusX = 0;
  private focusY = 0;
  private focusZoom = 1;
  private focusTime = 0;
  private focusDur = 0;
  private focusW = 0;
  private attractW = 0;
  private t = 0;
  private readonly nx = makeNoise1D(0x51a7e1);
  private readonly ny = makeNoise1D(0x2bb01d);
  private readonly nr = makeNoise1D(0x7731cc);

  setViewport(cw: number, ch: number): void {
    this.cw = Math.max(1, cw);
    this.ch = Math.max(1, ch);
  }

  setOptions(shakeScale: number, reducedMotion: boolean): void {
    this.shakeScale = clamp01(shakeScale);
    this.reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.trauma = 0;
      this.focusTime = this.focusDur = 0;
    }
  }

  setAttract(attract: boolean): void {
    this.attract = attract;
  }

  /** Smallest projectile y this frame (+Infinity for none); drives the auto zoom-out. */
  setHighPoint(y: number): void {
    this.highY = y;
  }

  addTrauma(amount: number): void {
    if (this.reducedMotion || this.shakeScale <= 0) return;
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
  }

  /** Short directional nudge in world units (firing recoil) that springs back. */
  kick(dx: number, dy: number): void {
    if (this.reducedMotion) return;
    const s = this.shakeScale;
    this.kickVX += dx * 14 * s;
    this.kickVY += dy * 14 * s;
  }

  /** Punch in toward a world point: ease in, hold, ease out over `seconds`. */
  focus(x: number, y: number, zoom: number, seconds: number): void {
    if (this.reducedMotion || seconds <= 0) return;
    this.focusX = x;
    this.focusY = y;
    this.focusZoom = clamp(zoom, 0.5, 3);
    this.focusDur = seconds;
    this.focusTime = 0;
  }

  /** Cancels focus and transient motion (round start). */
  reset(): void {
    this.trauma = 0;
    this.kickX = this.kickY = this.kickVX = this.kickVY = 0;
    this.focusTime = this.focusDur = 0;
    this.focusW = 0;
    this.autoZoom = 1;
  }

  get shakeAmount(): number {
    return this.trauma * this.trauma;
  }

  /** True while a focus punch-in is active (used to suppress the auto zoom-out). */
  get focusing(): boolean {
    return this.focusW > 0.001;
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.t += dt;
    const W = WORLD_W, H = WORLD_H, cw = this.cw, ch = this.ch;

    // Contain fit; vertical slack mostly goes to the sky.
    const s0 = Math.min(cw / W, ch / H);
    const viewW0 = cw / s0, viewH0 = ch / s0;
    const bottom0 = H + (viewH0 - H) * (1 - SKY_BIAS);
    this.calmTop = bottom0 - viewH0;

    // Auto zoom-out while a projectile is above the calm view (anchored at the ground).
    let zTarget = 1;
    if (this.highY < this.calmTop + HIGH_MARGIN) {
      const needH = bottom0 - (this.highY - HIGH_MARGIN);
      zTarget = clamp(viewH0 / needH, MIN_AUTO_ZOOM, 1);
    }
    if (this.reducedMotion) zTarget = Math.max(zTarget, 0.86);
    this.autoZoom = damp(this.autoZoom, zTarget, zTarget < this.autoZoom ? 3.2 : 1.4, dt);

    let z = this.autoZoom;
    let cx = W / 2;
    let cy = bottom0 - viewH0 / z / 2;

    // Attract mode: slow cinematic drift and breathing zoom inside the world.
    this.attractW = damp(this.attractW, this.attract && !this.reducedMotion ? 1 : 0, 0.8, dt);
    if (this.attractW > 0.001) {
      const za = 1.1 + 0.05 * Math.sin(this.t * 0.11);
      const hw = viewW0 / za / 2, hh = viewH0 / za / 2;
      const slackX = Math.max(0, W / 2 - hw);
      const ax = W / 2 + Math.sin(this.t * 0.043) * slackX * 0.85;
      const ay = Math.min(bottom0, H + 30) - hh - 40 - 30 * (0.5 + 0.5 * Math.sin(this.t * 0.067));
      const w = easeInOutCubic(this.attractW);
      z = lerp(z, za, w);
      cx = lerp(cx, ax, w);
      cy = lerp(cy, ay, w);
    }

    // Focus punch-in: ease in (0.35 s), hold, ease out (0.6 s).
    if (this.focusDur > 0) {
      this.focusTime += dt;
      const ft = this.focusTime, fd = this.focusDur;
      const inT = Math.min(0.35, fd * 0.3), outT = Math.min(0.6, fd * 0.4);
      let w: number;
      if (ft >= fd) { w = 0; this.focusDur = 0; }
      else if (ft < inT) w = easeInOutCubic(ft / inT);
      else if (ft > fd - outT) w = easeInOutCubic((fd - ft) / outT);
      else w = 1;
      this.focusW = w;
    } else {
      this.focusW = 0;
    }
    if (this.focusW > 0) {
      const fz = this.focusZoom;
      const hw = viewW0 / fz / 2, hh = viewH0 / fz / 2;
      const fx = hw < W / 2 ? clamp(this.focusX, hw, W - hw) : W / 2;
      const fy = Math.min(this.focusY - hh * 0.12, bottom0 - hh);
      const w = this.focusW;
      z = lerp(z, fz, w);
      cx = lerp(cx, fx, w);
      cy = lerp(cy, fy, w);
    }

    // Recoil kick: damped spring back to rest.
    const k = 190, c = 17;
    this.kickVX += (-k * this.kickX - c * this.kickVX) * dt;
    this.kickVY += (-k * this.kickY - c * this.kickVY) * dt;
    this.kickX += this.kickVX * dt;
    this.kickY += this.kickVY * dt;

    // Trauma shake: smooth noise, offset ∝ trauma², tiny roll.
    this.trauma = Math.max(0, this.trauma - dt * 1.15);
    const sh = this.trauma * this.trauma;
    let ox = 0, oy = 0, roll = 0;
    if (sh > 0) {
      const nt = this.t * 21;
      const amp = 30 / z;
      ox = this.nx(nt) * amp * sh;
      oy = this.ny(nt + 37.1) * amp * sh;
      roll = this.nr(nt * 0.8 + 11.3) * 0.032 * sh;
    }

    this.scale = s0 * z;
    this.cx = cx + this.kickX + ox;
    this.cy = cy + this.kickY + oy;
    this.roll = roll;

    const hw = cw / this.scale / 2, hh = ch / this.scale / 2;
    const cr = Math.abs(Math.cos(roll)), sr = Math.abs(Math.sin(roll));
    const bw = hw * cr + hh * sr, bh = hw * sr + hh * cr;
    this.left = this.cx - bw;
    this.right = this.cx + bw;
    this.top = this.cy - bh;
    this.bottom = this.cy + bh;
  }

  /** Applies world → device transform. */
  apply(ctx: CanvasRenderingContext2D): void {
    const s = this.scale, cs = Math.cos(this.roll) * s, sn = Math.sin(this.roll) * s;
    ctx.setTransform(cs, sn, -sn, cs, this.cw / 2 - (cs * this.cx - sn * this.cy), this.ch / 2 - (sn * this.cx + cs * this.cy));
  }

  /** Writes the world → device matrix (setTransform order a, b, c, d, e, f). */
  matrix(out: { a: number; b: number; c: number; d: number; e: number; f: number }): void {
    const s = this.scale, cs = Math.cos(this.roll) * s, sn = Math.sin(this.roll) * s;
    out.a = cs; out.b = sn; out.c = -sn; out.d = cs;
    out.e = this.cw / 2 - (cs * this.cx - sn * this.cy);
    out.f = this.ch / 2 - (sn * this.cx + cs * this.cy);
  }

  /** World → device pixels (writes into out). */
  worldToDevice(x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
    const s = this.scale, cs = Math.cos(this.roll) * s, sn = Math.sin(this.roll) * s;
    const dx = x - this.cx, dy = y - this.cy;
    out.x = this.cw / 2 + cs * dx - sn * dy;
    out.y = this.ch / 2 + sn * dx + cs * dy;
    return out;
  }

  /** Device pixels → world (writes into out). */
  deviceToWorld(px: number, py: number, out: { x: number; y: number }): { x: number; y: number } {
    const s = this.scale, cs = Math.cos(this.roll) / s, sn = Math.sin(this.roll) / s;
    const dx = px - this.cw / 2, dy = py - this.ch / 2;
    out.x = this.cx + cs * dx + sn * dy;
    out.y = this.cy - sn * dx + cs * dy;
    return out;
  }
}
