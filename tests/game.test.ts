import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.ts';
import { flatScenario, placeTank, runUntil } from '../src/sim/scenario.ts';
import { BIOME_IDS } from '../src/core/biomes.ts';
import {
  FALL_DAMAGE_THRESHOLD, FUEL_PER_ROUND, INTRO_TIME, MAX_HP, MAX_WIND, ROUND_OVER_DELAY, TANK_HIT_RADIUS,
} from '../src/core/constants.ts';
import type { GameEvent } from '../src/core/events.ts';
import { tankCenter } from '../src/core/geometry.ts';
import type { MatchConfig } from '../src/core/types.ts';

type Ev = GameEvent;
const record = (g: Game): Ev[] => {
  const out: Ev[] = [];
  g.events.on(e => out.push(e));
  return out;
};
const of = <T extends Ev['type']>(evs: Ev[], type: T) => evs.filter(e => e.type === type) as Extract<Ev, { type: T }>[];
// Internal access for white-box checks.
const internal = (g: Game): any => g as any;

const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  players: [{ name: 'A', kind: 'human', difficulty: 'normal' }, { name: 'B', kind: 'human', difficulty: 'normal' }],
  biome: 'verdant', roundsToWin: 2, crates: false, seed: 42, attract: false, ...over,
});

test('constructor builds a valid idle state', () => {
  const g = new Game();
  const st = g.state;
  assert.equal(st.phase, 'intro');
  assert.ok(st.terrain.w > 0);
  assert.equal(st.tanks.length, 2);
  for (const t of st.tanks) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  assert.equal(g.aimGuide(500).length > 0, true);
});

test('newMatch: intro drop lands, then the first turn starts with player 0 and rolled wind', () => {
  const g = new Game();
  const evs = record(g);
  g.newMatch(cfg());
  assert.deepEqual(evs.slice(0, 2).map(e => e.type), ['matchStart', 'roundStart']);
  assert.equal(g.state.tanks[0].airborne, true);
  runUntil(g, () => g.state.phase === 'aiming', 10);
  const landed = of(evs, 'tankLanded');
  assert.equal(landed.length, 2);
  assert.ok(landed.every(e => e.intro && e.damage === 0));
  assert.ok(g.state.phaseTime < 1);
  const ts = of(evs, 'turnStart');
  assert.equal(ts.length, 1);
  assert.equal(ts[0].player, 0);
  assert.equal(ts[0].turn, 1);
  assert.ok(Math.abs(g.state.wind) <= MAX_WIND);
  assert.equal(Math.round(g.state.wind * 10) / 10, g.state.wind);
  assert.ok(g.canControl());
});

test('turn flow: fire → flight → settle → turnEnd → next player, wind drifts', () => {
  const g = flatScenario();
  const evs = record(g);
  const st = g.state;
  g.setAngle(60);
  g.setPower(55);
  assert.equal(g.fire(), true);
  assert.equal(st.phase, 'flight');
  assert.equal(g.fire(), false);
  runUntil(g, () => st.phase === 'aiming');
  const types = evs.map(e => e.type);
  assert.ok(types.indexOf('fire') < types.indexOf('explosion'));
  assert.ok(types.indexOf('explosion') < types.indexOf('turnEnd'));
  assert.ok(types.indexOf('turnEnd') < types.indexOf('turnStart'));
  assert.equal(st.activePlayer, 1);
  assert.equal(st.turn, 2);
  const ts = of(evs, 'turnStart')[0];
  assert.ok(Math.abs(ts.wind - ts.previousWind) <= 3.0001);
});

test('firing consumes ammo (except unlimited), sets recoil, ignores weapons without ammo', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[0];
  g.selectWeapon('thunderhead');
  assert.equal(t.weapon, 'thunderhead');
  assert.equal(of(evs, 'weaponSelect').length, 1);
  g.fire();
  assert.equal(t.ammo.thunderhead, 1);
  assert.equal(t.recoil, 1);
  assert.equal(t.stats.shots, 1);
  g.update(0.25);
  assert.ok(t.recoil < 1 && t.recoil > 0);
  runUntil(g, () => g.state.phase === 'aiming');
  // Player 1 fires ember: unlimited.
  const t1 = g.state.tanks[1];
  t1.ammo.singularity = 0;
  g.selectWeapon('singularity');
  assert.equal(t1.weapon, 'ember');
  g.fire();
  assert.equal(t1.ammo.ember, Infinity);
});

