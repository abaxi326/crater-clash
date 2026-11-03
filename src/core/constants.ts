/**
 * Global tuning constants. World units equal terrain pixels; y grows downward.
 * Angles in game state are degrees (0 = right, 90 = straight up, 180 = left).
 */

// --- World ------------------------------------------------------------------
export const WORLD_W = 1920;
export const WORLD_H = 1080;
/** Bottom rows that can never be destroyed (keeps tanks inside the world). */
export const BEDROCK_ROWS = 26;
/** Terrain pixels with alpha at or above this value are solid ground. */
export const SOLID_ALPHA = 128;

// --- Ballistics --------------------------------------------------------------
/** Base gravity in px/s² (multiplied by the biome's gravityScale). */
export const GRAVITY = 520;
/** Horizontal acceleration in px/s² per unit of wind. */
export const WIND_ACCEL = 7.5;
/** Wind ranges over [-MAX_WIND, MAX_WIND]; positive blows to the right. */
export const MAX_WIND = 10;
/** Muzzle speed at power 0 and power 100 (px/s). */
export const MIN_MUZZLE_SPEED = 170;
export const MAX_MUZZLE_SPEED = 1120;
/** Largest physics substep in seconds; update(dt) is split into steps no longer than this. */
export const MAX_SUBSTEP = 1 / 240;
/** Projectiles older than this are removed (safety net). */
export const PROJECTILE_MAX_AGE = 14;
/** Projectiles further than this beyond the left/right/bottom world edge are removed. The sky is unbounded. */
export const OUT_OF_BOUNDS_MARGIN = 220;

// --- Tanks ---------------------------------------------------------------------
export const TANK_HALF_WIDTH = 28;
export const TANK_HULL_HEIGHT = 22;
/** Turret pivot height above the ground contact point, in hull space. */
export const TURRET_PIVOT_HEIGHT = 21;
export const BARREL_LENGTH = 34;
/** Tank "centre" (used for direct hits and blast distance) height above the contact point. */
export const TANK_CENTER_HEIGHT = 12;
/** Radius of the direct-hit circle around tankCenter(). */
export const TANK_HIT_RADIUS = 21;
export const MAX_HP = 100;
/** Drive distance available per round (world units). */
export const FUEL_PER_ROUND = 240;
export const DRIVE_SPEED = 72;
/** Steepest slope (dy/dx) a tank can drive up. */
export const MAX_CLIMB_SLOPE = 1.15;
export const FALL_DAMAGE_THRESHOLD = 36;
export const FALL_DAMAGE_PER_PX = 0.22;
export const FALL_DAMAGE_MAX = 30;
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 180;
export const POWER_MIN = 0;
export const POWER_MAX = 100;
/** Tanks can never be driven or pushed closer than this to the world's side edges. */
export const EDGE_PADDING = 34;

// --- Pacing (seconds) ----------------------------------------------------------
export const INTRO_TIME = 2.2;
export const SETTLE_MIN_TIME = 0.55;
export const TURN_END_TIME = 0.45;
/** Delay after a tank is destroyed before the round is declared over (kill-cam time). */
export const ROUND_OVER_DELAY = 1.8;
/** Attract (menu demo) mode automatically starts the next round after this long. */
export const ATTRACT_NEXT_ROUND_DELAY = 3.5;

// --- Crates --------------------------------------------------------------------
export const CRATE_CHANCE_PER_TURN = 0.33;
export const MAX_CRATES = 2;
export const CRATE_FALL_SPEED = 62;
export const CRATE_SIZE = 22;

/** Muzzle speed for a power value in [0, 100]. */
export function powerToSpeed(power: number): number {
  return MIN_MUZZLE_SPEED + (MAX_MUZZLE_SPEED - MIN_MUZZLE_SPEED) * (power / 100);
}
