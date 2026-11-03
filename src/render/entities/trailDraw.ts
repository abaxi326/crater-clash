/**
 * Trail rendering per TrailStyle. Ribbons are tapered polygons (round head cap, pointed tail) filled
 * with a tail→head alpha gradient; particle-like styles (smoke, fire, spark, void) blit cached sprites.
 */
import { hexToRgb, mixHex } from '../../core/color.ts';
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';
import type { Quality } from '../../core/settings.ts';
import { TRAIL_CAP, TRAIL_SPEC, type Trail } from './trail.ts';
import {
  blit, coreSprite, glowSprite, hueColor, hueGlow, hueIndex, hueStar, puffSprite, starSprite, voidWispSprite,
} from './sprites.ts';

// ---------------------------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------------------------

export interface TrailPalette {
  color: string;
  glow: string;
  /** Colour pushed toward white for ribbon cores. */
  core: string;
  /** rgba strings (alpha 0 / 1) for gradient stops. */
  glow0: string; glow1: string;
  color0: string; color1: string;
  core0: string; core1: string;
}

const palettes = new Map<string, TrailPalette>();

function rgbaStr(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function paletteFor(color: string, glow: string): TrailPalette {
  const key = color + glow;
  let p = palettes.get(key);
  if (!p) {
    const core = mixHex(color, '#ffffff', 0.5);
    p = {
      color, glow, core,
      glow0: rgbaStr(glow, 0), glow1: rgbaStr(glow, 0.38),
      color0: rgbaStr(color, 0), color1: rgbaStr(color, 0.9),
      core0: rgbaStr(core, 0), core1: rgbaStr(core, 0.95),
    };
    palettes.set(key, p);
  }
  return p;
}

export function weaponPalette(id: WeaponId): TrailPalette {
  const w = WEAPONS[id];
  return paletteFor(w.color, w.glow);
}

/** Palette for a hue-tinted fragment (fireworks stars). */
export function huePalette(hueDeg: number): TrailPalette {
  const c = hueColor(hueIndex(hueDeg));
  return paletteFor(c, c);
}

// ---------------------------------------------------------------------------------------------
// Ribbon geometry (scratch buffers shared by all trails; no per-frame allocation)
// ---------------------------------------------------------------------------------------------

const RX = new Float32Array(TRAIL_CAP + 4);
const RY = new Float32Array(TRAIL_CAP + 4);
const RW = new Float32Array(TRAIL_CAP + 4);
const RA = new Float32Array(TRAIL_CAP + 4);

/**
 * Collects one contiguous run of samples [from, to) (plus the live head when `head`) into the
 * scratch buffers with width = maxW × taper(age). Returns the point count.
 */
function gatherRun(tr: Trail, from: number, to: number, head: boolean, now: number, life: number, maxW: number, headTaper: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const j = tr.idx(i);
    const k = (now - tr.ts[j]) / life;
    if (k >= 1) continue;
    RX[n] = tr.xs[j];
    RY[n] = tr.ys[j];
    const f = 1 - k;
    RA[n] = f;
    RW[n] = maxW * Math.sqrt(f) * f;
    n++;
  }
  if (head) {
    // Skip a last sample that sits on top of the head.
    if (n > 0 && Math.abs(RX[n - 1] - tr.hx) + Math.abs(RY[n - 1] - tr.hy) < 0.75) n--;
    RX[n] = tr.hx; RY[n] = tr.hy; RW[n] = maxW * headTaper; RA[n] = 1;
    n++;
  }
  return n;
}

/** Traces the tapered ribbon polygon currently in the scratch buffers (widthScale × RW). */
function traceRibbon(ctx: CanvasRenderingContext2D, n: number, widthScale: number, roundHead: boolean): void {
  ctx.beginPath();
  // Left edge, tail → head.
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
    let tx = RX[b] - RX[a], ty = RY[b] - RY[a];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const w = RW[i] * widthScale;
    const x = RX[i] - ty * w, y = RY[i] + tx * w;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    if (i === n - 1 && roundHead && w > 0.2) {
      const ang = Math.atan2(tx, -ty);
      ctx.arc(RX[i], RY[i], w, ang, ang - Math.PI, true);
    }
  }
  // Right edge, head → tail.
  for (let i = n - 1; i >= 0; i--) {
    const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
    let tx = RX[b] - RX[a], ty = RY[b] - RY[a];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const w = RW[i] * widthScale;
    ctx.lineTo(RX[i] + ty * w, RY[i] - tx * w);
  }
  ctx.closePath();
}

