// Sandbox: drives the Fx module in isolation over a real generated terrain with two mock tanks.
// A scripted timeline triggers every explosion kind, every event and every hazard.
//   ?scene=<name>   run one scene (see SCENES) · ?biome=<id> · ?quality=low|medium|high · ?rm=1 · ?stress=1
//   window.__fx.seek(t) jumps the timeline (deterministic fixed-step replay) and freezes for screenshots.
import { BIOMES, type BiomeId } from '../src/core/biomes.ts';
import { WORLD_H, WORLD_W, MAX_HP, FUEL_PER_ROUND } from '../src/core/constants.ts';
import type { GameEvent } from '../src/core/events.ts';
import { DEG, clamp } from '../src/core/math.ts';
import type { Quality } from '../src/core/settings.ts';
import { TEAMS } from '../src/core/teams.ts';
import type { GameState, HazardKind, HazardState, TankState } from '../src/core/types.ts';
import { startingAmmo, type WeaponId } from '../src/core/weapons.ts';
import { muzzlePoint, tankCenter, turretPivot } from '../src/core/geometry.ts';
import type { FxHooks, ViewInfo } from '../src/contracts.ts';
import { generateTerrain } from '../src/sim/terrainGen.ts';
import type { Terrain } from '../src/sim/terrain.ts';
import { Fx } from '../src/render/fx.ts';
import { SCENES, type SceneApi } from './fx/scenes.ts';

const params = new URLSearchParams(location.search);
const biomeId = (params.get('biome') ?? 'verdant') as BiomeId;
const quality = (params.get('quality') ?? 'high') as Quality;
const reducedMotion = params.get('rm') === '1';
const sceneName = params.get('scene') ?? 'all';
const stress = params.get('stress') === '1';
const seed = Number(params.get('seed') ?? 7);
const zoomParam = Number(params.get('zoom') ?? 1);
let camX = Number(params.get('cx') ?? WORLD_W / 2), camY = Number(params.get('cy') ?? WORLD_H / 2);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;

// --- Hooks: a tiny camera/post stand-in so effects are visible in isolation -------------
let trauma = 0;
let flashA = 0, flashC = '#ffffff';
let hitStopLeft = 0, slowLeft = 0, slowScale = 1;
let focusX = WORLD_W / 2, focusY = WORLD_H / 2, focusZoom = 1, focusLeft = 0;
let chromaA = 0;
const rings: { x: number; y: number; t: number; s: number }[] = [];
const hookLog: string[] = [];
const hooks: FxHooks = {
  shake: (t) => { trauma = Math.min(1, trauma + t); },
  shockwave: (x, y, s) => { rings.push({ x, y, t: 0, s }); },
  chroma: (a) => { chromaA = Math.max(chromaA, a); },
  flash: (c, i) => { flashC = c; flashA = Math.max(flashA, i); hookLog.push(`flash ${i.toFixed(2)}`); },
  hitStop: (s) => { hitStopLeft = Math.max(hitStopLeft, s); hookLog.push(`hitStop ${s}`); },
  slowMo: (sc, s) => { slowScale = sc; slowLeft = s; hookLog.push(`slowMo ${sc}x${s}`); },
  focus: (x, y, z, s) => { focusX = x; focusY = y; focusZoom = z; focusLeft = s; hookLog.push('focus'); },
};

// --- World ----------------------------------------------------------------------------
let terrain: Terrain;
let spawns: [number, number];
const terrainCanvas = document.createElement('canvas');
terrainCanvas.width = WORLD_W;
terrainCanvas.height = WORLD_H;
const tctx = terrainCanvas.getContext('2d')!;
let terrainImg = tctx.createImageData(WORLD_W, WORLD_H);

function makeTank(index: 0 | 1, x: number): TankState {
  return {
    index, x, y: 0, vy: 0, airborne: false, fallStartY: 0, tilt: 0, angle: index === 0 ? 50 : 130, power: 60,
    hp: MAX_HP, maxHp: MAX_HP, shield: 0, fuel: FUEL_PER_ROUND, alive: true, weapon: 'ember', ammo: startingAmmo(),
    moveDir: 0, treadPhase: 0, recoil: 0, hitFlash: 0, stats: { shots: 0, hits: 0, damageDealt: 0 },
  };
}

