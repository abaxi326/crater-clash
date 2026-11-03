/** Bake-time painters for the turret dome, barrel, wheels and tread band. */
import { BARREL_LENGTH } from '../../core/constants.ts';
import { colorAlpha } from './bake.ts';
import type { DamageTier } from './hull.ts';
import type { TankPalette } from './palette.ts';
import {
  BARREL_ROOT_W, BARREL_TIP_W, BRAKE_LEN, BRAKE_W, DOME_BASE, DOME_HALF_W, DOME_TOP, TREAD_CX, TREAD_CY, TREAD_R, TREAD_T,
  domePath, treadLoopPath,
} from './shape.ts';

/** Turret dome with base ring, hatch and periscope. Region: x -16..16, y -35..-18. */
export function paintDome(ctx: CanvasRenderingContext2D, pal: TankPalette, tier: DamageTier): void {
  // Periscope (behind the dome edge so it reads as sitting on top).
  ctx.fillStyle = pal.metalDark;
  ctx.beginPath();
  ctx.roundRect(4.2, DOME_TOP - 3.3, 4.4, 4.4, 0.8);
  ctx.fill();
  ctx.fillStyle = pal.metal;
  ctx.fillRect(4.6, DOME_TOP - 2.9, 3.6, 1.2);
  // Glass.
  const glass = ctx.createLinearGradient(7.4, 0, 8.7, 0);
  glass.addColorStop(0, '#2c6e8a');
  glass.addColorStop(1, '#b8f2ff');
  ctx.fillStyle = glass;
  ctx.fillRect(7.6, DOME_TOP - 2.7, 1.0, 1.9);

  // Dome shell: spherical shading with the key light up-left.
  const dome = new Path2D();
  domePath(dome);
  const g = ctx.createRadialGradient(-4.2, DOME_TOP + 2.6, 0.5, -1, DOME_BASE - 2, 16.5);
  g.addColorStop(0, pal.paintLight);
  g.addColorStop(0.3, pal.paint);
  g.addColorStop(0.78, pal.paintDark);
  g.addColorStop(1, pal.paintDeep);
  ctx.fillStyle = g;
  ctx.fill(dome);
  ctx.save();
  ctx.clip(dome);
  // Specular hotspot.
  const s = ctx.createRadialGradient(-4.6, DOME_TOP + 2.8, 0, -4.6, DOME_TOP + 2.8, 4.2);
  s.addColorStop(0, colorAlpha(pal.spec, 0.85));
  s.addColorStop(1, colorAlpha(pal.spec, 0));
  ctx.fillStyle = s;
  ctx.fillRect(-12, DOME_TOP - 1, 16, 10);
  // Weld seam across the dome.
  ctx.strokeStyle = colorAlpha(pal.paintDeep, 0.7);
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.ellipse(0, DOME_BASE + 2.4, DOME_HALF_W + 1, 7.6, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = colorAlpha(pal.paintLight, 0.45);
  ctx.beginPath();
  ctx.ellipse(0, DOME_BASE + 2.9, DOME_HALF_W + 1, 7.6, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  if (tier >= 1) {
    ctx.globalCompositeOperation = 'source-atop';
    const sc = ctx.createRadialGradient(7, -24.5, 0, 7, -24.5, 4.4);
    sc.addColorStop(0, 'rgba(18,13,11,0.8)');
    sc.addColorStop(1, 'rgba(18,13,11,0)');
    ctx.fillStyle = sc;
    ctx.fillRect(0, -32, 14, 14);
    if (tier >= 2) {
      const sc2 = ctx.createRadialGradient(-6, -21.5, 0, -6, -21.5, 3.6);
      sc2.addColorStop(0, 'rgba(18,13,11,0.75)');
      sc2.addColorStop(1, 'rgba(18,13,11,0)');
      ctx.fillStyle = sc2;
      ctx.fillRect(-12, -27, 12, 10);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  // Rim light on the upper-left shell.
  ctx.strokeStyle = colorAlpha(pal.rim, 0.9);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-DOME_HALF_W + 0.35, DOME_BASE - 1.5);
  ctx.bezierCurveTo(-DOME_HALF_W + 0.4, -26.2, -8.4, DOME_TOP + 0.35, 0.6, DOME_TOP + 0.35);
  ctx.stroke();

  // Hatch.
  ctx.fillStyle = colorAlpha(pal.paintDeep, 0.9);
  ctx.beginPath();
  ctx.ellipse(-2.6, DOME_TOP + 0.6, 4.4, 1.5, 0, Math.PI, 0);
  ctx.lineTo(1.8, DOME_TOP + 0.9);
  ctx.lineTo(-7, DOME_TOP + 0.9);
  ctx.fill();
  ctx.fillStyle = pal.paint;
  ctx.beginPath();
  ctx.ellipse(-2.6, DOME_TOP + 0.3, 3.9, 1.25, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colorAlpha(pal.spec, 0.7);
  ctx.fillRect(-5.4, DOME_TOP - 0.55, 3.4, 0.4);
  ctx.fillStyle = pal.metalLight;
  ctx.fillRect(-3.2, DOME_TOP - 1.6, 1.2, 0.55);
  if (tier >= 1) {
    // Dent on the dome flank.
    ctx.fillStyle = colorAlpha(pal.paintDeep, 0.7);
    ctx.beginPath();
    ctx.ellipse(9.2, -22.6, 1.3, 0.95, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorAlpha(pal.spec, 0.5);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.ellipse(9.2, -22.6, 1.3, 0.95, 0.5, 0.3, Math.PI - 0.2);
    ctx.stroke();
  }

  // Turret ring (traverse collar) where the dome meets the deck.
  const rg = ctx.createLinearGradient(0, DOME_BASE - 1.4, 0, DOME_BASE + 1.0);
  rg.addColorStop(0, pal.metalLight);
  rg.addColorStop(0.5, pal.metal);
  rg.addColorStop(1, pal.metalDark);
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.roundRect(-DOME_HALF_W - 1.2, DOME_BASE - 1.4, DOME_HALF_W * 2 + 2.6, 2.4, 1.1);
  ctx.fill();
  for (let x = -11; x <= 11; x += 3.6) {
    ctx.fillStyle = pal.metalDark;
    ctx.fillRect(x, DOME_BASE - 0.75, 0.7, 0.7);
  }
}

/** Gun barrel along +x from the pivot; muzzle brake ends at BARREL_LENGTH. Region: x -3..L+1, y -4..4. */
export function paintBarrel(ctx: CanvasRenderingContext2D, pal: TankPalette): void {
  const L = BARREL_LENGTH;
  const tube = ctx.createLinearGradient(0, -BARREL_ROOT_W / 2, 0, BARREL_ROOT_W / 2);
  tube.addColorStop(0, pal.metalLight);
  tube.addColorStop(0.3, '#ffffff');
  tube.addColorStop(0.42, pal.metalLight);
  tube.addColorStop(0.75, pal.metal);
  tube.addColorStop(1, pal.metalDark);
  ctx.fillStyle = tube;
  ctx.beginPath();
  ctx.moveTo(-2, -BARREL_ROOT_W / 2);
  ctx.lineTo(L - BRAKE_LEN, -BARREL_TIP_W / 2);
  ctx.lineTo(L - BRAKE_LEN, BARREL_TIP_W / 2);
  ctx.lineTo(-2, BARREL_ROOT_W / 2);
  ctx.closePath();
  ctx.fill();
  // Fume extractor bulge in team paint.
  const ex = ctx.createLinearGradient(0, -2.9, 0, 2.9);
  ex.addColorStop(0, pal.paintLight);
  ex.addColorStop(0.35, pal.paint);
  ex.addColorStop(1, pal.paintDeep);
  ctx.fillStyle = ex;
  ctx.beginPath();
  ctx.roundRect(L * 0.46, -2.75, 6.2, 5.5, 2.2);
  ctx.fill();
  ctx.fillStyle = colorAlpha(pal.spec, 0.75);
  ctx.fillRect(L * 0.46 + 1, -2.3, 4.2, 0.55);
  // Muzzle brake with vent slots.
  const br = ctx.createLinearGradient(0, -BRAKE_W / 2, 0, BRAKE_W / 2);
  br.addColorStop(0, pal.metalLight);
  br.addColorStop(0.25, '#f4f7fb');
  br.addColorStop(0.45, pal.metal);
  br.addColorStop(1, pal.metalDark);
  ctx.fillStyle = br;
  ctx.beginPath();
  ctx.roundRect(L - BRAKE_LEN, -BRAKE_W / 2, BRAKE_LEN, BRAKE_W, 1.1);
  ctx.fill();
  ctx.fillStyle = '#121419';
  ctx.fillRect(L - BRAKE_LEN + 1.5, -BRAKE_W / 2, 1.0, BRAKE_W);
  ctx.fillRect(L - BRAKE_LEN + 3.5, -BRAKE_W / 2, 1.0, BRAKE_W);
  ctx.fillStyle = '#07080a';
  ctx.fillRect(L - 0.55, -1.25, 0.55, 2.5);
  // Readability outline.
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-2, -BARREL_ROOT_W / 2);
  ctx.lineTo(L * 0.46, -(BARREL_ROOT_W - (BARREL_ROOT_W - BARREL_TIP_W) * 0.46) / 2);
  ctx.moveTo(L * 0.46 + 6.2, -(BARREL_ROOT_W - (BARREL_ROOT_W - BARREL_TIP_W) * 0.62) / 2);
  ctx.lineTo(L - BRAKE_LEN, -BARREL_TIP_W / 2);
  ctx.moveTo(-2, BARREL_ROOT_W / 2);
  ctx.lineTo(L * 0.46, (BARREL_ROOT_W - (BARREL_ROOT_W - BARREL_TIP_W) * 0.46) / 2);
  ctx.moveTo(L * 0.46 + 6.2, (BARREL_ROOT_W - (BARREL_ROOT_W - BARREL_TIP_W) * 0.62) / 2);
  ctx.lineTo(L - BRAKE_LEN, BARREL_TIP_W / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(L * 0.46, -2.75, 6.2, 5.5, 2.2);
  ctx.roundRect(L - BRAKE_LEN, -BRAKE_W / 2, BRAKE_LEN, BRAKE_W, 1.1);
  ctx.stroke();
}

/** Road wheel / sprocket / idler centred at the origin (rotated live). */
export function paintWheel(ctx: CanvasRenderingContext2D, pal: TankPalette, r: number, kind: 'road' | 'sprocket'): void {
  if (kind === 'sprocket') {
    ctx.fillStyle = pal.metalDark;
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.82;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = pal.rubber;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Disc (lit from above-left; fixed lighting is re-applied live by a static overlay).
  const d = ctx.createLinearGradient(-r, -r, r, r);
  d.addColorStop(0, pal.metalLight);
  d.addColorStop(0.55, pal.metal);
  d.addColorStop(1, pal.metalDark);
  ctx.fillStyle = d;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.fill();
  // Spokes / lightening holes so rotation reads.
  ctx.fillStyle = colorAlpha(pal.metalDark, 0.95);
  const n = kind === 'sprocket' ? 6 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  // Paint stripe on the hub.
  ctx.fillStyle = kind === 'sprocket' ? pal.paint : pal.metalLight;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.metalDark;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.2, 0, Math.PI * 2);
  ctx.stroke();
}

/** Static lighting over the rotating wheels: top light and bottom occlusion. */
export function paintWheelShade(ctx: CanvasRenderingContext2D, r: number): void {
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  ctx.fill();
}

/** Rubber tread band (links are drawn live on top). Region: x -28..28, y -12.5..0.5. */
export function paintTreadBand(ctx: CanvasRenderingContext2D, pal: TankPalette): void {
  const outer = new Path2D();
  treadLoopPath(outer, 0);
  const inner = new Path2D();
  treadLoopPath(inner, TREAD_T);
  // Band.
  ctx.fillStyle = pal.rubber;
  ctx.fill(outer);
  // Dark well behind the wheels.
  const w = ctx.createLinearGradient(0, TREAD_CY - TREAD_R, 0, 0);
  w.addColorStop(0, '#0a0b0e');
  w.addColorStop(1, '#16181d');
  ctx.fillStyle = w;
  ctx.fill(inner);
  // Inner guide rail.
  ctx.strokeStyle = colorAlpha(pal.link, 0.8);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-TREAD_CX, TREAD_CY + TREAD_R - TREAD_T - 0.4);
  ctx.lineTo(TREAD_CX, TREAD_CY + TREAD_R - TREAD_T - 0.4);
  ctx.stroke();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 0.8;
  ctx.stroke(outer);
}
