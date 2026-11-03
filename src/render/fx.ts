/**
 * Effects system: particles, explosions, weapon/event effects, hazard visuals, floating numbers and
 * dynamic lights. Event-driven spawning (fx/events.ts, fx/explosions.ts), per-frame hazard and
 * ambient emission, pooled storage everywhere so steady-state frames allocate nothing.
 */
import type { FxApi, FxHooks, LightSource, ViewInfo } from '../contracts.ts';
import type { GameEvent } from '../core/events.ts';
import type { Quality } from '../core/settings.ts';
import type { GameState, TankState } from '../core/types.ts';
import { hullPoint } from '../core/geometry.ts';
import { clamp01 } from '../core/math.ts';
import { LAYER_BACK, LAYER_FRONT, P_DUST, P_FIRE, P_SMOKE, F_SMOKE_TAIL } from './particles.ts';
import { E_BOLT, E_CHUNK, E_FIREBALL, E_TEXT, drawEffect, jaggedLine, type Effect } from './fx/effects.ts';
import { handleEvent, type EventCtx } from './fx/events.ts';
import { drawHazards, hazardLights, updateHazards } from './fx/hazards.ts';
import { Kit, rr } from './fx/kit.ts';

const CAPACITY: Record<Quality, number> = { high: 3500, medium: 1800, low: 700 };
const SPAWN_SCALE: Record<Quality, number> = { high: 1, medium: 0.62, low: 0.32 };
const MAX_LIGHTS = 16;
const MAX_CANDIDATES = 96;

export class Fx implements FxApi {
  private readonly k: Kit;
  private readonly ev: EventCtx;
  private quality: Quality = 'high';
  private state: GameState | null = null;
  private biome = '';
  private time = 0;

  // Ambient emission accumulators per tank: [smoke, fire, ember, spark, exhaust, tread].
  private readonly acc = new Float32Array(12);

  // Light candidate storage (struct of arrays) and the pooled output list.
  private readonly cx = new Float32Array(MAX_CANDIDATES);
  private readonly cy = new Float32Array(MAX_CANDIDATES);
  private readonly cr = new Float32Array(MAX_CANDIDATES);
  private readonly ci = new Float32Array(MAX_CANDIDATES);
  private readonly cc: string[] = new Array<string>(MAX_CANDIDATES).fill('#ffffff');
  private readonly used = new Uint8Array(MAX_CANDIDATES);
  private nc = 0;
  private readonly lightPool: LightSource[] = [];
  private readonly lightOut: LightSource[] = [];
  private readonly pushLight = (x: number, y: number, r: number, c: string, i: number): void => {
    if (this.nc >= MAX_CANDIDATES || i <= 0.01) return;
    const n = this.nc++;
    this.cx[n] = x; this.cy[n] = y; this.cr[n] = r; this.ci[n] = i; this.cc[n] = c;
  };
  private readonly tickEffect = (e: Effect, dt: number): void => this.onEffectTick(e, dt);

  constructor(hooks: FxHooks) {
    this.k = new Kit(hooks, CAPACITY.high);
    this.ev = { k: this.k, now: 0, destroyedAt: new Float64Array([-1, -1]) };
    for (let i = 0; i < MAX_LIGHTS; i++) this.lightPool.push({ x: 0, y: 0, radius: 0, color: '#ffffff', intensity: 0 });
  }

  setQuality(quality: Quality, reducedMotion: boolean): void {
    this.quality = quality;
    this.k.reducedMotion = reducedMotion;
    this.k.scale = SPAWN_SCALE[quality] * (reducedMotion ? 0.55 : 1);
    if (this.k.p.capacity !== CAPACITY[quality]) this.k.p.resize(CAPACITY[quality]);
  }

  clear(): void {
    this.k.clear();
    this.acc.fill(0);
    this.ev.destroyedAt[0] = this.ev.destroyedAt[1] = -1;
  }

  particleCount(): number {
    return this.k.p.count;
  }

  handleEvent(e: GameEvent, state: GameState): void {
    this.sync(state);
    this.ev.now = this.k.now;
    handleEvent(this.ev, e, state);
  }

  private sync(state: GameState): void {
    this.state = state;
    this.k.terrain = state.terrain;
    if (state.biome !== this.biome) {
      this.biome = state.biome;
      this.k.setBiome(state.biome);
    }
  }

  update(dt: number, state: GameState): void {
    this.sync(state);
    if (dt <= 0) return;
    this.time += dt;
    const k = this.k;
    k.tick(dt);
    k.fx.update(dt, this.tickEffect);
    updateHazards(k, state, dt);
    this.ambient(dt, state);
    k.p.update(dt, state.gravity, state.wind, state.terrain);
  }

