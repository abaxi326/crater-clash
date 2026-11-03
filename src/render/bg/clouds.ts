/** Volumetric-looking cloud sprites (pre-rendered puffs with lit tops and shaded bellies) drifting with the wind. */
import type { BiomeDef } from '../../core/biomes.ts';
import { mixHex, rgba } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';
import { PERIOD, ctx2d, makeCanvas, mulberry } from './util.ts';

export interface Cloud {
  sprite: number;
  /** Layer-space position of the sprite centre (x wraps over PERIOD). */
  x: number;
  y: number;
  /** Layer-space width; height follows the sprite aspect. */
  w: number;
  h: number;
  depth: number;
  alpha: number;
  /** Individual speed multiplier. */
  speed: number;
}

export interface CloudSet {
  sprites: HTMLCanvasElement[];
  clouds: Cloud[];
}

interface CloudLook {
  lit: string;
  mid: string;
  shade: string;
  /** Light from below (sunset), else from above. */
  under: boolean;
  count: number;
  yMin: number;
  yMax: number;
  /** Flatness: 1 = cumulus, < 1 = stretched strata. */
  puffy: number;
}

function lookFor(b: BiomeDef): CloudLook | null {
  const p = b.palette;
  switch (b.id) {
    case 'verdant':
      return { lit: '#ffffff', mid: '#f1f6fc', shade: mixHex(p.sky[1], '#9fb0c8', 0.55), under: false, count: 10, yMin: 40, yMax: 330, puffy: 1 };
    case 'frost':
      return { lit: '#ffffff', mid: '#eef4fb', shade: mixHex(p.sky[1], '#8ea6c4', 0.6), under: false, count: 11, yMin: 20, yMax: 250, puffy: 0.75 };
    case 'dunes':
      return { lit: '#ffd08a', mid: mixHex(p.sky[1], '#ff8f6a', 0.5), shade: mixHex(p.sky[0], p.sky[1], 0.35), under: true, count: 12, yMin: 0, yMax: 280, puffy: 0.3 };
    default:
      return null;
  }
}

