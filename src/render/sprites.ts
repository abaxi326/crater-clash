/**
 * Pre-rendered effect sprites. Glows, puffs, streaks and shards are painted once into small
 * offscreen canvases and then stamped with drawImage (additive or normal), which is far cheaper
 * than gradients or shadowBlur per particle. Every sprite gets a numeric id so the particle
 * system can store it in a typed array.
 */
import { hexToRgb, type RGB } from '../core/color.ts';
import { TAU } from '../core/math.ts';

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

const sprites: SpriteCanvas[] = [];
const byKey = new Map<string, number>();

function makeCanvas(w: number, h: number): SpriteCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function register(key: string, w: number, h: number, paint: (ctx: Ctx, w: number, h: number) => void): number {
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d') as Ctx;
  paint(ctx, w, h);
  const id = sprites.length;
  sprites.push(c);
  byKey.set(key, id);
  return id;
}

/** Sprite canvas by id. */
export function sprite(id: number): SpriteCanvas {
  return sprites[id];
}

const rgbStr = (c: RGB, a: number): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [255, 255, 255];

/**
 * Soft radial glow: a hot (whitened) core falling off with a long smooth tail.
 * `hot` controls how white the centre gets (0 = pure tint).
 */
const glowIds = new Map<string, Map<number, number>>();
export function glowSprite(hex: string, hot = 0.6): number {
  // Cached without building a key string: this is called from per-frame code.
  let byHot = glowIds.get(hex);
  if (!byHot) glowIds.set(hex, (byHot = new Map()));
  const hit = byHot.get(hot);
  if (hit !== undefined) return hit;
  const id = glowSpriteRaw(hex, hot);
  byHot.set(hot, id);
  return id;
}

