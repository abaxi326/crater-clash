/**
 * CPU opponent. Plans with the real ballistics against the real terrain: a coarse angle × power grid,
 * bisection refinement on the landing error, side-tracking the best burrower/sunbeam shots, then a
 * situational weapon choice and difficulty-dependent aiming error. Deterministic given the Rng.
 * Planning cost is bounded by a trajectory budget (well under ~25 ms).
 */
import { TANK_HIT_RADIUS, WORLD_W } from '../core/constants.ts';
import { muzzlePoint, muzzleVelocity, tankCenter, turretPivot } from '../core/geometry.ts';
import { clamp, type Vec2 } from '../core/math.ts';
import type { Rng } from '../core/rng.ts';
import type { Difficulty, GameState, PlayerIndex, TankState } from '../core/types.ts';
import { WEAPONS, type WeaponDef, type WeaponId } from '../core/weapons.ts';
import {
  CONTACT_TANK, CONTACT_TERRAIN, MAX_TANK_X, MIN_TANK_X, TankTargets, gravityAccel, makeTraceResult,
  traceBallistic, windAccel, type TraceResult,
} from './physics.ts';
import type { Terrain } from './terrain.ts';

export interface ShotPlan {
  angle: number;
  power: number;
  weapon: WeaponId;
  /** Signed distance to drive before aiming (the game re-plans after driving). */
  drive?: number;
  /** Seconds the aim animation should take. */
  thinkTime: number;
}

/** Per-player memory across turns of a round (normal difficulty brackets in). */
export interface AiMemory {
  shots: number;
  lastMiss: number;
  /** Weapon fired last turn (variety). */
  lastWeapon?: WeaponId;
}

interface Skill {
  /** Fraction of the real wind the CPU accounts for. */
  wind: number;
  angleSigma: number;
  powerSigma: number;
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { wind: 0.35, angleSigma: 3.2, powerSigma: 4.6 },
  normal: { wind: 0.85, angleSigma: 1.9, powerSigma: 2.8 },
  hard: { wind: 1, angleSigma: 0.3, powerSigma: 0.45 },
};

/** Planning trace settings: coarser steps give the same parabola (exact integration). */
const PLAN_STEP = 1 / 60;
const PLAN_PX = 2;
const PLAN_MAX_TIME = 9;
const MAX_TRACES = 330;

const BIG = 1e6;

interface Sol {
  angle: number;
  power: number;
  ix: number;
  iy: number;
  miss: number;
  signed: number;
  direct: boolean;
  apexY: number;
}

const newSol = (): Sol => ({ angle: 0, power: 0, ix: 0, iy: 0, miss: BIG, signed: 0, direct: false, apexY: 0 });
const copySol = (dst: Sol, src: Sol): void => { Object.assign(dst, src); };

/** Shared planning context for one planShot call. */
class Planner {
  readonly targets = new TankTargets();
  readonly trace: TraceResult = makeTraceResult();
  readonly pose: { x: number; y: number; tilt: number; angle: number };
  readonly me: TankState;
  readonly foe: TankState;
  readonly meC: Vec2;
  readonly foeC: Vec2;
  readonly buried: boolean;
  traces = 0;
  // Side-tracked best shots for special weapons.
  readonly burrow = newSol();
  readonly beam = newSol();
  private readonly cur = newSol();

  readonly st: GameState;
  readonly player: PlayerIndex;
  readonly windK: number;

  constructor(st: GameState, player: PlayerIndex, windK: number) {
    this.st = st;
    this.player = player;
    this.windK = windK;
    this.me = st.tanks[player];
    this.foe = st.tanks[1 - player];
    this.targets.refresh(st.tanks);
    this.pose = { x: this.me.x, y: this.me.y, tilt: this.me.tilt, angle: this.me.angle };
    this.meC = tankCenter(this.me);
    this.foeC = tankCenter(this.foe);
    const piv = turretPivot(this.me);
    this.buried = st.terrain.solidCountInCircle(piv.x, piv.y - 6, 12) > 200;
  }

