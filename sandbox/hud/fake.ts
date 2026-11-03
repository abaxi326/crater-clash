// Sandbox stub: a minimal fake GameState + GameApi that logs calls and mutates the state like the sim would.
import type { GameApi } from '../../src/contracts.ts';
import { FUEL_PER_ROUND, DRIVE_SPEED, MAX_HP } from '../../src/core/constants.ts';
import { EventBus } from '../../src/core/events.ts';
import type { Vec2 } from '../../src/core/math.ts';
import type { GameState, MatchConfig, PlayerIndex, TankState } from '../../src/core/types.ts';
import { WEAPON_ORDER, startingAmmo, type WeaponId } from '../../src/core/weapons.ts';
import type { Terrain } from '../../src/sim/terrain.ts';

export const GROUND_Y = 820;

function tank(index: PlayerIndex, x: number): TankState {
  return {
    index, x, y: GROUND_Y, vy: 0, airborne: false, fallStartY: GROUND_Y, tilt: 0,
    angle: index === 0 ? 52 : 128, power: index === 0 ? 64 : 58, hp: MAX_HP, maxHp: MAX_HP, shield: 0,
    fuel: FUEL_PER_ROUND, alive: true, weapon: 'ember', ammo: startingAmmo(), moveDir: 0, treadPhase: 0,
    recoil: 0, hitFlash: 0, stats: { shots: 0, hits: 0, damageDealt: 0 },
  };
}

export function makeState(config: MatchConfig): GameState {
  return {
    config, phase: 'aiming', phaseTime: 0, paused: false, round: 1, turn: 1, activePlayer: 0, wins: [0, 0],
    biome: 'verdant', seed: 1, wind: 3.4, gravity: 520, terrain: null as unknown as Terrain,
    tanks: [tank(0, 420), tank(1, 1500)], projectiles: [], hazards: [], crates: [],
    roundWinner: null, matchWinner: null, cpuThinking: false, nextId: 1,
  };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

export class FakeGame implements GameApi {
  readonly state: GameState;
  readonly events = new EventBus();
  log: (msg: string) => void = () => {};

  constructor(state: GameState) {
    this.state = state;
  }

  private get t(): TankState {
    return this.state.tanks[this.state.activePlayer];
  }

  newMatch(): void {}
  nextRound(): void {}
  setPaused(p: boolean): void {
    this.state.paused = p;
  }
  canControl(): boolean {
    const s = this.state;
    return s.phase === 'aiming' && !s.paused && s.config.players[s.activePlayer].kind === 'human';
  }
  setAngle(deg: number): void {
    if (!this.canControl()) return;
    this.t.angle = r1(Math.max(0, Math.min(180, deg)));
    this.log(`setAngle ${this.t.angle}`);
  }
  adjustAngle(d: number): void {
    if (this.canControl()) this.setAngle(this.t.angle + d);
  }
  setPower(p: number): void {
    if (!this.canControl()) return;
    this.t.power = r1(Math.max(0, Math.min(100, p)));
    this.log(`setPower ${this.t.power}`);
  }
  adjustPower(d: number): void {
    if (this.canControl()) this.setPower(this.t.power + d);
  }
  setMove(dir: -1 | 0 | 1): void {
    if (!this.canControl() && dir !== 0) return;
    const t = this.t;
    if (dir !== 0 && t.fuel <= 0) return;
    const was = t.moveDir;
    t.moveDir = dir;
    this.log(`setMove ${dir}`);
    if ((was === 0) !== (dir === 0)) this.events.emit({ type: 'drive', player: t.index, moving: dir !== 0 });
  }
  selectWeapon(id: WeaponId): void {
    if (!this.canControl() || this.t.ammo[id] <= 0) return;
    this.t.weapon = id;
    this.log(`selectWeapon ${id}`);
    this.events.emit({ type: 'weaponSelect', player: this.t.index, weapon: id });
  }
  cycleWeapon(dir: 1 | -1): void {
    if (!this.canControl()) return;
    const t = this.t;
    let i = WEAPON_ORDER.indexOf(t.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      if (t.ammo[WEAPON_ORDER[i]] > 0) break;
    }
    this.selectWeapon(WEAPON_ORDER[i]);
  }
  fire(): boolean {
    if (!this.canControl()) return false;
    const t = this.t;
    if (t.ammo[t.weapon] !== Infinity) t.ammo[t.weapon]--;
    this.log(`fire ${t.weapon} a=${t.angle} p=${t.power}`);
    this.events.emit({ type: 'fire', player: t.index, weapon: t.weapon, x: t.x, y: t.y - 30, angle: t.angle, power: t.power });
    this.state.phase = 'flight';
    this.state.phaseTime = 0;
    if (t.ammo[t.weapon] <= 0) t.weapon = 'ember';
    return true;
  }
  aimGuide(): Vec2[] {
    return [];
  }
  lastShotPath(): readonly Vec2[] {
    return [];
  }

  /** Drives the active tank while moveDir is set (stand-in for the sim). */
  update(dt: number): void {
    const s = this.state;
    s.phaseTime += dt;
    const t = this.t;
    if (t.moveDir !== 0 && s.phase === 'aiming') {
      const step = Math.min(t.fuel, DRIVE_SPEED * dt);
      t.fuel -= step;
      t.x += step * t.moveDir;
      t.treadPhase += step * t.moveDir;
      if (t.fuel <= 0) {
        t.fuel = 0;
        t.moveDir = 0;
        this.events.emit({ type: 'drive', player: t.index, moving: false });
      }
    }
  }
}
