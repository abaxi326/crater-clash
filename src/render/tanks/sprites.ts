/** Per-palette sprite sets, baked lazily and cached (team × biome × damage tier). */
import { BARREL_LENGTH } from '../../core/constants.ts';
import { type Sprite, bake, beamSprite, colorAlpha, glowSprite, makeCanvas, outlined, silhouette } from './bake.ts';
import { type DamageTier, paintHull } from './hull.ts';
import type { TankPalette } from './palette.ts';
import { paintBarrel, paintDome, paintTreadBand, paintWheel, paintWheelShade } from './parts.ts';
import { DOME_BASE, DOME_HALF_W, ROAD_WHEEL_R, SPROCKET_R } from './shape.ts';

export const OUTLINE_W = 0.75;
export const SHIELD_R = 37;

export interface TankSprites {
  band: Sprite;
  road: Sprite;
  roadShade: Sprite;
  sprocket: Sprite;
  sprocketShade: Sprite;
  hull: Sprite[];
  dome: Sprite[];
  barrel: Sprite;
  /** White-hot silhouettes for the hit flash. */
  hullFlash: Sprite;
  domeFlash: Sprite;
  barrelFlash: Sprite;
  /** Wreck: charred hull and the bare turret ring. */
  wreckRing: Sprite;
  /** Hexagonal energy bubble (radius SHIELD_R, centred). */
  shield: HTMLCanvasElement;
  /** Additive glow sprites (looked up once here so draw() does no keyed lookups). */
  lampGlow: HTMLCanvasElement;
  beam: HTMLCanvasElement;
  tipGlow: HTMLCanvasElement;
  ringGlow: HTMLCanvasElement;
  heat: HTMLCanvasElement;
  ember: HTMLCanvasElement;
}

const cache = new Map<string, TankSprites>();

const hotFill = (y0: number, y1: number) => (ctx: CanvasRenderingContext2D): CanvasGradient => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#fff4dc');
  g.addColorStop(1, '#ffd29a');
  return g;
};

export function tankSprites(pal: TankPalette): TankSprites {
  const hit = cache.get(pal.key);
  if (hit) return hit;
  const hull: Sprite[] = [];
  for (let t = 0; t <= 3; t++) {
    hull.push(outlined(bake(-31, -24.5, 62, 16.5, (ctx) => paintHull(ctx, pal, t as DamageTier)), pal.outline, OUTLINE_W));
  }
  const dome: Sprite[] = [];
  for (let t = 0; t <= 2; t++) {
    dome.push(outlined(bake(-16, -35, 32, 17.5, (ctx) => paintDome(ctx, pal, t as DamageTier)), pal.outline, OUTLINE_W));
  }
  const barrel = bake(-3, -3.6, BARREL_LENGTH + 4, 7.2, (ctx) => paintBarrel(ctx, pal));
  const rr = ROAD_WHEEL_R, sr = SPROCKET_R;
  const set: TankSprites = {
    band: bake(-28, -12.5, 56, 13, (ctx) => paintTreadBand(ctx, pal)),
    road: bake(-rr - 0.2, -rr - 0.2, rr * 2 + 0.4, rr * 2 + 0.4, (ctx) => paintWheel(ctx, pal, rr, 'road')),
    roadShade: bake(-rr, -rr, rr * 2, rr * 2, (ctx) => paintWheelShade(ctx, rr)),
    sprocket: bake(-sr - 0.2, -sr - 0.2, sr * 2 + 0.4, sr * 2 + 0.4, (ctx) => paintWheel(ctx, pal, sr, 'sprocket')),
    sprocketShade: bake(-sr, -sr, sr * 2, sr * 2, (ctx) => paintWheelShade(ctx, sr)),
    hull,
    dome,
    barrel,
    hullFlash: silhouette(hull[0], hotFill(-24, -8)),
    domeFlash: silhouette(dome[0], hotFill(-35, -18)),
    barrelFlash: silhouette(barrel, '#fff6e4'),
    wreckRing: outlined(bake(-16, -23.5, 32, 5, (ctx) => paintWreckRing(ctx)), pal.outline, OUTLINE_W),
    shield: paintShield(pal),
    lampGlow: glowSprite(pal.lamp, 0.6),
    beam: beamSprite(pal.lamp),
    tipGlow: glowSprite(pal.glow, 0.8),
    ringGlow: glowSprite(pal.glow, 0.25),
    heat: glowSprite('#ff6a1c', 0.5),
    ember: glowSprite('#ff6a1c', 0.7),
  };
  cache.set(pal.key, set);
  return set;
}

