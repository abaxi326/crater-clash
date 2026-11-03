// Sandbox: the HUD + Input over a painted backdrop with a fake game. URL params:
//   ?sky=bright|dark|dunes  ?dev=1 (buttons)  ?fps=1  ?scene=cpu|low|shield|picker|banner
import type { UiActions } from '../src/contracts.ts';
import { WORLD_H, WORLD_W } from '../src/core/constants.ts';
import { turretPivot } from '../src/core/geometry.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';
import { TEAMS } from '../src/core/teams.ts';
import type { MatchConfig, PlayerIndex } from '../src/core/types.ts';
import type { WeaponId } from '../src/core/weapons.ts';
import { Hud } from '../src/ui/hud.ts';
import { Input } from '../src/ui/input.ts';
import { FakeGame, GROUND_Y, makeState } from './hud/fake.ts';

const q = new URLSearchParams(location.search);
const sky = q.get('sky') ?? 'bright';
const settings: Settings = { ...DEFAULT_SETTINGS, showFps: q.get('fps') === '1' };
const logEl = document.getElementById('log')!;
const lines: string[] = [];
const log = (m: string): void => {
  lines.push(m);
  if (lines.length > 6) lines.shift();
  logEl.textContent = lines.join('\n');
};
if (q.get('log') === '1') logEl.classList.add('on');

const config: MatchConfig = {
  players: [
    { name: q.get('p0') ?? 'Nova', kind: 'human', difficulty: 'normal' },
    { name: q.get('p1') ?? 'Brick', kind: q.get('hotseat') === '1' ? 'human' : 'cpu', difficulty: 'hard' },
  ],
  biome: 'verdant', roundsToWin: 3, crates: true, seed: 7, attract: false,
};
const state = makeState(config);
state.wins = [1, 0];
state.round = 2;
state.turn = 3;
const game = new FakeGame(state);
game.log = m => log('game.' + m);

const actions: UiActions = {
  startMatch: () => log('startMatch'), nextRound: () => log('nextRound'), rematch: () => log('rematch'),
  quitToMenu: () => log('quit'), pause: () => log('actions.pause'), resume: () => log('resume'),
  applySettings: () => {}, getSettings: () => settings, uiSound: s => log('sound ' + s), thumbnail: () => null,
};

// --- Backdrop
const stage = document.getElementById('stage')!;
const canvas = document.createElement('canvas');
stage.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
let scale = 1, ox = 0, oy = 0;
const SKIES: Record<string, string[]> = {
  bright: ['#7cc6ff', '#bfe6ff', '#f2fbff'],
  dark: ['#05060f', '#141a3a', '#2a2350'],
  dunes: ['#3d2a6b', '#e2725b', '#ffd28a'],
};
function resize(): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  scale = Math.max(innerWidth / WORLD_W, innerHeight / WORLD_H) * dpr;
  ox = (canvas.width - WORLD_W * scale) / 2;
  oy = (canvas.height - WORLD_H * scale) / 2;
}
addEventListener('resize', resize);
resize();
const screenToWorld = (cx: number, cy: number) => {
  const dpr = canvas.width / innerWidth;
  return { x: (cx * dpr - ox) / scale, y: (cy * dpr - oy) / scale };
};

function ground(x: number): number {
  return GROUND_Y + 30 * Math.sin(x / 210) + 18 * Math.sin(x / 77 + 1);
}

