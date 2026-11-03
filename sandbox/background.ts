// Sandbox: Background in isolation with a real generated terrain composited on top.
// URL params: biome, seed, wind, zoom, cx, cy, sim (pre-advance seconds), quality, thumbs=1, sweep=1 (animated camera).
import { Background } from '../src/render/background.ts';
import { BIOMES, BIOME_IDS, type BiomeId } from '../src/core/biomes.ts';
import { WORLD_H, WORLD_W } from '../src/core/constants.ts';
import type { ViewInfo } from '../src/contracts.ts';
import type { Quality } from '../src/core/settings.ts';
import { generateTerrain } from '../src/sim/terrainGen.ts';

const q = new URLSearchParams(location.search);
const biome = (q.get('biome') ?? 'verdant') as BiomeId;
const seed = Number(q.get('seed') ?? 1234);
let wind = Number(q.get('wind') ?? 3);
let zoom = Number(q.get('zoom') ?? 1);
let camX = Number(q.get('cx') ?? WORLD_W / 2);
let camY = Number(q.get('cy') ?? WORLD_H / 2);
const quality = (q.get('quality') ?? 'high') as Quality;
const sweep = q.get('sweep') === '1';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const bg = new Background();
const hud = document.getElementById('hud')!;

if (q.get('thumbs') === '1') {
  const box = document.getElementById('thumbs')!;
  box.style.display = 'flex';
  const t0 = performance.now();
  for (const id of BIOME_IDS) box.appendChild(bg.thumbnail(id, 360, 220));
  for (const id of BIOME_IDS) box.appendChild(bg.thumbnail(id, 180, 110));
  hud.textContent = `thumbs ${(performance.now() - t0).toFixed(0)} ms`;
} else {
  const t0 = performance.now();
  bg.setBiome(biome, seed);
  const buildMs = performance.now() - t0;
  const { terrain } = generateTerrain(BIOMES[biome], seed);
  const img = new ImageData(WORLD_W, WORLD_H);
  terrain.writeRGBA({ x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H }, img.data);
  const ground = document.createElement('canvas');
  ground.width = WORLD_W;
  ground.height = WORLD_H;
  ground.getContext('2d')!.putImageData(img, 0, 0);

  let time = 0;
  const sim = Number(q.get('sim') ?? 0);
  for (let s = 0; s < sim; s += 1 / 30) { time += 1 / 30; bg.update(1 / 30, wind, time); }

  const view: ViewInfo = { left: 0, top: 0, right: 0, bottom: 0, scale: 1, cw: 0, ch: 0, dpr: 1, time: 0, dt: 0, quality, reducedMotion: false };
  let last = performance.now();
  let frames = 0, acc = 0, drawMs = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const fit = Math.min(cw / WORLD_W, ch / WORLD_H);
    let z = zoom, cx = camX, cy = camY;
    if (sweep) {
      z = 0.82 + 0.25 * Math.sin(time * 0.4);
      cx = WORLD_W / 2 + Math.sin(time * 0.3) * 300;
      cy = WORLD_H / 2 + Math.cos(time * 0.5) * 120;
    }
    const scale = fit * z;
    Object.assign(view, {
      scale, cw, ch, dpr, time, dt,
      left: cx - cw / 2 / scale, right: cx + cw / 2 / scale, top: cy - ch / 2 / scale, bottom: cy + ch / 2 / scale,
    });
    const t1 = performance.now();
    bg.update(dt, wind, time);
    bg.drawBack(ctx, view);
    ctx.setTransform(scale, 0, 0, scale, -view.left * scale, -view.top * scale);
    ctx.drawImage(ground, 0, 0);
    bg.drawFront(ctx, view);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawMs += performance.now() - t1;
    frames++;
    acc += dt;
    if (acc > 0.5) {
      hud.textContent = `${BIOMES[biome].name} · build ${buildMs.toFixed(0)} ms · bg ${(drawMs / frames).toFixed(2)} ms/frame · wind ${wind}`;
      frames = 0; acc = 0; drawMs = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as Record<string, unknown>).__bg = {
    bg,
    setWind: (w: number) => { wind = w; },
    setCam: (x: number, y: number, zz: number) => { camX = x; camY = y; zoom = zz; },
    skip: (s: number) => { for (let k = 0; k < s * 30; k++) { time += 1 / 30; bg.update(1 / 30, wind, time); } },
  };
}