  /** Per-effect behaviour while alive: bolt crackle, turret chunk physics and smoke trail. */
  private onEffectTick(e: Effect, dt: number): void {
    if (e.type === E_BOLT) {
      e.timer += dt;
      // Re-jitter a couple of times for a crackling, living bolt.
      if (e.pts && e.timer > 0.07 && e.t < e.life * 0.7 && ((e.timer / 0.07) | 0) !== ((e.timer - dt) / 0.07 | 0)) {
        e.n = jaggedLine(e.pts, e.x, e.y, e.w, e.h, e.r2, 1);
      }
    } else if (e.type === E_CHUNK) {
      const g = this.state ? this.state.gravity : 520;
      e.vy += g * dt;
      e.vx *= 1 - 0.3 * dt;
      const t = this.k.terrain;
      if (t && e.vy > 0 && t.isSolid(e.x, e.y + 8)) {
        e.vy = -e.vy * 0.3; e.vx *= 0.5; e.vrot *= 0.4;
        e.y -= 2;
        if (Math.abs(e.vy) < 40) { e.vy = 0; e.vx = 0; e.vrot = 0; }
        this.k.dustPuff(e.x, e.y + 6, 3, 6, 20, 1, 0, -12);
      }
      e.timer += dt;
      if (e.timer > 0.03) {
        e.timer = 0;
        const life = e.t < 1.6 ? 1 : 0.4;
        this.k.smoke(e.x, e.y, life, 3, 16, 1.4, 10, true, 0.55);
        if (e.t < 1.2) {
          const j = this.k.p.spawn(P_FIRE, e.x, e.y, 0, 0, 0.25, 12, 0);
          if (j >= 0) this.k.p.s1[j] = 6;
        }
      }
    }
  }

  // --- Ambient tank effects ----------------------------------------------------------------

  private ambient(dt: number, state: GameState): void {
    for (let i = 0; i < 2; i++) this.tankAmbient(dt, state.tanks[i], i * 6);
  }

  private emit(slot: number, rate: number, dt: number): number {
    const a = this.acc[slot] + rate * dt * this.k.scale;
    const n = Math.floor(a);
    this.acc[slot] = a - n;
    return n;
  }

