/** Biome-specific silhouette profiles (layer-space top y as a function of x) and baked details. */
import type { BiomeDef } from '../../core/biomes.ts';
import { mixHex, rgba, shadeHex } from '../../core/color.ts';
import { TAU, clamp, smoothstep } from '../../core/math.ts';
import type { LayerCtx } from './layers.ts';
import { PERIOD, mulberry, pfbm, pnoise, pridge } from './util.ts';

/** Volcano centre (layer space, far layer). */
export const VOLCANO_X = 760;
export const VOLCANO_TOP = 300;
const VOLCANO_CRATER = 46;

/** Signed periodic distance from a to b in [-PERIOD/2, PERIOD/2). */
export function pdx(x: number, cx: number): number {
  let d = (x - cx) % PERIOD;
  if (d < -PERIOD / 2) d += PERIOD;
  else if (d >= PERIOD / 2) d -= PERIOD;
  return d;
}

/** Side-on crater silhouette: two raised rims around a shallow bowl. Returns a y offset (negative = up). */
function crater(dx: number, r: number, rim: number): number {
  const a = Math.abs(dx) / r;
  if (a < 1) {
    const w = a ** 3.2; // flat floor, steep inner wall
    return rim * 0.3 * (1 - w) - rim * w;
  }
  return -rim * Math.exp(-(a - 1) * 3);
}

export function profileFor(b: BiomeDef, index: number, seed: number): (x: number) => number {
  const s = seed;
  switch (b.id) {
    case 'verdant': {
      const base = [415, 480, 545][index], amp = [75, 70, 55][index], cells = [4, 6, 9][index];
      return (x) => base + amp * pfbm(s, x, cells, 4, 0.45);
    }
    case 'dunes': {
      if (index === 2) return (x) => 660 + 38 * pfbm(s, x, 7, 3, 0.35) + 18 * pfbm(s + 5, x, 23, 2);
      const base = [560, 610][index], tall = [190, 140][index], cells = [9, 13][index];
      return (x) => {
        const m = pfbm(s + 77, x, cells, 3, 0.35);
        // Flat-topped mesas with steep walls and an occasional upper tier.
        const plateau = smoothstep(0.2, 0.25, m) * 0.78 + smoothstep(0.4, 0.44, m) * 0.22;
        return base + 16 * pfbm(s, x, 9, 3) - plateau * tall + 3 * pfbm(s + 9, x, 40, 1) * plateau;
      };
    }
    case 'frost': {
      if (index === 2) return (x) => 645 + 42 * pfbm(s, x, 8, 3);
      const base = [590, 625][index], tall = [360, 230][index], cells = [5, 9][index];
      return (x) => base - tall * pridge(s, x, cells, 5, 0.48) + 30 * pfbm(s + 3, x, 3, 2);
    }
    case 'cinder': {
      const base = [600, 650, 690][index], tall = [140, 150, 95][index], cells = [7, 10, 15][index];
      return (x) => {
        let y = base - tall * pridge(s, x, cells, 5, 0.5);
        if (index === 0) {
          const d = Math.abs(pdx(x, VOLCANO_X));
          let cone = VOLCANO_TOP + Math.max(0, d - VOLCANO_CRATER) ** 1.08 * 0.62 + 10 * pnoise(s + 1, d / 30, 9999);
          if (d < VOLCANO_CRATER) cone = VOLCANO_TOP + 14 * (1 - (d / VOLCANO_CRATER) ** 2) - 4;
          y = Math.min(y, cone);
        }
        return y;
      };
    }
    case 'lunar': {
      const base = [585, 630, 680][index], cells = [5, 8, 12][index];
      const rnd = mulberry(s);
      const craters: number[] = [];
      const n = [6, 7, 9][index];
      for (let i = 0; i < n; i++) craters.push(rnd() * PERIOD, 70 + rnd() * [220, 170, 120][index], 10 + rnd() * [30, 24, 18][index]);
      return (x) => {
        let y = base + 22 * pfbm(s, x, cells, 4);
        for (let i = 0; i < craters.length; i += 3) {
          const dx = pdx(x, craters[i]);
          if (Math.abs(dx) < craters[i + 1] * 2.2) y += crater(dx, craters[i + 1], craters[i + 2]);
        }
        return y;
      };
    }
  }
}