  get terrain(): Terrain { return this.st.terrain; }

  /** Moves the hypothetical firing position (drive evaluation). */
  setPose(x: number, y: number, tilt: number): void {
    this.pose.x = x; this.pose.y = y; this.pose.tilt = tilt;
    this.targets.cx[this.player] = x;
    this.targets.cy[this.player] = y - 12;
    this.meC.x = x; this.meC.y = y - 12;
  }

  /** Traces a shot; fills `cur` with its outcome against the foe. */
  shoot(w: WeaponDef, angle: number, power: number): Sol {
    this.traces++;
    const st = this.st;
    this.pose.angle = angle;
    const m = muzzlePoint(this.pose);
    const v = muzzleVelocity(angle, power);
    const ax = windAccel(w, st.wind * this.windK), ay = gravityAccel(w, st.gravity);
    const r = traceBallistic(st.terrain, this.targets, this.player, m.x, m.y, v.x, v.y, ax, ay,
      PLAN_MAX_TIME, this.trace, PLAN_STEP, PLAN_PX);
    const s = this.cur;
    s.angle = angle; s.power = power; s.ix = r.x; s.iy = r.y; s.apexY = r.apexY; s.direct = false;
    const fx = this.foeC.x, fy = this.foeC.y;
    if (r.kind === CONTACT_TANK && r.tank === 1 - this.player) {
      s.miss = 0; s.signed = 0; s.direct = true;
    } else if (r.kind === CONTACT_TANK) {
      s.miss = BIG; s.signed = 0; // own tank
    } else if (r.kind === CONTACT_TERRAIN) {
      s.miss = Math.hypot(r.x - fx, r.y - fy);
      s.signed = r.x - fx;
    } else {
      s.miss = 5000 + Math.abs(r.x - fx);
      s.signed = r.x - fx;
    }
    // Side bests: sunbeam lands its column; burrower drills on from the contact.
    if (r.kind !== 0 && !(r.kind === CONTACT_TANK && r.tank === this.player)) {
      const bm = s.direct ? 0 : Math.abs(r.x - fx);
      if (bm < this.beam.miss && this.safe(s, 30)) { copySol(this.beam, s); this.beam.miss = bm; }
      let dm = s.miss;
      if (r.kind === CONTACT_TERRAIN) dm = this.drillMiss(r, v.x + ax * r.time, v.y + ay * r.time);
      if (dm < this.burrow.miss) {
        const save = s.ix, savey = s.iy;
        if (this.safe(s, WEAPONS.burrower.radius)) { copySol(this.burrow, s); this.burrow.miss = dm; }
        s.ix = save; s.iy = savey;
      }
    }
    return s;
  }

  /** Where a burrower entering at the trace contact would detonate, as distance to the foe. */
  private drillMiss(r: TraceResult, vx: number, vy: number): number {
    const p = WEAPONS.burrower.params;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len, uy = vy / len;
    const t = this.terrain;
    let x = r.x, y = r.y, d = 0;
    const fx = this.foeC.x, fy = this.foeC.y, hr2 = TANK_HIT_RADIUS * TANK_HIT_RADIUS;
    while (d < p.drillDistance) {
      x += ux * 3; y += uy * 3; d += 3;
      if ((x - fx) ** 2 + (y - fy) ** 2 < hr2) return 0;
      if (y >= t.bedrockTop - p.tunnelRadius || x < 1 || x > WORLD_W - 1) break;
      if (d > 20 && !t.isSolid(x + ux * (p.tunnelRadius + 3), y + uy * (p.tunnelRadius + 3))) break;
    }
    return Math.hypot(x - fx, y - fy);
  }

  /** The impact keeps the CPU outside its own blast (unless buried, where anything goes). */
  safe(s: Sol, radius: number): boolean {
    if (this.buried) return true;
    if (s.miss >= BIG) return false;
    return Math.hypot(s.ix - this.meC.x, s.iy - this.meC.y) > radius + TANK_HIT_RADIUS + 14;
  }

