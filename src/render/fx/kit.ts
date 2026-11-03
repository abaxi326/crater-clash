/**
 * Shared spawning toolkit for explosions, events, hazards and ambient effects. Holds the particle
 * pool, the effect pool, cached sprite ids, quality scaling and a tiny scheduler for multi-stage
 * effects.
 */
import { BIOMES, type BiomeId } from '../../core/biomes.ts';
import { hexToRgb, mixHex } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';
import type { FxHooks } from '../../contracts.ts';
import type { Terrain } from '../../sim/terrain.ts';
import {
  LAYER_BACK, P_DEBRIS, P_DUST, P_EMBER, P_FIRE, P_GLOW, P_SHARD, P_SMOKE, P_SPARK, P_STAR, F_SMOKE_TAIL, Particles,
} from '../particles.ts';
import { dotSprite, glowSprite, puffSprite, ringSprite, shardSprite, starSprite, streakSprite } from '../sprites.ts';
import { E_FLASH, E_LIGHT, E_RING, EffectPool, type Effect } from './effects.ts';

interface Scheduled { at: number; fn: () => void }

const rand = Math.random;
const rr = (a: number, b: number): number => a + (b - a) * rand();

export class Kit {
  readonly p: Particles;
  readonly fx = new EffectPool();
  readonly hooks: FxHooks;
  terrain: Terrain | null = null;
  biome: BiomeId = 'verdant';
  /** Spawn-count multiplier from quality (and reduced motion). */
  scale = 1;
  reducedMotion = false;
  /** Local clock for the scheduler (sim time). */
  now = 0;
  private queue: Scheduled[] = [];

  // Cached sprite ids.
  readonly smokeDark: Int32Array;
  readonly smokeLight: Int32Array;
  dust: Int32Array = new Int32Array(4);
  dustColor = '#c8b48f';
  readonly glowWhite = glowSprite('#fff6e0', 0.8);
  readonly glowOrange = glowSprite('#ff8a2a', 0.5);
  readonly ringWhite = ringSprite('#fff4dc');
  readonly sparkGold = streakSprite('#ffb54a');
  readonly emberOrange = dotSprite('#ff7a1a');

  constructor(hooks: FxHooks, capacity: number) {
    this.hooks = hooks;
    this.p = new Particles(capacity);
    this.smokeDark = new Int32Array(4);
    this.smokeLight = new Int32Array(4);
    for (let i = 0; i < 4; i++) {
      this.smokeDark[i] = puffSprite('#3d3634', i);
      this.smokeLight[i] = puffSprite('#9a928c', i);
    }
    this.setBiome('verdant');
  }

  setBiome(biome: BiomeId): void {
    this.biome = biome;
    const pal = BIOMES[biome].palette;
    // Soil-coloured, lifted toward a warm grey so it reads as airborne dust rather than ground.
    const base = mixHex(pal.strata[0], pal.surface, 0.25);
    const [r, g, b] = hexToRgb(base);
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    this.dustColor = mixHex(base, '#d6c6ad', lum < 0.3 ? 0.18 : 0.4);
    for (let i = 0; i < 4; i++) this.dust[i] = puffSprite(this.dustColor, i);
    this.p.dustSpr = this.dust[0];
  }

  /** Scaled particle count (at least `min`). */
  n(base: number, min = 1): number {
    const v = base * this.scale;
    const f = Math.floor(v);
    return Math.max(min, f + (rand() < v - f ? 1 : 0));
  }

  later(delay: number, fn: () => void): void {
    if (delay <= 0) fn();
    else this.queue.push({ at: this.now + delay, fn });
  }

  tick(dt: number): void {
    this.now += dt;
    const q = this.queue;
    for (let i = 0; i < q.length; i++) {
      if (q[i].at <= this.now) {
        const job = q[i];
        q[i] = q[q.length - 1];
        q.pop();
        i--;
        job.fn();
      }
    }
  }

  clear(): void {
    this.queue.length = 0;
    this.p.clear();
    this.fx.clear();
  }

  // --- Camera / post hooks (suppressed under reduced motion) ---------------------------
  shake(t: number): void { if (!this.reducedMotion) this.hooks.shake(t); }
  shockwave(x: number, y: number, s: number): void { if (!this.reducedMotion) this.hooks.shockwave(x, y, s); }
  chroma(a: number): void { if (!this.reducedMotion) this.hooks.chroma(a); }
  flashScreen(color: string, i: number): void { if (!this.reducedMotion) this.hooks.flash(color, i); }
  hitStop(s: number): void { if (!this.reducedMotion) this.hooks.hitStop(s); }