  private tankAmbient(dt: number, t: TankState, base: number): void {
    const k = this.k;
    const top = hullPoint(t, 18, 0);
    if (!t.alive) {
      // Wreck: thick smoke, smouldering embers, flames dying down over ~6 s.
      const since = this.ev.destroyedAt[t.index] >= 0 ? k.now - this.ev.destroyedAt[t.index] : 99;
      const burn = clamp01(1 - since / 6);
      for (let n = this.emit(base, 9, dt); n > 0; n--) k.smoke(top.x + rr(-12, 12), top.y, 1, 4, 26, 3, 38, true, 0.58);
      for (let n = this.emit(base + 1, 14 * burn + 1.5, dt); n > 0; n--) this.flame(top.x + rr(-16, 16), top.y + 4, 0.8 + burn * 0.6);
      for (let n = this.emit(base + 2, 3, dt); n > 0; n--) k.embers(top.x, top.y, 1, 70, k.emberOrange, 1.6, 4, 12);
      return;
    }
    const hp = t.hp / t.maxHp;
    if (hp < 0.5) {
      const sev = (0.5 - hp) / 0.5;
      for (let n = this.emit(base, 3 + sev * 7, dt); n > 0; n--) {
        k.smoke(top.x + rr(-8, 8), top.y, 1, 3, 17 + sev * 12, 2 + sev, 30, sev > 0.4, 0.42 + sev * 0.2);
      }
    }
    if (hp < 0.25) {
      const sev = (0.25 - hp) / 0.25;
      for (let n = this.emit(base + 1, 14 + sev * 12, dt); n > 0; n--) this.flame(top.x + rr(-12, 12), top.y + 2, 0.85 + sev * 0.45);
      for (let n = this.emit(base + 2, 2 + sev * 3, dt); n > 0; n--) k.embers(top.x, top.y, 1, 60, k.emberOrange, 1.3, 4, 8);
    }
    if (hp < 0.35) {
      for (let n = this.emit(base + 3, 0.9, dt); n > 0; n--) {
        const side = rr(-20, 20);
        const p = hullPoint(t, rr(6, 16), side);
        k.sparks(p.x, p.y, 4, 80, 260, k.sparkGold, 0.35, 2, -Math.PI / 2, 1.2);
      }
    }
    if (t.moveDir !== 0 && !t.airborne) {
      // Exhaust from the rear deck (rear = away from where the barrel points).
      const facing = t.angle > 90 ? -1 : 1;
      for (let n = this.emit(base + 4, 12, dt); n > 0; n--) {
        const p = hullPoint(t, 16, -facing * 24);
        const j = k.p.spawn(P_SMOKE, p.x, p.y, -facing * rr(10, 30), rr(-30, -14), rr(0.6, 1), rr(6, 9), k.smokeDark[n & 3]);
        if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 2.6; k.p.alpha[j] = 0.3; }
      }
      // Tread dust kicked from both ends, behind the tank.
      for (let n = this.emit(base + 5, 18, dt); n > 0; n--) {
        const end = n & 1 ? 26 : -26;
        const p = hullPoint(t, 1, end);
        const j = k.p.spawn(P_DUST, p.x, p.y, -t.moveDir * rr(20, 50) + Math.sign(end) * 6, rr(-26, -8), rr(0.5, 0.9), rr(8, 14), k.dust[n & 3]);
        if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 2; k.p.alpha[j] = 0.35; k.p.layer[j] = LAYER_BACK; }
      }
    }
  }

  private flame(x: number, y: number, s: number): void {
    const j = this.k.p.spawn(P_FIRE, x, y, rr(-10, 10), rr(-80, -45), rr(0.35, 0.65), rr(13, 20) * s, 0);
    if (j >= 0) {
      this.k.p.s1[j] = this.k.p.s0[j] * 0.5;
      this.k.p.grav[j] = -0.1;
      this.k.p.wind[j] = 1;
      if (Math.random() < 0.3) this.k.p.flags[j] |= F_SMOKE_TAIL;
    }
  }

  // --- Drawing ---------------------------------------------------------------------------

  drawBack(ctx: CanvasRenderingContext2D, view: ViewInfo, _state: GameState): void {
    const m = 80;
    this.k.p.draw(ctx, LAYER_BACK, view.left - m, view.top - m, view.right + m, view.bottom + m);
    this.drawEffects(ctx, view, true);
  }

  drawFront(ctx: CanvasRenderingContext2D, view: ViewInfo, state: GameState): void {
    drawHazards(ctx, this.k, state, view);
    const m = 80;
    this.k.p.draw(ctx, LAYER_FRONT, view.left - m, view.top - m, view.right + m, view.bottom + m);
    this.drawEffects(ctx, view, false);
  }

  /** Shapes (additive), then normal-blend shapes, then floating text on top of everything. */
  private drawEffects(ctx: CanvasRenderingContext2D, view: ViewInfo, back: boolean): void {
    const list = this.k.fx.active;
    if (!list.length) return;
    ctx.save();
    // Normal-blend bodies first (fireball bodies, chunks), then the additive pass on top.
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.back !== back || e.type === E_TEXT) continue;
      if (e.normal || e.type === E_CHUNK || e.type === E_FIREBALL) drawEffect(ctx, e, view.time, 0);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.back !== back || e.normal || e.type === E_CHUNK) continue;
      drawEffect(ctx, e, view.time, 1);
    }
    if (!back) {
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.type === E_TEXT) drawEffect(ctx, e, view.time);
      }
    }
    ctx.restore();
  }

  // --- Lights --------------------------------------------------------------------------

  lights(): readonly LightSource[] {
    this.nc = 0;
    const push = this.pushLight;
    // Effects: lights decay with an ease-out over their life.
    for (const e of this.k.fx.active) {
      if (e.lightI <= 0 || e.delay > 0) continue;
      const t = clamp01(e.t / e.life);
      const f = (1 - t) * (1 - t);
      push(e.x, e.y, e.lightR * (0.7 + 0.3 * f), e.lightColor, e.lightI * f);
    }
    const s = this.state;
    if (s) {
      hazardLights(this.k, s, this.time, push);
      for (const t of s.tanks) {
        const burning = !t.alive || t.hp / t.maxHp < 0.25;
        if (!burning) continue;
        const p = hullPoint(t, 16, 0);
        const fl = 0.75 + 0.25 * Math.sin(this.time * 17 + t.index * 3) * Math.sin(this.time * 7.3);
        push(p.x, p.y, 90, '#ff7a24', (t.alive ? 0.55 : 0.7) * fl);
      }
    }
    // Pick the strongest (intensity × radius) up to MAX_LIGHTS, strongest first.
    const n = this.nc;
    const used = this.used;
    used.fill(0, 0, n);
    const out = this.lightOut;
    out.length = 0;
    const max = Math.min(MAX_LIGHTS, n);
    for (let slot = 0; slot < max; slot++) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const sc = this.ci[i] * this.cr[i];
        if (sc > bestScore) { bestScore = sc; best = i; }
      }
      if (best < 0) break;
      used[best] = 1;
      const L = this.lightPool[slot];
      L.x = this.cx[best]; L.y = this.cy[best]; L.radius = this.cr[best]; L.color = this.cc[best]; L.intensity = this.ci[best];
      out.push(L);
    }
    return out;
  }

  /** Diagnostics for sandboxes / perf overlays. */
  debugStats(): { particles: number; capacity: number; effects: number; dropped: number; quality: Quality } {
    return { particles: this.k.p.count, capacity: this.k.p.capacity, effects: this.k.fx.active.length, dropped: this.k.p.dropped, quality: this.quality };
  }
}

