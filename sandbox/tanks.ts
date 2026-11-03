// Sandbox: TankRenderer in isolation. ?scene=grid|zoom|anim  &debug=1 draws muzzlePoint()/turretPivot() dots.
import type { TankDrawInfo } from '../src/contracts.ts';
import { BIOMES, type BiomeId } from '../src/core/biomes.ts';
import { muzzlePoint, turretPivot } from '../src/core/geometry.ts';
import { TEAMS } from '../src/core/teams.ts';
import type { PlayerIndex, TankState } from '../src/core/types.ts';
import { TankRenderer } from '../src/render/tanks.ts';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'grid';
const debug = params.get('debug') === '1';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const dpr = Math.min(2, window.devicePixelRatio || 1);

function makeTank(index: PlayerIndex, p: Partial<TankState> = {}): TankState {
  return {
    index, x: 0, y: 0, vy: 0, airborne: false, fallStartY: 0, tilt: 0, angle: index === 0 ? 45 : 135, power: 60,
    hp: 100, maxHp: 100, shield: 0, fuel: 240, alive: true, weapon: 'ember',
    ammo: {} as TankState['ammo'], moveDir: 0, treadPhase: 0, recoil: 0, hitFlash: 0,
    stats: { shots: 0, hits: 0, damageDealt: 0 }, ...p,
  };
}

interface Cell {
  tank: TankState;
  biome: BiomeId;
  active?: boolean;
  aiming?: boolean;
  label: string;
  /** Per-frame driver for animated scenes. */
  tick?: (t: TankState, time: number, dt: number) => void;
}

interface Band { biome: BiomeId; y0: number; y1: number }

const cells: Cell[] = [];
const bands: Band[] = [];
let scale = 1.5;
let view = { x: 0, y: 0 };
// One renderer per cell so per-tank spring state (keyed by index) doesn't collide in the grid.
const renderers = new Map<Cell, TankRenderer>();

function band(biome: BiomeId, y0: number, y1: number): void { bands.push({ biome, y0, y1 }); }

function buildGrid(): void {
  scale = 1.0;
  const biomes: BiomeId[] = ['frost', 'cinder', 'lunar', 'verdant', 'dunes'];
  const W = 1600, rows = biomes.length, rh = 900 / rows;
  biomes.forEach((b, r) => {
    band(b, r * rh, (r + 1) * rh);
    const gy = r * rh + rh * 0.78;
    const specs: [PlayerIndex, Partial<TankState>, string, boolean?, boolean?][] = [
      [0, { angle: 0 }, 'angle 0'],
      [1, { angle: 45, tilt: -0.3 }, '45 tilt -0.3'],
      [0, { angle: 90, tilt: 0.3 }, '90 tilt +0.3'],
      [1, { angle: 135, recoil: 0.8 }, '135 recoil'],
      [0, { angle: 180, hitFlash: 0.8 }, '180 hitFlash'],
      [1, { angle: 120, shield: 45 }, 'shield'],
      [0, { angle: 60, hp: 50 }, 'hp 50'],
      [1, { angle: 150, hp: 20 }, 'hp 20', true, true],
      [0, { angle: 30, alive: false, hp: 0 }, 'destroyed'],
      [1, { angle: 110, hp: 80 }, 'active', true, false],
    ];
    specs.forEach(([i, p, label, active, aiming], c) => {
      const x = (W / specs.length) * (c + 0.5);
      cells.push({ tank: makeTank(i, { x, y: gy, ...p }), biome: b, label, active, aiming });
    });
  });
}

function buildZoom(): void {
  scale = 4;
  band('verdant', 0, 450);
  band('cinder', 450, 900);
  const k = 1 / scale;
  cells.push({ tank: makeTank(0, { x: 400 * k, y: 330 * k, angle: 38 }), biome: 'verdant', label: 'azure', active: true, aiming: true });
  cells.push({ tank: makeTank(1, { x: 1150 * k, y: 330 * k, angle: 150, hp: 45, shield: 30 }), biome: 'verdant', label: 'blaze shield' });
  cells.push({ tank: makeTank(1, { x: 400 * k, y: 780 * k, angle: 120, hp: 25, tilt: 0.15 }), biome: 'cinder', label: 'blaze hp 25' });
  cells.push({ tank: makeTank(0, { x: 1150 * k, y: 780 * k, angle: 60, alive: false, hp: 0 }), biome: 'cinder', label: 'wreck' });
}