  // --- Building blocks ------------------------------------------------------------------

  /** Additive glow flash disc. */
  flash(x: number, y: number, r: number, spr: number, life = 0.18, a = 1): Effect {
    const e = this.fx.add(E_FLASH, x, y, life);
    e.r = r; e.spr = spr; e.a = this.reducedMotion ? a * 0.5 : a;
    return e;
  }

  /**
   * Normal-blend colour wash under an additive flash: additive colour saturates to white over bright
   * skies, this keeps the hue readable everywhere.
   */
  tint(x: number, y: number, r: number, color: string, life: number, a = 0.5): Effect {
    const e = this.fx.add(E_FLASH, x, y, life);
    e.r = r; e.spr = glowSprite(color, 0); e.a = a; e.normal = true;
    return e;
  }

  ring(x: number, y: number, r0: number, r1: number, spr: number, life: number, a = 1): Effect {
    const e = this.fx.add(E_RING, x, y, life);
    e.r = r0; e.r2 = r1; e.spr = spr; e.a = a;
    return e;
  }

  light(x: number, y: number, r: number, color: string, i: number, life: number): Effect {
    const e = this.fx.add(E_LIGHT, x, y, life);
    e.lightR = r; e.lightI = i; e.lightColor = color;
    return e;
  }

  sparks(x: number, y: number, count: number, sMin: number, sMax: number, spr: number, life = 0.5, size = 3,
    dir = -Math.PI / 2, spread = Math.PI): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const a = dir + (rand() * 2 - 1) * spread;
      const sp = rr(sMin, sMax);
      const i = this.p.spawn(P_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * rr(0.5, 1.2), size * rr(0.7, 1.2), spr);
      if (i < 0) return;
    }
  }

  embers(x: number, y: number, count: number, speed: number, spr: number, life = 1.4, size = 5, spread = 1): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const sp = speed * rr(0.3, 1);
      const i = this.p.spawn(P_EMBER, x + rr(-spread, spread), y + rr(-spread, spread),
        Math.cos(a) * sp, Math.sin(a) * sp - speed * 0.4, life * rr(0.5, 1.2), size * rr(0.6, 1.3), spr);
      if (i < 0) return;
    }
  }

  /** Smoke billows; `rise` = initial upward speed. */
  smoke(x: number, y: number, count: number, spread: number, size: number, life: number, rise: number, dark = true, alpha = 0.55): void {
    const n = this.n(count);
    const set = dark ? this.smokeDark : this.smokeLight;
    for (let k = 0; k < n; k++) {
      const i = this.p.spawn(P_SMOKE, x + rr(-spread, spread), y + rr(-spread, spread) * 0.6,
        rr(-1, 1) * rise * 0.4, -rise * rr(0.5, 1.1), life * rr(0.7, 1.3), size * rr(0.6, 1), set[k & 3]);
      if (i < 0) return;
      this.p.s1[i] = this.p.s0[i] * rr(2, 2.8);
      this.p.alpha[i] = alpha * (this.reducedMotion ? 0.7 : 1);
    }
  }

  dustPuff(x: number, y: number, count: number, spread: number, size: number, life: number, vx = 0, vy = -12, back = false): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const i = this.p.spawn(P_DUST, x + rr(-spread, spread), y + rr(-3, 2), vx * rr(0.5, 1.2) + rr(-10, 10), vy * rr(0.5, 1.2),
        life * rr(0.7, 1.2), size * rr(0.6, 1), this.dust[k & 3]);
      if (i < 0) return;
      this.p.s1[i] = this.p.s0[i] * rr(1.8, 2.6);
      this.p.alpha[i] = 0.45;
      if (back) this.p.layer[i] = LAYER_BACK;
    }
  }

  /** Dust rolling outward along the ground in both directions. */
  dustRing(x: number, y: number, reach: number, count: number, size: number): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const dir = k & 1 ? 1 : -1;
      const sp = reach * rr(1.1, 2.2);
      // Start at the crater rim (searching from above so we find the lip, not the crater floor).
      const gx = x + dir * reach * rr(0.7, 1.1);
      const gy = this.groundY(gx, y - reach * 0.8) - 2;
      const i = this.p.spawn(P_DUST, gx, gy, dir * sp, rr(-30, -5), rr(0.8, 1.5), size * rr(0.5, 1), this.dust[k & 3]);
      if (i < 0) return;
      this.p.drag[i] = 2.8;
      this.p.s1[i] = this.p.s0[i] * rr(2, 3);
      this.p.alpha[i] = 0.62;
    }
  }

  fire(x: number, y: number, count: number, spread: number, size: number, life: number, speed: number, tail = true): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const sp = speed * rr(0.2, 1);
      const i = this.p.spawn(P_FIRE, x + rr(-spread, spread), y + rr(-spread, spread),
        Math.cos(a) * sp, Math.sin(a) * sp - speed * 0.25, life * rr(0.6, 1.2), size * rr(0.5, 0.9), 0);
      if (i < 0) return;
      this.p.s1[i] = this.p.s0[i] * rr(1.3, 2);
      if (tail && rand() < 0.45) this.p.flags[i] |= F_SMOKE_TAIL;
    }
  }

  /** Terrain-coloured chunks sampled around the crater edge. */
  debris(x: number, y: number, radius: number, count: number, speed: number, size = 4): void {
    const n = this.n(count);
    const fallback = BIOMES[this.biome].palette.strata[0];
    const fb = this.packHex(fallback);
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const d = radius * rr(0.85, 1.25);
      let col = this.terrain ? this.terrain.colorAt(x + Math.cos(a) * d, y + Math.sin(a) * d) : 0;
      if (col >>> 24 < 128) col = fb;
      // Mostly upward, fanned.
      const up = -Math.PI / 2 + (rand() * 2 - 1) * 1.25;
      const sp = speed * rr(0.35, 1.1);
      const i = this.p.spawn(P_DEBRIS, x + Math.cos(a) * radius * 0.5, y + Math.sin(a) * radius * 0.4,
        Math.cos(up) * sp, Math.sin(up) * sp, rr(1.4, 2.6), size * rr(0.5, 1.4), col);
      if (i < 0) return;
    }
  }

  glow(x: number, y: number, size0: number, size1: number, spr: number, life: number, vx = 0, vy = 0, alpha = 1): number {
    const i = this.p.spawn(P_GLOW, x, y, vx, vy, life, size0, spr);
    if (i >= 0) { this.p.s1[i] = size1; this.p.alpha[i] = alpha; }
    return i;
  }

  stars(x: number, y: number, count: number, speed: number, spr: number, life: number, size: number): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const sp = speed * rr(0.3, 1);
      if (this.p.spawn(P_STAR, x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * rr(0.6, 1.2), size * rr(0.6, 1.2), spr) < 0) return;
    }
  }

  shards(x: number, y: number, count: number, speed: number, color: string, life: number, size: number): void {
    const n = this.n(count);
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const sp = speed * rr(0.4, 1);
      if (this.p.spawn(P_SHARD, x, y, Math.cos(a) * sp, Math.sin(a) * sp - speed * 0.3, life * rr(0.6, 1.2), size * rr(0.6, 1.3),
        shardSprite(color, k & 3)) < 0) return;
    }
  }

  emberSpr(hex: string): number { return dotSprite(hex); }
  sparkSpr(hex: string): number { return streakSprite(hex); }
  glowSpr(hex: string, hot = 0.6): number { return glowSprite(hex, hot); }
  starSpr(hex: string): number { return starSprite(hex); }
  ringSpr(hex: string): number { return ringSprite(hex); }

  /** Ground height under x (from the given y upward search), or y when no terrain. */
  groundY(x: number, y: number): number {
    const t = this.terrain;
    if (!t) return y;
    if (t.isSolid(x, y)) {
      let gy = y;
      while (gy > 0 && t.isSolid(x, gy - 1) && y - gy < 120) gy--;
      return gy;
    }
    const s = t.surfaceY(x, y);
    return s - y < 160 ? s : y;
  }

  private packCache = new Map<string, number>();
  packHex(hex: string): number {
    let v = this.packCache.get(hex);
    if (v === undefined) {
      const h = hex.slice(1);
      const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
      v = ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
      this.packCache.set(hex, v);
    }
    return v;
  }

  // Shared particle kinds re-exported for convenience.
  static readonly K = { P_SPARK, P_EMBER, P_SMOKE, P_FIRE, P_DEBRIS, P_DUST, P_GLOW, P_SHARD, P_STAR } as const;
}

export { rr, rand };
