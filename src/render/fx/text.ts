/**
 * Floating-text bitmaps (damage numbers, heal amounts, pickup labels). Each label is rendered once
 * at event time into a small canvas at 2× resolution, with a dark outline, a vertical gradient
 * fill and a soft drop shadow, then drawn as a sprite every frame.
 */
import { hexToRgb } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';

/** Bitmap pixels per world unit (sharp up to ~2 device px per world unit). */
export const TEXT_RES = 2;

export interface TextBitmap {
  canvas: HTMLCanvasElement;
  /** Size in world units. */
  w: number;
  h: number;
}

const FONT = "'Outfit', 'DM Sans', system-ui, sans-serif";

export interface TextPart {
  text: string;
  /** Font size in world units. */
  size: number;
  fill: string;
  /** Lighter top colour for the gradient. */
  top: string;
  weight?: number;
  /** Draw a small hexagon glyph before the text (shield). */
  hex?: boolean;
}

function lighten(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${(r + (255 - r) * k) | 0},${(g + (255 - g) * k) | 0},${(b + (255 - b) * k) | 0})`;
}

/** Convenience: part whose gradient top is a lightened version of `fill`. */
export function part(text: string, size: number, fill: string, weight = 800, hex = false): TextPart {
  return { text, size, fill, top: lighten(fill, 0.65), weight, hex };
}

/**
 * Renders lines of text parts (each line = parts laid out horizontally, centred) into a bitmap.
 */
export function renderText(lines: TextPart[][], outline = '#160d12'): TextBitmap {
  const measure = document.createElement('canvas').getContext('2d')!;
  const pad = 10;
  const gap = 4;
  const lineW: number[] = [];
  const lineH: number[] = [];
  for (const line of lines) {
    let w = 0, h = 0;
    for (const p of line) {
      measure.font = `${p.weight ?? 800} ${p.size}px ${FONT}`;
      w += measure.measureText(p.text).width + (p.hex ? p.size * 0.9 : 0) + 4;
      h = Math.max(h, p.size);
    }
    lineW.push(w);
    lineH.push(h);
  }
  const W = Math.max(...lineW) + pad * 2;
  const H = lineH.reduce((a, b) => a + b, 0) + gap * (lines.length - 1) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * TEXT_RES);
  canvas.height = Math.ceil(H * TEXT_RES);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(TEXT_RES, TEXT_RES);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let y = pad;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lh = lineH[li];
    let x = (W - lineW[li]) / 2;
    const cy = y + lh / 2 + lh * 0.04;
    for (const p of line) {
      ctx.font = `${p.weight ?? 800} ${p.size}px ${FONT}`;
      if (p.hex) {
        drawHexGlyph(ctx, x + p.size * 0.4, cy, p.size * 0.36, p.fill, outline);
        x += p.size * 0.9;
      }
      const tw = ctx.measureText(p.text).width;
      // Soft drop shadow (one-off at bitmap creation, never per frame), then a crisp outline.
      ctx.lineWidth = Math.max(3, p.size * 0.2);
      ctx.strokeStyle = outline;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = p.size * 0.35;
      ctx.shadowOffsetY = p.size * 0.03;
      ctx.strokeText(p.text, x, cy);
      ctx.restore();
      ctx.strokeText(p.text, x, cy);
      const g = ctx.createLinearGradient(0, cy - p.size / 2, 0, cy + p.size / 2);
      g.addColorStop(0, p.top);
      g.addColorStop(0.55, p.fill);
      g.addColorStop(1, p.fill);
      ctx.fillStyle = g;
      ctx.fillText(p.text, x, cy);
      x += tw + 4;
    }
    y += lh + gap;
  }
  return { canvas, w: W, h: H };
}

function drawHexGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, outline: string): void {
  ctx.beginPath();
  for (let v = 0; v < 6; v++) {
    const a = Math.PI / 6 + v * (TAU / 6);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}
