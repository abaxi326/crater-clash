/**
 * Tank silhouette in hull space: origin at the ground contact point, x forward (facing right),
 * y down (so everything above the ground is negative). Shared by sprite baking and live drawing.
 */
import { TURRET_PIVOT_HEIGHT } from '../../core/constants.ts';

// --- Running gear ---------------------------------------------------------------------
/** Tread loop: two half circles of radius TREAD_R centred at ±TREAD_CX, TREAD_CY. */
export const TREAD_CX = 21;
export const TREAD_R = 5.6;
export const TREAD_CY = -TREAD_R;
/** Rubber band thickness (inner loop radius = TREAD_R - TREAD_T). */
export const TREAD_T = 1.9;
/** Distance between tread links along the loop. */
export const LINK_PITCH = 3.1;
export const TREAD_STRAIGHT = TREAD_CX * 2;
export const TREAD_LOOP = TREAD_STRAIGHT * 2 + Math.PI * 2 * (TREAD_R - 0.6);

export const ROAD_WHEELS: readonly number[] = [-12.6, -4.2, 4.2, 12.6];
export const ROAD_WHEEL_R = 3.8;
export const ROAD_WHEEL_Y = -4.75;
export const SPROCKET_R = 4.15;

// --- Hull ---------------------------------------------------------------------------------
export const HULL_TOP = -20.5;
export const SKIRT_TOP = -13.6;
export const SKIRT_BOTTOM = -9.2;

// --- Turret -------------------------------------------------------------------------------
export const PIVOT_Y = -TURRET_PIVOT_HEIGHT;
export const DOME_BASE = -19.6;
export const DOME_HALF_W = 13.2;
export const DOME_TOP = -30.4;
/** Ellipse approximating the dome for the barrel collar. */
export const DOME_EY = -19.6;
export const DOME_EA = 13.2;
export const DOME_EB = 10.8;

export const ANTENNA_BASE_X = -8.6;
export const ANTENNA_BASE_Y = -27.2;
export const ANTENNA_LEN = 19;

export const HEADLIGHT_X = 24.2;
export const HEADLIGHT_Y = -16.2;
export const EXHAUST_X = -25.6;
export const EXHAUST_Y = -19.2;

// --- Barrel -------------------------------------------------------------------------------
export const BARREL_ROOT_W = 5.0;
export const BARREL_TIP_W = 4.0;
export const BRAKE_LEN = 6.2;
export const BRAKE_W = 6.4;
/** Maximum recoil slide (world units). */
export const RECOIL_SLIDE = 6.5;

// --- Paths --------------------------------------------------------------------------------
export function hullPath(ctx: CanvasRenderingContext2D | Path2D): void {
  ctx.moveTo(-25.4, -11.6);
  ctx.lineTo(-24.2, -17.4);
  ctx.quadraticCurveTo(-23.6, -19.6, -21.4, -20.1);
  ctx.lineTo(-16.8, HULL_TOP);
  ctx.lineTo(14.8, HULL_TOP);
  ctx.quadraticCurveTo(17, HULL_TOP + 0.1, 18.4, -19.6);
  ctx.lineTo(25.4, -15.2);
  ctx.quadraticCurveTo(27.2, -13.9, 27, -12.4);
  ctx.lineTo(26.4, -11.2);
  ctx.closePath();
}

export function skirtPath(ctx: CanvasRenderingContext2D | Path2D): void {
  ctx.moveTo(-27.6, SKIRT_TOP + 0.4);
  ctx.lineTo(27.8, SKIRT_TOP);
  ctx.quadraticCurveTo(28.8, SKIRT_TOP + 0.2, 28.4, SKIRT_TOP + 1.4);
  ctx.lineTo(26.2, SKIRT_BOTTOM);
  ctx.lineTo(-25.4, SKIRT_BOTTOM);
  ctx.lineTo(-28.2, SKIRT_TOP + 1.8);
  ctx.quadraticCurveTo(-28.6, SKIRT_TOP + 0.5, -27.6, SKIRT_TOP + 0.4);
  ctx.closePath();
}

export function domePath(ctx: CanvasRenderingContext2D | Path2D): void {
  ctx.moveTo(-DOME_HALF_W, DOME_BASE);
  ctx.bezierCurveTo(-DOME_HALF_W, -26.4, -8.6, DOME_TOP, 0.6, DOME_TOP);
  ctx.bezierCurveTo(8.8, DOME_TOP, DOME_HALF_W + 0.4, -26.6, DOME_HALF_W + 0.6, DOME_BASE);
  ctx.closePath();
}

/** Stadium outline of the tread loop, inset by `inset`. */
export function treadLoopPath(ctx: CanvasRenderingContext2D | Path2D, inset: number): void {
  const r = TREAD_R - inset;
  ctx.moveTo(-TREAD_CX, TREAD_CY - r);
  ctx.lineTo(TREAD_CX, TREAD_CY - r);
  ctx.arc(TREAD_CX, TREAD_CY, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-TREAD_CX, TREAD_CY + r);
  ctx.arc(-TREAD_CX, TREAD_CY, r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * Distance along the barrel ray (hull-local canvas angle `phi`, from the pivot) where it leaves the dome.
 * Used to place the barrel collar.
 */
export function domeExit(phi: number): number {
  const c = Math.cos(phi), s = Math.sin(phi);
  const oy = PIVOT_Y - DOME_EY;
  const A = (c * c) / (DOME_EA * DOME_EA) + (s * s) / (DOME_EB * DOME_EB);
  const B = (2 * oy * s) / (DOME_EB * DOME_EB);
  const C = (oy * oy) / (DOME_EB * DOME_EB) - 1;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 11;
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  return t < 9.5 ? 9.5 : t > 13.6 ? 13.6 : t;
}