function draw(): void {
  const s = SKIES[sky] ?? SKIES.bright;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, s[0]);
  g.addColorStop(0.6, s[1]);
  g.addColorStop(1, s[2]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  // Far hills + ground
  ctx.fillStyle = sky === 'dark' ? '#1b1f3d' : sky === 'dunes' ? '#a65a4a' : '#9fd4b8';
  ctx.beginPath();
  ctx.moveTo(-200, WORLD_H);
  for (let x = -200; x <= WORLD_W + 200; x += 20) ctx.lineTo(x, 640 + 60 * Math.sin(x / 300 + 2));
  ctx.lineTo(WORLD_W + 200, WORLD_H);
  ctx.fill();
  ctx.fillStyle = sky === 'dark' ? '#2a2236' : sky === 'dunes' ? '#d99a5b' : '#5aa04a';
  ctx.beginPath();
  ctx.moveTo(-200, WORLD_H + 200);
  for (let x = -200; x <= WORLD_W + 200; x += 10) ctx.lineTo(x, ground(x));
  ctx.lineTo(WORLD_W + 200, WORLD_H + 200);
  ctx.fill();
  for (const t of state.tanks) {
    t.y = ground(t.x);
    const team = TEAMS[t.index];
    const p = turretPivot(t);
    ctx.strokeStyle = '#1b2233';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos((t.angle * Math.PI) / 180) * 34, p.y - Math.sin((t.angle * Math.PI) / 180) * 34);
    ctx.stroke();
    ctx.fillStyle = team.primary;
    ctx.beginPath();
    ctx.roundRect(t.x - 28, t.y - 22, 56, 18, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#1b2233';
    ctx.beginPath();
    ctx.roundRect(t.x - 30, t.y - 8, 60, 10, 5);
    ctx.fill();
  }
}

