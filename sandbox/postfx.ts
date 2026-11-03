/**
 * PostFx sandbox. URL parameters:
 *   view=split|grid|full   split: raw | processed; grid: raw, neutral, graded, full fx; full: one fullscreen output
 *   grade=<biome>|neutral   colour grade (default dunes)
 *   bloom=<scale>           frame.bloomScale (default 1)
 *   chroma=<0..1>|pulse     chromatic aberration (pulse = animated hits)
 *   shock=<0..1>            animated shockwave strength (default 0.8, 0 = none)
 *   flash=<0..1>            additive flash amount (warm white)
 *   grain=<0..1>            film grain (default 0.35)
 *   quality=high|medium|low
 *   t=<seconds>             freeze time (deterministic screenshots)
 *   scene=night             dark test scene (cinder/lunar-like) instead of dusk
 * window.__pfx.check() renders a neutral pass and compares it to the source pixels.
 */
import type { PostFxApi, PostFxFrame, Shockwave } from '../src/contracts.ts';
import { BIOMES, type BiomeId, type ColorGrade } from '../src/core/biomes.ts';
import type { Quality } from '../src/core/settings.ts';
import { createPostFx } from '../src/render/postfx.ts';
import { TestScene } from './postfx/scene.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = q.get(k);
  return v === null || v === '' || isNaN(Number(v)) ? d : Number(v);
};
const view = q.get('view') ?? 'split';
const gradeId = q.get('grade') ?? 'dunes';
const bloomScale = num('bloom', 1);
const chromaParam = q.get('chroma') ?? '0';
const shockStrength = num('shock', 0.8);
const flashAmt = num('flash', 0);
const grain = num('grain', 0.35);
const quality = (q.get('quality') ?? 'high') as Quality;
const frozen = q.has('t') ? num('t', 0) : -1;

const NEUTRAL: ColorGrade = {
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, contrast: 1, vignette: 0, bloom: 0, bloomThreshold: 1,
};
const grade: ColorGrade = gradeId in BIOMES ? BIOMES[gradeId as BiomeId].grade : NEUTRAL;

// ---- Animated shockwaves (pooled) -----------------------------------------------------
const SPOTS = [[0.3, 0.66], [0.62, 0.42], [0.18, 0.4], [0.8, 0.7], [0.48, 0.58]];
const pool: Shockwave[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, radius: 0, width: 0, strength: 0 }));
const live: Shockwave[] = [];
function updateWaves(t: number, strength: number): void {
  live.length = 0;
  if (strength <= 0) return;
  const period = 0.55, life = 1.6;
  const newest = Math.floor(t / period);
  for (let k = newest; k > newest - 4 && live.length < pool.length; k--) {
    if (k < 0) break;
    const age = t - k * period;
    if (age > life) continue;
    const a = age / life;
    const w = pool[live.length];
    const spot = SPOTS[((k % SPOTS.length) + SPOTS.length) % SPOTS.length];
    w.x = spot[0];
    w.y = spot[1];
    w.radius = 0.02 + 0.5 * (1 - (1 - a) ** 3);
    w.width = 0.05 + 0.07 * a;
    w.strength = strength * (1 - a) ** 1.6;
    live.push(w);
  }
}

// ---- Panels ---------------------------------------------------------------------------
interface Panel {
  label: string;
  fx: PostFxApi | null; // null = raw source
  frame: PostFxFrame;
  cell: HTMLDivElement;
  out: HTMLCanvasElement;
}

const root = document.getElementById('root') as HTMLDivElement;
const info = document.getElementById('info') as HTMLDivElement;
const scene = new TestScene(16, 16, q.get('scene') === 'night');
const panels: Panel[] = [];

function makeFrame(g: ColorGrade, opts: Partial<PostFxFrame> = {}): PostFxFrame {
  return {
    time: 0, grade: g, bloomScale, chroma: 0, grain, quality,
    flash: { r: 1, g: 0.86, b: 0.62, amount: flashAmt }, shockwaves: live, ...opts,
  };
}

function addPanel(label: string, frame: PostFxFrame | null): void {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const tag = document.createElement('span');
  tag.textContent = label;
  cell.appendChild(tag);
  let fx: PostFxApi | null = null;
  let out: HTMLCanvasElement;
  if (frame) {
    fx = createPostFx();
    if (!fx) {
      tag.textContent = `${label} - WebGL2 unavailable`;
      out = document.createElement('canvas');
    } else out = fx.canvas;
  } else {
    // Raw: a 2D copy of the shared scene.
    out = document.createElement('canvas');
  }
  cell.appendChild(out);
  root.appendChild(cell);
  panels.push({ label, fx, frame: frame ?? makeFrame(NEUTRAL), cell, out });
}

