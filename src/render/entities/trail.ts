/**
 * Render-side trail history for one projectile: a fixed-capacity ring buffer of samples placed at
 * even arc spacing along a Hermite reconstruction of the flight path (so fast shells still give
 * smooth ribbons). Trails outlive their projectile and fade out before being recycled.
 */
import type { TrailStyle, WeaponId } from '../../core/weapons.ts';

export const TRAIL_CAP = 192;

/** Per-style tuning: sample spacing (world units) and point lifetime (sim seconds). */
export const TRAIL_SPEC: Record<TrailStyle, { spacing: number; life: number }> = {
  smoke: { spacing: 8, life: 1.15 },
  fire: { spacing: 6, life: 0.95 },
  glow: { spacing: 5, life: 0.5 },
  spark: { spacing: 6, life: 0.95 },
  electric: { spacing: 6, life: 0.42 },
  void: { spacing: 7, life: 1.05 },
  rainbow: { spacing: 5, life: 0.75 },
  none: { spacing: 10, life: 0.1 },
};

export class Trail {
  id = -1;
  weapon: WeaponId = 'ember';
  style: TrailStyle = 'none';
  fragment = false;
  /** Hue (degrees) for hue-tinted fragments (fireworks stars); -1 = weapon colour. */
  hue = -1;
  /** Projectile still exists. */
  alive = false;
  /** Seen this frame (mark & sweep). */
  seen = false;
  /** Sim time of creation. */
  born = 0;
  /** Sim time the projectile vanished. */
  died = 0;

  readonly xs = new Float32Array(TRAIL_CAP);
  readonly ys = new Float32Array(TRAIL_CAP);
  readonly ts = new Float64Array(TRAIL_CAP);
  /** Random 0..1 per sample (scatter, twinkle phase). */
  readonly rs = new Float32Array(TRAIL_CAP);
  /** 1 = a gap precedes this sample (drilling, teleport, wrap). */
  readonly brk = new Uint8Array(TRAIL_CAP);
  start = 0;
  count = 0;

  /** Last observed projectile state (for Hermite reconstruction). */
  px = 0; py = 0; pvx = 0; pvy = 0; pt = 0;
  hasPrev = false;
  /** Arc length travelled since the last emitted sample. */
  acc = 0;
  /** Current projectile position (ribbon head) and velocity. */
  hx = 0; hy = 0; hvx = 0; hvy = 0;
  /** Next sample starts a new segment. */
  pendingBreak = false;
  /** Projectile currently drilling (no samples). */
  underground = false;

  reset(id: number, weapon: WeaponId, style: TrailStyle, fragment: boolean, hue: number, now: number): void {
    this.id = id;
    this.weapon = weapon;
    this.style = style;
    this.fragment = fragment;
    this.hue = hue;
    this.alive = true;
    this.seen = true;
    this.born = now;
    this.died = 0;
    this.start = 0;
    this.count = 0;
    this.hasPrev = false;
    this.acc = 0;
    this.pendingBreak = false;
    this.underground = false;
  }

  /** Index of the i-th oldest sample. */
  idx(i: number): number {
    const j = this.start + i;
    return j >= TRAIL_CAP ? j - TRAIL_CAP : j;
  }

  push(x: number, y: number, t: number): void {
    let j: number;
    if (this.count < TRAIL_CAP) {
      j = this.idx(this.count);
      this.count++;
    } else {
      j = this.start;
      this.start = this.start + 1 === TRAIL_CAP ? 0 : this.start + 1;
      // The new oldest sample starts a segment (its predecessor is gone).
    }
    this.xs[j] = x;
    this.ys[j] = y;
    this.ts[j] = t;
    this.rs[j] = Math.random();
    this.brk[j] = this.pendingBreak ? 1 : 0;
    this.pendingBreak = false;
  }

