/**
 * Audio sandbox: buttons for every sound/event over a mock GameState, mixer controls, a peak meter
 * and diagnostics. window.__audio exposes the engine; window.__runAll() drives every API path
 * (used by the headless harness, which cannot listen but can catch errors and check voice bounds).
 */
import { AudioEngine } from '../src/audio/audio.ts';
import type { UiSound, MusicMode } from '../src/contracts.ts';
import { BIOME_IDS, type BiomeId } from '../src/core/biomes.ts';
import type { GameEvent } from '../src/core/events.ts';
import type { GameState, HazardState, ProjectileState, TankState } from '../src/core/types.ts';
import { WEAPONS, WEAPON_ORDER, startingAmmo, type ExplosionKind, type WeaponId } from '../src/core/weapons.ts';

const audio = new AudioEngine();

// ---------------------------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------------------------

function tank(index: 0 | 1, x: number): TankState {
  return {
    index, x, y: 760, vy: 0, airborne: false, fallStartY: 760, tilt: 0, angle: index ? 135 : 45, power: 60,
    hp: 100, maxHp: 100, shield: 0, fuel: 240, alive: true, weapon: 'ember', ammo: startingAmmo(),
    moveDir: 0, treadPhase: 0, recoil: 0, hitFlash: 0, stats: { shots: 0, hits: 0, damageDealt: 0 },
  };
}

const state: GameState = {
  config: {
    players: [{ name: 'You', kind: 'human', difficulty: 'normal' }, { name: 'CPU', kind: 'cpu', difficulty: 'normal' }],
    biome: 'verdant', roundsToWin: 2, crates: true, seed: 1, attract: false,
  },
  phase: 'aiming', phaseTime: 0, paused: false, round: 1, turn: 1, activePlayer: 0, wins: [0, 0],
  biome: 'verdant', seed: 1, wind: 0, gravity: 520,
  terrain: null as unknown as GameState['terrain'],
  tanks: [tank(0, 380), tank(1, 1540)],
  projectiles: [], hazards: [], crates: [],
  roundWinner: null, matchWinner: null, cpuThinking: false, nextId: 1,
};

let timeScale = 1;
const emit = (e: GameEvent): void => audio.handleEvent(e, state);

function addProjectile(weapon: WeaponId, x: number, y: number, vx: number, vy: number, mode = 'ballistic'): ProjectileState {
  const p: ProjectileState = {
    id: state.nextId++, weapon, owner: 0, x, y, vx, vy, age: 0, mode, bounces: 0, fragment: false, rotation: 0, data: {},
  };
  state.projectiles.push(p);
  return p;
}

function addHazard(kind: HazardState['kind'], weapon: WeaponId, x: number, y: number, life: number): HazardState {
  const h: HazardState = { id: state.nextId++, kind, weapon, owner: 0, x, y, vx: 0, vy: 0, age: 0, life, radius: 20, data: {} };
  state.hazards.push(h);
  return h;
}

/** Timed script helper. */
const later = (ms: number, fn: () => void): void => { setTimeout(fn, ms); };
const rx = (): number => 300 + Math.random() * 1320;

// ---------------------------------------------------------------------------------------------
// Scenario actions
// ---------------------------------------------------------------------------------------------

function fire(weapon: WeaponId, x = 380, power = 70): void {
  emit({ type: 'fire', player: 0, weapon, x, y: 740, angle: 50, power });
}

function explode(kind: ExplosionKind, radius: number, x = rx(), primary = true, weapon: WeaponId = 'ember'): void {
  emit({ type: 'explosion', weapon, kind, x, y: 760, radius, owner: 0, primary });
}

/** A full shot: fire → arc (whistle on the way down) → impact + damage + dirt collapse. */
function fullShot(weapon: WeaponId = 'ember'): void {
  const def = WEAPONS[weapon];
  fire(weapon);
  const p = addProjectile(weapon, 400, 720, 520, -620);
  const done = (): void => {
    state.projectiles.splice(state.projectiles.indexOf(p), 1);
    explode(def.explosion, def.radius, p.x, true, weapon);
    emit({ type: 'damage', target: 1, amount: 24, absorbed: 0, x: p.x, y: 760, weapon, direct: false, hpAfter: 76, by: 0 });
    for (let i = 0; i < 6; i++) later(150 + i * 125, () => emit({ type: 'dirtFall', x0: p.x - 40, x1: p.x + 40, amount: 300 - i * 40 }));
  };
  (p.data as Record<string, number>).landY = 760;
  landers.set(p, done);
}

