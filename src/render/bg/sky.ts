/** Sky gradient strip and celestial bodies (sun, setting sun, blood moon, ringed planet) as pre-rendered sprites. */
import type { BiomeDef } from '../../core/biomes.ts';
import { mixHex, rgba, shadeHex } from '../../core/color.ts';
import { TAU } from '../../core/math.ts';
import { ctx2d, glowSprite, makeCanvas, mulberry, vStrip } from './util.ts';

/** Layer-space vertical extent mapped by the sky strip. */
export const SKY_TOP = -1100;
export const SKY_BOTTOM = 1400;
/** Layer-space horizon line (where the far layers sit). */
export const HORIZON = 700;

/** A pre-rendered sprite placed at a layer-space centre with a layer-space size. */
export interface Placed {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Additive blend (glows). */
  add: boolean;
  alpha: number;
}

export interface SkyAssets {
  strip: HTMLCanvasElement;
  topColor: string;
  bottomColor: string;
  /** Drawn in order, behind everything else (celestial, glows, bands). */
  celestial: Placed[];
  /** Rotating god-ray sprite (sun biomes). */
  rays: Placed | null;
  /** Second, smaller celestial (lunar moonlet), drawn before the main one. */
  sunX: number;
  sunY: number;
}

function placed(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number, add = false, alpha = 1): Placed {
  return { canvas, x, y, w, h, add, alpha };
}

function skyStrip(b: BiomeDef): HTMLCanvasElement {
  const [top, mid, hor] = b.palette.sky;
  const span = SKY_BOTTOM - SKY_TOP;
  const at = (y: number): number => Math.min(1, Math.max(0, (y - SKY_TOP) / span));
  const haze = b.palette.haze;
  switch (b.id) {
    case 'dunes':
      return vStrip(1024, [
        [0, top], [at(-350), top], [at(120), mixHex(top, mid, 0.55)], [at(420), mid],
        [at(610), mixHex(mid, hor, 0.65)], [at(HORIZON), hor], [at(820), mixHex(hor, haze, 0.5)], [1, mixHex(hor, mid, 0.4)],
      ]);
    case 'cinder':
      return vStrip(1024, [
        [0, top], [at(-200), top], [at(250), mid], [at(560), mixHex(mid, hor, 0.6)], [at(HORIZON), hor],
        [at(860), mixHex(hor, mid, 0.5)], [1, mid],
      ]);
    case 'lunar':
      return vStrip(1024, [
        [0, top], [at(0), top], [at(380), mid], [at(640), mixHex(mid, hor, 0.8)], [at(HORIZON), hor],
        [at(900), mixHex(hor, mid, 0.6)], [1, mid],
      ]);
    default:
      return vStrip(1024, [
        [0, shadeHex(top, 0.82)], [at(-300), top], [at(250), mixHex(top, mid, 0.6)], [at(480), mid],
        [at(HORIZON), hor], [at(900), mixHex(hor, haze, 0.6)], [1, haze],
      ]);
  }
}

/** Bright sun disc with a soft additive halo (bloom-friendly). */
function sunSprites(b: BiomeDef, res: number, x: number, y: number, r: number, out: Placed[]): void {
  const p = b.palette;
  const haloR = r * 9;
  const halo = glowSprite(Math.ceil(haloR * 2 * res * 0.5), [
    [0, rgba(p.celestialGlow, 0.55)], [0.08, rgba(p.celestialGlow, 0.4)], [0.22, rgba(p.celestialGlow, 0.14)],
    [0.5, rgba(p.celestialGlow, 0.04)], [1, rgba(p.celestialGlow, 0)],
  ]);
  out.push(placed(halo, x, y, haloR * 2, haloR * 2, true, 1));
  const size = Math.ceil(r * 2.6 * res);
  const disc = makeCanvas(size, size);
  const g = ctx2d(disc);
  const c = size / 2, rr = r * res;
  const corona = g.createRadialGradient(c, c, rr * 0.9, c, c, c);
  corona.addColorStop(0, rgba(p.celestial, 0.9));
  corona.addColorStop(0.3, rgba(p.celestialGlow, 0.35));
  corona.addColorStop(1, rgba(p.celestialGlow, 0));
  g.fillStyle = corona;
  g.fillRect(0, 0, size, size);
  const body = g.createRadialGradient(c - rr * 0.2, c - rr * 0.2, 0, c, c, rr);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.7, p.celestial);
  body.addColorStop(1, mixHex(p.celestial, p.celestialGlow, 0.5));
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, rr, 0, TAU);
  g.fill();
  out.push(placed(disc, x, y, r * 2.6, r * 2.6, false, 1));
}

