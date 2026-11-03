/**
 * Pooled particle system. Struct-of-arrays typed storage with a fixed capacity per quality tier,
 * swap-remove on death (no holes, no allocation), terrain-aware debris, and two draw passes per
 * layer (normal blend, then additive 'lighter'). Sprites are pre-rendered (sprites.ts).
 */
import type { Terrain } from '../sim/terrain.ts';
import { fireRamp, FIRE_STEPS, packedToCss, puffSprite, sprite } from './sprites.ts';

// Particle kinds (plain numeric constants: no enums under erasableSyntaxOnly).
export const P_SPARK = 0;
export const P_EMBER = 1;
export const P_SMOKE = 2;
export const P_FIRE = 3;
export const P_DEBRIS = 4;
export const P_DUST = 5;
export const P_GLOW = 6;
export const P_SHARD = 7;
export const P_STAR = 8;

/** Blend per kind: 1 = additive. */
const ADDITIVE = new Uint8Array([1, 1, 0, 1, 0, 0, 1, 0, 1]);
/** Kinds that need a rotated transform (others are drawn with a plain drawImage, which is cheaper). */
const ROTATED = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 1, 0]);
/** Low-priority kinds are thinned first when the pool is nearly full. */
const LOW_PRIORITY = new Uint8Array([0, 1, 1, 0, 0, 1, 0, 0, 1]);

/** Layer: drawn in front of tanks (default) or behind them. */
export const LAYER_FRONT = 0;
export const LAYER_BACK = 1;

const F_BOUNCED = 1;
/** Fire that turns into a smoke puff when it burns out. */
export const F_SMOKE_TAIL = 2;
/** Debris that leaves a tiny dust puff on its bounce. */
export const F_DUST_ON_BOUNCE = 4;
/** Sparks that may bounce on terrain. */
export const F_BOUNCE = 8;
/** Additive particle that also paints a normal-blend colour body (keeps hue over bright skies). */
export const F_BODY = 16;

/** Wind acceleration on drifting particles, px/s² per wind unit. */
const WIND_DRIFT = 5.5;

export class Particles {
  capacity = 0;
  count = 0;
  x!: Float32Array; y!: Float32Array; vx!: Float32Array; vy!: Float32Array;
  age!: Float32Array; life!: Float32Array;
  s0!: Float32Array; s1!: Float32Array;
  rot!: Float32Array; vrot!: Float32Array;
  drag!: Float32Array; grav!: Float32Array; wind!: Float32Array;
  alpha!: Float32Array; seed!: Float32Array;
  /** Sprite id, or packed terrain colour for debris. */
  spr!: Int32Array;
  kind!: Uint8Array; layer!: Uint8Array; flags!: Uint8Array;
  /** While true, additive spawns get F_BODY (set around colourful effects by the spawner). */
  bodyMode = false;
  /** Dropped spawn requests since the last reset (diagnostics). */
  dropped = 0;

  private smokeTail: Int32Array;
  private fire: Int32Array;

  constructor(capacity: number) {
    this.resize(capacity);
    this.fire = fireRamp();
    this.smokeTail = new Int32Array(4);
    for (let i = 0; i < 4; i++) this.smokeTail[i] = puffSprite('#4a423f', i);
  }

