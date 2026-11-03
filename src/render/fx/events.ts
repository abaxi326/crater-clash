/**
 * GameEvent → effect mapping. Each event spawns a short, layered response built from Kit
 * primitives; explosions are delegated to explosions.ts.
 */
import type { GameEvent } from '../../core/events.ts';
import type { GameState, TankState } from '../../core/types.ts';
import { WEAPONS } from '../../core/weapons.ts';
import { TEAMS } from '../../core/teams.ts';
import { DEG, TAU, clamp } from '../../core/math.ts';
import { tankCenter } from '../../core/geometry.ts';
import { TANK_CENTER_HEIGHT } from '../../core/constants.ts';
import { LAYER_BACK, P_DUST, P_FIRE, P_GLOW, P_SHARD, P_SMOKE } from '../particles.ts';
import { shardSprite } from '../sprites.ts';
import { E_CHUNK, E_COLUMN, E_HEX, E_RETICLE, E_STROKE_RING, E_TEXT } from './effects.ts';
import { bolt, explode, groundGlow } from './explosions.ts';
import { rand, rr, type Kit } from './kit.ts';
import { part, renderText, type TextBitmap, type TextPart } from './text.ts';

const CONFETTI = ['#ff4fd8', '#5ee7ff', '#ffe45c', '#7dff8a', '#ff7a45', '#b18cff', '#ffffff'];
const SHIELD = '#6ee7ff';
const HEAL = '#5dff9b';

/** Per-target stacking so simultaneous numbers do not overlap. */
const stackTime = new Float64Array(2);
const stackIdx = new Int32Array(2);

let plusGlyph: TextBitmap | null = null;

export interface EventCtx {
  k: Kit;
  /** Real-ish clock for text stacking. */
  now: number;
  /** Wreck start times per player (for smoulder intensity). */
  destroyedAt: Float64Array;
}

function floatText(k: Kit, x: number, y: number, bmp: TextBitmap, scale: number, rise: number, life: number, delay = 0): void {
  const e = k.fx.add(E_TEXT, x, y, life);
  e.canvas = bmp.canvas; e.w = bmp.w; e.h = bmp.h;
  e.r = scale; e.r2 = rise; e.delay = delay; e.normal = true;
}

function stackOffset(ctx: EventCtx, target: number): number {
  if (ctx.now - stackTime[target] > 0.7) stackIdx[target] = 0;
  stackTime[target] = ctx.now;
  return stackIdx[target]++ * 30;
}

const tankTop = (t: TankState): { x: number; y: number } => {
  const c = tankCenter(t);
  return { x: c.x, y: c.y - TANK_CENTER_HEIGHT - 30 };
};

