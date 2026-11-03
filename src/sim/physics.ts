/**
 * Shared physics: the exact constant-acceleration integrator, swept collision against terrain
 * and tanks, ballistic tracing (aim guide + CPU planning use the very same code as real shots),
 * and tank/ground helpers. Allocation-free in the hot paths.
 */
import {
  EDGE_PADDING, MAX_CLIMB_SLOPE, MAX_SUBSTEP, OUT_OF_BOUNDS_MARGIN, TANK_CENTER_HEIGHT, TANK_HALF_WIDTH,
  TANK_HIT_RADIUS, WIND_ACCEL, WORLD_H, WORLD_W,
} from '../core/constants.ts';
import type { TankState } from '../core/types.ts';
import type { WeaponDef } from '../core/weapons.ts';
import type { Terrain } from './terrain.ts';

/** Projectiles cannot hit their own tank during their first OWNER_IMMUNITY seconds. */
export const OWNER_IMMUNITY = 0.15;

export interface Body { x: number; y: number; vx: number; vy: number }

/** Exact integration for constant acceleration: identical results for any step split (up to rounding). */
export function integrate(b: Body, ax: number, ay: number, dt: number): void {
  const hdt2 = 0.5 * dt * dt;
  b.x += b.vx * dt + ax * hdt2;
  b.y += b.vy * dt + ay * hdt2;
  b.vx += ax * dt;
  b.vy += ay * dt;
}

/** Horizontal acceleration from wind for a weapon. */
export const windAccel = (weapon: WeaponDef, wind: number): number => wind * WIND_ACCEL * weapon.windScale;
/** Vertical acceleration from gravity for a weapon. */
export const gravityAccel = (weapon: WeaponDef, gravity: number): number => gravity * weapon.gravityScale;

/** Beyond the left/right/bottom removal margin (the sky is unbounded). */
export const outOfWorld = (x: number, y: number): boolean =>
  x < -OUT_OF_BOUNDS_MARGIN || x > WORLD_W + OUT_OF_BOUNDS_MARGIN || y > WORLD_H + OUT_OF_BOUNDS_MARGIN;

// --- Swept collision --------------------------------------------------------------

/** Cached tank hit circles for one substep (avoid recomputing tankCenter per sample). */
export class TankTargets {
  readonly cx = new Float64Array(2);
  readonly cy = new Float64Array(2);
  readonly alive = new Uint8Array(2);

  refresh(tanks: readonly TankState[]): void {
    for (let i = 0; i < 2; i++) {
      const t = tanks[i];
      // tankCenter() inlined (hullPoint at TANK_CENTER_HEIGHT) to stay allocation-free per substep.
      this.cx[i] = t.x + TANK_CENTER_HEIGHT * Math.sin(t.tilt);
      this.cy[i] = t.y - TANK_CENTER_HEIGHT * Math.cos(t.tilt);
      this.alive[i] = t.alive ? 1 : 0;
    }
  }
}

export const CONTACT_NONE = 0;
export const CONTACT_TERRAIN = 1;
export const CONTACT_TANK = 2;

export interface Contact {
  kind: number;
  /** Contact sample. */
  x: number;
  y: number;
  /** Last free sample before the contact (where the body can safely be put back). */
  fx: number;
  fy: number;
  /** Tank index for CONTACT_TANK, else -1. */
  tank: number;
}

export const makeContact = (): Contact => ({ kind: CONTACT_NONE, x: 0, y: 0, fx: 0, fy: 0, tank: -1 });

/**
 * Samples the segment (x0,y0)→(x1,y1) at ≤ stepPx spacing (excluding the start) and reports the first
 * contact with a tank hit circle (skipping `ignoreTank`) or solid terrain. Returns true on contact.
 */
