/**
 * Module contracts. Each major module implements one of these interfaces so modules
 * built in parallel plug together in src/main.ts. Changing a contract affects
 * every module that touches it.
 */
import type { BiomeId, ColorGrade } from './core/biomes.ts';
import type { EventBus, GameEvent } from './core/events.ts';
import type { Vec2 } from './core/math.ts';
import type { Quality, Settings } from './core/settings.ts';
import type { TeamColors } from './core/teams.ts';
import type { GameState, MatchConfig, PlayerIndex, TankState } from './core/types.ts';
import type { WeaponId } from './core/weapons.ts';

// =====================================================================================
// Simulation — src/sim/game.ts: `export class Game implements GameApi` (constructor takes no args)
// =====================================================================================

export interface GameApi {
  readonly state: GameState;
  readonly events: EventBus;
  /** Starts a new match at round 1. Emits matchStart and roundStart. */
  newMatch(config: MatchConfig): void;
  /** From 'roundOver' when the match is undecided: starts the next round. */
  nextRound(): void;
  /** Advances the simulation by dt seconds (already time-scaled). No-op while paused or dt ≤ 0. */
  update(dt: number): void;
  setPaused(paused: boolean): void;
  /** True when a human may act: phase 'aiming', active player is human, not paused. */
  canControl(): boolean;
  /** Absolute barrel angle in degrees (clamped 0..180, rounded to 0.1). Ignored without control. */
  setAngle(deg: number): void;
  adjustAngle(delta: number): void;
  /** Power 0..100 (clamped, rounded to 0.1). Ignored without control. */
  setPower(power: number): void;
  adjustPower(delta: number): void;
  /** Hold-to-drive intent (consumes fuel); 0 stops. Ignored without control. */
  setMove(dir: -1 | 0 | 1): void;
  /** Selects a weapon with ammo > 0. Ignored without control. */
  selectWeapon(id: WeaponId): void;
  /** Next / previous weapon with ammo > 0 (wraps). */
  cycleWeapon(dir: 1 | -1): void;
  /** Fires the active tank's selected weapon. Returns false if not allowed. */
  fire(): boolean;
  /**
   * Predicted ballistic path from the active tank's muzzle using its current angle, power and the
   * selected weapon's gravity/wind scale. Points every ~8 world units until maxLength of path,
   * terrain/tank contact or leaving the world. Ignores special behaviours (splits, homing…).
   */
  aimGuide(maxLength: number): Vec2[];
  /** Sampled path (~every 10 units) of this player's previous shot in the current round. */
  lastShotPath(player: PlayerIndex): readonly Vec2[];
}

// =====================================================================================
// Rendering — src/render/*
// =====================================================================================

/** Camera/view information handed to every draw call. */
export interface ViewInfo {
  /** Visible world rectangle (may extend beyond the world bounds). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Device pixels per world unit. */
  scale: number;
  /** Canvas size in device pixels. */
  cw: number;
  ch: number;
  dpr: number;
  /** Real seconds since boot (unscaled, for ambient animation). */
  time: number;
  /** Simulation seconds advanced this frame (scaled by slow-mo; 0 during hit-stop). */
  dt: number;
  quality: Quality;
  reducedMotion: boolean;
}

/** A dynamic light in world space (explosions, muzzle flashes, lava, beams). */
export interface LightSource {
  x: number;
  y: number;
  radius: number;
  color: string;
  /** 0..1+ */
  intensity: number;
}

/**
 * Effects → renderer/camera/time requests. Implemented by the Renderer and passed to the FX system.
 * All of these must respect settings (screen shake scale, reduced motion) inside the implementation.
 */
export interface FxHooks {
  /** Adds camera trauma (0..1); shake magnitude ∝ trauma². */
  shake(trauma: number): void;
  /** Screen-space distortion ring at a world position (post-processing). strength 0..1. */
  shockwave(x: number, y: number, strength: number): void;
  /** Chromatic aberration pulse 0..1. */
  chroma(amount: number): void;
  /** Additive full-screen flash (hex colour, intensity 0..1). */
  flash(color: string, intensity: number): void;
  /** Freezes simulation time briefly (impact punch). */
  hitStop(seconds: number): void;
  /** Slow motion at `scale` for `seconds` real time. */
  slowMo(scale: number, seconds: number): void;
  /** Camera punch-in / kill-cam toward a world point. */
  focus(x: number, y: number, zoom: number, seconds: number): void;
}