/** Projectiles in flight are integrated in the frame loop; they "land" at data.landY. */
const landers = new Map<ProjectileState, () => void>();

function stepProjectiles(dt: number): void {
  for (const p of state.projectiles) {
    p.age += dt;
    if (p.mode === 'drill') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      continue;
    }
    p.vy += state.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const cb = landers.get(p);
    if (cb && p.vy > 0 && p.y >= (p.data.landY ?? 760)) {
      landers.delete(p);
      cb();
    }
  }
}

function drillShot(): void {
  fire('burrower');
  later(700, () => {
    emit({ type: 'drill', phase: 'start', x: 900, y: 760 });
    const p = addProjectile('burrower', 900, 760, 160, 200, 'drill');
    later(800, () => {
      emit({ type: 'drill', phase: 'end', x: p.x, y: p.y });
      state.projectiles.splice(state.projectiles.indexOf(p), 1);
      explode('heavy', 56, p.x, true, 'burrower');
    });
  });
}

function sunbeam(): void {
  fire('sunbeam');
  later(600, () => {
    emit({ type: 'beam', phase: 'mark', x: 1200, y: 760, halfWidth: 26 });
    const h = addHazard('beam', 'sunbeam', 1200, 760, 1.65);
    later(900, () => {
      emit({ type: 'beam', phase: 'fire', x: 1200, y: 760, halfWidth: 26 });
      explode('beam', 26, 1200, true, 'sunbeam');
    });
    later(1650, () => {
      emit({ type: 'beam', phase: 'end', x: 1200, y: 760, halfWidth: 26 });
      state.hazards.splice(state.hazards.indexOf(h), 1);
    });
  });
}

function singularity(): void {
  fire('singularity');
  later(600, () => {
    emit({ type: 'singularity', phase: 'open', x: 1100, y: 740, radius: 10 });
    const h = addHazard('singularity', 'singularity', 1100, 740, 1.6);
    later(1600, () => {
      emit({ type: 'singularity', phase: 'collapse', x: 1100, y: 740, radius: 76 });
      explode('void', 50, 1100, true, 'singularity');
      state.hazards.splice(state.hazards.indexOf(h), 1);
    });
  });
}

function tesla(): void {
  explode('electric', 26, 1300, true, 'tesla');
  addHazard('tesla', 'tesla', 1300, 760, 1.2);
  for (let i = 0; i < 3; i++) {
    later(380 * (i + 1), () => {
      emit({ type: 'lightning', x1: 1300, y1: 760, x2: 1540, y2: 748, target: 1 });
      emit({ type: 'damage', target: 1, amount: 9, absorbed: 0, x: 1540, y: 748, weapon: 'tesla', direct: false, hpAfter: 60, by: 0 });
      emit({ type: 'lightning', x1: 1300, y1: 760, x2: 1250, y2: 780, target: null });
      emit({ type: 'lightning', x1: 1300, y1: 760, x2: 1360, y2: 790, target: null });
    });
  }
  later(1300, () => { state.hazards = state.hazards.filter(h => h.kind !== 'tesla'); });
}

function magma(): void {
  explode('fire', 30, 1000, true, 'magma');
  for (let i = 0; i < 16; i++) {
    emit({ type: 'lava', phase: 'spawn', x: 1000 + (Math.random() - 0.5) * 120, y: 760 });
    addHazard('lava', 'magma', 1000 + (Math.random() - 0.5) * 120, 760, 4.5);
  }
  later(4500, () => {
    for (const h of state.hazards.filter(h => h.kind === 'lava')) emit({ type: 'lava', phase: 'cool', x: h.x, y: h.y });
    state.hazards = state.hazards.filter(h => h.kind !== 'lava');
  });
}

function faultline(): void {
  explode('standard', 30, 960, true, 'faultline');
  for (let s = 1; s <= 4; s++) {
    later(s * 143, () => {
      for (const dir of [-1, 1]) {
        emit({ type: 'quake', x: 960 + dir * 60 * s, y: 760, step: s });
        explode('small', 26, 960 + dir * 60 * s, false, 'faultline');
      }
    });
  }
}

