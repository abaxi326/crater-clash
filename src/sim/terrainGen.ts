/**
 * Procedural terrain: biome-specific landforms plus a layered, textured soil palette.
 * Deterministic for a given (biome, seed).
 */
import { BEDROCK_ROWS, WORLD_H, WORLD_W } from '../core/constants.ts';
import type { BiomeDef } from '../core/biomes.ts';
import { hexToRgb, packRGBA, type RGB } from '../core/color.ts';
import { clamp, lerp, smoothstep } from '../core/math.ts';
import { Rng, fbm1D, hash2, hashInt, makeNoise1D } from '../core/rng.ts';
import { Terrain, type PixelPainter } from './terrain.ts';

export interface GeneratedTerrain {
  terrain: Terrain;
  /** Original surface height (y) per column. */
  surface: Float32Array;
  /** Tank spawn x positions [left player, right player]; the ground there is flattened. */
  spawns: [number, number];
}

const TILE = 512;
const TILE_MASK = TILE - 1;

/** Tileable fractal value noise in [-1, 1], TILE × TILE, row-major. */
function tileNoise(seed: number, cells: number, octaves: number): Float32Array {
  const out = new Float32Array(TILE * TILE);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const cellSize = TILE / c;
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < c * c; i++) lattice[i] = hash2(seed + o * 101, i % c, Math.floor(i / c)) * 2 - 1;
    for (let y = 0; y < TILE; y++) {
      const fy = y / cellSize, iy = Math.floor(fy), ty0 = fy - iy;
      const ty = ty0 * ty0 * (3 - 2 * ty0);
      const r0 = (iy % c) * c, r1 = ((iy + 1) % c) * c;
      for (let x = 0; x < TILE; x++) {
        const fx = x / cellSize, ix = Math.floor(fx), tx0 = fx - ix;
        const tx = tx0 * tx0 * (3 - 2 * tx0);
        const c0 = ix % c, c1 = (ix + 1) % c;
        const a = lattice[r0 + c0], b = lattice[r0 + c1], cc = lattice[r1 + c0], d = lattice[r1 + c1];
        const top = a + (b - a) * tx, bottom = cc + (d - cc) * tx;
        out[y * TILE + x] += (top + (bottom - top) * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

const sampleTile = (tex: Float32Array, x: number, y: number): number => tex[((y | 0) & TILE_MASK) * TILE + ((x | 0) & TILE_MASK)];

function boxBlur(src: Float32Array, radius: number): Float32Array {
  if (radius <= 0) return src;
  const out = new Float32Array(src.length);
  for (let x = 0; x < src.length; x++) {
    let sum = 0, n = 0;
    for (let k = -radius; k <= radius; k++) {
      const i = x + k;
      if (i >= 0 && i < src.length) { sum += src[i]; n++; }
    }
    out[x] = sum / n;
  }
  return out;
}

/** Surface profile (y per column) before spawn flattening. */
function profile(biome: BiomeDef, seed: number, rng: Rng): Float32Array {
  const { style, base, amplitude: A, roughness: R } = biome.terrain;
  const y0 = base * WORLD_H;
  const n1 = makeNoise1D(hashInt(seed + 11));
  const n2 = makeNoise1D(hashInt(seed + 23));
  const n3 = makeNoise1D(hashInt(seed + 37));
  const hts = new Float32Array(WORLD_W);
  const riftCenter = rng.range(0.42, 0.58) * WORLD_W;
  const riftWidth = rng.range(70, 110);
  for (let x = 0; x < WORLD_W; x++) {
    let h: number;
    switch (style) {
      case 'hills': {
        const big = fbm1D(n1, x / 540, 3);
        const mid = fbm1D(n2, x / 180, 3) * 0.32 * (0.5 + R);
        h = y0 - A * (big * 0.95 + mid);
        break;
      }
      case 'dunes': {
        const phase = x / 205 + n1(x / 720) * 2.4;
        const crest = Math.sin(phase + 0.6 * Math.sin(phase));
        const swell = fbm1D(n2, x / 640, 2);
        h = y0 - A * (0.38 * crest + 0.78 * swell) - 9 * fbm1D(n3, x / 55, 2) * R;
        // Flat-topped mesas in some stretches.
        const mesa = smoothstep(0.2, 0.5, n3(x / 880 + 7.3));
        const cap = y0 - A * 0.62;
        if (mesa > 0 && h < cap) h = lerp(h, cap + (h - cap) * 0.12, mesa);
        break;
      }
      case 'peaks': {
        const ridge = 1 - Math.abs(fbm1D(n1, x / 340, 4));
        const broad = fbm1D(n2, x / 720, 2);
        h = y0 - A * (ridge * ridge * 0.95 + broad * 0.42 - 0.42) - 16 * fbm1D(n3, x / 38, 2) * R;
        break;
      }
      case 'craters': {
        h = y0 - A * (fbm1D(n1, x / 620, 3) * 0.85 + fbm1D(n2, x / 150, 2) * 0.14);
        break;
      }
      case 'rift': {
        const jag = fbm1D(n1, x / 260, 5);
        const spires = Math.pow(Math.max(0, n2(x / 85)), 3) * 1.1;
        const rift = Math.exp(-(((x - riftCenter) / riftWidth) ** 2));
        h = y0 - A * (jag * 0.75 + spires * 0.55) + rift * A * 0.85 - 6 * fbm1D(n3, x / 30, 2) * R;
        break;
      }
    }
    hts[x] = h;
  }
  if (style === 'craters') {
    const count = rng.int(5, 7);
    for (let i = 0; i < count; i++) {
      const cx = rng.range(0.05, 0.95) * WORLD_W;
      const r = rng.range(42, 125);
      const depth = r * rng.range(0.28, 0.42);
      for (let x = Math.max(0, Math.floor(cx - r * 1.5)); x < Math.min(WORLD_W, cx + r * 1.5); x++) {
        const u = Math.abs(x - cx) / r;
        if (u < 1) hts[x] += depth * (1 - u * u);
        hts[x] -= depth * 0.32 * Math.exp(-(((u - 1) / 0.2) ** 2));
      }
    }
  }
  const blurRadius = style === 'peaks' || style === 'rift' ? 2 : 4;
  return boxBlur(hts, blurRadius);
}

function flattenSpawn(hts: Float32Array, sx: number): void {
  const flat = 26, blend = 52;
  let sum = 0, n = 0;
  for (let x = Math.floor(sx - flat); x <= sx + flat; x++) {
    if (x >= 0 && x < WORLD_W) { sum += hts[x]; n++; }
  }
  const target = clamp(sum / Math.max(1, n), WORLD_H * 0.36, WORLD_H * 0.78);
  for (let x = Math.floor(sx - flat - blend); x <= sx + flat + blend; x++) {
    if (x < 0 || x >= WORLD_W) continue;
    const d = Math.abs(x - sx);
    const w = d <= flat ? 1 : 1 - smoothstep(0, blend, d - flat);
    hts[x] = lerp(hts[x], target, w);
  }
}

interface Painter {
  surface: RGB; surfaceDark: RGB; strata: RGB[]; bedrock: RGB; accent: RGB; rim: RGB;
  grain: Float32Array; broad: Float32Array;
}

function makePainter(biome: BiomeDef, seed: number): Painter {
  const p = biome.palette;
  return {
    surface: hexToRgb(p.surface),
    surfaceDark: hexToRgb(p.surfaceDark),
    strata: p.strata.map(hexToRgb),
    bedrock: hexToRgb(p.bedrock),
    accent: hexToRgb(p.accent),
    rim: hexToRgb(p.rim),
    grain: tileNoise(hashInt(seed ^ 0x51ed27), 64, 2),
    broad: tileNoise(hashInt(seed ^ 0x2c1b3c6d), 6, 4),
  };
}

/** Generates the battlefield for a round. */
export function generateTerrain(biome: BiomeDef, seed: number): GeneratedTerrain {
  const rng = new Rng(hashInt(seed ^ 0x7e57));
  const hts = profile(biome, seed, rng);
  const spawns: [number, number] = [
    Math.round(rng.range(0.1, 0.22) * WORLD_W),
    Math.round(rng.range(0.78, 0.9) * WORLD_W),
  ];
  flattenSpawn(hts, spawns[0]);
  flattenSpawn(hts, spawns[1]);
  const minY = WORLD_H * 0.22, maxY = WORLD_H - BEDROCK_ROWS - 70;
  for (let x = 0; x < WORLD_W; x++) hts[x] = clamp(hts[x], minY, maxY);

  const terrain = new Terrain(WORLD_W, WORLD_H);
  const pt = makePainter(biome, seed);
  const px = terrain.px, H = WORLD_H;
  const y0 = biome.terrain.base * WORLD_H;
  const style = biome.terrain.style;
  const bedrockTop = terrain.bedrockTop;
  const warpNoise = makeNoise1D(hashInt(seed ^ 0x3d));
  const col: RGB = [0, 0, 0];

  for (let x = 0; x < WORLD_W; x++) {
    const sTrue = hts[x];
    const s = Math.floor(sTrue);
    const topDepth = biome.terrain.surfaceDepth * (0.7 + 0.6 * (sampleTile(pt.broad, x * 3, 0) * 0.5 + 0.5));
    const warp = fbm1D(warpNoise, x / 260, 3) * 46;
    const lift = (sTrue - y0) * 0.35;
    const base = x * H;
    const bedJitter = Math.round(sampleTile(pt.grain, x, 7) * 4);
    for (let y = s; y < H; y++) {
      const d = y - sTrue;
      const g = sampleTile(pt.grain, x, y);
      const b = sampleTile(pt.broad, x * 0.5, y * 0.5);
      let r: number, gg: number, bb: number;
      if (y >= bedrockTop + bedJitter) {
        const f = 0.8 + g * 0.12 + b * 0.08;
        r = pt.bedrock[0] * f; gg = pt.bedrock[1] * f; bb = pt.bedrock[2] * f;
      } else if (d < topDepth + g * 2.5) {
        const t = clamp(0.5 + b * 0.6 + g * 0.35, 0, 1);
        r = lerp(pt.surface[0], pt.surfaceDark[0], t);
        gg = lerp(pt.surface[1], pt.surfaceDark[1], t);
        bb = lerp(pt.surface[2], pt.surfaceDark[2], t);
        // Biome flourishes in the surface layer.
        if (style === 'peaks' && hash2(seed, x, y) < 0.012) { r = gg = bb = 255; }
        if (style === 'hills' && d > topDepth - 3) { r *= 0.8; gg *= 0.78; bb *= 0.72; }
        const shade = 1 - 0.18 * smoothstep(0, topDepth, d);
        r *= shade; gg *= shade; bb *= shade;
      } else {
        // Strata partly follow the surface contour and are warped by noise.
        const layer = (y + warp * 0.6 - lift + b * 34) / 40;
        const depthT = clamp((d - topDepth) / 420 + b * 0.12, 0, 0.999);
        const idx = depthT * (pt.strata.length - 1);
        const i0 = Math.floor(idx), k = idx - i0;
        const c0 = pt.strata[i0], c1 = pt.strata[Math.min(pt.strata.length - 1, i0 + 1)];
        col[0] = lerp(c0[0], c1[0], k); col[1] = lerp(c0[1], c1[1], k); col[2] = lerp(c0[2], c1[2], k);
        const band = 0.93 + 0.07 * Math.sin(layer * Math.PI * 2) + g * 0.05;
        const seam = Math.abs(((layer % 1) + 1) % 1 - 0.5) < 0.035 ? 0.86 : 1;
        r = col[0] * band * seam; gg = col[1] * band * seam; bb = col[2] * band * seam;
        // Pebbles and grit.
        const hsh = hash2(seed ^ 0x99, x >> 1, y >> 1);
        if (hsh < 0.006) { r *= 1.22; gg *= 1.2; bb *= 1.16; }
        else if (hsh > 0.993) { r *= 0.72; gg *= 0.72; bb *= 0.74; }
        // Veins: glowing magma (rift), ice (peaks), faint crystals (craters).
        if (style === 'rift' || style === 'peaks' || style === 'craters') {
          const vein = Math.abs(sampleTile(pt.broad, x * 1.7 + 91, y * 1.7));
          const width = style === 'rift' ? 0.028 : 0.016;
          if (vein < width && d > topDepth + 10) {
            const glow = 1 - vein / width;
            const mixAmt = (style === 'rift' ? 0.9 : 0.45) * glow;
            r = lerp(r, pt.accent[0], mixAmt); gg = lerp(gg, pt.accent[1], mixAmt); bb = lerp(bb, pt.accent[2], mixAmt);
          }
        }
        if (style === 'dunes') {
          const stripe = Math.sin((y - lift * 0.4) * 0.45 + g * 2) * 0.03;
          r *= 1 + stripe; gg *= 1 + stripe; bb *= 1 + stripe;
        }
      }
      // Ambient occlusion with depth.
      const ao = 1 - 0.3 * smoothstep(0, 560, d);
      r *= ao; gg *= ao; bb *= ao;
      let a = 255;
      if (y === s) a = Math.round(255 * clamp(1 - (sTrue - s), 0, 1)); // anti-aliased surface edge
      if (a <= 4) continue;
      px[base + y] = packRGBA(clamp(r, 0, 255), clamp(gg, 0, 255), clamp(bb, 0, 255), a);
    }
  }
  terrain.markAllDirty();
  return { terrain, surface: hts, spawns };
}

/** Loose earth for mounds raised by the Earthmaker. */
export function makeDirtPainter(biome: BiomeDef, seed: number): PixelPainter {
  const strata = biome.palette.strata.map(hexToRgb);
  const surface = hexToRgb(biome.palette.surfaceDark);
  const grain = tileNoise(hashInt(seed ^ 0xd127), 48, 2);
  return (x: number, y: number): number => {
    const g = sampleTile(grain, x, y);
    const t = clamp(0.35 + g * 0.5, 0, 1);
    const c0 = strata[0], c1 = surface;
    const f = 0.92 + g * 0.1 + (hash2(seed, x, y) < 0.02 ? 0.15 : 0);
    return packRGBA(
      clamp(lerp(c0[0], c1[0], t * 0.4) * f, 0, 255),
      clamp(lerp(c0[1], c1[1], t * 0.4) * f, 0, 255),
      clamp(lerp(c0[2], c1[2], t * 0.4) * f, 0, 255),
    );
  };
}

/** Dark cooled lava rock with faint embers. */
export function makeBasaltPainter(seed: number): PixelPainter {
  return (x: number, y: number): number => {
    const h = hash2(seed ^ 0xba5a17, x, y);
    if (h < 0.05) return packRGBA(150, 60, 24);
    const v = 34 + h * 18;
    return packRGBA(v + 6, v, v - 2);
  };
}