  /**
   * Best shot for a weapon's ballistics: coarse grid over `angles`, then bisection on the signed
   * landing error around the best power for the best few angles.
   */
  solve(w: WeaponDef, angles: readonly number[], powerStep: number, refine: boolean, best: Sol): Sol {
    best.miss = BIG;
    const cand: Sol[] = [];
    for (const a of angles) {
      const row: Sol[] = [];
      for (let pw = 18; pw <= 100.001; pw += powerStep) {
        if (this.traces >= MAX_TRACES) break;
        const s = this.shoot(w, a, pw);
        const keep = newSol();
        copySol(keep, s);
        row.push(keep);
        if (this.safe(keep, w.radius) && keep.miss < best.miss) copySol(best, keep);
      }
      // Brackets where the landing error changes sign: refine later.
      for (let i = 1; i < row.length; i++) {
        const a0 = row[i - 1], a1 = row[i];
        if (a0.miss < 4000 && a1.miss < 6000 && Math.sign(a0.signed) !== Math.sign(a1.signed)) {
          cand.push(a0, a1);
        }
      }
    }
    if (!refine) return best;
    // Refine the most promising brackets (sorted by the better end's miss).
    const pairs: [Sol, Sol][] = [];
    for (let i = 0; i < cand.length; i += 2) pairs.push([cand[i], cand[i + 1]]);
    pairs.sort((p, q) => Math.min(p[0].miss, p[1].miss) - Math.min(q[0].miss, q[1].miss));
    for (let k = 0; k < Math.min(5, pairs.length); k++) {
      const lo = pairs[k][0];
      let lp = lo.power, hp = pairs[k][1].power, ls = lo.signed;
      for (let it = 0; it < 8 && this.traces < MAX_TRACES; it++) {
        const mp = (lp + hp) / 2;
        const s = this.shoot(w, lo.angle, mp);
        if (this.safe(s, w.radius) && s.miss < best.miss) copySol(best, s);
        if (s.direct) break;
        if (Math.sign(s.signed) === Math.sign(ls)) { lp = mp; ls = s.signed; } else { hp = mp; }
      }
    }
    return best;
  }
}

/** Expected damage of a blast landing `miss` from the target centre (blast model of DESIGN §4). */
function blastDamage(damage: number, radius: number, miss: number, direct: boolean): number {
  if (direct) return damage;
  const reach = radius + TANK_HIT_RADIUS;
  if (miss > reach) return 0;
  return damage * (0.25 + 0.75 * (1 - Math.max(0, miss - 6) / reach));
}

/** Weapons the CPU may fire as projectiles. */
const CPU_WEAPONS: readonly WeaponId[] = [
  'ember', 'thunderhead', 'trident', 'starfall', 'fireworks', 'skipper', 'ricochet', 'burrower',
  'seeker', 'magma', 'tesla', 'singularity', 'sunbeam', 'faultline',
];

interface Option { id: WeaponId; sol: Sol; exp: number }

