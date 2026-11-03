/**
 * Simulation → presentation events. The sim emits these synchronously during update();
 * FX, audio, camera and UI subscribe. Events are facts about what happened; presentation
 * layers decide how to show them. Coordinates are world units.
 */
import type { BiomeId } from './biomes.ts';
import type { ExplosionKind, WeaponId } from './weapons.ts';
import type { MatchConfig, PlayerIndex } from './types.ts';

export type GameEvent =
  | { type: 'matchStart'; config: MatchConfig }
  | { type: 'roundStart'; round: number; biome: BiomeId; seed: number }
  /** A tank touched down after falling (intro drop, collapse, teleport). */
  | { type: 'tankLanded'; player: PlayerIndex; x: number; y: number; fallDistance: number; damage: number; intro: boolean }
  | { type: 'turnStart'; player: PlayerIndex; turn: number; wind: number; previousWind: number }
  | { type: 'weaponSelect'; player: PlayerIndex; weapon: WeaponId }
  /** Driving started or stopped. */
  | { type: 'drive'; player: PlayerIndex; moving: boolean }
  /** A weapon was fired from the muzzle at (x, y). */
  | { type: 'fire'; player: PlayerIndex; weapon: WeaponId; x: number; y: number; angle: number; power: number }
  /** An instant utility (repair, aegis) was used. */
  | { type: 'utility'; player: PlayerIndex; weapon: WeaponId; x: number; y: number; amount: number }
  /** A projectile split into fragments (trident, starfall, fireworks stars). */
  | { type: 'split'; weapon: WeaponId; x: number; y: number; count: number }
  /** A projectile bounced or ricocheted. */
  | { type: 'bounce'; weapon: WeaponId; x: number; y: number; speed: number }
  /** Burrower started/finished drilling. */
  | { type: 'drill'; phase: 'start' | 'end'; x: number; y: number }
  /** Seeker acquired its target. */
  | { type: 'lockOn'; x: number; y: number; target: PlayerIndex }
  /** Any blast. primary=false for small secondary blasts (bounces, fragments, eruptions, stars). */
  | { type: 'explosion'; weapon: WeaponId; kind: ExplosionKind; x: number; y: number; radius: number; owner: PlayerIndex; primary: boolean }
  /** Earth was added (earthmaker, cooled lava uses radius ≤ 4). */
  | { type: 'mound'; x: number; y: number; radius: number }
  | { type: 'damage'; target: PlayerIndex; amount: number; absorbed: number; x: number; y: number; weapon: WeaponId | 'fall'; direct: boolean; hpAfter: number; by: PlayerIndex | null }
  | { type: 'heal'; target: PlayerIndex; amount: number; x: number; y: number }
  | { type: 'shieldUp'; target: PlayerIndex; amount: number }
  | { type: 'shieldBreak'; target: PlayerIndex; x: number; y: number }
  | { type: 'tankDestroyed'; target: PlayerIndex; x: number; y: number; by: PlayerIndex | null }
  /** A tesla arc from (x1,y1) to (x2,y2); target is the struck tank or null for cosmetic ground arcs. */
  | { type: 'lightning'; x1: number; y1: number; x2: number; y2: number; target: PlayerIndex | null }
  | { type: 'singularity'; phase: 'open' | 'collapse'; x: number; y: number; radius: number }
  /** Sunbeam: 'mark' when the beacon plants, 'fire' when the beam starts, 'end' when it stops. y = ground at x. */
  | { type: 'beam'; phase: 'mark' | 'fire' | 'end'; x: number; y: number; halfWidth: number }
  | { type: 'lava'; phase: 'spawn' | 'cool'; x: number; y: number }
  /** A faultline eruption at step index (1-based) along the wave. */
  | { type: 'quake'; x: number; y: number; step: number }
  | { type: 'teleport'; player: PlayerIndex; fromX: number; fromY: number; toX: number; toY: number }
  /** A projectile ended without effect (blink beacon off-world, beacon hit a tank). */
  | { type: 'fizzle'; weapon: WeaponId; x: number; y: number }
  | { type: 'crate'; phase: 'spawn' | 'land' | 'collect'; id: number; x: number; y: number; weapon: WeaponId; amount: number; by: PlayerIndex | null }
  /** Collapsing terrain; emitted at most ~8 times per second while dirt is falling. amount = pixels moved. */
  | { type: 'dirtFall'; x0: number; x1: number; amount: number }
  | { type: 'outOfBounds'; weapon: WeaponId; x: number; y: number }
  | { type: 'turnEnd'; player: PlayerIndex }
  | { type: 'roundOver'; winner: PlayerIndex | null; round: number }
  | { type: 'matchOver'; winner: PlayerIndex | null };

export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type GameEventHandler = (event: GameEvent) => void;

export class EventBus {
  private handlers: GameEventHandler[] = [];

  /** Subscribe to all events; returns an unsubscribe function. */
  on(handler: GameEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Dispatch synchronously. A throwing handler is logged and never breaks the simulation. */
  emit(event: GameEvent): void {
    for (const handler of this.handlers.slice()) {
      try {
        handler(event);
      } catch (error) {
        console.error('[events] handler failed for', event.type, error);
      }
    }
  }

  clear(): void {
    this.handlers.length = 0;
  }
}