/**
 * Luminous ribbon for every run of the trail: a tinted halo and a solid colour body (source-over, so the
 * hue survives on bright skies) under an additive hot core. Leaves composite at 'lighter'.
 */
function drawGlowRibbon(ctx: CanvasRenderingContext2D, tr: Trail, now: number, life: number, pal: TrailPalette, maxW: number, alpha: number): void {
  let runStart = 0;
  for (let i = 1; i <= tr.count; i++) {
    if (i < tr.count && !tr.brk[tr.idx(i)]) continue;
    const last = i === tr.count;
    const n = gatherRun(tr, runStart, i, last && tr.alive && !tr.underground, now, life, maxW, 0.85);
    runStart = i;
    if (n < 2) continue;
    const g0x = RX[0], g0y = RY[0], g1x = RX[n - 1], g1y = RY[n - 1];
    if (Math.abs(g1x - g0x) + Math.abs(g1y - g0y) < 0.5) continue;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    const gg = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
    gg.addColorStop(0, pal.glow0);
    gg.addColorStop(1, pal.glow1);
    ctx.fillStyle = gg;
    traceRibbon(ctx, n, 2.3, true);
    ctx.fill();
    const gb = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
    gb.addColorStop(0, pal.color0);
    gb.addColorStop(0.6, pal.color1);
    gb.addColorStop(1, pal.color1);
    ctx.fillStyle = gb;
    traceRibbon(ctx, n, 1.05, true);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const gc = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
    gc.addColorStop(0, pal.core0);
    gc.addColorStop(0.65, pal.core1);
    gc.addColorStop(1, pal.core1);
    ctx.fillStyle = gc;
    traceRibbon(ctx, n, 0.5, true);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
}

// ---------------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------------

export interface TrailFrame {
  /** Sim time (trail ages). */
  now: number;
  /** Real time (twinkle, flicker, jitter). */
  time: number;
  wind: number;
  quality: Quality;
}

const TAU = Math.PI * 2;
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const smokeTints = new Map<WeaponId, string>();
function smokeTint(id: WeaponId): string {
  let t = smokeTints.get(id);
  if (!t) {
    const base = id === 'burrower' || id === 'earthmaker' ? '#a8927a' : '#a9a49d';
    t = mixHex(base, WEAPONS[id].color, 0.12);
    smokeTints.set(id, t);
  }
  return t;
}

const FIRE_HOT = '#ffe2a0';
const FIRE_MID = '#ff8a24';
const FIRE_DEEP = '#ff3a10';
const FIRE_SMOKE = '#3d3632';

/** Draws one trail. Leaves globalAlpha = 1 and composite 'source-over'. */
export function drawTrail(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame): void {
  if (tr.count === 0 && !tr.alive) return;
  const w = WEAPONS[tr.weapon];
  const spec = TRAIL_SPEC[tr.style];
  const sz = Math.max(3, w.projectile.size) * (tr.fragment ? 0.7 : 1);
  const pal = tr.hue >= 0 ? huePalette(tr.hue) : weaponPalette(tr.weapon);
  const life = spec.life * (tr.fragment ? 0.75 : 1);
  if (tr.hue >= 0) {
    drawSpark(ctx, tr, f, life, pal, sz, tr.hue);
  } else {
    switch (tr.style) {
      case 'smoke': drawSmoke(ctx, tr, f, life, pal, sz); break;
      case 'fire': drawFire(ctx, tr, f, life, pal, sz); break;
      case 'glow':
        ctx.globalCompositeOperation = 'lighter';
        drawGlowRibbon(ctx, tr, f.now, life, pal, sz * 0.75, 1);
        break;
      case 'spark': drawSpark(ctx, tr, f, life, pal, sz, -1); break;
      case 'electric': drawElectric(ctx, tr, f, life, pal, sz); break;
      case 'void': drawVoid(ctx, tr, f, life, pal, sz); break;
      case 'rainbow': drawRainbow(ctx, tr, f, life, sz); break;
      default: break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawSmoke(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, pal: TrailPalette, sz: number): void {
  const puff = puffSprite(smokeTint(tr.weapon));
  const stride = f.quality === 'low' ? 2 : 1;
  const drift = f.wind * 5;
  for (let i = 0; i < tr.count; i += stride) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / life;
    if (k >= 1 || a < 0) continue;
    const r = tr.rs[j];
    const fade = (1 - k) * (1 - k) * Math.min(1, a / 0.07);
    ctx.globalAlpha = 0.36 * fade;
    const d = sz * (2.6 + 5.2 * Math.sqrt(k)) * (0.7 + r * 0.6);
    const r2 = tr.rs[tr.idx(i > 0 ? i - 1 : i)];
    blit(ctx, puff, tr.xs[j] + drift * a + (r - 0.5) * (3 + 14 * k), tr.ys[j] - 16 * a + (r2 - 0.5) * (3 + 10 * k), d);
  }
  // Hot exhaust right behind the shell.
  ctx.globalCompositeOperation = 'lighter';
  const glow = glowSprite(pal.glow);
  for (let i = 0; i < tr.count; i++) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    if (a > 0.16 || a < 0) continue;
    const k = a / 0.16;
    ctx.globalAlpha = 0.5 * (1 - k);
    blit(ctx, glow, tr.xs[j], tr.ys[j], sz * (3.2 - 1.6 * k));
  }
  drawGlowRibbon(ctx, tr, f.now, 0.18, pal, sz * 0.38, 0.7);
}

function drawFire(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, pal: TrailPalette, sz: number): void {
  const smoke = puffSprite(FIRE_SMOKE);
  const low = f.quality === 'low';
  const drift = f.wind * 5;
  // Pass 1: dark smoke the flames cool into.
  for (let i = 0; i < tr.count; i += low ? 2 : 1) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / life;
    if (k >= 1 || k < 0.18) continue;
    const r = tr.rs[j];
    const t = Math.min(1, (k - 0.18) / 0.2);
    ctx.globalAlpha = 0.55 * t * (1 - k) ** 1.4;
    const d = sz * (2.2 + 4.8 * k) * (0.8 + r * 0.4);
    blit(ctx, smoke, tr.xs[j] + drift * a + (r - 0.5) * 10 * k, tr.ys[j] - 22 * a, d);
  }
  // Pass 2: additive flame, white-hot → orange → deep red.
  ctx.globalCompositeOperation = 'lighter';
  const hot = coreSprite(FIRE_HOT), mid = glowSprite(FIRE_MID), deep = glowSprite(FIRE_DEEP);
  const flameLife = life * 0.55;
  for (let i = 0; i < tr.count; i++) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / flameLife;
    if (k >= 1 || a < 0) continue;
    const r = tr.rs[j];
    const flick = 0.82 + 0.36 * hash(r * 97 + Math.floor(f.time * 30));
    const d = sz * (3.6 - 2.2 * k) * flick;
    const x = tr.xs[j] + (r - 0.5) * 4 * k, y = tr.ys[j] - 10 * a;
    if (k < 0.3) {
      ctx.globalAlpha = 0.9 * (1 - k / 0.3) * 0.8 + 0.2;
      blit(ctx, hot, x, y, d * 0.8);
    }
    ctx.globalAlpha = (1 - k) * 0.75;
    blit(ctx, k < 0.45 ? mid : deep, x, y, d * 1.4);
  }
  drawGlowRibbon(ctx, tr, f.now, life * 0.28, pal, sz * 0.5, 0.85);
}