export function sweep(
  terrain: Terrain, targets: TankTargets | null, x0: number, y0: number, x1: number, y1: number,
  ignoreTank: number, checkTerrain: boolean, out: Contact, stepPx = 1,
): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / stepPx));
  const r2 = TANK_HIT_RADIUS * TANK_HIT_RADIUS;
  let fx = x0, fy = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t, y = y0 + dy * t;
    if (targets) {
      for (let k = 0; k < 2; k++) {
        if (k === ignoreTank || !targets.alive[k]) continue;
        const ex = x - targets.cx[k], ey = y - targets.cy[k];
        if (ex * ex + ey * ey < r2) {
          out.kind = CONTACT_TANK; out.x = x; out.y = y; out.fx = fx; out.fy = fy; out.tank = k;
          return true;
        }
      }
    }
    if (checkTerrain && terrain.isSolid(x, y)) {
      out.kind = CONTACT_TERRAIN; out.x = x; out.y = y; out.fx = fx; out.fy = fy; out.tank = -1;
      return true;
    }
    fx = x; fy = y;
  }
  out.kind = CONTACT_NONE;
  out.tank = -1;
  return false;
}

// --- Ballistic tracing -------------------------------------------------------------

export interface TraceResult {
  kind: number;
  x: number;
  y: number;
  /** Tank index on a tank hit, else -1. */
  tank: number;
  /** Flight time (s). */
  time: number;
  /** Apex (lowest y) reached and where. */
  apexX: number;
  apexY: number;
  /** True when the shot left the world (no contact). */
  out: boolean;
}

export const makeTraceResult = (): TraceResult => ({ kind: 0, x: 0, y: 0, tank: -1, time: 0, apexX: 0, apexY: 0, out: false });

const traceBody: Body = { x: 0, y: 0, vx: 0, vy: 0 };
const traceContact = makeContact();

/**
 * Integrates a plain ballistic shot exactly like the live simulation (same integrator, same swept
 * collision, same owner immunity). `onSample(x, y)` is called after every step; return false to stop.
 * `step` defaults to the live substep; coarser steps give the same parabola (exact integration).
 */
export function traceBallistic(
  terrain: Terrain, targets: TankTargets | null, owner: number,
  x: number, y: number, vx: number, vy: number, ax: number, ay: number,
  maxTime: number, out: TraceResult, step = MAX_SUBSTEP, stepPx = 1,
  onSample?: (x: number, y: number) => boolean,
): TraceResult {
  const b = traceBody;
  b.x = x; b.y = y; b.vx = vx; b.vy = vy;
  out.kind = CONTACT_NONE; out.tank = -1; out.out = false;
  out.apexX = x; out.apexY = y;
  let t = 0;
  while (t < maxTime) {
    const px = b.x, py = b.y;
    // Match the live sim: immunity is judged at the start of the step.
    const ignore = t < OWNER_IMMUNITY ? owner : -1;
    integrate(b, ax, ay, step);
    t += step;
    if (b.y < out.apexY) { out.apexY = b.y; out.apexX = b.x; }
    if (sweep(terrain, targets, px, py, b.x, b.y, ignore, true, traceContact, stepPx)) {
      out.kind = traceContact.kind; out.tank = traceContact.tank;
      out.x = traceContact.x; out.y = traceContact.y; out.time = t;
      if (onSample) onSample(out.x, out.y);
      return out;
    }
    if (outOfWorld(b.x, b.y)) { out.out = true; break; }
    if (onSample && !onSample(b.x, b.y)) break;
  }
  out.x = b.x; out.y = b.y; out.time = t;
  return out;
}

// --- Tanks and ground ----------------------------------------------------------------
//
// A tank rests on a "tread line" through its contact point (x, y) with slope tan(tilt).
// Samples across ±0.7 half-width test the ground along that line, so tanks sit flush on
// slopes yet bridge narrow holes instead of sinking into them.

/** Horizontal tread sample offsets. */
export const TREAD_OFFSETS: readonly number[] = [-0.7, -0.35, 0, 0.35, 0.7].map(f => f * TANK_HALF_WIDTH);
/** Hull tilt limit (radians). */
export const MAX_TILT = 0.8;
const MAX_TREAD_SLOPE = Math.tan(MAX_TILT);

export const treadSlope = (tilt: number): number => {
  const s = Math.tan(tilt);
  return s < -MAX_TREAD_SLOPE ? -MAX_TREAD_SLOPE : s > MAX_TREAD_SLOPE ? MAX_TREAD_SLOPE : s;
};