function starfall(): void {
  fire('starfall');
  later(900, () => emit({ type: 'split', weapon: 'starfall', x: 900, y: 300, count: 9 }));
  for (let i = 0; i < 9; i++) later(1900 + i * 70 + Math.random() * 60, () => explode('small', 24, 700 + i * 50, false, 'starfall'));
}

function fireworks(): void {
  fire('fireworks');
  later(1200, () => {
    explode('firework', 28, 1100, true, 'fireworks');
    for (let i = 0; i < 7; i++) later(500 + Math.random() * 120, () => explode('small', 18, 950 + i * 50, false, 'fireworks'));
  });
}

let driving = false;
function toggleDrive(): boolean {
  driving = !driving;
  state.tanks[0].moveDir = driving ? 1 : 0;
  emit({ type: 'drive', player: 0, moving: driving });
  return driving;
}

let aimT = -1;
function cpuAim(): void {
  state.activePlayer = 1;
  state.cpuThinking = true;
  aimT = 0;
}

function twoShells(): void {
  for (let i = 0; i < 2; i++) {
    const p = addProjectile('trident', 600 + i * 200, 300, 120, 0);
    (p.data as Record<string, number>).landY = 760;
    landers.set(p, () => {
      state.projectiles.splice(state.projectiles.indexOf(p), 1);
      explode('standard', 34, p.x, true, 'trident');
    });
  }
}

const stack = (): void => { for (let i = 0; i < 12; i++) explode('heavy', 78, rx(), true, 'thunderhead'); };

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------

const left = document.getElementById('left') as HTMLElement;