function buildAnim(): void {
  scale = 2.5;
  band('frost', 0, 450);
  band('lunar', 450, 900);
  const k = 1 / scale;
  // Drives back and forth.
  cells.push({
    tank: makeTank(0, { x: 300 * k, y: 330 * k, angle: 50 }), biome: 'frost', label: 'drive', active: true, aiming: true,
    tick: (t, time, dt) => {
      const dir = Math.sin(time * 0.9) > 0 ? 1 : -1;
      t.moveDir = dir;
      t.x += dir * 72 * dt;
      t.treadPhase += dir * 72 * dt;
    },
  });
  // Fires every 1.6 s.
  cells.push({
    tank: makeTank(1, { x: 1150 * k, y: 330 * k, angle: 140 }), biome: 'frost', label: 'fire',
    tick: (t, time, dt) => {
      if (Math.floor(time / 1.6) !== Math.floor((time - dt) / 1.6)) t.recoil = 1;
      t.recoil = Math.max(0, t.recoil - dt * 2.2);
      t.angle = 140 + Math.sin(time * 0.7) * 25;
    },
  });
  // Shielded, hit every 2 s.
  cells.push({
    tank: makeTank(1, { x: 300 * k, y: 780 * k, angle: 120, shield: 40 }), biome: 'lunar', label: 'shield hit',
    tick: (t, time, dt) => {
      if (Math.floor(time / 2) !== Math.floor((time - dt) / 2)) t.hitFlash = 1;
      t.hitFlash = Math.max(0, t.hitFlash - dt * 2.5);
    },
  });
  // Falls and lands repeatedly.
  const ground = 780 * k;
  cells.push({
    tank: makeTank(0, { x: 1150 * k, y: ground, angle: 70, hp: 30 }), biome: 'lunar', label: 'fall',
    tick: (t, time, dt) => {
      const ph = time % 2.4;
      if (ph < 1.2) { t.airborne = false; t.y = ground; t.vy = 0; return; }
      if (!t.airborne) { t.airborne = true; t.y = ground - 90; t.vy = 0; }
      t.vy += 400 * dt;
      t.y += t.vy * dt;
      if (t.y >= ground) { t.y = ground; t.airborne = false; }
    },
  });
}

function buildMacro(): void {
  scale = 9;
  const b = (params.get('biome') as BiomeId) ?? 'verdant';
  band(b, 0, 900);
  const k = 1 / scale;
  const hp = Number(params.get('hp') ?? 100);
  const angle = Number(params.get('angle') ?? 35);
  cells.push({ tank: makeTank(0, { x: 400 * k, y: 640 * k, angle, hp, recoil: Number(params.get('recoil') ?? 0) }), biome: b, label: '', active: true, aiming: true });
  cells.push({ tank: makeTank(1, { x: 1200 * k, y: 640 * k, angle: 180 - angle, hp: Math.min(hp, 30) }), biome: b, label: '' });
}

/** 3x crop: angle sweep on frost, states on lunar. */
function buildCrop(): void {
  scale = 3;
  band('frost', 0, 450);
  band('lunar', 450, 900);
  const k = 1 / scale;
  [0, 45, 90, 135, 180].forEach((angle, i) => {
    cells.push({ tank: makeTank((i % 2) as PlayerIndex, { x: (160 + i * 320) * k, y: 360 * k, angle }), biome: 'frost', label: `angle ${angle}` });
  });
  const states: [Partial<TankState>, string][] = [
    [{ tilt: -0.3, angle: 70, recoil: 0.7 }, 'tilt -0.3 recoil'],
    [{ tilt: 0.3, angle: 110, hp: 55 }, 'tilt +0.3 hp 55'],
    [{ angle: 40, shield: 45, hitFlash: 0.6 }, 'shield hit'],
    [{ angle: 150, hp: 20, hitFlash: 0.5 }, 'hp 20 flash'],
    [{ angle: 60, alive: false, hp: 0 }, 'destroyed'],
  ];
  states.forEach(([p, label], i) => {
    cells.push({ tank: makeTank(((i + 1) % 2) as PlayerIndex, { x: (160 + i * 320) * k, y: 810 * k, ...p }), biome: 'lunar', label });
  });
}