  /** Changes capacity, keeping as many live particles as fit. */
  resize(capacity: number): void {
    const keep = Math.min(this.count, capacity);
    const f32 = (old: Float32Array | undefined): Float32Array => {
      const a = new Float32Array(capacity);
      if (old) a.set(old.subarray(0, keep));
      return a;
    };
    const i32 = (old: Int32Array | undefined): Int32Array => {
      const a = new Int32Array(capacity);
      if (old) a.set(old.subarray(0, keep));
      return a;
    };
    const u8 = (old: Uint8Array | undefined): Uint8Array => {
      const a = new Uint8Array(capacity);
      if (old) a.set(old.subarray(0, keep));
      return a;
    };
    this.x = f32(this.x); this.y = f32(this.y); this.vx = f32(this.vx); this.vy = f32(this.vy);
    this.age = f32(this.age); this.life = f32(this.life);
    this.s0 = f32(this.s0); this.s1 = f32(this.s1);
    this.rot = f32(this.rot); this.vrot = f32(this.vrot);
    this.drag = f32(this.drag); this.grav = f32(this.grav); this.wind = f32(this.wind);
    this.alpha = f32(this.alpha); this.seed = f32(this.seed);
    this.spr = i32(this.spr);
    this.kind = u8(this.kind); this.layer = u8(this.layer); this.flags = u8(this.flags);
    this.capacity = capacity;
    this.count = keep;
  }

  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }

  /**
   * Adds a particle and returns its index (or -1 when the pool is full). Kind defaults are applied;
   * callers tweak the public arrays at the returned index for anything else.
   * Sizes are full sprite diameters in world units.
   */
  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, spr: number): number {
    const n = this.count;
    if (n >= this.capacity) {
      this.dropped++;
      return -1;
    }
    // Graceful thinning: near the cap, ambient/low-priority particles are skipped first.
    if (LOW_PRIORITY[kind] && n > this.capacity * 0.82 && Math.random() < (n / this.capacity - 0.82) * 5.5) {
      this.dropped++;
      return -1;
    }
    this.count = n + 1;
    this.x[n] = x; this.y[n] = y; this.vx[n] = vx; this.vy[n] = vy;
    this.age[n] = 0; this.life[n] = life > 0.01 ? life : 0.01;
    this.s0[n] = size; this.s1[n] = size;
    this.rot[n] = Math.random() * 6.283; this.vrot[n] = 0;
    this.alpha[n] = 1; this.seed[n] = Math.random() * 100;
    this.spr[n] = spr; this.kind[n] = kind; this.layer[n] = LAYER_FRONT; this.flags[n] = 0;
    this.wind[n] = 0;
    switch (kind) {
      case P_SPARK: this.drag[n] = 1.2; this.grav[n] = 0.55; this.flags[n] = F_BOUNCE; break;
      case P_EMBER: this.drag[n] = 1.6; this.grav[n] = -0.06; this.wind[n] = 1; break;
      case P_SMOKE: this.drag[n] = 1.6; this.grav[n] = -0.09; this.wind[n] = 1.4; this.vrot[n] = (Math.random() - 0.5) * 1.2; this.alpha[n] = 0.55; break;
      case P_FIRE: this.drag[n] = 2.6; this.grav[n] = -0.16; this.wind[n] = 0.5; this.vrot[n] = (Math.random() - 0.5) * 2; break;
      case P_DEBRIS: this.drag[n] = 0.35; this.grav[n] = 1; this.vrot[n] = (Math.random() - 0.5) * 18; this.flags[n] = F_DUST_ON_BOUNCE; break;
      case P_DUST: this.drag[n] = 2.4; this.grav[n] = -0.012; this.wind[n] = 1.2; this.vrot[n] = (Math.random() - 0.5) * 0.8; this.alpha[n] = 0.4; break;
      case P_GLOW: this.drag[n] = 2; this.grav[n] = 0; break;
      case P_SHARD: this.drag[n] = 0.6; this.grav[n] = 0.7; this.vrot[n] = (Math.random() - 0.5) * 16; break;
      case P_STAR: this.drag[n] = 1.4; this.grav[n] = 0.18; this.vrot[n] = (Math.random() - 0.5) * 3; break;
    }
    if (this.bodyMode && ADDITIVE[kind]) this.flags[n] |= F_BODY;
    return n;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
    this.age[i] = this.age[last]; this.life[i] = this.life[last];
    this.s0[i] = this.s0[last]; this.s1[i] = this.s1[last];
    this.rot[i] = this.rot[last]; this.vrot[i] = this.vrot[last];
    this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last]; this.wind[i] = this.wind[last];
    this.alpha[i] = this.alpha[last]; this.seed[i] = this.seed[last];
    this.spr[i] = this.spr[last]; this.kind[i] = this.kind[last]; this.layer[i] = this.layer[last]; this.flags[i] = this.flags[last];
  }

  /** Integrates every particle. gravity in px/s², wind in game wind units. */
  update(dt: number, gravity: number, wind: number, terrain: Terrain | null): void {
    if (dt <= 0) return;
    const { x, y, vx, vy, age, life, drag, grav, kind, flags } = this;
    const windAcc = wind * WIND_DRIFT * dt;
    for (let i = 0; i < this.count; i++) {
      const a = age[i] + dt;
      if (a >= life[i]) {
        // Burnt-out fire becomes a smoke puff in place (no extra slot needed).
        if (kind[i] === P_FIRE && flags[i] & F_SMOKE_TAIL) {
          kind[i] = P_SMOKE; flags[i] = 0; age[i] = 0;
          life[i] = 1.2 + Math.random() * 1.2;
          this.s0[i] = this.s1[i] * 0.8; this.s1[i] *= 2.1;
          this.alpha[i] = 0.42; this.grav[i] = -0.07; this.drag[i] = 1.6; this.wind[i] = 1.4;
          this.spr[i] = this.smokeTail[(this.seed[i] | 0) & 3];
          continue;
        }
        this.kill(i--);
        continue;
      }
      age[i] = a;
      const k = 1 / (1 + drag[i] * dt);
      let nvx = (vx[i] + this.wind[i] * windAcc) * k;
      let nvy = (vy[i] + grav[i] * gravity * dt) * k;
      const px = x[i], py = y[i];
      let nx = px + nvx * dt, ny = py + nvy * dt;
      const kd = kind[i];
      if (terrain && (kd === P_DEBRIS || (kd === P_SPARK && flags[i] & F_BOUNCE) || kd === P_SHARD) && nvy > 0 && terrain.isSolid(nx, ny)) {
        if (!(flags[i] & F_BOUNCED)) {
          // One lively bounce, then the chunk settles and fades.
          flags[i] |= F_BOUNCED;
          nvy = -nvy * (kd === P_SPARK ? 0.45 : 0.32);
          nvx *= 0.55;
          this.vrot[i] *= -0.5;
          nx = px; ny = py;
          if (flags[i] & F_DUST_ON_BOUNCE && this.dustSpr >= 0 && Math.random() < 0.5) {
            const j = this.spawn(P_DUST, px, py, nvx * 0.2, -8, 0.7 + Math.random() * 0.4, this.s0[i] * 2.4, this.dustSpr);
            if (j >= 0) { this.s1[j] = this.s0[j] * 2.2; this.alpha[j] = 0.3; }
          }
        } else {
          nvx = 0; nvy = 0; nx = px; ny = py;
          grav[i] = 0; this.vrot[i] = 0;
          if (life[i] - a > 0.9) life[i] = a + 0.9;
        }
      }
      vx[i] = nvx; vy[i] = nvy; x[i] = nx; y[i] = ny;
      this.rot[i] += this.vrot[i] * dt;
    }
  }

  /** Sprite used for the small puffs debris kicks up when it bounces (set by Fx per biome). */
  dustSpr = -1;

  /**
   * Draws one layer: normal-blend kinds first, then additive kinds in a single 'lighter' pass.
   * Expects the world transform on ctx; leaves it restored.
   */
  draw(ctx: CanvasRenderingContext2D, layer: number, minX: number, minY: number, maxX: number, maxY: number): void {
    if (!this.count) return;
    const m = ctx.getTransform();
    const ba = m.a, bb = m.b, bc = m.c, bd = m.d, be = m.e, bf = m.f;
    ctx.save();
    for (let pass = 0; pass < 4; pass++) {
      // Passes: normal/plain, normal/rotated, additive/plain, additive/rotated.
      const want = pass >> 1;
      const rotPass = pass & 1;
      ctx.globalCompositeOperation = want ? 'lighter' : 'source-over';
      if (!rotPass) ctx.setTransform(ba, bb, bc, bd, be, bf);
      for (let i = 0; i < this.count; i++) {
        if (this.layer[i] !== layer) continue;
        const kd = this.kind[i];
        if (ROTATED[kd] !== rotPass) continue;
        // Fire is drawn twice: a normal-blend body (so it keeps its colour over bright skies) and an
        // additive glow on top.
        const body = want === 0 && ADDITIVE[kd] === 1;
        if (ADDITIVE[kd] !== want && !(body && (kd === P_FIRE || this.flags[i] & F_BODY))) continue;
        const px = this.x[i], py = this.y[i];
        if (px < minX || px > maxX || py < minY || py > maxY) continue;
        const t = this.age[i] / this.life[i];
        let al = this.alpha[i];
        let sx = 0, sy = 0, rot = this.rot[i];
        let img = this.spr[i];
        switch (kd) {
          case P_SPARK: {
            const vx = this.vx[i], vy = this.vy[i];
            const sp = Math.sqrt(vx * vx + vy * vy);
            al *= 1 - t * t;
            sy = this.s0[i] * (1 - t * 0.5);
            sx = sy * 2.2 + sp * 0.05;
            rot = Math.atan2(vy, vx);
            break;
          }
          case P_EMBER: {
            const fl = Math.sin(this.seed[i] + this.age[i] * 23) * 0.5 + 0.5;
            al *= (1 - t) * (0.45 + 0.55 * fl);
            sx = sy = this.s0[i] * (1 - t * 0.6) * (0.8 + fl * 0.35);
            rot = 0;
            break;
          }
          case P_SMOKE: case P_DUST: {
            const fin = t < 0.12 ? t / 0.12 : 1;
            const out = 1 - t;
            al *= fin * out * out;
            const e = 1 - (1 - t) * (1 - t);
            sx = sy = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
            break;
          }
          case P_FIRE: {
            let si = (t * FIRE_STEPS) | 0;
            if (si >= FIRE_STEPS) si = FIRE_STEPS - 1;
            img = this.fire[si];
            al *= t < 0.08 ? t / 0.08 : 1 - t * t;
            sx = sy = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
            if (want === 0) {
              // Body: fades in after the white-hot flash, strongest in the orange/red phase.
              al *= t < 0.12 ? t / 0.12 * 0.5 : 0.75;
              sx *= 0.8; sy *= 0.8;
            } else al *= 0.7;
            break;
          }
          case P_DEBRIS: {
            al *= t > 0.7 ? (1 - t) / 0.3 : 1;
            sx = this.s0[i];
            sy = this.s0[i] * 0.72;
            break;
          }
          case P_GLOW: {
            const o = 1 - t;
            al *= o * o;
            sx = sy = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - o * o);
            rot = 0;
            break;
          }
          case P_SHARD: {
            al *= 1 - t * t * t;
            sx = sy = this.s0[i] * (1 - t * 0.4);
            break;
          }
          case P_STAR: {
            const tw = Math.sin(this.seed[i] + this.age[i] * 28) * 0.5 + 0.5;
            al *= (1 - t) * (0.35 + 0.65 * tw);
            sx = sy = this.s0[i] * (0.7 + 0.5 * tw) * (1 - t * 0.3);
            break;
          }
        }
        if (body && kd !== P_FIRE) al *= 0.7;
        if (al <= 0.004) continue;
        ctx.globalAlpha = al > 1 ? 1 : al;
        if (!rotPass) {
          ctx.drawImage(sprite(img), px - sx * 0.5, py - sy * 0.5, sx, sy);
          continue;
        }
        // Composite transform: base · translate(px, py) · rotate(rot) · scale(sx, sy).
        const c = Math.cos(rot), s = Math.sin(rot);
        const la = sx * c, lb = sx * s, lc = -sy * s, ld = sy * c;
        ctx.setTransform(ba * la + bc * lb, bb * la + bd * lb, ba * lc + bc * ld, bb * lc + bd * ld,
          ba * px + bc * py + be, bb * px + bd * py + bf);
        if (kd === P_DEBRIS) {
          ctx.fillStyle = packedToCss(img);
          ctx.fillRect(-0.5, -0.5, 1, 1);
        } else if (kd === P_SPARK) {
          ctx.drawImage(sprite(img), -0.82, -0.5, 1, 1);
        } else {
          ctx.drawImage(sprite(img), -0.5, -0.5, 1, 1);
        }
      }
    }
    ctx.restore();
  }
}
