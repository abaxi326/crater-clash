// Sandbox: the render core with a real generated terrain, a hand-built GameState and stub modules
// (add ?real=1 to use the real background/tanks/entities/fx/postfx modules).
// URL: ?biome=verdant&seed=7&scene=idle|crater|high|killcam|cpu&nopost=1&full=1&attract=1
import { BIOMES, type BiomeId } from '../src/core/biomes.ts';
import { GRAVITY, WIND_ACCEL, WORLD_W } from '../src/core/constants.ts';
import { EventBus, type GameEvent } from '../src/core/events.ts';
import { muzzlePoint, muzzleVelocity } from '../src/core/geometry.ts';
import type { Vec2 } from '../src/core/math.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';
import { TimeControl } from '../src/core/time.ts';
import type { GameState, PlayerIndex, ProjectileState, TankState } from '../src/core/types.ts';
import { WEAPONS, startingAmmo, type WeaponId } from '../src/core/weapons.ts';
import type { GameApi, RenderFrame } from '../src/contracts.ts';
import { RendererCore, type RenderModules } from '../src/render/core/rendererCore.ts';
import { generateTerrain } from '../src/sim/terrainGen.ts';
import { StubBackground, StubEntities, StubFx, StubTanks } from './render/stubs.ts';

const q = new URLSearchParams(location.search);
const biome = (q.get('biome') ?? 'verdant') as BiomeId;
const seed = Number(q.get('seed') ?? 7);
const scene = q.get('scene') ?? 'idle';

function makeTank(index: PlayerIndex, x: number, y: number, angle: number): TankState {
  return {
    index, x, y, vy: 0, airborne: false, fallStartY: y, tilt: 0, angle, power: 62, hp: 100, maxHp: 100, shield: 0,
    fuel: 240, alive: true, weapon: 'ember', ammo: startingAmmo(), moveDir: 0, treadPhase: 0, recoil: 0, hitFlash: 0,
    stats: { shots: 0, hits: 0, damageDealt: 0 },
  };
}

function makeState(b: BiomeId, s: number): GameState {
  const def = BIOMES[b];
  const { terrain, spawns } = generateTerrain(def, s);
  const tanks: [TankState, TankState] = [
    makeTank(0, spawns[0], terrain.surfaceY(spawns[0]), 52),
    makeTank(1, spawns[1], terrain.surfaceY(spawns[1]), 128),
  ];
  return {
    config: {
      players: [{ name: 'You', kind: 'human', difficulty: 'normal' }, { name: 'Vortex', kind: 'cpu', difficulty: 'normal' }],
      biome: b, roundsToWin: 2, crates: true, seed: s, attract: q.has('attract'),
    },
    phase: 'aiming', phaseTime: 0.8, paused: false, round: 1, turn: 1, activePlayer: 0, wins: [0, 0], biome: b, seed: s,
    wind: def.windScale * 4.5, gravity: GRAVITY * def.gravityScale, terrain, tanks,
    projectiles: [], hazards: [], crates: [], roundWinner: null, matchWinner: null, cpuThinking: false, nextId: 1,
  };
}

let state = makeState(biome, seed);
const bus = new EventBus();

/** Ballistic path from the active tank (what the real Game.aimGuide returns). */
function trace(tank: TankState, maxLength: number, weapon: WeaponId): Vec2[] {
  const w = WEAPONS[weapon];
  const m = muzzlePoint(tank);
  const v = muzzleVelocity(tank.angle, tank.power);
  const ax = state.wind * WIND_ACCEL * w.windScale, ay = state.gravity * w.gravityScale;
  const out: Vec2[] = [{ x: m.x, y: m.y }];
  let x = m.x, y = m.y, vx = v.x, vy = v.y, len = 0, acc = 0;
  const dt = 1 / 240;
  for (let i = 0; i < 240 * 14 && len < maxLength; i++) {
    const nx = x + vx * dt + 0.5 * ax * dt * dt, ny = y + vy * dt + 0.5 * ay * dt * dt;
    vx += ax * dt; vy += ay * dt;
    const d = Math.hypot(nx - x, ny - y);
    len += d; acc += d;
    x = nx; y = ny;
    if (state.terrain.isSolid(x, y) || x < -200 || x > WORLD_W + 200) { out.push({ x, y }); break; }
    if (acc >= 8) { out.push({ x, y }); acc = 0; }
  }
  return out;
}

const ghost: Vec2[][] = [[], []];
const game = {
  get state() { return state; },
  events: bus,
  aimGuide: (len: number) => trace(state.tanks[state.activePlayer], len, state.tanks[state.activePlayer].weapon),
  lastShotPath: (p: PlayerIndex) => ghost[p],
} as unknown as GameApi;

const time = new TimeControl();
const stub = !q.has('real');
const real = stub ? null : await import('../src/render/renderer.ts');
const modules: RenderModules = stub
  ? {
      background: () => new StubBackground(),
      tanks: () => new StubTanks(),
      entities: () => new StubEntities(),
      fx: hooks => new StubFx(hooks),
      postfx: () => null,
    }
  : real!.DEFAULT_RENDER_MODULES;
const stage = document.getElementById('stage')!;
const renderer = new RendererCore(stage, time, modules);
const settings: Settings = { ...DEFAULT_SETTINGS, quality: 'high', postFx: !q.has('nopost'), aimGuide: q.has('full') ? 'full' : 'short' };
renderer.applySettings(settings);
renderer.onRoundStart(state);
bus.on(e => renderer.handleEvent(e, state));
const emit = (e: GameEvent): void => bus.emit(e);