export function handleEvent(ctx: EventCtx, e: GameEvent, state: GameState): void {
  const k = ctx.k;
  switch (e.type) {
    case 'roundStart':
      k.clear();
      k.setBiome(e.biome);
      ctx.destroyedAt[0] = ctx.destroyedAt[1] = -1;
      break;

    case 'fire': {
      const w = WEAPONS[e.weapon];
      const big = e.weapon === 'thunderhead';
      const a = e.angle * DEG;
      const dx = Math.cos(a), dy = -Math.sin(a);
      const s = big ? 1.5 : 1;
      // Directional muzzle blast: a cone of short-lived fire, a hot glow and forward sparks.
      k.flash(e.x + dx * 6, e.y + dy * 6, 26 * s, k.glowWhite, 0.1);
      k.flash(e.x + dx * 12, e.y + dy * 12, 60 * s, k.glowSpr(w.glow, 0.4), 0.16, 0.8);
      const n = k.n(9 * s, 4);
      for (let i = 0; i < n; i++) {
        const sp = rr(140, 420) * s;
        const da = rr(-0.28, 0.28);
        const c = Math.cos(da), sn = Math.sin(da);
        const vx = (dx * c - dy * sn) * sp, vy = (dx * sn + dy * c) * sp;
        const j = k.p.spawn(P_FIRE, e.x, e.y, vx, vy, rr(0.1, 0.2), rr(14, 24) * s, 0);
        if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 1.6; k.p.drag[j] = 7; k.p.grav[j] = 0; }
      }
      // Side jets perpendicular to the barrel (muzzle brake).
      for (let side = -1; side <= 1; side += 2) {
        const j = k.p.spawn(P_FIRE, e.x, e.y, -dy * side * 160 * s, dx * side * 160 * s, 0.12, 9 * s, 0);
        if (j >= 0) { k.p.drag[j] = 8; k.p.grav[j] = 0; }
      }
      k.sparks(e.x, e.y, 7 * s, 200, 520, k.sparkSpr(w.glow), 0.35, 2.4, Math.atan2(dy, dx), 0.35);
      // Smoke drifting forward from the muzzle.
      const sm = k.n(3 * s, 2);
      for (let i = 0; i < sm; i++) {
        const sp = rr(30, 90);
        const j = k.p.spawn(P_SMOKE, e.x + dx * 10, e.y + dy * 10, dx * sp + rr(-10, 10), dy * sp - 10, rr(1.1, 1.8), rr(18, 28) * s, k.smokeLight[i & 3]);
        if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 2.6; k.p.alpha[j] = 0.6; }
      }
      k.light(e.x, e.y, 150 * s, '#ffc070', 1.3 * s, 0.14);
      k.shake(big ? 0.32 : 0.15);
      if (big) k.chroma(0.15);
      break;
    }

    case 'utility': {
      const w = WEAPONS[e.weapon];
      k.flash(e.x, e.y - 14, 70, k.glowSpr(w.glow, 0.4), 0.4, 0.6);
      const r = k.fx.add(E_STROKE_RING, e.x, e.y - 14, 0.5);
      r.r = 10; r.r2 = 60; r.color = w.color; r.w = 3; r.a = 0.9;
      break;
    }

    case 'split': {
      const w = WEAPONS[e.weapon];
      k.flash(e.x, e.y, 36, k.glowWhite, 0.14);
      k.flash(e.x, e.y, 70, k.glowSpr(w.glow, 0.5), 0.3, 0.9);
      k.ring(e.x, e.y, 6, 54, k.ringSpr(w.color), 0.35, 0.8);
      k.sparks(e.x, e.y, 14, 140, 380, k.sparkSpr(w.glow), 0.4, 2.6, 0, Math.PI);
      if (e.weapon === 'starfall') k.stars(e.x, e.y, 14, 190, k.starSpr(w.color), 0.9, 24);
      k.light(e.x, e.y, 180, w.glow, 1, 0.25);
      k.shake(0.08);
      break;
    }

    case 'bounce': {
      const w = WEAPONS[e.weapon];
      const ric = e.weapon === 'ricochet';
      const s = clamp(e.speed / 500, 0.5, 1.5);
      k.flash(e.x, e.y, (ric ? 34 : 22) * s, k.glowSpr(w.glow, 0.7), 0.14, 1);
      k.sparks(e.x, e.y, (ric ? 16 : 8) * s, 150, 420 * s, k.sparkSpr(ric ? '#f2e2ff' : w.glow), 0.35, 2.4, -Math.PI / 2, 1.2);
      k.dustPuff(e.x, e.y, 4 * s, 8, 18, 0.9, 0, -20);
      if (ric) {
        const r = k.fx.add(E_STROKE_RING, e.x, e.y, 0.3);
        r.r = 4; r.r2 = 36; r.color = w.color; r.w = 2.5;
      }
      k.light(e.x, e.y, 90, w.glow, 0.8, 0.15);
      k.shake(0.06);
      break;
    }

    case 'drill': {
      const end = e.phase === 'end';
      k.debris(e.x, e.y, 10, end ? 26 : 14, end ? 380 : 260, end ? 5 : 3.5);
      k.dustPuff(e.x, e.y, end ? 10 : 6, 12, end ? 40 : 26, 1.4, 0, -50);
      if (end) {
        k.sparks(e.x, e.y, 10, 160, 380, k.sparkGold, 0.4, 2.4, -Math.PI / 2, 0.8);
        k.shake(0.12);
      }
      break;
    }

    case 'lockOn': {
      const t = state.tanks[e.target];
      const c = tankCenter(t);
      const r = k.fx.add(E_RETICLE, c.x, c.y, 1.25);
      r.r = 34; r.color = '#ff2d55'; r.rot = rand() * TAU; r.normal = true;
      const ping = k.fx.add(E_STROKE_RING, c.x, c.y, 0.6);
      ping.r = 20; ping.r2 = 90; ping.color = '#ff4d6d'; ping.w = 3; ping.normal = true;
      const ping2 = k.fx.add(E_STROKE_RING, e.x, e.y, 0.4);
      ping2.r = 4; ping2.r2 = 40; ping2.color = '#ff4d6d'; ping2.w = 2;
      k.light(c.x, c.y, 110, '#ff3b5c', 0.7, 0.6);
      break;
    }

    case 'explosion': {
      const w = WEAPONS[e.weapon];
      explode(k, e.kind, e.x, e.y, e.radius, e.primary, w.color, w.glow);
      if (e.kind !== 'dirt' && e.kind !== 'none') groundGlow(k, e.x, e.y, e.radius, e.kind === 'void' ? w.glow : '#ff9a40');
      break;
    }

    case 'mound': {
      if (e.radius <= 4) break;
      const n = k.n(e.radius / 4);
      for (let i = 0; i < n; i++) {
        const gx = e.x + rr(-1, 1) * e.radius;
        k.dustPuff(gx, k.groundY(gx, e.y), 1, 4, e.radius * 0.5, 1.8, 0, -30);
      }
      break;
    }

    default:
      handleEvent2(ctx, e, state);
  }
}

