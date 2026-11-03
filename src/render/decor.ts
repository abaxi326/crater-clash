/**
 * Biome decorations along the original surface: grass, flowers, bushes, trees, cacti, rocks,
 * bones, pines, ice and lava crystals, basalt spires, an antenna dish. All art is vector-drawn once
 * per round into supersampled sprites; per frame they are just drawImage calls with a little
 * wind sway. A decoration vanishes (falls or fades with a dust puff) when its ground is destroyed
 * or it gets buried.
 */
import type { BiomeDef, BiomeId } from '../core/biomes.ts';
import { mixHex, rgba, shadeHex } from '../core/color.ts';
import { WORLD_W } from '../core/constants.ts';
import { TAU, clamp } from '../core/math.ts';
import { Rng, hashInt } from '../core/rng.ts';
import type { LightSource, ViewInfo } from '../contracts.ts';
import type { Terrain } from '../sim/terrain.ts';
import { ctx2d, makeCanvas } from './terrainLayer.ts';

/** Sprite supersampling (sprites stay crisp under zoom and high DPR). */
const SS = 3;

export interface DecorSprite {
  canvas: HTMLCanvasElement;
  /** Size in world units. */
  w: number;
  h: number;
  /** Anchor (the point that sits on the ground) relative to the sprite's top-left, world units. */
  ax: number;
  ay: number;
  /** Optional additive glow drawn behind (same anchor convention). */
  glow?: HTMLCanvasElement;
  glowW?: number;
  glowH?: number;
  glowAx?: number;
  glowAy?: number;
  /** Blinking beacon light position relative to the anchor. */
  beacon?: [number, number];
}

type Painter = (g: CanvasRenderingContext2D, rng: Rng) => void;

/** Builds a sprite: `paint` draws in world units with the anchor at (0, 0) and y up negative. */
function makeSprite(w: number, h: number, ax: number, ay: number, rng: Rng, paint: Painter): DecorSprite {
  const c = makeCanvas(w * SS, h * SS);
  const g = ctx2d(c);
  g.setTransform(SS, 0, 0, SS, ax * SS, ay * SS);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  paint(g, rng);
  return { canvas: c, w, h, ax, ay };
}

/** Soft radial glow sprite (additive) centred at (cx, cy) of the decoration, in world units. */
function attachGlow(s: DecorSprite, color: string, radius: number, cy: number): void {
  const size = radius * 2;
  const c = makeCanvas(size * 2, size * 2);
  const g = ctx2d(c);
  const grad = g.createRadialGradient(size, size, 0, size, size, size);
  grad.addColorStop(0, rgba(color, 0.55));
  grad.addColorStop(0.35, rgba(color, 0.22));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size * 2, size * 2);
  s.glow = c;
  s.glowW = size;
  s.glowH = size;
  s.glowAx = radius;
  s.glowAy = radius - cy;
}

function vgrad(g: CanvasRenderingContext2D, y0: number, y1: number, c0: string, c1: string, c2?: string): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, c0);
  if (c2) { gr.addColorStop(0.55, c1); gr.addColorStop(1, c2); } else gr.addColorStop(1, c1);
  return gr;
}