/** Soft god rays: thin wedges with feathered edges, rotated slowly at draw time. */
function raysSprite(b: BiomeDef, res: number, x: number, y: number, len: number, count: number, seed: number): Placed {
  const size = Math.ceil(len * 2 * res * 0.4);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const rnd = mulberry(seed);
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, rgba(b.palette.celestialGlow, 0.5));
  grad.addColorStop(0.25, rgba(b.palette.celestialGlow, 0.16));
  grad.addColorStop(1, rgba(b.palette.celestialGlow, 0));
  g.fillStyle = grad;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rnd() * 0.3;
    const wdt = 0.025 + rnd() * 0.06;
    g.globalAlpha = 0.35 + rnd() * 0.65;
    g.beginPath();
    g.moveTo(h, h);
    g.arc(h, h, h, a - wdt, a + wdt);
    g.closePath();
    g.fill();
  }
  // Feather the wedges (build time only).
  const soft = makeCanvas(size, size);
  const sg = ctx2d(soft);
  sg.filter = `blur(${Math.max(1, size * 0.006).toFixed(1)}px)`;
  sg.drawImage(c, 0, 0);
  return placed(soft, x, y, len * 2, len * 2, true, 1);
}

/** Huge low setting sun with horizontal glow bands and thin haze stripes across its lower half. */
function settingSun(b: BiomeDef, res: number, x: number, y: number, r: number, out: Placed[]): void {
  const p = b.palette;
  const haloR = r * 4.2;
  out.push(placed(glowSprite(Math.ceil(haloR * res * 0.6), [
    [0, rgba(p.celestialGlow, 0.6)], [0.25, rgba(p.celestialGlow, 0.32)], [0.55, rgba(p.accent, 0.1)], [1, rgba(p.accent, 0)],
  ]), x, y, haloR * 2, haloR * 2, true, 1));
  // Wide horizontal bands: the same glow squashed vertically (layered).
  const band = glowSprite(256, [[0, rgba(p.celestialGlow, 0.5)], [0.4, rgba(p.celestialGlow, 0.16)], [1, rgba(p.celestialGlow, 0)]]);
  out.push(placed(band, x, y + r * 0.35, r * 12, r * 1.3, true, 0.9));
  out.push(placed(band, x, y + r * 0.65, r * 7, r * 0.5, true, 0.8));
  const size = Math.ceil(r * 2.4 * res);
  const disc = makeCanvas(size, size);
  const g = ctx2d(disc);
  const c = size / 2, rr = r * res;
  const rim = g.createRadialGradient(c, c, rr * 0.95, c, c, c);
  rim.addColorStop(0, rgba(p.celestialGlow, 0.7));
  rim.addColorStop(1, rgba(p.celestialGlow, 0));
  g.fillStyle = rim;
  g.fillRect(0, 0, size, size);
  g.save();
  g.beginPath();
  g.arc(c, c, rr, 0, TAU);
  g.clip();
  const body = g.createLinearGradient(0, c - rr, 0, c + rr);
  body.addColorStop(0, '#fffbe8');
  body.addColorStop(0.45, p.celestial);
  body.addColorStop(0.8, mixHex(p.celestial, p.celestialGlow, 0.55));
  body.addColorStop(1, mixHex(p.celestialGlow, p.accent, 0.4));
  g.fillStyle = body;
  g.fillRect(0, 0, size, size);
  // Thin atmospheric stripes, thicker toward the horizon.
  g.fillStyle = rgba(mixHex(p.sky[1], p.far[0], 0.5), 0.13);
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const yy = c + rr * (0.15 + t * 0.8);
    const th = rr * (0.012 + t * 0.03);
    g.fillRect(0, yy, size, th);
  }
  g.restore();
  out.push(placed(disc, x, y, r * 2.4, r * 2.4, false, 1));
}