/** Expected damage and self-safety of a weapon fired along `sol`. Returns -1 when unsafe. */
function expectedDamage(pl: Planner, id: WeaponId, sol: Sol): number {
  const w = WEAPONS[id];
  if (sol.miss >= 4000) return 0;
  if (!pl.safe(sol, w.radius)) return -1;
  const meX = pl.meC.x, foeX = pl.foeC.x;
  const dxFoe = Math.abs(sol.ix - foeX), dxMe = Math.abs(sol.ix - meX);
  const base = blastDamage(w.damage, w.radius, sol.miss, sol.direct);
  switch (id) {
    case 'trident': return base * 1.35;
    case 'starfall': return sol.miss < 170 ? 28 * (1 - sol.miss / 210) : 0;
    case 'skipper': case 'ricochet': return sol.direct ? w.damage : 0;
    case 'seeker': {
      const clearApex = sol.apexY < pl.foeC.y - 60 && sol.miss < 450;
      return clearApex ? w.damage * 0.75 : base * 0.5;
    }
    case 'magma': return base + (sol.miss < 100 ? 16 : 0);
    case 'tesla': {
      const r = w.params.arcRange;
      if (Math.hypot(sol.ix - pl.meC.x, sol.iy - pl.meC.y) < r + 15 && !pl.buried) return -1;
      return base + (Math.hypot(sol.ix - foeX, sol.iy - pl.foeC.y) < r - 10 ? w.params.pulses * w.params.arcDamage : 0);
    }
    case 'singularity': return blastDamage(w.damage, w.radius, Math.max(0, sol.miss - 12), sol.direct) * 1.05;
    case 'sunbeam': {
      const reach = w.params.halfWidth + 28;
      if (dxMe < reach + 12 && !pl.buried) return -1;
      return dxFoe < reach ? w.damage * (0.5 + 0.5 * Math.min(1, (reach - dxFoe) / 52)) : 0;
    }
    case 'faultline': {
      const sp = w.params.spacing, er = w.params.eruptionRadius + TANK_HIT_RADIUS;
      let quake = 0;
      for (let k = 1; k <= w.params.eruptions; k++) {
        if (Math.abs(dxMe - k * sp) < er + 8 && !pl.buried) return -1;
        if (Math.abs(dxFoe - k * sp) < er) quake = Math.max(quake, w.params.eruptionDamage * 0.8);
      }
      return base + quake;
    }
    case 'fireworks': return base + (sol.miss < 120 ? 15 : 0);
    default: return base;
  }
}

function angleList(dir: number, from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let a = from; a <= to + 1e-6; a += step) out.push(dir > 0 ? a : 180 - a);
  return out;
}

/**
 * Plans the CPU's shot for `player`. `memory` lets normal difficulty tighten its aim as it brackets;
 * allowDrive=false after the CPU already drove this turn.
 */