let state: GameState;
let fx: Fx;

function buildWorld(): void {
  const gen = generateTerrain(BIOMES[biomeId], seed);
  terrain = gen.terrain;
  spawns = gen.spawns;
  terrain.markAllDirty();
  const t0 = makeTank(0, spawns[0]), t1 = makeTank(1, spawns[1]);
  state = {
    config: { players: [{ name: 'A', kind: 'human', difficulty: 'normal' }, { name: 'B', kind: 'cpu', difficulty: 'normal' }], biome: biomeId, roundsToWin: 2, crates: true, seed, attract: false },
    phase: 'flight', phaseTime: 0, paused: false, round: 1, turn: 1, activePlayer: 0, wins: [0, 0], biome: biomeId, seed,
    wind: 4, gravity: 520 * BIOMES[biomeId].gravityScale, terrain, tanks: [t0, t1], projectiles: [], hazards: [], crates: [],
    roundWinner: null, matchWinner: null, cpuThinking: false, nextId: 1,
  };
  settleTanks(0);
  fx = new Fx(hooks);
  fx.setQuality(quality, reducedMotion);
  fx.handleEvent({ type: 'roundStart', round: 1, biome: biomeId, seed }, state);
}

/** Mock tank physics: snap to ground (falls if airborne). */
function settleTanks(dt: number): void {
  for (const t of state.tanks) {
    const gy = terrain.surfaceY(t.x, Math.max(0, t.y - 40));
    if (t.airborne) {
      t.vy += state.gravity * dt;
      t.y += t.vy * dt;
      if (t.y >= gy) {
        const fall = gy - t.fallStartY;
        t.y = gy; t.airborne = false; t.vy = 0;
        emit({ type: 'tankLanded', player: t.index, x: t.x, y: t.y, fallDistance: fall, damage: 0, intro: true });
      }
    } else {
      t.y = gy;
      const l = terrain.surfaceY(t.x - 16, t.y - 40), r = terrain.surfaceY(t.x + 16, t.y - 40);
      t.tilt = Math.atan2(r - l, 32) * 0.8;
    }
    t.recoil = Math.max(0, t.recoil - dt * 3);
  }
}

export function emit(e: GameEvent): void {
  fx.handleEvent(e, state);
}

