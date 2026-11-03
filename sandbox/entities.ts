// Sandbox: every projectile style flying along simulated arcs (with splits, bounces, drilling, homing,
// planted beacons) over a dark and a light half, plus supply crates descending, landing and collected.
// URL params: ?freeze=T (simulate T seconds at 60 Hz then hold), ?view=x,y,w (world-rect close-up),
// ?only=w1,w2 (weapons to show), ?quality=low|medium|high, ?bg=dark|light|split.
import { EntityRenderer } from '../src/render/entities.ts';
import type { ViewInfo } from '../src/contracts.ts';
import type { GameEvent } from '../src/core/events.ts';
import type { CrateState, GameState, ProjectileState } from '../src/core/types.ts';
import { WEAPONS, type WeaponId } from '../src/core/weapons.ts';
import { packRGBA } from '../src/core/color.ts';

const W = 1920, H = 1080, G = 520;
const qs = new URLSearchParams(location.search);
const freeze = qs.has('freeze') ? Number(qs.get('freeze')) : -1;
const viewArg = qs.get('view')?.split(',').map(Number);
const only = qs.get('only')?.split(',') as WeaponId[] | undefined;
const quality = (qs.get('quality') ?? 'high') as ViewInfo['quality'];
const bgMode = qs.get('bg') ?? 'split';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;

// Two rows of lanes, each with its own rolling ground line.
const ROW_GROUND = [520, 1010];
const groundY = (x: number, row: number): number => ROW_GROUND[row] + 22 * Math.sin(x / 140 + row * 2) + 12 * Math.sin(x / 53);
const rowOf = (y: number): number => (y < ROW_GROUND[0] + 120 ? 0 : 1);

const fakeTerrain = {
  surfaceY: (x: number, fromY = 0) => Math.floor(groundY(x, rowOf(fromY))),
  colorAt: (_x: number, y: number) => (y > 0 ? packRGBA(126, 92, 60) : 0),
};

const LANES: WeaponId[] = (only ?? [
  'ember', 'thunderhead', 'trident', 'starfall', 'fireworks', 'skipper', 'ricochet', 'burrower',
  'seeker', 'magma', 'tesla', 'singularity', 'sunbeam', 'faultline', 'earthmaker', 'blink',
]).filter(id => !WEAPONS[id].instant);

const PERIOD = 3.6;
let nextId = 1;
let simTime = 0;

interface Lane { weapon: WeaponId; row: number; x0: number; phase: number; last: number }
const perRow = Math.ceil(LANES.length / 2);
const lanes: Lane[] = LANES.map((weapon, i) => ({
  weapon,
  row: LANES.length <= 3 ? 0 : Math.floor(i / perRow),
  x0: 60 + (i % perRow) * ((W - 420) / Math.max(1, perRow - 1)),
  phase: qs.has('sync') ? i * 0.04 : (i * 0.41) % PERIOD,
  last: -99,
}));

const state = {
  phase: 'flight', wind: 3.5, gravity: G, terrain: fakeTerrain, projectiles: [] as ProjectileState[], crates: [] as CrateState[],
  hazards: [], tanks: [], biome: 'verdant',
} as unknown as GameState;

const ents = new EntityRenderer();
const emit = (e: GameEvent): void => ents.handleEvent(e, state);

function spawn(lane: Lane): void {
  const ang = (lane.weapon === 'skipper' ? 38 : lane.weapon === 'burrower' ? 52 : 60) * Math.PI / 180;
  const sp = lane.weapon === 'skipper' ? 430 : 480;
  const x = lane.x0, y = groundY(x, lane.row) - 30;
  state.projectiles.push({
    id: nextId++, weapon: lane.weapon, owner: 0, x, y, vx: Math.cos(ang) * sp, vy: -Math.sin(ang) * sp,
    age: 0, mode: 'ballistic', bounces: 0, fragment: false, rotation: 0, data: { row: lane.row, x0: x },
  });
}

function frag(p: ProjectileState, vx: number, vy: number, data: Record<string, number> = {}): ProjectileState {
  return { id: nextId++, weapon: p.weapon, owner: 0, x: p.x, y: p.y, vx, vy, age: 0, mode: 'ballistic', bounces: 0, fragment: true, rotation: 0, data: { ...data, row: p.data.row } };
}

