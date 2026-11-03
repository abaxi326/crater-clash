import { Game } from '../../src/sim/game.ts';
const t0 = performance.now();
const g = new Game();
console.log('ctor ms', (performance.now() - t0).toFixed(0));
const counts: Record<string, number> = {};
g.events.on(e => { counts[e.type] = (counts[e.type] ?? 0) + 1; if (['roundOver','tankDestroyed','fire'].includes(e.type)) console.log(g.state.phaseTime.toFixed(2), JSON.stringify(e).slice(0, 160)); });
g.newMatch({ players: [{ name: 'A', kind: 'cpu', difficulty: 'hard' }, { name: 'B', kind: 'cpu', difficulty: 'normal' }], biome: 'random', roundsToWin: 2, crates: true, seed: 7, attract: true });
let simT = 0; const t1 = performance.now();
for (let i = 0; i < 60 * 240 && g.state.round < 3; i++) { g.update(1 / 60); simT += 1 / 60; }
console.log('sim s', simT.toFixed(1), 'real ms', (performance.now() - t1).toFixed(0), 'round', g.state.round, g.state.phase, g.state.tanks.map(t => [t.hp, t.x.toFixed(0), t.y.toFixed(0)]));
console.log(counts);