/** src/render/background.ts — `export class Background implements BackgroundApi` (constructor takes no args). */
export interface BackgroundApi {
  setBiome(biome: BiomeId, seed: number): void;
  /** wind in [-MAX_WIND, MAX_WIND]; drives clouds and weather drift. */
  update(dt: number, wind: number, time: number): void;
  /**
   * Device-space (identity transform). Fills the ENTIRE canvas: sky gradient, celestial body,
   * stars/clouds and parallax silhouette layers, positioned from `view` so they line up with the world.
   */
  drawBack(ctx: CanvasRenderingContext2D, view: ViewInfo): void;
  /** World-space transform. Weather/ambient particles in front of the terrain (snow, dust, embers…). */
  drawFront(ctx: CanvasRenderingContext2D, view: ViewInfo): void;
  /** Static preview for biome-selection cards. */
  thumbnail(biome: BiomeId, width: number, height: number): HTMLCanvasElement;
}

export interface TankDrawInfo {
  team: TeamColors;
  /** It is this tank's turn. */
  active: boolean;
  /** The active tank is in the aiming phase (show aim affordances). */
  aiming: boolean;
  time: number;
  dt: number;
  biome: BiomeId;
}

/** src/render/tanks.ts — `export class TankRenderer implements TankRendererApi` (constructor takes no args). */
export interface TankRendererApi {
  /** World-space. Hull, treads, turret, barrel, shield bubble, damage state or wreck. */
  draw(ctx: CanvasRenderingContext2D, tank: TankState, info: TankDrawInfo): void;
}

/** src/render/entities.ts — `export class EntityRenderer implements EntityRendererApi` (constructor takes no args). */
export interface EntityRendererApi {
  /** Maintains render-side state such as trail histories keyed by projectile id. */
  update(dt: number, state: GameState): void;
  handleEvent(e: GameEvent, state: GameState): void;
  /** World-space: supply crates with parachutes. */
  drawCrates(ctx: CanvasRenderingContext2D, state: GameState, view: ViewInfo): void;
  /** World-space: projectiles with their trails. */
  drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState, view: ViewInfo): void;
  /** Forget all render-side state (round start). */
  clear(): void;
}

/** src/render/fx.ts — `export class Fx implements FxApi`; constructor(hooks: FxHooks). */
export interface FxApi {
  handleEvent(e: GameEvent, state: GameState): void;
  /** Advances particles/effects and emits ambient tank effects (exhaust, damage smoke, dust). */
  update(dt: number, state: GameState): void;
  /** World-space, drawn after terrain and before tanks (ground dust, back halves of effects, glows). */
  drawBack(ctx: CanvasRenderingContext2D, view: ViewInfo, state: GameState): void;
  /** World-space, drawn after tanks/projectiles: explosions, particles, hazards, lightning, floating text. */
  drawFront(ctx: CanvasRenderingContext2D, view: ViewInfo, state: GameState): void;
  /** Active dynamic lights (world space). */
  lights(): readonly LightSource[];
  particleCount(): number;
  setQuality(quality: Quality, reducedMotion: boolean): void;
  /** Remove all effects (round start). */
  clear(): void;
}

export interface Shockwave {
  /** Centre in UV space [0, 1] (y down). */
  x: number;
  y: number;
  /** Current ring radius and ring width as fractions of the canvas height. */
  radius: number;
  width: number;
  /** 0..1 */
  strength: number;
}

export interface PostFxFrame {
  /** Real seconds since boot. */
  time: number;
  grade: ColorGrade;
  /** Multiplier on grade.bloom (quality/settings). */
  bloomScale: number;
  /** Chromatic aberration 0..1. */
  chroma: number;
  /** Additive flash colour (0..1 floats) and amount 0..1. */
  flash: { r: number; g: number; b: number; amount: number };
  shockwaves: readonly Shockwave[];
  /** Film grain 0..1. */
  grain: number;
  quality: Quality;
}

/**
 * src/render/postfx.ts — `export function createPostFx(): PostFxApi | null` (null when WebGL2 is unavailable).
 * The renderer draws the scene into a 2D canvas, then postfx renders it to its own canvas with effects.
 */
export interface PostFxApi {
  /** The output canvas to place in the DOM. */
  readonly canvas: HTMLCanvasElement;
  /** Device-pixel size of the output (and expected source). */
  resize(width: number, height: number): void;
  render(source: HTMLCanvasElement, frame: PostFxFrame): void;
  dispose(): void;
}

export interface RenderFrame {
  /** Real seconds since boot. */
  time: number;
  /** Real seconds since the previous frame. */
  realDt: number;
  /** Simulation seconds advanced this frame (time-scaled). */
  dt: number;
  settings: Settings;
  /** Show the trajectory guide (a human is aiming). */
  showAimGuide: boolean;
  /** Menu background demo: cinematic camera, no in-world labels. */
  attract: boolean;
}

export interface RenderStats {
  fps: number;
  frameMs: number;
  particles: number;
  postFx: boolean;
}

/**
 * src/render/renderer.ts — `export class Renderer implements RendererApi`;
 * constructor(stage: HTMLElement, time: TimeControl). It owns the canvases, camera, background,
 * terrain, tank/entity renderers, FX and post-processing, and forwards events to them.
 */
