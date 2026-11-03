import { Game } from '../../src/sim/game.ts';
for (let seed = 1; seed <= 10; seed++) {
  const g = new Game();
  const diffs = ['easy', 'normal', 'hard'] as const;
  g.newMatch({ players: [{ name: 'a', kind: 'cpu', difficulty: diffs[seed % 3] }, { name: 'b', kind: 'cpu', difficulty: diffs[(seed + 1) % 3] }], biome: 'random', roundsToWin: 3, crates: true, seed: seed * 101, attract: true });
  for (let i = 0; i < 300 * 60; i++) {
    g.update(1 / 60);
    const st = g.state;
    if (st.phase === 'aiming' && st.phaseTime > 10) {
      const c = (g as any).cpu;
      const t = st.tanks[st.activePlayer];
      console.log('seed', seed, 'stall', st.biome, 'P', st.activePlayer, 'cpu', JSON.stringify({ ...c, plan: c.plan }), 'tank', t.x, t.y, t.airborne, t.moveDir, t.fuel, 'settling', st.terrain.settling, 'thinking', st.cpuThinking);
      break;
    }
  }
}