function section(title: string): HTMLElement {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${title}</h2><div class="row"></div>`;
  left.appendChild(s);
  return s.querySelector('.row') as HTMLElement;
}

function button(row: HTMLElement, label: string, fn: () => void | boolean, color?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.innerHTML = (color ? `<i style="background:${color}"></i>` : '') + label;
  b.addEventListener('click', () => {
    audio.unlock();
    markUnlocked();
    const r = fn();
    if (typeof r === 'boolean') b.classList.toggle('on', r);
  });
  row.appendChild(b);
  return b;
}

const musicRow = section('Music');
const musicModes: [string, MusicMode, BiomeId?][] = [
  ['Menu', 'menu'], ...BIOME_IDS.map((b): [string, MusicMode, BiomeId] => [`Battle · ${b}`, 'battle', b]),
  ['Victory', 'victory'], ['Defeat', 'defeat'], ['Off', 'off'],
];
for (const [label, mode, biome] of musicModes) button(musicRow, label, () => audio.setMusic(mode, biome));

const fireRow = section('Fire (per weapon)');
for (const id of WEAPON_ORDER) button(fireRow, WEAPONS[id].name, () => fire(id), WEAPONS[id].color);

let radius = 42;
const boomRow = section('Explosions (radius from mixer)');
const KINDS: ExplosionKind[] = ['standard', 'heavy', 'small', 'electric', 'fire', 'void', 'beam', 'dirt', 'firework'];
for (const k of KINDS) button(boomRow, k, () => explode(k, radius));
button(boomRow, 'secondary small', () => explode('small', 18, rx(), false));
button(boomRow, '12 stacked heavies', stack);

const scenRow = section('Scenarios');
button(scenRow, 'Full shot (whistle → impact → collapse)', () => fullShot());
button(scenRow, 'Thunderhead shot', () => fullShot('thunderhead'));
button(scenRow, 'Two falling shells', twoShells);
button(scenRow, 'Burrower drill', drillShot);
button(scenRow, 'Sunbeam', sunbeam);
button(scenRow, 'Singularity', singularity);
button(scenRow, 'Tesla pulses', tesla);
button(scenRow, 'Magma lava pool', magma);
button(scenRow, 'Faultline quake', faultline);
button(scenRow, 'Starfall', starfall);
button(scenRow, 'Fireworks', fireworks);
button(scenRow, 'Drive (toggle)', toggleDrive);
button(scenRow, 'CPU aim sweep', cpuAim);

const evRow = section('Events');
const x = (): number => rx();
const events: [string, () => void][] = [
  ['roundStart', () => emit({ type: 'roundStart', round: 1, biome: state.biome, seed: 1 })],
  ['tankLanded (intro)', () => emit({ type: 'tankLanded', player: 0, x: 380, y: 760, fallDistance: 260, damage: 0, intro: true })],
  ['tankLanded (fall)', () => emit({ type: 'tankLanded', player: 1, x: 1540, y: 760, fallDistance: 90, damage: 12, intro: false })],
  ['turnStart P1', () => emit({ type: 'turnStart', player: 0, turn: 1, wind: state.wind, previousWind: 0 })],
  ['turnStart P2 (cpu)', () => emit({ type: 'turnStart', player: 1, turn: 2, wind: state.wind, previousWind: 0 })],
  ['weaponSelect', () => emit({ type: 'weaponSelect', player: 0, weapon: 'thunderhead' })],
  ['split', () => emit({ type: 'split', weapon: 'trident', x: x(), y: 300, count: 3 })],
  ['bounce skipper', () => emit({ type: 'bounce', weapon: 'skipper', x: x(), y: 760, speed: 420 })],
  ['ricochet ting', () => emit({ type: 'bounce', weapon: 'ricochet', x: x(), y: 760, speed: 520 })],
  ['lockOn', () => emit({ type: 'lockOn', x: x(), y: 300, target: 1 })],
  ['mound', () => emit({ type: 'mound', x: x(), y: 760, radius: 92 })],
  ['damage', () => emit({ type: 'damage', target: 1, amount: 30, absorbed: 0, x: 1540, y: 750, weapon: 'ember', direct: true, hpAfter: 70, by: 0 })],
  ['fall damage', () => emit({ type: 'damage', target: 0, amount: 8, absorbed: 0, x: 380, y: 750, weapon: 'fall', direct: false, hpAfter: 92, by: null })],
  ['shield hit', () => emit({ type: 'damage', target: 1, amount: 0, absorbed: 20, x: 1540, y: 750, weapon: 'ember', direct: false, hpAfter: 100, by: 0 })],
  ['shieldUp', () => emit({ type: 'shieldUp', target: 0, amount: 45 })],
  ['shieldBreak', () => emit({ type: 'shieldBreak', target: 1, x: 1540, y: 750 })],
  ['utility', () => emit({ type: 'utility', player: 0, weapon: 'repair', x: 380, y: 750, amount: 30 })],
  ['heal', () => emit({ type: 'heal', target: 0, amount: 30, x: 380, y: 750 })],
  ['tankDestroyed', () => emit({ type: 'tankDestroyed', target: 1, x: 1540, y: 750, by: 0 })],
  ['lightning strike', () => emit({ type: 'lightning', x1: 1300, y1: 760, x2: 1540, y2: 750, target: 1 })],
  ['ground arc', () => emit({ type: 'lightning', x1: 1300, y1: 760, x2: 1350, y2: 780, target: null })],
  ['quake step', () => emit({ type: 'quake', x: x(), y: 760, step: 1 })],
  ['teleport', () => emit({ type: 'teleport', player: 0, fromX: 380, fromY: 760, toX: 1200, toY: 700 })],
  ['fizzle', () => emit({ type: 'fizzle', weapon: 'blink', x: x(), y: 400 })],
  ['crate spawn', () => emit({ type: 'crate', phase: 'spawn', id: 1, x: x(), y: -40, weapon: 'tesla', amount: 1, by: null })],
  ['crate land', () => emit({ type: 'crate', phase: 'land', id: 1, x: x(), y: 760, weapon: 'tesla', amount: 1, by: null })],
  ['crate collect', () => emit({ type: 'crate', phase: 'collect', id: 1, x: x(), y: 760, weapon: 'tesla', amount: 1, by: 0 })],
  ['dirtFall burst', () => { for (let i = 0; i < 8; i++) later(i * 125, () => emit({ type: 'dirtFall', x0: 900, x1: 1000, amount: 400 - i * 40 })); }],
  ['outOfBounds', () => emit({ type: 'outOfBounds', weapon: 'ember', x: 1990, y: 600 })],
  ['roundOver (win)', () => emit({ type: 'roundOver', winner: 0, round: 1 })],
  ['roundOver (lose)', () => emit({ type: 'roundOver', winner: 1, round: 1 })],
  ['roundOver (draw)', () => emit({ type: 'roundOver', winner: null, round: 1 })],
  ['matchOver (win)', () => { emit({ type: 'roundOver', winner: 0, round: 3 }); emit({ type: 'matchOver', winner: 0 }); }],
  ['matchOver (lose)', () => { emit({ type: 'roundOver', winner: 1, round: 3 }); emit({ type: 'matchOver', winner: 1 }); }],
];
for (const [label, fn] of events) button(evRow, label, fn);

const uiRow = section('UI sounds');
const UI: UiSound[] = ['click', 'hover', 'select', 'back', 'tick', 'error', 'start', 'toggle', 'open', 'close', 'confirm'];
for (const u of UI) button(uiRow, u, () => audio.ui(u));

// ---- mixer ----
const vols = { master: 0.8, sfx: 0.9, music: 0.45 };
const mixer = document.getElementById('mixer') as HTMLElement;
function slider(label: string, min: number, max: number, step: number, value: number, fn: (v: number) => void): void {
  const l = document.createElement('label');
  l.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${value}</output>`;
  const input = l.querySelector('input') as HTMLInputElement;
  const out = l.querySelector('output') as HTMLOutputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = String(v);
    fn(v);
  });
  mixer.appendChild(l);
}
slider('Master', 0, 1, 0.01, vols.master, v => { vols.master = v; audio.setVolumes(vols.master, vols.sfx, vols.music); });
slider('SFX', 0, 1, 0.01, vols.sfx, v => { vols.sfx = v; audio.setVolumes(vols.master, vols.sfx, vols.music); });
slider('Music', 0, 1, 0.01, vols.music, v => { vols.music = v; audio.setVolumes(vols.master, vols.sfx, vols.music); });
slider('Wind', -10, 10, 0.1, 0, v => { state.wind = v; });
slider('Time scale', 0.2, 1, 0.05, 1, v => { timeScale = v; });
slider('Blast radius', 10, 120, 1, radius, v => { radius = v; });
const mixRow = document.createElement('div');
mixRow.className = 'row';
mixRow.style.marginTop = '8px';
mixer.appendChild(mixRow);
let ducked = false;
button(mixRow, 'Duck', () => { ducked = !ducked; audio.setDucked(ducked); return ducked; });
button(mixRow, 'Kill-cam slow-mo', () => { timeScale = 0.3; later(1400, () => { timeScale = 1; }); });

