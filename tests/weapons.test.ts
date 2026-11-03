import test from 'node:test';
import assert from 'node:assert/strict';
import type { Game } from '../src/sim/game.ts';
import { flatScenario, runUntil } from '../src/sim/scenario.ts';
import type { GameEvent } from '../src/core/events.ts';
import { tankCenter } from '../src/core/geometry.ts';
import { MAX_HP } from '../src/core/constants.ts';
import { WEAPONS, type WeaponId } from '../src/core/weapons.ts';
import type { PlayerIndex } from '../src/core/types.ts';

type Ev = GameEvent;
const record = (g: Game): Ev[] => {
  const out: Ev[] = [];
  g.events.on(e => out.push(e));
  return out;
};
const of = <T extends Ev['type']>(evs: Ev[], type: T) => evs.filter(e => e.type === type) as Extract<Ev, { type: T }>[];
const internal = (g: Game): any => g as any;

/** Launches a projectile directly and enters the flight phase. */
function launch(g: Game, weapon: WeaponId, x: number, y: number, vx: number, vy: number, owner: PlayerIndex = 0, mode = 'ballistic') {
  const p = internal(g).spawnProjectile(weapon, owner, x, y, vx, vy, mode, false);
  internal(g).setPhase('flight');
  return p;
}
const flightDone = (g: Game) => () => g.state.projectiles.length === 0 && g.state.hazards.length === 0;
const solid = (g: Game, x0: number, y0: number, x1: number, y1: number): number => {
  let n = 0;
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) if (g.state.terrain.isSolid(x, y)) n++;
  return n;
};

test('ember: plain blast at the first contact', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'ember', 900, 500, 0, 100);
  runUntil(g, flightDone(g), 5);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].primary, true);
  assert.ok(Math.abs(ex[0].y - 700) <= 1.5);
  assert.equal(g.state.terrain.isSolid(900, 710), false);
});

test('owner immunity: own shell passes its tank for 0.15 s, then can hit it', () => {
  const g = flatScenario();
  const evs = record(g);
  const c = tankCenter(g.state.tanks[0]);
  launch(g, 'ember', c.x - 30, c.y, 400, 0);
  g.update(1 / 30);
  g.update(1 / 30);
  assert.equal(of(evs, 'explosion').length, 0);
  const g2 = flatScenario();
  const evs2 = record(g2);
  const p = launch(g2, 'ember', c.x - 30, c.y, 400, 0);
  p.age = 0.2;
  g2.update(1 / 30);
  assert.equal(of(evs2, 'damage')[0].target, 0);
  assert.equal(of(evs2, 'damage')[0].direct, true);
});

test('trident splits into 3 fragments at the apex with the specified spread', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'trident', 600, 600, 200, -300);
  runUntil(g, () => of(evs, 'split').length > 0, 3);
  const s = of(evs, 'split')[0];
  assert.equal(s.count, 3);
  const frags = g.state.projectiles.filter(p => p.fragment);
  assert.equal(frags.length, 3);
  const vxs = frags.map(p => p.vx).sort((a, b) => a - b);
  assert.ok(Math.abs(vxs[1] - vxs[0] - WEAPONS.trident.params.spread) < 1e-6);
  assert.ok(Math.abs(vxs[2] - vxs[1] - WEAPONS.trident.params.spread) < 1e-6);
  runUntil(g, flightDone(g), 6);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 3);
  assert.ok(ex.every(e => !e.primary && e.radius === WEAPONS.trident.radius));
});

test('starfall bursts into 9 small starlets', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'starfall', 600, 600, 150, -300);
  runUntil(g, flightDone(g), 8);
  assert.equal(of(evs, 'split')[0].count, 9);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 9);
  assert.ok(ex.every(e => e.kind === 'small' && !e.primary));
});

