/**
 * App shell: builds every module, wires game events to presentation, runs the frame loop and
 * the app flow (boot → main menu over an attract battle → setup → match → pause → results).
 * Also exposes the QA hooks from DESIGN.md §10 (window.__cc and URL parameters).
 */
import './ui/base.css';
import './ui/hud.css';
import './ui/menus.css';
import type { MusicMode, RenderFrame, UiActions, UiSound } from './contracts.ts';
import { BIOME_IDS, type BiomeId } from './core/biomes.ts';
import type { GameEvent } from './core/events.ts';
import { loadSettings, saveSettings, sanitizeSettings, type Quality, type Settings } from './core/settings.ts';
import { TimeControl } from './core/time.ts';
import type { Difficulty, GameState, MatchConfig, PlayerIndex } from './core/types.ts';
import { WEAPONS, type WeaponId } from './core/weapons.ts';
import { AudioEngine } from './audio/audio.ts';
import { Renderer } from './render/renderer.ts';
import { Game } from './sim/game.ts';
import { Hud } from './ui/hud.ts';
import { Input } from './ui/input.ts';
import { Menus } from './ui/menus.ts';

/** Real-time beat between the round/match ending and the results screen appearing. */
const ROUND_SCREEN_DELAY = 0.9;
const MATCH_SCREEN_DELAY = 1.1;

type AppMode = 'boot' | 'menu' | 'match';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const randomSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

// --- URL parameters (QA) -----------------------------------------------------------------

const params = new URLSearchParams(location.search);
const qp = (k: string): string | null => params.get(k);
const qFlag = (k: string): boolean => {
  const v = params.get(k);
  return v !== null && v !== '0' && v !== 'false';
};
const urlBiome = ((): BiomeId | 'random' | null => {
  const b = qp('biome');
  if (b === 'random') return 'random';
  return b && (BIOME_IDS as readonly string[]).includes(b) ? (b as BiomeId) : null;
})();
const urlSeed = qp('seed') !== null && Number.isFinite(Number(qp('seed'))) ? Number(qp('seed')) >>> 0 : null;
const urlDifficulty = ((): Difficulty | null => {
  const d = qp('difficulty');
  return d === 'easy' || d === 'normal' || d === 'hard' ? d : null;
})();
const urlWeapon = ((): WeaponId | null => {
  const w = qp('weapon');
  return w && w in WEAPONS ? (w as WeaponId) : null;
})();
const urlMute = qFlag('mute');