test('controls are ignored without control and values are clamped/rounded', () => {
  const g = flatScenario();
  const t = g.state.tanks[0];
  g.setAngle(200);
  assert.equal(t.angle, 180);
  g.setAngle(33.333);
  assert.equal(t.angle, 33.3);
  g.adjustPower(1000);
  assert.equal(t.power, 100);
  g.setPaused(true);
  assert.equal(g.canControl(), false);
  g.setAngle(10);
  assert.equal(t.angle, 33.3);
  g.update(1);
  g.setPaused(false);
  g.cycleWeapon(1);
  assert.equal(t.weapon, 'thunderhead');
  g.cycleWeapon(-1);
  assert.equal(t.weapon, 'ember');
});

test('blast damage model: direct hit, falloff, outside reach, self-damage, stats', () => {
  const g = flatScenario();
  const evs = record(g);
  const st = g.state;
  const [a, b] = st.tanks;
  const cb = tankCenter(b);
  internal(g).blast(cb.x, cb.y, 42, 30, 'ember', 'standard', 0, true, 1);
  assert.equal(b.hp, MAX_HP - 30);
  let d = of(evs, 'damage').at(-1)!;
  assert.equal(d.direct, true);
  assert.equal(d.hpAfter, 70);
  assert.equal(d.by, 0);
  assert.equal(a.stats.hits, 1);
  assert.equal(a.stats.damageDealt, 30);
  // Falloff at distance 40 from the centre.
  const hp = b.hp;
  internal(g).blast(cb.x + 40, cb.y, 42, 30, 'ember', 'standard', 0, true, -1);
  const expected = Math.round(30 * (0.25 + 0.75 * (1 - (40 - 6) / (42 + TANK_HIT_RADIUS))));
  assert.equal(hp - b.hp, expected);
  d = of(evs, 'damage').at(-1)!;
  assert.equal(d.direct, false);
  // Outside the reach: nothing.
  const n = of(evs, 'damage').length;
  internal(g).blast(cb.x + 42 + TANK_HIT_RADIUS + 1, cb.y, 42, 30, 'ember', 'standard', 0, true, -1);
  assert.equal(of(evs, 'damage').length, n);
  // Self-damage applies and does not count as a hit.
  const ca = tankCenter(a);
  internal(g).blast(ca.x, ca.y - 10, 42, 30, 'ember', 'standard', 0, true, -1);
  assert.ok(a.hp < MAX_HP);
  assert.equal(of(evs, 'damage').at(-1)!.by, 0);
  assert.equal(of(evs, 'damage').at(-1)!.target, 0);
  // Blasts carve terrain.
  assert.equal(st.terrain.isSolid(cb.x + 40, cb.y), false);
});

test('shields absorb first and break', () => {
  const g = flatScenario();
  const evs = record(g);
  const b = g.state.tanks[1];
  b.shield = 20;
  const c = tankCenter(b);
  internal(g).blast(c.x, c.y, 42, 30, 'ember', 'standard', 0, true, 1);
  const d = of(evs, 'damage').at(-1)!;
  assert.equal(d.absorbed, 20);
  assert.equal(d.amount, 10);
  assert.equal(b.hp, 90);
  assert.equal(b.shield, 0);
  assert.equal(of(evs, 'shieldBreak').length, 1);
});

test('destroying a tank ends the round after the delay; loser starts the next round', () => {
  const g = flatScenario({ roundsToWin: 2 });
  const evs = record(g);
  const st = g.state;
  st.tanks[1].hp = 5;
  const c = tankCenter(st.tanks[1]);
  // Shoot ember straight at player 1 by placing a projectile above it.
  internal(g).spawnProjectile('ember', 0, c.x, c.y - 60, 0, 200, 'ballistic', false);
  internal(g).setPhase('flight');
  runUntil(g, () => st.phase === 'roundOver', 15);
  assert.equal(of(evs, 'tankDestroyed').length, 1);
  assert.equal(st.tanks[1].alive, false);
  assert.equal(st.phase, 'roundOver');
  assert.deepEqual(st.wins, [1, 0]);
  assert.equal(st.roundWinner, 0);
  const destroyedAt = evs.findIndex(e => e.type === 'tankDestroyed');
  assert.ok(destroyedAt >= 0);
  assert.equal(of(evs, 'roundOver')[0].winner, 0);
  g.nextRound();
  assert.equal(st.round, 2);
  assert.equal(st.phase, 'intro');
  assert.ok(st.tanks.every(t => t.alive && t.hp === MAX_HP && t.fuel === FUEL_PER_ROUND));
  runUntil(g, () => st.phase === 'aiming', 10);
  assert.equal(st.activePlayer, 1);
  assert.ok(ROUND_OVER_DELAY > 0);
});

test('matchOver when roundsToWin is reached', () => {
  const g = flatScenario({ roundsToWin: 1 });
  const evs = record(g);
  const st = g.state;
  internal(g).damageTank(1, 500, 'ember', true, 0, 0, 0);
  internal(g).setPhase('settle');
  runUntil(g, () => st.phase === 'matchOver', 10);
  assert.equal(st.phase, 'matchOver');
  assert.equal(st.matchWinner, 0);
  assert.deepEqual(of(evs, 'matchOver').map(e => e.winner), [0]);
  g.nextRound();
  assert.equal(st.phase, 'matchOver');
});