function explode(x: number, y: number, r: number, weapon: WeaponId = 'ember'): void {
  state.terrain.carveCircle(x, y, r, 1);
  emit({ type: 'explosion', weapon, kind: WEAPONS[weapon].explosion, x, y, radius: r, owner: 0, primary: true });
}

function fire(angle?: number, power?: number): void {
  const t = state.tanks[state.activePlayer];
  if (angle !== undefined) t.angle = angle;
  if (power !== undefined) t.power = power;
  const m = muzzlePoint(t), v = muzzleVelocity(t.angle, t.power);
  const p: ProjectileState = {
    id: state.nextId++, weapon: t.weapon, owner: t.index, x: m.x, y: m.y, vx: v.x, vy: v.y, age: 0, mode: 'ballistic',
    bounces: 0, fragment: false, rotation: 0, data: {},
  };
  state.projectiles.push(p);
  ghost[t.index] = trace(t, 4000, t.weapon).filter((_, i) => i % 2 === 0);
  emit({ type: 'fire', player: t.index, weapon: t.weapon, x: m.x, y: m.y, angle: t.angle, power: t.power });
  state.phase = 'flight';
}

function stepSim(dt: number): void {
  state.phaseTime += dt;
  for (const p of state.projectiles) {
    const w = WEAPONS[p.weapon];
    const ax = state.wind * WIND_ACCEL * w.windScale, ay = state.gravity * w.gravityScale;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      p.x += p.vx * h + 0.5 * ax * h * h; p.y += p.vy * h + 0.5 * ay * h * h;
      p.vx += ax * h; p.vy += ay * h;
      p.age += h;
      if (state.terrain.isSolid(p.x, p.y)) { p.data.dead = 1; explode(p.x, p.y, w.radius, p.weapon); break; }
      if (p.y > 1300 || p.x < -300 || p.x > WORLD_W + 300) { p.data.dead = 1; break; }
    }
  }
  if (state.projectiles.some(p => p.data.dead)) {
    state.projectiles = state.projectiles.filter(p => !p.data.dead);
    if (!state.projectiles.length) { state.phase = 'aiming'; state.phaseTime = 0; }
  }
  if (state.terrain.settling) state.terrain.settle(dt);
}

// --- Loop ---------------------------------------------------------------------------------
let simPaused = false;
const frame: RenderFrame = { time: 0, realDt: 0, dt: 0, settings, showAimGuide: true, attract: state.config.attract };
let last = performance.now();
const t0 = last;
const info = document.getElementById('info')!;
let infoClock = 0;
function tick(now: number): void {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dt = time.step(realDt);
  if (!simPaused) stepSim(dt);
  frame.time = (now - t0) / 1000;
  frame.realDt = realDt;
  frame.dt = dt;
  frame.showAimGuide = state.phase === 'aiming' && state.config.players[state.activePlayer].kind === 'human';
  renderer.render(state, game, frame);
  infoClock += realDt;
  if (infoClock > 0.5) {
    infoClock = 0;
    const s = renderer.stats();
    info.textContent = `${BIOMES[state.biome].name} · ${s.fps} fps · ${s.frameMs} ms render · q=${renderer.quality} · post=${s.postFx}`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- Scenarios ------------------------------------------------------------------------------
function setBiome(b: BiomeId, s = seed): void {
  state = makeState(b, s);
  frame.attract = state.config.attract;
  renderer.onRoundStart(state);
}

function surfaceAt(x: number): number {
  return state.terrain.surfaceY(x);
}

function runScene(name: string): void {
  const [a, b] = state.tanks;
  switch (name) {
    case 'crater': {
      const x1 = WORLD_W * 0.42, x2 = WORLD_W * 0.6;
      explode(x1, surfaceAt(x1) + 8, 46);
      explode(x2, surfaceAt(x2) + 20, 70, 'thunder' in WEAPONS ? ('thunder' as WeaponId) : 'ember');
      break;
    }
    case 'high': {
      fire(80, 100);
      // Fast-forward the shell close to its apex.
      for (let i = 0; i < 90; i++) stepSim(1 / 60);
      break;
    }
    case 'killcam':
      explode(b.x, b.y - 6, 40);
      b.alive = false;
      emit({ type: 'tankDestroyed', target: 1, x: b.x, y: b.y - 12, by: 0 });
      renderer.hooks.slowMo(0.3, 1.4);
      break;
    case 'cpu':
      state.activePlayer = 1;
      state.cpuThinking = true;
      state.phaseTime = 1.2;
      ghost[1] = trace(b, 3000, 'ember').filter((_, i) => i % 2 === 0);
      break;
    case 'battle': {
      // Some prior damage so the terrain shows lit crater walls, tunnels and fallen dirt.
      for (const f of [0.3, 0.5, 0.66]) explode(WORLD_W * f, surfaceAt(WORLD_W * f) + 30, 52);
      state.terrain.carveCapsule(WORLD_W * 0.55, surfaceAt(WORLD_W * 0.55) + 70, WORLD_W * 0.72, surfaceAt(WORLD_W * 0.72) + 60, 14);
      ghost[0] = trace(a, 3000, 'ember').filter((_, i) => i % 2 === 0);
      break;
    }
    default:
      ghost[0] = trace({ ...a, angle: 58, power: 70 }, 3000, 'ember').filter((_, i) => i % 2 === 0);
      break;
  }
}
runScene(scene);

Object.assign(window, {
  __r: {
    renderer, get state() { return state; }, explode, fire, setBiome, runScene, emit, time,
    pause: (p: boolean) => { simPaused = p; },
    settings: (patch: Partial<Settings>) => { Object.assign(settings, patch); renderer.applySettings(settings); },
  },
});