test('skipstone skips 3 times with small pops, then a full blast', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'skipper', 500, 600, 320, 120);
  runUntil(g, flightDone(g), 10);
  assert.equal(of(evs, 'bounce').length, 3);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 4);
  assert.deepEqual(ex.map(e => e.primary), [false, false, false, true]);
  assert.ok(ex.slice(0, 3).every(e => e.kind === 'small' && e.radius === 18));
  assert.ok(ex[3].x > ex[0].x);
});

test('ricochet reflects about the surface normal without a blast', () => {
  const g = flatScenario();
  const evs = record(g);
  const p = launch(g, 'ricochet', 900, 640, 300, 300);
  runUntil(g, () => of(evs, 'bounce').length > 0, 3);
  assert.equal(of(evs, 'explosion').length, 0);
  // Flat ground: vy flips, vx keeps sign, speed × restitution.
  assert.ok(p.vy < 0 && p.vx > 0);
  const speed = Math.hypot(p.vx, p.vy);
  const before = Math.hypot(300, 300 + 520 * 0.2);
  assert.ok(speed < before && speed > before * 0.7);
  assert.ok(Math.abs(Math.abs(p.vx / p.vy) - 1) < 0.35);
  runUntil(g, flightDone(g), 14);
  assert.equal(of(evs, 'bounce').length, 4);
  assert.equal(of(evs, 'explosion').length, 1);
});

test('burrower drills a tunnel and erupts underground', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'burrower', 900, 600, 0, 300);
  runUntil(g, flightDone(g), 5);
  const d = of(evs, 'drill');
  assert.deepEqual(d.map(e => e.phase), ['start', 'end']);
  const ex = of(evs, 'explosion')[0];
  assert.ok(ex.y > 700 + 150, `detonated at ${ex.y}`);
  // Tunnel: the shaft between the surface and the blast is open.
  assert.equal(g.state.terrain.isSolid(900, 760), false);
  assert.equal(g.state.terrain.isSolid(930, 760), true);
});

test('burrower pops out of a thin wall into open air and detonates', () => {
  const g = flatScenario();
  const evs = record(g);
  for (let x = 880; x < 920; x++) for (let y = 560; y < 700; y++) g.state.terrain.setPixel(x, y, 0xff3c5a7a);
  launch(g, 'burrower', 820, 640, 400, 0);
  runUntil(g, flightDone(g), 5);
  const ex = of(evs, 'explosion')[0];
  assert.ok(ex.x > 895 && ex.x < 930, `popped at ${ex.x}`);
});

test('seeker locks on at the apex and steers toward the enemy', () => {
  const g = flatScenario();
  const evs = record(g);
  // Ballistic flight would land far short of the enemy at x=1500.
  launch(g, 'seeker', 600, 600, 120, -500);
  runUntil(g, () => of(evs, 'lockOn').length > 0, 3);
  assert.equal(of(evs, 'lockOn')[0].target, 1);
  runUntil(g, flightDone(g), 14);
  const ex = of(evs, 'explosion')[0];
  const c = tankCenter(g.state.tanks[1]);
  assert.ok(Math.hypot(ex.x - c.x, ex.y - c.y) < 40, `seeker landed at ${ex.x},${ex.y}`);
  assert.ok(g.state.tanks[1].hp < MAX_HP);
});

test('magma: fire blast plus lava droplets that slide, burn and cool', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[1];
  launch(g, 'magma', t.x + 45, 600, 0, 200);
  runUntil(g, () => of(evs, 'explosion').length > 0, 3);
  assert.equal(of(evs, 'explosion')[0].kind, 'fire');
  assert.equal(of(evs, 'lava').filter(e => e.phase === 'spawn').length, 16);
  assert.equal(g.state.hazards.filter(h => h.kind === 'lava').length, 16);
  runUntil(g, flightDone(g), 10);
  const lavaDmg = of(evs, 'damage').filter(e => e.weapon === 'magma' && e.amount === 3);
  assert.ok(lavaDmg.length > 0, 'droplets burned the tank');
  assert.equal(of(evs, 'lava').filter(e => e.phase === 'cool').length > 0, true);
  assert.ok(of(evs, 'mound').some(e => e.radius === 3));
});