// ---- unlock ----
const unlockBtn = document.getElementById('unlock') as HTMLButtonElement;
function markUnlocked(): void {
  unlockBtn.classList.add('done');
  unlockBtn.textContent = 'Audio on';
}
unlockBtn.addEventListener('click', () => { audio.unlock(); audio.setVolumes(vols.master, vols.sfx, vols.music); markUnlocked(); });

// ---- frame loop + meter ----
const meter = document.getElementById('meter') as HTMLCanvasElement;
const mctx = meter.getContext('2d') as CanvasRenderingContext2D;
const statsEl = document.getElementById('stats') as HTMLElement;
const peaks = new Float32Array(160);
let head = 0;
let maxVoices = 0;
let maxPeak = 0;
let last = performance.now();
let statT = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sdt = dt * timeScale;
  stepProjectiles(sdt);
  for (const h of state.hazards) h.age += sdt;
  state.tanks[0].x += state.tanks[0].moveDir * 72 * sdt;
  if (state.tanks[0].x > 1500) state.tanks[0].x = 300;
  if (aimT >= 0) {
    aimT += dt;
    const t = state.tanks[1];
    t.angle = 135 - 40 * Math.sin(Math.min(1, aimT / 1.4) * Math.PI * 0.5) + 4 * Math.sin(aimT * 8) * Math.max(0, 1 - aimT);
    t.power = 40 + 35 * Math.min(1, aimT / 1.2);
    if (aimT > 1.6) { aimT = -1; state.cpuThinking = false; state.activePlayer = 0; }
  }
  audio.update(sdt, state, timeScale);

  const d = audio.debug();
  peaks[head] = d.peak;
  head = (head + 1) % peaks.length;
  maxVoices = Math.max(maxVoices, d.voices);
  maxPeak = Math.max(maxPeak, d.peak);
  drawMeter();
  statT += dt;
  if (statT > 0.2) {
    statT = 0;
    statsEl.textContent =
      `context      ${d.state}\nmusic        ${d.music}\nvoices       ${d.voices}  (max ${maxVoices})\n` +
      `groups       ${Object.entries(d.groups).map(([k, v]) => `${k}:${v}`).join(' ') || '-'}\n` +
      `loops live   ${d.loops}\npeak         ${d.peak.toFixed(3)}  (max ${maxPeak.toFixed(3)})\n` +
      `projectiles  ${state.projectiles.length}   hazards ${state.hazards.length}\nwind ${state.wind.toFixed(1)}   timeScale ${timeScale.toFixed(2)}`;
  }
  requestAnimationFrame(frame);
}