/** Blood-red moon with maria, limb darkening and drifting ash streaks baked across it. */
function bloodMoon(b: BiomeDef, res: number, x: number, y: number, r: number, seed: number, out: Placed[]): void {
  const p = b.palette;
  const haloR = r * 6;
  out.push(placed(glowSprite(Math.ceil(haloR * res * 0.6), [
    [0, rgba(p.celestialGlow, 0.5)], [0.2, rgba(p.celestialGlow, 0.22)], [0.5, rgba(p.celestialGlow, 0.06)], [1, rgba(p.celestialGlow, 0)],
  ]), x, y, haloR * 2, haloR * 2, true, 1));
  const size = Math.ceil(r * 2.2 * res);
  const disc = makeCanvas(size, size);
  const g = ctx2d(disc);
  const c = size / 2, rr = r * res;
  const rnd = mulberry(seed);
  g.save();
  g.beginPath();
  g.arc(c, c, rr, 0, TAU);
  g.clip();
  const body = g.createRadialGradient(c - rr * 0.3, c - rr * 0.35, rr * 0.1, c, c, rr);
  body.addColorStop(0, mixHex(p.celestial, p.celestialGlow, 0.35));
  body.addColorStop(0.5, mixHex(p.celestialGlow, '#d0281c', 0.45));
  body.addColorStop(1, shadeHex('#b0201a', 0.55));
  g.fillStyle = body;
  g.fillRect(0, 0, size, size);
  // Maria and craters.
  for (let i = 0; i < 16; i++) {
    const mr = rr * (0.06 + rnd() * (i < 5 ? 0.28 : 0.09));
    const mx = c + (rnd() * 2 - 1) * rr * 0.75, my = c + (rnd() * 2 - 1) * rr * 0.75;
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr);
    mg.addColorStop(0, rgba(shadeHex(p.celestialGlow, 0.35), i < 5 ? 0.35 : 0.45));
    mg.addColorStop(0.7, rgba(shadeHex(p.celestialGlow, 0.4), i < 5 ? 0.2 : 0.25));
    mg.addColorStop(1, rgba(shadeHex(p.celestialGlow, 0.4), 0));
    g.fillStyle = mg;
    g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }
  // Ash streaks drifting across the disc.
  for (let i = 0; i < 3; i++) {
    const yy = c + (rnd() * 2 - 1) * rr * 0.7;
    g.fillStyle = rgba(p.sky[1], 0.08 + rnd() * 0.1);
    g.beginPath();
    g.ellipse(c + (rnd() - 0.5) * rr, yy, rr * (0.8 + rnd()), rr * (0.03 + rnd() * 0.06), 0, 0, TAU);
    g.fill();
  }
  g.restore();
  out.push(placed(disc, x, y, r * 2.2, r * 2.2, false, 1));
}

