/** Tank geometry shared by simulation and rendering so barrels, muzzles and hit boxes always agree. */
import { BARREL_LENGTH, TANK_CENTER_HEIGHT, TURRET_PIVOT_HEIGHT, powerToSpeed } from './constants.ts';
import { DEG, type Vec2 } from './math.ts';
import type { TankState } from './types.ts';

type TankPose = Pick<TankState, 'x' | 'y' | 'tilt'>;
type TankAim = Pick<TankState, 'x' | 'y' | 'tilt' | 'angle'>;

/** A point `height` above the contact point along the hull's up axis. */
export function hullPoint(tank: TankPose, height: number, along = 0): Vec2 {
  const s = Math.sin(tank.tilt), c = Math.cos(tank.tilt);
  // Hull space (along, -height) rotated by tilt (clockwise positive, y down).
  return { x: tank.x + along * c + height * s, y: tank.y + along * s - height * c };
}

/** Barrel pivot in world space. */
export function turretPivot(tank: TankPose): Vec2 {
  return hullPoint(tank, TURRET_PIVOT_HEIGHT);
}

/** Barrel tip in world space (projectiles spawn here). */
export function muzzlePoint(tank: TankAim, length = BARREL_LENGTH): Vec2 {
  const p = turretPivot(tank);
  const a = tank.angle * DEG;
  return { x: p.x + Math.cos(a) * length, y: p.y - Math.sin(a) * length };
}

/** Centre used for direct-hit tests and blast distance. */
export function tankCenter(tank: TankPose): Vec2 {
  return hullPoint(tank, TANK_CENTER_HEIGHT);
}

/** Launch velocity for a world-absolute angle (degrees) and power (0..100). */
export function muzzleVelocity(angleDeg: number, power: number): Vec2 {
  const speed = powerToSpeed(power);
  const a = angleDeg * DEG;
  return { x: Math.cos(a) * speed, y: -Math.sin(a) * speed };
}