// ----------------------------------------------------------------------------------------
// Details

/** Calls fn at x and at its periodic copies when near a seam, so details tile cleanly. */
function wrapDraw(lc: LayerCtx, x: number, margin: number, fn: (x: number) => void): void {
  fn(x);
  if (x < margin) fn(x + lc.w);
  if (x > lc.w - margin) fn(x - lc.w);
}

/** Canvas-space top of the silhouette at canvas column cx. */
function topAt(lc: LayerCtx, cx: number): number {
  const i = clamp(Math.round(((cx % lc.w) + lc.w) % lc.w), 0, lc.w);
  return (lc.heights[i] - lc.y0) * lc.res;
}

export function decorate(lc: LayerCtx): void {
  switch (lc.b.id) {
    case 'verdant': return verdantDetails(lc);
    case 'dunes': return dunesDetails(lc);
    case 'frost': return frostDetails(lc);
    case 'cinder': return cinderDetails(lc);
    case 'lunar': return lunarDetails(lc);
  }
}

/** Vertical fade strip (opaque at the top) used to shade faces column by column. */
let fadeStrip: HTMLCanvasElement | null = null;
function getFadeStrip(): HTMLCanvasElement {
  if (fadeStrip) return fadeStrip;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 128);
  fadeStrip = c;
  return c;
}

/** Tinted copy of the fade strip. */
function tintedStrip(color: string): HTMLCanvasElement {
  const src = getFadeStrip();
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 128);
  return c;
}

/**
 * Faceted face shading: columns whose slope faces the light get a soft highlight, the others a shadow,
 * both fading downward from the crest. lightDir = -1 means the light is on the left.
 */
function shadeFaces(lc: LayerCtx, lightDir: number, lit: string, shade: string, litA: number, shadeA: number, depth: number): void {
  const { g, w, heights, res, y0 } = lc;
  const ls = tintedStrip(lit), ss = tintedStrip(shade);
  const k = Math.max(1, Math.round(6 * res));
  const len = depth * res;
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < w; i++) {
    const a = heights[Math.max(0, i - k)], b = heights[Math.min(w, i + k)];
    const slope = (b - a) / (2 * k / res); // dy/dx in layer units; > 0 means descending to the right
    const facing = clamp(slope * lightDir * -1 * 2.2, -1, 1); // > 0 faces the light
    const top = (heights[i] - y0) * res;
    if (facing > 0.04) {
      g.globalAlpha = facing * litA;
      g.drawImage(ls, i, top, 1, len);
    } else if (facing < -0.04) {
      g.globalAlpha = -facing * shadeA;
      g.drawImage(ss, i, top, 1, len * 1.3);
    }
  }
  g.restore();
}

/**
 * Stylised facet shading for ridged ranges: every prominent peak gets a lit face toward the light and a
 * shadow face away from it, bounded by a ridge line running down from the summit (low-poly painterly look).
 */