function drawMeter(): void {
  const w = meter.width, h = meter.height;
  mctx.clearRect(0, 0, w, h);
  // 0 dBFS line and -6 dB guide.
  mctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (const db of [0, -6, -12, -24]) {
    const y = h - h * Math.pow(10, db / 20) * 0.9;
    mctx.fillRect(0, y, w, 1);
  }
  const bw = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const v = peaks[(head + i) % peaks.length];
    const bh = Math.min(1, v) * h * 0.9;
    mctx.fillStyle = v > 0.98 ? '#ff5a5a' : v > 0.6 ? '#ffd166' : '#3fc1ff';
    mctx.globalAlpha = 0.35 + 0.65 * (i / peaks.length);
    mctx.fillRect(i * bw, h - bh, bw - 1, bh);
  }
  mctx.globalAlpha = 1;
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------------------------
// Headless: exercise every API path and report bounds
// ---------------------------------------------------------------------------------------------

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function runAll(): Promise<Record<string, unknown>> {
  (window as unknown as Record<string, unknown>).__pin = true;
  audio.unlock();
  audio.setVolumes(0.8, 0.9, 0.45);
  markUnlocked();
  const msg = document.getElementById('msg') as HTMLElement;
  const log: string[] = [];
  maxVoices = 0;
  maxPeak = 0;
  for (const [, mode, biome] of musicModes) { audio.setMusic(mode, biome); await wait(120); }
  audio.setMusic('battle', 'cinder');
  for (const id of WEAPON_ORDER) { fire(id); await wait(40); }
  for (const k of KINDS) { explode(k, 20 + Math.random() * 80); await wait(40); }
  stack();
  for (const [, fn] of events) { fn(); await wait(30); }
  for (const u of UI) { audio.ui(u); await wait(15); }
  state.wind = 7;
  fullShot('thunderhead'); twoShells(); drillShot(); sunbeam(); singularity(); tesla(); magma(); faultline(); starfall(); fireworks();
  toggleDrive(); cpuAim();
  audio.setDucked(true); await wait(300); audio.setDucked(false);
  timeScale = 0.3; await wait(800); timeScale = 1;
  await wait(2500);
  toggleDrive();
  log.push(`after scenarios: ${JSON.stringify(audio.debug())}`);
  audio.setVolumes(0.5, 0.5, 0.5);
  audio.setMusic('victory'); await wait(500); audio.setMusic('defeat'); await wait(500); audio.setMusic('menu');
  state.wind = 0;
  await wait(5000);
  const end = audio.debug();
  msg.textContent = `runAll done · max voices ${maxVoices} · settled voices ${end.voices} · max peak ${maxPeak.toFixed(2)}`;
  return { maxVoices, maxPeak, end, log };
}

const w = window as unknown as Record<string, unknown>;
w.__audio = audio;
w.__state = state;
w.__runAll = runAll;
(document.getElementById('runall') as HTMLButtonElement).addEventListener('click', () => { void runAll(); });

// Other engineers edit files constantly during development; Vite then full-reloads every page, which
// would kill a long headless run. While pinned, redirect those reloads to a non-existent page path.
w.__pin = false;
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', (payload: { path?: string }) => {
    if (w.__pin) payload.path = '/__audio-sandbox-pinned__.html';
  });
}