function uploadTerrain(): void {
  const rect = terrain.takeDirty();
  if (!rect) return;
  terrain.writeRGBA({ x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H }, terrainImg.data);
  tctx.putImageData(terrainImg, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
}

// --- Hazard helpers for scenes ----------------------------------------------------------
function addHazard(kind: HazardKind, weapon: WeaponId, x: number, y: number, life: number, radius: number): HazardState {
  const h: HazardState = { id: state.nextId++, kind, weapon, owner: 0, x, y, vx: 0, vy: 0, age: 0, life, radius, data: {} };
  state.hazards.push(h);
  return h;
}

const perf = { update: 0, draw: 0, frames: 0 };

// --- Timeline ----------------------------------------------------------------------------
interface Cue { at: number; fn: () => void }
let cues: Cue[] = [];
let simTime = 0;
let realTime = 0;
let frozen = false;
let sceneLength = 0;
/** Per-frame hazard updaters registered by scenes (they mutate mock hazard state). */
let hazardTickers: ((dt: number) => boolean)[] = [];

const api: SceneApi = {
  get state() { return state; },
  get terrain() { return terrain; },
  get spawns() { return spawns; },
  emit,
  addHazard,
  at: (t, fn) => cues.push({ at: t, fn }),
  tick: (fn) => hazardTickers.push(fn),
  blast(x, y, kind, weapon, radius, primary = true, carve = true) {
    if (carve && kind !== 'dirt') terrain.carveCircle(x, y, radius, 1);
    emit({ type: 'explosion', weapon, kind, x, y, radius, owner: 0, primary });
  },
  ground: (x) => terrain.surfaceY(x, 0),
  muzzle: (i) => muzzlePoint(state.tanks[i]),
  center: (i) => tankCenter(state.tanks[i]),
  pivot: (i) => turretPivot(state.tanks[i]),
};

function loadScene(): void {
  buildWorld();
  cues = [];
  hazardTickers = [];
  simTime = 0;
  trauma = 0; flashA = 0; hitStopLeft = 0; slowLeft = 0; focusLeft = 0; chromaA = 0;
  rings.length = 0;
  hookLog.length = 0;
  sceneLength = 0;
  const list = sceneName === 'all' ? Object.keys(SCENES) : [sceneName];
  let offset = 0;
  for (const name of list) {
    const scene = SCENES[name];
    if (!scene) continue;
    const local: Cue[] = [];
    const saved = api.at;
    api.at = (t, fn) => local.push({ at: offset + t, fn });
    scene.run(api);
    api.at = saved;
    cues.push(...local);
    offset += scene.length;
  }
  sceneLength = offset;
  cues.sort((a, b) => a.at - b.at);
}

const STEP = 1 / 60;

/** Advances the simulation by one fixed step (respecting hit-stop / slow-mo like TimeControl). */
function step(realDt: number): number {
  let dt = realDt;
  if (hitStopLeft > 0) { hitStopLeft -= realDt; dt = 0; }
  else if (slowLeft > 0) { slowLeft -= realDt; dt = realDt * slowScale; }
  simTime += dt;
  while (cues.length && cues[0].at <= simTime) cues.shift()!.fn();
  for (let i = 0; i < hazardTickers.length; i++) if (!hazardTickers[i](dt)) hazardTickers.splice(i--, 1);
  for (const h of state.hazards) h.age += dt;
  state.hazards = state.hazards.filter((h) => h.age < h.life);
  if (dt > 0) terrain.settle(dt);
  settleTanks(dt);
  const u0 = performance.now();
  fx.update(dt, state);
  perf.update += performance.now() - u0;
  trauma = Math.max(0, trauma - realDt * 1.6);
  flashA = Math.max(0, flashA - realDt * 2.5);
  chromaA = Math.max(0, chromaA - realDt * 2);
  focusLeft = Math.max(0, focusLeft - realDt);
  for (const r of rings) r.t += realDt;
  for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > 0.6) rings.splice(i, 1);
  return dt;
}

// --- Rendering ----------------------------------------------------------------------------
function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

const view: ViewInfo = { left: 0, top: 0, right: WORLD_W, bottom: WORLD_H, scale: 1, cw: 0, ch: 0, dpr: 1, time: 0, dt: 0, quality, reducedMotion };

function drawTank(t: TankState): void {
  const team = TEAMS[t.index];
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.tilt);
  if (!t.alive) ctx.filter = 'none';
  ctx.fillStyle = t.alive ? team.primary : '#2b2522';
  ctx.strokeStyle = '#10131c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-28, -18, 56, 14, 4);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a2f3a';
  ctx.beginPath();
  ctx.roundRect(-30, -7, 60, 9, 4);
  ctx.fill();
  if (t.alive) {
    ctx.fillStyle = team.light;
    ctx.beginPath();
    ctx.ellipse(0, -19, 12, 9, 0, Math.PI, 0);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    const p = turretPivot(t), m = muzzlePoint(t);
    ctx.strokeStyle = '#1a1e28';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.stroke();
  } else ctx.restore();
}