export function planShot(state: GameState, player: PlayerIndex, difficulty: Difficulty, rng: Rng,
  memory?: AiMemory, allowDrive = true): ShotPlan {
  const skill = SKILL[difficulty] ?? SKILL.normal;
  const me = state.tanks[player], foe = state.tanks[1 - player];
  const thinkTime = rng.range(0.9, 1.6);
  const keep: ShotPlan = { angle: me.angle, power: me.power, weapon: 'ember', thinkTime };
  if (!foe.alive || !me.alive) return keep;

  // Utilities first: patch up when hurt, raise a shield against a heavily armed opponent.
  if (me.ammo.repair > 0 && me.hp < 40 && me.maxHp - me.hp >= 20 && rng.chance(difficulty === 'easy' ? 0.55 : 0.9)) {
    return { ...keep, weapon: 'repair', thinkTime: 0.9 };
  }
  const heavy = foe.ammo.thunderhead + foe.ammo.singularity + foe.ammo.sunbeam + foe.ammo.burrower;
  if (me.ammo.aegis > 0 && me.shield === 0 && heavy > 0 && me.hp <= 85 && rng.chance(difficulty === 'hard' ? 0.45 : 0.25)) {
    return { ...keep, weapon: 'aegis', thinkTime: 0.9 };
  }

  const pl = new Planner(state, player, skill.wind);
  const dir = foe.x >= me.x ? 1 : -1;
  const emberSol = pl.solve(WEAPONS.ember, angleList(dir, 16, 88, 6), 8.2, true, newSol());

  const options: Option[] = [];
  for (const id of CPU_WEAPONS) {
    if (!(me.ammo[id] > 0)) continue;
    let sol = emberSol;
    if (id === 'burrower') sol = pl.burrow;
    else if (id === 'sunbeam') sol = pl.beam;
    else if (id === 'thunderhead' || id === 'singularity') {
      const a0 = emberSol.miss < BIG ? (dir > 0 ? emberSol.angle : 180 - emberSol.angle) : 45;
      sol = pl.solve(WEAPONS[id], angleList(dir, clamp(a0 - 9, 8, 80), clamp(a0 + 9, 16, 89), 3), 8.2, true, newSol());
    }
    const exp = expectedDamage(pl, id, sol);
    if (exp < 0) continue;
    options.push({ id, sol, exp });
  }

  let best: Option | null = null, bestScore = -Infinity, bestExp = 0;
  const foeHp = foe.hp + foe.shield;
  for (const o of options) {
    const w = WEAPONS[o.id];
    const limited = me.ammo[o.id] !== Infinity;
    // Value what the shot can actually take, spend scarce heavy ammo with some restraint, mix it up.
    let score = Math.min(o.exp, foeHp + 5) + rng.range(0, 22) * w.aiWeight - (limited ? w.damage * 0.3 + 2 : 0);
    if (memory?.lastWeapon === o.id && limited) score -= 8;
    if (o.exp >= foeHp) score += 30 + (limited ? 0 : 4); // finisher
    if (score > bestScore) { bestScore = score; best = o; }
    if (o.exp > bestExp) bestExp = o.exp;
  }

  // Blocked with nothing useful: consider driving to a better spot (normal/hard).
  if (allowDrive && difficulty !== 'easy' && bestExp < 8 && me.fuel > 30 && rng.chance(difficulty === 'hard' ? 0.9 : 0.6)) {
    const drive = bestDrive(pl, dir, emberSol);
    if (drive !== 0) return { ...keep, weapon: best ? best.id : 'ember', drive, thinkTime };
  }

  const choice = best ?? { id: 'ember' as WeaponId, sol: emberSol, exp: 0 };
  let angle = choice.sol.miss < BIG ? choice.sol.angle : (dir > 0 ? 50 : 130);
  let power = choice.sol.miss < BIG ? choice.sol.power : 65;

  // Aiming error (normal tightens with every shot this round), never into its own blast.
  const factor = difficulty === 'normal' ? Math.max(0.3, 1 - 0.22 * (memory?.shots ?? 0)) : 1;
  const check = new Planner(state, player, 1);
  const w = WEAPONS[choice.id];
  for (let k = 0; k < 4; k++) {
    const shrink = factor * (1 - k * 0.3);
    const a = clamp(angle + rng.gaussian() * skill.angleSigma * shrink, 0, 180);
    const p = clamp(power + rng.gaussian() * skill.powerSigma * shrink, 5, 100);
    const s = check.shoot(w, a, p);
    // Hard never lets its (small) jitter turn a hit into a graze off an obstacle.
    const ok = check.safe(s, w.radius) && (difficulty !== 'hard' || s.miss < Math.max(70, choice.sol.miss * 2 + 30));
    if (ok) { angle = a; power = p; break; }
  }
  if (memory) { memory.lastMiss = choice.sol.miss; memory.lastWeapon = choice.id; }
  return { angle: Math.round(angle * 10) / 10, power: Math.round(power * 10) / 10, weapon: choice.id, thinkTime };
}

/** Tries a short drive either way; returns the signed distance that improves the shot, or 0. */
function bestDrive(pl: Planner, dir: number, current: Sol): number {
  const t = pl.terrain;
  const me = pl.me;
  const reach = Math.min(me.fuel - 6, 110);
  const baseExp = blastDamage(WEAPONS.ember.damage, WEAPONS.ember.radius, current.miss, current.direct);
  let bestOff = 0, bestExp = baseExp + 6;
  const ox = me.x, oy = me.y, otilt = me.tilt;
  for (const off of [reach * dir, -reach * dir, reach * 0.5 * dir]) {
    const nx = clamp(ox + off, MIN_TANK_X, MAX_TANK_X);
    if (Math.abs(nx - ox) < 20) continue;
    const ny = t.heightAt(nx);
    if (Math.abs(ny - oy) > 70) continue;
    pl.setPose(nx, ny, 0);
    const s = pl.solve(WEAPONS.ember, angleList(dir, 20, 85, 13), 13, false, newSol());
    const exp = blastDamage(WEAPONS.ember.damage, WEAPONS.ember.radius, s.miss, s.direct);
    if (exp > bestExp) { bestExp = exp; bestOff = nx - ox; }
  }
  pl.setPose(ox, oy, otilt);
  return Math.round(bestOff);
}
