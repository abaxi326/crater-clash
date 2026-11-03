import { Game } from '../../src/sim/game.ts';
import { planShot } from '../../src/sim/ai.ts';
import { Rng } from '../../src/core/rng.ts';
import { BIOME_IDS } from '../../src/core/biomes.ts';
for (const biome of BIOME_IDS) {
  const g = new Game();
  g.newMatch({ players: [{ name: 'A', kind: 'human', difficulty: 'hard' }, { name: 'B', kind: 'human', difficulty: 'normal' }], biome, roundsToWin: 2, crates: true, seed: 3, attract: false });
  for (let i = 0; i < 300; i++) g.update(1 / 60);
  const rng = new Rng(5);
  let worst = 0, sum = 0;
  for (let k = 0; k < 10; k++) {
    const t0 = performance.now();
    const p = planShot(g.state, 0, (['easy', 'normal', 'hard'] as const)[k % 3], rng);
    const dt = performance.now() - t0; worst = Math.max(worst, dt); sum += dt;
    if (k < 3) console.log(biome, JSON.stringify(p));
  }
  console.log(biome, 'avg', (sum / 10).toFixed(1), 'worst', worst.toFixed(1), g.state.phase);
}