function glowSpriteRaw(hex: string, hot: number): number {
  return register(`glow:${hex}:${hot}`, 64, 64, (ctx, w) => {
    const c = hexToRgb(hex);
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, rgbStr(mixRgb(c, WHITE, hot), 1));
    g.addColorStop(0.12, rgbStr(mixRgb(c, WHITE, hot * 0.5), 0.85));
    g.addColorStop(0.32, rgbStr(c, 0.42));
    g.addColorStop(0.6, rgbStr(c, 0.13));
    g.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Tight, bright dot (ember / spark head) with a small halo. */
const dotIds = new Map<string, number>();
export function dotSprite(hex: string): number {
  const hit = dotIds.get(hex);
  if (hit !== undefined) return hit;
  const id = dotSpriteRaw(hex);
  dotIds.set(hex, id);
  return id;
}

function dotSpriteRaw(hex: string): number {
  return register(`dot:${hex}`, 32, 32, (ctx, w) => {
    const c = hexToRgb(hex);
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, rgbStr(mixRgb(c, WHITE, 0.4), 1));
    g.addColorStop(0.4, rgbStr(c, 0.45));
    g.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Deterministic tiny hash for sprite painting (sprites are cosmetic, but stable variants look nicer). */
function h01(n: number): number {
  let x = (n * 374761393) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Billowy smoke puff: several overlapping soft lobes with a lit top-left and shaded bottom,
 * so stacked puffs read as volumetric smoke rather than flat discs.
 */
export function puffSprite(hex: string, variant: number): number {
  return register(`puff:${hex}:${variant}`, 96, 96, (ctx, w) => {
    const c = hexToRgb(hex);
    const lit = mixRgb(c, WHITE, 0.3);
    const shade = mixRgb(c, [0, 0, 0], 0.35);
    const r = w / 2;
    const lobes = 6;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * TAU + h01(variant * 31 + i) * 0.9;
        const d = r * (0.16 + h01(variant * 17 + i * 7) * 0.2);
        const lr = r * (0.34 + h01(variant * 13 + i * 3) * 0.16);
        const x = r + Math.cos(a) * d - (pass ? r * 0.06 : 0);
        const y = r + Math.sin(a) * d - (pass ? r * 0.08 : 0);
        const g = ctx.createRadialGradient(x, y, 0, x, y, lr);
        const col = pass ? lit : shade;
        const al = pass ? 0.5 : 0.62;
        g.addColorStop(0, rgbStr(col, al));
        g.addColorStop(0.6, rgbStr(col, al * 0.75));
        g.addColorStop(0.85, rgbStr(col, al * 0.25));
        g.addColorStop(1, rgbStr(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, lr, 0, TAU);
        ctx.fill();
      }
    }
  });
}

/** Horizontal streak (spark): white-hot head on the right, coloured tail fading left. 64×16. */
const streakIds = new Map<string, number>();
export function streakSprite(hex: string): number {
  const hit = streakIds.get(hex);
  if (hit !== undefined) return hit;
  const id = streakSpriteRaw(hex);
  streakIds.set(hex, id);
  return id;
}

function streakSpriteRaw(hex: string): number {
  return register(`streak:${hex}`, 64, 16, (ctx, w, h) => {
    const c = hexToRgb(hex);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgbStr(c, 0));
    g.addColorStop(0.55, rgbStr(c, 0.55));
    g.addColorStop(0.85, rgbStr(mixRgb(c, WHITE, 0.6), 1));
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    // Tapered capsule: thin at the tail, full at the head.
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w - h / 2, h * 0.18);
    ctx.arc(w - h / 2, h / 2, h * 0.32, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(w - h / 2, h * 0.82);
    ctx.closePath();
    ctx.fill();
    // Soft halo around the whole streak.
    ctx.globalCompositeOperation = 'destination-over';
    const halo = ctx.createRadialGradient(w * 0.8, h / 2, 0, w * 0.8, h / 2, h * 0.9);
    halo.addColorStop(0, rgbStr(c, 0.5));
    halo.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Four-point twinkle star with a soft core. */
const starIds = new Map<string, number>();
export function starSprite(hex: string): number {
  const hit = starIds.get(hex);
  if (hit !== undefined) return hit;
  const id = starSpriteRaw(hex);
  starIds.set(hex, id);
  return id;
}

function starSpriteRaw(hex: string): number {
  return register(`star:${hex}`, 64, 64, (ctx, w) => {
    const c = hexToRgb(hex);
    const r = w / 2;
    const core = ctx.createRadialGradient(r, r, 0, r, r, r * 0.5);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.3, rgbStr(mixRgb(c, WHITE, 0.4), 0.7));
    core.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = rgbStr(mixRgb(c, WHITE, 0.55), 1);
    for (let k = 0; k < 2; k++) {
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(k * Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, -r * 0.07, r, 0);
      ctx.quadraticCurveTo(0, r * 0.07, -r, 0);
      ctx.fill();
      ctx.restore();
    }
  });
}

/** Angular shard (glass / energy), lit along one facet. */
export function shardSprite(hex: string, variant: number): number {
  return register(`shard:${hex}:${variant}`, 32, 32, (ctx, w) => {
    const c = hexToRgb(hex);
    const r = w / 2;
    const n = 3 + (variant % 2);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + h01(variant * 7 + i) * 0.8;
      const d = r * (i === 0 ? 0.95 : 0.4 + h01(variant * 3 + i * 11) * 0.45);
      const x = r + Math.cos(a) * d, y = r + Math.sin(a) * d;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, rgbStr(mixRgb(c, WHITE, 0.85), 1));
    g.addColorStop(0.5, rgbStr(c, 0.9));
    g.addColorStop(1, rgbStr(mixRgb(c, [0, 0, 0], 0.3), 0.75));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
}

/** Soft annulus (shockwave / ripple), 128×128; ring at 80% radius. */
const ringIds = new Map<string, number>();
export function ringSprite(hex: string): number {
  const hit = ringIds.get(hex);
  if (hit !== undefined) return hit;
  const id = ringSpriteRaw(hex);
  ringIds.set(hex, id);
  return id;
}

function ringSpriteRaw(hex: string): number {
  return register(`ring:${hex}`, 128, 128, (ctx, w) => {
    const c = hexToRgb(hex);
    const r = w / 2;
    // Sharp leading edge at 68% radius, soft trailing wake inside (reads as a pressure front).
    const g = ctx.createRadialGradient(r, r, r * 0.3, r, r, r);
    g.addColorStop(0, rgbStr(c, 0));
    g.addColorStop(0.45, rgbStr(c, 0.08));
    g.addColorStop(0.5, rgbStr(mixRgb(c, WHITE, 0.5), 0.3));
    g.addColorStop(0.54, rgbStr(mixRgb(c, WHITE, 0.8), 1));
    g.addColorStop(0.62, rgbStr(c, 0.25));
    g.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Fire colour ramp over life: white → yellow → orange → red → dark smoke. */
const FIRE_STOPS: RGB[] = [[255, 248, 214], [255, 208, 84], [255, 134, 28], [228, 62, 16], [138, 30, 14], [48, 28, 26]];
export const FIRE_STEPS = 16;
let fireIds: Int32Array | null = null;

/** Sprite ids for the fire ramp (index 0 = fresh, FIRE_STEPS-1 = spent). */
export function fireRamp(): Int32Array {
  if (fireIds) return fireIds;
  const ids = new Int32Array(FIRE_STEPS);
  for (let i = 0; i < FIRE_STEPS; i++) {
    const t = i / (FIRE_STEPS - 1);
    const f = t * (FIRE_STOPS.length - 1);
    const k = Math.min(FIRE_STOPS.length - 2, Math.floor(f));
    const c = mixRgb(FIRE_STOPS[k], FIRE_STOPS[k + 1], f - k);
    ids[i] = register(`fire:${i}`, 64, 64, (ctx, w) => {
      const r = w / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, rgbStr(mixRgb(c, WHITE, 0.35 * (1 - t)), 1));
      g.addColorStop(0.25, rgbStr(c, 0.8));
      g.addColorStop(0.6, rgbStr(c, 0.25));
      g.addColorStop(1, rgbStr(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    });
  }
  fireIds = ids;
  return ids;
}

/** Packed (0xAABBGGRR) terrain colour → cached CSS string, quantised so the cache stays small. */
const packedCss = new Map<number, string>();
export function packedToCss(c: number): string {
  const q = c & 0x00f8f8f8;
  let s = packedCss.get(q);
  if (!s) {
    s = `rgb(${q & 255},${(q >>> 8) & 255},${(q >>> 16) & 255})`;
    packedCss.set(q, s);
  }
  return s;
}

/** Hex → cached CSS rgba() string at a quantised alpha (for hot loops that need fillStyle strings). */
const alphaCss = new Map<string, string[]>();
export function cssAlpha(hex: string, alpha: number): string {
  let arr = alphaCss.get(hex);
  if (!arr) {
    const c = hexToRgb(hex);
    arr = [];
    for (let i = 0; i <= 32; i++) arr.push(`rgba(${c[0]},${c[1]},${c[2]},${(i / 32).toFixed(3)})`);
    alphaCss.set(hex, arr);
  }
  const i = alpha <= 0 ? 0 : alpha >= 1 ? 32 : Math.round(alpha * 32);
  return arr[i];
}
