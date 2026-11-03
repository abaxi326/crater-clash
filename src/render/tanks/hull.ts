/** Bake-time painters for the hull (body, skirt, deck details) in hull space, facing right. */
import { colorAlpha } from './bake.ts';
import type { TankPalette } from './palette.ts';
import { EXHAUST_X, EXHAUST_Y, HEADLIGHT_X, HEADLIGHT_Y, HULL_TOP, SKIRT_BOTTOM, SKIRT_TOP, hullPath, skirtPath } from './shape.ts';

/** 0 = pristine, 1 = scorched and dented (hp < 60), 2 = torn panel (hp < 35), 3 = wreck. */
export type DamageTier = 0 | 1 | 2 | 3;

/** Location of the torn panel (tier ≥ 2) whose interior glows (dynamic pulse drawn on top). */
export const TORN_X = 10.2;
export const TORN_Y = -16.6;


function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function rivet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pal: TankPalette, wreck: boolean): void {
  ctx.fillStyle = wreck ? '#0d0b0a' : colorAlpha(pal.paintDeep, 0.85);
  ctx.beginPath();
  ctx.arc(x + 0.15, y + 0.2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = wreck ? '#4a403a' : pal.paintLight;
  ctx.beginPath();
  ctx.arc(x - 0.1, y - 0.1, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
}

/** Engraved panel line: dark groove with a light lip underneath. */
function groove(ctx: CanvasRenderingContext2D, pts: number[], dark: string, light: string): void {
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = light;
  ctx.beginPath();
  ctx.moveTo(pts[0] + 0.25, pts[1] + 0.35);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + 0.25, pts[i + 1] + 0.35);
  ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

/** Blotchy soot mark (confined to already-painted pixels via source-atop). */
function scorch(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(16,12,10,${a})`);
  g.addColorStop(0.55, `rgba(28,20,16,${a * 0.6})`);
  g.addColorStop(1, 'rgba(30,22,18,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.25, r * 0.85, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Small dent: shadowed crescent with a bright lower lip. */
function dent(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pal: TankPalette): void {
  ctx.fillStyle = colorAlpha(pal.paintDeep, 0.75);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.7, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorAlpha(pal.spec, 0.55);
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.7, -0.2, 0.2, Math.PI - 0.3);
  ctx.stroke();
}

function exhaust(ctx: CanvasRenderingContext2D, pal: TankPalette, wreck: boolean): void {
  // Short upswept pipe behind the rear deck.
  const x = EXHAUST_X, y = EXHAUST_Y;
  ctx.fillStyle = vgrad(ctx, y - 2, y + 2, [[0, wreck ? '#3a3533' : pal.metalLight], [0.5, wreck ? '#24201e' : pal.metal], [1, wreck ? '#141110' : pal.metalDark]]);
  ctx.beginPath();
  ctx.moveTo(x + 6, y - 1.5);
  ctx.lineTo(x - 0.4, y - 2.6);
  ctx.quadraticCurveTo(x - 2.1, y - 2.8, x - 2.3, y - 1.1);
  ctx.lineTo(x - 2.0, y + 1.0);
  ctx.lineTo(x + 6, y + 1.8);
  ctx.closePath();
  ctx.fill();
  // Pipe mouth.
  ctx.fillStyle = '#0b0b0d';
  ctx.beginPath();
  ctx.ellipse(x - 2.15, y - 0.8, 0.65, 1.55, 0.12, 0, Math.PI * 2);
  ctx.fill();
  // Heat ring.
  ctx.strokeStyle = wreck ? '#2a2422' : colorAlpha('#000000', 0.35);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x + 1.6, y - 2.4);
  ctx.lineTo(x + 1.8, y + 1.3);
  ctx.stroke();
}

function headlight(ctx: CanvasRenderingContext2D, pal: TankPalette, wreck: boolean): void {
  const x = HEADLIGHT_X, y = HEADLIGHT_Y;
  ctx.fillStyle = wreck ? '#1a1615' : pal.metalDark;
  ctx.beginPath();
  ctx.roundRect(x - 2.6, y - 1.9, 4.6, 3.8, 1.2);
  ctx.fill();
  if (wreck) {
    ctx.fillStyle = '#0b0a0a';
  } else {
    const g = ctx.createRadialGradient(x + 0.9, y - 0.3, 0, x + 0.9, y, 1.9);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, pal.lamp);
    g.addColorStop(1, '#c79a3c');
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  ctx.ellipse(x + 1.1, y, 1.05, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Visor.
  ctx.fillStyle = wreck ? '#2b2523' : pal.metal;
  ctx.beginPath();
  ctx.moveTo(x - 2.8, y - 2.0);
  ctx.lineTo(x + 2.6, y - 2.3);
  ctx.lineTo(x + 2.0, y - 1.3);
  ctx.lineTo(x - 2.6, y - 1.1);
  ctx.closePath();
  ctx.fill();
}

/** Stowage bin with a strap on the rear deck. */
function stowage(ctx: CanvasRenderingContext2D, pal: TankPalette, wreck: boolean): void {
  const x0 = -22.2, x1 = -15.4, y0 = -23.7, y1 = HULL_TOP + 0.3;
  ctx.fillStyle = wreck
    ? vgrad(ctx, y0, y1, [[0, '#3a3230'], [1, '#1a1513']])
    : vgrad(ctx, y0, y1, [[0, pal.metalLight], [0.35, pal.metal], [1, pal.metalDark]]);
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 0.8);
  ctx.fill();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 0.55;
  ctx.stroke();
  // Lid line and strap.
  ctx.fillStyle = wreck ? '#120f0e' : colorAlpha(pal.metalDark, 0.9);
  ctx.fillRect(x0 + 0.4, y0 + 1.1, x1 - x0 - 0.8, 0.35);
  ctx.fillStyle = wreck ? '#2a2321' : pal.paintDark;
  ctx.fillRect(x0 + 2.6, y0 - 0.1, 1.3, y1 - y0 + 0.1);
  ctx.fillStyle = wreck ? 'rgba(255,255,255,0.06)' : colorAlpha(pal.spec, 0.7);
  ctx.fillRect(x0 + 0.6, y0 + 0.35, x1 - x0 - 1.2, 0.35);
}

/** Team roundel on the hull side. */
function emblem(ctx: CanvasRenderingContext2D, pal: TankPalette, x: number, y: number): void {
  ctx.fillStyle = colorAlpha(pal.paintDeep, 0.55);
  ctx.beginPath();
  ctx.arc(x + 0.2, y + 0.3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.paintLight;
  ctx.beginPath();
  ctx.arc(x, y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.paint;
  ctx.beginPath();
  ctx.arc(x, y, 1.75, 0, Math.PI * 2);
  ctx.fill();
  // Forward chevron.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x - 0.7, y - 1.0);
  ctx.lineTo(x + 0.6, y);
  ctx.lineTo(x - 0.7, y + 1.0);
  ctx.stroke();
}

/** Paints hull body + skirt + deck details. Region: x -31..31, y -24..-8. */
export function paintHull(ctx: CanvasRenderingContext2D, pal: TankPalette, tier: DamageTier): void {
  const wreck = tier === 3;
  exhaust(ctx, pal, wreck);

  // --- Body ---------------------------------------------------------------------------
  const body = new Path2D();
  hullPath(body);
  ctx.fillStyle = wreck
    ? vgrad(ctx, HULL_TOP, -11, [[0, '#3a3230'], [0.5, '#2a2422'], [1, '#161211']])
    : vgrad(ctx, HULL_TOP, -11, [[0, pal.paintLight], [0.16, pal.paint], [0.7, pal.paint], [1, pal.paintDark]]);
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // Sloped faces: rear plate catches the key light, glacis falls into half shade.
  ctx.fillStyle = wreck ? 'rgba(255,255,255,0.05)' : colorAlpha(pal.spec, 0.22);
  ctx.beginPath();
  ctx.moveTo(-26, -11);
  ctx.lineTo(-24.2, -17.4);
  ctx.quadraticCurveTo(-23.6, -19.6, -21.4, -20.1);
  ctx.lineTo(-19.5, -20.3);
  ctx.lineTo(-21.6, -11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = wreck ? 'rgba(0,0,0,0.25)' : colorAlpha(pal.paintDeep, 0.28);
  ctx.beginPath();
  ctx.moveTo(18.4, -19.6);
  ctx.lineTo(28, -13.5);
  ctx.lineTo(28, -11);
  ctx.lineTo(20.4, -11);
  ctx.lineTo(15.6, -19.8);
  ctx.closePath();
  ctx.fill();
  // Specular deck strip.
  ctx.fillStyle = vgrad(ctx, HULL_TOP, HULL_TOP + 2.4, [[0, wreck ? 'rgba(255,200,170,0.10)' : colorAlpha(pal.spec, 0.8)], [1, colorAlpha(pal.spec, 0)]]);
  ctx.fillRect(-24, HULL_TOP, 44, 2.4);
  ctx.restore();

  // Panel lines.
  const gd = wreck ? '#0e0c0b' : colorAlpha(pal.paintDeep, 0.8);
  const gl = wreck ? 'rgba(255,255,255,0.06)' : colorAlpha(pal.paintLight, 0.55);
  groove(ctx, [-16.6, -20.2, -17.6, -13.8], gd, gl);
  groove(ctx, [6.2, -20.3, 6.2, -13.8], gd, gl);
  groove(ctx, [15.8, -19.9, 21.4, -13.8], gd, gl);
  // Engine grille on the rear deck.
  ctx.fillStyle = wreck ? '#0f0d0c' : colorAlpha(pal.paintDeep, 0.7);
  for (let i = 0; i < 4; i++) ctx.fillRect(-14.6 + i * 2.2, -19.6, 1.2, 2.6);
  ctx.fillStyle = wreck ? 'rgba(255,255,255,0.05)' : colorAlpha(pal.paintLight, 0.5);
  for (let i = 0; i < 4; i++) ctx.fillRect(-14.6 + i * 2.2, -17.0, 1.2, 0.35);

  // Rim light along the deck and glacis.
  ctx.strokeStyle = wreck ? 'rgba(255,150,100,0.38)' : colorAlpha(pal.rim, 0.95);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-23.9, -18.2);
  ctx.quadraticCurveTo(-23.4, -19.9, -21.4, -20.2);
  ctx.lineTo(-16.8, HULL_TOP + 0.15);
  ctx.lineTo(14.8, HULL_TOP + 0.15);
  ctx.quadraticCurveTo(17, HULL_TOP + 0.25, 18.4, -19.45);
  ctx.lineTo(25.2, -15.1);
  ctx.stroke();

  stowage(ctx, pal, wreck);
  headlight(ctx, pal, wreck);

  // --- Skirt --------------------------------------------------------------------------
  const skirt = new Path2D();
  skirtPath(skirt);
  ctx.fillStyle = wreck
    ? vgrad(ctx, SKIRT_TOP, SKIRT_BOTTOM, [[0, '#2e2826'], [1, '#141110']])
    : vgrad(ctx, SKIRT_TOP, SKIRT_BOTTOM, [[0, pal.paintLight], [0.22, pal.paint], [0.75, pal.paintDark], [1, pal.paintDeep]]);
  ctx.fill(skirt);
  // Under-lip shadow on the hull above the skirt.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(-26, SKIRT_TOP - 0.9, 53, 0.8);
  // Skirt top highlight and segment seams.
  ctx.strokeStyle = wreck ? 'rgba(255,160,110,0.14)' : colorAlpha(pal.rim, 0.85);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-27.4, SKIRT_TOP + 0.55);
  ctx.lineTo(27.6, SKIRT_TOP + 0.2);
  ctx.stroke();
  for (const sx of [-13.5, 0.5, 14.5]) groove(ctx, [sx, SKIRT_TOP + 0.7, sx - 0.3, SKIRT_BOTTOM - 0.4], gd, gl);
  for (let x = -24; x <= 24; x += 5.4) rivet(ctx, x, SKIRT_TOP + 1.7, 0.55, pal, wreck);
  if (!wreck) emblem(ctx, pal, -6.5, -16.6);

  // --- Damage -------------------------------------------------------------------------
  if (tier >= 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    scorch(ctx, -12.5, -16.2, 3.6, wreck ? 0.9 : 0.6);
    scorch(ctx, -20.5, -12.4, 3.4, 0.6);
    scorch(ctx, 22.5, -11.4, 2.6, 0.55);
    if (tier >= 2) {
      scorch(ctx, TORN_X, TORN_Y, 5.2, 0.85);
      scorch(ctx, 2, -19.6, 3.2, 0.5);
    }
    if (wreck) {
      scorch(ctx, -2, -15, 9, 0.7);
      scorch(ctx, 18, -14, 6, 0.8);
    }
    ctx.restore();
    if (!wreck) {
      dent(ctx, -1.6, -15.6, 1.3, pal);
      dent(ctx, 20.2, -11.2, 0.95, pal);
    }
  }
  if (tier >= 2) tornPanel(ctx, pal, wreck);
}

/** Missing plate exposing the hot interior (glow pulse is added live). */
function tornPanel(ctx: CanvasRenderingContext2D, pal: TankPalette, wreck: boolean): void {
  const x = TORN_X, y = TORN_Y;
  ctx.beginPath();
  ctx.moveTo(x - 3.6, y - 2.0);
  ctx.lineTo(x - 1.2, y - 2.6);
  ctx.lineTo(x - 0.4, y - 1.6);
  ctx.lineTo(x + 2.6, y - 2.4);
  ctx.lineTo(x + 3.4, y + 0.2);
  ctx.lineTo(x + 2.2, y + 1.9);
  ctx.lineTo(x - 0.8, y + 2.2);
  ctx.lineTo(x - 2.4, y + 1.2);
  ctx.lineTo(x - 3.9, y + 1.6);
  ctx.closePath();
  const g = ctx.createRadialGradient(x, y + 0.3, 0, x, y, 3.8);
  g.addColorStop(0, wreck ? '#ff9a3c' : '#ffd27a');
  g.addColorStop(0.35, '#ff6a1c');
  g.addColorStop(0.75, '#5a1408');
  g.addColorStop(1, '#140806');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = wreck ? '#3d3532' : pal.metalLight;
  ctx.lineWidth = 0.4;
  ctx.stroke();
  // Exposed ribs.
  ctx.strokeStyle = 'rgba(20,8,6,0.85)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(x - 1.4, y - 2.2);
  ctx.lineTo(x - 1.6, y + 1.8);
  ctx.moveTo(x + 1.2, y - 2.2);
  ctx.lineTo(x + 1.0, y + 1.9);
  ctx.stroke();
}

