/**
 * Menus sandbox. URL params:
 *   screen=main|setup|pause|settings|help|roundOver|matchOver   bg=<biome>   thumbs=0 (null previews)
 *   winner=0|1|draw   mode=cpu|duel   round=N   rm=1 (reduced motion)   shot=1 (hide sandbox chrome)
 */
import { Menus } from '../src/ui/menus.ts';
import type { MenuScreen, UiActions } from '../src/contracts.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings.ts';
import type { BiomeId } from '../src/core/biomes.ts';
import type { GameState, PlayerIndex } from '../src/core/types.ts';
import { fakeThumbnail, startFakeScene } from './menus/fakeScene.ts';

const q = new URLSearchParams(location.search);
const logEl = document.getElementById('log')!;
const lines: string[] = [];
const log = (m: string): void => {
  lines.push(m);
  if (lines.length > 8) lines.shift();
  logEl.textContent = lines.join('\n');
  console.log('[menus]', m);
};
if (q.get('shot') === '1') document.body.classList.add('shot');
if (q.get('rm') === '1') document.documentElement.classList.add('reduced-motion');

startFakeScene(document.getElementById('bg') as HTMLCanvasElement, (q.get('bg') as BiomeId) || 'dunes');

let settings: Settings = { ...DEFAULT_SETTINGS };
const mode = q.get('mode') === 'duel' ? 'duel' : 'cpu';
const winnerParam = q.get('winner');
const winner: PlayerIndex | null = winnerParam === 'draw' ? null : winnerParam === '1' ? 1 : 0;

function fakeState(): GameState {
  const roundsToWin = 3;
  const wins: [number, number] = winner === null ? [1, 1] : winner === 0 ? [3, 1] : [2, 3];
  const tank = (i: PlayerIndex, dmg: number, shots: number, hits: number) => ({ index: i, stats: { damageDealt: dmg, shots, hits } });
  return {
    config: {
      players: [
        { name: settings.playerName, kind: 'human', difficulty: 'normal' },
        { name: mode === 'cpu' ? 'CPU' : 'Player 2', kind: mode === 'cpu' ? 'cpu' : 'human', difficulty: 'normal' },
      ],
      biome: 'random', roundsToWin, crates: true, seed: 1, attract: false,
    },
    phase: 'roundOver', phaseTime: 0, paused: false,
    round: Number(q.get('round') ?? 4), turn: 9, activePlayer: 0,
    wins, biome: 'dunes', seed: 1, wind: 3, gravity: 520,
    tanks: [tank(0, 184, 14, 9), tank(1, 121, 13, 5)],
    projectiles: [], hazards: [], crates: [],
    roundWinner: winner, matchWinner: winner, cpuThinking: false, nextId: 1,
  } as unknown as GameState;
}

let menus: Menus;
const actions: UiActions = {
  startMatch: c => { log(`startMatch ${JSON.stringify({ ...c, players: c.players.map(p => `${p.name}/${p.kind}/${p.difficulty}`) })}`); menus.show('none'); },
  nextRound: () => { log('nextRound'); menus.show('none'); },
  rematch: () => { log('rematch'); menus.show('none'); },
  quitToMenu: () => { log('quitToMenu'); menus.show('main'); },
  pause: () => log('pause'),
  resume: () => { log('resume'); menus.show('none'); },
  applySettings: s => {
    settings = s;
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
    log(`applySettings ${JSON.stringify(s)}`);
  },
  getSettings: () => settings,
  uiSound: s => { if (s !== 'hover') log(`ui:${s}`); },
  thumbnail: (b, w, h) => (q.get('thumbs') === '0' ? null : fakeThumbnail(b, w, h)),
};

menus = new Menus(actions);
menus.mount(document.getElementById('overlay')!);

const state = fakeState();
const screens: MenuScreen[] = ['main', 'setup', 'pause', 'settings', 'help', 'roundOver', 'matchOver', 'none'];
const bar = document.getElementById('bar')!;
for (const s of screens) {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = () => menus.show(s, state);
  bar.append(b);
}

let last = performance.now();
const loop = (t: number): void => {
  menus.update(Math.min(0.1, (t - last) / 1000), state);
  last = t;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

const start = (q.get('screen') as MenuScreen) || 'main';
menus.show(start, state);

// Hooks for the screenshot harness.
Object.assign(window, { __menus: menus, __state: state, __actions: actions });