/** One 1/240 s physics substep of the mock simulation. */
function stepProjectiles(dt: number): void {
  const out: ProjectileState[] = [];
  const add: ProjectileState[] = [];
  for (const p of state.projectiles) {
    const w = WEAPONS[p.weapon];
    const row = p.data.row;
    p.age += dt;
    let keep = true;
    if (p.mode === 'planted') {
      p.data.planted += dt;
      if (p.data.planted > 1.6) keep = false;
      if (keep) out.push(p);
      continue;
    }
    if (p.mode === 'drill') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.data.drilled += Math.hypot(p.vx, p.vy) * dt;
      if (p.data.drilled > 170) { emit({ type: 'drill', phase: 'end', x: p.x, y: p.y }); keep = false; }
      if (keep) out.push(p);
      continue;
    }
    if (p.mode === 'homing') {
      const tx = p.data.x0 + 520, ty = groundY(p.data.x0 + 520, row) - 12;
      const want = Math.atan2(ty - p.y, tx - p.x);
      let cur = Math.atan2(p.vy, p.vx);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      cur += Math.max(-2.6 * dt, Math.min(2.6 * dt, d));
      const sp = Math.hypot(p.vx, p.vy);
      p.vx = Math.cos(cur) * sp; p.vy = Math.sin(cur) * sp;
    } else {
      p.vy += G * w.gravityScale * dt;
      p.vx += state.wind * 7.5 * w.windScale * dt * 0.3;
    }
    const prevVy = p.vy - G * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (w.projectile.spin || p.weapon === 'skipper') p.rotation += dt * 14;
    // Apex behaviours.
    if (!p.fragment && prevVy < 0 && p.vy >= 0) {
      if (p.weapon === 'trident') {
        emit({ type: 'split', weapon: p.weapon, x: p.x, y: p.y, count: 3 });
        for (let i = 0; i < 3; i++) add.push(frag(p, p.vx + (i - 1) * 75, p.vy));
        keep = false;
      } else if (p.weapon === 'starfall') {
        emit({ type: 'split', weapon: p.weapon, x: p.x, y: p.y, count: 9 });
        for (let i = 0; i < 9; i++) add.push(frag(p, p.vx + (i - 4) * 46, -60 * (0.6 + 0.4 * ((i * 7) % 5) / 4)));
        keep = false;
      } else if (p.weapon === 'seeker') {
        p.mode = 'homing';
      }
    }
    if (p.weapon === 'fireworks' && !p.fragment && p.age > 1.2) {
      emit({ type: 'split', weapon: p.weapon, x: p.x, y: p.y, count: 7 });
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        add.push(frag(p, Math.cos(a) * 300 * 0.6 + p.vx * 0.3, Math.sin(a) * 300 * 0.6, { hue: (i * 51) % 360 }));
      }
      keep = false;
    }
    if (p.weapon === 'fireworks' && p.fragment && p.age > 0.9) keep = false;
    // Ground contact.
    const gy = groundY(p.x, row);
    if (keep && p.y >= gy) {
      if (p.weapon === 'skipper' && p.bounces < 3) {
        p.y = gy - 0.5; p.vy = -Math.abs(p.vy) * 0.62; p.vx *= 0.82; p.bounces++;
        emit({ type: 'bounce', weapon: p.weapon, x: p.x, y: gy, speed: Math.hypot(p.vx, p.vy) });
      } else if (p.weapon === 'ricochet' && p.bounces < 4) {
        p.y = gy - 0.5; p.vy = -Math.abs(p.vy) * 0.8; p.vx = (p.bounces % 2 ? 1 : -1) * Math.abs(p.vx) * 0.8; p.bounces++;
        emit({ type: 'bounce', weapon: p.weapon, x: p.x, y: gy, speed: Math.hypot(p.vx, p.vy) });
      } else if (p.weapon === 'burrower') {
        p.mode = 'drill'; p.data.drilled = 0;
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = p.vx / sp * 260; p.vy = p.vy / sp * 260;
        emit({ type: 'drill', phase: 'start', x: p.x, y: gy });
      } else if (w.projectile.style === 'beacon') {
        p.y = gy; p.vx = 0; p.vy = 0; p.mode = 'planted'; p.data.planted = 0;
        emit({ type: 'beam', phase: 'mark', x: p.x, y: gy, halfWidth: 26 });
      } else {
        keep = false;
      }
    }
    if (p.x < -200 || p.x > W + 200) keep = false;
    if (keep) out.push(p);
  }
  state.projectiles = out.concat(add);
}

// --- Crates ---------------------------------------------------------------------------------
interface CrateSlot { x: number; row: number; phase: number; weapon: WeaponId; c: CrateState | null; t: number; landedAt: number }
const CRATE_CYCLE = 8.5;
const crateSlots: CrateSlot[] = [
  { x: 1180, row: 0, phase: 0, weapon: 'tesla', c: null, t: 0, landedAt: -1 },
  { x: 560, row: 1, phase: 2.2, weapon: 'starfall', c: null, t: 0, landedAt: -1 },
  { x: 1500, row: 1, phase: 4.6, weapon: 'singularity', c: null, t: 0, landedAt: -1 },
  { x: 300, row: 0, phase: 6.1, weapon: 'thunderhead', c: null, t: 0, landedAt: -1 },
];