/** Charred turret ring left behind when the dome is blown off. */
function paintWreckRing(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, DOME_BASE - 2, 0, DOME_BASE + 1);
  g.addColorStop(0, '#4a403b');
  g.addColorStop(0.5, '#27211f');
  g.addColorStop(1, '#100d0c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-DOME_HALF_W - 1.2, DOME_BASE - 1.8, DOME_HALF_W * 2 + 2.6, 2.8, 1.1);
  ctx.fill();
  // Torn jagged lip of the ring.
  ctx.fillStyle = '#1c1715';
  ctx.beginPath();
  ctx.moveTo(-11.5, DOME_BASE - 1.6);
  const pts = [-9.6, -3.4, -7.8, -2.2, -5.2, -3.9, -2.4, -2.0, 0.4, -3.1, 3.3, -1.9, 6.0, -3.6, 8.4, -2.1, 10.8, -2.8];
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], DOME_BASE + pts[i + 1]);
  ctx.lineTo(11.8, DOME_BASE - 1.6);
  ctx.closePath();
  ctx.fill();
  // Hot inner glow of the open ring.
  const h = ctx.createLinearGradient(0, DOME_BASE - 2.2, 0, DOME_BASE - 0.6);
  h.addColorStop(0, 'rgba(255,120,40,0)');
  h.addColorStop(1, 'rgba(255,120,40,0.55)');
  ctx.fillStyle = h;
  ctx.fillRect(-10, DOME_BASE - 2.2, 20, 1.6);
}

/** Hex-lattice energy bubble with a fresnel edge. Canvas covers [-SHIELD_R-4, SHIELD_R+4]² at 2x. */
function paintShield(pal: TankPalette): HTMLCanvasElement {
  const S = 2, R = SHIELD_R, pad = 4;
  const size = (R + pad) * 2 * S;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(S, 0, 0, S, (R + pad) * S, (R + pad) * S);
  // Hex lattice.
  const hx = 6.2;
  const hw = Math.sqrt(3) * hx;
  ctx.strokeStyle = colorAlpha(pal.glow, 1);
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (let row = -8; row <= 8; row++) {
    for (let col = -6; col <= 6; col++) {
      const cx = col * hw + (row & 1 ? hw / 2 : 0);
      const cy = row * hx * 1.5;
      if (cx * cx + cy * cy > (R + hx) * (R + hx)) continue;
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI / 6 + (k * Math.PI) / 3;
        const a1 = a0 + Math.PI / 3;
        ctx.moveTo(cx + Math.cos(a0) * hx * 0.94, cy + Math.sin(a0) * hx * 0.94);
        ctx.lineTo(cx + Math.cos(a1) * hx * 0.94, cy + Math.sin(a1) * hx * 0.94);
      }
    }
  }
  ctx.stroke();
  // Lattice fades toward the middle (seen face-on) — fresnel falloff.
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  m.addColorStop(0, 'rgba(0,0,0,0.12)');
  m.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  m.addColorStop(0.92, 'rgba(0,0,0,0.85)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = m;
  ctx.fillRect(-R - pad, -R - pad, (R + pad) * 2, (R + pad) * 2);
  // Body tint + fresnel rim.
  ctx.globalCompositeOperation = 'destination-over';
  const f = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R + 1.5);
  f.addColorStop(0, colorAlpha(pal.glow, 0.05));
  f.addColorStop(0.7, colorAlpha(pal.glow, 0.12));
  f.addColorStop(0.9, colorAlpha(pal.glow, 0.42));
  f.addColorStop(0.965, colorAlpha('#ffffff', 0.75));
  f.addColorStop(1, colorAlpha(pal.glow, 0));
  ctx.fillStyle = f;
  ctx.beginPath();
  ctx.arc(0, 0, R + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Glassy specular arc up-left.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, R - 4, Math.PI * 1.08, Math.PI * 1.38);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(0, 0, R - 4, Math.PI * 1.44, Math.PI * 1.52);
  ctx.stroke();
  return c;
}
