/**
 * Living sky details: star field with twinkles, shooting stars, bird flocks, the volcano's smoke plume
 * and spark spurts, blinking outpost beacons. Pools are fixed-size; nothing allocates per frame.
 */
import type { ViewInfo } from '../../contracts.ts';
import type { BiomeDef } from '../../core/biomes.ts';
import { mixHex, rgba } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';
import type { Layer, Mark } from './layers.ts';
import { PERIOD, ctx2d, glowSprite, makeCanvas, mulberry, project, type Proj } from './util.ts';

const STAR_DEPTH = 0.02;
const STAR_W = 1600;
const STAR_Y0 = -700;
const STAR_H = 1300;
const TWINKLES = 56;
const SMOKE = 90;
const SPARKS = 40;
const BIRDS = 11;
const BIRD_DEPTH = 0.4;

interface StarField {
  canvas: HTMLCanvasElement;
  /** Overall field opacity (dusk skies show few). */
  alpha: number;
}

export class Ambient {
  private b: BiomeDef | null = null;
  private layers: Layer[] = [];
  private stars: StarField | null = null;
  private starCache = new Map<string, StarField | null>();
  private readonly glint = starGlint();
  private readonly streak = streakSprite();
  private readonly beaconRed = glowSprite(64, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,120,110,0.9)'], [0.4, 'rgba(255,60,60,0.25)'], [1, 'rgba(255,40,40,0)']]);
  private craterGlow: HTMLCanvasElement = this.beaconRed;
  private smokeSprites: HTMLCanvasElement[] = [];
  private sparkSprite: HTMLCanvasElement = this.beaconRed;
  private time = 0;
  private wind = 0;
  private rnd = mulberry(1);

  // Twinkling stars (layer space, star depth).
  private readonly twX = new Float32Array(TWINKLES);
  private readonly twY = new Float32Array(TWINKLES);
  private readonly twPhase = new Float32Array(TWINKLES);
  private readonly twSpeed = new Float32Array(TWINKLES);
  private readonly twSize = new Float32Array(TWINKLES);
  private twCount = 0;

  // Shooting star.
  private shootT = -1;
  private shootNext = 4;
  private shootX = 0;
  private shootY = 0;
  private shootA = 0;
  private shootLen = 0;

  // Smoke plume and spark spurts (cinder): layer space of the far layer.
  private readonly smX = new Float32Array(SMOKE);
  private readonly smY = new Float32Array(SMOKE);
  private readonly smAge = new Float32Array(SMOKE);
  private readonly smLife = new Float32Array(SMOKE);
  private readonly smR = new Float32Array(SMOKE);
  private readonly smVx = new Float32Array(SMOKE);
  private smokeEmit = 0;
  private readonly spX = new Float32Array(SPARKS);
  private readonly spY = new Float32Array(SPARKS);
  private readonly spVx = new Float32Array(SPARKS);
  private readonly spVy = new Float32Array(SPARKS);
  private readonly spAge = new Float32Array(SPARKS);
  private spurtNext = 3;
  private crater: Mark | null = null;

  // Bird flock (layer space at BIRD_DEPTH).
  private birdsOn = false;
  private flockT = -1;
  private flockNext = 4;
  private flockX = 0;
  private flockY = 0;
  private flockDir = 1;
  private flockN = 0;
  private readonly bdX = new Float32Array(BIRDS);
  private readonly bdY = new Float32Array(BIRDS);
  private readonly bdPhase = new Float32Array(BIRDS);
  private birdColor = '#000';