if (scene === 'zoom') buildZoom();
else if (scene === 'crop') buildCrop();
else if (scene === 'macro') buildMacro();
else if (scene === 'anim') buildAnim();
else buildGrid();

function resize(): void {
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

function drawBands(): void {
  for (const b of bands) {
    const p = BIOMES[b.biome].palette;
    const g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
    g.addColorStop(0, p.sky[0]);
    g.addColorStop(0.6, p.sky[1]);
    g.addColorStop(1, p.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, b.y0, 1600, b.y1 - b.y0);
  }
}

/** Ground slab under a tank, sloped to its tilt (world units around the tank). */
function drawGround(c: Cell): void {
  const p = BIOMES[c.biome].palette;
  const t = c.tank;
  const band = bands.find((b) => b.biome === c.biome && t.y * scale >= b.y0 && t.y * scale <= b.y1)!;
  const bottom = band.y1 / scale;
  const s = Math.tan(t.tilt);
  const w = scale >= 2 ? 160 / scale + 50 : 58;
  const gy = t.airborne ? (c.tick ? 780 / scale : t.y) : t.y;
  ctx.beginPath();
  ctx.moveTo(t.x - w, gy - s * w);
  ctx.lineTo(t.x + w, gy + s * w);
  ctx.lineTo(t.x + w, bottom);
  ctx.lineTo(t.x - w, bottom);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, gy - 20, 0, bottom);
  g.addColorStop(0, p.surface);
  g.addColorStop(0.25, p.surfaceDark);
  g.addColorStop(0.6, p.strata[1]);
  g.addColorStop(1, p.strata[3]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = p.rim;
  ctx.lineWidth = 1.5 / scale;
  ctx.beginPath();
  ctx.moveTo(t.x - w, gy - s * w);
  ctx.lineTo(t.x + w, gy + s * w);
  ctx.stroke();
}

function dot(x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.6 / Math.max(1, scale * 0.5), 0, Math.PI * 2);
  ctx.fill();
}

let last = performance.now();
let time = 0;
let drawMs = 0;
let drawCount = 0;
const stats = { avgDrawMs: 0 };
(window as unknown as { __tanks: unknown }).__tanks = { cells, stats, renderers };

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  ctx.setTransform(dpr * (canvas.width / dpr / 1600), 0, 0, dpr * (canvas.height / dpr / 900), 0, 0);
  drawBands();
  const base = ctx.getTransform();
  ctx.scale(scale, scale);
  ctx.translate(-view.x, -view.y);
  for (const c of cells) {
    c.tick?.(c.tank, time, dt);
    drawGround(c);
  }
  for (const c of cells) {
    let r = renderers.get(c);
    if (!r) renderers.set(c, (r = new TankRenderer()));
    const info: TankDrawInfo = {
      team: TEAMS[c.tank.index], active: !!c.active, aiming: !!c.aiming, time, dt, biome: c.biome,
    };
    const t0 = performance.now();
    r.draw(ctx, c.tank, info);
    drawMs += performance.now() - t0;
    drawCount++;
    if (debug) {
      const m = muzzlePoint(c.tank);
      const pv = turretPivot(c.tank);
      dot(pv.x, pv.y, '#00ff66');
      dot(m.x, m.y, '#ff00ff');
    }
  }
  ctx.setTransform(base);
  ctx.font = '600 11px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const c of cells) ctx.fillText(c.label, (c.tank.x - view.x) * scale - 30, (c.tank.y - view.y) * scale + 26);
  if (drawCount > 200) {
    stats.avgDrawMs = drawMs / drawCount;
    drawMs = 0;
    drawCount = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
