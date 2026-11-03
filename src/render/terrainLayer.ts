/**
 * Terrain presentation: keeps an offscreen copy of the destructible bitmap in sync via dirty
 * rects, builds a lit composite (rim light, soft edge occlusion, top-down falloff) whenever the
 * terrain changes, and adds per-frame emissive layers masked to the ground: cooling crater rims
 * and dynamic lights from the FX system.
 */
import type { BiomeDef } from '../core/biomes.ts';
import { mixHex, rgba, shadeHex } from '../core/color.ts';
import { WORLD_H, WORLD_W } from '../core/constants.ts';
import type { ExplosionKind } from '../core/weapons.ts';
import type { LightSource, ViewInfo } from '../contracts.ts';
import type { Terrain } from '../sim/terrain.ts';

const W = WORLD_W, H = WORLD_H;
/** Resolution divisor of the emissive (glow/light) layer. */
const GLOW_DIV = 2;
const MAX_GLOWS = 24;
const GLOW_LIFE = 4.2;
/** Fraction of a glow sprite's radius that lies inside the crater edge. */
const GLOW_INNER = 0.62;
/** Width of the mirrored letterbox continuation on each side. */
const EDGE_EXT = 1200;

interface CraterGlow {
  active: boolean;
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  power: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/** Radial glow sprite: colour stops given as [offset, r, g, b, a]. */
function radialSprite(size: number, stops: readonly (readonly [number, number, number, number, number])[]): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, r, gg, b, a] of stops) grad.addColorStop(o, `rgba(${r},${gg},${b},${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class TerrainLayer {
  /** Raw terrain pixels. */
  readonly base = makeCanvas(W, H);
  /** Lit composite drawn every frame. */
  readonly lit = makeCanvas(W, H);
  private readonly baseCtx = ctx2d(this.base);
  private readonly litCtx = ctx2d(this.lit);
  private readonly tmp = makeCanvas(W, H);
  private readonly tmpCtx = ctx2d(this.tmp);
  private readonly ao4 = makeCanvas(W / 4, H / 4);
  private readonly ao4Ctx = ctx2d(this.ao4);
  private readonly ao10 = makeCanvas(W / 10, H / 10);
  private readonly ao10Ctx = ctx2d(this.ao10);
  private readonly mask = makeCanvas(W / GLOW_DIV, H / GLOW_DIV);
  private readonly maskCtx = ctx2d(this.mask);
  private readonly glow = makeCanvas(W / GLOW_DIV, H / GLOW_DIV);
  private readonly glowCtx = ctx2d(this.glow);
  private readonly img: ImageData;
  private readonly u32: Uint32Array;

  private terrain: Terrain | null = null;
  private litVersion = -1;
  private sinceRebuild = 1;
  private biome: BiomeDef | null = null;
  private falloff: CanvasGradient | null = null;
  private bedrockFill = '#1a1412';
  private rimColor = '#ffffff';
  private aoColor = '#000000';
  private lowQuality = false;
  private readonly edgeL = makeCanvas(EDGE_EXT, H);
  private readonly edgeR = makeCanvas(EDGE_EXT, H);
  private edgesWanted = false;
  private edgeVersion = -2;
  private below: CanvasGradient | null = null;

  private readonly glows: CraterGlow[] = [];
  private readonly hotSprite: HTMLCanvasElement;
  private readonly warmSprite: HTMLCanvasElement;
  private readonly redSprite: HTMLCanvasElement;
  private readonly lightBase: HTMLCanvasElement;
  private readonly lightSprites = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.img = new ImageData(W, H);
    this.u32 = new Uint32Array(this.img.data.buffer);
    for (let i = 0; i < MAX_GLOWS; i++) this.glows.push({ active: false, x: 0, y: 0, r: 0, age: 0, life: 1, power: 1 });
    const k = GLOW_INNER;
    this.hotSprite = radialSprite(256, [[0, 255, 250, 225, 1], [k - 0.02, 255, 248, 215, 1], [k + 0.04, 255, 196, 96, 0.95], [k + 0.16, 255, 112, 30, 0.5], [k + 0.28, 200, 40, 10, 0.16], [1, 120, 10, 0, 0]]);
    this.warmSprite = radialSprite(256, [[0, 255, 150, 50, 1], [k - 0.02, 255, 150, 50, 1], [k + 0.05, 255, 102, 24, 0.8], [k + 0.18, 210, 46, 8, 0.32], [1, 120, 10, 0, 0]]);
    this.redSprite = radialSprite(256, [[0, 200, 40, 12, 1], [k - 0.02, 200, 40, 12, 1], [k + 0.06, 160, 24, 8, 0.6], [k + 0.2, 90, 10, 4, 0.2], [1, 40, 0, 0, 0]]);
    this.lightBase = radialSprite(128, [[0, 255, 255, 255, 1], [0.25, 255, 255, 255, 0.55], [0.55, 255, 255, 255, 0.18], [1, 255, 255, 255, 0]]);
    this.ao4Ctx.imageSmoothingQuality = 'high';
    this.ao10Ctx.imageSmoothingQuality = 'high';
  }

  setBiome(biome: BiomeDef): void {
    this.biome = biome;
    const p = biome.palette;
    this.rimColor = p.rim;
    this.aoColor = mixHex(p.bedrock, '#000000', 0.55);
    this.bedrockFill = shadeHex(p.bedrock, 0.82);
    const g = this.litCtx.createLinearGradient(0, 0, 0, H);
    const top = biome.terrain.base * H - biome.terrain.amplitude;
    g.addColorStop(0, rgba(p.ambientLight, 0.14));
    g.addColorStop(Math.max(0.05, top / H), rgba(p.ambientLight, 0.07));
    g.addColorStop(Math.min(0.95, (biome.terrain.base * H + 60) / H), 'rgba(0,0,0,0)');
    g.addColorStop(1, rgba(mixHex(p.bedrock, '#000000', 0.5), 0.34));
    this.falloff = g;
    this.below = null;
  }

  setQuality(low: boolean): void {
    this.lowQuality = low;
  }

  /** Full upload of a (new) terrain, e.g. at round start. */
  reset(terrain: Terrain): void {
    this.terrain = terrain;
    terrain.takeDirty();
    this.upload(0, 0, W, H);
    this.litVersion = -1;
    for (const g of this.glows) g.active = false;
  }

  get current(): Terrain | null {
    return this.terrain;
  }

  /** Copies a terrain region (column-major) into the row-major ImageData and pushes it to the canvas. */
  private upload(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    if (!t) return;
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const px = t.px, th = t.h, out = this.u32;
    for (let x = x0; x < x1; x++) {
      const base = x * th;
      for (let y = y0, o = y0 * W + x; y < y1; y++, o += W) out[o] = px[base + y];
    }
    this.baseCtx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  /** Pulls dirty rects and rebuilds the lit composite when the terrain changed (≤ once per call). */
  sync(dt: number): void {
    const t = this.terrain;
    if (!t) return;
    const d = t.takeDirty();
    if (d) this.upload(d.x0, d.y0, d.x1, d.y1);
    this.sinceRebuild += dt;
    if (t.version !== this.litVersion) {
      // Low quality: rebuild lighting at most ~30 times per second while dirt collapses.
      if (this.lowQuality && this.litVersion >= 0 && this.sinceRebuild < 1 / 30) return;
      this.rebuild();
      this.litVersion = t.version;
      this.sinceRebuild = 0;
    }
  }

  /** Lit composite: AO (soft, blurred via downsampling), under-edge shadow, falloff, rim light. */
  private rebuild(): void {
    const g = this.litCtx, base = this.base;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'copy';
    g.drawImage(base, 0, 0);

    // Air silhouettes at low resolution: bilinear upscaling turns them into soft blurs for free.
    const a4 = this.ao4Ctx, a10 = this.ao10Ctx;
    a4.globalCompositeOperation = 'copy';
    a4.fillStyle = this.aoColor;
    a4.fillRect(0, 0, W / 4, H / 4);
    a4.globalCompositeOperation = 'destination-out';
    a4.drawImage(base, 0, 0, W / 4, H / 4);
    a10.globalCompositeOperation = 'copy';
    a10.drawImage(this.ao4, 0, 0, W / 10, H / 10);

    g.globalCompositeOperation = 'source-atop';
    // Broad ambient occlusion along every exposed edge.
    g.globalAlpha = 0.34;
    g.drawImage(this.ao10, 0, 0, W, H);
    // Tighter, darker shadow under overhangs and tunnel ceilings (air below → shadow cast upward).
    g.globalAlpha = 0.5;
    g.drawImage(this.ao4, 0, -5, W, H);
    // Gentle top-down light falloff.
    if (this.falloff) {
      g.globalAlpha = 1;
      g.fillStyle = this.falloff;
      g.fillRect(0, 0, W, H);
    }

    // Rim light: terrain minus terrain shifted down = exposed top band.
    const t = this.tmpCtx;
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'copy';
    t.drawImage(base, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = this.rimColor;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'destination-out';
    t.drawImage(base, 0, 3);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.62;
    g.drawImage(this.tmp, 0, 0);
    // Bright 1-px lip on top of the band.
    t.globalCompositeOperation = 'copy';
    t.drawImage(base, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'destination-out';
    t.drawImage(base, 0, 1.25);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.42;
    g.drawImage(this.tmp, 0, 0);

    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Half-resolution coverage mask for the emissive layer.
    const m = this.maskCtx;
    m.globalCompositeOperation = 'copy';
    m.drawImage(base, 0, 0, W / GLOW_DIV, H / GLOW_DIV);
  }

  /** Hot crater rim that cools over ~4 s. */
  addCraterGlow(x: number, y: number, radius: number, kind: ExplosionKind): void {
    if (kind === 'none' || kind === 'dirt' || kind === 'electric' || kind === 'void' || radius < 4) return;
    let slot = this.glows[0];
    for (const g of this.glows) {
      if (!g.active) { slot = g; break; }
      if (g.age / g.life > slot.age / slot.life) slot = g;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.r = radius;
    slot.age = 0;
    const big = kind === 'heavy' || kind === 'beam' || kind === 'fire';
    slot.life = kind === 'small' || kind === 'firework' ? GLOW_LIFE * 0.6 : big ? GLOW_LIFE * 1.15 : GLOW_LIFE;
    slot.power = kind === 'small' || kind === 'firework' ? 0.7 : big ? 1.15 : 1;
  }

  update(dt: number): void {
    for (const g of this.glows) {
      if (!g.active) continue;
      g.age += dt;
      if (g.age >= g.life) g.active = false;
    }
  }

  get activeGlows(): number {
    let n = 0;
    for (const g of this.glows) if (g.active) n++;
    return n;
  }

  private lightSprite(color: string): HTMLCanvasElement {
    let s = this.lightSprites.get(color);
    if (!s) {
      s = makeCanvas(128, 128);
      const c = ctx2d(s);
      c.drawImage(this.lightBase, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color;
      c.fillRect(0, 0, 128, 128);
      if (this.lightSprites.size > 64) this.lightSprites.clear();
      this.lightSprites.set(color, s);
    }
    return s;
  }

  /**
   * World-space draw: letterbox extensions beyond the world edges, the lit terrain and the
   * emissive layer (crater rims + dynamic lights) masked to solid ground.
   */
  draw(ctx: CanvasRenderingContext2D, view: ViewInfo, lights: readonly LightSource[]): void {
    const lit = this.lit;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Letterbox: the terrain continues mirrored beyond the world edges (seamless at the edge),
    // pre-shaded darker outward so the play bounds still read.
    if (view.left < 0 || view.right > W) {
      if (!this.edgesWanted || this.edgeVersion !== this.litVersion) {
        this.edgesWanted = true;
        this.buildEdges();
      }
      if (view.left < 0) {
        const ext = Math.min(EDGE_EXT, Math.ceil(-view.left) + 2);
        ctx.drawImage(this.edgeL, EDGE_EXT - ext, 0, ext, H, -ext, 0, ext, H);
      }
      if (view.right > W) {
        const ext = Math.min(EDGE_EXT, Math.ceil(view.right - W) + 2);
        ctx.drawImage(this.edgeR, 0, 0, ext, H, W, 0, ext, H);
      }
    }
    if (view.bottom > H) {
      if (!this.below) {
        const g = ctx.createLinearGradient(0, H, 0, H + 700);
        g.addColorStop(0, this.bedrockFill);
        g.addColorStop(1, shadeHex(this.bedrockFill, 0.45));
        this.below = g;
      }
      ctx.fillStyle = this.below;
      ctx.fillRect(Math.min(0, view.left) - 2, H - 1, Math.max(W, view.right) - Math.min(0, view.left) + 4, view.bottom - H + 3);
    }
    ctx.drawImage(lit, 0, 0);
    this.drawEmissive(ctx, view, lights);
  }

  /** Mirrored, outward-darkened copies of the terrain for letterbox areas beside the world. */
  private buildEdges(): void {
    const lit = this.lit;
    for (const left of [true, false]) {
      const c = left ? this.edgeL : this.edgeR;
      const g = ctx2d(c);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, EDGE_EXT, H);
      if (left) {
        g.setTransform(-1, 0, 0, 1, EDGE_EXT, 0);
        g.drawImage(lit, 0, 0, EDGE_EXT, H, 0, 0, EDGE_EXT, H);
      } else {
        g.setTransform(-1, 0, 0, 1, EDGE_EXT, 0);
        g.drawImage(lit, W - EDGE_EXT, 0, EDGE_EXT, H, 0, 0, EDGE_EXT, H);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      const grad = g.createLinearGradient(left ? EDGE_EXT : 0, 0, left ? 0 : EDGE_EXT, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.35, 'rgba(0,0,0,0.3)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grad;
      g.fillRect(0, 0, EDGE_EXT, H);
      g.globalCompositeOperation = 'source-over';
    }
    this.edgeVersion = this.litVersion;
  }

  private drawEmissive(ctx: CanvasRenderingContext2D, view: ViewInfo, lights: readonly LightSource[]): void {
    // Union bounds of everything emissive, clipped to the view and the world.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const g of this.glows) {
      if (!g.active) continue;
      const s = g.r / GLOW_INNER;
      if (g.x - s < bx0) bx0 = g.x - s;
      if (g.y - s < by0) by0 = g.y - s;
      if (g.x + s > bx1) bx1 = g.x + s;
      if (g.y + s > by1) by1 = g.y + s;
    }
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.intensity <= 0.02 || l.radius <= 1) continue;
      if (l.x - l.radius < bx0) bx0 = l.x - l.radius;
      if (l.y - l.radius < by0) by0 = l.y - l.radius;
      if (l.x + l.radius > bx1) bx1 = l.x + l.radius;
      if (l.y + l.radius > by1) by1 = l.y + l.radius;
    }
    const D = GLOW_DIV;
    bx0 = Math.max(bx0, view.left, 0); by0 = Math.max(by0, view.top, 0);
    bx1 = Math.min(bx1, view.right, W); by1 = Math.min(by1, view.bottom, H);
    // Snap to the glow canvas grid.
    bx0 = Math.floor(bx0 / D) * D; by0 = Math.floor(by0 / D) * D;
    bx1 = Math.ceil(bx1 / D) * D; by1 = Math.ceil(by1 / D) * D;
    if (bx1 <= bx0 || by1 <= by0) return;
    const bw = bx1 - bx0, bh = by1 - by0;

    const g = this.glowCtx;
    g.setTransform(1 / D, 0, 0, 1 / D, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(bx0, by0, bw, bh);
    g.globalCompositeOperation = 'lighter';
    for (const c of this.glows) {
      if (!c.active) continue;
      const t = c.age / c.life;
      const s = c.r / GLOW_INNER;
      // White-hot → orange → deep red → gone.
      const hot = (1 - smooth(0, 0.2, t)) * c.power;
      const warm = smooth(0, 0.1, t) * (1 - smooth(0.22, 0.55, t)) * c.power;
      const red = smooth(0.12, 0.38, t) * (1 - smooth(0.5, 1, t)) * c.power;
      const flare = 1 + 0.12 * (1 - smooth(0, 0.08, t));
      const ss = s * flare;
      if (hot > 0.01) { g.globalAlpha = Math.min(1, hot); g.drawImage(this.hotSprite, c.x - ss, c.y - ss, ss * 2, ss * 2); }
      if (warm > 0.01) { g.globalAlpha = Math.min(1, warm); g.drawImage(this.warmSprite, c.x - s, c.y - s, s * 2, s * 2); }
      if (red > 0.01) { g.globalAlpha = Math.min(1, red); g.drawImage(this.redSprite, c.x - s, c.y - s, s * 2, s * 2); }
    }
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (l.intensity <= 0.02 || l.radius <= 1) continue;
      g.globalAlpha = Math.min(1, l.intensity * 0.55);
      g.drawImage(this.lightSprite(l.color), l.x - l.radius, l.y - l.radius, l.radius * 2, l.radius * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.mask, bx0 / D, by0 / D, bw / D, bh / D, bx0, by0, bw, bh);
    g.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.glow, bx0 / D, by0 / D, bw / D, bh / D, bx0, by0, bw, bh);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Bedrock colour for letterbox areas below the world. */
  get bedrock(): string {
    return this.bedrockFill;
  }

  get rim(): string {
    return this.rimColor;
  }

  get palette(): BiomeDef | null {
    return this.biome;
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}