  /** Drops samples older than `life`. */
  expire(now: number, life: number): void {
    while (this.count > 0 && now - this.ts[this.start] > life) {
      this.start = this.start + 1 === TRAIL_CAP ? 0 : this.start + 1;
      this.count--;
    }
  }

  /** Fully faded and detached from its projectile. */
  done(now: number, life: number): boolean {
    return !this.alive && (this.count === 0 || now - this.died > life + 0.05);
  }

  /** Starts the trail exactly at a point (split origin, spawn), seeding the reconstruction state. */
  seed(x: number, y: number, vx: number, vy: number, t: number): void {
    this.push(x, y, t);
    this.px = x; this.py = y; this.pvx = vx; this.pvy = vy; this.pt = t;
    this.hx = x; this.hy = y; this.hvx = vx; this.hvy = vy;
    this.hasPrev = true;
    this.acc = 0;
  }

  /**
   * Follows the projectile from its previous observed state to (x, y, vx, vy) at sim time t,
   * emitting a sample every `spacing` units of arc length.
   */
  follow(x: number, y: number, vx: number, vy: number, t: number, spacing: number, emit: boolean): void {
    this.hx = x; this.hy = y; this.hvx = vx; this.hvy = vy;
    if (!this.hasPrev) {
      if (emit) this.push(x, y, t);
      this.px = x; this.py = y; this.pvx = vx; this.pvy = vy; this.pt = t;
      this.hasPrev = true;
      return;
    }
    const x0 = this.px, y0 = this.py;
    const dx = x - x0, dy = y - y0;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-3) { this.pt = t; return; }
    if (!emit) {
      this.px = x; this.py = y; this.pvx = vx; this.pvy = vy; this.pt = t; this.acc = 0;
      return;
    }
    // Teleport / wrap: never draw a streak across a huge jump.
    const ft = t - this.pt;
    if (chord > 260 || ft <= 0) {
      this.pendingBreak = true;
      this.push(x, y, t);
      this.px = x; this.py = y; this.pvx = vx; this.pvy = vy; this.pt = t; this.acc = 0;
      return;
    }
    // Hermite tangents from velocities, unless the motion is discontinuous (bounce, ricochet, homing kick).
    let t0x = this.pvx * ft, t0y = this.pvy * ft, t1x = vx * ft, t1y = vy * ft;
    const l0 = Math.hypot(t0x, t0y), l1 = Math.hypot(t1x, t1y);
    const dot = (this.pvx * vx + this.pvy * vy) / Math.max(1e-6, Math.hypot(this.pvx, this.pvy) * Math.hypot(vx, vy));
    if (dot < 0.8 || l0 > chord * 1.6 || l1 > chord * 1.6 || l0 < chord * 0.5) {
      t0x = dx; t0y = dy; t1x = dx; t1y = dy;
    }
    const steps = Math.max(1, Math.ceil(chord / (spacing * 0.5)));
    let lx = x0, ly = y0;
    for (let k = 1; k <= steps; k++) {
      const s = k / steps;
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const cx = h00 * x0 + h10 * t0x + h01 * x + h11 * t1x;
      const cy = h00 * y0 + h10 * t0y + h01 * y + h11 * t1y;
      this.acc += Math.hypot(cx - lx, cy - ly);
      lx = cx; ly = cy;
      if (this.acc >= spacing) {
        this.acc -= spacing;
        if (this.acc > spacing) this.acc = 0;
        this.push(cx, cy, this.pt + ft * s);
      }
    }
    this.px = x; this.py = y; this.pvx = vx; this.pvy = vy; this.pt = t;
  }

  /** Inserts an exact corner sample (bounce point) so the reconstruction never cuts the corner. */
  corner(x: number, y: number, t: number): void {
    this.push(x, y, t);
    this.px = x; this.py = y; this.pt = t;
    this.acc = 0;
    // Tangent unknown at a corner: force linear for the next frame.
    this.pvx = 0; this.pvy = 0;
  }
}