function stepCrates(dt: number): void {
  for (const s of crateSlots) {
    const local = (simTime + s.phase) % CRATE_CYCLE;
    if (!s.c && local < 0.1) {
      const gy = groundY(s.x, s.row);
      s.c = { id: nextId++, x: s.x, y: gy - 330, vy: 110, weapon: s.weapon, amount: 1, landed: false, parachute: 1, sway: 0, age: 0 };
      state.crates.push(s.c);
      emit({ type: 'crate', phase: 'spawn', id: s.c.id, x: s.c.x, y: s.c.y, weapon: s.weapon, amount: 1, by: null });
      s.landedAt = -1;
    }
    const c = s.c;
    if (!c) continue;
    c.age += dt;
    if (!c.landed) {
      c.y += c.vy * dt;
      c.sway = Math.sin(c.age * 1.7) * 0.16;
      const gy = groundY(c.x, s.row);
      if (c.y >= gy) {
        c.y = gy; c.landed = true; c.sway = 0; s.landedAt = c.age;
        emit({ type: 'crate', phase: 'land', id: c.id, x: c.x, y: c.y, weapon: c.weapon, amount: 1, by: null });
      }
    } else {
      c.parachute = Math.max(0, c.parachute - dt / 1.1);
      if (c.age - s.landedAt > 3.6) {
        emit({ type: 'crate', phase: 'collect', id: c.id, x: c.x, y: c.y, weapon: c.weapon, amount: 1, by: 0 });
        state.crates.splice(state.crates.indexOf(c), 1);
        s.c = null;
      }
    }
  }
}

// --- Loop -----------------------------------------------------------------------------------
function stepSim(dt: number): void {
  simTime += dt;
  for (const lane of lanes) {
    const k = Math.floor((simTime - lane.phase) / PERIOD);
    if (k > lane.last && simTime >= lane.phase) { lane.last = k; spawn(lane); }
  }
  const sub = 4;
  for (let i = 0; i < sub; i++) stepProjectiles(dt / sub);
  stepCrates(dt);
  ents.update(dt, state);
}

function drawBackground(view: ViewInfo): void {
  const split = bgMode === 'split' ? W / 2 : bgMode === 'dark' ? W + 999 : -999;
  const dark = ctx.createLinearGradient(0, 0, 0, H);
  dark.addColorStop(0, '#060814'); dark.addColorStop(0.6, '#1a1838'); dark.addColorStop(1, '#3a2240');
  const light = ctx.createLinearGradient(0, 0, 0, H);
  light.addColorStop(0, '#5fb4ff'); light.addColorStop(0.6, '#bfe6ff'); light.addColorStop(1, '#fff2d6');
  ctx.fillStyle = dark;
  ctx.fillRect(view.left, view.top, Math.max(0, split - view.left), view.bottom - view.top);
  ctx.fillStyle = light;
  ctx.fillRect(Math.max(view.left, split), view.top, view.right - Math.max(view.left, split), view.bottom - view.top);
  for (let row = 0; row < 2; row++) {
    ctx.beginPath();
    ctx.moveTo(view.left, ROW_GROUND[row] + 140);
    for (let x = Math.floor(view.left); x <= view.right + 8; x += 8) ctx.lineTo(x, groundY(x, row));
    ctx.lineTo(view.right, ROW_GROUND[row] + 140);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, ROW_GROUND[row] - 30, 0, ROW_GROUND[row] + 140);
    g.addColorStop(0, '#8a6a46'); g.addColorStop(0.15, '#6d4f33'); g.addColorStop(1, '#2e2018');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = row === 0 ? '#7bc96f' : '#9ad07a';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

const view: ViewInfo = { left: 0, top: 0, right: W, bottom: H, scale: 1, cw: 0, ch: 0, dpr: 1, time: 0, dt: 0, quality, reducedMotion: false };

function render(time: number, dt: number): void {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  let scale: number, left: number, top: number;
  if (viewArg && viewArg.length >= 3) {
    scale = cw / viewArg[2]; left = viewArg[0]; top = viewArg[1];
  } else {
    scale = Math.min(cw / W, ch / H); left = (W - cw / scale) / 2; top = (H - ch / scale) / 2;
  }
  Object.assign(view, { left, top, right: left + cw / scale, bottom: top + ch / scale, scale, cw, ch, dpr, time, dt });
  ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
  drawBackground(view);
  ents.drawCrates(ctx, state, view);
  ents.drawProjectiles(ctx, state, view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

let frames = 0, acc = 0, fps = 0, last = performance.now();
function loop(now: number): void {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frames++; acc += realDt;
  if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
  if (freeze < 0) {
    stepSim(realDt);
    render(simTime, realDt);
    hud.textContent = `entities sandbox · ${fps.toFixed(0)} fps · projectiles ${state.projectiles.length}`;
  }
  requestAnimationFrame(loop);
}

if (freeze >= 0) {
  const dt = 1 / 60;
  while (simTime < freeze) stepSim(dt);
  render(simTime, dt);
  hud.textContent = `freeze t=${freeze}`;
}
requestAnimationFrame(loop);
(window as unknown as { __ents: unknown }).__ents = { ents, state, stepSim, render: () => render(simTime, 1 / 60) };
