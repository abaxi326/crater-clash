/**
 * Supply crate drawing: swaying parachute rig while descending, canopy collapse after landing,
 * landing squash, beacon light, idle gleam, ground shadow and a pickup "pop" ghost.
 */
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';
import type { CrateState } from '../../core/types.ts';
import type { Terrain } from '../../sim/terrain.ts';
import {
  canopySprite, CANOPY_H, CANOPY_HEM_Y, CANOPY_W, CRATE_H, CRATE_PAD, CRATE_W, crateSprite, RIG_POINTS, traceGlyph,
} from './crateArt.ts';
import { blit, coreSprite, glowSprite } from './sprites.ts';

const TAU = Math.PI * 2;
/** Rigging line length from crate top to canopy hem (world units). */
const LINE_LEN = 30;

let gleamBand: HTMLCanvasElement | null = null;
function gleamSprite(): HTMLCanvasElement {
  if (gleamBand) return gleamBand;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.42, 'rgba(255,250,235,0.5)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.58, 'rgba(255,250,235,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 8);
  gleamBand = c;
  return c;
}

let shadowSprite: HTMLCanvasElement | null = null;
function shadow(): HTMLCanvasElement {
  if (shadowSprite) return shadowSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  shadowSprite = c;
  return c;
}

export interface CrateFx {
  /** Real time the crate touched down (-1 = not yet). */
  landT: number;
  /** Sign of the side the canopy drifts toward when it collapses. */
  drift: number;
}

/** Draws one crate (world-space ctx). `time` is real seconds. */
export function drawCrate(ctx: CanvasRenderingContext2D, c: CrateState, fx: CrateFx | undefined, time: number, terrain: Terrain | null): void {
  const w = WEAPONS[c.weapon];
  const t = time + c.id * 1.31;
  const landT = fx ? fx.landT : -1;
  const sinceLand = c.landed && landT >= 0 ? time - landT : c.landed ? 10 : -1;
  const chute = Math.max(0, Math.min(1, c.parachute));

  // Ground shadow while descending (grows and darkens as the ground approaches).
  if (!c.landed && terrain) {
    const gy = terrain.surfaceY(c.x, Math.max(0, c.y));
    const h = gy - c.y;
    if (h > 0 && h < 220) {
      const k = 1 - h / 220;
      ctx.globalAlpha = 0.5 * k;
      ctx.drawImage(shadow(), c.x - CRATE_W * (0.6 + 0.6 * (1 - k)), gy - 4, CRATE_W * (1.2 + 1.2 * (1 - k)), 8);
      ctx.globalAlpha = 1;
    }
  }

  // Soft colour glow behind everything.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t * 2.4);
  blit(ctx, glowSprite(w.glow), c.x, c.y - CRATE_H * 0.5, CRATE_W * 3.4);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Collapsing canopy (world frame, not swaying) is drawn behind the crate.
  if (c.landed && chute > 0.001) drawCollapsingCanopy(ctx, c, chute, fx ? fx.drift : 1);

  ctx.save();
  ctx.translate(c.x, c.y - CRATE_H);
  if (!c.landed) ctx.rotate(c.sway);
  if (!c.landed && chute > 0.001) drawRig(ctx, c.weapon, t, chute);

  // Crate body with landing squash.
  let sx = 1, sy = 1;
  if (sinceLand >= 0 && sinceLand < 0.45) {
    const q = Math.sin((sinceLand / 0.45) * Math.PI * 2) * Math.exp(-sinceLand * 7) * 0.22;
    sy = 1 - q;
    sx = 1 + q * 0.6;
  }
  ctx.translate(0, CRATE_H);
  ctx.scale(sx, sy);
  const spr = crateSprite(c.weapon);
  ctx.drawImage(spr, -CRATE_W / 2 - CRATE_PAD, -CRATE_H - CRATE_PAD, CRATE_W + CRATE_PAD * 2, CRATE_H + CRATE_PAD * 2);

  // Idle gleam sweeping across the face every few seconds once landed.
  if (c.landed) {
    const period = 3.2;
    const ph = ((t % period) + period) % period / 0.75;
    if (ph < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-CRATE_W / 2, -CRATE_H, CRATE_W, CRATE_H);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * Math.sin(ph * Math.PI);
      ctx.translate(-CRATE_W * 0.9 + ph * CRATE_W * 1.8, -CRATE_H / 2);
      ctx.rotate(-1.05);
      ctx.drawImage(gleamSprite(), -CRATE_H * 0.9, -2.6, CRATE_H * 1.8, 5.2);
      ctx.restore();
    }
  }

  // Beacon light on the lid.
  const blink = Math.sin(t * TAU * (c.landed ? 0.9 : 1.6));
  const lx = CRATE_W * 0.32, ly = -CRATE_H - 0.6;
  ctx.fillStyle = '#2a2224';
  ctx.fillRect(lx - 1.6, ly - 0.6, 3.2, 1.2);
  ctx.fillStyle = blink > 0.3 ? '#ffffff' : '#5a2a2a';
  ctx.beginPath();
  ctx.arc(lx, ly - 0.6, 1.25, Math.PI, 0);
  ctx.fill();
  if (blink > 0.3) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, (blink - 0.3) * 2);
    blit(ctx, coreSprite(w.glow), lx, ly - 0.9, 13);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/** Rigging lines and breathing canopy, in the swaying frame (origin = crate top centre). */