export interface RendererApi {
  readonly hooks: FxHooks;
  /** Effective quality after 'auto' adaptation. */
  readonly quality: Quality;
  render(state: GameState, game: GameApi, frame: RenderFrame): void;
  /** Forward every game event here (FX, entities, camera, terrain glow). */
  handleEvent(e: GameEvent, state: GameState): void;
  /** Call after newMatch()/nextRound() so caches (terrain bitmap, biome) rebuild. */
  onRoundStart(state: GameState): void;
  resize(): void;
  /** Viewport CSS pixels (clientX/clientY) → world units. */
  screenToWorld(clientX: number, clientY: number): Vec2;
  /** World units → viewport CSS pixels. */
  worldToScreen(x: number, y: number): Vec2;
  applySettings(settings: Settings): void;
  stats(): RenderStats;
  thumbnail(biome: BiomeId, width: number, height: number): HTMLCanvasElement;
}

// =====================================================================================
// Audio — src/audio/audio.ts: `export class AudioEngine implements AudioApi` (constructor takes no args)
// =====================================================================================

export type UiSound = 'click' | 'hover' | 'select' | 'back' | 'tick' | 'error' | 'start' | 'toggle' | 'open' | 'close' | 'confirm';
export type MusicMode = 'menu' | 'battle' | 'victory' | 'defeat' | 'off';

export interface AudioApi {
  /** Create/resume the AudioContext; call from the first user gesture. Safe to call repeatedly. */
  unlock(): void;
  /** Volumes 0..1. */
  setVolumes(master: number, sfx: number, music: number): void;
  setMusic(mode: MusicMode, biome?: BiomeId): void;
  handleEvent(e: GameEvent, state: GameState): void;
  /** Continuous sounds (projectile whistle, wind bed, engine, collapsing dirt). timeScale pitches for slow-mo. */
  update(dt: number, state: GameState, timeScale: number): void;
  ui(sound: UiSound): void;
  /** Duck everything (pause menu, attract mode behind the main menu). */
  setDucked(ducked: boolean): void;
}

// =====================================================================================
// UI — src/ui/*
// =====================================================================================

/** Callbacks from UI into the app shell (implemented in src/main.ts). */
export interface UiActions {
  startMatch(config: MatchConfig): void;
  nextRound(): void;
  rematch(): void;
  quitToMenu(): void;
  pause(): void;
  resume(): void;
  applySettings(settings: Settings): void;
  getSettings(): Settings;
  uiSound(sound: UiSound): void;
  /** Biome preview canvas for setup cards (null if unavailable). */
  thumbnail(biome: BiomeId, width: number, height: number): HTMLCanvasElement | null;
}

/** src/ui/hud.ts — `export class Hud implements HudApi`; constructor(actions: UiActions). */
export interface HudApi {
  /** Builds DOM inside root (#hud). */
  mount(root: HTMLElement): void;
  setVisible(visible: boolean): void;
  /** Reset per-match visuals (health chips, banners) at match/round start. */
  reset(state: GameState): void;
  /** Every frame while in a match. Diff against previous values; avoid layout thrash. */
  update(state: GameState, game: GameApi, dt: number): void;
  handleEvent(e: GameEvent, state: GameState): void;
  toggleWeaponPicker(open?: boolean): void;
  isWeaponPickerOpen(): boolean;
}

export type MenuScreen = 'none' | 'main' | 'setup' | 'pause' | 'settings' | 'help' | 'roundOver' | 'matchOver';

/** src/ui/menus.ts — `export class Menus implements MenusApi`; constructor(actions: UiActions). */
export interface MenusApi {
  /** Builds DOM inside root (#overlay). */
  mount(root: HTMLElement): void;
  /** Shows a screen ('none' hides all). roundOver/matchOver read results from state. */
  show(screen: MenuScreen, state?: GameState): void;
  current(): MenuScreen;
  /** Esc/back: closes the top-most screen when that makes sense; returns true if handled. */
  back(): boolean;
  handleEvent(e: GameEvent, state: GameState): void;
  update(dt: number, state: GameState | null): void;
}

export interface InputDeps {
  game: GameApi;
  screenToWorld(clientX: number, clientY: number): Vec2;
  /** Esc / P. */
  onPause(): void;
  /** Tab / Q-E long press / weapon hotkey: open or close the weapon picker. */
  onToggleWeapons(): void;
  uiSound(sound: UiSound): void;
  /** True while a menu covers the game; input must not reach the game. */
  isBlocked(): boolean;
}

/** src/ui/input.ts — `export class Input implements InputApi`; constructor(deps: InputDeps). */
export interface InputApi {
  /** Listens for keyboard on window and pointer/touch on target (the stage). */
  attach(target: HTMLElement): void;
  detach(): void;
  /** Every frame: held-key repeat with acceleration for angle/power, continuous driving. */
  update(dt: number): void;
}
