/**
 * Render-side per-tank animation state: antenna and suspension springs, facing flip, shield
 * formation and wreck timers. Driven purely by observing TankState changes frame to frame.
 */
import { DEG, clamp, damp } from '../../core/math.ts';
import type { TankState } from '../../core/types.ts';

export class TankAnim {
  /** -1 or 1: hull faces the barrel's side (with hysteresis). */
  facing = 1;
  /** Smoothed horizontal scale used for the flip (-1..1). */
  flip = 1;
  /** Antenna bend (radians, world sense: + leans right) and angular velocity. */
  ant = 0;
  antV = 0;
  /** Sprung mass: vertical offset (+ = down) and pitch (radians), with velocities. */
  sy = 0;
  syV = 0;
  pitch = 0;
  pitchV = 0;
  /** Smoothed drive speed (world units/s) and acceleration. */
  speed = 0;
  /** Airborne wobble envelope 0..1. */
  air = 0;
  /** Shield bubble formation 0..1 and the last shield value seen. */
  shieldForm = 0;
  /** Seconds since the tank was destroyed (cools embers). */
  deadT = 0;
  /** Seconds since the last hit (shield ripple timing). */
  hitT = 9;

  private init = false;
  private prevPhase = 0;
  private prevRecoil = 0;
  private prevHit = 0;
  private prevAir = false;
  private prevVy = 0;

  reset(t: TankState): void {
    this.init = true;
    this.facing = t.angle > 90 ? -1 : 1;
    this.flip = this.facing;
    this.ant = this.antV = this.sy = this.syV = this.pitch = this.pitchV = 0;
    this.speed = 0;
    this.air = t.airborne ? 1 : 0;
    this.shieldForm = t.shield > 0 ? 1 : 0;
    this.deadT = t.alive ? 0 : 10;
    this.hitT = 9;
    this.prevPhase = t.treadPhase;
    this.prevRecoil = t.recoil;
    this.prevHit = t.hitFlash;
    this.prevAir = t.airborne;
    this.prevVy = t.vy;
  }

  update(t: TankState, dt: number): void {
    // A large jump (new round, teleport) or first sight: snap instead of animating.
    if (!this.init || Math.abs(t.treadPhase - this.prevPhase) > 60) this.reset(t);
    if (t.angle < 84) this.facing = 1;
    else if (t.angle > 96) this.facing = -1;
    if (!t.alive) this.deadT += dt;
    else this.deadT = 0;
    this.hitT += dt;
    if (dt <= 0) return;

    this.flip = damp(this.flip, this.facing, 16, dt);
    if (Math.abs(this.flip - this.facing) < 0.01) this.flip = this.facing;

    // Motion → antenna and pitch inertia.
    const v = (t.treadPhase - this.prevPhase) / dt;
    const prevSpeed = this.speed;
    this.speed = damp(this.speed, v, 14, dt);
    const accel = clamp((this.speed - prevSpeed) / dt, -900, 900);
    this.antV -= accel * 0.0065;
    this.pitchV -= accel * 0.00022;

    // Firing kicks the hull back and whips the antenna away from the barrel.
    if (t.recoil > this.prevRecoil + 0.3) {
      const dx = Math.cos(t.angle * DEG);
      this.antV -= dx * 5.5 + 1.2 * Math.sign(dx || 1);
      this.pitchV -= dx * 0.9;
      this.syV += 9;
    }
    // Hits: jolt everything.
    if (t.hitFlash > this.prevHit + 0.2) {
      this.hitT = 0;
      this.antV += (t.index === 0 ? -1 : 1) * 7 * (0.6 + t.hitFlash * 0.4);
      this.syV += 16;
      this.pitchV += (t.index === 0 ? -1 : 1) * 1.1;
    }
    // Landing squash proportional to impact speed.
    if (this.prevAir && !t.airborne) {
      const impact = clamp(Math.abs(this.prevVy) / 300, 0.25, 1.6);
      this.syV += 28 * impact;
      this.antV += (this.ant >= 0 ? 1 : -1) * 4 * impact;
    }
    this.air = damp(this.air, t.airborne ? 1 : 0, t.airborne ? 6 : 10, dt);

    // Springs (substepped so slow frames stay stable).
    const steps = dt > 1 / 60 ? Math.ceil(dt * 120) : 2;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.antV += (-120 * this.ant - 5.2 * this.antV) * h;
      this.ant += this.antV * h;
      this.syV += (-260 * this.sy - 15 * this.syV) * h;
      this.sy += this.syV * h;
      this.pitchV += (-210 * this.pitch - 13 * this.pitchV) * h;
      this.pitch += this.pitchV * h;
    }
    this.ant = clamp(this.ant, -1.1, 1.1);
    this.sy = clamp(this.sy, -2.2, 2.6);
    this.pitch = clamp(this.pitch, -0.09, 0.09);

    const shieldTarget = t.shield > 0 && t.alive ? 1 : 0;
    this.shieldForm = shieldTarget > this.shieldForm ? Math.min(1, this.shieldForm + dt * 2.6) : shieldTarget;

    this.prevPhase = t.treadPhase;
    this.prevRecoil = t.recoil;
    this.prevHit = t.hitFlash;
    this.prevAir = t.airborne;
    this.prevVy = t.vy;
  }
}
