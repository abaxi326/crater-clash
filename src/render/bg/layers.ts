/**
 * Parallax silhouette layers. Each layer is a horizontally periodic strip (PERIOD layer units wide)
 * pre-rendered once per biome: profile fill, rim light, biome details, then haze baked into its base.
 */
import type { BiomeDef } from '../../core/biomes.ts';
import { mixHex, rgba } from '../../core/color.ts';
import { PERIOD, ctx2d, makeCanvas } from './util.ts';
import { decorate, profileFor } from './shapes.ts';

export interface Layer {
  canvas: HTMLCanvasElement;
  /** Optional additive emissive overlay (lava glow, base lights), same geometry as canvas. */
  glow: HTMLCanvasElement | null;
  /** Layer-space y of the canvas top. */
  y0: number;
  /** Layer-space height covered by the canvas (below it, `fill` continues). */
  h: number;
  depth: number;
  /** Solid colour continuing below the canvas. */
  fill: string;
  /** Typical crest line (layer space) used for haze bands between layers. */
  crest: number;
  /** Animated points of interest (layer space): beacons, volcano crater, chimneys. */
  marks: Mark[];
}

export interface Mark {
  kind: 'beacon' | 'crater' | 'vent';
  x: number;
  y: number;
  /** Phase / size parameter. */
  p: number;
}

export interface LayerCtx {
  b: BiomeDef;
  index: number;
  res: number;
  seed: number;
  /** Profile top y per canvas column (layer space). */
  heights: Float32Array;
  y0: number;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  color: string;
  /** Emissive context, created lazily via needGlow(). */
  glow: CanvasRenderingContext2D | null;
  needGlow(): CanvasRenderingContext2D;
  marks: Mark[];
}

const DEPTHS = [0.15, 0.3, 0.5];
/** Layer-space bottom of each layer canvas. */
const LAYER_BOTTOM = 1000;

export function buildLayers(b: BiomeDef, res: number, seed: number): Layer[] {
  const out: Layer[] = [];
  const resPer = [0.5, 0.62, 0.78];
  for (let i = 0; i < 3; i++) out.push(buildLayer(b, i, res * resPer[i], seed + i * 1013));
  return out;
}

function buildLayer(b: BiomeDef, index: number, res: number, seed: number): Layer {
  const profile = profileFor(b, index, seed);
  const w = Math.ceil(PERIOD * res);
  const heights = new Float32Array(w + 1);
  let minY = Infinity, sumY = 0;
  for (let i = 0; i <= w; i++) {
    const y = profile((i / w) * PERIOD);
    heights[i] = y;
    if (y < minY) minY = y;
    sumY += y;
  }
  const crest = sumY / (w + 1);
  const y0 = Math.floor(minY - 140); // headroom for trees, plumes and snow
  const hl = LAYER_BOTTOM - y0;
  const h = Math.ceil(hl * res);
  const canvas = makeCanvas(w, h);
  const g = ctx2d(canvas);
  const color = b.palette.far[index];
  const haze = b.palette.haze;

  // Silhouette body with a gentle vertical tone (slightly lighter crests).
  const body = g.createLinearGradient(0, (minY - y0) * res, 0, (crest + 160 - y0) * res);
  body.addColorStop(0, mixHex(color, haze, 0.08));
  body.addColorStop(1, color);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(0, h);
  for (let i = 0; i <= w; i++) g.lineTo(i, (heights[i] - y0) * res);
  g.lineTo(w, h);
  g.closePath();
  g.fill();

  const lc: LayerCtx = {
    b, index, res, seed, heights, y0, g, w, h, color, glow: null, marks: [],
    needGlow(): CanvasRenderingContext2D {
      if (!this.glow) this.glow = ctx2d(makeCanvas(w, h));
      return this.glow;
    },
  };
  decorate(lc);

  // Rim light along the crest (sun-facing feel), drawn on top of details.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = rgba(mixHex(b.palette.haze, b.palette.celestialGlow, 0.5), 0.16 + index * 0.04);
  g.lineWidth = Math.max(1, 2.2 * res);
  g.beginPath();
  for (let i = 0; i <= w; i += 2) {
    const y = (heights[i] - y0) * res + 1;
    if (i === 0) g.moveTo(i, y); else g.lineTo(i, y);
  }
  g.stroke();

  // Atmospheric haze baked into the base: farther layers dissolve more.
  const hazeA = [0.62, 0.5, 0.38][index] * hazeStrength(b);
  const top = (crest - 60 - y0) * res, bot = (crest + 260 - y0) * res;
  const hg = g.createLinearGradient(0, top, 0, bot);
  hg.addColorStop(0, rgba(haze, 0));
  hg.addColorStop(1, rgba(haze, hazeA));
  g.fillStyle = hg;
  g.fillRect(0, top, w, h - top);
  g.restore();

  // Continue exactly the colour of the canvas' last row below it (no seam).
  const px = g.getImageData(0, h - 1, 1, 1).data;
  const fill = `rgb(${px[0]},${px[1]},${px[2]})`;
  return { canvas, glow: lc.glow ? lc.glow.canvas : null, y0, h: hl, depth: DEPTHS[index], fill, crest, marks: lc.marks };
}

function hazeStrength(b: BiomeDef): number {
  switch (b.id) {
    case 'lunar': return 0.35;
    case 'cinder': return 0.22;
    case 'dunes': return 0.7;
    case 'frost': return 0.72;
    default: return 0.42;
  }
}
