/** Offscreen sprite helpers for the tank renderer (bake once, drawImage every frame). */

/** Supersampling of baked sprites (device pixels per world unit). 3 keeps kill-cam zooms crisp. */
export const SPRITE_SCALE = 3;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Hull-space rectangle the sprite covers. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Bakes a sprite covering the hull-space rect (x, y, w, h); paint() draws in hull units. */
export function bake(x: number, y: number, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Sprite {
  const canvas = makeCanvas(w * SPRITE_SCALE, h * SPRITE_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(SPRITE_SCALE, 0, 0, SPRITE_SCALE, -x * SPRITE_SCALE, -y * SPRITE_SCALE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  paint(ctx);
  return { canvas, x, y, w, h };
}

/** Draws a sprite at its hull-space rect into a context already in hull space. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite): void {
  ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h);
}

/** Copy of a sprite with every opaque pixel replaced by `fill` (colour or gradient in hull units). */
export function silhouette(src: Sprite, fill: string | ((ctx: CanvasRenderingContext2D) => CanvasGradient)): Sprite {
  return bake(src.x, src.y, src.w, src.h, (ctx) => {
    ctx.drawImage(src.canvas, src.x, src.y, src.w, src.h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = typeof fill === 'string' ? fill : fill(ctx);
    ctx.fillRect(src.x, src.y, src.w, src.h);
  });
}

/**
 * Adds a uniform dark outline (`width` hull units) around a sprite's silhouette, so the whole tank
 * reads against any background without per-part strokes.
 */
export function outlined(src: Sprite, color: string, width: number): Sprite {
  const pad = width + 0.5;
  const dark = silhouette(src, color);
  return bake(src.x - pad, src.y - pad, src.w + pad * 2, src.h + pad * 2, (ctx) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.drawImage(dark.canvas, src.x + Math.cos(a) * width, src.y + Math.sin(a) * width, src.w, src.h);
    }
    ctx.drawImage(src.canvas, src.x, src.y, src.w, src.h);
  });
}

const glowCache = new Map<string, HTMLCanvasElement>();

/** Soft radial glow (64 px), white core fading to `color`. Draw with 'lighter'. */
export function glowSprite(color: string, core = 0.35): HTMLCanvasElement {
  const key = `${color}|${core}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(255,255,255,${core})`);
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.5, colorAlpha(color, 0.35));
  grad.addColorStop(1, colorAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(key, c);
  return c;
}

/** '#rrggbb' → rgba() with alpha (bake-time only). */
export function colorAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const beamCache = new Map<string, HTMLCanvasElement>();

/** Soft forward light cone (128×48, apex at the left middle). Draw with 'lighter'. */
export function beamSprite(color: string): HTMLCanvasElement {
  const hit = beamCache.get(color);
  if (hit) return hit;
  const c = makeCanvas(128, 48);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, colorAlpha(color, 0.5));
  grad.addColorStop(0.35, colorAlpha(color, 0.18));
  grad.addColorStop(1, colorAlpha(color, 0));
  g.fillStyle = grad;
  // Stacked cones of growing spread fake a soft edge.
  for (let i = 0; i < 6; i++) {
    const spread = 6 + i * 3.4;
    g.globalAlpha = 0.28;
    g.beginPath();
    g.moveTo(0, 24 - 2);
    g.lineTo(128, 24 - spread);
    g.lineTo(128, 24 + spread);
    g.lineTo(0, 24 + 2);
    g.closePath();
    g.fill();
  }
  beamCache.set(color, c);
  return c;
}

let shadowCanvas: HTMLCanvasElement | null = null;

/** Soft black ellipse for the contact shadow (64×16). */
export function shadowSprite(): HTMLCanvasElement {
  if (shadowCanvas) return shadowCanvas;
  const c = makeCanvas(128, 32);
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 0.25, 0, 0);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowCanvas = c;
  return c;
}
