/** Deterministic randomness and noise. Never use Math.random() in the simulation. */

/** 32-bit integer hash (lowbias32). */
export function hashInt(n: number): number {
  n |= 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  n ^= n >>> 16;
  return n >>> 0;
}

/** Hash of (seed, x, y) integers mapped to [0, 1). */
export function hash2(seed: number, x: number, y: number): number {
  return hashInt(seed ^ hashInt((x | 0) + hashInt((y | 0) ^ 0x9e3779b9))) / 4294967296;
}

/** Hash of (seed, x) mapped to [0, 1). */
export function hash1(seed: number, x: number): number {
  return hashInt(seed ^ hashInt((x | 0) + 0x632be5ab)) / 4294967296;
}

/** Small, fast seeded PRNG (mulberry32). */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  sign(): 1 | -1 { return this.next() < 0.5 ? -1 : 1; }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }
  /** Standard normal sample (Box–Muller). */
  gaussian(): number {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Independent generator derived from this one's seed and a salt. */
  fork(salt: number): Rng { return new Rng(hashInt(this.s ^ hashInt(salt))); }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 1D value noise in [-1, 1]. */
export function makeNoise1D(seed: number): (x: number) => number {
  return (x: number): number => {
    const i = Math.floor(x);
    const t = smoother(x - i);
    const a = hash1(seed, i) * 2 - 1;
    const b = hash1(seed, i + 1) * 2 - 1;
    return a + (b - a) * t;
  };
}

/** Smooth 2D value noise in [-1, 1]. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  return (x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const tx = smoother(x - ix), ty = smoother(y - iy);
    const a = hash2(seed, ix, iy), b = hash2(seed, ix + 1, iy);
    const c = hash2(seed, ix, iy + 1), d = hash2(seed, ix + 1, iy + 1);
    const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
    return (top + (bottom - top) * ty) * 2 - 1;
  };
}

/** Fractal sum of 1D noise, normalised to roughly [-1, 1]. */
export function fbm1D(noise: (x: number) => number, x: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq + o * 17.31) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal sum of 2D noise, normalised to roughly [-1, 1]. */
export function fbm2D(noise: (x: number, y: number) => number, x: number, y: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq + o * 31.7, y * freq - o * 11.3) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
