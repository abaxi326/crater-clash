/**
 * The simulation: match/round/turn flow, tanks, projectiles, hazards, crates and the CPU driver.
 * Deterministic (seeded Rng only) and DOM-free. Presentation reads `state` and listens to `events`.
 *
 * Events emitted (synchronously inside the call that causes them):
 * - matchStart     newMatch(), before the first roundStart.
 * - roundStart     newMatch()/nextRound() after the new terrain, tanks and ammo are in place
 *                  (tanks hang ~260 px above their pads; phase 'intro').
 * - tankLanded     a falling tank touches ground (intro drop: intro=true, no damage; collapse falls of
 *                  ≥ 3 px with fall damage beyond FALL_DAMAGE_THRESHOLD; blink teleports with distance 0).
 * - turnStart      after the intro and after every turnEnd pause, with the new wind.
 * - weaponSelect   selectWeapon/cycleWeapon (humans) or when a CPU picks its weapon before aiming.
 * - drive          driving starts (moving=true) or stops (released, blocked, out of fuel, firing).
 * - fire           a shot leaves the muzzle (also for instant utilities, at the muzzle point).
 * - utility        repair/aegis applied (right after 'fire'), followed by 'heal' or 'shieldUp'.
 * - split          trident/starfall at the apex, fireworks when its stars fly out.
 * - bounce         every skipstone skip and ricochet rebound.
 * - drill          burrower starts / stops tunnelling ('end' precedes its explosion).
 * - lockOn         seeker starts homing at the apex.
 * - explosion      every blast, before its damage events (primary=false for bounce pops, fragments,
 *                  starlets, firework stars and faultline eruptions). Earthmaker emits kind 'dirt' (no
 *                  damage); sunbeam emits kind 'beam' when the beam fires.
 * - mound          earthmaker heap raised; cooled lava blobs (radius 3).
 * - damage         every damage instance: amount = HP lost, absorbed = shield points used, x/y = tank centre.
 * - heal           repair. shieldUp: aegis (amount = shield total). shieldBreak: shield depleted by a hit.
 * - tankDestroyed  HP reached 0 (after its damage event).
 * - lightning      tesla pulses: one per tank in range (target set) plus 2–3 ground arcs (target null).
 * - singularity    'open' on impact, 'collapse' right before its void blast.
 * - beam           sunbeam 'mark' when the beacon plants, 'fire' after chargeTime, 'end' when done.
 * - lava           'spawn' per droplet, 'cool' when it hardens.
 * - quake          each faultline eruption (both sides share the step number), before its blast.
 * - teleport       blink beacon landed (followed by tankLanded).
 * - fizzle         blink beacon off-world / hit a tank; any projectile reaching PROJECTILE_MAX_AGE or
 *                  removed by the flight timeout.
 * - crate          'spawn' at turnEnd, 'land' on every touchdown, 'collect' by blast/projectile/tank.
 * - dirtFall       while terrain collapses, at most 8 per second (x range = recent terrain edits).
 * - outOfBounds    a projectile left the world sideways/below.
 * - turnEnd        everything settled and both tanks alive.
 * - roundOver      ROUND_OVER_DELAY after a tank died and everything settled.
 * - matchOver      right after roundOver when someone reached roundsToWin (never in attract mode).
 */
import type { GameApi } from '../contracts.ts';
import { BIOMES, BIOME_IDS, type BiomeId } from '../core/biomes.ts';
import {
  ATTRACT_NEXT_ROUND_DELAY, CRATE_CHANCE_PER_TURN, CRATE_FALL_SPEED, CRATE_SIZE, DRIVE_SPEED,
  FALL_DAMAGE_MAX, FALL_DAMAGE_PER_PX, FALL_DAMAGE_THRESHOLD, FUEL_PER_ROUND, GRAVITY, INTRO_TIME,
  MAX_CRATES, MAX_HP, MAX_SUBSTEP, MAX_WIND, ROUND_OVER_DELAY, SETTLE_MIN_TIME, TANK_HALF_WIDTH,
  TANK_HIT_RADIUS, TANK_HULL_HEIGHT, TURN_END_TIME, WORLD_H, WORLD_W,
} from '../core/constants.ts';
import { EventBus, type GameEvent } from '../core/events.ts';
import { muzzlePoint, muzzleVelocity, tankCenter } from '../core/geometry.ts';
import { clamp, damp, easeOutBack, type Vec2 } from '../core/math.ts';
import { Rng, hashInt } from '../core/rng.ts';
import type {
  CrateState, GameState, HazardKind, HazardState, MatchConfig, PlayerIndex, ProjectileState, TankState,
} from '../core/types.ts';
import {
  CRATE_WEAPONS, WEAPONS, WEAPON_ORDER, startingAmmo, type ExplosionKind, type WeaponId,
} from '../core/weapons.ts';
import { planShot, type AiMemory, type ShotPlan } from './ai.ts';
import {
  MAX_TANK_X, MIN_TANK_X, SUPPORT_CENTER, SUPPORT_LEFT, SUPPORT_RIGHT, TankTargets, gravityAccel, groundTilt,
  makeTraceResult, supportMask,
  surfaceStep, traceBallistic, treadRest, treadSlope, windAccel,
} from './physics.ts';
import { Terrain, type PixelPainter, type Rect } from './terrain.ts';
import { generateTerrain, makeBasaltPainter, makeDirtPainter } from './terrainGen.ts';
import { applyUtility, finishHazard, isDead, updateHazard, updateProjectile, type SimCtx } from './weapons.ts';

/** Height above the spawn pad from which tanks drop in. */
const INTRO_DROP = 260;
/** Global safety net: a flight phase never lasts longer than this. */
const FLIGHT_TIMEOUT = 15;
/** Settle never waits longer than this (forces collapse to finish). */
const SETTLE_TIMEOUT = 9;
const MAX_PROJECTILES = 64;
const MAX_HAZARDS = 64;
const MAX_LAVA = 48;
/** Falls shorter than this are treated as re-seating (no tankLanded event). */
const MIN_LANDING_EVENT = 3;
/** Sideways slip speed of a tank teetering on a ledge (px/s). */
const TIP_SPEED = 80;
const RECOIL_TIME = 0.5;
const HIT_FLASH_TIME = 0.4;
const DIRT_EVENT_INTERVAL = 0.125;
const PATH_SPACING = 10;
const GUIDE_SPACING = 8;