function handleEvent2(ctx: EventCtx, e: GameEvent, state: GameState): void {
  const k = ctx.k;
  switch (e.type) {
    case 'damage': {
      const t = state.tanks[e.target];
      const top = tankTop(t);
      const team = TEAMS[e.target];
      const off = stackOffset(ctx, e.target);
      const lines: TextPart[][] = [];
      if (e.direct) lines.push([part('DIRECT HIT!', 15, '#ffd84a', 900)]);
      const main: TextPart[] = [];
      if (e.amount > 0) main.push(part(`-${e.amount}`, e.amount >= 30 ? 40 : 32, team.primary, 900));
      if (e.absorbed > 0) main.push(part(`${e.absorbed}`, 22, SHIELD, 800, true));
      if (!main.length) break;
      lines.push(main);
      const size = 1 + clamp(e.amount / 60, 0, 0.45);
      floatText(k, top.x, top.y - off, renderText(lines), size, 46, 1.6);
      // Hit sparks at the tank.
      const c = tankCenter(t);
      k.sparks(c.x, c.y, e.direct ? 16 : 8, 160, 420, k.sparkSpr(e.direct ? '#fff1a8' : '#ffb54a'), 0.4, 2.6, -Math.PI / 2, 1.4);
      if (e.direct) {
        k.flash(c.x, c.y, 60, k.glowWhite, 0.14, 0.9);
        k.hitStop(0.06);
        k.shake(0.3);
      }
      if (e.absorbed > 0) {
        const r = k.fx.add(E_HEX, c.x, c.y, 0.5);
        r.r = 44; r.r2 = 9; r.color = SHIELD; r.a = 0.9;
      }
      break;
    }

    case 'heal': {
      const t = state.tanks[e.target];
      const top = tankTop(t);
      const c = tankCenter(t);
      floatText(k, top.x, top.y - stackOffset(ctx, e.target), renderText([[part(`+${e.amount}`, 36, HEAL, 900)]]), 1.1, 46, 1.6);
      k.flash(c.x, c.y, 90, k.glowSpr('#22ff7a', 0.4), 0.5, 0.6);
      k.stars(c.x, c.y, 18, 120, k.starSpr(HEAL), 1.1, 12);
      // Rising plus glyphs around the hull.
      if (!plusGlyph) plusGlyph = renderText([[part('+', 22, HEAL, 900)]], '#0b2a18');
      const n = k.n(8, 4);
      for (let i = 0; i < n; i++) {
        floatText(k, c.x + rr(-34, 34), c.y + rr(-6, 14), plusGlyph, rr(0.55, 1), rr(40, 70), rr(0.9, 1.4), i * 0.07);
      }
      k.light(c.x, c.y, 120, '#5dff9b', 0.8, 0.8);
      break;
    }

    case 'shieldUp': {
      const t = state.tanks[e.target];
      const c = tankCenter(t);
      const r = k.fx.add(E_HEX, c.x, c.y, 0.75);
      r.r = 46; r.r2 = 9; r.color = SHIELD; r.a = 1;
      k.ring(c.x, c.y, 8, 64, k.ringSpr(SHIELD), 0.45, 0.8);
      k.flash(c.x, c.y, 100, k.glowSpr('#3dd8ff', 0.4), 0.45, 0.6);
      k.stars(c.x, c.y, 10, 90, k.starSpr(SHIELD), 0.8, 10);
      k.light(c.x, c.y, 140, SHIELD, 0.9, 0.6);
      break;
    }

    case 'shieldBreak': {
      k.shards(e.x, e.y, 24, 320, SHIELD, 1.1, 11);
      k.flash(e.x, e.y, 80, k.glowSpr('#bff8ff', 0.8), 0.18);
      k.ring(e.x, e.y, 30, 90, k.ringSpr(SHIELD), 0.35, 0.9);
      k.sparks(e.x, e.y, 12, 200, 460, k.sparkSpr(SHIELD), 0.4, 2.4, 0, Math.PI);
      k.light(e.x, e.y, 150, SHIELD, 1.2, 0.3);
      k.shake(0.2);
      k.chroma(0.25);
      break;
    }

    case 'tankDestroyed': {
      const t = state.tanks[e.target];
      const team = TEAMS[e.target];
      const x = e.x, y = e.y;
      ctx.destroyedAt[e.target] = k.now;
      // Stage 1: a heavy blast centred on the hull.
      explode(k, 'heavy', x, y, 64, true, '#ff5a36', '#ff8a2a');
      groundGlow(k, x, y, 64, '#ff7a30');
      // The turret is blown off, spinning, trailing smoke.
      const chunk = k.fx.add(E_CHUNK, x, y - 18, 2.6);
      const dir = t.angle > 90 ? 1 : -1;
      chunk.vx = dir * rr(90, 170); chunk.vy = rr(-560, -460);
      chunk.vrot = dir * rr(9, 13); chunk.color = team.primary;
      chunk.lightR = 70; chunk.lightI = 0.7; chunk.lightColor = '#ff8a30';
      // Stage 2: secondary cook-off pops around the wreck.
      for (let i = 0; i < 3; i++) {
        k.later(0.22 + i * 0.16, () => {
          const px = x + rr(-26, 26), py = y - rr(4, 24);
          explode(k, 'small', px, py, rr(18, 26), false, '#ffb347', '#ff7a1a');
        });
      }
      // Stage 3: a burning hulk.
      k.later(0.5, () => {
        k.fire(x, y - 10, 18, 20, 40, 1, 80);
        k.embers(x, y - 12, 26, 220, k.emberOrange, 2.2, 5, 16);
        k.smoke(x, y - 30, 5, 22, 70, 3.4, 40);
      });
      k.sparks(x, y, 30, 300, 900, k.sparkGold, 0.8, 3.6, -Math.PI / 2, 1.3);
      k.light(x, y, 420, '#ff7a30', 2.4, 0.9);
      if (!k.reducedMotion) {
        k.hooks.slowMo(0.3, 1.4);
        k.hooks.focus(x, y, 1.35, 1.6);
        k.hooks.flash('#fff2dc', 0.55);
        k.hooks.shake(0.9);
      }
      break;
    }

    case 'tankLanded': {
      const fall = e.intro ? 120 : e.fallDistance;
      const s = clamp(fall / 120, 0.3, 1.6);
      if (fall < 8 && !e.intro) break;
      k.dustPuff(e.x - 20, e.y, 4 * s, 10, 26 * s, 1.2, -50 * s, -14, true);
      k.dustPuff(e.x + 20, e.y, 4 * s, 10, 26 * s, 1.2, 50 * s, -14, true);
      if (e.intro || fall > 40) {
        k.dustRing(e.x, e.y, 40 * s, 12 * s, 28 * s);
        const r = k.fx.add(E_STROKE_RING, e.x, e.y - 2, 0.45);
        r.r = 18; r.r2 = 70 * s; r.color = k.dustColor; r.w = 4; r.a = 0.55; r.back = true;
        k.debris(e.x, e.y + 4, 22, 6 * s, 160, 3);
        k.shake(e.intro ? 0.22 : clamp(0.08 + fall / 400, 0, 0.4));
      }
      break;
    }

    case 'lightning': {
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
      const len = Math.hypot(dx, dy);
      const strike = e.target !== null;
      bolt(k, e.x1, e.y1, e.x2, e.y2, '#7af0ff', strike ? 0.32 : 0.22, strike ? 2.2 : 1.4);
      // Forked branches peeling off the main channel.
      const branches = strike ? 3 : 1;
      for (let i = 0; i < branches; i++) {
        const f = rr(0.25, 0.7);
        const bx = e.x1 + dx * f, by = e.y1 + dy * f;
        const ang = Math.atan2(dy, dx) + rr(0.5, 1.1) * (rand() < 0.5 ? -1 : 1);
        const bl = len * rr(0.18, 0.35);
        bolt(k, bx, by, bx + Math.cos(ang) * bl, by + Math.sin(ang) * bl, '#7af0ff', 0.18, 0.9, 0.02);
      }
      k.flash(e.x2, e.y2, strike ? 50 : 26, k.glowSpr('#e8fbff', 0.9), 0.16);
      k.sparks(e.x2, e.y2, strike ? 14 : 5, 120, 380, k.sparkSpr('#9af4ff'), 0.35, 2.2, 0, Math.PI);
      if (strike) k.shake(0.12);
      break;
    }

    case 'singularity': {
      if (e.phase === 'open') {
        k.flash(e.x, e.y, 70, k.glowSpr('#b388ff', 0.6), 0.3);
        k.ring(e.x, e.y, 10, 120, k.ringSpr('#b388ff'), 0.5, 0.8);
        k.chroma(0.3);
        k.shake(0.15);
      } else {
        const r = k.fx.add(E_STROKE_RING, e.x, e.y, 0.25);
        r.r = e.radius * 1.6; r.r2 = 2; r.color = '#efe6ff'; r.w = 3;
      }
      break;
    }

    case 'beam': {
      if (e.phase === 'mark') {
        const r = k.fx.add(E_STROKE_RING, e.x, e.y, 0.6);
        r.r = 6; r.r2 = 60; r.color = '#ffe14a'; r.w = 3;
        k.flash(e.x, e.y, 40, k.glowSpr('#ffd400', 0.6), 0.3);
      } else if (e.phase === 'fire') {
        k.flash(e.x, e.y, 160, k.glowSpr('#fffbe6', 0.9), 0.35);
        k.ring(e.x, e.y, 20, 200, k.ringSpr('#ffe88a'), 0.6, 0.9);
        k.dustRing(e.x, e.y, 90, 18, 40);
        k.flashScreen('#fff3c0', 0.4);
        k.shake(0.55);
        k.chroma(0.4);
        k.shockwave(e.x, e.y, 0.9);
      } else {
        k.smoke(e.x, e.y - 20, 6, e.halfWidth, 70, 3, 50);
        k.embers(e.x, e.y, 24, 160, k.emberSpr('#ffcf3a'), 2, 5, e.halfWidth);
      }
      break;
    }

    case 'lava': {
      if (e.phase === 'spawn') {
        const j = k.p.spawn(P_FIRE, e.x, e.y, 0, -30, 0.3, 14, 0);
        if (j >= 0) k.p.s1[j] = 22;
      } else {
        // Steam hiss as the blob turns to basalt.
        const n = k.n(4, 2);
        for (let i = 0; i < n; i++) {
          const j = k.p.spawn(P_SMOKE, e.x + rr(-4, 4), e.y - 4, rr(-12, 12), rr(-50, -30), rr(1, 1.6), rr(8, 14), k.smokeLight[i & 3]);
          if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 3; k.p.alpha[j] = 0.38; k.p.grav[j] = -0.08; }
        }
      }
      break;
    }

    case 'quake': {
      k.debris(e.x, e.y, 14, 14, 420, 5.5);
      k.dustPuff(e.x, e.y, 6, 14, 40, 1.6, 0, -60);
      k.sparks(e.x, e.y, 5, 140, 340, k.sparkSpr('#ffa26b'), 0.4, 2.4, -Math.PI / 2, 0.6);
      k.shake(0.14);
      break;
    }

    case 'teleport': {
      const col = '#a0ffef';
      teleportColumn(k, e.fromX, e.fromY, col);
      // Dissolve: hull-shaped cloud of glowing motes rising and fading.
      const n = k.n(44, 12);
      for (let i = 0; i < n; i++) {
        const j = k.p.spawn(i & 1 ? P_GLOW : P_SHARD, e.fromX + rr(-28, 28), e.fromY - rr(0, 26), rr(-20, 20), rr(-120, -30), rr(0.5, 1.1), rr(4, 9),
          i & 1 ? k.glowSpr(col, 0.6) : shardSprite(col, i & 3));
        if (j >= 0) { k.p.grav[j] = -0.1; k.p.s1[j] = 1; }
      }
      // Re-form: implode toward the arrival point, then a burst.
      k.later(0.12, () => {
        teleportColumn(k, e.toX, e.toY, col);
        const m = k.n(30, 10);
        for (let i = 0; i < m; i++) {
          const a = rand() * TAU, d = rr(40, 80);
          const j = k.p.spawn(P_GLOW, e.toX + Math.cos(a) * d, e.toY - 12 + Math.sin(a) * d, -Math.cos(a) * d / 0.25, -Math.sin(a) * d / 0.25, 0.25, 7, k.glowSpr(col, 0.6));
          if (j >= 0) { k.p.drag[j] = 0; k.p.s1[j] = 3; }
        }
        k.later(0.25, () => {
          k.flash(e.toX, e.toY - 12, 80, k.glowSpr(col, 0.8), 0.3);
          k.ring(e.toX, e.toY - 12, 10, 80, k.ringSpr(col), 0.4, 0.9);
          k.stars(e.toX, e.toY - 12, 12, 140, k.starSpr(col), 0.8, 12);
        });
      });
      break;
    }

    case 'fizzle': {
      k.smoke(e.x, e.y, 2, 6, 18, 1.2, 20, false, 0.4);
      k.sparks(e.x, e.y, 4, 60, 160, k.sparkSpr(WEAPONS[e.weapon].glow), 0.3, 2);
      break;
    }

    case 'crate': {
      if (e.phase === 'land') {
        k.dustPuff(e.x, e.y, 6, 14, 26, 1.1, 0, -16, true);
      } else if (e.phase === 'collect') {
        const w = WEAPONS[e.weapon];
        const cy = e.y - 12;
        k.flash(e.x, cy, 70, k.glowSpr(w.glow, 0.6), 0.35);
        k.ring(e.x, cy, 6, 70, k.ringSpr(w.color), 0.4, 0.9);
        k.stars(e.x, cy, 12, 180, k.starSpr(w.color), 0.9, 12);
        // Confetti: tumbling coloured shards with gentle gravity.
        const n = k.n(36, 12);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + rr(-1.2, 1.2), sp = rr(160, 420);
          const j = k.p.spawn(P_SHARD, e.x, cy, Math.cos(a) * sp, Math.sin(a) * sp, rr(1.2, 2), rr(7, 11), shardSprite(CONFETTI[i % CONFETTI.length], i & 3));
          if (j >= 0) { k.p.grav[j] = 0.35; k.p.drag[j] = 2.4; }
        }
        const label = renderText([[part(`+${e.amount} ${w.name}`, 20, w.color, 800)]]);
        floatText(k, e.x, cy - 24, label, 1, 54, 1.9);
        k.light(e.x, cy, 160, w.glow, 1, 0.5);
      }
      break;
    }

    case 'dirtFall': {
      const span = Math.max(1, e.x1 - e.x0);
      const n = k.n(clamp(e.amount / 60, 1, 8) * clamp(span / 60, 0.6, 2.5));
      for (let i = 0; i < n; i++) {
        const x = rr(e.x0, e.x1);
        const y = k.terrain ? k.terrain.surfaceY(x, 0) : 600;
        const j = k.p.spawn(P_DUST, x, y + rr(-6, 6), rr(-10, 10), rr(10, 40), rr(0.8, 1.4), rr(14, 26), k.dust[i & 3]);
        if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 2; k.p.alpha[j] = 0.35; k.p.layer[j] = LAYER_BACK; k.p.grav[j] = 0.04; }
      }
      break;
    }

    default:
      break;
  }
}

function teleportColumn(k: Kit, x: number, y: number, color: string): void {
  const c = k.fx.add(E_COLUMN, x, y, 0.5);
  c.r = 34; c.r2 = 180; c.spr = k.glowSpr(color, 0.7); c.a = 0.9;
  k.light(x, y - 20, 150, color, 1, 0.5);
}