/** One cloud sprite: overlapping shaded puffs, soft flat-ish base, slight blur. */
function cloudSprite(look: CloudLook, rnd: () => number, wPx: number): HTMLCanvasElement {
  const hPx = Math.round(wPx * (0.32 + 0.16 * look.puffy));
  const pad = Math.round(wPx * 0.06);
  const raw = makeCanvas(wPx + pad * 2, hPx + pad * 2);
  const g = ctx2d(raw);
  const baseY = pad + hPx * 0.86;
  const n = 9 + Math.floor(rnd() * 8);
  // Puffs: a low wide base row, a taller middle row and small cauliflower crowns.
  const puffs: number[] = [];
  for (let row = 0; row < 3; row++) {
    const m = row === 2 ? Math.ceil(n * 0.5) : n;
    for (let i = 0; i < m; i++) {
      const t = row === 2 ? 0.25 + ((i + rnd()) / m) * 0.5 : (i + 0.5) / m;
      const bell = Math.sin(t * Math.PI);
      const k = [0.75, 1, 0.55][row];
      const r = wPx * (0.045 + 0.1 * bell * (0.6 + rnd() * 0.5)) * k * (0.7 + look.puffy * 0.3);
      const cx = pad + wPx * (0.08 + t * 0.84) + (rnd() - 0.5) * wPx * 0.05;
      const lift = row === 0 ? r * 0.6 : row === 1 ? r * (0.7 + bell * 0.9 * look.puffy) : r * (1.6 + bell * 2.6 * look.puffy);
      const cy = baseY - lift + (rnd() - 0.5) * r * 0.2;
      puffs.push(cx, Math.max(r + 1, cy), r);
    }
  }
  g.fillStyle = look.mid;
  g.beginPath();
  for (let i = 0; i < puffs.length; i += 3) {
    g.moveTo(puffs[i] + puffs[i + 2], puffs[i + 1]);
    g.arc(puffs[i], puffs[i + 1], puffs[i + 2], 0, TAU);
  }
  g.fill();
  g.globalCompositeOperation = 'source-atop';
  // Each puff: a soft lit cap toward the light and a faint shadow on the opposite side.
  for (let i = 0; i < puffs.length; i += 3) {
    const cx = puffs[i], cy = puffs[i + 1], r = puffs[i + 2];
    const dir = look.under ? 1 : -1;
    const sh = g.createRadialGradient(cx + r * 0.25, cy - dir * r * 0.5, 0, cx + r * 0.25, cy - dir * r * 0.5, r * 1.1);
    sh.addColorStop(0, rgba(look.shade, 0.32));
    sh.addColorStop(1, rgba(look.shade, 0));
    g.fillStyle = sh;
    g.fillRect(cx - r * 1.5, cy - r * 1.7, r * 3, r * 3.4);
    const hl = g.createRadialGradient(cx - r * 0.2, cy + dir * r * 0.35, 0, cx - r * 0.2, cy + dir * r * 0.35, r * 0.95);
    hl.addColorStop(0, rgba(look.lit, 0.95));
    hl.addColorStop(0.5, rgba(look.lit, 0.45));
    hl.addColorStop(1, rgba(look.lit, 0));
    g.fillStyle = hl;
    g.fillRect(cx - r * 1.3, cy - r * 1.4, r * 2.6, r * 2.8);
  }
  // Belly: darken (or warm-light) the lower part to read as volume.
  const belly = g.createLinearGradient(0, pad, 0, baseY);
  if (look.under) {
    belly.addColorStop(0, rgba(look.shade, 0.35));
    belly.addColorStop(0.6, rgba(look.shade, 0));
    belly.addColorStop(1, rgba(look.lit, 0.35));
  } else {
    belly.addColorStop(0, rgba('#ffffff', 0.25));
    belly.addColorStop(0.55, rgba('#ffffff', 0));
    belly.addColorStop(1, rgba(look.shade, 0.55));
  }
  g.fillStyle = belly;
  g.fillRect(0, 0, raw.width, raw.height);
  // Soft flat base.
  g.globalCompositeOperation = 'destination-out';
  const cut = g.createLinearGradient(0, baseY - hPx * 0.1, 0, baseY + hPx * 0.08);
  cut.addColorStop(0, 'rgba(0,0,0,0)');
  cut.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = cut;
  g.fillRect(0, baseY - hPx * 0.1, raw.width, raw.height);
  // Final pass with a light blur (build time only) for soft edges.
  const out = makeCanvas(raw.width, raw.height);
  const o = ctx2d(out);
  o.filter = `blur(${Math.max(0.6, wPx * (look.under ? 0.004 : 0.008)).toFixed(1)}px)`;
  o.drawImage(raw, 0, 0);
  o.filter = 'none';
  return out;
}

export function buildClouds(b: BiomeDef, res: number, seed: number): CloudSet | null {
  const look = lookFor(b);
  if (!look) return null;
  const rnd = mulberry(seed + 2024);
  const sprites: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i++) sprites.push(cloudSprite(look, rnd, Math.round((520 + rnd() * 160) * res)));
  const clouds: Cloud[] = [];
  for (let i = 0; i < look.count; i++) {
    const depth = 0.03 + (i / look.count) * 0.3 + rnd() * 0.04;
    const near = (depth - 0.03) / 0.34;
    const sprite = Math.floor(rnd() * sprites.length);
    const w = (180 + rnd() * 220) * (0.6 + near * 0.8) * (look.puffy < 0.7 ? 1.5 : 1);
    const sp = sprites[sprite];
    clouds.push({
      sprite, x: rnd() * PERIOD, y: look.yMin + (look.yMax - look.yMin) * rnd(),
      w, h: (w * sp.height) / sp.width, depth, alpha: 0.55 + near * 0.45, speed: 0.7 + rnd() * 0.6,
    });
  }
  clouds.sort((a, c) => a.depth - c.depth);
  return { sprites, clouds };
}
