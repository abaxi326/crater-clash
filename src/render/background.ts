/**
 * Background: sky, celestial bodies, clouds, parallax silhouettes and ambient life behind the battlefield,
 * plus world-space weather in front of the terrain. Everything heavy is pre-rendered per biome in
 * setBiome(); per frame only drawImage calls with parallax offsets.
 */
import type { BackgroundApi, ViewInfo } from '../contracts.ts';
import { BIOMES, type BiomeDef, type BiomeId } from '../core/biomes.ts';
import { rgba } from '../core/color.ts';
import { WORLD_H, WORLD_W } from '../core/constants.ts';
import { clamp } from '../core/math.ts';
import { Ambient } from './bg/ambient.ts';
import { buildClouds, type CloudSet } from './bg/clouds.ts';
import { buildLayers, type Layer } from './bg/layers.ts';
import { SKY_BOTTOM, SKY_TOP, buildSky, type Placed, type SkyAssets } from './bg/sky.ts';
import { PERIOD, ctx2d, makeCanvas, project, vStrip, type Proj } from './bg/util.ts';
import { Weather } from './bg/weather.ts';

const SKY_DEPTH = 0.03;
const CEL_DEPTH = 0.05;

interface BiomeAssets {
  biome: BiomeDef;
  seed: number;
  res: number;
  sky: SkyAssets;
  layers: Layer[];
  clouds: CloudSet | null;
  /** Haze band strip drawn over the base of each layer. */
  hazeBand: HTMLCanvasElement;
}

function buildAssets(b: BiomeDef, seed: number, res: number): BiomeAssets {
  return {
    biome: b, seed, res,
    sky: buildSky(b, res, seed),
    layers: buildLayers(b, res, seed),
    clouds: buildClouds(b, res, seed),
    hazeBand: vStrip(512, [[0, rgba(b.palette.haze, 0)], [0.075, rgba(b.palette.haze, 0.6)], [0.125, rgba(b.palette.haze, 1)], [1, rgba(b.palette.haze, 1)]]),
  };
}

/** Pre-render resolution (canvas px per layer unit) suited to this display. */
function displayRes(): number {
  if (typeof window === 'undefined') return 0.75;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min(window.innerWidth / WORLD_W, window.innerHeight / WORLD_H) * dpr;
  return clamp(fit * 1.05, 0.5, 1.15);
}

export class Background implements BackgroundApi {
  private cache = new Map<BiomeId, BiomeAssets>();
  private a: BiomeAssets | null = null;
  private thumbs = new Map<string, HTMLCanvasElement>();
  private readonly ambient = new Ambient();
  private readonly weather = new Weather();
  private readonly proj: Proj = { s: 1, ox: 0, oy: 0 };
  private wind = 0;
  private time = 0;

  setBiome(biome: BiomeId, seed: number): void {
    const b = BIOMES[biome];
    const res = displayRes();
    let a = this.cache.get(biome);
    if (!a || Math.abs(a.res - res) > 0.2) {
      // Biome scenery is seeded per biome (not per round) so it stays recognisable; a few biomes cached.
      a = buildAssets(b, hashSeed(biome), res);
      this.cache.delete(biome);
      this.cache.set(biome, a);
      while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    } else {
      this.cache.delete(biome);
      this.cache.set(biome, a);
    }
    this.a = a;
    this.ambient.setBiome(b, a.layers, seed);
    this.weather.setBiome(b, seed);
  }

  update(dt: number, wind: number, time: number): void {
    this.time = time;
    // Ease the visible wind so drifting never snaps when a new turn rolls a new wind.
    this.wind += (wind - this.wind) * (1 - Math.exp(-dt * 1.2));
    const a = this.a;
    if (!a) return;
    if (a.clouds) {
      const drift = 5 + this.wind * 4.5;
      for (const c of a.clouds.clouds) {
        c.x += drift * c.speed * (0.4 + c.depth * 2) * dt;
        if (c.x > PERIOD) c.x -= PERIOD;
        else if (c.x < 0) c.x += PERIOD;
      }
    }
    this.ambient.update(dt, this.wind, time);
    this.weather.update(dt, this.wind, time);
  }

