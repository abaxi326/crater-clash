/** Game-state data model. Owned by the simulation, read by everything else. */
import type { BiomeId } from './biomes.ts';
import type { WeaponId } from './weapons.ts';
import type { Terrain } from '../sim/terrain.ts';

export type PlayerIndex = 0 | 1;
export type PlayerKind = 'human' | 'cpu';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayerConfig {
  name: string;
  kind: PlayerKind;
  /** Only meaningful for CPU players. */
  difficulty: Difficulty;
}

export interface MatchConfig {
  players: [PlayerConfig, PlayerConfig];
  /** Fixed biome, or a different random biome every round. */
  biome: BiomeId | 'random';
  /** Round wins needed to take the match (first to N). */
  roundsToWin: number;
  /** Parachute supply crates. */
  crates: boolean;
  /** Master seed; every round derives its own terrain seed from it. */
  seed: number;
  /** Menu background demo: CPU vs CPU, rounds roll over forever, no match end. */
  attract: boolean;
}

/**
 * Round flow:
 * intro → aiming → flight → settle → turnEnd → aiming (next player) … → roundOver → (nextRound() → intro) | matchOver
 * - intro: tanks drop in from the sky and land (INTRO_TIME).
 * - aiming: the active player aims/drives/selects; CPU players think and animate their aim.
 * - flight: projectiles and hazards are active.
 * - settle: waits for collapsing terrain and falling tanks/crates to come to rest (≥ SETTLE_MIN_TIME).
 * - turnEnd: brief pause; may spawn a crate; then the other player's turn (with new wind).
 * - roundOver: a tank was destroyed (after ROUND_OVER_DELAY); waits for nextRound() (attract mode auto-advances).
 * - matchOver: someone reached roundsToWin.
 */
export type GamePhase = 'intro' | 'aiming' | 'flight' | 'settle' | 'turnEnd' | 'roundOver' | 'matchOver';

export interface TankStats {
  shots: number;
  hits: number;
  damageDealt: number;
}

export interface TankState {
  index: PlayerIndex;
  /** Ground contact point (bottom centre of the treads), world units. */
  x: number;
  y: number;
  /** Vertical velocity while airborne (px/s, positive = down). */
  vy: number;
  airborne: boolean;
  /** y where the current fall started (for fall damage). */
  fallStartY: number;
  /** Hull rotation in radians following the ground slope; positive = clockwise (right side lower). */
  tilt: number;
  /** Barrel angle in degrees, world-absolute: 0 = right, 90 = up, 180 = left. */
  angle: number;
  /** Shot power 0..100. */
  power: number;
  hp: number;
  maxHp: number;
  /** Shield points absorbed before hp (0 = none). */
  shield: number;
  /** Remaining drive distance this round. */
  fuel: number;
  alive: boolean;
  /** Currently selected weapon. */
  weapon: WeaponId;
  /** Remaining ammo per weapon (Infinity = unlimited). */
  ammo: Record<WeaponId, number>;
  // --- Animation drivers written by the sim and read by renderers ---------------
  /** Current drive direction. */
  moveDir: -1 | 0 | 1;
  /** Accumulated signed drive distance, for tread and wheel animation. */
  treadPhase: number;
  /** 1 right after firing, decays to 0. */
  recoil: number;
  /** 1 right after taking damage, decays to 0. */
  hitFlash: number;
  stats: TankStats;
}

export interface ProjectileState {
  id: number;
  weapon: WeaponId;
  owner: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since spawn. */
  age: number;
  /** Behaviour mode, e.g. 'ballistic', 'drill', 'homing', 'star', 'beacon'. */
  mode: string;
  bounces: number;
  /** Produced by a split/burst (fragments, starlets, firework stars). */
  fragment: boolean;
  /** Visual spin angle (radians). */
  rotation: number;
  /** Behaviour scratch values (drilled distance, fuse, hue…). */
  data: Record<string, number>;
}

export type HazardKind = 'lava' | 'tesla' | 'singularity' | 'beam' | 'quake';

export interface HazardState {
  id: number;
  kind: HazardKind;
  weapon: WeaponId;
  owner: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since spawn. */
  age: number;
  /** Total lifetime in seconds. */
  life: number;
  /** Current effect radius (singularity), beam half-width, lava blob radius, quake front distance… */
  radius: number;
  /** Per-kind scratch (pulses fired, charge state, front positions…). */
  data: Record<string, number>;
}

export interface CrateState {
  id: number;
  x: number;
  /** Bottom of the crate. */
  y: number;
  vy: number;
  weapon: WeaponId;
  amount: number;
  landed: boolean;
  /** 1 = canopy fully open; animates to 0 after landing. */
  parachute: number;
  /** Visual swing angle in radians while descending. */
  sway: number;
  age: number;
}

export interface GameState {
  config: MatchConfig;
  phase: GamePhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  paused: boolean;
  /** 1-based round number. */
  round: number;
  /** 1-based turn number within the round. */
  turn: number;
  activePlayer: PlayerIndex;
  wins: [number, number];
  biome: BiomeId;
  /** Terrain seed for this round. */
  seed: number;
  /** Effective wind in [-MAX_WIND, MAX_WIND] (already biome-scaled); positive blows right. */
  wind: number;
  /** Effective gravity (GRAVITY × biome.gravityScale). */
  gravity: number;
  terrain: Terrain;
  tanks: [TankState, TankState];
  projectiles: ProjectileState[];
  hazards: HazardState[];
  crates: CrateState[];
  /** Winner of the last finished round (null = draw / undecided). */
  roundWinner: PlayerIndex | null;
  /** Winner of the match once phase === 'matchOver'. */
  matchWinner: PlayerIndex | null;
  /** True while a CPU player is choosing and animating its shot. */
  cpuThinking: boolean;
  /** Monotonic id source for projectiles, hazards and crates. */
  nextId: number;
}