  setBiome(b: BiomeDef, layers: Layer[], seed: number): void {
    this.b = b;
    this.layers = layers;
    this.rnd = mulberry(seed ^ 0x5bd1e995);
    const key = b.id;
    if (!this.starCache.has(key)) this.starCache.set(key, buildStars(b));
    this.stars = this.starCache.get(key) ?? null;
    const r = this.rnd;
    this.twCount = this.stars ? (b.id === 'dunes' ? 14 : b.id === 'cinder' ? 26 : TWINKLES) : 0;
    for (let i = 0; i < this.twCount; i++) {
      this.twX[i] = r() * STAR_W;
      this.twY[i] = STAR_Y0 + r() * (b.id === 'dunes' ? 600 : 1050);
      this.twPhase[i] = r() * TAU;
      this.twSpeed[i] = 0.6 + r() * 2.2;
      this.twSize[i] = 5 + r() * 9;
    }
    this.shootT = -1;
    this.shootNext = 2 + r() * 4;
    this.crater = null;
    for (const L of layers) for (const m of L.marks) if (m.kind === 'crater') this.crater = m;
    this.smAge.fill(1e9);
    this.spAge.fill(1e9);
    this.smokeEmit = 0;
    if (b.id === 'cinder') {
      this.craterGlow = glowSprite(128, [[0, rgba('#ffe0a0', 0.9)], [0.2, rgba(b.palette.accent, 0.55)], [0.55, rgba(b.palette.celestialGlow, 0.15)], [1, rgba(b.palette.celestialGlow, 0)]]);
      const sc = mixHex(b.palette.far[2], '#141012', 0.5);
      this.smokeSprites = [smokeSprite(sc, b.palette.accent, 11), smokeSprite(sc, b.palette.accent, 23), smokeSprite(sc, b.palette.accent, 37)];
      this.sparkSprite = glowSprite(16, [[0, 'rgba(255,240,200,1)'], [0.35, rgba(b.palette.accent, 0.8)], [1, rgba(b.palette.accent, 0)]]);
      // Pre-warm the plume so it is already towering when the round starts.
      for (let i = 0; i < 150; i++) this.updateSmoke(0.1);
    }
    this.birdsOn = b.id === 'verdant' || b.id === 'dunes';
    this.birdColor = b.id === 'dunes' ? mixHex(b.palette.far[2], '#1a0f1e', 0.5) : mixHex(b.palette.far[2], '#1c2e2a', 0.55);
    this.flockT = -1;
    this.flockNext = 3 + r() * 5;
  }

  update(dt: number, wind: number, time: number): void {
    if (!this.b) return;
    this.time = time;
    this.wind = wind;
    const r = this.rnd;
    // Shooting stars: frequent on the Moon, rare elsewhere at night.
    if (this.stars && this.b.id !== 'dunes') {
      if (this.shootT >= 0) {
        this.shootT += dt;
        if (this.shootT > 1.1) this.shootT = -1;
      } else if ((this.shootNext -= dt) <= 0) {
        this.shootT = 0;
        this.shootNext = this.b.id === 'lunar' ? 3 + r() * 7 : 10 + r() * 14;
        this.shootX = r() * 1900;
        this.shootY = -350 + r() * 500;
        this.shootA = (r() < 0.5 ? 0.35 : Math.PI - 0.35) + (r() - 0.5) * 0.4;
        this.shootLen = 160 + r() * 140;
      }
    }
    if (this.crater) this.updateSmoke(dt);
    if (this.birdsOn) this.updateBirds(dt);
  }

  private updateSmoke(dt: number): void {
    const m = this.crater;
    if (!m) return;
    const r = this.rnd;
    this.smokeEmit -= dt;
    if (this.smokeEmit <= 0) {
      this.smokeEmit = 0.16 + r() * 0.14;
      for (let i = 0; i < SMOKE; i++) {
        if (this.smAge[i] < this.smLife[i]) continue;
        this.smX[i] = m.x + (r() - 0.5) * m.p * 0.8;
        this.smY[i] = m.y - 6;
        this.smAge[i] = 0;
        this.smLife[i] = 13 + r() * 6;
        this.smR[i] = 16 + r() * 16;
        this.smVx[i] = (r() - 0.5) * 9;
        break;
      }
    }
    const drift = 4 + this.wind * 3.5;
    for (let i = 0; i < SMOKE; i++) {
      if (this.smAge[i] >= this.smLife[i]) continue;
      const k = this.smAge[i] / this.smLife[i];
      this.smAge[i] += dt;
      this.smVx[i] += (this.rnd() - 0.5) * 30 * dt; // turbulent lateral wander
      this.smX[i] += (this.smVx[i] + drift * Math.min(1, k * 2.2)) * dt;
      this.smY[i] -= (30 - 18 * k) * dt;
      this.smR[i] += (5 + 10 * (1 - k)) * dt;
    }
    // Spark spurts from the crater every few seconds.
    if ((this.spurtNext -= dt) <= 0) {
      this.spurtNext = 2.5 + r() * 4;
      let n = 8 + Math.floor(r() * 10);
      for (let i = 0; i < SPARKS && n > 0; i++) {
        if (this.spAge[i] < 2.2) continue;
        this.spX[i] = m.x + (r() - 0.5) * m.p * 0.6;
        this.spY[i] = m.y;
        this.spVx[i] = (r() - 0.5) * 70;
        this.spVy[i] = -(60 + r() * 90);
        this.spAge[i] = 0;
        n--;
      }
    }
    for (let i = 0; i < SPARKS; i++) {
      if (this.spAge[i] >= 2.2) continue;
      this.spAge[i] += dt;
      this.spVy[i] += 70 * dt;
      this.spX[i] += this.spVx[i] * dt;
      this.spY[i] += this.spVy[i] * dt;
    }
  }

