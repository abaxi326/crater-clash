import test from 'node:test';
import assert from 'node:assert/strict';
import { planShot } from '../src/sim/ai.ts';
import { flatScenario, runUntil } from '../src/sim/scenario.ts';
import { Rng } from '../src/core/rng.ts';
import { MAX_HP, TANK_HIT_RADIUS } from '../src/core/constants.ts';
import { muzzlePoint, muzzleVelocity, tankCenter } from '../src/core/geometry.ts';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../src/core/weapons.ts';
import type { Game } from '../src/sim/game.ts';
import type { GameEvent } from '../src/core/events.ts';
import { TankTargets, makeTraceResult, traceBallistic } from '../src/sim/physics.ts';

const onlyEmber = (g: Game, player: 0 | 1): void => {
  const t = g.state.tanks[player];
  for (const id of WEAPON_ORDER) if (id !== 'ember') t.ammo[id] = 0;
};

/** Where a planned ember shot would land (real ballistics). */
function impactOf(g: Game, player: 0 | 1, angle: number, power: number, weapon: WeaponId = 'ember') {
  const st = g.state;
  const t = st.tanks[player];
  const m = muzzlePoint({ x: t.x, y: t.y, tilt: t.tilt, angle });
  const v = muzzleVelocity(angle, power);
  const targets = new TankTargets();
  targets.refresh(st.tanks);
  const w = WEAPONS[weapon];
  return traceBallistic(st.terrain, targets, player, m.x, m.y, v.x, v.y, st.wind * 7.5 * w.windScale,
    st.gravity * w.gravityScale, 20, makeTraceResult());
}

test('hard CPU reliably hits a static target with no wind', () => {
  let hits = 0;
  const trials = 10;
  for (let i = 0; i < trials; i++) {
    const g = flatScenario({ kinds: ['human', 'human'], x0: 300 + i * 23, x1: 1250 + i * 47, seed: 10 + i, wind: 0 });
    onlyEmber(g, 0);
    const plan = planShot(g.state, 0, 'hard', new Rng(100 + i));
    assert.equal(plan.weapon, 'ember');
    g.setAngle(plan.angle);
    g.setPower(plan.power);
    g.fire();
    runUntil(g, () => g.state.phase !== 'flight', 15);
    if (g.state.tanks[1].hp < MAX_HP) hits++;
  }
  assert.ok(hits >= 9, `hits ${hits}/${trials}`);
});

test('hard CPU compensates for wind', () => {
  let hits = 0;
  for (let i = 0; i < 6; i++) {
    const g = flatScenario({ x0: 350, x1: 1400 + i * 30, seed: 20 + i, wind: i % 2 ? 7 : -6 });
    onlyEmber(g, 0);
    const plan = planShot(g.state, 0, 'hard', new Rng(7 + i));
    const r = impactOf(g, 0, plan.angle, plan.power);
    const c = tankCenter(g.state.tanks[1]);
    if (Math.hypot(r.x - c.x, r.y - c.y) < WEAPONS.ember.radius + TANK_HIT_RADIUS) hits++;
  }
  assert.ok(hits >= 5, `hits ${hits}/6`);
});

test('the CPU never plans a shot into its own blast', () => {
  for (let i = 0; i < 8; i++) {
    const g = flatScenario({ x0: 800, x1: 930 + i * 6, seed: 30 + i, wind: (i - 4) * 2 });
    const plan = planShot(g.state, 0, i % 2 ? 'easy' : 'normal', new Rng(i));
    if (WEAPONS[plan.weapon].instant) continue;
    const r = impactOf(g, 0, plan.angle, plan.power, plan.weapon);
    const me = tankCenter(g.state.tanks[0]);
    const d = Math.hypot(r.x - me.x, r.y - me.y);
    assert.ok(d > WEAPONS[plan.weapon].radius + TANK_HIT_RADIUS, `${plan.weapon} lands ${d.toFixed(0)} from itself`);
  }
});