test('fall damage when the ground disappears', () => {
  const g = flatScenario({ ground: 600 });
  const evs = record(g);
  const st = g.state;
  const t = st.tanks[1];
  st.terrain.carveRect(t.x - 60, 590, t.x + 60, 760);
  runUntil(g, () => of(evs, 'tankLanded').length > 0, 5);
  const l = of(evs, 'tankLanded')[0];
  assert.equal(l.intro, false);
  assert.ok(l.fallDistance > FALL_DAMAGE_THRESHOLD);
  assert.ok(l.damage > 0);
  assert.equal(t.hp, MAX_HP - l.damage);
  assert.equal(of(evs, 'damage').at(-1)!.weapon, 'fall');
});

test('driving follows the surface, uses fuel, emits drive start/stop, respects edges and slopes', () => {
  const g = flatScenario({ x0: 200 });
  const evs = record(g);
  const t = g.state.tanks[0];
  g.setMove(1);
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  assert.ok(t.x > 230 && t.x < 240, `x=${t.x}`);
  assert.ok(Math.abs(t.fuel - (FUEL_PER_ROUND - (t.x - 200))) < 1e-6);
  assert.ok(t.treadPhase > 30);
  assert.equal(t.moveDir, 1);
  g.setMove(0);
  g.update(0.1);
  assert.deepEqual(of(evs, 'drive').map(e => e.moving), [true, false]);
  // Run out of fuel.
  g.setMove(1);
  runUntil(g, () => t.fuel <= 0, 10);
  assert.equal(t.fuel, 0);
  // A wall blocks.
  const g2 = flatScenario({ x0: 300 });
  g2.state.terrain.fillCircle(360, 700, 40, () => 0xff3c5a7a);
  const t2 = g2.state.tanks[0];
  g2.setMove(1);
  for (let i = 0; i < 90; i++) g2.update(1 / 60);
  assert.ok(t2.x < 330, `blocked x=${t2.x}`);
  // World edge padding.
  const g3 = flatScenario({ x0: 60 });
  g3.setMove(-1);
  for (let i = 0; i < 90; i++) g3.update(1 / 60);
  assert.ok(g3.state.tanks[0].x >= 34);
});

test('turn does not end while driving; only firing ends it', () => {
  const g = flatScenario();
  g.setMove(1);
  g.update(0.1);
  runUntil(g, () => false, 6);
  assert.equal(g.state.phase, 'aiming');
  assert.equal(g.state.activePlayer, 0);
});

test('crates spawn, parachute down, land and are collected by blasts', () => {
  const g = flatScenario({ crates: true });
  const evs = record(g);
  const st = g.state;
  let tries = 0;
  while (st.crates.length === 0 && tries++ < 100) internal(g).maybeSpawnCrate();
  assert.equal(st.crates.length, 1);
  const c = st.crates[0];
  assert.ok(Math.abs(c.x - st.tanks[0].x) >= 120 && Math.abs(c.x - st.tanks[1].x) >= 120);
  assert.equal(of(evs, 'crate')[0].phase, 'spawn');
  runUntil(g, () => c.landed, 30);
  assert.ok(c.landed);
  assert.equal(c.y, 700);
  assert.ok(of(evs, 'crate').some(e => e.phase === 'land'));
  runUntil(g, () => false, 1);
  assert.equal(c.parachute, 0);
  const before = st.tanks[1].ammo[c.weapon];
  const amount = c.amount;
  internal(g).blast(c.x + 20, c.y - 5, 30, 10, 'ember', 'standard', 1, true, -1);
  assert.equal(st.crates.length, 0);
  assert.equal(st.tanks[1].ammo[c.weapon], before + amount);
  const col = of(evs, 'crate').find(e => e.phase === 'collect')!;
  assert.equal(col.by, 1);
});

test('crates fall again when undermined', () => {
  const g = flatScenario({ crates: true });
  const st = g.state;
  while (st.crates.length === 0) internal(g).maybeSpawnCrate();
  const c = st.crates[0];
  runUntil(g, () => c.landed, 30);
  st.terrain.carveRect(c.x - 30, 690, c.x + 30, 800);
  g.update(1 / 60);
  assert.equal(c.landed, false);
  runUntil(g, () => c.landed, 5);
  assert.ok(c.y >= 799);
});

