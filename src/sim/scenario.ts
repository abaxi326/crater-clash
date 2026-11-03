/**
 * Controlled battlefields for tests and sandboxes: flat ground, tanks at chosen positions,
 * fixed wind, intro skipped. Not used by the game itself.
 */
import { BIOMES, type BiomeId } from '../core/biomes.ts';
import { INTRO_TIME, WORLD_H, WORLD_W } from '../core/constants.ts';
import type { Difficulty, PlayerKind, TankState } from '../core/types.ts';
import { packRGBA } from '../core/color.ts';
import { Game } from './game.ts';
import { groundTilt } from './physics.ts';
import { Terrain } from './terrain.ts';

export interface ScenarioOptions {
  /** Ground row (flat surface). */
  ground?: number;
  x0?: number;
  x1?: number;
  kinds?: [PlayerKind, PlayerKind];
  difficulty?: Difficulty;
  wind?: number;
  biome?: BiomeId;
  crates?: boolean;
  seed?: number;
  roundsToWin?: number;
  attract?: boolean;
}

const DIRT = packRGBA(122, 92, 60);

/** A terrain with a flat surface at `ground`. */
export function flatTerrain(ground: number): Terrain {
  const t = new Terrain(WORLD_W, WORLD_H);
  for (let x = 0; x < WORLD_W; x++) for (let y = ground; y < WORLD_H; y++) t.setPixel(x, y, DIRT);
  t.markAllDirty();
  return t;
}

/** Puts a tank on the ground at x (resting, not airborne). */
export function placeTank(game: Game, index: 0 | 1, x: number): TankState {
  const st = game.state;
  const t = st.tanks[index];
  t.x = x;
  t.y = st.terrain.heightAt(x);
  t.airborne = false;
  t.vy = 0;
  t.fallStartY = t.y;
  t.tilt = groundTilt(st.terrain, t.x, t.y);
  return t;
}

/** A new match on flat ground with tanks at x0/x1; returns in the aiming phase of player 0's first turn. */
export function flatScenario(o: ScenarioOptions = {}): Game {
  const g = new Game();
  const kinds = o.kinds ?? ['human', 'human'];
  const difficulty = o.difficulty ?? 'normal';
  g.newMatch({
    players: [{ name: 'Azure', kind: kinds[0], difficulty }, { name: 'Blaze', kind: kinds[1], difficulty }],
    biome: o.biome ?? 'verdant', roundsToWin: o.roundsToWin ?? 2, crates: o.crates ?? false,
    seed: o.seed ?? 1, attract: o.attract ?? false,
  });
  const st = g.state;
  st.terrain = flatTerrain(o.ground ?? 700);
  st.gravity = 520 * BIOMES[st.biome].gravityScale;
  placeTank(g, 0, o.x0 ?? 400);
  placeTank(g, 1, o.x1 ?? 1500);
  st.phaseTime = INTRO_TIME;
  g.update(1 / 240);
  st.wind = o.wind ?? 0;
  return g;
}

/** Runs the sim at 60 Hz until pred() is true or maxSeconds elapse. Returns the seconds simulated. */
export function runUntil(g: Game, pred: () => boolean, maxSeconds = 30, dt = 1 / 60): number {
  let t = 0;
  while (t < maxSeconds && !pred()) {
    g.update(dt);
    t += dt;
  }
  return t;
}