test('planning stays fast', () => {
  const g = flatScenario({ x0: 300, x1: 1600, wind: 4 });
  // Rough terrain to make it work for it.
  for (let x = 500; x < 1500; x += 140) g.state.terrain.fillCircle(x, 700, 60 + (x % 3) * 20, () => 0xff3c5a7a);
  planShot(g.state, 0, 'hard', new Rng(1)); // warm-up (JIT)
  let worst = 0;
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    planShot(g.state, 0, (['easy', 'normal', 'hard'] as const)[i % 3], new Rng(i));
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 60, `planning took ${worst.toFixed(1)} ms`);
});

test('repairs when badly hurt, finishes a weak enemy, and varies weapons', () => {
  const g = flatScenario({ x0: 400, x1: 1400 });
  g.state.tanks[0].hp = 25;
  let repairs = 0;
  for (let i = 0; i < 10; i++) if (planShot(g.state, 0, 'hard', new Rng(i)).weapon === 'repair') repairs++;
  assert.ok(repairs >= 7, `repairs ${repairs}`);

  const g2 = flatScenario({ x0: 400, x1: 1400 });
  const used = new Set<WeaponId>();
  for (let i = 0; i < 24; i++) used.add(planShot(g2.state, 0, 'normal', new Rng(i * 13)).weapon);
  assert.ok(used.size >= 4, `variety ${[...used].join(',')}`);
});

test('gets past a towering wall: lobs over it, or picks a weapon that ignores cover, or drives', () => {
  const g = flatScenario({ x0: 300, x1: 760, wind: 0 });
  for (let x = 560; x < 640; x++) for (let y = 0; y < 700; y++) g.state.terrain.setPixel(x, y, 0xff3c5a7a);
  const special = new Set<WeaponId>(['burrower', 'seeker', 'sunbeam', 'tesla', 'aegis', 'repair']);
  const foe = tankCenter(g.state.tanks[1]);
  let ok = 0;
  for (let i = 0; i < 8; i++) {
    const plan = planShot(g.state, 0, 'hard', new Rng(i));
    if (special.has(plan.weapon) || plan.drive) { ok++; continue; }
    const r = impactOf(g, 0, plan.angle, plan.power, plan.weapon);
    if (Math.hypot(r.x - foe.x, r.y - foe.y) < WEAPONS[plan.weapon].radius + TANK_HIT_RADIUS) ok++;
  }
  assert.ok(ok >= 7, `blocked handling ${ok}/8`);
});

test('normal difficulty tightens its aim as it brackets', () => {
  const g = flatScenario({ x0: 400, x1: 1400 });
  onlyEmber(g, 0);
  const hard = planShot(g.state, 0, 'hard', new Rng(1));
  const spread = (shots: number): number => {
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      const p = planShot(g.state, 0, 'normal', new Rng(500 + i), { shots, lastMiss: 0 });
      sum += Math.abs(p.power - hard.power) + Math.abs(p.angle - hard.angle);
    }
    return sum / 40;
  };
  assert.ok(spread(4) < spread(0) * 0.75);
});

test('CPU turns animate the aim (thinking) before firing', () => {
  const g = flatScenario({ kinds: ['cpu', 'human'], difficulty: 'normal' });
  const evs: GameEvent[] = [];
  g.events.on(e => evs.push(e));
  const t = g.state.tanks[0];
  // The scenario skipped straight into the turn; restart thinking from a known aim.
  assert.equal(g.canControl(), false);
  assert.equal(g.state.cpuThinking, true);
  const angles: number[] = [];
  const time = runUntil(g, () => {
    angles.push(t.angle);
    return evs.some(e => e.type === 'fire');
  }, 8);
  assert.ok(time >= 0.9 && time < 4, `fired after ${time}`);
  assert.equal(g.state.cpuThinking, false);
  assert.ok(new Set(angles.map(a => Math.round(a))).size > 4, 'barrel sweeps smoothly');
});

test('easy CPU misses more than hard', () => {
  const dist = (difficulty: 'easy' | 'hard'): number => {
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const g = flatScenario({ x0: 400, x1: 1450, wind: 5 });
      onlyEmber(g, 0);
      const p = planShot(g.state, 0, difficulty, new Rng(i + 77));
      const r = impactOf(g, 0, p.angle, p.power);
      const c = tankCenter(g.state.tanks[1]);
      sum += Math.hypot(r.x - c.x, r.y - c.y);
    }
    return sum / 8;
  };
  assert.ok(dist('easy') > dist('hard') * 1.5);
});