function facetShade(lc: LayerCtx, lightDir: number, lit: string, shade: string, litA: number, shadeA: number, minProm: number, depth: number): void {
  const { g, w, heights, res, y0 } = lc;
  const step = Math.max(1, Math.round(3 * res));
  const ext = Math.round(w * 0.2);
  const xs: number[] = [], ys: number[] = [];
  for (let i = -ext; i <= w + ext; i += step) {
    xs.push(i);
    ys.push((heights[((i % w) + w) % w] - y0) * res);
  }
  // Zigzag extrema with a prominence threshold (canvas px; smaller y = higher).
  const thr = minProm * res;
  const ext_: number[] = []; // indices alternating peak/valley, starting with whatever comes first
  const kinds: number[] = []; // 1 = peak, 0 = valley
  let mode = 0, hi = 0, lo = 0;
  for (let i = 1; i < xs.length; i++) {
    if (ys[i] < ys[hi]) hi = i;
    if (ys[i] > ys[lo]) lo = i;
    if (mode !== -1 && ys[i] > ys[hi] + thr) {
      ext_.push(hi); kinds.push(1); mode = -1; lo = i;
    } else if (mode !== 1 && ys[i] < ys[lo] - thr) {
      ext_.push(lo); kinds.push(0); mode = 1; hi = i;
    }
  }
  const D = depth * res;
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < ext_.length; k++) {
    if (kinds[k] !== 1) continue;
    const pi = ext_[k];
    for (const side of [-1, 1]) {
      const vk = k + side;
      const vi = vk >= 0 && vk < ext_.length ? ext_[vk] : side < 0 ? 0 : xs.length - 1;
      const px = xs[pi], py = ys[pi], vx = xs[vi], vy = ys[vi];
      const away = side === -lightDir; // side facing away from the light -> shadow
      const Dp = clamp((vy - py) * 2.4, 30 * res, D); // fade length scales with the peak's size
      const qx = px + (vx - px) * 0.22, qy = Math.min(py + Dp, py + Math.max(vy - py, 10) * 1.5);
      const grad = g.createLinearGradient(0, py, 0, py + Dp);
      const col = away ? shade : lit;
      const a = away ? shadeA : litA;
      grad.addColorStop(0, rgba(col, a));
      grad.addColorStop(0.6, rgba(col, a * 0.6));
      grad.addColorStop(1, rgba(col, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px, py);
      const s = side;
      for (let i = pi; i !== vi + s; i += s) g.lineTo(xs[i], ys[i]);
      g.lineTo(vx + (vx - px) * 0.35, py + Dp);
      g.lineTo(qx, py + Dp);
      g.lineTo(qx, qy);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

/** Patchwork meadows: bands following the hill contours, alternately lighter/darker, edged by hedgerows. */
function fieldBands(lc: LayerCtx, spacing: number): void {
  const { g, w, heights, res, y0, seed, color } = lc;
  const rows = 6;
  const off = new Float32Array(w + 1);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let k = 1; k <= rows; k++) {
    g.beginPath();
    for (let i = 0; i <= w; i += 2) {
      const lx = (i / w) * PERIOD;
      const o = (spacing * k + 8 * pnoise(seed + k * 13, (lx / PERIOD) * 40, 40)) * res;
      const y = (heights[i] - y0) * res + o;
      if (i === 0) g.moveTo(i, y); else g.lineTo(i, y);
      off[i] = y;
    }
    // Band below this contour, until the next one: fill to the bottom, the next band paints over it.
    g.lineTo(w, lc.h);
    g.lineTo(0, lc.h);
    g.closePath();
    g.fillStyle = k % 2 ? rgba(mixHex(color, '#e8f59a', 0.4), 0.2) : rgba(shadeHex(color, 0.85), 0.16);
    g.fill();
    g.strokeStyle = rgba(shadeHex(color, 0.65), 0.3);
    g.lineWidth = Math.max(1, 1.6 * res);
    g.beginPath();
    for (let i = 0; i <= w; i += 2) {
      if (i === 0) g.moveTo(i, off[i]); else g.lineTo(i, off[i]);
    }
    g.stroke();
  }
  g.restore();
}

function verdantDetails(lc: LayerCtx): void {
  const { g, index, res, seed, color, w } = lc;
  const rnd = mulberry(seed + 404);
  const size = [3.2, 6, 10][index];
  const step = size * res * [1.15, 1.25, 1.35][index];
  const dark = shadeHex(color, index === 0 ? 0.9 : 0.8);
  const light = mixHex(color, lc.b.palette.rim, 0.3);
  if (index > 0) fieldBands(lc, [0, 26, 34][index]);
  for (let cx = 0; cx < w; cx += step * (0.6 + rnd() * 0.8)) {
    const lx = (cx / w) * PERIOD;
    const forest = pfbm(seed + 51, lx, 10 + index * 4, 2);
    if (forest < -0.05 + index * 0.05) continue;
    const r = size * res * (0.75 + rnd() * 0.5);
    const poplar = index > 0 && rnd() < 0.18;
    const x = cx;
    wrapDraw(lc, x, r * 3, (xx) => {
      const top = topAt(lc, xx) + r * 0.5;
      g.fillStyle = dark;
      if (poplar) {
        g.beginPath();
        g.ellipse(xx, top - r * 1.6, r * 0.55, r * 1.9, 0, 0, TAU);
        g.fill();
        g.fillStyle = light;
        g.beginPath();
        g.ellipse(xx + r * 0.18, top - r * 2.1, r * 0.25, r * 1.1, 0, 0, TAU);
        g.fill();
        return;
      }
      g.beginPath();
      g.arc(xx - r * 0.55, top - r * 0.6, r * 0.75, 0, TAU);
      g.arc(xx + r * 0.5, top - r * 0.55, r * 0.7, 0, TAU);
      g.arc(xx, top - r * 1.15, r * 0.9, 0, TAU);
      g.fill();
      if (index > 0) {
        g.fillStyle = light;
        g.beginPath();
        g.arc(xx + r * 0.25, top - r * 1.45, r * 0.42, 0, TAU);
        g.fill();
      }
    });
  }
  shadeFaces(lc, 1, lc.b.palette.rim, shadeHex(color, 0.6), 0.12, 0.12, 120);
}

function dunesDetails(lc: LayerCtx): void {
  const { g, index, res, seed, color, w, h } = lc;
  const p = lc.b.palette;
  if (index < 2) {
    // Strata bands on mesa walls.
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const rnd = mulberry(seed + 7);
    let minY = Infinity;
    for (let i = 0; i < w; i++) minY = Math.min(minY, lc.heights[i]);
    const y1 = (minY + (index === 0 ? 170 : 130) - lc.y0) * res;
    for (let y = (minY - lc.y0 + 8) * res; y < y1; y += (9 + rnd() * 16) * res) {
      g.fillStyle = rnd() < 0.5 ? rgba(p.rim, 0.035 + rnd() * 0.04) : rgba(shadeHex(color, 0.7), 0.05 + rnd() * 0.06);
      g.fillRect(0, y, w, (1.5 + rnd() * 4) * res);
    }
    g.restore();
    shadeFaces(lc, 1, p.celestialGlow, shadeHex(color, 0.55), 0.3, 0.32, 260);
    return;
  }
  // Near dunes: sparse cacti and boulders.
  shadeFaces(lc, 1, p.celestialGlow, shadeHex(color, 0.6), 0.18, 0.2, 120);
  const rnd = mulberry(seed + 99);
  const dark = shadeHex(color, 0.9);
  for (let cx = rnd() * 200; cx < w; cx += (110 + rnd() * 260) * res) {
    const r = (5 + rnd() * 4) * res;
    const kind = rnd();
    wrapDraw(lc, cx, r * 6, (xx) => {
      const top = topAt(lc, xx) + r * 0.4;
      g.fillStyle = dark;
      g.strokeStyle = dark;
      g.lineCap = 'round';
      if (kind < 0.6) {
        const hh = r * (5 + rnd() * 3);
        g.lineWidth = r * 1.1;
        g.beginPath();
        g.moveTo(xx, top);
        g.lineTo(xx, top - hh);
        g.moveTo(xx, top - hh * 0.45);
        g.lineTo(xx - r * 1.6, top - hh * 0.5);
        g.lineTo(xx - r * 1.6, top - hh * 0.8);
        g.moveTo(xx, top - hh * 0.6);
        g.lineTo(xx + r * 1.4, top - hh * 0.62);
        g.lineTo(xx + r * 1.4, top - hh * 0.9);
        g.stroke();
      } else {
        g.beginPath();
        g.ellipse(xx, top, r * 2.2, r * 1.3, 0, Math.PI, TAU);
        g.fill();
      }
    });
  }
}

function pine(g: CanvasRenderingContext2D, x: number, base: number, hgt: number, wid: number, fill: string, snow: string | null): void {
  g.fillStyle = fill;
  g.beginPath();
  // Three stacked tiers.
  for (let t = 0; t < 3; t++) {
    const ty = base - hgt * (0.12 + t * 0.28);
    const tw = wid * (1 - t * 0.26);
    g.moveTo(x - tw, ty);
    g.lineTo(x, ty - hgt * 0.5);
    g.lineTo(x + tw, ty);
  }
  g.closePath();
  g.fill();
  g.fillRect(x - wid * 0.12, base - hgt * 0.14, wid * 0.24, hgt * 0.16);
  if (snow) {
    g.fillStyle = snow;
    for (let t = 0; t < 3; t++) {
      const ty = base - hgt * (0.12 + t * 0.28);
      const tw = wid * (1 - t * 0.26);
      g.beginPath();
      g.moveTo(x - tw * 0.55, ty - hgt * 0.2);
      g.lineTo(x, ty - hgt * 0.5);
      g.lineTo(x + tw * 0.15, ty - hgt * 0.4);
      g.closePath();
      g.fill();
    }
  }
}

function frostDetails(lc: LayerCtx): void {
  const { g, index, res, seed, color, w, heights, y0 } = lc;
  const p = lc.b.palette;
  if (index < 2) {
    // Snow caps: deeper on higher peaks, ragged lower edge.
    const snowline = [400, 520][index];
    const snow = mixHex('#ffffff', p.haze, [0.25, 0.12][index]);
    g.fillStyle = snow;
    for (let i = 0; i < w; i++) {
      const hy = heights[i];
      const lx = (i / w) * PERIOD;
      const depth = clamp((snowline - hy) * 0.6 + 22 * pnoise(seed + 3, (lx / PERIOD) * 90, 90) + 6 * pnoise(seed + 4, (lx / PERIOD) * 300, 300), 0, 220);
      if (depth > 0) g.fillRect(i, (hy - y0) * res, 1, depth * res);
    }
    facetShade(lc, -1, '#ffffff', shadeHex(color, 0.5), 0.3, 0.42, 18, 420);
    if (index === 1) {
      const rnd = mulberry(seed + 5);
      const dark = shadeHex(color, 0.82);
      for (let cx = 0; cx < w; cx += (4 + rnd() * 6) * res) {
        const lx = (cx / w) * PERIOD;
        if (pfbm(seed + 8, lx, 14, 2) < 0.12) continue;
        const top = topAt(lc, cx);
        if ((heights[Math.round(cx)] ?? 0) < snowline + 30) continue;
        const hh = (8 + rnd() * 7) * res;
        pine(g, cx, top + hh * 0.35, hh, hh * 0.32, dark, null);
      }
    }
    return;
  }
  // Near: snowy hills with a dense pine line.
  shadeFaces(lc, -1, '#ffffff', shadeHex(color, 0.6), 0.2, 0.2, 140);
  const rnd = mulberry(seed + 6);
  const dark = shadeHex(color, 0.78);
  const snow = rgba(mixHex('#ffffff', p.haze, 0.3), 0.85);
  for (let cx = 0; cx < w; cx += (5 + rnd() * 7) * res) {
    const lx = (cx / w) * PERIOD;
    if (pfbm(seed + 18, lx, 11, 3) < -0.15) continue;
    const hh = (16 + rnd() * 18) * res;
    wrapDraw(lc, cx, hh, (xx) => pine(g, xx, topAt(lc, xx) + hh * 0.28, hh, hh * 0.3, dark, snow));
  }
}

function cinderDetails(lc: LayerCtx): void {
  const { g, index, res, seed, color, w, heights, y0 } = lc;
  const p = lc.b.palette;
  const rnd = mulberry(seed + 31);
  facetShade(lc, 1, p.rim, '#000000', [0.14, 0.12, 0.1][index], 0.3, 14, 300);
  const gl = lc.needGlow();
  if (index === 0) {
    const cx = (VOLCANO_X / PERIOD) * w;
    const cy = (VOLCANO_TOP - y0) * res;
    lc.marks.push({ kind: 'crater', x: VOLCANO_X, y: VOLCANO_TOP + 4, p: VOLCANO_CRATER });
    // Crater lip glow.
    const cr = VOLCANO_CRATER * res;
    const rg = gl.createRadialGradient(cx, cy + cr * 0.2, 0, cx, cy + cr * 0.2, cr * 2.2);
    rg.addColorStop(0, rgba('#ffd27a', 0.9));
    rg.addColorStop(0.25, rgba(p.accent, 0.6));
    rg.addColorStop(1, rgba(p.accent, 0));
    gl.fillStyle = rg;
    gl.fillRect(cx - cr * 2.5, cy - cr * 2.5, cr * 5, cr * 5);
    // Lava streams running down the visible flank.
    for (let s = 0; s < 6; s++) {
      let x = cx + (rnd() * 2 - 1) * cr * 0.7;
      const dir = rnd() < 0.5 ? -1 : 1;
      const drift = (0.15 + rnd() * 0.45) * dir;
      let y = cy + cr * 0.15;
      const bottom = (630 + rnd() * 40 - y0) * res;
      const pts: number[] = [x, y];
      let wob = 0;
      while (y < bottom) {
        y += 6 * res;
        wob += (rnd() - 0.5) * 0.9;
        wob *= 0.85;
        x += (drift + wob + Math.sin(y * 0.05 / res + s) * 0.35) * 6 * res;
        const surf = topAt(lc, x);
        if (y < surf + 2 * res) y = surf + 2 * res;
        pts.push(x, y);
      }
      for (const [ctx, col, wdt] of [[g, shadeHex(p.accent, 0.55), 2.6], [gl, p.accent, 3.2], [gl, '#ffcc66', 1.2]] as const) {
        ctx.strokeStyle = col;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 2; i < pts.length; i += 2) {
          const t = i / pts.length;
          ctx.globalAlpha = 1 - t * 0.85;
          ctx.lineWidth = wdt * res * (1.4 - t);
          ctx.beginPath();
          ctx.moveTo(pts[i - 2], pts[i - 1]);
          ctx.lineTo(pts[i], pts[i + 1]);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  // Glowing fissures just under the crests.
  const count = [4, 9, 12][index];
  for (let k = 0; k < count; k++) {
    let x = rnd() * w;
    let y = topAt(lc, x) + (6 + rnd() * 30) * res;
    gl.strokeStyle = rgba(p.accent, 0.7);
    gl.lineWidth = (1 + rnd() * 1.4) * res;
    gl.beginPath();
    gl.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (rnd() - 0.5) * 22 * res;
      y += (4 + rnd() * 12) * res;
      gl.lineTo(x, y);
    }
    gl.stroke();
  }
  // Lava rivers glimmering along the horizon at the base of the near ridges.
  if (index === 2) {
    gl.fillStyle = rgba(p.accent, 0.25);
    for (let i = 0; i < w; i += 2) {
      const hy = heights[i];
      if (hy > 700) gl.fillRect(i, (hy - y0) * res, 2, 4 * res);
    }
  }
  void color;
}

function lunarDetails(lc: LayerCtx): void {
  const { g, index, res, seed, color, w } = lc;
  const p = lc.b.palette;
  facetShade(lc, -1, p.accent, '#000000', [0.12, 0.1, 0.1][index], 0.28, 10, 200);
  const rnd = mulberry(seed + 61);
  // Pockmarks.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    const y = topAt(lc, x) + (10 + rnd() * 120) * res;
    const r = (3 + rnd() * 10) * res;
    g.fillStyle = rgba(shadeHex(color, 0.6), 0.5);
    g.beginPath();
    g.ellipse(x, y, r, r * 0.3, 0, 0, TAU);
    g.fill();
    g.fillStyle = rgba(mixHex(color, p.accent, 0.3), 0.25);
    g.beginPath();
    g.ellipse(x, y + r * 0.12, r * 0.9, r * 0.2, 0, 0, Math.PI);
    g.fill();
  }
  g.restore();
  if (index === 0) return;
  // Distant outposts: domes, masts and window lights; beacons blink at draw time.
  const gl = lc.needGlow();
  const n = index === 1 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const x = ((k + 0.2 + rnd() * 0.6) / n) * w;
    const base = topAt(lc, x) + 2 * res;
    const sc = (index === 1 ? 1 : 1.5) * res;
    const domeCol = mixHex(color, p.accent, 0.18);
    g.fillStyle = domeCol;
    for (let d = 0; d < 3; d++) {
      const dx = x + (d - 1) * 14 * sc, dr = (6 + rnd() * 5) * sc;
      g.beginPath();
      g.arc(dx, base, dr, Math.PI, TAU);
      g.fill();
      gl.fillStyle = rgba('#ffd9a0', 0.9);
      for (let wnd = 0; wnd < 3; wnd++) gl.fillRect(dx - dr * 0.5 + wnd * dr * 0.4, base - dr * 0.35, sc * 1.4, sc * 1);
    }
    g.fillRect(x + 22 * sc, base - 34 * sc, 1.4 * sc, 34 * sc);
    lc.marks.push({ kind: 'beacon', x: ((x + 22.7 * sc) / w) * PERIOD, y: lc.y0 + (base - 35 * sc) / res, p: rnd() * TAU });
  }
}