/** Big blue planet: oceans, swirling cloud bands, night side, lit atmosphere rim. Light comes from the upper left. */
function planet(b: BiomeDef, res: number, x: number, y: number, r: number, seed: number, out: Placed[]): void {
  const p = b.palette;
  const lx = -0.66, ly = -0.42; // towards the light (upper left)
  const haloR = r * 1.6;
  out.push(placed(glowSprite(Math.ceil(haloR * res * 0.5), [
    [0, rgba(p.celestialGlow, 0.22)], [0.6, rgba(p.celestialGlow, 0.18)], [0.64, rgba(p.celestialGlow, 0.12)],
    [0.8, rgba(p.celestialGlow, 0.03)], [1, rgba(p.celestialGlow, 0)],
  ]), x + lx * r * 0.12, y + ly * r * 0.12, haloR * 2, haloR * 2, true, 1));
  const size = Math.ceil(r * 2.3 * res);
  const c = size / 2, rr = r * res;
  const rnd = mulberry(seed);
  const disc = makeCanvas(size, size);
  const g = ctx2d(disc);
  g.save();
  g.beginPath();
  g.arc(c, c, rr, 0, TAU);
  g.clip();
  const ocean = g.createRadialGradient(c + lx * rr * 0.45, c + ly * rr * 0.45, rr * 0.05, c, c, rr);
  ocean.addColorStop(0, mixHex(p.celestial, '#c8ecff', 0.4));
  ocean.addColorStop(0.55, p.celestial);
  ocean.addColorStop(1, shadeHex(p.celestial, 0.6));
  g.fillStyle = ocean;
  g.fillRect(0, 0, size, size);
  // Surface detail (continents + cloud bands) on a soft layer, foreshortened onto the sphere.
  const det = makeCanvas(size, size);
  const d = ctx2d(det);
  for (let i = 0; i < 10; i++) {
    const lat = (rnd() * 2 - 1) * 1.1, lon = (rnd() * 2 - 1) * 1.3;
    const cx = c + rr * Math.cos(lat) * Math.sin(lon), cy = c + rr * Math.sin(lat);
    const cr = rr * (0.06 + rnd() * 0.16);
    const sq = Math.max(0.25, Math.cos(lon));
    d.fillStyle = `rgba(${50 + rnd() * 30 | 0},${120 + rnd() * 30 | 0},${110 + rnd() * 20 | 0},0.4)`;
    for (let k = 0; k < 5; k++) {
      d.beginPath();
      d.ellipse(cx + (rnd() - 0.5) * cr * 1.6 * sq, cy + (rnd() - 0.5) * cr, cr * (0.5 + rnd() * 0.6) * sq, cr * (0.4 + rnd() * 0.5), 0, 0, TAU);
      d.fill();
    }
  }
  d.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const lat = (rnd() * 2 - 1) * 1.3;
    const u0 = -1.5 + rnd() * 2.4, u1 = Math.min(1.57, u0 + 0.3 + rnd() * 1.4);
    const amp = rr * (0.003 + rnd() * 0.01), fr = 2 + rnd() * 4, ph = rnd() * TAU;
    d.strokeStyle = `rgba(240,248,255,${(0.1 + rnd() * 0.28).toFixed(3)})`;
    d.lineWidth = rr * (0.012 + rnd() * 0.045) * Math.cos(lat);
    d.beginPath();
    for (let u = u0; u <= u1; u += 0.04) {
      const px = c + rr * Math.cos(lat) * Math.sin(u);
      const py = c + rr * Math.sin(lat) + Math.sin(u * fr + ph) * amp * Math.cos(u);
      if (u === u0) d.moveTo(px, py); else d.lineTo(px, py);
    }
    d.stroke();
  }
  g.filter = `blur(${Math.max(0.8, rr * 0.011).toFixed(1)}px)`;
  g.drawImage(det, 0, 0);
  g.filter = 'none';
  // Limb darkening.
  const limb = g.createRadialGradient(c, c, rr * 0.6, c, c, rr);
  limb.addColorStop(0, 'rgba(0,10,40,0)');
  limb.addColorStop(1, 'rgba(0,10,40,0.35)');
  g.fillStyle = limb;
  g.fillRect(0, 0, size, size);
  // Night side: darkness everywhere except a soft, offset lit circle (curved terminator).
  const night = makeCanvas(size, size);
  const n = ctx2d(night);
  n.fillStyle = 'rgba(2,5,16,0.95)';
  n.fillRect(0, 0, size, size);
  n.globalCompositeOperation = 'destination-out';
  const lcx = c + lx * rr * 0.78, lcy = c + ly * rr * 0.78;
  const lit = n.createRadialGradient(lcx, lcy, 0, lcx, lcy, rr * 1.18);
  lit.addColorStop(0, 'rgba(0,0,0,1)');
  lit.addColorStop(0.7, 'rgba(0,0,0,0.92)');
  lit.addColorStop(0.86, 'rgba(0,0,0,0.25)');
  lit.addColorStop(1, 'rgba(0,0,0,0)');
  n.fillStyle = lit;
  n.fillRect(0, 0, size, size);
  g.drawImage(night, 0, 0);
  // City lights glittering on the night side.
  for (let i = 0; i < 90; i++) {
    const a = rnd() * TAU, dd = Math.sqrt(rnd()) * rr * 0.92;
    const px = c + Math.cos(a) * dd, py = c + Math.sin(a) * dd;
    if (Math.hypot(px - lcx, py - lcy) < rr * 1.06) continue;
    g.fillStyle = `rgba(255,212,140,${(0.25 + rnd() * 0.5).toFixed(3)})`;
    g.fillRect(px, py, res * 1.5, res * 1.5);
  }
  g.restore();
  // Atmosphere: a full thin ring masked toward the light so it fades smoothly around the limb.
  const ring = makeCanvas(size, size);
  const rg = ctx2d(ring);
  for (let k = 0; k < 7; k++) {
    rg.strokeStyle = rgba(k < 2 ? '#d8f0ff' : p.celestialGlow, 0.32 - k * 0.04);
    rg.lineWidth = rr * (0.008 + k * 0.009);
    rg.beginPath();
    rg.arc(c, c, rr * (1 + k * 0.004), 0, TAU);
    rg.stroke();
  }
  rg.globalCompositeOperation = 'destination-in';
  const mask = rg.createRadialGradient(c + lx * rr, c + ly * rr, 0, c + lx * rr, c + ly * rr, rr * 2.1);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  rg.fillStyle = mask;
  rg.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(ring, 0, 0);
  g.globalCompositeOperation = 'source-over';
  out.push(placed(disc, x, y, r * 2.3, r * 2.3, false, 1));
}