  private updateBirds(dt: number): void {
    const r = this.rnd;
    if (this.flockT < 0) {
      if ((this.flockNext -= dt) > 0) return;
      this.flockT = 0;
      this.flockDir = r() < 0.5 ? 1 : -1;
      this.flockX = this.flockDir > 0 ? -900 : 2900;
      this.flockY = 150 + r() * 260;
      this.flockN = 4 + Math.floor(r() * (BIRDS - 4));
      for (let i = 0; i < this.flockN; i++) {
        // Loose V formation.
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        this.bdX[i] = -row * 22 * this.flockDir + (r() - 0.5) * 8;
        this.bdY[i] = row * 11 * side + (r() - 0.5) * 6;
        this.bdPhase[i] = r() * TAU;
      }
      return;
    }
    this.flockT += dt;
    this.flockX += this.flockDir * (70 + this.wind * 3 * this.flockDir) * dt;
    this.flockY += Math.sin(this.flockT * 0.6) * 4 * dt;
    if (this.flockX < -1200 || this.flockX > 3200) {
      this.flockT = -1;
      this.flockNext = 12 + r() * 18;
    }
  }

  /** Behind the celestial bodies: stars, twinkles, shooting star. */
  drawSky(ctx: CanvasRenderingContext2D, view: ViewInfo, p: Proj): void {
    const st = this.stars;
    if (!st) return;
    project(view, STAR_DEPTH, p);
    const tile = STAR_W * p.s;
    const y = p.oy + STAR_Y0 * p.s;
    const h = STAR_H * p.s;
    const x0 = p.ox - Math.ceil(p.ox / tile) * tile;
    ctx.globalAlpha = st.alpha;
    for (let x = x0; x < view.cw; x += tile) ctx.drawImage(st.canvas, Math.floor(x), y, Math.ceil(tile) + 1, h);
    ctx.globalCompositeOperation = 'lighter';
    const t = this.time;
    for (let i = 0; i < this.twCount; i++) {
      const tw = 0.5 + 0.5 * Math.sin(t * this.twSpeed[i] + this.twPhase[i]);
      const a = 0.25 + 0.75 * tw * tw;
      const s = this.twSize[i] * p.s * (0.7 + 0.3 * tw);
      let sx = p.ox + this.twX[i] * p.s;
      sx -= Math.floor(sx / tile) * tile;
      const sy = p.oy + this.twY[i] * p.s;
      ctx.globalAlpha = a * st.alpha;
      for (let x = sx - tile; x < view.cw + s; x += tile) ctx.drawImage(this.glint, x - s / 2, sy - s / 2, s, s);
    }
    if (this.shootT >= 0) {
      const k = this.shootT / 1.1;
      const len = this.shootLen * p.s * Math.min(1, k * 3);
      const dist = this.shootLen * 2.2 * k;
      const hx = p.ox + (this.shootX + Math.cos(this.shootA) * dist) * p.s;
      const hy = p.oy + (this.shootY + Math.sin(this.shootA) * dist) * p.s;
      const cs = Math.cos(this.shootA), sn = Math.sin(this.shootA);
      ctx.globalAlpha = Math.sin(k * Math.PI);
      ctx.setTransform(cs, sn, -sn, cs, hx, hy);
      ctx.drawImage(this.streak, -len, -3 * p.s, len, 6 * p.s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Details anchored to a silhouette layer, drawn right after it. */
  drawAfterLayer(ctx: CanvasRenderingContext2D, view: ViewInfo, li: number, p: Proj): void {
    const L = this.layers[li];
    if (!L) return;
    if (li === 0 && this.crater) this.drawVolcano(ctx, view, L, p);
    if (L.marks.length) this.drawBeacons(ctx, view, L, p);
    if (li === 1 && this.birdsOn && this.flockT >= 0) this.drawBirds(ctx, view, p);
  }

  private drawVolcano(ctx: CanvasRenderingContext2D, view: ViewInfo, L: Layer, p: Proj): void {
    const m = this.crater!;
    project(view, L.depth, p);
    const tile = PERIOD_X * p.s;
    let base = p.ox + m.x * p.s;
    base -= Math.floor(base / tile) * tile; // crater copy in [0, tile)
    const t = this.time;
    for (let off = base - tile; off < view.cw + tile; off += tile) {
      const dx = off - (p.ox + m.x * p.s); // copy offset in px
      if (off < -900 * p.s || off > view.cw + 900 * p.s) continue;
      // Smoke (normal blend), oldest first so the fresh, lit puffs sit on top.
      for (let i = 0; i < SMOKE; i++) {
        const age = this.smAge[i], life = this.smLife[i];
        if (age >= life) continue;
        const k = age / life;
        const a = Math.min(1, age * 0.45) * (1 - k * k) * 0.62;
        const r = this.smR[i] * p.s;
        ctx.globalAlpha = a;
        ctx.drawImage(this.smokeSprites[i % 3], p.ox + this.smX[i] * p.s + dx - r, p.oy + this.smY[i] * p.s - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.75 + 0.15 * Math.sin(t * 1.9) + 0.1 * Math.sin(t * 5.3 + 1);
      const gr = m.p * 3.2 * p.s * (0.95 + 0.08 * pulse);
      ctx.globalAlpha = pulse;
      ctx.drawImage(this.craterGlow, off - gr, p.oy + m.y * p.s - gr * 0.8, gr * 2, gr * 2);
      for (let i = 0; i < SPARKS; i++) {
        const age = this.spAge[i];
        if (age >= 2.2) continue;
        const s = 7 * p.s;
        ctx.globalAlpha = 1 - age / 2.2;
        ctx.drawImage(this.sparkSprite, p.ox + this.spX[i] * p.s + dx - s / 2, p.oy + this.spY[i] * p.s - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  private drawBeacons(ctx: CanvasRenderingContext2D, view: ViewInfo, L: Layer, p: Proj): void {
    project(view, L.depth, p);
    const tile = PERIOD_X * p.s;
    ctx.globalCompositeOperation = 'lighter';
    for (const m of L.marks) {
      if (m.kind !== 'beacon') continue;
      // Sharp double blink every ~2.4 s.
      const ph = ((this.time * 0.42 + m.p) % 1 + 1) % 1;
      const on = ph < 0.06 ? 1 : ph > 0.14 && ph < 0.2 ? 0.8 : 0.08;
      const s = (on > 0.5 ? 26 : 12) * p.s;
      let x = p.ox + m.x * p.s;
      x -= Math.floor(x / tile) * tile;
      ctx.globalAlpha = on;
      for (let xx = x - tile; xx < view.cw + s; xx += tile) ctx.drawImage(this.beaconRed, xx - s / 2, p.oy + m.y * p.s - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBirds(ctx: CanvasRenderingContext2D, view: ViewInfo, p: Proj): void {
    project(view, BIRD_DEPTH, p);
    const t = this.flockT;
    ctx.strokeStyle = this.birdColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, 1.6 * p.s);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < this.flockN; i++) {
      const flap = Math.sin(t * 9 + this.bdPhase[i]);
      const x = p.ox + (this.flockX + this.bdX[i] + Math.sin(t * 0.8 + i) * 4) * p.s;
      const y = p.oy + (this.flockY + this.bdY[i] + Math.sin(t * 1.3 + i * 2) * 3 - flap * 1.2) * p.s;
      if (x < -20 || x > view.cw + 20) continue;
      const span = 7 * p.s, lift = flap * 4.5 * p.s;
      ctx.moveTo(x - span, y - lift);
      ctx.quadraticCurveTo(x - span * 0.45, y - lift * 0.2 - 1.5 * p.s, x, y);
      ctx.quadraticCurveTo(x + span * 0.45, y - lift * 0.2 - 1.5 * p.s, x + span, y - lift);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const PERIOD_X = PERIOD;

function starGlint(): HTMLCanvasElement {
  const s = 32, c = makeCanvas(s, s), g = ctx2d(c), h = s / 2;
  const core = g.createRadialGradient(h, h, 0, h, h, h * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.3, 'rgba(210,225,255,0.6)');
  core.addColorStop(1, 'rgba(180,200,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  // Thin diffraction cross.
  const lg = g.createLinearGradient(0, 0, s, 0);
  lg.addColorStop(0, 'rgba(200,220,255,0)');
  lg.addColorStop(0.5, 'rgba(235,242,255,0.9)');
  lg.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = lg;
  g.fillRect(0, h - 0.5, s, 1);
  g.save();
  g.translate(h, h);
  g.rotate(Math.PI / 2);
  g.translate(-h, -h);
  g.fillRect(0, h - 0.5, s, 1);
  g.restore();
  return c;
}

function streakSprite(): HTMLCanvasElement {
  const c = makeCanvas(256, 8), g = ctx2d(c);
  const lg = g.createLinearGradient(0, 0, 256, 0);
  lg.addColorStop(0, 'rgba(160,200,255,0)');
  lg.addColorStop(0.85, 'rgba(210,230,255,0.75)');
  lg.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = lg;
  g.beginPath();
  g.moveTo(0, 4);
  g.lineTo(250, 2.2);
  g.arc(250, 4, 1.8, -Math.PI / 2, Math.PI / 2);
  g.closePath();
  g.fill();
  return c;
}

/** Lumpy smoke billow: several soft sub-blobs, underside tinted by the crater glow. */
function smokeSprite(col: string, lit: string, seed: number): HTMLCanvasElement {
  const s = 128, c = makeCanvas(s, s), g = ctx2d(c), h = s / 2;
  const r = mulberry(seed);
  for (let k = 0; k < 7; k++) {
    const a = r() * TAU, d = r() * h * 0.38;
    const bx = h + Math.cos(a) * d, by = h + Math.sin(a) * d * 0.8;
    const br = h * (0.35 + r() * 0.3);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, br);
    rg.addColorStop(0, rgba(col, 0.55));
    rg.addColorStop(0.6, rgba(col, 0.3));
    rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
  }
  g.globalCompositeOperation = 'source-atop';
  const hl = g.createLinearGradient(0, h * 0.2, 0, h * 0.8);
  hl.addColorStop(0, 'rgba(255,190,160,0.10)');
  hl.addColorStop(1, 'rgba(255,190,160,0)');
  g.fillStyle = hl;
  g.fillRect(0, 0, s, s);
  const lg = g.createLinearGradient(0, h * 0.7, 0, s);
  lg.addColorStop(0, rgba(lit, 0));
  lg.addColorStop(1, rgba(lit, 0.3));
  g.fillStyle = lg;
  g.fillRect(0, 0, s, s);
  return c;
}

/** Static star field (layer space STAR_W × STAR_H) fading toward the horizon. */
function buildStars(b: BiomeDef): StarField | null {
  const density = b.id === 'lunar' ? 1 : b.id === 'cinder' ? 0.22 : b.id === 'dunes' ? 0.22 : 0;
  if (!density) return null;
  const res = 0.8;
  const c = makeCanvas(STAR_W * res, STAR_H * res);
  const g = ctx2d(c);
  const r = mulberry(b.id.length * 7919 + 17);
  const n = Math.round(2400 * density);
  for (let i = 0; i < n; i++) {
    const x = r() * c.width, yN = r();
    const y = yN * c.height;
    const fade = b.id === 'dunes' ? Math.max(0, 1 - yN * 2.2) : Math.max(0, 1 - Math.max(0, yN - 0.55) * 2.4);
    const m = r();
    const size = m > 0.985 ? 2.2 : m > 0.9 ? 1.5 : 1;
    const tint = r();
    const col = tint < 0.15 ? '255,214,180' : tint < 0.35 ? '190,210,255' : '255,255,255';
    g.fillStyle = `rgba(${col},${((0.25 + r() * 0.75) * fade).toFixed(3)})`;
    g.fillRect(x, y, size * res, size * res);
  }
  if (b.id === 'lunar') {
    // A faint milky band across the sky.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 260; i++) {
      const t = r();
      const x = t * c.width, y = c.height * (0.26 + 0.1 * Math.sin(t * TAU)) + (r() - 0.5) * 120 * res;
      const rr = (20 + r() * 60) * res;
      const rg = g.createRadialGradient(x, y, 0, x, y, rr);
      rg.addColorStop(0, `rgba(120,140,220,${(0.03 + r() * 0.03).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(120,140,220,0)');
      g.fillStyle = rg;
      for (const ox of [-c.width, 0, c.width]) { g.save(); g.translate(ox, 0); g.fillRect(x - rr, y - rr, rr * 2, rr * 2); g.restore(); }
    }
  }
  return { canvas: c, alpha: b.id === 'dunes' ? 0.7 : 1 };
}