function render(): void {
  const cw = canvas.width, ch = canvas.height;
  let scale = Math.min(cw / WORLD_W, ch / WORLD_H) * zoomParam;
  let cx = camX, cy = camY;
  if (focusLeft > 0) {
    const f = Math.min(1, focusLeft / 0.4);
    scale *= 1 + (focusZoom - 1) * f;
    cx += (focusX - cx) * f; cy += (focusY - cy) * f;
  }
  const sh = trauma * trauma * 26 * scale;
  const ox = cw / 2 - cx * scale + (Math.sin(realTime * 61) * sh), oy = ch / 2 - cy * scale + (Math.cos(realTime * 53) * sh);
  view.left = -ox / scale; view.top = -oy / scale; view.right = (cw - ox) / scale; view.bottom = (ch - oy) / scale;
  view.scale = scale; view.cw = cw; view.ch = ch; view.time = realTime;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pal = BIOMES[biomeId].palette;
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, pal.sky[0]); sky.addColorStop(0.6, pal.sky[1]); sky.addColorStop(1, pal.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  uploadTerrain();
  ctx.drawImage(terrainCanvas, 0, 0);
  const d0 = performance.now();
  fx.drawBack(ctx, view, state);
  for (const t of state.tanks) drawTank(t);
  fx.drawFront(ctx, view, state);
  perf.draw += performance.now() - d0;
  perf.frames++;
  // Lights preview (the real renderer composites these; here: faint additive pools).
  ctx.globalCompositeOperation = 'lighter';
  for (const L of fx.lights()) {
    const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.radius);
    g.addColorStop(0, hexA(L.color, Math.min(0.35, L.intensity * 0.14)));
    g.addColorStop(1, hexA(L.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(L.x - L.radius, L.y - L.radius, L.radius * 2, L.radius * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // Shockwave preview rings.
  for (const r of rings) {
    ctx.strokeStyle = `rgba(255,255,255,${(0.25 * (1 - r.t / 0.6) * r.s).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, 30 + r.t * 600, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (flashA > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexA(flashC, flashA * 0.6);
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
  }
  const st = fx.debugStats();
  hud.textContent = `fx sandbox · ${sceneName} · t=${simTime.toFixed(2)}/${sceneLength.toFixed(1)}  particles ${st.particles}/${st.capacity}  effects ${st.effects}  lights ${fx.lights().length}  dropped ${st.dropped}  ${quality}${reducedMotion ? ' rm' : ''}  fps ${fps.toFixed(0)}`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1).toFixed(3)})`;
}

let last = performance.now();
let fps = 60;
function frame(now: number): void {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(realDt, 1e-3) - fps) * 0.05;
  if (!frozen) {
    realTime += realDt;
    step(realDt);
    if (stress) stressTick();
    if (simTime > sceneLength + 1.5 && !stress) loadScene();
  }
  render();
  requestAnimationFrame(frame);
}

// Stress: keep ~3000 particles alive with continuous explosions across the map.
let stressAcc = 0;
function stressTick(): void {
  stressAcc += 1 / 60;
  if (fx.particleCount() < 2900 && stressAcc > 0.08) {
    stressAcc = 0;
    const x = 200 + Math.random() * (WORLD_W - 400);
    const kinds = ['standard', 'heavy', 'fire', 'electric', 'firework'] as const;
    const kind = kinds[(Math.random() * kinds.length) | 0];
    const weapon: WeaponId = kind === 'heavy' ? 'thunderhead' : kind === 'fire' ? 'magma' : kind === 'electric' ? 'tesla' : kind === 'firework' ? 'fireworks' : 'ember';
    api.blast(x, terrain.surfaceY(x, 0), kind, weapon, 40, true, false);
  }
}

loadScene();
requestAnimationFrame(frame);

(window as unknown as { __fx: unknown }).__fx = {
  /** Replays the timeline from 0 to t with fixed steps, then freezes. */
  seek(t: number) {
    loadScene();
    frozen = true;
    while (simTime < t) { realTime += STEP; step(STEP); }
    render();
    return { simTime, particles: fx.particleCount(), lights: fx.lights().length, hooks: hookLog.slice(-6) };
  },
  play() { frozen = false; },
  look(x: number, y: number) { camX = x; camY = y; render(); },
  stats: () => fx.debugStats(),
  perf: () => { const r = { updateMs: perf.update / Math.max(1, perf.frames), drawMs: perf.draw / Math.max(1, perf.frames), frames: perf.frames }; perf.update = perf.draw = perf.frames = 0; return r; },
  get fx() { return fx; },
  scenes: () => Object.keys(SCENES),
};
void DEG;
