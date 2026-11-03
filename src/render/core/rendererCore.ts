/**
 * Renderer composition. Owns the canvases, camera, terrain layer, decorations and overlay, and
 * drives the other render modules (background, tanks, entities, FX, post-processing), which are
 * injected through factories so the core can be exercised with stubs. `src/render/renderer.ts`
 * binds the real modules.
 */
import { BIOMES, type BiomeId } from '../../core/biomes.ts';
import { hexToRgb, rgba } from '../../core/color.ts';
import { DEFAULT_SETTINGS, type Quality, type Settings } from '../../core/settings.ts';
import { DEG, easeOutCubic, type Vec2 } from '../../core/math.ts';
import { TEAMS } from '../../core/teams.ts';
import type { TimeControl } from '../../core/time.ts';
import type { GameEvent } from '../../core/events.ts';
import type { GameState } from '../../core/types.ts';
import type {
  BackgroundApi, EntityRendererApi, FxApi, FxHooks, GameApi, LightSource, PostFxApi, PostFxFrame,
  RenderFrame, RendererApi, RenderStats, Shockwave, TankDrawInfo, TankRendererApi, ViewInfo,
} from '../../contracts.ts';
import { Camera } from '../camera.ts';
import { Decor, type Mat } from '../decor.ts';
import { Overlay } from '../overlay.ts';
import { TerrainLayer } from '../terrainLayer.ts';

/** Constructors for the composed render modules. */
export interface RenderModules {
  background(): BackgroundApi;
  tanks(): TankRendererApi;
  entities(): EntityRendererApi;
  fx(hooks: FxHooks): FxApi;
  /** null when WebGL2 is unavailable. */
  postfx(): PostFxApi | null;
}

export interface RendererOptions {
  /** Override any module constructor (sandboxes inject stubs here). */
  factories?: Partial<RenderModules>;
}

const DPR_CAP: Record<Quality, number> = { high: 2, medium: 1.5, low: 1 };
const BLOOM_SCALE: Record<Quality, number> = { high: 1, medium: 0.85, low: 0.6 };
const GRAIN: Record<Quality, number> = { high: 0.055, medium: 0.045, low: 0.03 };
const TIERS: readonly Quality[] = ['low', 'medium', 'high'];
const SHOCK_LIFE = 0.7;
const MAX_SHOCKS = 8;

interface ShockState {
  active: boolean;
  x: number;
  y: number;
  age: number;
  strength: number;
}

export class RendererCore implements RendererApi {
  readonly hooks: FxHooks;

  private readonly stage: HTMLElement;
  private readonly time: TimeControl;
  private readonly scene: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera = new Camera();
  private readonly terrainLayer = new TerrainLayer();
  private readonly decor = new Decor();
  private readonly overlay = new Overlay();
  private readonly background: BackgroundApi;
  private readonly tankRenderer: TankRendererApi;
  private readonly entities: EntityRendererApi;
  private readonly fx: FxApi;
  private readonly makePostFx: () => PostFxApi | null;
  private postfx: PostFxApi | null = null;
  private postTried = false;
  private postActive = false;

  private settings: Settings = { ...DEFAULT_SETTINGS };
  private effective: Quality = 'high';
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private cw = 1;
  private ch = 1;
  private biomeId: BiomeId = 'verdant';
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.resize();

  // Feedback state (FxHooks).
  private flashR = 1;
  private flashG = 1;
  private flashB = 1;
  private flashAmount = 0;
  private chromaAmount = 0;
  private readonly shocks: ShockState[] = [];
  private readonly shockOut: Shockwave[] = [];

  // Per-frame scratch (reused; no allocations in the hot path).
  private readonly view: ViewInfo = {
    left: 0, top: 0, right: 0, bottom: 0, scale: 1, cw: 1, ch: 1, dpr: 1, time: 0, dt: 0, quality: 'high', reducedMotion: false,
  };
  private readonly mat: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private readonly lightBuf: LightSource[] = [];
  private readonly tankInfo: TankDrawInfo = { team: TEAMS[0], active: false, aiming: false, time: 0, dt: 0, biome: 'verdant' };
  private readonly postFrame: PostFxFrame;
  private readonly tmpVec = { x: 0, y: 0 };
  private vignette: CanvasGradient | null = null;

  // Stats and adaptive quality.
  private fpsAvg = 60;
  private frameMsAvg = 0;
  private autoSum = 0;
  private autoCount = 0;
  private autoClock = 0;
  private sinceTierChange = 0;
  private warmup = 3;
  private readonly failed = new Set<string>();

