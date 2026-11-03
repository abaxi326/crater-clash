/**
 * Projectiles, their trails, and supply crates.
 * Trails are render-side ring buffers keyed by projectile id (src/render/entities/trail.ts); they are
 * sampled every update() at even arc spacing, keep fading after their projectile is gone and are then
 * recycled through a pool. Everything is drawn from cached sprites/gradients (see entities/*).
 */
import type { EntityRendererApi, ViewInfo } from '../contracts.ts';
import { unpackRGBA } from '../core/color.ts';
import type { GameEvent } from '../core/events.ts';
import type { GameState, ProjectileState } from '../core/types.ts';
import { CRATE_WEAPONS, WEAPONS, WEAPON_ORDER, type TrailStyle, type WeaponId } from '../core/weapons.ts';
import { drawBody, fragmentHue, isPlanted, type BodyFrame } from './entities/bodies.ts';
import { canopySprite, crateSprite } from './entities/crateArt.ts';
import { drawCollectGhost, drawCrate, type CrateFx } from './entities/crates.ts';
import { blit, coreSprite, glowSprite, hueGlow, puffSprite, starSprite } from './entities/sprites.ts';
import { Trail, TRAIL_SPEC } from './entities/trail.ts';
import { drawTrail, type TrailFrame } from './entities/trailDraw.ts';

const MAX_SPLITS = 8;
const MAX_GHOSTS = 6;
const MAX_DRILLS = 4;
/** Seconds a split origin stays eligible to seed fragment trails. */
const SPLIT_WINDOW = 0.3;
const GHOST_LIFE = 0.65;

interface SplitMark { x: number; y: number; t: number; weapon: WeaponId; live: boolean }
interface Ghost { x: number; y: number; weapon: WeaponId; t0: number; live: boolean }
interface DrillMark {
  x: number; y: number;
  /** Unit direction of travel into the ground. */
  dx: number; dy: number;
  t0: number;
  /** Real time drilling ended (Infinity while drilling). */
  tEnd: number;
  dirt: string;
  live: boolean;
}

const hash = (n: number): number => {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
};

export class EntityRenderer implements EntityRendererApi {
  private readonly trails: Trail[] = [];
  private readonly pool: Trail[] = [];
  private readonly byId = new Map<number, Trail>();
  /** Accumulated simulation seconds (trail ages follow sim time, so slow-mo slows them too). */
  private now = 0;
  /** Latest real time seen in a draw call (for event-stamped animations). */
  private realTime = 0;
  private wind = 0;
  private readonly splits: SplitMark[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly drills: DrillMark[] = [];
  private readonly crateFx = new Map<number, CrateFx>();
  private readonly tf: TrailFrame = { now: 0, time: 0, wind: 0, quality: 'high' };
  private readonly bf: BodyFrame = { time: 0, lowQuality: false };

  constructor() {
    for (let i = 0; i < MAX_SPLITS; i++) this.splits.push({ x: 0, y: 0, t: 0, weapon: 'ember', live: false });
    for (let i = 0; i < MAX_GHOSTS; i++) this.ghosts.push({ x: 0, y: 0, weapon: 'ember', t0: 0, live: false });
    for (let i = 0; i < MAX_DRILLS; i++) this.drills.push({ x: 0, y: 0, dx: 0, dy: 1, t0: 0, tEnd: 0, dirt: '#8a6a48', live: false });
    if (typeof document !== 'undefined') EntityRenderer.prewarm();
  }

  private static warmed = false;

  /** Builds every cached sprite up front so the first shot of each weapon never hitches. */
  static prewarm(): void {
    if (EntityRenderer.warmed) return;
    EntityRenderer.warmed = true;
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      glowSprite(w.glow);
      glowSprite(w.color);
      coreSprite(w.color);
      coreSprite(w.glow);
      starSprite(w.color);
      puffSprite(w.color);
    }
    for (const c of ['#ffe2a0', '#ff8a24', '#ff3a10', '#ffc24a', '#ff6a1a', '#ffb000', '#3d3632', '#b39a7c']) {
      glowSprite(c);
      coreSprite(c);
      puffSprite(c);
    }
    hueGlow(0);
    for (const id of CRATE_WEAPONS) { crateSprite(id); canopySprite(id); }
  }

