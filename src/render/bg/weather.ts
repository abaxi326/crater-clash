/**
 * World-space weather in front of the terrain: pollen and leaves, dust streaks, slanting snow,
 * rising embers with ash, slow stardust. Fixed typed-array pool, wrapped around the visible area.
 */
import type { ViewInfo } from '../../contracts.ts';
import type { AmbientKind, BiomeDef } from '../../core/biomes.ts';
import { rgba } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';
import { ctx2d, glowSprite, makeCanvas } from './util.ts';

const MAX = 260;
const COUNTS = { low: 40, medium: 120, high: 250 } as const;

export class Weather {
  private kind: AmbientKind = 'pollen';
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  /** Depth-ish scale 0.5..1.5: size, speed and opacity. */
  private readonly z = new Float32Array(MAX);
  private readonly ph = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  /** Variant: 0 = main particle, 1 = secondary (leaf / ash / glint). */
  private readonly v = new Uint8Array(MAX);
  private seeded = false;
  private wind = 0;
  private time = 0;
  private gust = 0;
  private main: HTMLCanvasElement = makeCanvas(1, 1);
  private alt: HTMLCanvasElement = makeCanvas(1, 1);
  private additive = false;
  private rnd = Math.random;

  setBiome(b: BiomeDef, _seed: number): void {
    this.kind = b.ambient;
    this.seeded = false;
    const p = b.palette;
    this.additive = false;
    switch (this.kind) {
      case 'pollen':
        this.main = glowSprite(32, [[0, 'rgba(255,252,225,1)'], [0.3, rgba(p.accent, 0.75)], [1, rgba(p.accent, 0)]]);
        this.alt = leafSprite(p.surfaceDark, p.rim);
        break;
      case 'dust':
        this.main = streakSprite(p.haze);
        this.alt = glowSprite(24, [[0, rgba(p.rim, 0.9)], [0.4, rgba(p.haze, 0.4)], [1, rgba(p.haze, 0)]]);
        break;
      case 'snow':
        this.main = glowSprite(32, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(250,253,255,0.85)'], [1, 'rgba(235,245,255,0)']]);
        this.alt = glowSprite(32, [[0, 'rgba(255,255,255,0.5)'], [0.5, 'rgba(240,248,255,0.25)'], [1, 'rgba(235,245,255,0)']]);
        break;
      case 'embers':
        this.additive = true;
        this.main = glowSprite(32, [[0, 'rgba(255,245,200,1)'], [0.18, rgba(p.accent, 0.95)], [0.5, rgba(p.celestialGlow, 0.25)], [1, rgba(p.celestialGlow, 0)]]);
        this.alt = glowSprite(24, [[0, 'rgba(120,108,104,0.85)'], [0.6, 'rgba(90,80,78,0.5)'], [1, 'rgba(80,70,70,0)']]);
        break;
      case 'stardust':
        this.additive = true;
        this.main = glowSprite(32, [[0, 'rgba(235,245,255,1)'], [0.25, rgba(p.accent, 0.6)], [1, rgba(p.accent, 0)]]);
        this.alt = glowSprite(32, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(200,225,255,0.7)'], [1, 'rgba(150,190,255,0)']]);
        break;
    }
  }

  update(dt: number, wind: number, time: number): void {
    this.wind = wind;
    this.time = time;
    // Slow gusting so drift breathes rather than moving at a constant rate.
    this.gust = 0.75 + 0.25 * Math.sin(time * 0.37) + 0.12 * Math.sin(time * 1.13 + 2);
    if (!this.seeded) return;
    const w = wind * this.gust;
    const t = time;
    for (let i = 0; i < MAX; i++) {
      const z = this.z[i];
      let vx: number, vy: number;
      switch (this.kind) {
        case 'pollen':
          vx = (4 + w * 5) * z + Math.sin(t * 0.9 + this.ph[i]) * 6;
          vy = this.vy[i] * z + Math.cos(t * 1.3 + this.ph[i] * 1.7) * 5;
          if (this.v[i]) vx *= 1.6;
          break;
        case 'dust':
          vx = (30 + Math.abs(w) * 22) * Math.sign(w || 1) * z * (this.v[i] ? 0.5 : 1);
          vy = this.vy[i] * z + Math.sin(t * 2 + this.ph[i]) * 4;
          break;
        case 'snow':
          vx = w * 9 * z + Math.sin(t * 1.4 + this.ph[i]) * 7 * z;
          vy = this.vy[i] * z;
          break;
        case 'embers':
          if (this.v[i]) {
            vx = (w * 5 + Math.sin(t * 0.8 + this.ph[i]) * 8) * z;
            vy = this.vy[i] * z;
          } else {
            vx = (w * 6 + Math.sin(t * 2.3 + this.ph[i]) * 14) * z;
            vy = this.vy[i] * z + Math.sin(t * 3.1 + this.ph[i] * 2) * 6;
          }
          break;
        default:
          vx = (Math.sin(t * 0.2 + this.ph[i]) * 4 + 1.5) * z;
          vy = this.vy[i] * z + Math.cos(t * 0.27 + this.ph[i]) * 3;
      }
      this.x[i] += vx * dt;
      this.y[i] += vy * dt;
    }
  }

  private seed(view: ViewInfo): void {
    const r = this.rnd;
    const w = view.right - view.left, h = view.bottom - view.top;
    for (let i = 0; i < MAX; i++) {
      this.x[i] = view.left + r() * w;
      this.y[i] = view.top + r() * h;
      this.z[i] = 0.5 + r();
      this.ph[i] = r() * TAU;
      const q = r();
      switch (this.kind) {
        case 'pollen': this.v[i] = q < 0.07 ? 1 : 0; this.vy[i] = this.v[i] ? 10 + r() * 10 : (r() - 0.55) * 8; break;
        case 'dust': this.v[i] = q < 0.35 ? 1 : 0; this.vy[i] = (r() - 0.5) * 6; break;
        case 'snow': this.v[i] = this.z[i] > 1.25 && q < 0.5 ? 1 : 0; this.vy[i] = 26 + r() * 34; break;
        case 'embers': this.v[i] = q < 0.4 ? 1 : 0; this.vy[i] = this.v[i] ? 8 + r() * 12 : -(16 + r() * 38); break;
        default: this.v[i] = q < 0.15 ? 1 : 0; this.vy[i] = (r() - 0.5) * 5; break;
      }
    }
    this.seeded = true;
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    if (!this.seeded) this.seed(view);
    const count = COUNTS[view.quality] ?? 120;
    const m = 40;
    const L = view.left - m, T = view.top - m;
    const W = view.right - view.left + m * 2, H = view.bottom - view.top + m * 2;
    const t = this.time;
    const kind = this.kind;
    const prevOp = ctx.globalCompositeOperation;
    if (this.additive) ctx.globalCompositeOperation = 'lighter';
    const dustDir = this.wind < 0 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      let x = this.x[i], y = this.y[i];
      if (x < L || x >= L + W) { x = L + (((x - L) % W) + W) % W; this.x[i] = x; }
      if (y < T || y >= T + H) { y = T + (((y - T) % H) + H) % H; this.y[i] = y; }
      const z = this.z[i], alt = this.v[i] === 1;
      let s: number;
      switch (kind) {
        case 'pollen':
          if (alt) {
            const a = Math.sin(t * 2.2 + this.ph[i]) * 1.2 + this.ph[i];
            const sq = Math.cos(t * 3.1 + this.ph[i]); // tumbling: squash the leaf
            ctx.globalAlpha = 0.8;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(a);
            ctx.scale(1, 0.25 + 0.75 * Math.abs(sq));
            ctx.drawImage(this.alt, -6 * z, -3 * z, 12 * z, 6 * z);
            ctx.restore();
            continue;
          }
          s = 5 * z;
          ctx.globalAlpha = (0.35 + 0.35 * Math.sin(t * 1.7 + this.ph[i] * 3)) * Math.min(1, z);
          ctx.drawImage(this.main, x - s / 2, y - s / 2, s, s);
          break;
        case 'dust': {
          if (alt) {
            s = 5 * z;
            ctx.globalAlpha = 0.35 * z;
            ctx.drawImage(this.alt, x - s / 2, y - s / 2, s, s);
            break;
          }
          const len = (34 + Math.abs(this.wind) * 5) * z;
          ctx.globalAlpha = Math.min(0.5, (0.2 + 0.12 * Math.sin(t * 0.9 + this.ph[i])) * z);
          ctx.drawImage(this.main, dustDir > 0 ? x - len : x, y - 2 * z, len, 4 * z);
          break;
        }
        case 'snow':
          if (alt) {
            s = 10 * z;
            ctx.globalAlpha = 0.45;
            ctx.drawImage(this.alt, x - s / 2, y - s / 2, s, s);
          } else {
            s = 4.4 * z;
            ctx.globalAlpha = 0.55 + 0.3 * Math.min(1, z);
            ctx.drawImage(this.main, x - s / 2, y - s / 2, s, s);
          }
          break;
        case 'embers':
          if (alt) {
            if (this.additive) ctx.globalCompositeOperation = 'source-over';
            s = 4.5 * z;
            ctx.globalAlpha = 0.5;
            ctx.drawImage(this.alt, x - s / 2, y - s / 2, s, s * 0.7);
            ctx.globalCompositeOperation = 'lighter';
          } else {
            s = 9 * z;
            const f = 0.55 + 0.45 * Math.sin(t * 9 + this.ph[i] * 5);
            ctx.globalAlpha = f * Math.min(1, z * 0.9);
            ctx.drawImage(this.main, x - s / 2, y - s / 2, s, s);
          }
          break;
        default:
          if (alt) {
            const tw = Math.max(0, Math.sin(t * 1.1 + this.ph[i] * 4));
            s = 10 * z * (0.5 + tw);
            ctx.globalAlpha = tw * 0.8;
            ctx.drawImage(this.alt, x - s / 2, y - s / 2, s, s);
          } else {
            s = 4.5 * z;
            ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t * 0.8 + this.ph[i]);
            ctx.drawImage(this.main, x - s / 2, y - s / 2, s, s);
          }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }
}

function leafSprite(dark: string, light: string): HTMLCanvasElement {
  const c = makeCanvas(32, 16), g = ctx2d(c);
  g.fillStyle = dark;
  g.beginPath();
  g.moveTo(1, 8);
  g.quadraticCurveTo(14, -2, 31, 8);
  g.quadraticCurveTo(14, 18, 1, 8);
  g.fill();
  g.strokeStyle = light;
  g.globalAlpha = 0.7;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(2, 8);
  g.lineTo(29, 8);
  g.stroke();
  return c;
}

function streakSprite(col: string): HTMLCanvasElement {
  const c = makeCanvas(64, 8), g = ctx2d(c);
  const lg = g.createLinearGradient(0, 0, 64, 0);
  lg.addColorStop(0, rgba(col, 0));
  lg.addColorStop(0.7, rgba(col, 0.55));
  lg.addColorStop(1, rgba(col, 0));
  g.fillStyle = lg;
  g.beginPath();
  g.ellipse(32, 4, 32, 2.2, 0, 0, TAU);
  g.fill();
  return c;
}