  constructor(stage: HTMLElement, time: TimeControl, modules: RenderModules) {
    this.stage = stage;
    this.time = time;
    this.scene = document.createElement('canvas');
    this.scene.className = 'cc-scene';
    styleCanvas(this.scene);
    const ctx = this.scene.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    for (let i = 0; i < MAX_SHOCKS; i++) {
      this.shocks.push({ active: false, x: 0, y: 0, age: 0, strength: 0 });
      this.shockOut.push({ x: 0, y: 0, radius: 0, width: 0, strength: 0 });
    }
    this.postFrame = {
      time: 0,
      grade: BIOMES.verdant.grade,
      bloomScale: 1,
      chroma: 0,
      flash: { r: 1, g: 1, b: 1, amount: 0 },
      shockwaves: [],
      grain: GRAIN.high,
      quality: 'high',
    };
    this.hooks = {
      shake: (t: number): void => this.camera.addTrauma(t),
      shockwave: (x: number, y: number, s: number): void => this.addShockwave(x, y, s),
      chroma: (a: number): void => {
        if (!this.settings.reducedMotion) this.chromaAmount = Math.min(1, Math.max(this.chromaAmount, a));
      },
      flash: (color: string, intensity: number): void => this.addFlash(color, intensity),
      hitStop: (s: number): void => {
        if (!this.settings.reducedMotion) this.time.hitStop(s);
      },
      slowMo: (scale: number, s: number): void => {
        if (!this.settings.reducedMotion) this.time.slowMo(scale, s);
      },
      focus: (x: number, y: number, zoom: number, s: number): void => this.camera.focus(x, y, zoom, s),
    };
    this.background = modules.background();
    this.tankRenderer = modules.tanks();
    this.entities = modules.entities();
    this.fx = modules.fx(this.hooks);
    this.makePostFx = modules.postfx;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(stage);
    }
    window.addEventListener('resize', this.onWindowResize);
    this.applySettings(this.settings);
  }

  get quality(): Quality {
    return this.effective;
  }

  // --- Settings, canvases, resize ------------------------------------------------------

  applySettings(settings: Settings): void {
    const prevQuality = this.settings.quality;
    this.settings = { ...settings };
    if (settings.quality !== 'auto') this.effective = settings.quality;
    else if (prevQuality !== 'auto') {
      // Switching to auto restarts adaptation from the top tier.
      this.effective = 'high';
      this.warmup = 3;
    }
    this.camera.setOptions(settings.screenShake, settings.reducedMotion);
    if (settings.reducedMotion) {
      this.chromaAmount = 0;
      for (const s of this.shocks) s.active = false;
    }
    this.qualityChanged();
  }

  private qualityChanged(): void {
    const q = this.effective;
    try {
      this.fx.setQuality(q, this.settings.reducedMotion);
    } catch (e) {
      this.fail('fx.setQuality', e);
    }
    this.terrainLayer.setQuality(q === 'low');
    this.updateCanvasMode();
    this.resize();
  }

  /** Puts either the post-processing output or the scene canvas into the stage. */
  private updateCanvasMode(): void {
    const want = this.settings.postFx && this.effective !== 'low';
    if (want && !this.postfx && !this.postTried) {
      this.postTried = true;
      try {
        this.postfx = this.makePostFx();
      } catch (e) {
        this.fail('postfx.create', e);
        this.postfx = null;
      }
      if (this.postfx) {
        styleCanvas(this.postfx.canvas);
        this.postfx.resize(this.cw, this.ch);
      }
    }
    this.postActive = want && !!this.postfx;
    const show = this.postActive && this.postfx ? this.postfx.canvas : this.scene;
    const hide = show === this.scene ? this.postfx?.canvas : this.scene;
    if (hide && hide.parentElement === this.stage) this.stage.removeChild(hide);
    if (show.parentElement !== this.stage) this.stage.insertBefore(show, this.stage.firstChild);
  }

  resize(): void {
    const w = this.stage.clientWidth || window.innerWidth || 1;
    const h = this.stage.clientHeight || window.innerHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[this.effective]);
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    if (cw === this.cw && ch === this.ch && this.scene.width === cw && this.scene.height === ch) return;
    this.cw = cw;
    this.ch = ch;
    this.scene.width = cw;
    this.scene.height = ch;
    this.postfx?.resize(cw, ch);
    this.camera.setViewport(cw, ch);
    this.vignette = null;
  }

  /** Re-checks devicePixelRatio (zoom / monitor changes) once per frame; cheap. */
  private checkDpr(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[this.effective]);
    if (dpr !== this.dpr) this.resize();
  }

  // --- Feedback hooks ------------------------------------------------------------------

  private addShockwave(x: number, y: number, strength: number): void {
    let slot = this.shocks[0];
    for (const s of this.shocks) {
      if (!s.active) { slot = s; break; }
      if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.strength = Math.max(0, Math.min(1, strength)) * (this.settings.reducedMotion ? 0.35 : 1);
  }

  private addFlash(color: string, intensity: number): void {
    const amount = Math.max(0, Math.min(1, intensity)) * (this.settings.reducedMotion ? 0.3 : 1);
    if (amount < this.flashAmount * 0.6) return;
    const [r, g, b] = hexToRgb(color);
    this.flashR = r / 255;
    this.flashG = g / 255;
    this.flashB = b / 255;
    this.flashAmount = Math.max(this.flashAmount, amount);
  }

  // --- Events and rounds ---------------------------------------------------------------

  handleEvent(e: GameEvent, state: GameState): void {
    try {
      this.fx.handleEvent(e, state);
    } catch (err) {
      this.fail('fx.handleEvent', err);
    }
    try {
      this.entities.handleEvent(e, state);
    } catch (err) {
      this.fail('entities.handleEvent', err);
    }
    switch (e.type) {
      case 'explosion':
        this.terrainLayer.addCraterGlow(e.x, e.y, e.radius, e.kind);
        if (e.kind !== 'none') this.decor.blast(e.x, e.y, e.radius);
        break;
      case 'fire': {
        // Recoil nudge opposite to the shot direction (angle is world-absolute degrees, y down).
        const a = e.angle * DEG, k = 1.5 + e.power / 45;
        this.camera.kick(-Math.cos(a) * k, Math.sin(a) * k);
        this.camera.addTrauma(0.06);
        break;
      }
      case 'roundStart':
        if (state.terrain !== this.terrainLayer.current) this.onRoundStart(state);
        break;
      default:
        break;
    }
  }

  onRoundStart(state: GameState): void {
    const biome = BIOMES[state.biome];
    this.biomeId = state.biome;
    this.terrainLayer.setBiome(biome);
    this.terrainLayer.reset(state.terrain);
    try {
      this.background.setBiome(state.biome, state.seed);
    } catch (e) {
      this.fail('background.setBiome', e);
    }
    this.decor.build(biome, state.seed, state.terrain, [state.tanks[0].x, state.tanks[1].x], this.effective === 'low');
    try {
      this.fx.clear();
    } catch (e) {
      this.fail('fx.clear', e);
    }
    try {
      this.entities.clear();
    } catch (e) {
      this.fail('entities.clear', e);
    }
    this.camera.reset();
    this.flashAmount = 0;
    this.chromaAmount = 0;
    for (const s of this.shocks) s.active = false;
  }

  /** Logs a module failure once (modules are independent; one bad layer must not kill the frame). */
  private fail(where: string, e: unknown): void {
    if (this.failed.has(where)) return;
    this.failed.add(where);
    console.error(`[renderer] ${where} failed`, e);
  }

  // --- Frame ---------------------------------------------------------------------------

  render(state: GameState, game: GameApi, frame: RenderFrame): void {
    const t0 = performance.now();
    const realDt = Math.max(0, Math.min(frame.realDt, 0.1));
    const dt = Math.max(0, frame.dt);
    this.trackPerformance(realDt);
    if (state.terrain !== this.terrainLayer.current) this.onRoundStart(state);
    this.checkDpr();

    // --- Advance ---
    let highY = Infinity;
    for (const p of state.projectiles) if (p.y < highY) highY = p.y;
    this.camera.setAttract(frame.attract);
    this.camera.setHighPoint(highY);
    this.camera.update(realDt);
    try { this.background.update(realDt, state.wind, frame.time); } catch (e) { this.fail('background.update', e); }
    try { this.entities.update(dt, state); } catch (e) { this.fail('entities.update', e); }
    try { this.fx.update(dt, state); } catch (e) { this.fail('fx.update', e); }
    this.terrainLayer.update(dt);
    this.terrainLayer.sync(realDt);
    this.decor.update(dt, frame.time);
    this.flashAmount = Math.max(0, this.flashAmount - realDt * 3.2);
    this.chromaAmount = Math.max(0, this.chromaAmount - realDt * 2.4);
    for (const s of this.shocks) {
      if (!s.active) continue;
      s.age += realDt;
      if (s.age >= SHOCK_LIFE) s.active = false;
    }

    const v = this.view, cam = this.camera;
    v.left = cam.left; v.top = cam.top; v.right = cam.right; v.bottom = cam.bottom;
    v.scale = cam.scale; v.cw = this.cw; v.ch = this.ch; v.dpr = this.dpr;
    v.time = frame.time; v.dt = dt; v.quality = this.effective; v.reducedMotion = this.settings.reducedMotion;
    cam.matrix(this.mat);

    // --- Draw ---
    const ctx = this.ctx;
    this.resetDevice(ctx);
    try { this.background.drawBack(ctx, v); } catch (e) { this.fail('background.drawBack', e); this.fallbackSky(ctx); }

    this.resetWorld(ctx);
    let fxLights: readonly LightSource[] = this.decor.lights;
    try { fxLights = this.fx.lights(); } catch (e) { this.fail('fx.lights', e); }
    const lights = this.lightBuf;
    lights.length = 0;
    for (let i = 0; i < fxLights.length; i++) lights.push(fxLights[i]);
    if (fxLights !== this.decor.lights) for (let i = 0; i < this.decor.lights.length; i++) lights.push(this.decor.lights[i]);
    this.terrainLayer.draw(ctx, v, lights);
    this.decor.draw(ctx, this.mat, v, frame.time, state.wind);

    this.resetWorld(ctx);
    try { this.fx.drawBack(ctx, v, state); } catch (e) { this.fail('fx.drawBack', e); }
    this.resetWorld(ctx);
    try { this.entities.drawCrates(ctx, state, v); } catch (e) { this.fail('entities.drawCrates', e); }
    this.drawTanks(ctx, state, frame, dt);
    this.resetWorld(ctx);
    try { this.entities.drawProjectiles(ctx, state, v); } catch (e) { this.fail('entities.drawProjectiles', e); }
    this.resetWorld(ctx);
    try { this.fx.drawFront(ctx, v, state); } catch (e) { this.fail('fx.drawFront', e); }
    this.resetWorld(ctx);
    try { this.background.drawFront(ctx, v); } catch (e) { this.fail('background.drawFront', e); }
    this.resetWorld(ctx);
    if (!this.postActive) this.drawShockRings(ctx);
    try { this.overlay.draw(ctx, v, state, game, frame); } catch (e) { this.fail('overlay.draw', e); }

    this.resetDevice(ctx);
    if (this.postActive && this.postfx) {
      this.renderPost(frame);
    } else {
      this.drawFallbackGrade(ctx);
    }
    const ms = performance.now() - t0;
    this.frameMsAvg += (ms - this.frameMsAvg) * 0.05;
  }

  private resetDevice(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private resetWorld(ctx: CanvasRenderingContext2D): void {
    const m = this.mat;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawTanks(ctx: CanvasRenderingContext2D, state: GameState, frame: RenderFrame, dt: number): void {
    const info = this.tankInfo;
    info.time = frame.time;
    info.dt = dt;
    info.biome = state.biome;
    const turnPhase = state.phase === 'aiming' || state.phase === 'flight' || state.phase === 'settle' || state.phase === 'turnEnd';
    // Draw the inactive tank first so the active one sits on top when they overlap.
    for (let k = 0; k < 2; k++) {
      const i = k === 0 ? 1 - state.activePlayer : state.activePlayer;
      const tank = state.tanks[i];
      info.team = TEAMS[i];
      info.active = i === state.activePlayer && turnPhase && !frame.attract;
      info.aiming = info.active && state.phase === 'aiming';
      this.resetWorld(ctx);
      try { this.tankRenderer.draw(ctx, tank, info); } catch (e) { this.fail('tanks.draw', e); }
    }
  }

  /** Converts world-space shockwaves to UV and hands everything to the WebGL pass. */
  private renderPost(frame: RenderFrame): void {
    const pf = this.postFrame, cam = this.camera, ch = this.ch, cw = this.cw;
    const list = pf.shockwaves as Shockwave[];
    list.length = 0;
    let n = 0;
    for (const s of this.shocks) {
      if (!s.active) continue;
      const t = s.age / SHOCK_LIFE;
      const p = cam.worldToDevice(s.x, s.y, this.tmpVec);
      const rWorld = (50 + 260 * s.strength) * easeOutCubic(t);
      const o = this.shockOut[n++];
      o.x = p.x / cw;
      o.y = p.y / ch;
      o.radius = (rWorld * cam.scale) / ch;
      o.width = ((16 + 30 * s.strength) * cam.scale / ch) * (1 - t * 0.4);
      o.strength = s.strength * Math.pow(1 - t, 1.6);
      list.push(o);
    }
    pf.time = frame.time;
    pf.grade = BIOMES[this.biomeId].grade;
    pf.bloomScale = BLOOM_SCALE[this.effective];
    pf.chroma = this.chromaAmount;
    pf.flash.r = this.flashR;
    pf.flash.g = this.flashG;
    pf.flash.b = this.flashB;
    pf.flash.amount = this.flashAmount;
    pf.grain = GRAIN[this.effective];
    pf.quality = this.effective;
    try {
      this.postfx?.render(this.scene, pf);
    } catch (e) {
      this.fail('postfx.render', e);
      // A broken post pass must not leave the screen frozen: fall back to the scene canvas.
      this.settings.postFx = false;
      this.updateCanvasMode();
    }
  }

  /** 2D stand-in for the distortion pass: soft expanding rings (world space). */
  private drawShockRings(ctx: CanvasRenderingContext2D): void {
    let any = false;
    for (const s of this.shocks) if (s.active) { any = true; break; }
    if (!any) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff';
    for (const s of this.shocks) {
      if (!s.active) continue;
      const t = s.age / SHOCK_LIFE;
      const r = (50 + 260 * s.strength) * easeOutCubic(t);
      ctx.globalAlpha = 0.1 * s.strength * (1 - t) * (1 - t);
      ctx.lineWidth = (4 + 8 * s.strength) * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Without post-processing: cached vignette plus the additive flash. */
  private drawFallbackGrade(ctx: CanvasRenderingContext2D): void {
    const grade = BIOMES[this.biomeId].grade;
    if (!this.vignette) {
      const cx = this.cw / 2, cy = this.ch / 2, r = Math.hypot(cx, cy);
      const g = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      this.vignette = g;
    }
    ctx.globalAlpha = Math.min(0.7, grade.vignette * 0.9);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.globalAlpha = 1;
    if (this.flashAmount > 0.005) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${Math.round(this.flashR * 255)},${Math.round(this.flashG * 255)},${Math.round(this.flashB * 255)},${(this.flashAmount * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Used only if the background module fails: never leave the canvas black. */
  private fallbackSky(ctx: CanvasRenderingContext2D): void {
    const p = BIOMES[this.biomeId].palette;
    this.resetDevice(ctx);
    ctx.fillStyle = p.sky[1];
    ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.fillStyle = rgba(p.sky[2], 0.6);
    ctx.fillRect(0, this.ch * 0.5, this.cw, this.ch * 0.5);
  }

  /** FPS stats and 'auto' quality: drop a tier when the 2 s mean frame time exceeds 20 ms. */
  private trackPerformance(realDt: number): void {
    if (realDt <= 0) return;
    this.fpsAvg += (1 / realDt - this.fpsAvg) * 0.05;
    this.sinceTierChange += realDt;
    if (this.warmup > 0) {
      this.warmup -= realDt;
      return;
    }
    if (this.settings.quality !== 'auto') return;
    this.autoSum += realDt;
    this.autoCount++;
    this.autoClock += realDt;
    if (this.autoClock < 2) return;
    const avg = this.autoSum / this.autoCount;
    this.autoSum = this.autoCount = this.autoClock = 0;
    if (avg > 0.02 && this.sinceTierChange >= 5) {
      const i = TIERS.indexOf(this.effective);
      if (i > 0) {
        this.effective = TIERS[i - 1];
        this.sinceTierChange = 0;
        this.qualityChanged();
      }
    }
  }

  stats(): RenderStats {
    let particles = 0;
    try { particles = this.fx.particleCount(); } catch { particles = 0; }
    return { fps: Math.round(this.fpsAvg), frameMs: Math.round(this.frameMsAvg * 100) / 100, particles, postFx: this.postActive };
  }

  thumbnail(biome: BiomeId, width: number, height: number): HTMLCanvasElement {
    return this.background.thumbnail(biome, width, height);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const r = this.stage.getBoundingClientRect();
    const sx = this.cw / (r.width || this.cssW), sy = this.ch / (r.height || this.cssH);
    const out = { x: 0, y: 0 };
    this.camera.deviceToWorld((clientX - r.left) * sx, (clientY - r.top) * sy, out);
    return out;
  }

  worldToScreen(x: number, y: number): Vec2 {
    const r = this.stage.getBoundingClientRect();
    const sx = (r.width || this.cssW) / this.cw, sy = (r.height || this.cssH) / this.ch;
    const p = this.camera.worldToDevice(x, y, { x: 0, y: 0 });
    return { x: r.left + p.x * sx, y: r.top + p.y * sy };
  }

  /** Releases observers and GPU resources (not needed by the app, handy for sandboxes/HMR). */
  dispose(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.postfx?.dispose();
    this.scene.remove();
  }
}

function styleCanvas(c: HTMLCanvasElement): void {
  const s = c.style;
  s.position = 'absolute';
  s.left = '0';
  s.top = '0';
  s.width = '100%';
  s.height = '100%';
  s.display = 'block';
}