  drawBack(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    if (this.a) this.drawScene(ctx, view, this.a, true);
    else {
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, view.cw, view.ch);
    }
    ctx.restore();
  }

  drawFront(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    if (!this.a) return;
    this.weather.draw(ctx, view);
  }

  thumbnail(biome: BiomeId, width: number, height: number): HTMLCanvasElement {
    const key = `${biome}:${width}x${height}`;
    const hit = this.thumbs.get(key);
    if (hit) return hit;
    const b = BIOMES[biome];
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const scale = Math.max(w / WORLD_W, h / WORLD_H);
    const res = clamp(scale * 1.6, 0.18, 0.6);
    const assets = buildAssets(b, hashSeed(biome), res);
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    const vw = w / scale, vh = h / scale;
    const view: ViewInfo = {
      left: WORLD_W / 2 - vw / 2, right: WORLD_W / 2 + vw / 2, top: WORLD_H / 2 - vh / 2, bottom: WORLD_H / 2 + vh / 2,
      scale, cw: w, ch: h, dpr: 1, time: 0, dt: 0, quality: 'high', reducedMotion: true,
    };
    this.drawScene(g, view, assets, false);
    drawGroundHint(g, view, b);
    this.thumbs.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------------------------------

  private drawScene(ctx: CanvasRenderingContext2D, view: ViewInfo, a: BiomeAssets, live: boolean): void {
    const p = this.proj;
    const t = live ? view.time : 0;
    // Sky.
    project(view, SKY_DEPTH, p);
    const top = p.oy + SKY_TOP * p.s, bot = p.oy + SKY_BOTTOM * p.s;
    if (top > 0) {
      ctx.fillStyle = a.sky.topColor;
      ctx.fillRect(0, 0, view.cw, Math.ceil(top) + 1);
    }
    ctx.drawImage(a.sky.strip, 0, 0, 2, a.sky.strip.height, 0, top, view.cw, bot - top);
    if (bot < view.ch) {
      ctx.fillStyle = a.sky.bottomColor;
      ctx.fillRect(0, Math.floor(bot) - 1, view.cw, view.ch - bot + 2);
    }
    if (live) this.ambient.drawSky(ctx, view, p);
    this.drawCelestial(ctx, view, a, t);
    // Clouds and layers interleaved by depth.
    const clouds = a.clouds ? a.clouds.clouds : null;
    let ci = 0;
    for (let li = 0; li < a.layers.length; li++) {
      const L = a.layers[li];
      if (clouds) {
        while (ci < clouds.length && clouds[ci].depth < L.depth) this.drawCloud(ctx, view, a, ci++);
      }
      this.drawLayer(ctx, view, L, t, live);
      if (live) this.ambient.drawAfterLayer(ctx, view, li, p);
    }
    if (clouds) while (ci < clouds.length) this.drawCloud(ctx, view, a, ci++);
    // Soft haze over the nearest layer's base keeps contrast low around the play area.
    const near = a.layers[a.layers.length - 1];
    project(view, near.depth, p);
    const hy = p.oy + (near.crest - 30) * p.s;
    // One stretched strip (gradient in its first 64 rows, solid after) avoids seams between band and fill.
    const band = 260 * p.s;
    if (hy < view.ch) {
      const rows = Math.min(512, (64 * Math.max(band, view.ch - hy)) / band);
      ctx.globalAlpha = 0.18;
      ctx.drawImage(a.hazeBand, 0, 0, 2, rows, 0, hy, view.cw, (rows / 64) * band);
      ctx.globalAlpha = 1;
    }
  }

  private drawCelestial(ctx: CanvasRenderingContext2D, view: ViewInfo, a: BiomeAssets, t: number): void {
    const p = project(view, CEL_DEPTH, this.proj);
    for (const c of a.sky.celestial) this.drawPlaced(ctx, c, p);
    const r = a.sky.rays;
    if (r && view.quality !== 'low') {
      const sx = p.ox + r.x * p.s, sy = p.oy + r.y * p.s;
      const ang = t * 0.012;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.2 + 0.06 * Math.sin(t * 0.35);
      ctx.setTransform(cs, sn, -sn, cs, sx, sy);
      const w = r.w * p.s;
      ctx.drawImage(r.canvas, -w / 2, -w / 2, w, w);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawPlaced(ctx: CanvasRenderingContext2D, c: Placed, p: Proj): void {
    if (c.add) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(c.canvas, p.ox + (c.x - c.w / 2) * p.s, p.oy + (c.y - c.h / 2) * p.s, c.w * p.s, c.h * p.s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawCloud(ctx: CanvasRenderingContext2D, view: ViewInfo, a: BiomeAssets, i: number): void {
    const set = a.clouds!;
    const c = set.clouds[i];
    const p = project(view, c.depth, this.proj);
    const w = c.w * p.s, h = c.h * p.s;
    const y = p.oy + (c.y - c.h / 2) * p.s;
    if (y > view.ch || y + h < 0) return;
    const tile = PERIOD * p.s;
    let x = p.ox + (c.x - c.w / 2) * p.s;
    x -= Math.ceil((x + w) / tile) * tile; // a copy that ends left of the screen
    ctx.globalAlpha = c.alpha;
    for (x += tile; x < view.cw; x += tile) if (x + w > 0) ctx.drawImage(set.sprites[c.sprite], x, y, w, h);
    ctx.globalAlpha = 1;
  }

  private drawLayer(ctx: CanvasRenderingContext2D, view: ViewInfo, L: Layer, t: number, live: boolean): void {
    const p = project(view, L.depth, this.proj);
    const tile = PERIOD * p.s;
    const y = p.oy + L.y0 * p.s;
    const h = L.h * p.s;
    if (y < view.ch) {
      const x0 = p.ox - Math.ceil(p.ox / tile) * tile;
      const tw = Math.ceil(tile) + 1;
      for (let x = x0; x < view.cw; x += tile) ctx.drawImage(L.canvas, Math.floor(x), y, tw, h);
      if (L.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = live ? 0.78 + 0.16 * Math.sin(t * 1.7) + 0.06 * Math.sin(t * 4.3) : 0.85;
        for (let x = x0; x < view.cw; x += tile) ctx.drawImage(L.glow, Math.floor(x), y, tw, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const bottom = y + h;
    if (bottom < view.ch) {
      ctx.fillStyle = L.fill;
      ctx.fillRect(0, Math.max(0, Math.floor(bottom) - 1), view.cw, view.ch - bottom + 2);
    }
  }
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

/** Thumbnail-only: a simple foreground ridge in the biome's ground colours. */
function drawGroundHint(g: CanvasRenderingContext2D, view: ViewInfo, b: BiomeDef): void {
  const p = b.palette;
  const w = view.cw, h = view.ch;
  const base = (b.terrain.base * WORLD_H - view.top) * view.scale;
  const amp = b.terrain.amplitude * 0.45 * view.scale;
  const yAt = (x: number): number =>
    base + amp * (0.55 * Math.sin((x / w) * 5.1 + 0.7) + 0.3 * Math.sin((x / w) * 11.3 + 2.1) + 0.15 * Math.sin((x / w) * 23 + 1));
  const grad = g.createLinearGradient(0, base - amp, 0, h);
  grad.addColorStop(0, p.strata[0]);
  grad.addColorStop(0.45, p.strata[2]);
  grad.addColorStop(1, p.bedrock);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) g.lineTo(x, yAt(x));
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  const sd = Math.max(2, b.terrain.surfaceDepth * view.scale * 1.4);
  const edge = (lw: number, col: string): void => {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = yAt(x) + lw / 2;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  edge(sd, p.surface);
  edge(Math.max(1, sd * 0.2), p.rim);
}
