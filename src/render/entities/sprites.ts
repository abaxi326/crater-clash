/**
 * Entity-local sprite cache: soft glows, smoke puffs, void wisps and twinkle stars, pre-rendered once
 * per colour so per-frame drawing is plain drawImage (additive glows without shadowBlur).
 */
import { hexToRgb } from '../../core/color.ts';

/** Side length of every cached sprite in pixels; drawn scaled in world units. */
export const SPRITE_PX = 64;

const glowCache = new Map<string, HTMLCanvasElement>();
const coreCache = new Map<string, HTMLCanvasElement>();
const starCache = new Map<string, HTMLCanvasElement>();
const puffCache = new Map<string, HTMLCanvasElement>();
let voidWisp: HTMLCanvasElement | null = null;
const hueGlows: HTMLCanvasElement[] = [];
const hueStars: HTMLCanvasElement[] = [];
const hueStyles: string[] = [];
export const HUE_STEPS = 36;

function makeCanvas(size = SPRITE_PX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function rgbStr(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Soft additive halo: smooth falloff, colour throughout. Draw with 'lighter'. */
export function glowSprite(hex: string): HTMLCanvasElement {
  let s = glowCache.get(hex);
  if (s) return s;
  const [c, g] = makeCanvas();
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, rgbStr(hex, 0.9));
  grad.addColorStop(0.18, rgbStr(hex, 0.55));
  grad.addColorStop(0.42, rgbStr(hex, 0.2));
  grad.addColorStop(0.7, rgbStr(hex, 0.06));
  grad.addColorStop(1, rgbStr(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  glowCache.set(hex, c);
  s = c;
  return s;
}

/** Hot core: white centre bleeding into the colour, tight falloff. Draw with 'lighter'. */
export function coreSprite(hex: string): HTMLCanvasElement {
  let s = coreCache.get(hex);
  if (s) return s;
  const [c, g] = makeCanvas();
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.32, rgbStr(hex, 0.75));
  grad.addColorStop(0.6, rgbStr(hex, 0.18));
  grad.addColorStop(1, rgbStr(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  coreCache.set(hex, c);
  s = c;
  return s;
}

/** Four-point twinkle star with a soft centre. Draw with 'lighter'. */
export function starSprite(hex: string): HTMLCanvasElement {
  let s = starCache.get(hex);
  if (s) return s;
  const [c, g] = makeCanvas();
  paintStar(g, hex);
  starCache.set(hex, c);
  s = c;
  return s;
}

function paintStar(g: CanvasRenderingContext2D, hex: string): void {
  const h = SPRITE_PX / 2;
  const soft = g.createRadialGradient(h, h, 0, h, h, h * 0.55);
  soft.addColorStop(0, rgbStr(hex, 0.8));
  soft.addColorStop(1, rgbStr(hex, 0));
  g.fillStyle = soft;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  // Long thin rays (horizontal + vertical) and short diagonals.
  for (let k = 0; k < 2; k++) {
    const len = k === 0 ? h * 0.98 : h * 0.5;
    const w = k === 0 ? h * 0.085 : h * 0.06;
    g.save();
    g.translate(h, h);
    g.rotate(k * Math.PI / 4);
    for (let r = 0; r < 2; r++) {
      g.rotate(Math.PI / 2 * r);
      const lg = g.createLinearGradient(-len, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(-len, 0);
      g.quadraticCurveTo(0, -w, len, 0);
      g.quadraticCurveTo(0, w, -len, 0);
      g.fill();
    }
    g.restore();
  }
  const dot = g.createRadialGradient(h, h, 0, h, h, h * 0.16);
  dot.addColorStop(0, 'rgba(255,255,255,1)');
  dot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = dot;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
}

/**
 * Smoke puff (source-over): a lumpy soft disc with a lit top and shaded bottom,
 * so stacked puffs read as volume rather than flat circles.
 */
export function puffSprite(hex: string): HTMLCanvasElement {
  let s = puffCache.get(hex);
  if (s) return s;
  const [c, g] = makeCanvas();
  const h = SPRITE_PX / 2;
  const [r, gg, b] = hexToRgb(hex);
  // Lumps: a few overlapping soft circles.
  const lumps = [[0, 0, 0.62], [-0.28, 0.1, 0.42], [0.3, 0.06, 0.44], [0.05, -0.26, 0.42], [-0.12, 0.28, 0.36]];
  for (const [lx, ly, lr] of lumps) {
    const cx = h + lx * h, cy = h + ly * h, rr = lr * h;
    const grad = g.createRadialGradient(cx - rr * 0.25, cy - rr * 0.3, 0, cx, cy, rr);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 40)},${Math.min(255, gg + 40)},${Math.min(255, b + 40)},0.55)`);
    grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.38)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fill();
  }
  // Shade the underside slightly.
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, 0, 0, SPRITE_PX);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = shade;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  puffCache.set(hex, c);
  s = c;
  return s;
}

/** Void wisp (source-over): inky core with a violet rim. */
export function voidWispSprite(): HTMLCanvasElement {
  if (voidWisp) return voidWisp;
  const [c, g] = makeCanvas();
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(10,3,24,0.7)');
  grad.addColorStop(0.3, 'rgba(22,8,48,0.55)');
  grad.addColorStop(0.55, 'rgba(70,34,150,0.32)');
  grad.addColorStop(0.78, 'rgba(120,80,230,0.1)');
  grad.addColorStop(1, 'rgba(120,70,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  voidWisp = c;
  return c;
}

function ensureHues(): void {
  if (hueStyles.length) return;
  for (let i = 0; i < HUE_STEPS; i++) {
    const hue = (i / HUE_STEPS) * 360;
    const hex = hslHex(hue, 1, 0.62);
    hueStyles.push(hex);
    hueGlows.push(glowSprite(hex));
    hueStars.push(starSprite(hex));
  }
}

/** Index into the hue tables for a hue in degrees. */
export function hueIndex(hueDeg: number): number {
  const i = Math.round((((hueDeg % 360) + 360) % 360) / 360 * HUE_STEPS);
  return i % HUE_STEPS;
}
export function hueColor(i: number): string { ensureHues(); return hueStyles[i]; }
export function hueGlow(i: number): HTMLCanvasElement { ensureHues(); return hueGlows[i]; }
export function hueStar(i: number): HTMLCanvasElement { ensureHues(); return hueStars[i]; }

export function hslHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** Draws a cached sprite centred at (x, y) with world-space diameter d. */
export function blit(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, d: number): void {
  const r = d * 0.5;
  ctx.drawImage(sprite, x - r, y - r, d, d);
}