function drawSpark(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, pal: TrailPalette, sz: number, hue: number): void {
  ctx.globalCompositeOperation = 'lighter';
  drawGlowRibbon(ctx, tr, f.now, life * 0.4, pal, sz * 0.42, 0.8);
  const hi = hue >= 0 ? hueIndex(hue) : -1;
  const star = hi >= 0 ? hueStar(hi) : starSprite(pal.color);
  const dot = hi >= 0 ? hueGlow(hi) : glowSprite(pal.glow);
  // Fragments come in swarms: keep each one's glitter sparse so the burst stays legible.
  const stride = (f.quality === 'low' ? 2 : 1) * (tr.fragment ? 2 : 1);
  for (let i = 0; i < tr.count; i += stride) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / life;
    if (k >= 1 || a < 0) continue;
    const r = tr.rs[j];
    if (tr.fragment && r > 0.25 && r < 0.7) continue;
    const ang = r * TAU;
    const spread = 4 + 12 * k;
    const x = tr.xs[j] + Math.cos(ang) * spread * (0.4 + r);
    const y = tr.ys[j] + Math.sin(ang) * spread * 0.7 + 26 * a * a;
    const tw = 0.5 + 0.5 * Math.sin(f.time * 17 + r * 61);
    const fade = (1 - k) ** 1.2;
    if (r > 0.45) {
      ctx.globalAlpha = fade * (0.35 + 0.65 * tw);
      blit(ctx, star, x, y, sz * (1.8 + 2.6 * r) * (0.7 + 0.5 * tw));
    } else {
      ctx.globalAlpha = fade * 0.7;
      blit(ctx, dot, x, y, sz * 1.4);
    }
  }
}

