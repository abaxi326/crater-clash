/**
 * Pre-rendered crate art: the crate body (wood planks, steel corner brackets, weapon-colour band,
 * stencilled glyph badge) and the parachute canopy, cached per weapon at high resolution.
 */
import { mixHex, shadeHex } from '../../core/color.ts';
import { CRATE_SIZE } from '../../core/constants.ts';
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';

/** Sprite pixels per world unit (crisp up to ~2× zoom on dpr 2). */
const RES = 5;
/** Crate box in world units (bottom-centre anchored). */
export const CRATE_W = CRATE_SIZE;
export const CRATE_H = CRATE_SIZE * 0.92;
/** Margin around the crate sprite (world units) for outline/shadow. */
export const CRATE_PAD = 2;
export const CANOPY_W = 58;
export const CANOPY_H = 30;

const crateCache = new Map<WeaponId, HTMLCanvasElement>();
const canopyCache = new Map<WeaponId, HTMLCanvasElement>();

/** Simple stencil glyph per weapon (unit space, radius ~1). */
export function traceGlyph(g: CanvasRenderingContext2D, id: WeaponId): void {
  g.beginPath();
  switch (id) {
    case 'thunderhead': // bomb with fuse spark
      g.arc(-0.1, 0.15, 0.62, 0, Math.PI * 2);
      g.moveTo(0.3, -0.35); g.lineTo(0.55, -0.62); g.lineTo(0.72, -0.48); g.lineTo(0.45, -0.22);
      g.moveTo(0.78, -0.95); g.lineTo(0.88, -0.78); g.lineTo(1.0, -0.86); g.lineTo(0.9, -0.7); g.lineTo(0.98, -0.62); g.lineTo(0.8, -0.66); g.closePath();
      break;
    case 'trident': // three prongs
      for (const x of [-0.6, 0, 0.6]) {
        g.moveTo(x, -0.95); g.lineTo(x + 0.2, -0.5); g.lineTo(x + 0.1, -0.5); g.lineTo(x + 0.1, 0.1);
        g.lineTo(x - 0.1, 0.1); g.lineTo(x - 0.1, -0.5); g.lineTo(x - 0.2, -0.5); g.closePath();
      }
      g.rect(-0.7, 0.05, 1.4, 0.2);
      g.rect(-0.11, 0.2, 0.22, 0.8);
      break;
    case 'starfall':
    case 'fireworks': {
      const n = id === 'starfall' ? 5 : 8;
      const inner = id === 'starfall' ? 0.42 : 0.3;
      for (let i = 0; i <= n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const r = i % 2 === 0 ? 1 : inner;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      break;
    }
    case 'burrower': // drill bit pointing down
      g.moveTo(-0.55, -0.95); g.lineTo(0.55, -0.95); g.lineTo(0.55, -0.45); g.lineTo(0, 1); g.lineTo(-0.55, -0.45); g.closePath();
      break;
    case 'seeker': // crosshair
      g.arc(0, 0, 0.78, 0, Math.PI * 2); g.arc(0, 0, 0.52, 0, Math.PI * 2, true);
      g.rect(-0.1, -1, 0.2, 0.55); g.rect(-0.1, 0.45, 0.2, 0.55); g.rect(-1, -0.1, 0.55, 0.2); g.rect(0.45, -0.1, 0.55, 0.2);
      g.moveTo(0.18, 0); g.arc(0, 0, 0.18, 0, Math.PI * 2);
      break;
    case 'magma': // droplet
      g.moveTo(0, -1); g.bezierCurveTo(0.35, -0.45, 0.75, -0.05, 0.75, 0.3);
      g.arc(0, 0.3, 0.75, 0, Math.PI); g.bezierCurveTo(-0.75, -0.05, -0.35, -0.45, 0, -1); g.closePath();
      break;
    case 'tesla': // lightning bolt
      g.moveTo(0.25, -1); g.lineTo(-0.55, 0.12); g.lineTo(-0.05, 0.12); g.lineTo(-0.3, 1); g.lineTo(0.6, -0.2); g.lineTo(0.08, -0.2); g.lineTo(0.4, -1); g.closePath();
      break;
    case 'singularity': // ring with core
      g.arc(0, 0, 0.95, 0, Math.PI * 2); g.arc(0, 0, 0.66, 0, Math.PI * 2, true);
      g.moveTo(0.36, 0); g.arc(0, 0, 0.36, 0, Math.PI * 2);
      break;
    case 'sunbeam': // sun with rays
      g.moveTo(0.42, 0); g.arc(0, 0, 0.42, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const c = Math.cos(a), s = Math.sin(a), pc = Math.cos(a + 0.2), ps = Math.sin(a + 0.2), mc = Math.cos(a - 0.2), ms = Math.sin(a - 0.2);
        g.moveTo(mc * 0.58, ms * 0.58); g.lineTo(c * 1, s * 1); g.lineTo(pc * 0.58, ps * 0.58); g.closePath();
      }
      break;
    case 'faultline': // zigzag crack
      g.moveTo(-0.2, -1); g.lineTo(0.35, -1); g.lineTo(0.05, -0.3); g.lineTo(0.5, -0.3); g.lineTo(-0.3, 1); g.lineTo(-0.05, 0.1); g.lineTo(-0.5, 0.1); g.closePath();
      break;
    case 'repair': // plus
      g.rect(-0.28, -0.9, 0.56, 1.8); g.rect(-0.9, -0.28, 1.8, 0.56);
      break;
    case 'aegis': // hex shield
      for (let i = 0; i <= 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        if (i === 0) g.moveTo(Math.cos(a), Math.sin(a)); else g.lineTo(Math.cos(a), Math.sin(a));
      }
      for (let i = 6; i >= 0; i--) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        g.lineTo(Math.cos(a) * 0.62, Math.sin(a) * 0.62);
      }
      g.closePath();
      break;
    case 'blink': // diamond with orbit
      g.moveTo(0, -1); g.lineTo(0.55, 0); g.lineTo(0, 1); g.lineTo(-0.55, 0); g.closePath();
      break;
    default: // shell silhouette
      g.moveTo(-0.35, 1); g.lineTo(-0.35, -0.2); g.quadraticCurveTo(-0.35, -0.8, 0, -1); g.quadraticCurveTo(0.35, -0.8, 0.35, -0.2); g.lineTo(0.35, 1); g.closePath();
      break;
  }
}