function moonlet(res: number, x: number, y: number, r: number, out: Placed[]): void {
  const size = Math.ceil(r * 2.4 * res);
  const disc = makeCanvas(size, size);
  const g = ctx2d(disc);
  const c = size / 2, rr = r * res;
  const body = g.createRadialGradient(c - rr * 0.45, c - rr * 0.4, 0, c, c, rr);
  body.addColorStop(0, '#f2f0ea');
  body.addColorStop(0.55, '#a9a7a2');
  body.addColorStop(0.85, '#3a3c48');
  body.addColorStop(1, '#14161f');
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, rr, 0, TAU);
  g.fill();
  out.push(placed(disc, x, y, r * 2.4, r * 2.4, false, 1));
}

export function buildSky(b: BiomeDef, res: number, seed: number): SkyAssets {
  const strip = skyStrip(b);
  const cel: Placed[] = [];
  let rays: Placed | null = null;
  let sunX = 0, sunY = 0;
  switch (b.id) {
    case 'verdant':
      sunX = 1480; sunY = 210;
      sunSprites(b, res, sunX, sunY, 46, cel);
      rays = raysSprite(b, res, sunX, sunY, 900, 26, seed);
      break;
    case 'frost':
      sunX = 430; sunY = 250;
      sunSprites(b, res, sunX, sunY, 40, cel);
      rays = raysSprite(b, res, sunX, sunY, 1000, 30, seed);
      break;
    case 'dunes':
      sunX = 1220; sunY = 440;
      settingSun(b, res, sunX, sunY, 165, cel);
      break;
    case 'cinder':
      sunX = 1390; sunY = 230;
      bloodMoon(b, res, sunX, sunY, 74, seed, cel);
      break;
    case 'lunar':
      sunX = 1330; sunY = 330;
      moonlet(res, 360, 170, 20, cel);
      planet(b, res, sunX, sunY, 250, seed, cel);
      break;
  }
  const top = vStripColor(strip, 0), bottom = vStripColor(strip, 1);
  return { strip, topColor: top, bottomColor: bottom, celestial: cel, rays, sunX, sunY };
}

function vStripColor(strip: HTMLCanvasElement, t: number): string {
  const d = ctx2d(strip).getImageData(0, Math.min(strip.height - 1, Math.round(t * (strip.height - 1))), 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}