function drawElectric(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, pal: TrailPalette, sz: number): void {
  ctx.globalCompositeOperation = 'lighter';
  drawGlowRibbon(ctx, tr, f.now, life, pal, sz * 0.5, 0.55);
  // Jagged bolt through recent samples, re-rolled ~24×/s.
  const n = gatherRun(tr, 0, tr.count, tr.alive && !tr.underground, f.now, life, 1, 1);
  if (n < 2) return;
  const roll = Math.floor(f.time * 24);
  const amp = sz * 0.85;
  ctx.lineJoin = 'miter';
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      let tx = RX[b] - RX[a], ty = RY[b] - RY[a];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const off = i === n - 1 ? 0 : (hash(roll * 31 + i) - 0.5) * 2 * amp * (0.35 + 0.65 * (1 - RA[i]));
      const x = RX[i] - ty * off, y = RY[i] + tx * off;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Fade toward the tail with a gradient stroke (one stroke per pass, no per-segment state changes).
    const g = ctx.createLinearGradient(RX[0], RY[0], RX[n - 1], RY[n - 1]);
    if (pass === 0) {
      g.addColorStop(0, pal.glow0);
      g.addColorStop(1, pal.glow1);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = sz * 0.8;
      ctx.lineJoin = 'round';
    } else {
      g.addColorStop(0, 'rgba(240,254,255,0)');
      g.addColorStop(0.5, 'rgba(240,254,255,0.75)');
      g.addColorStop(1, 'rgba(240,254,255,1)');
      ctx.globalAlpha = 1;
      ctx.lineWidth = sz * 0.26;
      ctx.lineJoin = 'miter';
    }
    ctx.strokeStyle = g;
    ctx.stroke();
  }
  // Crackling forks.
  ctx.beginPath();
  for (let i = 1; i < n - 1; i++) {
    if (hash(roll * 17 + i * 3.1) < 0.78) continue;
    const ang = hash(roll + i * 7.7) * TAU;
    const len = sz * (1.2 + 1.8 * hash(roll * 3 + i)) * (0.4 + RA[i] * 0.6);
    const mx = RX[i] + Math.cos(ang) * len * 0.5 + (hash(i + roll * 5) - 0.5) * sz;
    const my = RY[i] + Math.sin(ang) * len * 0.5 + (hash(i * 2 + roll) - 0.5) * sz;
    ctx.moveTo(RX[i], RY[i]);
    ctx.lineTo(mx, my);
    ctx.lineTo(RX[i] + Math.cos(ang) * len, RY[i] + Math.sin(ang) * len);
  }
  ctx.strokeStyle = pal.core;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = sz * 0.2;
  ctx.stroke();
}

function drawVoid(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, pal: TrailPalette, sz: number): void {
  const wisp = voidWispSprite();
  const stride = f.quality === 'low' ? 2 : 1;
  for (let i = 0; i < tr.count; i += stride) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / life;
    if (k >= 1 || a < 0) continue;
    const r = tr.rs[j];
    const ang = r * TAU + a * (r > 0.5 ? 5 : -5);
    const rad = 3 + 13 * k * (0.5 + r);
    ctx.globalAlpha = 0.62 * (1 - k) ** 1.3 * Math.min(1, a / 0.05);
    blit(ctx, wisp, tr.xs[j] + Math.cos(ang) * rad, tr.ys[j] + Math.sin(ang) * rad - 5 * a, sz * (2.4 + 3.6 * k) * (0.6 + r * 0.8));
  }
  ctx.globalCompositeOperation = 'lighter';
  drawGlowRibbon(ctx, tr, f.now, life * 0.4, pal, sz * 0.4, 0.6);
  const mote = glowSprite(pal.color);
  for (let i = 0; i < tr.count; i += 3) {
    const j = tr.idx(i);
    const a = f.now - tr.ts[j];
    const k = a / life;
    if (k >= 1 || a < 0) continue;
    const r = tr.rs[j];
    const ang = r * TAU - a * 6;
    const rad = 4 + 14 * k;
    ctx.globalAlpha = (1 - k) * 0.6;
    blit(ctx, mote, tr.xs[j] + Math.cos(ang) * rad, tr.ys[j] + Math.sin(ang) * rad, sz * 0.9);
  }
}