test('attract mode: CPUs play forever, rounds auto-advance, never matchOver', () => {
  const g = new Game();
  g.newMatch(cfg({ attract: true, roundsToWin: 1, biome: 'random', crates: true, seed: 5 }));
  const evs = record(g);
  assert.equal(g.canControl(), false);
  runUntil(g, () => g.state.round >= 3, 400);
  assert.ok(g.state.round >= 3, `round ${g.state.round}`);
  assert.equal(of(evs, 'matchOver').length, 0);
  assert.equal(g.state.matchWinner, null);
});

test('lastShotPath records the previous shot', () => {
  const g = flatScenario();
  g.setAngle(50);
  g.setPower(60);
  g.fire();
  runUntil(g, () => g.state.phase === 'settle');
  const p = g.lastShotPath(0);
  assert.ok(p.length > 10);
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    assert.ok(d >= 9.9 && d < 16, `spacing ${d}`);
  }
  assert.equal(g.lastShotPath(1).length, 0);
});

test('aim guide equals the real flight path', () => {
  for (const [angle, power, wind] of [[50, 70, 0], [120, 62, 6], [30, 95, -8], [75, 40, 3]]) {
    const g = flatScenario({ wind });
    g.setAngle(angle);
    g.setPower(power);
    const guide = g.aimGuide(1e6).map(v => ({ ...v }));
    g.fire();
    const real: { x: number; y: number }[] = [];
    runUntil(g, () => {
      const p = g.state.projectiles[0];
      if (p) real.push({ x: p.x, y: p.y });
      return g.state.phase !== 'flight';
    }, 20, 1 / 37);
    assert.ok(real.length > 5);
    // Every real sample lies on the guide polyline.
    for (const r of real) {
      let best = Infinity;
      for (let i = 1; i < guide.length; i++) best = Math.min(best, segDist(r, guide[i - 1], guide[i]));
      assert.ok(best < 0.6, `off guide by ${best}`);
    }
    // And the guide's end is where the shot ended.
    const end = guide.at(-1)!;
    const last = g.lastShotPath(0).at(-1)!;
    assert.ok(Math.hypot(end.x - last.x, end.y - last.y) < 6, `end ${JSON.stringify(end)} vs ${JSON.stringify(last)}`);
  }
});

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

test('determinism: same config and inputs give identical event streams', () => {
  const run = (): string => {
    const g = new Game();
    const log: string[] = [];
    g.events.on(e => log.push(JSON.stringify(e)));
    g.newMatch(cfg({ attract: true, seed: 99, crates: true, biome: 'random' }));
    runUntil(g, () => false, 45);
    return log.join('\n') + JSON.stringify(g.state.tanks);
  };
  const a = run(), b = run();
  assert.ok(a.length > 1000);
  assert.equal(a, b);
});

test('intro timing respects INTRO_TIME', () => {
  const g = new Game();
  g.newMatch(cfg());
  const t = runUntil(g, () => g.state.phase === 'aiming', 10);
  assert.ok(t >= INTRO_TIME - 1e-6);
});

test('soak: CPU vs CPU on every biome never throws, NaNs or stalls', () => {
  for (const biome of BIOME_IDS) {
    const g = new Game();
    g.newMatch(cfg({
      players: [{ name: 'A', kind: 'cpu', difficulty: 'normal' }, { name: 'B', kind: 'cpu', difficulty: 'hard' }],
      biome, attract: true, crates: true, seed: 1000 + biome.length,
    }));
    let maxPhase = 0;
    let t = 0;
    while (g.state.round < 3 && t < 600) {
      g.update(1 / 30);
      t += 1 / 30;
      const st = g.state;
      if (st.phase !== 'aiming') maxPhase = Math.max(maxPhase, st.phaseTime);
      for (const tk of st.tanks) {
        for (const v of [tk.x, tk.y, tk.vy, tk.tilt, tk.angle, tk.power, tk.hp, tk.fuel, tk.treadPhase]) assert.ok(Number.isFinite(v), `${biome} tank NaN`);
      }
      for (const p of st.projectiles) assert.ok(Number.isFinite(p.x + p.y + p.vx + p.vy + p.rotation), `${biome} projectile NaN`);
      for (const h of st.hazards) assert.ok(Number.isFinite(h.x + h.y + h.radius), `${biome} hazard NaN`);
      assert.ok(st.hazards.length <= 64 && st.projectiles.length <= 64);
      if (st.phase === 'aiming') assert.ok(st.phaseTime < 12, `${biome}: CPU stalled while aiming`);
    }
    assert.ok(g.state.round >= 3, `${biome} only reached round ${g.state.round}`);
    assert.ok(maxPhase < 25, `${biome} phase stalled ${maxPhase}`);
  }
});

test('placeTank helper keeps scenarios honest', () => {
  const g = flatScenario();
  const t = placeTank(g, 0, 900);
  assert.equal(t.y, 700);
});