const DEFAULT_CONFIG: MatchConfig = {
  players: [
    { name: 'Azure', kind: 'cpu', difficulty: 'normal' },
    { name: 'Blaze', kind: 'cpu', difficulty: 'normal' },
  ],
  biome: 'verdant',
  roundsToWin: 3,
  crates: true,
  seed: 20240,
  attract: true,
};

/** CPU turn driver stages. */
const CPU_PLAN = 0, CPU_DRIVE = 1, CPU_AIM = 2, CPU_HOLD = 3, CPU_DONE = 4;

interface CpuTurn {
  stage: number;
  t: number;
  plan: ShotPlan | null;
  a0: number;
  p0: number;
  driveTarget: number;
  drove: boolean;
}

function makeTank(index: PlayerIndex): TankState {
  return {
    index, x: 0, y: 0, vy: 0, airborne: true, fallStartY: 0, tilt: 0,
    angle: index === 0 ? 45 : 135, power: 60, hp: MAX_HP, maxHp: MAX_HP, shield: 0,
    fuel: FUEL_PER_ROUND, alive: true, weapon: 'ember', ammo: startingAmmo(),
    moveDir: 0, treadPhase: 0, recoil: 0, hitFlash: 0, stats: { shots: 0, hits: 0, damageDealt: 0 },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export class Game implements GameApi {
  readonly events = new EventBus();
  readonly state: GameState;

  private rng = new Rng(1);
  private aiRng = new Rng(2);
  private readonly targets = new TankTargets();
  private dirtPainter: PixelPainter = () => 0;
  private basaltPainter: PixelPainter = () => 0;
  private startPlayer: PlayerIndex = 0;
  private prevBiome: BiomeId | null = null;
  private moveIntent: -1 | 0 | 1 = 0;
  private deathTimer = 0;
  private anyDeath = false;
  private dirtTimer = 0;
  private dirtMoved = 0;
  private dirtX0 = WORLD_W;
  private dirtX1 = 0;
  private hitThisShot: [boolean, boolean] = [false, false];
  private cpu: CpuTurn = { stage: CPU_DONE, t: 0, plan: null, a0: 0, p0: 0, driveTarget: 0, drove: false };
  private readonly memory: [AiMemory, AiMemory] = [{ shots: 0, lastMiss: 0 }, { shots: 0, lastMiss: 0 }];
  // Shot path recording (lastShotPath).
  private readonly paths: [Vec2[], Vec2[]] = [[], []];
  private trackId = -1;
  private trackAcc = 0;
  private trackX = 0;
  private trackY = 0;
  // Aim guide scratch (reused every frame).
  private readonly guidePool: Vec2[] = [];
  private readonly guideOut: Vec2[] = [];
  private guideLen = 0;
  private guideMax = 0;
  private guideX = 0;
  private guideY = 0;
  private guideAcc = 0;
  private readonly guideTrace = makeTraceResult();
  private readonly ctx: SimCtx;

  constructor() {
    const terrain = new Terrain(WORLD_W, WORLD_H);
    this.state = {
      config: DEFAULT_CONFIG, phase: 'intro', phaseTime: 0, paused: false, round: 1, turn: 0,
      activePlayer: 0, wins: [0, 0], biome: 'verdant', seed: 0, wind: 0, gravity: GRAVITY, terrain,
      tanks: [makeTank(0), makeTank(1)], projectiles: [], hazards: [], crates: [],
      roundWinner: null, matchWinner: null, cpuThinking: false, nextId: 1,
    };
    const self = this;
    this.ctx = {
      get state() { return self.state; },
      get rng() { return self.rng; },
      emit: e => this.emit(e),
      blast: (x, y, r, d, w, k, o, p, dt, c) => this.blast(x, y, r, d, w, k, o, p, dt, c),
      damageTank: (t, a, w, d, b, x, y) => this.damageTank(t, a, w, d, b, x, y),
      spawnProjectile: (w, o, x, y, vx, vy, m, f) => this.spawnProjectile(w, o, x, y, vx, vy, m, f),
      spawnHazard: (k, w, o, x, y, l, r) => this.spawnHazard(k, w, o, x, y, l, r),
      teleport: (p, x) => this.teleport(p, x),
      pushTank: (p, dx) => this.pushTank(p, dx),
      raiseMound: (x, r, h) => this.raiseMound(x, r, h),
      fillBasalt: (x, y, r) => this.fillBasalt(x, y, r),
      collectCratesRect: (x0, y0, x1, y1, o) => this.collectCratesRect(x0, y0, x1, y1, o),
      lavaTaken: [0, 0],
    };
    // A valid idle placeholder (attract-style) so renderers can read state before newMatch().
    this.newMatch(DEFAULT_CONFIG);
  }

  // =====================================================================================
  // Match / round flow
  // =====================================================================================

  newMatch(config: MatchConfig): void {
    const st = this.state;
    st.config = {
      ...config,
      players: [{ ...config.players[0] }, { ...config.players[1] }],
      roundsToWin: Math.max(1, Math.floor(config.roundsToWin) || 1),
      seed: Math.floor(config.seed) >>> 0,
    };
    st.wins = [0, 0];
    st.matchWinner = null;
    st.roundWinner = null;
    st.round = 1;
    st.paused = false;
    this.startPlayer = 0;
    this.prevBiome = null;
    for (const t of st.tanks) t.stats = { shots: 0, hits: 0, damageDealt: 0 };
    this.emit({ type: 'matchStart', config: st.config });
    this.startRound();
  }

  nextRound(): void {
    if (this.state.phase !== 'roundOver') return;
    this.state.round++;
    this.startRound();
  }

  private startRound(): void {
    const st = this.state;
    const cfg = st.config;
    const seed = hashInt(cfg.seed + st.round * 7919);
    let biome: BiomeId;
    if (cfg.biome === 'random') {
      let i = seed % BIOME_IDS.length;
      if (BIOME_IDS[i] === this.prevBiome) i = (i + 1 + (hashInt(seed ^ 0x3f) % (BIOME_IDS.length - 1))) % BIOME_IDS.length;
      biome = BIOME_IDS[i];
    } else {
      biome = BIOMES[cfg.biome] ? cfg.biome : 'verdant';
    }
    this.prevBiome = biome;
    const def = BIOMES[biome];
    const gen = generateTerrain(def, seed);
    st.terrain = gen.terrain;
    st.biome = biome;
    st.seed = seed;
    st.gravity = GRAVITY * def.gravityScale;
    st.wind = 0;
    st.turn = 0;
    st.phase = 'intro';
    st.phaseTime = 0;
    st.activePlayer = this.startPlayer;
    st.roundWinner = null;
    st.cpuThinking = false;
    st.projectiles.length = 0;
    st.hazards.length = 0;
    st.crates.length = 0;
    this.rng = new Rng(hashInt(seed ^ 0x5eed));
    this.aiRng = new Rng(hashInt(seed ^ 0xa11ce));
    this.dirtPainter = makeDirtPainter(def, seed);
    this.basaltPainter = makeBasaltPainter(seed);
    this.moveIntent = 0;
    this.deathTimer = 0;
    this.anyDeath = false;
    this.dirtTimer = 0;
    this.dirtMoved = 0;
    this.dirtX0 = WORLD_W;
    this.dirtX1 = 0;
    this.cpu.stage = CPU_DONE;
    this.trackId = -1;
    for (let i = 0; i < 2; i++) {
      const t = st.tanks[i];
      const x = gen.spawns[i];
      const ground = st.terrain.heightAt(x);
      t.x = x;
      t.y = ground - INTRO_DROP;
      t.vy = 0;
      t.airborne = true;
      t.fallStartY = t.y;
      t.tilt = 0;
      t.angle = i === 0 ? 45 : 135;
      t.power = 60;
      t.hp = t.maxHp = MAX_HP;
      t.shield = 0;
      t.fuel = FUEL_PER_ROUND;
      t.alive = true;
      t.weapon = 'ember';
      t.ammo = startingAmmo();
      t.moveDir = 0;
      t.treadPhase = 0;
      t.recoil = 0;
      t.hitFlash = 0;
      this.paths[i].length = 0;
      this.memory[i].shots = 0;
      this.memory[i].lastMiss = 0;
    }
    this.emit({ type: 'roundStart', round: st.round, biome, seed });
  }

  private setPhase(phase: GameState['phase']): void {
    this.state.phase = phase;
    this.state.phaseTime = 0;
  }

  private isCpu(player: PlayerIndex): boolean {
    const cfg = this.state.config;
    return cfg.attract || cfg.players[player].kind === 'cpu';
  }

  private beginTurn(player: PlayerIndex): void {
    const st = this.state;
    const def = BIOMES[st.biome];
    const previousWind = st.wind;
    if (st.turn === 0) {
      st.wind = round1(clamp(this.rng.range(-MAX_WIND, MAX_WIND) * def.windScale, -MAX_WIND, MAX_WIND));
    } else {
      st.wind = round1(clamp(st.wind + this.rng.range(-3, 3) * def.windScale, -MAX_WIND, MAX_WIND));
    }
    if (st.wind === 0) st.wind = 0; // no negative zero
    st.turn++;
    st.activePlayer = player;
    this.setPhase('aiming');
    this.moveIntent = 0;
    const t = st.tanks[player];
    if (!(t.ammo[t.weapon] > 0)) t.weapon = 'ember';
    this.hitThisShot[0] = this.hitThisShot[1] = false;
    const cpu = this.isCpu(player);
    st.cpuThinking = cpu;
    this.cpu.stage = cpu ? CPU_PLAN : CPU_DONE;
    this.cpu.drove = false;
    this.cpu.t = 0;
    this.emit({ type: 'turnStart', player, turn: st.turn, wind: st.wind, previousWind });
  }

  private endRound(): void {
    const st = this.state;
    const a0 = st.tanks[0].alive, a1 = st.tanks[1].alive;
    const winner: PlayerIndex | null = a0 && !a1 ? 0 : a1 && !a0 ? 1 : null;
    if (winner !== null) st.wins[winner]++;
    st.roundWinner = winner;
    this.startPlayer = winner === null ? 0 : ((1 - winner) as PlayerIndex);
    st.cpuThinking = false;
    this.setPhase('roundOver');
    this.emit({ type: 'roundOver', winner, round: st.round });
    if (!st.config.attract && winner !== null && st.wins[winner] >= st.config.roundsToWin) {
      st.matchWinner = winner;
      this.setPhase('matchOver');
      this.emit({ type: 'matchOver', winner });
    }
  }

  private emit(e: GameEvent): void {
    this.events.emit(e);
  }

  // =====================================================================================
  // Update loop
  // =====================================================================================

  update(dt: number): void {
    const st = this.state;
    if (st.paused || !(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    st.phaseTime += dt;
    if (st.phase === 'aiming' && st.cpuThinking) this.cpuUpdate(dt);

    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);

    // Collapsing ground (once per update) and its throttled dirtFall events.
    const moved = st.terrain.settle(dt);
    this.dirtMoved += moved;
    this.dirtTimer += dt;
    if (this.dirtMoved > 0 && this.dirtTimer >= DIRT_EVENT_INTERVAL) {
      const x0 = Math.max(0, Math.min(this.dirtX0, this.dirtX1)), x1 = Math.min(WORLD_W, Math.max(this.dirtX0, this.dirtX1));
      this.emit({ type: 'dirtFall', x0, x1, amount: this.dirtMoved });
      this.dirtMoved = 0;
      this.dirtTimer = 0;
    }
    if (!st.terrain.settling && moved === 0) {
      this.dirtX0 = WORLD_W;
      this.dirtX1 = 0;
    }

    // Animation drivers.
    for (let i = 0; i < 2; i++) {
      const t = st.tanks[i];
      t.recoil = Math.max(0, t.recoil - dt / RECOIL_TIME);
      t.hitFlash = Math.max(0, t.hitFlash - dt / HIT_FLASH_TIME);
      const target = t.airborne ? t.tilt * 0.6 : groundTilt(st.terrain, t.x, t.y);
      t.tilt = damp(t.tilt, target, t.airborne ? 3 : 11, dt);
    }
    if (this.anyDeath) this.deathTimer += dt;
    this.phaseLogic();
  }

  private phaseLogic(): void {
    const st = this.state;
    // A tank can also die outside a shot (e.g. a late fall): wrap the turn up through settle.
    if (this.anyDeath && (st.phase === 'aiming' || st.phase === 'turnEnd')) {
      this.moveIntent = 0;
      for (const t of st.tanks) if (t.moveDir !== 0) this.setMoveDir(t, 0);
      st.cpuThinking = false;
      this.cpu.stage = CPU_DONE;
      this.setPhase('settle');
    }
    switch (st.phase) {
      case 'intro':
        if (st.phaseTime >= INTRO_TIME && !st.tanks[0].airborne && !st.tanks[1].airborne) this.beginTurn(st.activePlayer);
        else if (st.phaseTime >= INTRO_TIME + 4) { this.forceGround(); this.beginTurn(st.activePlayer); }
        break;
      case 'flight':
        if (st.projectiles.length === 0 && st.hazards.length === 0) this.setPhase('settle');
        else if (st.phaseTime >= FLIGHT_TIMEOUT) this.forceResolve();
        break;
      case 'settle': {
        let quiet = !st.terrain.settling && !st.tanks[0].airborne && !st.tanks[1].airborne;
        if (quiet) for (const c of st.crates) if (!c.landed && c.parachute <= 0) { quiet = false; break; }
        if (!quiet && st.phaseTime >= SETTLE_TIMEOUT) { this.forceGround(); quiet = true; }
        if (!quiet || st.phaseTime < SETTLE_MIN_TIME) break;
        if (this.anyDeath) {
          if (this.deathTimer >= ROUND_OVER_DELAY) this.endRound();
        } else {
          this.setPhase('turnEnd');
          this.emit({ type: 'turnEnd', player: st.activePlayer });
          this.maybeSpawnCrate();
        }
        break;
      }
      case 'turnEnd':
        if (st.phaseTime >= TURN_END_TIME) this.beginTurn((1 - st.activePlayer) as PlayerIndex);
        break;
      case 'roundOver':
        if (st.config.attract && st.phaseTime >= ATTRACT_NEXT_ROUND_DELAY) this.nextRound();
        break;
      default:
        break;
    }
  }

  /** Flight timeout: resolve everything still in the air right now. */
  private forceResolve(): void {
    const st = this.state;
    for (const p of st.projectiles) {
      if (isDead(p)) continue;
      p.data.dead = 1;
      this.emit({ type: 'fizzle', weapon: p.weapon, x: p.x, y: p.y });
    }
    for (let i = 0; i < st.hazards.length; i++) finishHazard(this.ctx, st.hazards[i]);
    st.projectiles.length = 0;
    st.hazards.length = 0;
    this.setPhase('settle');
  }

  /** Settle timeout / stuck intro: finish collapsing and put every tank on the ground. */
  private forceGround(): void {
    const st = this.state;
    st.terrain.settleAll();
    for (const t of st.tanks) {
      if (!t.airborne) continue;
      const rest = treadRest(st.terrain, t.x, t.y, treadSlope(t.tilt));
      this.land(t, Math.min(rest, st.terrain.bedrockTop));
    }
    for (const c of st.crates) {
      if (c.landed || c.parachute > 0) continue; // parachuting crates drift down on their own
      c.y = Math.min(st.terrain.surfaceY(c.x, Math.max(0, c.y)), st.terrain.bedrockTop);
      c.landed = true;
      c.vy = 0;
    }
  }

  private substep(h: number): void {
    const st = this.state;
    for (let i = 0; i < 2; i++) this.tankStep(st.tanks[i], h, st.phase === 'aiming' && i === st.activePlayer);

    if (st.projectiles.length) {
      this.targets.refresh(st.tanks);
      const n0 = st.projectiles.length;
      for (let i = 0; i < n0; i++) {
        const p = st.projectiles[i];
        updateProjectile(this.ctx, p, h, this.targets);
        if (st.crates.length) this.projectileCrates(p);
        if (p.id === this.trackId) this.trackPath(p);
      }
      compact(st.projectiles);
    }
    if (st.hazards.length) {
      const n0 = st.hazards.length;
      for (let i = 0; i < n0; i++) updateHazard(this.ctx, st.hazards[i], h);
      compact(st.hazards);
    }
    if (st.crates.length) this.crateStep(h);
  }

  // =====================================================================================
  // Tanks
  // =====================================================================================

  private tankStep(t: TankState, h: number, active: boolean): void {
    const terrain = this.state.terrain;
    const slope = treadSlope(t.tilt);
    if (t.airborne) {
      const g = this.state.gravity;
      const ny = t.y + t.vy * h + 0.5 * g * h * h;
      t.vy += g * h;
      const rest = treadRest(terrain, t.x, t.y, slope);
      if (rest <= ny) this.land(t, Math.max(t.y, rest));
      else t.y = ny;
      if (t.y > terrain.bedrockTop) this.land(t, terrain.bedrockTop);
      return;
    }
    // Driving.
    let dir: -1 | 0 | 1 = 0;
    if (active && this.moveIntent !== 0 && t.alive && t.fuel > 0) {
      const dx = this.moveIntent * Math.min(DRIVE_SPEED * h, t.fuel);
      const ny = surfaceStep(terrain, t.x, t.y, dx, slope);
      if (ny === ny) {
        t.x += dx;
        if (ny <= t.y + 2.5) t.y = ny;
        t.fuel = Math.max(0, t.fuel - Math.abs(dx));
        t.treadPhase += dx;
        dir = this.moveIntent;
        this.collectCratesByTank(t);
      }
    }
    if (dir !== t.moveDir) this.setMoveDir(t, dir);
    // Re-seat on ground that rose a little (piled dirt, tilt change); never climb out of burial.
    const seat = treadRest(terrain, t.x, t.y - 4, slope);
    if (seat < t.y && seat > t.y - 4 + 0.5) t.y = seat;
    const support = supportMask(terrain, t.x, t.y, slope);
    if (support === 0) {
      t.airborne = true;
      t.vy = 0;
      t.fallStartY = t.y;
    } else if (dir === 0 && !(support & SUPPORT_CENTER) && support !== (SUPPORT_LEFT | SUPPORT_RIGHT)) {
      // Centre of mass over a drop with ground on one side only: teeter and slide off the ledge.
      const nx = clamp(t.x + (support & SUPPORT_LEFT ? 1 : -1) * TIP_SPEED * h, MIN_TANK_X, MAX_TANK_X);
      if (nx !== t.x) {
        t.x = nx;
        this.collectCratesByTank(t);
      }
    }
  }

  private setMoveDir(t: TankState, dir: -1 | 0 | 1): void {
    const was = t.moveDir !== 0;
    t.moveDir = dir;
    if (was !== (dir !== 0)) this.emit({ type: 'drive', player: t.index, moving: dir !== 0 });
  }

  private land(t: TankState, y: number): void {
    const intro = this.state.phase === 'intro';
    t.y = y;
    t.vy = 0;
    t.airborne = false;
    const fall = Math.max(0, y - t.fallStartY);
    if (!intro && fall < MIN_LANDING_EVENT) return;
    let damage = 0;
    if (!intro && t.alive && fall > FALL_DAMAGE_THRESHOLD) {
      damage = Math.min(FALL_DAMAGE_MAX, Math.round((fall - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_PER_PX));
    }
    this.emit({ type: 'tankLanded', player: t.index, x: t.x, y, fallDistance: fall, damage, intro });
    if (damage > 0) this.damageTank(t.index, damage, 'fall', false, null, t.x, t.y);
  }

  private pushTank(player: PlayerIndex, dx: number): void {
    const t = this.state.tanks[player];
    if (t.airborne || !t.alive) return;
    const ny = surfaceStep(this.state.terrain, t.x, t.y, dx, treadSlope(t.tilt));
    if (ny !== ny) return;
    t.x += dx;
    if (ny <= t.y + 2.5) t.y = ny;
  }

  private teleport(player: PlayerIndex, tx: number): void {
    const st = this.state;
    const t = st.tanks[player], other = st.tanks[1 - player];
    let x = clamp(tx, MIN_TANK_X, MAX_TANK_X);
    const gap = TANK_HALF_WIDTH * 2 + 6;
    if (other.alive && Math.abs(x - other.x) < gap) {
      const side = x >= other.x ? 1 : -1;
      x = other.x + side * gap;
      if (x < MIN_TANK_X || x > MAX_TANK_X) x = other.x - side * gap;
      x = clamp(x, MIN_TANK_X, MAX_TANK_X);
    }
    const fromX = t.x, fromY = t.y;
    const y = Math.min(treadRest(st.terrain, x, 0, 0), st.terrain.bedrockTop);
    t.x = x;
    t.y = y;
    t.vy = 0;
    t.airborne = false;
    t.fallStartY = y;
    t.tilt = groundTilt(st.terrain, x, y);
    this.emit({ type: 'teleport', player, fromX, fromY, toX: x, toY: y });
    this.emit({ type: 'tankLanded', player, x, y, fallDistance: 0, damage: 0, intro: false });
    this.collectCratesByTank(t);
  }

  // =====================================================================================
  // Combat
  // =====================================================================================

  private blast(x: number, y: number, radius: number, damage: number, weapon: WeaponId, kind: ExplosionKind,
    owner: PlayerIndex, primary: boolean, directTarget: number, carve = true): void {
    const st = this.state;
    this.emit({ type: 'explosion', weapon, kind, x, y, radius, owner, primary });
    if (carve && radius > 0) {
      st.terrain.carveCircle(x, y, radius, 1);
      this.noteEdit(x - radius, x + radius);
    }
    if (damage > 0) {
      for (let i = 0; i < 2; i++) {
        const t = st.tanks[i];
        if (!t.alive) continue;
        if (i === directTarget) {
          this.damageTank(i as PlayerIndex, damage, weapon, true, owner, x, y);
          continue;
        }
        const c = tankCenter(t);
        const d = Math.hypot(c.x - x, c.y - y);
        const reach = radius + TANK_HIT_RADIUS;
        if (d > reach) continue;
        const dmg = Math.round(damage * (0.25 + 0.75 * (1 - Math.max(0, d - 6) / reach)));
        if (dmg > 0) this.damageTank(i as PlayerIndex, dmg, weapon, false, owner, x, y);
      }
    }
    if (st.crates.length) {
      for (const c of st.crates) {
        if (Math.hypot(c.x - x, c.y - CRATE_SIZE / 2 - y) < radius + CRATE_SIZE) this.collectCrate(c, owner);
      }
      compactCrates(st.crates);
    }
  }

  private damageTank(target: PlayerIndex, amount: number, weapon: WeaponId | 'fall', direct: boolean,
    by: PlayerIndex | null, _x: number, _y: number): void {
    const st = this.state;
    const t = st.tanks[target];
    if (!t.alive || !(amount > 0)) return;
    const absorbed = Math.min(t.shield, amount);
    const hadShield = t.shield > 0;
    t.shield -= absorbed;
    const loss = Math.min(t.hp, amount - absorbed);
    t.hp -= loss;
    t.hitFlash = 1;
    const c = tankCenter(t);
    if (hadShield && t.shield <= 0) {
      t.shield = 0;
      this.emit({ type: 'shieldBreak', target, x: c.x, y: c.y });
    }
    this.emit({ type: 'damage', target, amount: loss, absorbed, x: c.x, y: c.y, weapon, direct, hpAfter: t.hp, by });
    if (by !== null && by !== target) {
      const s = st.tanks[by].stats;
      s.damageDealt += loss + absorbed;
      if (!this.hitThisShot[target]) { this.hitThisShot[target] = true; s.hits++; }
    }
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.shield = 0;
      if (t.moveDir !== 0) this.setMoveDir(t, 0);
      if (!this.anyDeath) { this.anyDeath = true; this.deathTimer = 0; }
      this.emit({ type: 'tankDestroyed', target, x: c.x, y: c.y, by });
    }
  }

  private spawnProjectile(weapon: WeaponId, owner: PlayerIndex, x: number, y: number, vx: number, vy: number,
    mode: string, fragment: boolean): ProjectileState {
    const st = this.state;
    const p: ProjectileState = {
      id: st.nextId++, weapon, owner, x, y, vx, vy, age: 0, mode, bounces: 0, fragment,
      rotation: Math.atan2(vy, vx), data: {},
    };
    // Over the cap the projectile still exists for the caller but is born dead (never simulated).
    if (st.projectiles.length >= MAX_PROJECTILES) p.data.dead = 1;
    else st.projectiles.push(p);
    return p;
  }

  private spawnHazard(kind: HazardKind, weapon: WeaponId, owner: PlayerIndex, x: number, y: number,
    life: number, radius: number): HazardState | null {
    const st = this.state;
    if (st.hazards.length >= MAX_HAZARDS) return null;
    if (kind === 'lava') {
      let lava = 0;
      for (const h of st.hazards) if (h.kind === 'lava') lava++;
      if (lava >= MAX_LAVA) return null;
    }
    const h: HazardState = { id: st.nextId++, kind, weapon, owner, x, y, vx: 0, vy: 0, age: 0, life, radius, data: {} };
    st.hazards.push(h);
    if (kind === 'singularity' || kind === 'beam') this.noteEdit(x - 80, x + 80);
    return h;
  }

  /** Protective rectangles around tank hulls (fills never enter them). */
  private hullRects(fullHeight: boolean): Rect[] {
    const out: Rect[] = [];
    for (const t of this.state.tanks) {
      out.push({
        x0: Math.floor(t.x - TANK_HALF_WIDTH - 3), x1: Math.ceil(t.x + TANK_HALF_WIDTH + 3),
        y0: fullHeight ? 0 : Math.floor(t.y - TANK_HULL_HEIGHT - 6), y1: Math.floor(t.y),
      });
    }
    return out;
  }

  private raiseMound(x: number, radius: number, height: number): void {
    this.state.terrain.raiseMound(x, radius, height, this.dirtPainter, this.hullRects(true));
    this.noteEdit(x - radius, x + radius);
  }

  private fillBasalt(x: number, y: number, radius: number): void {
    this.state.terrain.fillCircle(x, y, radius, this.basaltPainter, this.hullRects(false));
  }

  /** Tracks the x span of recent terrain edits (for dirtFall events). */
  private noteEdit(x0: number, x1: number): void {
    if (x0 < this.dirtX0) this.dirtX0 = x0;
    if (x1 > this.dirtX1) this.dirtX1 = x1;
  }

  // =====================================================================================
  // Crates
  // =====================================================================================

  private maybeSpawnCrate(): void {
    const st = this.state;
    if (!st.config.crates || st.crates.length >= MAX_CRATES) return;
    if (!this.rng.chance(CRATE_CHANCE_PER_TURN)) return;
    const weapon = this.rng.pick(CRATE_WEAPONS);
    let x = -1;
    for (let k = 0; k < 16 && x < 0; k++) {
      const cx = this.rng.range(90, WORLD_W - 90);
      let ok = true;
      for (const t of st.tanks) if (Math.abs(cx - t.x) < 120) ok = false;
      for (const c of st.crates) if (Math.abs(cx - c.x) < 60) ok = false;
      if (ok) x = Math.round(cx);
    }
    if (x < 0) return;
    const amount = weapon === 'trident' || weapon === 'starfall' ? 2 : 1;
    const c: CrateState = {
      id: st.nextId++, x, y: -30, vy: CRATE_FALL_SPEED, weapon, amount, landed: false, parachute: 1, sway: 0, age: 0,
    };
    st.crates.push(c);
    this.emit({ type: 'crate', phase: 'spawn', id: c.id, x: c.x, y: c.y, weapon, amount, by: null });
  }

  private crateStep(h: number): void {
    const st = this.state;
    const terrain = st.terrain;
    const half = CRATE_SIZE * 0.4;
    for (const c of st.crates) {
      c.age += h;
      const supported = terrain.isSolid(c.x - half, c.y + 0.5) || terrain.isSolid(c.x, c.y + 0.5) || terrain.isSolid(c.x + half, c.y + 0.5);
      if (c.landed) {
        c.parachute = Math.max(0, c.parachute - h / 0.6);
        c.sway = damp(c.sway, 0, 8, h);
        if (!supported) { c.landed = false; c.parachute = 0; c.vy = 0; }
        continue;
      }
      if (c.parachute > 0) {
        c.vy = CRATE_FALL_SPEED;
        c.sway = Math.sin(c.age * 1.9) * 0.2 + Math.sin(c.age * 0.7 + c.id) * 0.06;
      } else {
        c.vy = Math.min(c.vy + st.gravity * h, 900);
        c.sway = damp(c.sway, 0, 6, h);
      }
      const ny = c.y + c.vy * h;
      let rest = terrain.h;
      if (c.y >= -1) {
        rest = Math.min(terrain.surfaceY(c.x - half, c.y), terrain.surfaceY(c.x, c.y), terrain.surfaceY(c.x + half, c.y));
      }
      if (rest <= ny) {
        c.y = Math.max(c.y, rest);
        c.vy = 0;
        c.landed = true;
        this.emit({ type: 'crate', phase: 'land', id: c.id, x: c.x, y: c.y, weapon: c.weapon, amount: c.amount, by: null });
      } else {
        c.y = ny;
      }
      if (c.y > WORLD_H + 50) c.amount = -1; // fell out of the world
    }
    for (const t of st.tanks) if (t.alive) this.collectCratesByTank(t);
    compactCrates(st.crates);
  }

  private collectCrate(c: CrateState, by: PlayerIndex): void {
    if (c.amount <= 0) return;
    const t = this.state.tanks[by];
    if (t.ammo[c.weapon] !== Infinity) t.ammo[c.weapon] = (t.ammo[c.weapon] || 0) + c.amount;
    this.emit({ type: 'crate', phase: 'collect', id: c.id, x: c.x, y: c.y, weapon: c.weapon, amount: c.amount, by });
    c.amount = 0;
  }

  private collectCratesByTank(t: TankState): void {
    for (const c of this.state.crates) {
      if (c.amount > 0 && Math.abs(c.x - t.x) < TANK_HALF_WIDTH + CRATE_SIZE / 2 &&
        c.y > t.y - TANK_HULL_HEIGHT - 4 && c.y - CRATE_SIZE < t.y + 2) this.collectCrate(c, t.index);
    }
  }

  private collectCratesRect(x0: number, y0: number, x1: number, y1: number, owner: PlayerIndex): void {
    const crates = this.state.crates;
    for (const c of crates) {
      if (c.x + CRATE_SIZE / 2 > x0 && c.x - CRATE_SIZE / 2 < x1 && c.y > y0 && c.y - CRATE_SIZE < y1) this.collectCrate(c, owner);
    }
    compactCrates(crates);
  }

  private projectileCrates(p: ProjectileState): void {
    for (const c of this.state.crates) {
      if (c.amount > 0 && Math.abs(p.x - c.x) < CRATE_SIZE / 2 + 3 && p.y > c.y - CRATE_SIZE - 3 && p.y < c.y + 3) {
        this.collectCrate(c, p.owner);
      }
    }
    compactCrates(this.state.crates);
  }

  // =====================================================================================
  // Controls
  // =====================================================================================

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    if (paused) this.moveIntent = 0;
  }

  canControl(): boolean {
    const st = this.state;
    return st.phase === 'aiming' && !st.paused && !this.isCpu(st.activePlayer) && st.tanks[st.activePlayer].alive;
  }

  setAngle(deg: number): void {
    if (!this.canControl() || !(deg === deg)) return;
    this.active().angle = round1(clamp(deg, 0, 180));
  }

  adjustAngle(delta: number): void {
    if (this.canControl()) this.setAngle(this.active().angle + delta);
  }

  setPower(power: number): void {
    if (!this.canControl() || !(power === power)) return;
    this.active().power = round1(clamp(power, 0, 100));
  }

  adjustPower(delta: number): void {
    if (this.canControl()) this.setPower(this.active().power + delta);
  }

  setMove(dir: -1 | 0 | 1): void {
    if (!this.canControl()) { if (dir === 0) this.moveIntent = 0; return; }
    this.moveIntent = dir;
  }

  selectWeapon(id: WeaponId): void {
    if (!this.canControl()) return;
    this.pickWeapon(this.state.activePlayer, id);
  }

  cycleWeapon(dir: 1 | -1): void {
    if (!this.canControl()) return;
    const t = this.active();
    const n = WEAPON_ORDER.length;
    let i = WEAPON_ORDER.indexOf(t.weapon);
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (t.ammo[WEAPON_ORDER[i]] > 0) { this.pickWeapon(t.index, WEAPON_ORDER[i]); return; }
    }
  }

  fire(): boolean {
    if (!this.canControl()) return false;
    return this.fireActive();
  }

  private active(): TankState {
    return this.state.tanks[this.state.activePlayer];
  }

  private pickWeapon(player: PlayerIndex, id: WeaponId): void {
    const t = this.state.tanks[player];
    if (!WEAPONS[id] || !(t.ammo[id] > 0) || t.weapon === id) return;
    t.weapon = id;
    this.emit({ type: 'weaponSelect', player, weapon: id });
  }

  private fireActive(): boolean {
    const st = this.state;
    if (st.phase !== 'aiming') return false;
    const player = st.activePlayer;
    const t = st.tanks[player];
    if (!t.alive) return false;
    let weapon = t.weapon;
    if (!(t.ammo[weapon] > 0)) weapon = t.weapon = 'ember';
    const w = WEAPONS[weapon];
    if (t.ammo[weapon] !== Infinity) t.ammo[weapon]--;
    if (!(t.ammo[t.weapon] > 0)) t.weapon = 'ember';
    this.moveIntent = 0;
    if (t.moveDir !== 0) this.setMoveDir(t, 0);
    t.stats.shots++;
    t.recoil = 1;
    st.cpuThinking = false;
    this.cpu.stage = CPU_DONE;
    this.memory[player].shots++;
    this.hitThisShot[0] = this.hitThisShot[1] = false;
    this.ctx.lavaTaken[0] = this.ctx.lavaTaken[1] = 0;
    const m = muzzlePoint(t);
    this.emit({ type: 'fire', player, weapon, x: m.x, y: m.y, angle: t.angle, power: t.power });
    this.paths[player].length = 0;
    if (w.instant) {
      applyUtility(this.ctx, player, weapon);
      this.trackId = -1;
      this.setPhase('settle');
      return true;
    }
    const v = muzzleVelocity(t.angle, t.power);
    const mode = w.projectile.style === 'beacon' ? 'beacon' : 'ballistic';
    const p = this.spawnProjectile(weapon, player, m.x, m.y, v.x, v.y, mode, false);
    this.trackId = p.id;
    this.trackAcc = 0;
    this.trackX = m.x;
    this.trackY = m.y;
    this.paths[player].push({ x: m.x, y: m.y });
    this.setPhase('flight');
    return true;
  }

  // =====================================================================================
  // Aim guide & shot paths
  // =====================================================================================

  aimGuide(maxLength: number): Vec2[] {
    const out = this.guideOut;
    out.length = 0;
    const st = this.state;
    const t = st.tanks[st.activePlayer];
    const w = WEAPONS[t.weapon];
    if (w.instant || !(maxLength > 0)) return out;
    const m = muzzlePoint(t);
    const v = muzzleVelocity(t.angle, t.power);
    this.guideLen = 0;
    this.guideMax = maxLength;
    this.guideX = m.x;
    this.guideY = m.y;
    this.guideAcc = 0;
    this.pushGuide(m.x, m.y);
    this.targets.refresh(st.tanks);
    traceBallistic(st.terrain, this.targets, st.activePlayer, m.x, m.y, v.x, v.y,
      windAccel(w, st.wind), gravityAccel(w, st.gravity), 30, this.guideTrace, MAX_SUBSTEP, 1, this.guideSample);
    // End exactly where the shot would stop (contact point or first point beyond the world).
    const r = this.guideTrace;
    const last = out[out.length - 1];
    const ex = this.guideLen < this.guideMax ? r.x : this.guideX, ey = this.guideLen < this.guideMax ? r.y : this.guideY;
    if (last.x !== ex || last.y !== ey) this.pushGuide(ex, ey);
    return out;
  }

  private readonly guideSample = (x: number, y: number): boolean => {
    const d = Math.hypot(x - this.guideX, y - this.guideY);
    this.guideX = x;
    this.guideY = y;
    this.guideLen += d;
    this.guideAcc += d;
    if (this.guideAcc >= GUIDE_SPACING) {
      this.guideAcc = 0;
      this.pushGuide(x, y);
    }
    return this.guideLen < this.guideMax;
  };

  private pushGuide(x: number, y: number): void {
    const out = this.guideOut;
    let v = this.guidePool[out.length];
    if (!v) { v = { x: 0, y: 0 }; this.guidePool.push(v); }
    v.x = x;
    v.y = y;
    out.push(v);
  }

  lastShotPath(player: PlayerIndex): readonly Vec2[] {
    return this.paths[player] ?? [];
  }

  private trackPath(p: ProjectileState): void {
    const d = Math.hypot(p.x - this.trackX, p.y - this.trackY);
    this.trackX = p.x;
    this.trackY = p.y;
    this.trackAcc += d;
    const dead = isDead(p);
    if (this.trackAcc >= PATH_SPACING || dead) {
      this.trackAcc = 0;
      const path = this.paths[p.owner];
      if (path.length < 4000) path.push({ x: p.x, y: p.y });
    }
    if (dead) this.trackId = -1;
  }

  // =====================================================================================
  // CPU driver
  // =====================================================================================

  private cpuUpdate(dt: number): void {
    const st = this.state;
    const player = st.activePlayer;
    const t = st.tanks[player];
    const cpu = this.cpu;
    const difficulty = st.config.players[player].difficulty;
    cpu.t += dt;
    switch (cpu.stage) {
      case CPU_PLAN: {
        if (t.airborne || cpu.t < 0.25) return; // a short beat before "thinking"
        const plan = planShot(st, player, difficulty, this.aiRng, this.memory[player], !cpu.drove);
        cpu.plan = plan;
        cpu.t = 0;
        if (plan.drive && Math.abs(plan.drive) > 4 && t.fuel > 8 && !cpu.drove) {
          cpu.stage = CPU_DRIVE;
          cpu.drove = true;
          cpu.driveTarget = clamp(t.x + plan.drive, MIN_TANK_X, MAX_TANK_X);
          return;
        }
        this.pickWeapon(player, plan.weapon);
        cpu.a0 = t.angle;
        cpu.p0 = t.power;
        cpu.stage = CPU_AIM;
        return;
      }
      case CPU_DRIVE: {
        const left = cpu.driveTarget - t.x;
        const done = Math.abs(left) < 1.5 || t.fuel <= 0 || cpu.t > 4.5 || (cpu.t > 0.3 && t.moveDir === 0 && !t.airborne);
        if (!done) { this.moveIntent = left > 0 ? 1 : -1; return; }
        this.moveIntent = 0;
        if (t.airborne || st.terrain.settling) return;
        cpu.stage = CPU_PLAN;
        cpu.t = 0.25;
        return;
      }
      case CPU_AIM: {
        const plan = cpu.plan;
        if (!plan) { cpu.stage = CPU_PLAN; return; }
        const k = Math.min(1, cpu.t / plan.thinkTime);
        const e = easeOutBack(k, 1.15);
        t.angle = round1(clamp(cpu.a0 + (plan.angle - cpu.a0) * e, 0, 180));
        const kp = Math.min(1, cpu.t / (plan.thinkTime * 0.85));
        t.power = round1(clamp(cpu.p0 + (plan.power - cpu.p0) * easeOutBack(kp, 1.3), 0, 100));
        if (k >= 1) {
          t.angle = plan.angle;
          t.power = plan.power;
          cpu.stage = CPU_HOLD;
          cpu.t = 0;
        }
        return;
      }
      case CPU_HOLD:
        if (cpu.t >= 0.22) this.fireActive();
        return;
      default:
        return;
    }
  }
}

/** Removes dead entries in place (stable order, no allocation). */
function compact<T extends { data: Record<string, number> }>(arr: T[]): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i].data.dead !== 1) arr[j++] = arr[i];
  arr.length = j;
}

function compactCrates(arr: CrateState[]): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i].amount > 0) arr[j++] = arr[i];
  arr.length = j;
}
