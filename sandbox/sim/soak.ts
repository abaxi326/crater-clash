import { Game } from '../../src/sim/game.ts';
const maxBy: Record<string, number> = {};
let rounds = 0, turns = 0, fizzles = 0, t0 = performance.now(), simT = 0, draws = 0, selfKills = 0;
const weaponUse: Record<string, number> = {};
for (let seed = 1; seed <= 10; seed++) {
  const g = new Game();
  g.events.on(e => {
    if (e.type === 'roundOver') { rounds++; if (e.winner === null) draws++; }
    if (e.type === 'turnStart') turns++;
    if (e.type === 'fizzle') fizzles++;
    if (e.type === 'fire') weaponUse[e.weapon] = (weaponUse[e.weapon] ?? 0) + 1;
    if (e.type === 'tankDestroyed' && e.by === e.target) selfKills++;
  });
  const diffs = ['easy', 'normal', 'hard'] as const;
  g.newMatch({ players: [{ name: 'a', kind: 'cpu', difficulty: diffs[seed % 3] }, { name: 'b', kind: 'cpu', difficulty: diffs[(seed + 1) % 3] }], biome: 'random', roundsToWin: 3, crates: true, seed: seed * 101, attract: true });
  for (let i = 0; i < 300 * 60; i++) {
    g.update(1 / 60); simT += 1 / 60;
    const st = g.state;
    maxBy[st.phase] = Math.max(maxBy[st.phase] ?? 0, st.phaseTime);
  }
}
console.log({ rounds, draws, selfKills, turns, fizzles, simMin: (simT / 60).toFixed(1), realS: ((performance.now() - t0) / 1000).toFixed(1) });
console.log(maxBy);
console.log(weaponUse);