test('tesla arcs hit tanks in range even behind cover, 3 pulses', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[1];
  // A wall between impact and tank.
  g.state.terrain.fillCircle(t.x - 80, 700, 60, () => 0xff3c5a7a);
  launch(g, 'tesla', t.x - 170, 600, 0, 200);
  runUntil(g, flightDone(g), 5);
  const strikes = of(evs, 'lightning').filter(e => e.target === 1);
  assert.equal(strikes.length, 3);
  assert.equal(of(evs, 'damage').filter(e => e.weapon === 'tesla' && e.target === 1).length, 3);
  assert.ok(of(evs, 'lightning').filter(e => e.target === null).length >= 6);
  assert.equal(of(evs, 'lightning').filter(e => e.target === 0).length, 0);
});

test('singularity carves terrain, pulls tanks in, then collapses with a void blast', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[1];
  const x0 = t.x;
  const before = solid(g, t.x - 300, 600, t.x - 50, 800);
  launch(g, 'singularity', t.x - 170, 600, 0, 200);
  runUntil(g, flightDone(g), 6);
  assert.deepEqual(of(evs, 'singularity').map(e => e.phase), ['open', 'collapse']);
  assert.ok(solid(g, t.x - 300, 600, t.x - 50, 800) < before - 5000);
  assert.ok(t.x < x0 - 5, `pulled from ${x0} to ${t.x}`);
  const ex = of(evs, 'explosion');
  assert.equal(ex.at(-1)!.kind, 'void');
});

test('sunbeam marks, charges, fires a trench and damages tanks under it once', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[1];
  launch(g, 'sunbeam', t.x + 10, 600, 0, 200, 0, 'beacon');
  runUntil(g, flightDone(g), 6);
  assert.deepEqual(of(evs, 'beam').map(e => e.phase), ['mark', 'fire', 'end']);
  const hw = WEAPONS.sunbeam.params.halfWidth;
  const bx = of(evs, 'beam')[0].x;
  // Trench: open from the top to well below the old surface.
  for (let y = 0; y < 700 + 200; y += 20) assert.equal(g.state.terrain.isSolid(bx, y), false, `y=${y}`);
  assert.equal(g.state.terrain.isSolid(bx + hw + 20, 760), true);
  const dmg = of(evs, 'damage').filter(e => e.weapon === 'sunbeam');
  assert.equal(dmg.length, 1);
  assert.ok(dmg[0].amount >= 28);
});

test('earthmaker raises a mound about 0.9 × radius tall and deals no damage', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'earthmaker', 900, 600, 0, 200);
  runUntil(g, flightDone(g), 3);
  const r = WEAPONS.earthmaker.params.moundRadius;
  const top = g.state.terrain.heightAt(900);
  assert.ok(700 - top > r * 0.8, `mound height ${700 - top}`);
  assert.equal(of(evs, 'mound')[0].radius, r);
  assert.equal(of(evs, 'explosion')[0].kind, 'dirt');
  assert.equal(of(evs, 'damage').length, 0);
});

test('earthmaker never fills a tank hull', () => {
  const g = flatScenario();
  const t = g.state.tanks[1];
  launch(g, 'earthmaker', t.x, 600, 0, 200);
  runUntil(g, flightDone(g), 3);
  assert.equal(g.state.terrain.isSolid(t.x, t.y - 10), false);
});

test('faultline: impact blast plus 4 eruptions each side', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'faultline', 900, 600, 0, 200);
  runUntil(g, flightDone(g), 4);
  const q = of(evs, 'quake');
  assert.equal(q.length, 8);
  assert.deepEqual(q.map(e => e.step), [1, 1, 2, 2, 3, 3, 4, 4]);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 9);
  assert.equal(ex.filter(e => !e.primary).length, 8);
  assert.ok(q.some(e => Math.abs(e.x - (900 + 240)) < 2));
});