const fxDesc = `${gradeId} bloom×${bloomScale} chroma ${chromaParam} shock ${shockStrength} flash ${flashAmt}`;
if (view === 'full') {
  root.className = 'full';
  addPanel(fxDesc, makeFrame(grade));
} else if (view === 'grid') {
  root.style.gridTemplateColumns = '1fr 1fr';
  root.style.gridTemplateRows = '1fr 1fr';
  addPanel('raw source', null);
  addPanel('neutral (no fx)', makeFrame(NEUTRAL, { grain: 0, shockwaves: [], flash: { r: 0, g: 0, b: 0, amount: 0 } }));
  addPanel(`grade ${gradeId} + bloom`, makeFrame(grade, { shockwaves: [], flash: { r: 0, g: 0, b: 0, amount: 0 } }));
  addPanel(`full: ${fxDesc}`, makeFrame(grade));
} else {
  root.style.gridTemplateColumns = '1fr 1fr';
  addPanel('raw source', null);
  addPanel(fxDesc, makeFrame(grade));
}

// ---- Sizing: every panel shares one scene canvas at the cell's device-pixel size --------
let cw = 0, ch = 0;
function layout(): void {
  const r = panels[0].cell.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (w === cw && h === ch) return;
  cw = w;
  ch = h;
  scene.resize(w, h);
  for (const p of panels) {
    if (p.fx) p.fx.resize(w, h);
    else {
      p.out.width = w;
      p.out.height = h;
    }
  }
}
window.addEventListener('resize', layout);

// ---- Loop -------------------------------------------------------------------------------
const t0 = performance.now();
let frames = 0, fpsT = t0, fps = 0;
function tick(now: number): void {
  layout();
  const t = frozen >= 0 ? frozen : (now - t0) / 1000;
  scene.draw(t);
  updateWaves(t, shockStrength);
  const chroma = chromaParam === 'pulse' ? Math.max(0, 1 - ((t % 1.6) / 0.6)) ** 2 : Number(chromaParam) || 0;
  for (const p of panels) {
    if (!p.fx) {
      p.out.getContext('2d')!.drawImage(scene.canvas, 0, 0);
      continue;
    }
    p.frame.time = t;
    if (p === panels[panels.length - 1]) p.frame.chroma = chroma;
    p.fx.render(scene.canvas, p.frame);
  }
  frames++;
  if (now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
    info.textContent = `${cw}x${ch}  ${fps.toFixed(1)} fps  quality ${quality}`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- Automated checks -------------------------------------------------------------------
/** Neutral pass vs source: mean / max channel difference (dither adds at most ~1 LSB). */
function check(): Record<string, number | string> {
  const fx = createPostFx();
  if (!fx) return { error: 'no webgl2' };
  const w = 640, h = 360;
  const src = new TestScene(w, h);
  src.draw(1.234);
  fx.resize(w, h);
  fx.render(src.canvas, makeFrame(NEUTRAL, { grain: 0, shockwaves: [], chroma: 0, flash: { r: 0, g: 0, b: 0, amount: 0 } }));
  const cap = document.createElement('canvas');
  cap.width = w;
  cap.height = h;
  const cx = cap.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(fx.canvas, 0, 0); // same task as render(), so the drawing buffer is still valid
  const a = cx.getImageData(0, 0, w, h).data;
  const b = src.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let sum = 0, max = 0, flipped = 0, over4 = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum += d;
      if (d > max) max = d;
      if (d > 4) over4++;
    }
  }
  // Orientation: compare against the vertically flipped source as well.
  for (let y = 0; y < h; y += 7) {
    for (let x = 0; x < w; x += 7) {
      const i = (y * w + x) * 4, j = ((h - 1 - y) * w + x) * 4;
      flipped += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
    }
  }
  fx.dispose();
  return {
    meanDiff: +(sum / (w * h * 3)).toFixed(3),
    maxDiff: max, // only at hard edges near the corners (baseline edge chroma)
    pctOver4: +((100 * over4) / (w * h * 3)).toFixed(3),
    flippedMeanDiff: +(flipped / (Math.ceil(w / 7) * Math.ceil(h / 7) * 3)).toFixed(2),
  };
}

(window as unknown as { __pfx: unknown }).__pfx = { check, panels };
