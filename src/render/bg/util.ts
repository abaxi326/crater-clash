/** Shared helpers for the background: offscreen canvases, periodic noise and parallax projection. */
import { WORLD_H, WORLD_W } from '../../core/constants.ts';
import { hash1 } from '../../core/rng.ts';
import type { ViewInfo } from '../../contracts.ts';

/** Horizontal period (layer units) of every repeating background layer. */
export const PERIOD = 3200;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1] whose lattice repeats every `cells` units (x measured in cells). */
export function pnoise(seed: number, x: number, cells: number): number {
  const i = Math.floor(x);
  const t = smoother(x - i);
  const a = hash1(seed, ((i % cells) + cells) % cells) * 2 - 1;
  const b = hash1(seed, (((i + 1) % cells) + cells) % cells) * 2 - 1;
  return a + (b - a) * t;
}

/** Periodic fractal noise over [0, PERIOD): `baseCells` lattice cells per period at octave 0. */
export function pfbm(seed: number, x: number, baseCells: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += pnoise(seed + o * 7919, (x / PERIOD) * cells, cells) * amp;
    norm += amp;
    amp *= gain;
    cells *= 2;
  }
  return sum / norm;
}

/** Ridged periodic noise in [0, 1] (sharp crests) for mountain ranges. */
export function pridge(seed: number, x: number, baseCells: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(pnoise(seed + o * 3571, (x / PERIOD) * cells, cells));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    cells *= 2;
  }
  return sum / norm;
}

/**
 * Parallax projection for a layer of depth d (0 = fixed to the screen, 1 = moves with the world).
 * Layer coordinates are world-like: at the default framing they coincide with world units.
 * Zoom is applied as zoom^d so zooming and shake read as depth.
 */
export interface Proj {
  /** Device pixels per layer unit. */
  s: number;
  /** Screen position of layer origin. */
  ox: number;
  oy: number;
}

export function fitScale(view: ViewInfo): number {
  return Math.min(view.cw / WORLD_W, view.ch / WORLD_H);
}

export function project(view: ViewInfo, d: number, out: Proj): Proj {
  const s0 = fitScale(view);
  const zoom = view.scale / s0;
  const s = s0 * Math.pow(zoom, d);
  const cx = (view.left + view.right) * 0.5;
  const cy = (view.top + view.bottom) * 0.5;
  out.s = s;
  out.ox = view.cw * 0.5 - (WORLD_W * 0.5 + (cx - WORLD_W * 0.5) * d) * s;
  out.oy = view.ch * 0.5 - (WORLD_H * 0.5 + (cy - WORLD_H * 0.5) * d) * s;
  return out;
}

/** Soft radial dot sprite (white-ish core fading to transparent) in the given colour. */
export function dotSprite(size: number, color: string, hardness = 0.15): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(hardness, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  // Fade via alpha: draw the gradient with a transparent outer stop of the same hue.
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Radial glow sprite: stops are [offset, css colour] pairs. */
export function glowSprite(size: number, stops: ReadonlyArray<readonly [number, string]>): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Vertical gradient strip (2 px wide) for cheap stretched full-screen fills. */
export function vStrip(h: number, stops: ReadonlyArray<readonly [number, string]>): HTMLCanvasElement {
  const c = makeCanvas(2, h);
  const g = ctx2d(c);
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, h);
  return c;
}

/** Small seeded PRNG for presentation-side generation (deterministic per biome seed). */
export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