test('fireworks: blast plus 7 hued stars that pop after their fuse', () => {
  const g = flatScenario();
  const evs = record(g);
  launch(g, 'fireworks', 900, 600, 0, 200);
  runUntil(g, () => of(evs, 'split').length > 0, 3);
  assert.equal(of(evs, 'split')[0].count, 7);
  const stars = g.state.projectiles.filter(p => p.mode === 'star');
  assert.equal(stars.length, 7);
  assert.equal(new Set(stars.map(s => Math.round(s.data.hue))).size, 7);
  assert.ok(stars.every(s => s.vy < 0));
  runUntil(g, flightDone(g), 4);
  const ex = of(evs, 'explosion');
  assert.equal(ex.length, 8);
  assert.equal(ex.filter(e => e.kind === 'firework' && !e.primary).length, 7);
});

test('repair heals (capped), aegis shields (capped at 60), both use the turn', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[0];
  t.hp = 50;
  g.selectWeapon('repair');
  assert.equal(g.fire(), true);
  assert.equal(t.hp, 80);
  assert.equal(of(evs, 'heal')[0].amount, 30);
  assert.equal(of(evs, 'utility')[0].weapon, 'repair');
  assert.equal(g.state.phase, 'settle');
  assert.equal(t.ammo.repair, 0);
  runUntil(g, () => g.state.phase === 'aiming' && g.state.activePlayer === 1, 5);
  const t1 = g.state.tanks[1];
  t1.shield = 30;
  g.selectWeapon('aegis');
  g.fire();
  assert.equal(t1.shield, 60);
  assert.equal(of(evs, 'shieldUp')[0].amount, 60);
});

test('blink teleports the firing tank to the landing point; off-world fizzles', () => {
  const g = flatScenario();
  const evs = record(g);
  const t = g.state.tanks[0];
  launch(g, 'blink', 1000, 600, 0, 200, 0, 'beacon');
  runUntil(g, flightDone(g), 3);
  const tp = of(evs, 'teleport')[0];
  assert.ok(Math.abs(tp.toX - 1000) < 1);
  assert.equal(t.x, tp.toX);
  assert.equal(t.y, 700);
  assert.equal(of(evs, 'tankLanded').at(-1)!.player, 0);
  const g2 = flatScenario();
  const evs2 = record(g2);
  launch(g2, 'blink', 100, 600, -900, -100, 0, 'beacon');
  runUntil(g2, flightDone(g2), 5);
  assert.equal(of(evs2, 'fizzle').length, 1);
  assert.equal(of(evs2, 'teleport').length, 0);
});

test('projectiles collect crates they touch', () => {
  const g = flatScenario({ crates: true });
  const evs = record(g);
  const st = g.state;
  st.crates.push({ id: 999, x: 900, y: 700, vy: 0, weapon: 'tesla', amount: 1, landed: true, parachute: 0, sway: 0, age: 0 });
  const before = st.tanks[0].ammo.tesla;
  launch(g, 'ember', 900, 300, 0, 100);
  runUntil(g, flightDone(g), 4);
  assert.equal(st.tanks[0].ammo.tesla, before + 1);
  assert.equal(of(evs, 'crate').find(e => e.phase === 'collect')!.by, 0);
});

test('flight timeout force-resolves stuck flights', () => {
  const g = flatScenario();
  const p = launch(g, 'ember', 900, -100000, 0, -10);
  void p;
  runUntil(g, () => g.state.phase !== 'flight', 20);
  assert.notEqual(g.state.phase, 'flight');
});

test('every weapon fired normally resolves the turn', () => {
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const g = flatScenario({ seed: 3 });
    const t = g.state.tanks[0];
    t.ammo[id] = 1;
    g.selectWeapon(id);
    g.setAngle(55);
    g.setPower(72);
    assert.equal(g.fire(), true, id);
    runUntil(g, () => g.state.phase === 'aiming' || g.state.phase === 'roundOver', 25);
    assert.ok(g.state.phase === 'aiming' || g.state.phase === 'roundOver', `${id} stuck in ${g.state.phase}`);
    assert.equal(g.state.projectiles.length + g.state.hazards.length, 0, id);
  }
});