/** Settings forced by the URL for this session only (never persisted unless the player changes them). */
const overrides: Partial<Settings> = {};
{
  const q = qp('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'auto') overrides.quality = q as Quality | 'auto';
  if (qFlag('nopost')) overrides.postFx = false;
  if (qFlag('fps')) overrides.showFps = true;
}

// --- Settings ----------------------------------------------------------------------------

let stored: Settings = loadSettings();
let settings: Settings = { ...stored, ...overrides };

// --- Modules -----------------------------------------------------------------------------

const stageEl = $('stage');
const time = new TimeControl();
const game = new Game();
const renderer = new Renderer(stageEl, time);
const audio = new AudioEngine();

let mode: AppMode = 'boot';
let lastConfig: MatchConfig | null = null;
/** QA time multiplier on top of hit-stop / slow-mo. */
let debugScale = 1;
/** Results screen scheduled after a real-time beat. */
let pendingScreen: { screen: 'roundOver' | 'matchOver'; left: number } | null = null;

const actions: UiActions = {
  startMatch: config => startMatch(config),
  nextRound: () => nextRound(),
  rematch: () => {
    if (lastConfig) startMatch({ ...lastConfig, seed: randomSeed() });
    else quitToMenu();
  },
  quitToMenu: () => quitToMenu(),
  pause: () => pause(),
  resume: () => resume(),
  applySettings: s => applySettings(s),
  getSettings: () => settings,
  uiSound: (s: UiSound) => audio.ui(s),
  thumbnail: (biome, w, h) => {
    try {
      return renderer.thumbnail(biome, w, h);
    } catch {
      return null;
    }
  },
};

const hud = new Hud(actions);
hud.mount($('hud'));
const menus = new Menus(actions);
menus.mount($('overlay'));

const input = new Input({
  game,
  screenToWorld: (x, y) => renderer.screenToWorld(x, y),
  onPause: () => {
    if (hud.isWeaponPickerOpen()) hud.toggleWeaponPicker(false);
    else if (menus.current() !== 'none') menus.back();
    else pause();
  },
  onToggleWeapons: () => hud.toggleWeaponPicker(),
  uiSound: s => audio.ui(s),
  isBlocked: () => mode !== 'match' || menus.current() !== 'none' || game.state.paused,
});
input.attach(stageEl);

// --- Settings application ------------------------------------------------------------------

function applySettings(next: Settings): void {
  const clean = sanitizeSettings(next);
  // A URL override stays in force until the player picks a different value for that key.
  const persisted: Settings = { ...clean };
  for (const k of Object.keys(overrides) as (keyof Settings)[]) {
    if (clean[k] === overrides[k]) (persisted as unknown as Record<string, unknown>)[k] = stored[k];
    else delete overrides[k];
  }
  stored = persisted;
  saveSettings(stored);
  settings = { ...stored, ...overrides };
  pushSettings();
}

function pushSettings(): void {
  renderer.applySettings(settings);
  audio.setVolumes(urlMute ? 0 : settings.masterVolume, settings.sfxVolume, settings.musicVolume);
  document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
}

// --- App flow ------------------------------------------------------------------------------

function attractConfig(): MatchConfig {
  return {
    players: [
      { name: 'Azure', kind: 'cpu', difficulty: 'hard' },
      { name: 'Blaze', kind: 'cpu', difficulty: 'normal' },
    ],
    biome: urlBiome ?? 'random',
    roundsToWin: 99,
    crates: true,
    seed: urlSeed ?? randomSeed(),
    attract: true,
  };
}

function startAttract(): void {
  mode = 'menu';
  pendingScreen = null;
  time.reset();
  game.setPaused(false);
  game.newMatch(attractConfig());
  hud.setVisible(false);
  audio.setDucked(true);
  audio.setMusic('menu');
}

function startMatch(config: MatchConfig): void {
  mode = 'match';
  pendingScreen = null;
  lastConfig = { ...config, players: [{ ...config.players[0] }, { ...config.players[1] }], attract: false };
  time.reset();
  game.setPaused(false);
  menus.show('none');
  hud.setVisible(true);
  audio.setDucked(false);
  game.newMatch(lastConfig);
}

function nextRound(): void {
  if (mode !== 'match') return;
  pendingScreen = null;
  if (menus.current() === 'roundOver') menus.show('none');
  if (game.state.phase === 'roundOver') {
    time.reset();
    game.nextRound();
  }
}

function quitToMenu(): void {
  startAttract();
  menus.show('main');
}

function pause(): void {
  if (mode !== 'match' || game.state.paused) return;
  const phase = game.state.phase;
  if (phase === 'roundOver' || phase === 'matchOver' || menus.current() !== 'none') return;
  hud.toggleWeaponPicker(false);
  game.setPaused(true);
  audio.setDucked(true);
  menus.show('pause', game.state);
}

function resume(): void {
  if (mode !== 'match') return;
  game.setPaused(false);
  audio.setDucked(false);
  if (menus.current() !== 'none') menus.show('none');
  last = performance.now();
}

/** The only human's index when exactly one player is human (solo vs CPU). */
function soloHuman(st: GameState): PlayerIndex | null {
  const [a, b] = st.config.players;
  if (a.kind === 'human' && b.kind !== 'human') return 0;
  if (b.kind === 'human' && a.kind !== 'human') return 1;
  return null;
}

function onRoundStart(st: GameState): void {
  // Before the renderer's own handleEvent so its terrain-identity check sees the rebuilt caches.
  renderer.onRoundStart(st);
  hud.reset(st);
  if (urlWeapon) {
    for (const t of st.tanks) {
      t.ammo[urlWeapon] = Math.max(t.ammo[urlWeapon], 9);
      t.weapon = urlWeapon;
    }
  }
  if (!st.config.attract) audio.setMusic('battle', st.biome);
}

function onEvent(e: GameEvent): void {
  const st = game.state;
  if (e.type === 'roundStart') onRoundStart(st);
  renderer.handleEvent(e, st);
  audio.handleEvent(e, st);
  hud.handleEvent(e, st);
  menus.handleEvent(e, st);
  if (st.config.attract || mode !== 'match') return;
  if (e.type === 'roundOver') {
    if (st.phase === 'roundOver') pendingScreen = { screen: 'roundOver', left: ROUND_SCREEN_DELAY };
  } else if (e.type === 'matchOver') {
    pendingScreen = { screen: 'matchOver', left: MATCH_SCREEN_DELAY };
    const human = soloHuman(st);
    let music: MusicMode = 'victory';
    if (human !== null) music = e.winner === human ? 'victory' : 'defeat';
    else if (e.winner === null) music = 'defeat';
    audio.setMusic(music);
  }
}
game.events.on(onEvent);

// --- Frame loop ----------------------------------------------------------------------------

const frameInfo: RenderFrame = {
  time: 0,
  realDt: 0,
  dt: 0,
  settings,
  showAimGuide: false,
  attract: true,
};
let clock = 0;
let last = performance.now();
let rafId = 0;

/** One app tick. `realDt` is wall time (clamped); `simDt` already includes hit-stop/slow-mo. */
function tick(realDt: number, simDt: number, draw: boolean): void {
  clock += realDt;
  const st0 = game.state;
  const running = !st0.paused;
  input.update(realDt);
  game.update(simDt);
  const st = game.state;
  const dt = running ? simDt : 0;
  if (pendingScreen) {
    pendingScreen.left -= realDt;
    if (pendingScreen.left <= 0 && mode === 'match') {
      const screen = pendingScreen.screen;
      pendingScreen = null;
      hud.toggleWeaponPicker(false);
      menus.show(screen, st);
    }
  }
  if (draw) {
    frameInfo.time = clock;
    frameInfo.realDt = realDt;
    frameInfo.dt = dt;
    frameInfo.settings = settings;
    frameInfo.attract = mode !== 'match';
    frameInfo.showAimGuide = mode === 'match' && game.canControl() && menus.current() === 'none';
    renderer.render(st, game, frameInfo);
    audio.update(dt, st, running ? time.scale : 1);
  }
  hud.update(st, game, realDt);
  menus.update(realDt, st);
}

function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  const realDt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  const simDt = time.step(realDt) * debugScale;
  tick(realDt, simDt, true);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    // Leaving mid-match opens the pause menu so nothing happens behind the player's back.
    if (mode === 'match' && game.state.phase !== 'roundOver' && game.state.phase !== 'matchOver') pause();
  } else if (!rafId) {
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }
});