// --- HUD + input
const hud = new Hud(actions);
hud.mount(document.getElementById('hud')!);
const input = new Input({
  game, screenToWorld, onPause: () => log('onPause'), onToggleWeapons: () => hud.toggleWeaponPicker(),
  uiSound: s => log('sound ' + s), isBlocked: () => false,
});
input.attach(stage);
game.events.on(e => hud.handleEvent(e, state));
hud.reset(state);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  game.update(dt);
  sandboxTick(dt);
  draw();
  hud.update(state, game, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Scenario helpers (also driven by the screenshot harness via window.__hud)
let autoTurn = true;
function sandboxTick(dt: number): void {
  const t = state.tanks[state.activePlayer];
  if (state.cpuThinking && state.phase === 'aiming') {
    // CPU sweeps its aim like the real AI would.
    t.angle = Math.round((128 + 14 * Math.sin(state.phaseTime * 1.7)) * 10) / 10;
    t.power = Math.round((60 + 12 * Math.sin(state.phaseTime * 1.1)) * 10) / 10;
  }
  if (autoTurn && state.phase === 'flight' && state.phaseTime > 1.4) {
    state.phase = 'settle';
    state.phaseTime = 0;
  }
  if (autoTurn && state.phase === 'settle' && state.phaseTime > 0.4) turn(state.activePlayer === 0 ? 1 : 0);
}

function turn(p: PlayerIndex, wind?: number): void {
  const prev = state.wind;
  state.activePlayer = p;
  state.phase = 'aiming';
  state.phaseTime = 0;
  state.turn++;
  state.wind = wind ?? Math.round(Math.max(-10, Math.min(10, prev + (Math.random() * 6 - 3))) * 10) / 10;
  state.cpuThinking = config.players[p].kind === 'cpu';
  game.events.emit({ type: 'turnStart', player: p, turn: state.turn, wind: state.wind, previousWind: prev });
}

function damage(p: PlayerIndex, amount: number): void {
  const t = state.tanks[p];
  const absorbed = Math.min(t.shield, amount);
  t.shield -= absorbed;
  if (absorbed > 0 && t.shield <= 0) game.events.emit({ type: 'shieldBreak', target: p, x: t.x, y: t.y });
  const dmg = amount - absorbed;
  t.hp = Math.max(0, t.hp - dmg);
  t.alive = t.hp > 0;
  game.events.emit({ type: 'damage', target: p, amount: dmg, absorbed, x: t.x, y: t.y, weapon: 'ember', direct: false, hpAfter: t.hp, by: p === 0 ? 1 : 0 });
}

function shield(p: PlayerIndex, amount: number): void {
  state.tanks[p].shield = amount;
  game.events.emit({ type: 'shieldUp', target: p, amount });
}

function crate(p: PlayerIndex, weapon: WeaponId): void {
  state.tanks[p].ammo[weapon]++;
  game.events.emit({ type: 'crate', phase: 'collect', id: 1, x: 0, y: 0, weapon, amount: 1, by: p });
}

function round(n: number): void {
  state.round = n;
  state.turn = 0;
  game.events.emit({ type: 'roundStart', round: n, biome: state.biome, seed: 1 });
}

function phase(ph: typeof state.phase): void {
  state.phase = ph;
  state.phaseTime = 0;
}

const api = {
  state, game, hud, turn, damage, shield, crate, round, phase,
  wind: (w: number) => {
    const prev = state.wind;
    state.wind = w;
    game.events.emit({ type: 'turnStart', player: state.activePlayer, turn: state.turn, wind: w, previousWind: prev });
  },
  biome: (b: typeof state.biome) => { state.biome = b; },
  picker: (open = true) => hud.toggleWeaponPicker(open),
  auto: (on: boolean) => { autoTurn = on; },
  visible: (v: boolean) => hud.setVisible(v),
  heal: (p: PlayerIndex, n: number) => {
    state.tanks[p].hp = Math.min(100, state.tanks[p].hp + n);
    game.events.emit({ type: 'heal', target: p, amount: n, x: 0, y: 0 });
  },
};
(window as unknown as { __hud: typeof api }).__hud = api;

// Initial scene presets for screenshots.
const scene = q.get('scene');
if (scene === 'cpu') {
  state.activePlayer = 1;
  state.cpuThinking = true;
  state.tanks[0].hp = 62;
  state.tanks[1].hp = 81;
} else if (scene === 'low') {
  state.tanks[0].hp = 18;
  state.tanks[1].hp = 47;
  state.tanks[0].fuel = 30;
} else if (scene === 'shield') {
  state.tanks[0].shield = 40;
  state.tanks[1].hp = 55;
}
if (scene) hud.reset(state);

// Dev panel
const dev = document.getElementById('dev')!;
if (q.get('dev') === '1') dev.classList.add('on');
const btn = (label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  dev.appendChild(b);
};
btn('P1 turn', () => turn(0));
btn('CPU turn', () => turn(1));
btn('Hit P1 -18', () => damage(0, 18));
btn('Hit P2 -32', () => damage(1, 32));
btn('Shield P1', () => shield(0, 40));
btn('Heal P1', () => api.heal(0, 25));
btn('Wind ±', () => api.wind(Math.round((Math.random() * 20 - 10) * 10) / 10));
btn('No wind', () => { api.biome('lunar'); api.wind(0); });
btn('Crate', () => crate(0, 'thunderhead'));
btn('Round', () => round(state.round + 1));
btn('Picker', () => hud.toggleWeaponPicker());
btn('Intro', () => phase('intro'));
btn('Hide/Show', () => hud.setVisible(!(document.querySelector('.cc-hud')?.classList.contains('is-visible'))));

// ?icons=1 → icon gallery (weapon icons tinted by their colour, UI icons in white and accent).
if (q.get('icons') === '1') {
  void import('../src/ui/icons.ts').then(({ UI_ICONS, weaponIcon }) => {
    void import('../src/core/weapons.ts').then(({ WEAPON_ORDER, WEAPONS }) => {
      const g = document.createElement('div');
      g.style.cssText = 'position:fixed;inset:0;z-index:200;background:#0b0f1c;color:#eef;display:grid;grid-template-columns:repeat(9,1fr);gap:10px;padding:16px;font:12px system-ui;overflow:auto;align-content:start';
      const cell = (html: string, label: string, extra = ''): void => {
        const c = document.createElement('div');
        c.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:12px;background:#151b2e;' + extra;
        c.innerHTML = html + `<span>${label}</span>`;
        g.appendChild(c);
      };
      for (const id of WEAPON_ORDER) cell(weaponIcon(id, 64), WEAPONS[id].name);
      for (const [k, v] of Object.entries(UI_ICONS)) cell(v.replace('width="24" height="24"', 'width="48" height="48"'), k, '--icon-accent:#ffc457');
      document.body.appendChild(g);
    });
  });
}