/** Crate body sprite (CRATE_W × CRATE_H plus CRATE_PAD margin), drawn with its bottom-centre at the anchor. */
export function crateSprite(id: WeaponId): HTMLCanvasElement {
  let c = crateCache.get(id);
  if (c) return c;
  const w = WEAPONS[id];
  c = document.createElement('canvas');
  c.width = Math.ceil((CRATE_W + CRATE_PAD * 2) * RES);
  c.height = Math.ceil((CRATE_H + CRATE_PAD * 2) * RES);
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  g.translate(CRATE_PAD, CRATE_PAD);
  const W = CRATE_W, H = CRATE_H, rim = 2.4;
  // Outline / body.
  g.fillStyle = '#21140c';
  roundRect(g, -0.6, -0.6, W + 1.2, H + 1.2, 2.2);
  g.fill();
  const wood = g.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#d39a5c');
  wood.addColorStop(0.5, '#a96d38');
  wood.addColorStop(1, '#6e4320');
  g.fillStyle = wood;
  roundRect(g, 0, 0, W, H, 1.6);
  g.fill();
  // Planks + grain.
  g.save();
  roundRect(g, 0, 0, W, H, 1.6);
  g.clip();
  const planks = 4;
  for (let i = 1; i < planks; i++) {
    const y = (H * i) / planks;
    g.fillStyle = 'rgba(40,20,8,0.55)';
    g.fillRect(0, y - 0.35, W, 0.5);
    g.fillStyle = 'rgba(255,220,170,0.25)';
    g.fillRect(0, y + 0.15, W, 0.35);
  }
  g.strokeStyle = 'rgba(70,38,14,0.28)';
  g.lineWidth = 0.25;
  for (let i = 0; i < 14; i++) {
    const y = ((i * 7.3) % H);
    const x = ((i * 5.7) % (W - 6)) + 1;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 3, y + 0.6, x + 6, y);
    g.stroke();
  }
  // Weapon band.
  const bandY = H * 0.36, bandH = H * 0.3;
  const band = g.createLinearGradient(0, bandY, 0, bandY + bandH);
  band.addColorStop(0, mixHex(w.color, '#ffffff', 0.35));
  band.addColorStop(0.5, w.color);
  band.addColorStop(1, shadeHex(w.color, 0.6));
  g.fillStyle = band;
  g.fillRect(0, bandY, W, bandH);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, bandY + bandH, W, 0.5);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, bandY, W, 0.35);
  // Top-lit bevel and bottom shade.
  const bevel = g.createLinearGradient(0, 0, 0, H);
  bevel.addColorStop(0, 'rgba(255,240,210,0.35)');
  bevel.addColorStop(0.12, 'rgba(255,240,210,0)');
  bevel.addColorStop(0.85, 'rgba(0,0,0,0)');
  bevel.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = bevel;
  g.fillRect(0, 0, W, H);
  g.restore();
  // Steel corner brackets with rivets.
  const steel = g.createLinearGradient(0, 0, W, H);
  steel.addColorStop(0, '#e9eef5');
  steel.addColorStop(0.5, '#8c96a6');
  steel.addColorStop(1, '#4b5260');
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]] as const) {
    g.fillStyle = steel;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + sx * 6, cy);
    g.lineTo(cx + sx * 6, cy + sy * rim);
    g.lineTo(cx + sx * rim, cy + sy * rim);
    g.lineTo(cx + sx * rim, cy + sy * 6);
    g.lineTo(cx, cy + sy * 6);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(20,14,10,0.6)';
    g.lineWidth = 0.3;
    g.stroke();
    g.fillStyle = '#f6f8fb';
    g.beginPath();
    g.arc(cx + sx * 1.2, cy + sy * 1.2, 0.48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.arc(cx + sx * 1.32, cy + sy * 1.36, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // Stencil badge.
  const bx = W / 2, by = H * 0.51, br = H * 0.3;
  g.fillStyle = '#1b1416';
  g.beginPath();
  g.arc(bx, by, br, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = mixHex(w.color, '#ffffff', 0.45);
  g.lineWidth = 0.55;
  g.stroke();
  g.save();
  g.translate(bx, by);
  g.scale(br * 0.62, br * 0.62);
  traceGlyph(g, id);
  g.fillStyle = mixHex(w.color, '#ffffff', 0.55);
  g.fill('evenodd');
  g.restore();
  crateCache.set(id, c);
  return c;
}

/** Parachute canopy sprite (CANOPY_W × CANOPY_H) with alternating gores and a scalloped hem. */
export function canopySprite(id: WeaponId): HTMLCanvasElement {
  let c = canopyCache.get(id);
  if (c) return c;
  const w = WEAPONS[id];
  c = document.createElement('canvas');
  c.width = Math.ceil(CANOPY_W * RES);
  c.height = Math.ceil(CANOPY_H * RES);
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  const W = CANOPY_W, H = CANOPY_H, cx = W / 2;
  const gores = 7;
  const hemY = H - 4;
  // Dome path: top arc + scalloped hem.
  const dome = (): void => {
    g.beginPath();
    g.moveTo(1, hemY);
    g.bezierCurveTo(1, 4, W * 0.2, 0.6, cx, 0.6);
    g.bezierCurveTo(W * 0.8, 0.6, W - 1, 4, W - 1, hemY);
    for (let i = gores; i > 0; i--) {
      const x0 = 1 + ((W - 2) * i) / gores, x1 = 1 + ((W - 2) * (i - 1)) / gores;
      g.quadraticCurveTo((x0 + x1) / 2, hemY - 2.6, x1, hemY);
    }
    g.closePath();
  };
  dome();
  g.fillStyle = '#f4f1ea';
  g.fill();
  g.save();
  dome();
  g.clip();
  // Alternate gores in the weapon colour (wedges converging toward the apex).
  for (let i = 0; i < gores; i++) {
    if (i % 2 === 0) continue;
    const x0 = 1 + ((W - 2) * i) / gores, x1 = 1 + ((W - 2) * (i + 1)) / gores;
    g.fillStyle = w.color;
    g.beginPath();
    g.moveTo(cx + (x0 - cx) * 0.18, 0);
    g.lineTo(x0, hemY + 1);
    g.lineTo(x1, hemY + 1);
    g.lineTo(cx + (x1 - cx) * 0.18, 0);
    g.closePath();
    g.fill();
  }
  // Seams.
  g.strokeStyle = 'rgba(60,40,40,0.35)';
  g.lineWidth = 0.3;
  for (let i = 1; i < gores; i++) {
    const x = 1 + ((W - 2) * i) / gores;
    g.beginPath();
    g.moveTo(cx + (x - cx) * 0.18, 0);
    g.lineTo(x, hemY + 1);
    g.stroke();
  }
  // Volume: light from the upper-left, shaded underside rim.
  const shade = g.createRadialGradient(W * 0.36, H * 0.2, 1, cx, H * 0.5, W * 0.62);
  shade.addColorStop(0, 'rgba(255,255,255,0.45)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(30,10,30,0.4)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const hem = g.createLinearGradient(0, hemY - 6, 0, hemY);
  hem.addColorStop(0, 'rgba(0,0,0,0)');
  hem.addColorStop(1, 'rgba(20,10,20,0.35)');
  g.fillStyle = hem;
  g.fillRect(0, hemY - 6, W, 8);
  g.restore();
  dome();
  g.strokeStyle = 'rgba(30,20,24,0.75)';
  g.lineWidth = 0.6;
  g.stroke();
  canopyCache.set(id, c);
  return c;
}

/** Hem attachment points (x offsets from canopy centre) where rigging lines meet the canopy. */
export const RIG_POINTS = [-0.47, -0.2, 0.2, 0.47] as const;
export const CANOPY_HEM_Y = CANOPY_H - 4;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