// Audio may only start from a user gesture.
const unlockAudio = (): void => {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudio, true);
  window.removeEventListener('keydown', unlockAudio, true);
};
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

// --- QA hooks ------------------------------------------------------------------------------

function qaConfig(kind: 'cpu' | 'duel', partial: Partial<MatchConfig> = {}): MatchConfig {
  const diff = urlDifficulty ?? 'normal';
  return {
    players: kind === 'cpu'
      ? [{ name: settings.playerName, kind: 'human', difficulty: diff }, { name: 'CPU', kind: 'cpu', difficulty: diff }]
      : [{ name: 'Player 1', kind: 'human', difficulty: diff }, { name: 'Player 2', kind: 'human', difficulty: diff }],
    biome: urlBiome ?? 'random',
    roundsToWin: 2,
    crates: true,
    seed: urlSeed ?? randomSeed(),
    attract: false,
    ...partial,
  };
}

const cc = {
  game,
  renderer,
  audio,
  hud,
  menus,
  time,
  input,
  get mode(): AppMode {
    return mode;
  },
  /** Starts a match; a partial config is completed with solo-vs-CPU defaults. */
  start(config: Partial<MatchConfig> = {}): void {
    startMatch({ ...qaConfig('cpu'), ...config });
  },
  /** Fires the active tank (human or CPU) at angle/power, optionally with a weapon (granted ammo). */
  fire(angle: number, power: number, weapon?: WeaponId): boolean {
    const st = game.state;
    if (st.phase !== 'aiming' || st.paused) return false;
    const t = st.tanks[st.activePlayer];
    if (weapon && WEAPONS[weapon]) {
      if (!(t.ammo[weapon] > 0)) t.ammo[weapon] = 1;
      t.weapon = weapon;
    }
    t.angle = Math.max(0, Math.min(180, angle));
    t.power = Math.max(0, Math.min(100, power));
    if (game.canControl()) return game.fire();
    // CPU turn: take over its shot (QA only).
    return (game as unknown as { fireActive(): boolean }).fireActive();
  },
  /** Advances the game by `seconds` of simulation time in 60 Hz steps (rendering each step). */
  skip(seconds: number): void {
    const step = 1 / 60;
    for (let s = 0; s < seconds; s += step) tick(step, step, true);
  },
  setTimeScale(n: number): void {
    debugScale = Math.max(0, Number(n) || 0);
  },
};
(window as unknown as { __cc: typeof cc }).__cc = cc;

// --- Boot ----------------------------------------------------------------------------------

pushSettings();
const play = qp('play');
if (play === 'cpu' || play === 'duel') {
  startMatch(qaConfig(play));
} else {
  startAttract();
  if (play !== 'attract') menus.show('main');
}
if (document.fonts?.load) {
  // Floating damage numbers draw with Outfit on canvas; warm it before the first hit.
  void document.fonts.load('700 32px Outfit').catch(() => undefined);
}
rafId = requestAnimationFrame(loop);