const EX = new Float32Array(TRAIL_CAP + 4);
const EY = new Float32Array(TRAIL_CAP + 4);
const FX = new Float32Array(TRAIL_CAP + 4);
const FY = new Float32Array(TRAIL_CAP + 4);
const HU = new Float32Array(TRAIL_CAP + 4);

function drawRainbow(ctx: CanvasRenderingContext2D, tr: Trail, f: TrailFrame, life: number, sz: number): void {
  const maxW = sz * 0.85;
  let runStart = 0;
  for (let i = 1; i <= tr.count; i++) {
    if (i < tr.count && !tr.brk[tr.idx(i)]) continue;
    const head = i === tr.count && tr.alive && !tr.underground;
    // Per-sample hue from birth time, so bands stay attached to the ribbon as it ages.
    let n = 0;
    for (let q = runStart; q < i; q++) {
      const j = tr.idx(q);
      const k = (f.now - tr.ts[j]) / life;
      if (k >= 1) continue;
      RX[n] = tr.xs[j]; RY[n] = tr.ys[j]; RA[n] = 1 - k;
      RW[n] = maxW * Math.sqrt(1 - k) * (1 - k);
      HU[n] = tr.ts[j] * 420;
      n++;
    }
    if (head) {
      if (n > 0 && Math.abs(RX[n - 1] - tr.hx) + Math.abs(RY[n - 1] - tr.hy) < 0.75) n--;
      RX[n] = tr.hx; RY[n] = tr.hy; RA[n] = 1; RW[n] = maxW * 0.85; HU[n] = f.now * 420; n++;
    }
    runStart = i;
    if (n < 2) continue;
    for (let q = 0; q < n; q++) {
      const a = q > 0 ? q - 1 : 0, b = q < n - 1 ? q + 1 : n - 1;
      let tx = RX[b] - RX[a], ty = RY[b] - RY[a];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      EX[q] = RX[q] - ty * RW[q]; EY[q] = RY[q] + tx * RW[q];
      FX[q] = RX[q] + ty * RW[q]; FY[q] = RY[q] - tx * RW[q];
    }
    // Soft hue halo underneath.
    ctx.globalCompositeOperation = 'lighter';
    for (let q = 0; q < n; q += 2) {
      ctx.globalAlpha = RA[q] * 0.32;
      blit(ctx, hueGlow(hueIndex(HU[q])), RX[q], RY[q], RW[q] * 7 + sz);
    }
    // Banded ribbon: one quad per segment.
    ctx.globalCompositeOperation = 'source-over';
    for (let q = 0; q < n - 1; q++) {
      ctx.globalAlpha = 0.92 * RA[q];
      ctx.fillStyle = hueColor(hueIndex(HU[q]));
      ctx.beginPath();
      ctx.moveTo(EX[q], EY[q]);
      ctx.lineTo(EX[q + 1], EY[q + 1]);
      ctx.lineTo(FX[q + 1], FY[q + 1]);
      ctx.lineTo(FX[q], FY[q]);
      ctx.closePath();
      ctx.fill();
    }
    // White-hot spine toward the head.
    ctx.globalCompositeOperation = 'lighter';
    for (let q = 0; q < n; q++) RW[q] *= 0.35;
    ctx.globalAlpha = 0.75;
    const gc = ctx.createLinearGradient(RX[0], RY[0], RX[n - 1], RY[n - 1]);
    gc.addColorStop(0, 'rgba(255,255,255,0)');
    gc.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = gc;
    traceRibbon(ctx, n, 1, true);
    ctx.fill();
  }
}