/**
 * Contact y where the tread line (slope) first touches ground when lowered from fromY.
 * Returns ≥ terrain.h when there is nothing below.
 */
export function treadRest(terrain: Terrain, x: number, fromY: number, slope: number): number {
  let best = Infinity;
  for (let i = 0; i < TREAD_OFFSETS.length; i++) {
    const o = TREAD_OFFSETS[i], off = o * slope;
    const s = terrain.surfaceY(x + o, fromY + off) - off;
    if (s < best) best = s;
  }
  return best;
}

/** True when ground touches the tread line. */
export function hasSupport(terrain: Terrain, x: number, y: number, slope: number): boolean {
  for (let i = 0; i < TREAD_OFFSETS.length; i++) {
    const o = TREAD_OFFSETS[i];
    if (terrain.isSolid(x + o, y + o * slope + 0.5)) return true;
  }
  return false;
}

/** First solid row at or below y - up in column x (y - up when that point is already solid). */
export const groundNear = (terrain: Terrain, x: number, y: number, up: number): number => terrain.surfaceY(x, y - up);

/** Target hull tilt (radians, clockwise positive) from the ground either side of x. */
export function groundTilt(terrain: Terrain, x: number, y: number): number {
  const span = TANK_HALF_WIDTH * 0.62;
  let gl = groundNear(terrain, x - span, y, 22);
  let gr = groundNear(terrain, x + span, y, 22);
  if (gl > y + 30) gl = y + 30;
  if (gr > y + 30) gr = y + 30;
  const a = Math.atan2(gr - gl, span * 2);
  return a < -MAX_TILT ? -MAX_TILT : a > MAX_TILT ? MAX_TILT : a;
}

export const MIN_TANK_X = EDGE_PADDING;
export const MAX_TANK_X = WORLD_W - EDGE_PADDING;

/**
 * Moves a grounded tank horizontally by dx along the surface. Returns the new contact y, or NaN when
 * blocked (world edge, wall, or a slope steeper than MAX_CLIMB_SLOPE). A drop is allowed: the caller
 * notices missing support and lets the tank fall.
 */
export function surfaceStep(terrain: Terrain, x: number, y: number, dx: number, slope: number): number {
  const nx = x + dx;
  if (nx < MIN_TANK_X || nx > MAX_TANK_X) return NaN;
  const dir = dx > 0 ? 1 : -1;
  // Slope of the ground just ahead of the treads, relative to the contact point.
  const span = TANK_HALF_WIDTH * 0.6;
  const up = span * (MAX_CLIMB_SLOPE + 0.25);
  const ahead = groundNear(terrain, nx + dir * span, y, up);
  if ((y - ahead) / span > MAX_CLIMB_SLOPE) return NaN;
  const climb = MAX_CLIMB_SLOPE * Math.abs(dx) + 1.25;
  // Ground (along the tread line) above the allowed step: a wall.
  for (let i = 0; i < TREAD_OFFSETS.length; i++) {
    const o = TREAD_OFFSETS[i];
    if (o * dir < 0) continue; // only the leading half can hit a wall
    if (terrain.isSolid(nx + o, y - climb + o * slope)) return NaN;
  }
  const ny = treadRest(terrain, nx, y - climb, slope);
  return ny > terrain.h ? terrain.h : ny;
}

export const SUPPORT_LEFT = 1;
export const SUPPORT_CENTER = 2;
export const SUPPORT_RIGHT = 4;

/** Which parts of the tread line touch ground (bit mask of SUPPORT_*). */
export function supportMask(terrain: Terrain, x: number, y: number, slope: number): number {
  let m = 0;
  for (let i = 0; i < TREAD_OFFSETS.length; i++) {
    const o = TREAD_OFFSETS[i];
    if (terrain.isSolid(x + o, y + o * slope + 0.5)) m |= o < 0 ? SUPPORT_LEFT : o > 0 ? SUPPORT_RIGHT : SUPPORT_CENTER;
  }
  return m;
}