  // -------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------

  update(dt: number, state: GameState): void {
    if (dt > 0) this.now += dt;
    const now = this.now;
    this.wind = state.wind;
    for (let i = 0; i < this.trails.length; i++) this.trails[i].seen = false;

    const ps = state.projectiles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const def = WEAPONS[p.weapon];
      if (def.projectile.style === 'none') continue;
      let tr = this.byId.get(p.id);
      if (!tr) tr = this.startTrail(p, now);
      tr.seen = true;
      const style = tr.style;
      const spacing = TRAIL_SPEC[style].spacing * (p.fragment ? 0.8 : 1);
      const drilling = p.mode === 'drill';
      if (drilling !== tr.underground) {
        tr.underground = drilling;
        if (drilling) this.markDrill(p, state);
        else tr.pendingBreak = true;
      }
      const emit = !drilling && style !== 'none' && !isPlanted(p);
      tr.follow(p.x, p.y, p.vx, p.vy, now, spacing, emit);
    }

    // Detach trails whose projectile vanished; expire samples; recycle finished trails.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      if (tr.alive && !tr.seen) {
        tr.alive = false;
        tr.died = now;
        // The projectile ended between frames: extend the ribbon to its last known spot.
        if (!tr.underground && tr.count > 0) tr.push(tr.hx, tr.hy, now);
      }
      const life = TRAIL_SPEC[tr.style].life * (tr.fragment ? 0.75 : 1);
      tr.expire(now, life);
      if (tr.done(now, life)) {
        this.byId.delete(tr.id);
        this.trails[i] = this.trails[this.trails.length - 1];
        this.trails.pop();
        this.pool.push(tr);
      }
    }

    for (let i = 0; i < MAX_SPLITS; i++) {
      const s = this.splits[i];
      if (s.live && now - s.t > SPLIT_WINDOW) s.live = false;
    }
    // Forget fx for crates that no longer exist.
    if (this.crateFx.size > state.crates.length) {
      for (const id of this.crateFx.keys()) {
        let found = false;
        for (let i = 0; i < state.crates.length; i++) if (state.crates[i].id === id) { found = true; break; }
        if (!found) this.crateFx.delete(id);
      }
    }
  }

  private startTrail(p: ProjectileState, now: number): Trail {
    const def = WEAPONS[p.weapon];
    let style: TrailStyle = def.projectile.trail;
    let hue = -1;
    if (p.fragment && p.weapon === 'fireworks') {
      hue = fragmentHue(p);
      if (hue < 0) hue = (p.id * 47) % 360;
      style = 'spark';
    } else if (p.fragment && p.weapon === 'starfall') {
      style = 'spark';
    }
    const tr = this.pool.pop() ?? new Trail();
    tr.reset(p.id, p.weapon, style, p.fragment, hue, now);
    this.trails.push(tr);
    this.byId.set(p.id, tr);
    // Fragments continue from the parent's split point so the streaks fan out of one spot.
    if (p.fragment) {
      let best: SplitMark | null = null;
      let bestD = 90 * 90;
      for (let i = 0; i < MAX_SPLITS; i++) {
        const s = this.splits[i];
        if (!s.live || s.weapon !== p.weapon) continue;
        const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
        if (d < bestD) { bestD = d; best = s; }
      }
      if (best) tr.seed(best.x, best.y, p.vx, p.vy, best.t);
    }
    return tr;
  }

  private markDrill(p: ProjectileState, state: GameState): void {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    this.addDrill(p.x, p.y, p.vx / sp, p.vy / sp, state);
  }

  private addDrill(x: number, y: number, dx: number, dy: number, state: GameState): void {
    // Re-use an existing mark at the same spot (event + mode change both report the entry).
    for (let i = 0; i < MAX_DRILLS; i++) {
      const d = this.drills[i];
      if (d.live && d.tEnd === Infinity && Math.abs(d.x - x) + Math.abs(d.y - y) < 24) {
        if (dx !== 0 || dy !== 0) { d.dx = dx; d.dy = dy; }
        return;
      }
    }
    let slot = this.drills[0];
    for (let i = 0; i < MAX_DRILLS; i++) {
      const d = this.drills[i];
      if (!d.live) { slot = d; break; }
      if (d.t0 < slot.t0) slot = d;
    }
    slot.x = x; slot.y = y; slot.dx = dx; slot.dy = dy;
    slot.t0 = this.realTime;
    slot.tEnd = Infinity;
    slot.live = true;
    const terrain = state.terrain;
    const packed = terrain ? terrain.colorAt(Math.round(x), Math.round(y + 3)) : 0;
    const [r, g, b, a] = unpackRGBA(packed);
    slot.dirt = a > 0 ? `rgb(${r},${g},${b})` : '#8a6a48';
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  handleEvent(e: GameEvent, state: GameState): void {
    switch (e.type) {
      case 'roundStart':
      case 'matchStart':
        this.clear();
        break;
      case 'split': {
        let slot = this.splits[0];
        for (let i = 0; i < MAX_SPLITS; i++) {
          const s = this.splits[i];
          if (!s.live) { slot = s; break; }
          if (s.t < slot.t) slot = s;
        }
        slot.x = e.x; slot.y = e.y; slot.t = this.now; slot.weapon = e.weapon; slot.live = true;
        break;
      }
      case 'bounce': {
        // Pin the exact contact point on the nearest live trail so the ribbon turns a crisp corner.
        let best: Trail | null = null;
        let bestD = 60 * 60;
        for (let i = 0; i < this.trails.length; i++) {
          const tr = this.trails[i];
          if (!tr.alive || tr.weapon !== e.weapon) continue;
          const d = (tr.hx - e.x) ** 2 + (tr.hy - e.y) ** 2;
          if (d < bestD) { bestD = d; best = tr; }
        }
        if (best && !best.underground) best.corner(e.x, e.y, this.now);
        break;
      }
      case 'drill':
        if (e.phase === 'start') {
          let dx = 0, dy = 1;
          for (const p of state.projectiles) {
            if (p.weapon !== 'burrower') continue;
            const sp = Math.hypot(p.vx, p.vy);
            if (sp > 0) { dx = p.vx / sp; dy = p.vy / sp; }
            break;
          }
          this.addDrill(e.x, e.y, dx, dy, state);
        } else {
          for (let i = 0; i < MAX_DRILLS; i++) {
            const d = this.drills[i];
            if (d.live && d.tEnd === Infinity) d.tEnd = this.realTime;
          }
        }
        break;
      case 'teleport':
        // The beacon's trail simply fades; nothing to re-key.
        break;
      case 'crate':
        if (e.phase === 'spawn') {
          this.crateFx.set(e.id, { landT: -1, drift: Math.random() < 0.5 ? -1 : 1 });
        } else if (e.phase === 'land') {
          let fx = this.crateFx.get(e.id);
          if (!fx) { fx = { landT: -1, drift: Math.random() < 0.5 ? -1 : 1 }; this.crateFx.set(e.id, fx); }
          fx.landT = this.realTime;
          if (Math.abs(this.wind) > 0.5) fx.drift = this.wind > 0 ? 1 : -1;
        } else {
          this.crateFx.delete(e.id);
          let slot = this.ghosts[0];
          for (let i = 0; i < MAX_GHOSTS; i++) {
            const g = this.ghosts[i];
            if (!g.live) { slot = g; break; }
            if (g.t0 < slot.t0) slot = g;
          }
          slot.x = e.x; slot.y = e.y; slot.weapon = e.weapon; slot.t0 = this.realTime; slot.live = true;
        }
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  drawCrates(ctx: CanvasRenderingContext2D, state: GameState, view: ViewInfo): void {
    this.realTime = view.time;
    const crates = state.crates;
    for (let i = 0; i < crates.length; i++) {
      const c = crates[i];
      if (c.x < view.left - 80 || c.x > view.right + 80 || c.y < view.top - 40 || c.y - 90 > view.bottom) continue;
      drawCrate(ctx, c, this.crateFx.get(c.id), view.time, state.terrain ?? null);
    }
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const g = this.ghosts[i];
      if (!g.live) continue;
      const e = (view.time - g.t0) / GHOST_LIFE;
      if (e >= 1 || e < 0) { g.live = false; continue; }
      drawCollectGhost(ctx, g.x, g.y, g.weapon, e);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState, view: ViewInfo): void {
    this.realTime = view.time;
    const tf = this.tf;
    tf.now = this.now;
    tf.time = view.time;
    tf.wind = this.wind;
    tf.quality = view.quality;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.trails.length; i++) drawTrail(ctx, this.trails[i], tf);
    this.drawDrillSpray(ctx, view);
    const bf = this.bf;
    bf.time = view.time;
    bf.lowQuality = view.quality === 'low';
    const ps = state.projectiles;
    const m = 120;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x < view.left - m || p.x > view.right + m || p.y < view.top - m || p.y > view.bottom + m) continue;
      drawBody(ctx, p, bf);
    }
    ctx.restore();
  }

  /** Dirt kicked back out of a burrower's entry hole while it drills, then a settling dust puff. */
  private drawDrillSpray(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const t = view.time;
    for (let i = 0; i < MAX_DRILLS; i++) {
      const d = this.drills[i];
      if (!d.live) continue;
      const since = t - d.t0;
      const after = d.tEnd === Infinity ? 0 : t - d.tEnd;
      if (after > 1.2 || since > 6) { d.live = false; continue; }
      // Back-spray direction: opposite to travel, biased upward.
      let bx = -d.dx, by = -d.dy - 0.6;
      const bl = Math.hypot(bx, by) || 1;
      bx /= bl; by /= bl;
      const baseAng = Math.atan2(by, bx);
      const N = view.quality === 'low' ? 10 : 22;
      ctx.fillStyle = d.dirt;
      for (let q = 0; q < N; q++) {
        const life = 0.55 + 0.3 * hash(q * 3.1);
        const launch = Math.floor((since - q * (life / N)) / life) * life + q * (life / N);
        const ph = (since - launch) / life;
        if (ph < 0 || ph > 1 || launch < 0) continue;
        if (d.tEnd !== Infinity && d.t0 + launch > d.tEnd) continue;
        const seed = q * 7.13 + Math.floor(launch * 10);
        const ang = baseAng + (hash(seed) - 0.5) * 1.5;
        const sp = 70 + 110 * hash(seed + 1.7);
        const tt = ph * life;
        const x = d.x + Math.cos(ang) * sp * tt;
        const y = d.y + Math.sin(ang) * sp * tt + 260 * tt * tt;
        const r = (1.2 + 2.2 * hash(seed + 2.9)) * (1 - ph * 0.4);
        ctx.globalAlpha = 1 - ph * ph;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Dust billow at the hole.
      const puff = puffSprite('#b39a7c');
      const k = Math.min(1, since / 0.25);
      const fade = d.tEnd === Infinity ? 1 : Math.max(0, 1 - after / 1.2);
      for (let q = 0; q < 3; q++) {
        const ph = ((since * 0.9 + q / 3) % 1);
        ctx.globalAlpha = 0.45 * fade * k * (1 - ph);
        blit(ctx, puff, d.x + (q - 1) * 6 + this.wind * ph * 2, d.y - 4 - ph * 14, 12 + ph * 22);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (let i = 0; i < this.trails.length; i++) this.pool.push(this.trails[i]);
    this.trails.length = 0;
    this.byId.clear();
    for (let i = 0; i < MAX_SPLITS; i++) this.splits[i].live = false;
    for (let i = 0; i < MAX_GHOSTS; i++) this.ghosts[i].live = false;
    for (let i = 0; i < MAX_DRILLS; i++) this.drills[i].live = false;
    this.crateFx.clear();
  }
}