function drawRig(ctx: CanvasRenderingContext2D, id: WeaponId, t: number, chute: number): void {
  const breathe = Math.sin(t * 2.6);
  const sx = (1 - 0.025 * breathe) * (0.4 + 0.6 * chute);
  const sy = (1 + 0.045 * breathe) * chute;
  const hemY = -LINE_LEN;
  const cw = CANOPY_W * sx;
  // Lines: from two lid points to the hem attachment points.
  ctx.strokeStyle = 'rgba(40,30,30,0.75)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let i = 0; i < RIG_POINTS.length; i++) {
    const ax = (i < 2 ? -1 : 1) * CRATE_W * 0.32;
    ctx.moveTo(ax, 0);
    ctx.lineTo(RIG_POINTS[i] * cw, hemY);
  }
  ctx.stroke();
  // Little riser ring above the lid.
  ctx.fillStyle = '#8c96a6';
  ctx.fillRect(-CRATE_W * 0.36, -0.9, CRATE_W * 0.72, 0.9);
  ctx.drawImage(canopySprite(id), -cw / 2, hemY - CANOPY_HEM_Y * sy, cw, CANOPY_H * sy);
}

/** After landing the canopy deflates, slides to one side and settles on the ground. */
function drawCollapsingCanopy(ctx: CanvasRenderingContext2D, c: CrateState, chute: number, drift: number): void {
  const k = 1 - chute;
  const e = k * k * (3 - 2 * k);
  const top = c.y - CRATE_H;
  const cx = c.x + drift * (CANOPY_W * 0.55) * e;
  const hemY = (top - LINE_LEN) + (c.y - 1 - (top - LINE_LEN)) * e;
  const sx = 1 + 0.25 * e;
  const sy = Math.max(0.12, 1 - 0.88 * e);
  const cw = CANOPY_W * sx;
  ctx.globalAlpha = chute < 0.25 ? chute / 0.25 : 1;
  // Slack lines (sagging curves).
  ctx.strokeStyle = 'rgba(40,30,30,0.7)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let i = 0; i < RIG_POINTS.length; i++) {
    const ax = c.x + (i < 2 ? -1 : 1) * CRATE_W * 0.32;
    const bx = cx + RIG_POINTS[i] * cw, by = hemY;
    ctx.moveTo(ax, top);
    ctx.quadraticCurveTo((ax + bx) / 2, Math.max(top, by) + 10 * e, bx, by);
  }
  ctx.stroke();
  ctx.drawImage(canopySprite(c.weapon), cx - cw / 2, hemY - CANOPY_HEM_Y * sy, cw, CANOPY_H * sy);
  ctx.globalAlpha = 1;
}

/** Pickup ghost: the crate pops (swells and fades), a ring bursts and the glyph floats up. */
export function drawCollectGhost(ctx: CanvasRenderingContext2D, x: number, y: number, id: WeaponId, e: number): void {
  const w = WEAPONS[id];
  const fade = 1 - e;
  const s = 1 + 0.6 * e;
  ctx.globalAlpha = fade * fade;
  ctx.drawImage(crateSprite(id), x - (CRATE_W / 2 + CRATE_PAD) * s, y - (CRATE_H / 2 + CRATE_PAD) * s - CRATE_H / 2,
    (CRATE_W + CRATE_PAD * 2) * s, (CRATE_H + CRATE_PAD * 2) * s);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade;
  blit(ctx, glowSprite(w.glow), x, y - CRATE_H / 2, 40 + 90 * e);
  ctx.strokeStyle = w.color;
  ctx.lineWidth = 3 * fade + 0.5;
  ctx.beginPath();
  ctx.arc(x, y - CRATE_H / 2, 10 + 46 * Math.sqrt(e), 0, TAU);
  ctx.stroke();
  // Glyph rising.
  ctx.save();
  ctx.translate(x, y - CRATE_H - 10 - 46 * (1 - (1 - e) * (1 - e)));
  ctx.scale(7, 7);
  traceGlyph(ctx, id);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = fade;
  ctx.fill('evenodd');
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