function hgrad(g: CanvasRenderingContext2D, x0: number, x1: number, c0: string, c1: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  return gr;
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

/** Soft contact shadow at the base. */
function contactShadow(g: CanvasRenderingContext2D, w: number, alpha = 0.28): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w);
  gr.addColorStop(0, `rgba(0,0,0,${alpha})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.scale(1, 0.28);
  g.fillStyle = gr;
  g.fillRect(-w, -w, w * 2, w * 2);
  g.restore();
}

// --- Verdant ----------------------------------------------------------------------------

function grassTuft(p: BiomeDef, rng: Rng, flowers: boolean, tones?: readonly [string, string, string]): DecorSprite {
  const w = rng.range(22, 36), h = rng.range(14, 25);
  return makeSprite(w + 8, h + 4, (w + 8) / 2, h + 2, rng, (g, r) => {
    const dark = tones ? tones[0] : shadeHex(p.palette.surfaceDark, 0.72);
    const mid = tones ? tones[1] : p.palette.surface;
    const tip = tones ? tones[2] : mixHex(p.palette.surface, p.palette.rim, 0.65);
    const n = r.int(8, 13);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const bx = (r.next() - 0.5) * w * 0.8;
        const lean = (r.next() - 0.5) * w * 0.55 + bx * 0.35;
        const bh = h * r.range(0.45, 1) * (pass === 0 ? 1 : 0.8);
        const bw = r.range(1.1, 2.1);
        const front = pass === 1;
        g.fillStyle = vgrad(g, -bh, 1, front ? tip : mixHex(mid, dark, 0.3), front ? mid : dark, dark);
        g.beginPath();
        g.moveTo(bx - bw, 1);
        g.quadraticCurveTo(bx - bw * 0.3 + lean * 0.3, -bh * 0.55, bx + lean, -bh);
        g.quadraticCurveTo(bx + bw * 0.5 + lean * 0.3, -bh * 0.5, bx + bw, 1);
        g.closePath();
        g.fill();
      }
    }
    if (flowers && r.chance(0.7)) {
      const k = r.int(1, 3);
      for (let i = 0; i < k; i++) {
        const fx = (r.next() - 0.5) * w * 0.6, fy = -h * r.range(0.55, 0.95);
        circle(g, fx, fy, 1.5, r.pick(['#ffffff', p.palette.accent, '#ff9ccf']));
      }
    }
  });
}

const PETALS = ['#ffffff', '#ff8fc4', '#c79bff', '#ff6b6b', '#ffe36b'];

function flower(p: BiomeDef, rng: Rng): DecorSprite {
  const h = rng.range(16, 26);
  const color = rng.pick(PETALS);
  const accent = color === '#ffe36b' ? '#d9772a' : p.palette.accent;
  return makeSprite(18, h + 8, 9, h + 7, rng, (g, r) => {
    const stem = shadeHex(p.palette.surfaceDark, 0.8);
    const lean = r.range(-3, 3);
    g.strokeStyle = stem;
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(0, 1);
    g.quadraticCurveTo(lean * 0.2, -h * 0.5, lean, -h);
    g.stroke();
    // Leaves.
    g.fillStyle = p.palette.surface;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, -h * 0.25);
      g.quadraticCurveTo(s * 5, -h * 0.42, s * 6.5, -h * 0.3);
      g.quadraticCurveTo(s * 3, -h * 0.22, 0, -h * 0.25);
      g.fill();
    }
    const cx = lean, cy = -h;
    const n = r.int(5, 6);
    const rot = r.next() * TAU;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      circle(g, cx + Math.cos(a) * 2.8, cy + Math.sin(a) * 2.8, 2.5, i % 2 ? color : shadeHex(color, 0.93));
    }
    circle(g, cx, cy, 1.9, accent);
    circle(g, cx - 0.6, cy - 0.6, 0.7, 'rgba(255,255,255,0.7)');
  });
}

function bush(p: BiomeDef, rng: Rng): DecorSprite {
  const w = rng.range(42, 64), h = rng.range(24, 36);
  return makeSprite(w + 8, h + 6, (w + 8) / 2, h + 3, rng, (g, r) => {
    contactShadow(g, w * 0.55, 0.32);
    const base = mixHex(p.palette.surfaceDark, '#1d5a2a', 0.45);
    const dark = shadeHex(base, 0.62), light = mixHex(base, p.palette.rim, 0.5);
    const blobs: [number, number, number][] = [];
    const n = r.int(5, 7);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const rr = h * r.range(0.32, 0.46) * (1 - Math.abs(t) * 0.6);
      blobs.push([t * w * 0.72, -rr * r.range(0.85, 1.25) - 1, rr]);
    }
    for (const [x, y, rr] of blobs) circle(g, x + 1.5, y + 1.5, rr, dark);
    for (const [x, y, rr] of blobs) {
      const gr = g.createRadialGradient(x - rr * 0.4, y - rr * 0.5, rr * 0.1, x, y, rr);
      gr.addColorStop(0, light);
      gr.addColorStop(0.55, base);
      gr.addColorStop(1, dark);
      circle(g, x, y, rr, gr);
    }
    // Leaf speckles and occasional berries.
    for (let i = 0; i < 26; i++) {
      const [x, y, rr] = r.pick(blobs);
      const a = r.next() * TAU, d = r.next() * rr * 0.85;
      const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
      circle(g, sx, sy, r.range(0.8, 1.6), sy < y ? rgba(p.palette.rim, 0.55) : rgba('#000000', 0.18));
    }
    if (r.chance(0.5)) for (let i = 0; i < 5; i++) {
      const [x, y, rr] = r.pick(blobs);
      circle(g, x + r.range(-rr, rr) * 0.6, y + r.range(-rr, rr) * 0.5, 1.4, r.pick(['#ff5a6e', '#ffffff', '#ffd84a']));
    }
  });
}

function roundTree(p: BiomeDef, rng: Rng): DecorSprite {
  const trunkH = rng.range(34, 58), crownR = rng.range(30, 46);
  const h = trunkH + crownR * 1.7, w = crownR * 2.6;
  return makeSprite(w + 10, h + 8, (w + 10) / 2, h + 3, rng, (g, r) => {
    contactShadow(g, crownR * 0.9, 0.3);
    // Trunk with a fork.
    const bark = '#6b4a32', barkDark = '#3f2a1c';
    g.fillStyle = hgrad(g, -4, 4, mixHex(bark, '#c9a27a', 0.25), barkDark);
    g.beginPath();
    g.moveTo(-4.2, 1);
    g.quadraticCurveTo(-2.4, -trunkH * 0.5, -2.2, -trunkH - 4);
    g.lineTo(2.2, -trunkH - 4);
    g.quadraticCurveTo(2.6, -trunkH * 0.5, 4.2, 1);
    g.closePath();
    g.fill();
    g.strokeStyle = barkDark;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -trunkH * 0.6);
    g.quadraticCurveTo(6, -trunkH * 0.8, 9, -trunkH - 8);
    g.stroke();
    const cy = -trunkH - crownR * 0.75;
    const base = mixHex(p.palette.surfaceDark, '#1f6b34', 0.5);
    const dark = shadeHex(base, 0.55), light = mixHex(base, p.palette.rim, 0.55);
    const blobs: [number, number, number][] = [[0, cy, crownR * 0.78]];
    const n = r.int(7, 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.3, 0.3);
      const d = crownR * r.range(0.45, 0.62);
      blobs.push([Math.cos(a) * d * 1.1, cy + Math.sin(a) * d * 0.85, crownR * r.range(0.38, 0.52)]);
    }
    for (const [x, y, rr] of blobs) circle(g, x + 2, y + 2.5, rr, dark);
    for (const [x, y, rr] of blobs) {
      const gr = g.createRadialGradient(x - rr * 0.5, y - rr * 0.6, rr * 0.1, x, y + rr * 0.2, rr * 1.1);
      gr.addColorStop(0, light);
      gr.addColorStop(0.5, base);
      gr.addColorStop(1, dark);
      circle(g, x, y, rr, gr);
    }
    // Lower-crown occlusion, then sunlit leaf clusters.
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = vgrad(g, cy - crownR, cy + crownR, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.28)');
    g.fillRect(-w, cy - crownR * 1.5, w * 2, crownR * 3);
    g.restore();
    for (let i = 0; i < 40; i++) {
      const [x, y, rr] = r.pick(blobs);
      const a = r.next() * TAU, d = r.next() * rr * 0.8;
      const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
      const lit = sy < cy - crownR * 0.1 && sx < crownR * 0.4;
      circle(g, sx, sy, r.range(1, 2.2), lit ? rgba(p.palette.rim, 0.5) : rgba('#000000', 0.14));
    }
    if (r.chance(0.35)) for (let i = 0; i < 6; i++) {
      const [x, y, rr] = r.pick(blobs);
      circle(g, x + r.range(-0.6, 0.6) * rr, y + r.range(-0.6, 0.6) * rr, 1.8, '#ff6a5a');
    }
  });
}

// --- Dunes ------------------------------------------------------------------------------

function capsule(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number): void {
  g.lineWidth = r * 2;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function cactus(p: BiomeDef, rng: Rng): DecorSprite {
  if (rng.chance(0.3)) {
    const r0 = rng.range(7, 10);
    return makeSprite(r0 * 2 + 8, r0 * 2 + 10, r0 + 4, r0 * 2 + 4, rng, (g, r) => {
      contactShadow(g, r0 * 1.3);
      const green = '#5f8f4f';
      const gr = g.createRadialGradient(-r0 * 0.4, -r0 * 1.3, 1, 0, -r0, r0 * 1.2);
      gr.addColorStop(0, mixHex(green, '#e8f0a0', 0.4));
      gr.addColorStop(0.6, green);
      gr.addColorStop(1, shadeHex(green, 0.5));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, -r0 * 0.95, r0, r0 * 0.95, 0, 0, TAU);
      g.fill();
      g.strokeStyle = rgba('#20381c', 0.45);
      g.lineWidth = 0.8;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.ellipse(0, -r0 * 0.95, Math.abs(i) * r0 * 0.38 + 0.1, r0 * 0.95, 0, -Math.PI / 2, Math.PI / 2, i < 0);
        g.stroke();
      }
      const fc = r.pick(['#ff5f86', '#ffcf4a', '#ff8a3d']);
      for (let i = 0; i < 5; i++) circle(g, Math.cos(i * 1.256) * 2.2, -r0 * 1.9 + Math.sin(i * 1.256) * 1.2, 1.7, fc);
      circle(g, 0, -r0 * 1.9, 1.1, '#fff1b0');
    });
  }
  const h = rng.range(58, 92);
  const tw = rng.range(6.5, 8.5);
  return makeSprite(64, h + 8, 32, h + 4, rng, (g, r) => {
    contactShadow(g, 14);
    const green = mixHex('#5d9150', p.palette.ambientLight, 0.12);
    const dark = shadeHex(green, 0.48), light = mixHex(green, '#f2f7b0', 0.45);
    const arms: [number, number, number, number][] = [];
    const first = r.sign();
    const nArms = r.int(1, 2);
    for (let i = 0; i < nArms; i++) arms.push([i === 0 ? first : -first, -h * r.range(0.32, 0.58), r.range(14, 19), r.range(14, 28)]);
    const body = (fill: string | CanvasGradient, dx: number): void => {
      g.strokeStyle = fill;
      capsule(g, dx, -tw, dx, -h + tw, tw);
      for (const [s, ay, out, up] of arms) {
        g.lineWidth = tw * 1.35;
        g.beginPath();
        g.moveTo(dx, ay);
        g.lineTo(dx + s * (out - 3), ay);
        g.quadraticCurveTo(dx + s * out, ay, dx + s * out, ay - 4);
        g.lineTo(dx + s * out, ay - up);
        g.stroke();
      }
    };
    body(dark, 1.4);
    body(hgrad(g, -tw - 12, tw + 12, light, dark), 0);
    // Ribs and spines.
    g.strokeStyle = rgba('#1e3a1c', 0.35);
    g.lineWidth = 0.7;
    for (const dx of [-tw * 0.45, 0, tw * 0.45]) {
      g.beginPath();
      g.moveTo(dx, -2);
      g.lineTo(dx, -h + tw * 0.8);
      g.stroke();
    }
    g.fillStyle = rgba('#fff6d8', 0.75);
    for (let i = 0; i < 26; i++) g.fillRect(r.range(-tw, tw), -r.range(3, h - 3), 0.6, 0.6);
    // Sunset rim along the left edge.
    g.strokeStyle = rgba(p.palette.rim, 0.55);
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(-tw + 0.8, -3);
    g.lineTo(-tw + 0.8, -h + tw);
    g.stroke();
    if (r.chance(0.5)) circle(g, 0, -h + 1, 2.2, '#ff7a9a');
  });
}

function bones(rng: Rng): DecorSprite {
  const skull = rng.chance(0.45);
  return makeSprite(44, 24, 22, 20, rng, (g, r) => {
    contactShadow(g, 18, 0.25);
    const bone = '#efe4cc', shade = '#b8a684';
    g.strokeStyle = shade;
    if (skull) {
      // Horned skull resting on the sand.
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(-5, -6); g.quadraticCurveTo(-14, -9, -16, -15);
      g.moveTo(5, -6); g.quadraticCurveTo(14, -9, 16, -15);
      g.stroke();
      g.strokeStyle = bone;
      g.lineWidth = 1.7;
      g.stroke();
      g.fillStyle = vgrad(g, -10, 0, '#fffaf0', bone, shade);
      g.beginPath();
      g.moveTo(-6, -9); g.quadraticCurveTo(0, -12, 6, -9);
      g.lineTo(4, -2); g.quadraticCurveTo(0, 1, -4, -2);
      g.closePath();
      g.fill();
      circle(g, -2.6, -6.5, 1.3, '#4a3626');
      circle(g, 2.6, -6.5, 1.3, '#4a3626');
    } else {
      // Rib arcs over a spine, half sunk in the sand.
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-17, -1.5); g.lineTo(17, -2.5);
      g.stroke();
      const n = r.int(4, 6);
      for (let i = 0; i < n; i++) {
        const x = -12 + (i / (n - 1)) * 22;
        const hh = 9 + Math.sin((i / (n - 1)) * Math.PI) * 6;
        g.strokeStyle = shade;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(x, -2); g.quadraticCurveTo(x + 6, -hh, x + 9, -1);
        g.stroke();
        g.strokeStyle = bone;
        g.lineWidth = 1.4;
        g.stroke();
      }
    }
  });
}

// --- Rocks (all biomes) -----------------------------------------------------------------

type RockStyle = 'sand' | 'snow' | 'moon' | 'basalt' | 'meadow';

function rock(p: BiomeDef, rng: Rng, style: RockStyle, size = 1): DecorSprite {
  const w = rng.range(16, 34) * size, h = w * rng.range(0.45, 0.72);
  return makeSprite(w + 10, h + 8, (w + 10) / 2, h + 4, rng, (g, r) => {
    contactShadow(g, w * 0.62, 0.35);
    const base = style === 'sand' ? mixHex('#b9784a', p.palette.surfaceDark, 0.3)
      : style === 'snow' ? '#7f8fa3'
      : style === 'moon' ? '#80848f'
      : style === 'meadow' ? '#8c8a84' : '#2f2828';
    const light = style === 'basalt' ? '#5a4c4a' : mixHex(base, '#ffffff', 0.38);
    const dark = shadeHex(base, 0.55);
    const n = r.int(7, 9);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      const rr = r.range(0.82, 1.08);
      pts.push([Math.cos(a) * w * 0.5 * rr, Math.sin(a) * h * rr + 1.5]);
    }
    const outline = (): void => {
      g.beginPath();
      g.moveTo(pts[0][0], 2);
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(pts[n - 1][0], 2);
      g.closePath();
    };
    const gr = g.createLinearGradient(-w * 0.4, -h, w * 0.4, 0);
    gr.addColorStop(0, light);
    gr.addColorStop(0.45, base);
    gr.addColorStop(1, dark);
    g.fillStyle = gr;
    outline();
    g.fill();
    // Facet: lit upper-left plane.
    g.fillStyle = rgba('#ffffff', style === 'basalt' ? 0.06 : 0.14);
    g.beginPath();
    g.moveTo(pts[1][0], pts[1][1]);
    g.lineTo(pts[2][0], pts[2][1]);
    g.lineTo(pts[3][0], pts[3][1]);
    g.lineTo(pts[3][0] * 0.4, -h * 0.35);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#000000', 0.25);
    g.lineWidth = 0.8;
    outline();
    g.stroke();
    if (style === 'moon') {
      for (let i = 0; i < 3; i++) {
        const cx = r.range(-w * 0.3, w * 0.3), cy = -h * r.range(0.2, 0.55), cr = r.range(1.2, 2.6);
        circle(g, cx, cy, cr, rgba('#000000', 0.22));
        circle(g, cx - 0.4, cy - 0.4, cr * 0.75, rgba('#ffffff', 0.1));
      }
    }
    if (style === 'snow') {
      g.fillStyle = '#f7fbff';
      g.beginPath();
      g.moveTo(pts[1][0], pts[1][1] + 1);
      for (let i = 1; i < n - 1; i++) g.lineTo(pts[i][0], pts[i][1] - 0.8);
      g.lineTo(pts[n - 2][0], pts[n - 2][1] + 1.5);
      for (let i = n - 2; i >= 1; i--) g.lineTo(pts[i][0] * 0.92, pts[i][1] + 2.4 + Math.sin(i * 2.1) * 1.2);
      g.closePath();
      g.fill();
    }
    if (style === 'basalt') {
      g.strokeStyle = rgba(p.palette.accent, 0.85);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(-w * 0.2, 0);
      g.lineTo(-w * 0.05, -h * 0.35);
      g.lineTo(w * 0.1, -h * 0.5);
      g.stroke();
    }
    if (style === 'meadow') {
      // Moss on top.
      g.fillStyle = rgba(p.palette.surface, 0.85);
      g.beginPath();
      g.moveTo(pts[2][0], pts[2][1] + 1);
      for (let i = 2; i < n - 2; i++) g.lineTo(pts[i][0], pts[i][1] - 0.6);
      for (let i = n - 3; i >= 2; i--) g.lineTo(pts[i][0] * 0.9, pts[i][1] + 2 + Math.sin(i * 1.7));
      g.closePath();
      g.fill();
    }
    if (style === 'sand') {
      g.strokeStyle = rgba('#5a2f1c', 0.25);
      g.lineWidth = 0.7;
      for (let i = 1; i <= 2; i++) {
        g.beginPath();
        g.moveTo(-w * 0.45, -h * i * 0.3);
        g.lineTo(w * 0.42, -h * i * 0.3 + 1);
        g.stroke();
      }
    }
  });
}

// --- Frost ------------------------------------------------------------------------------

function pine(rng: Rng): DecorSprite {
  const h = rng.range(70, 128), w = h * rng.range(0.42, 0.52);
  return makeSprite(w + 10, h + 8, (w + 10) / 2, h + 3, rng, (g, r) => {
    contactShadow(g, w * 0.55, 0.3);
    g.fillStyle = '#4a3324';
    g.fillRect(-2.2, -h * 0.2, 4.4, h * 0.2 + 1);
    const green = '#2f5e4f', dark = '#1c3b33', light = '#4d8a6f';
    const tiers = r.int(4, 5);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const yb = -h * 0.14 - t * h * 0.72;
      const ww = w * 0.5 * (1 - t * 0.72);
      const yt = yb - h * 0.34;
      g.fillStyle = hgradStops(g, -ww, ww, light, green, dark);
      g.beginPath();
      g.moveTo(0, yt);
      g.quadraticCurveTo(ww * 0.3, yb - h * 0.12, ww, yb);
      g.quadraticCurveTo(0, yb - 3, -ww, yb);
      g.quadraticCurveTo(-ww * 0.3, yb - h * 0.12, 0, yt);
      g.fill();
      // Snow draped on the tier, heavier on the left.
      g.fillStyle = '#f4f9ff';
      g.beginPath();
      g.moveTo(0, yt + 0.5);
      g.quadraticCurveTo(-ww * 0.3, yb - h * 0.12, -ww * 0.95, yb - 0.5);
      g.quadraticCurveTo(-ww * 0.55, yb - 4, -ww * 0.3, yb - 2.5);
      g.quadraticCurveTo(0, yb - h * 0.12, ww * 0.45, yb - h * 0.08);
      g.quadraticCurveTo(ww * 0.15, yb - h * 0.2, 0, yt + 0.5);
      g.fill();
    }
    for (let i = 0; i < 8; i++) circle(g, r.range(-w * 0.3, w * 0.3), -r.range(h * 0.2, h * 0.85), 0.8, rgba('#ffffff', 0.7));
  });
}

function hgradStops(g: CanvasRenderingContext2D, x0: number, x1: number, c0: string, c1: string, c2: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, c0);
  gr.addColorStop(0.45, c1);
  gr.addColorStop(1, c2);
  return gr;
}

/** Cluster of pointed prisms (ice, lava crystals, moon shards) with an additive halo. */
function crystals(rng: Rng, color: string, edge: string, glow: string, scale: number, alpha: number): DecorSprite {
  const h = rng.range(18, 34) * scale;
  const s = makeSprite(40 * scale, h + 10, 20 * scale, h + 4, rng, (g, r) => {
    contactShadow(g, 14 * scale, 0.22);
    const n = r.int(3, 5);
    const shards: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 1.3 + r.range(-0.15, 0.15);
      shards.push([r.range(-6, 6) * scale, a, h * r.range(0.45, 1) * (1 - Math.abs(a) * 0.35), r.range(2.8, 4.6) * scale]);
    }
    shards.sort((a, b) => a[2] - b[2]);
    for (const [x, a, len, hw] of shards) {
      g.save();
      g.translate(x, 1);
      g.rotate(a);
      g.fillStyle = hgradStops(g, -hw, hw, mixHex(color, '#ffffff', 0.55), color, shadeHex(color, 0.5));
      g.globalAlpha = alpha;
      g.beginPath();
      g.moveTo(-hw, 0);
      g.lineTo(-hw, -len * 0.78);
      g.lineTo(0, -len);
      g.lineTo(hw, -len * 0.78);
      g.lineTo(hw, 0);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = edge;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(-hw * 0.15, -1);
      g.lineTo(-hw * 0.15, -len * 0.8);
      g.lineTo(0, -len);
      g.stroke();
      g.restore();
    }
  });
  attachGlow(s, glow, h * 1.1, -h * 0.45);
  return s;
}

// --- Cinder -----------------------------------------------------------------------------

function basaltSpires(p: BiomeDef, rng: Rng): DecorSprite {
  const n = rng.int(2, 4);
  const cols: [number, number, number, number][] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const cw = rng.range(11, 17);
    cols.push([x, cw, rng.range(40, 112) * (i === 1 ? 1.15 : 0.9), rng.range(-4, 4)]);
    x += cw - 0.5;
  }
  const total = x, maxH = Math.max(...cols.map(c => c[2]));
  const s = makeSprite(total + 14, maxH + 14, total / 2 + 7, maxH + 6, rng, (g, r) => {
    contactShadow(g, total * 0.7, 0.4);
    const ox = -total / 2;
    for (const [cx, cw, ch, tilt] of cols) {
      const x0 = ox + cx, x1 = x0 + cw;
      g.fillStyle = hgradStops(g, x0, x1, '#5b4a46', '#2e2524', '#151010');
      g.beginPath();
      g.moveTo(x0, 1);
      g.lineTo(x0, -ch + tilt);
      g.lineTo(x0 + cw * 0.5, -ch - 3);
      g.lineTo(x1, -ch - tilt);
      g.lineTo(x1, 1);
      g.closePath();
      g.fill();
      // Rim light on the left edge so spires read against the night sky.
      g.strokeStyle = rgba(p.palette.rim, 0.45);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0 + 0.5, -2);
      g.lineTo(x0 + 0.5, -ch + tilt);
      g.lineTo(x0 + cw * 0.5, -ch - 3);
      g.stroke();
      // Top facet catches the volcano glow.
      g.fillStyle = rgba(p.palette.rim, 0.35);
      g.beginPath();
      g.moveTo(x0, -ch + tilt);
      g.lineTo(x0 + cw * 0.5, -ch - 3);
      g.lineTo(x0 + cw * 0.5, -ch + 1);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba('#000000', 0.35);
      g.lineWidth = 0.6;
      for (let k = 1; k < 4; k++) {
        const y = -ch * (k / 4) + r.range(-3, 3);
        g.beginPath();
        g.moveTo(x0 + 0.5, y);
        g.lineTo(x1 - 0.5, y + r.range(-1.5, 1.5));
        g.stroke();
      }
    }
    // Magma seams near the base.
    g.strokeStyle = p.palette.accent;
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(-total * 0.3, 0);
    g.lineTo(-total * 0.2, -8);
    g.lineTo(-total * 0.05, -12);
    g.moveTo(total * 0.18, 0);
    g.lineTo(total * 0.25, -6);
    g.stroke();
    g.strokeStyle = '#ffe2a8';
    g.lineWidth = 0.4;
    g.stroke();
  });
  attachGlow(s, p.palette.accent, total * 0.9, -4);
  return s;
}

// --- Lunar ------------------------------------------------------------------------------

function antennaDish(rng: Rng): DecorSprite {
  const s = makeSprite(52, 64, 26, 58, rng, g => {
    contactShadow(g, 20, 0.4);
    // Tripod and mast.
    g.strokeStyle = '#5c6274';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-13, 1); g.lineTo(0, -20);
    g.moveTo(13, 1); g.lineTo(0, -20);
    g.moveTo(3, 1); g.lineTo(0, -20);
    g.stroke();
    g.fillStyle = hgrad(g, -3, 3, '#c9cfdd', '#6b7184');
    g.fillRect(-2.2, -34, 4.4, 16);
    g.fillStyle = '#8d93a6';
    g.fillRect(-5, -22, 10, 4);
    // Dish facing up-left.
    g.save();
    g.translate(-1, -38);
    g.rotate(-0.55);
    const dg = g.createLinearGradient(-16, -6, 16, 6);
    dg.addColorStop(0, '#f4f6fb');
    dg.addColorStop(0.6, '#b7bdcc');
    dg.addColorStop(1, '#6d7387');
    g.fillStyle = dg;
    g.beginPath();
    g.ellipse(0, 0, 17, 6.5, 0, Math.PI, TAU);
    g.quadraticCurveTo(0, 9, -17, 0);
    g.fill();
    g.strokeStyle = '#e9edf7';
    g.lineWidth = 0.9;
    g.beginPath();
    g.ellipse(0, 0, 17, 3.2, 0, 0, TAU);
    g.stroke();
    // Feed arm.
    g.strokeStyle = '#9aa1b3';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(0, 2); g.lineTo(0, -13);
    g.stroke();
    circle(g, 0, -14, 1.8, '#d5dae6');
    g.restore();
  });
  s.beacon = [0, -34 - 2];
  return s;
}

// --- Placement recipes ------------------------------------------------------------------

interface Kind {
  weight: number;
  /** Sway amplitude (radians at full wind). 0 = rigid. */
  sway: number;
  /** Max |slope| allowed under the footprint. */
  maxSlope: number;
  /** Emits a light onto the terrain (colour), or null. */
  light: string | null;
  variants: DecorSprite[];
}

interface Recipe {
  big: Kind[];
  small: Kind[];
  bigStep: [number, number];
  smallStep: [number, number];
  /** At most one per round (antenna dish). */
  landmark?: Kind;
}

function kind(weight: number, sway: number, maxSlope: number, count: number, make: () => DecorSprite, light: string | null = null): Kind {
  const variants: DecorSprite[] = [];
  for (let i = 0; i < count; i++) variants.push(make());
  return { weight, sway, maxSlope, light, variants };
}

function recipe(biome: BiomeDef, rng: Rng): Recipe {
  const p = biome;
  const accent = biome.palette.accent;
  switch (biome.id) {
    case 'verdant':
      return {
        big: [kind(0.5, 0.03, 0.42, 4, () => roundTree(p, rng)), kind(0.5, 0.025, 0.6, 3, () => bush(p, rng))],
        small: [
          kind(0.72, 0.13, 1.1, 7, () => grassTuft(p, rng, rng.chance(0.4))),
          kind(0.2, 0.16, 0.9, 6, () => flower(p, rng)),
          kind(0.08, 0, 0.7, 3, () => rock(p, rng, 'meadow')),
        ],
        bigStep: [60, 170],
        smallStep: [10, 24],
      };
    case 'dunes':
      return {
        big: [kind(0.68, 0, 0.5, 5, () => cactus(p, rng)), kind(0.32, 0, 0.6, 3, () => rock(p, rng, 'sand', 1.7))],
        small: [
          kind(0.5, 0.12, 0.9, 5, () => grassTuft(p, rng, false, ['#8a6a35', '#c9a463', '#f0d9a0'])),
          kind(0.32, 0, 0.7, 4, () => rock(p, rng, 'sand')),
          kind(0.18, 0, 0.5, 4, () => bones(rng)),
        ],
        bigStep: [80, 190],
        smallStep: [26, 64],
      };
    case 'frost':
      return {
        big: [kind(0.84, 0.022, 0.75, 6, () => pine(rng)), kind(0.16, 0, 0.8, 3, () => rock(p, rng, 'snow', 1.6))],
        small: [
          kind(0.36, 0, 0.9, 4, () => crystals(rng, '#9fe6ff', 'rgba(255,255,255,0.85)', accent, 1.05, 0.82), '#8fe3ff'),
          kind(0.34, 0, 0.8, 4, () => rock(p, rng, 'snow')),
          kind(0.3, 0.1, 1, 4, () => grassTuft(p, rng, false, ['#6d8a86', '#a7c4c0', '#eef7ff'])),
        ],
        bigStep: [28, 130],
        smallStep: [30, 80],
      };
    case 'cinder':
      return {
        big: [
          kind(0.6, 0, 0.55, 4, () => basaltSpires(p, rng), accent),
          kind(0.4, 0, 0.8, 3, () => crystals(rng, '#ff7a2a', 'rgba(255,230,170,0.9)', accent, 1.7, 0.95), '#ff6a1a'),
        ],
        small: [
          kind(0.5, 0, 0.8, 4, () => rock(p, rng, 'basalt', 1.2)),
          kind(0.5, 0, 0.9, 4, () => crystals(rng, '#ff9a3a', 'rgba(255,240,190,0.9)', '#ff7a2a', 0.95, 0.95), '#ff7a2a'),
        ],
        bigStep: [70, 170],
        smallStep: [34, 80],
      };
    case 'lunar':
    default:
      return {
        big: [
          kind(0.45, 0, 0.7, 3, () => crystals(rng, '#b9c8ff', 'rgba(255,255,255,0.9)', accent, 1.5, 0.85), '#9fd2ff'),
          kind(0.55, 0, 0.7, 4, () => rock(p, rng, 'moon', 1.8)),
        ],
        small: [
          kind(0.75, 0, 0.8, 5, () => rock(p, rng, 'moon', 1.1)),
          kind(0.25, 0, 0.9, 3, () => crystals(rng, '#c8b9ff', 'rgba(255,255,255,0.9)', '#a98bff', 0.9, 0.85), '#a98bff'),
        ],
        bigStep: [90, 220],
        smallStep: [30, 80],
        landmark: kind(1, 0, 0.3, 1, () => antennaDish(rng)),
      };
  }
}

// --- Runtime ----------------------------------------------------------------------------

const ALIVE = 0, FALLING = 1, FADING = 2, GONE = 3;

interface Deco {
  sprite: DecorSprite;
  kind: Kind;
  x: number;
  y: number;
  scale: number;
  flip: number;
  phase: number;
  state: number;
  t: number;
  vy: number;
  rot: number;
  alpha: number;
  light: LightSource | null;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

/** World → device affine matrix (as passed to setTransform). */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const MAX_PUFFS = 64;
const SPAWN_CLEAR = 70;

export class Decor {
  private items: Deco[] = [];
  private readonly puffs: Puff[] = [];
  private puffCount = 0;
  private puffColor = '#ffffff';
  private terrainVersion = -1;
  private terrain: Terrain | null = null;
  /** Lights cast by glowing decorations (terrain lighting). */
  readonly lights: LightSource[] = [];
  private biomeId: BiomeId = 'verdant';

  constructor() {
    for (let i = 0; i < MAX_PUFFS; i++) this.puffs.push({ x: 0, y: 0, vx: 0, vy: 0, r: 0, age: 0, life: 1 });
  }

  get count(): number {
    return this.items.length;
  }

  /** Generates decorations for a fresh round along the current (original) surface. */
  build(biome: BiomeDef, seed: number, terrain: Terrain, spawnXs: readonly number[], low: boolean): void {
    this.terrain = terrain;
    this.terrainVersion = terrain.version;
    this.biomeId = biome.id;
    this.items = [];
    this.lights.length = 0;
    this.puffCount = 0;
    this.puffColor = mixHex(biome.palette.surface, '#ffffff', 0.25);
    const rng = new Rng(hashInt(seed ^ 0xdec0de));
    const rec = recipe(biome, rng);
    const surf = new Float32Array(WORLD_W);
    for (let x = 0; x < WORLD_W; x++) surf[x] = terrain.heightAt(x);
    const sAt = (x: number): number => surf[clamp(Math.round(x), 0, WORLD_W - 1)];
    const density = low ? 1.7 : 1;

    const tryPlace = (k: Kind, x: number): boolean => {
      const sprite = rng.pick(k.variants);
      const scale = rng.range(0.85, 1.15);
      const hw = Math.max(3, sprite.w * scale * 0.28);
      if (x - hw < 8 || x + hw > WORLD_W - 8) return false;
      for (const sx of spawnXs) if (Math.abs(x - sx) < 28 + SPAWN_CLEAR + hw) return false;
      const yl = sAt(x - hw), yc = sAt(x), yr = sAt(x + hw);
      if (yc >= terrain.bedrockTop - 4) return false;
      if (Math.abs(yr - yl) / (hw * 2) > k.maxSlope) return false;
      const y = Math.max(yl, yc, yr) + 2;
      const d: Deco = {
        sprite, kind: k, x, y, scale, flip: rng.chance(0.5) ? -1 : 1, phase: rng.range(0, TAU),
        state: ALIVE, t: 0, vy: 0, rot: 0, alpha: 1, light: null,
      };
      if (k.light) {
        d.light = { x, y: y - sprite.h * scale * 0.4, radius: 40 + sprite.h * scale * 1.2, color: k.light, intensity: 0.4 };
        this.lights.push(d.light);
      }
      this.items.push(d);
      return true;
    };
    const pick = (kinds: Kind[]): Kind => {
      let total = 0;
      for (const k of kinds) total += k.weight;
      let r = rng.next() * total;
      for (const k of kinds) if ((r -= k.weight) <= 0) return k;
      return kinds[kinds.length - 1];
    };

    if (rec.landmark) {
      for (let i = 0; i < 12; i++) if (tryPlace(rec.landmark, rng.range(0.3, 0.7) * WORLD_W)) break;
    }
    for (let x = rng.range(20, 120); x < WORLD_W - 20; x += rng.range(rec.bigStep[0], rec.bigStep[1]) * density) {
      tryPlace(pick(rec.big), x);
    }
    for (let x = rng.range(10, 30); x < WORLD_W - 10; x += rng.range(rec.smallStep[0], rec.smallStep[1]) * density) {
      tryPlace(pick(rec.small), x);
    }
  }

  clear(): void {
    this.items = [];
    this.lights.length = 0;
    this.puffCount = 0;
    this.terrain = null;
  }

  /** A blast at (x, y): decorations caught in it are knocked away. */
  blast(x: number, y: number, r: number): void {
    for (const d of this.items) {
      if (d.state !== ALIVE) continue;
      const cy = d.y - d.sprite.h * d.scale * 0.35;
      const dx = d.x - x, dy = cy - y;
      const reach = r + 8 + d.sprite.w * d.scale * 0.2;
      if (dx * dx + dy * dy < reach * reach) this.kill(d, FALLING, dx >= 0 ? 1 : -1);
    }
  }

  private kill(d: Deco, mode: number, dir: number): void {
    d.state = mode;
    d.t = 0;
    d.vy = mode === FALLING ? -60 - Math.random() * 80 : 0;
    d.rot = dir * (1.5 + Math.random() * 2.5);
    if (d.light) d.light.intensity = 0;
    const n = 3 + Math.min(5, Math.round(d.sprite.w * d.scale / 12));
    for (let i = 0; i < n; i++) this.puff(d.x + (Math.random() - 0.5) * d.sprite.w * d.scale * 0.5, d.y - 3 - Math.random() * 6, 3 + Math.random() * 5);
  }

  private puff(x: number, y: number, r: number): void {
    const p = this.puffs[this.puffCount < MAX_PUFFS ? this.puffCount++ : Math.floor(Math.random() * MAX_PUFFS)];
    p.x = x;
    p.y = y;
    p.vx = (Math.random() - 0.5) * 40;
    p.vy = -12 - Math.random() * 22;
    p.r = r;
    p.age = 0;
    p.life = 0.45 + Math.random() * 0.35;
  }

  /** Checks ground support after terrain changes. */
  private checkSupport(t: Terrain): void {
    for (const d of this.items) {
      if (d.state !== ALIVE) continue;
      const hw = Math.min(10, d.sprite.w * d.scale * 0.22);
      const by = d.y + 1;
      const support = (t.isSolid(d.x, by) ? 1 : 0) + (t.isSolid(d.x - hw, by) ? 1 : 0) + (t.isSolid(d.x + hw, by) ? 1 : 0);
      if (support === 0) { this.kill(d, FALLING, Math.random() < 0.5 ? -1 : 1); continue; }
      const h = d.sprite.h * d.scale;
      if (t.isSolid(d.x, d.y - 3 - Math.max(4, h * 0.55))) this.kill(d, FADING, 0);
    }
  }

  update(dt: number, time: number): void {
    const t = this.terrain;
    if (t && t.version !== this.terrainVersion) {
      this.terrainVersion = t.version;
      this.checkSupport(t);
    }
    let removed = false;
    for (const d of this.items) {
      if (d.state === ALIVE) {
        if (d.light) d.light.intensity = 0.32 + 0.1 * Math.sin(time * 1.7 + d.phase);
        continue;
      }
      if (d.state === GONE) continue;
      d.t += dt;
      if (d.state === FALLING) {
        d.vy += 900 * dt;
        d.y += d.vy * dt;
        d.alpha = Math.max(0, 1 - d.t / 0.55);
      } else {
        d.alpha = Math.max(0, 1 - d.t / 0.35);
      }
      if (d.alpha <= 0) { d.state = GONE; removed = true; }
    }
    if (removed) this.items = this.items.filter(d => d.state !== GONE);
    let n = this.puffCount;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        // Swap-remove keeps the active puffs packed at the front.
        n--;
        const last = this.puffs[n];
        this.puffs[n] = p;
        this.puffs[i] = last;
        i--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 2;
    }
    this.puffCount = n;
  }

  /**
   * World-space draw. `m` is the camera's world → device matrix; per-item transforms (sway,
   * flip, scale, falling spin) are composed on top of it without save/restore.
   */
  draw(ctx: CanvasRenderingContext2D, m: Mat, view: ViewInfo, time: number, wind: number): void {
    const items = this.items;
    if (!items.length && !this.puffCount) return;
    const windN = clamp(wind / 10, -1, 1);
    const gust = 0.55 + 0.45 * Math.sin(time * 0.53) * Math.sin(time * 0.31 + 1.3);
    const motion = view.reducedMotion ? 0.35 : 1;
    const l = view.left - 80, r = view.right + 80;

    // Additive halos behind glowing decorations.
    ctx.globalCompositeOperation = 'lighter';
    for (const d of items) {
      const s = d.sprite;
      if (!s.glow || d.x < l || d.x > r) continue;
      const pulse = 0.75 + 0.25 * Math.sin(time * 1.7 + d.phase);
      ctx.globalAlpha = d.alpha * pulse;
      const gs = d.scale;
      ctx.drawImage(s.glow, d.x - (s.glowAx ?? 0) * gs, d.y - (s.glowAy ?? 0) * gs, (s.glowW ?? 0) * gs, (s.glowH ?? 0) * gs);
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const d of items) {
      if (d.x < l || d.x > r) continue;
      const s = d.sprite;
      let rot = 0;
      if (d.state === ALIVE) {
        if (d.kind.sway > 0) {
          const w = Math.sin(time * 1.9 + d.phase + d.x * 0.013) * (0.3 + 0.7 * Math.abs(windN) * gust);
          rot = (w * 0.5 + windN * 0.75 * gust) * d.kind.sway * motion;
        }
      } else if (d.state === FALLING) {
        rot = d.rot * d.t;
      }
      const sy = d.state === FADING ? d.scale * (0.6 + 0.4 * d.alpha) : d.scale;
      const sx = d.flip * d.scale;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const la = cs * sx, lb = sn * sx, lc = -sn * sy, ld = cs * sy;
      ctx.setTransform(
        m.a * la + m.c * lb, m.b * la + m.d * lb,
        m.a * lc + m.c * ld, m.b * lc + m.d * ld,
        m.a * d.x + m.c * d.y + m.e, m.b * d.x + m.d * d.y + m.f,
      );
      ctx.globalAlpha = d.alpha;
      ctx.drawImage(s.canvas, -s.ax, -s.ay, s.w, s.h);
      if (s.beacon && d.state === ALIVE) {
        const on = Math.sin(time * 3.2 + d.phase) > 0.55;
        if (on) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,70,60,0.35)';
          ctx.fillRect(s.beacon[0] * d.flip - 3, s.beacon[1] - 3, 6, 6);
          ctx.fillStyle = '#ff6a5a';
          ctx.fillRect(s.beacon[0] * d.flip - 1, s.beacon[1] - 1, 2, 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha = 1;

    // Dust puffs from removed decorations.
    if (this.puffCount) {
      ctx.fillStyle = this.puffColor;
      for (let i = 0; i < this.puffCount; i++) {
        const p = this.puffs[i];
        const k = p.age / p.life;
        ctx.globalAlpha = 0.55 * (1 - k) * (1 - k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + k * 1.6), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  get biome(): BiomeId {
    return this.biomeId;
  }
}
