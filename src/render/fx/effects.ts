/**
 * Shaped, timed effects that are not particles: flashes, fireball cores, shockwave rings, lightning,
 * reticles, shield ripples, floating text, flying turret chunks. Objects are pooled and recycled;
 * new ones are only allocated when the pool grows (event time, never per frame).
 */
import { TAU, clamp01, easeOutBack, easeOutCubic, easeOutExpo, easeOutQuad } from '../../core/math.ts';
import { fireRamp, FIRE_STEPS, sprite, type SpriteCanvas } from '../sprites.ts';

export const E_FLASH = 1;      // additive glow disc that blooms then fades
export const E_FIREBALL = 2;   // additive fire-ramp core expanding with ease-out
export const E_RING = 3;       // additive expanding ring sprite
export const E_BOLT = 4;       // lightning polyline (flickers, re-jitters)
export const E_RETICLE = 5;    // seeker lock-on reticle
export const E_HEX = 6;        // shield hex ripple
export const E_TEXT = 7;       // pre-rendered floating text
export const E_CHUNK = 8;      // spinning turret chunk with a smoke trail
export const E_LIGHT = 9;      // light only (no drawing)
export const E_IMPLODE = 10;   // contracting ring (void)
export const E_COLUMN = 11;    // vertical light column (teleport / re-form)
export const E_STROKE_RING = 12; // thin crisp ring stroke (lock-on, ripple accents)

export class Effect {
  type = 0;
  x = 0; y = 0; vx = 0; vy = 0;
  t = 0; life = 1; delay = 0;
  r = 0; r2 = 0; a = 1;
  rot = 0; vrot = 0;
  color = '#ffffff';
  spr = 0;
  seed = 0;
  /** Point buffer (bolts) and its used length in points. */
  pts: Float32Array | null = null;
  n = 0;
  canvas: SpriteCanvas | null = null;
  /** Canvas size in world units (text). */
  w = 0; h = 0;
  /** Light contribution while alive (0 = none). */
  lightR = 0; lightI = 0; lightColor = '#ffffff';
  /** Countdown for flicker / re-jitter / trail emission. */
  timer = 0;
  /** Normal blend instead of additive. */
  normal = false;
  /** Draw behind tanks. */
  back = false;
}

export class EffectPool {
  readonly active: Effect[] = [];
  private free: Effect[] = [];

  add(type: number, x: number, y: number, life: number): Effect {
    const e = this.free.pop() ?? new Effect();
    e.type = type; e.x = x; e.y = y; e.vx = 0; e.vy = 0;
    e.t = 0; e.life = life; e.delay = 0;
    e.r = 0; e.r2 = 0; e.a = 1; e.rot = 0; e.vrot = 0;
    e.color = '#ffffff'; e.spr = 0; e.seed = Math.random() * 1000;
    e.n = 0; e.canvas = null; e.w = 0; e.h = 0;
    e.lightR = 0; e.lightI = 0; e.lightColor = '#ffffff';
    e.timer = 0; e.normal = false; e.back = false;
    this.active.push(e);
    return e;
  }

  /** Advances time; `onTick` gets each live effect (for trails / jitter), dead ones are recycled. */
  update(dt: number, onTick: (e: Effect, dt: number) => void): void {
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.delay > 0) {
        e.delay -= dt;
        continue;
      }
      e.t += dt;
      if (e.t >= e.life) {
        const last = list.pop()!;
        if (last !== e) list[i--] = last;
        e.canvas = null;
        this.free.push(e);
        continue;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.rot += e.vrot * dt;
      onTick(e, dt);
    }
  }

  clear(): void {
    for (const e of this.active) {
      e.canvas = null;
      this.free.push(e);
    }
    this.active.length = 0;
  }
}

/** Lightning: midpoint-displaced polyline from (x1,y1) to (x2,y2) written into `out` (x,y pairs). */
export function jaggedLine(out: Float32Array, x1: number, y1: number, x2: number, y2: number, segments: number, rough: number): number {
  const n = Math.min(segments, (out.length >> 1) - 1);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len, ny = dx / len;
  let off = 0;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    // Random walk on the normal, pinned at both ends by a sine envelope.
    off += (Math.random() - 0.5) * rough * len * 0.18;
    off *= 0.82;
    const env = Math.sin(f * Math.PI);
    out[i * 2] = x1 + dx * f + nx * off * env;
    out[i * 2 + 1] = y1 + dy * f + ny * off * env;
  }
  return n + 1;
}

const fire = (): Int32Array => fireRamp();

/** Draws one effect (world transform active). Returns nothing; skips effects still delayed. */
export function drawEffect(ctx: CanvasRenderingContext2D, e: Effect, time: number, pass = 1): void {
  if (e.delay > 0) return;
  const t = clamp01(e.t / e.life);
  if (e.type === E_FIREBALL) {
    drawFireball(ctx, e, t, pass);
    return;
  }
  switch (e.type) {
    case E_FLASH: {
      // Blooms in fast, fades with a soft tail.
      const s = e.r * (0.55 + 0.45 * easeOutExpo(t)) * 2;
      const a = e.a * (1 - t) * (1 - t);
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(sprite(e.spr), e.x - s / 2, e.y - s / 2, s, s);
      break;
    }
    case E_RING: {
      const g = easeOutCubic(t);
      const rr = e.r + (e.r2 - e.r) * g;
      const s = rr * 2 / 0.68;
      const a = e.a * (1 - t) * (1 - t * 0.5);
      ctx.globalAlpha = clamp01(a);
      ctx.drawImage(sprite(e.spr), e.x - s / 2, e.y - s / 2, s, s);
      break;
    }
    case E_STROKE_RING: {
      const g = easeOutExpo(t);
      const rr = e.r + (e.r2 - e.r) * g;
      ctx.globalAlpha = clamp01(e.a * (1 - t));
      ctx.strokeStyle = e.color;
      ctx.lineWidth = Math.max(0.5, e.w * (1 - t * 0.7));
      ctx.beginPath();
      ctx.arc(e.x, e.y, rr, 0, TAU);
      ctx.stroke();
      break;
    }
    case E_IMPLODE: {
      // Contracts with ease-in, getting brighter as it closes.
      const g = t * t;
      const rr = e.r * (1 - g) + 2;
      const s = rr * 2 / 0.68;
      ctx.globalAlpha = clamp01(e.a * (0.3 + 0.7 * t));
      ctx.drawImage(sprite(e.spr), e.x - s / 2, e.y - s / 2, s, s);
      break;
    }
    case E_BOLT: drawBolt(ctx, e, t); break;
    case E_RETICLE: drawReticle(ctx, e, t, time); break;
    case E_HEX: drawHex(ctx, e, t); break;
    case E_TEXT: drawText(ctx, e); break;
    case E_COLUMN: {
      const a = e.a * Math.sin(t * Math.PI);
      const w = e.r * (1 - t * 0.6);
      ctx.globalAlpha = clamp01(a);
      ctx.drawImage(sprite(e.spr), e.x - w, e.y - e.r2, w * 2, e.r2 * 1.15);
      break;
    }
    case E_CHUNK: drawChunk(ctx, e); break;
  }
}

/**
 * Fireball: a cluster of lobes that billow outward and upward from the blast point. The normal pass
 * paints an opaque-ish orange/red body (readable over bright skies); the additive pass adds the
 * white-hot core and glow.
 */
function drawFireball(ctx: CanvasRenderingContext2D, e: Effect, t: number, pass: number): void {
  const ramp = fire();
  const g = easeOutCubic(t);
  const fadeIn = t < 0.05 ? t / 0.05 : 1;
  const a = e.a * fadeIn * (1 - easeOutQuad(t));
  if (a <= 0.01) return;
  const lobes = 6;
  for (let i = 0; i <= lobes; i++) {
    // Lobe 0 is the centre; others sit on a ring, drifting outward/up as the ball grows.
    const ang = i === 0 ? 0 : (i / lobes) * TAU + e.seed;
    const dist = i === 0 ? 0 : e.r * (0.22 + 0.38 * g) * (0.8 + 0.4 * Math.sin(e.seed * 3 + i * 1.7) ** 2);
    const lx = e.x + Math.cos(ang) * dist;
    const ly = e.y + Math.sin(ang) * dist * 0.85 - e.r * 0.35 * g * g;
    const ls = e.r * (i === 0 ? 1.5 : 1.1) * (0.4 + 0.8 * g) * (0.85 + 0.3 * Math.sin(i * 2.3 + e.seed) ** 2);
    // Outer lobes cool faster than the centre.
    let si = ((t * (i === 0 ? 0.8 : 1.05)) * FIRE_STEPS) | 0;
    if (si >= FIRE_STEPS) si = FIRE_STEPS - 1;
    if (pass === 0) {
      // Body: saturated orange → red → soot, never white.
      const bodyA = a * (t < 0.08 ? 0.4 + 0.6 * t / 0.08 : 1) * 0.9;
      ctx.globalAlpha = clamp01(bodyA);
      const bs = ls * 1.05;
      ctx.drawImage(sprite(ramp[Math.min(FIRE_STEPS - 1, Math.max(5, si + 5))]), lx - bs / 2, ly - bs / 2, bs, bs);
    } else {
      // Additive glow fades faster than the body so the cooling ball turns to soot, not pink haze.
      ctx.globalAlpha = clamp01(a * (1 - t) * (i === 0 ? 0.85 : 0.5));
      const k = Math.min(FIRE_STEPS - 1, si + (i === 0 ? 1 : 3));
      ctx.drawImage(sprite(ramp[k]), lx - ls * 0.4, ly - ls * 0.4, ls * 0.8, ls * 0.8);
    }
  }
  if (pass === 1) {
    // White-hot inner core shrinking as it cools.
    const cs = e.r * 0.8 * (1 - t) * (1 - t) * (0.6 + 0.4 * g);
    if (cs > 1) {
      ctx.globalAlpha = clamp01(a * 1.3);
      ctx.drawImage(sprite(ramp[0]), e.x - cs / 2, e.y - cs / 2 - e.r * 0.2 * g, cs, cs);
    }
  }
}

function drawBolt(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
  const pts = e.pts;
  if (!pts || e.n < 2) return;
  // Strobe: bright on most frames, with dips for a crackling feel.
  const strobe = (e.timer % 0.06) < 0.045 ? 1 : 0.35;
  const a = e.a * (1 - t * t) * strobe;
  if (a <= 0.01) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < e.n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = e.color;
  ctx.globalAlpha = clamp01(a * 0.22);
  ctx.lineWidth = e.r * 5;
  ctx.stroke();
  ctx.globalAlpha = clamp01(a * 0.55);
  ctx.lineWidth = e.r * 2;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = clamp01(a);
  ctx.lineWidth = e.r * 0.7;
  ctx.stroke();
}

function drawReticle(ctx: CanvasRenderingContext2D, e: Effect, t: number, time: number): void {
  // Snaps in from large, rotates, pulses, then fades.
  const inT = clamp01(t / 0.25);
  const rr = e.r * (1.9 - 0.9 * easeOutBack(inT));
  const a = e.a * (t > 0.7 ? (1 - t) / 0.3 : 1);
  ctx.globalAlpha = clamp01(a);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 2.4;
  const rot = e.rot + (1 - inT) * 1.4;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a0 = rot + k * (TAU / 4) + 0.22;
    ctx.moveTo(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr);
    ctx.arc(e.x, e.y, rr, a0, a0 + TAU / 4 - 0.44);
  }
  ctx.stroke();
  // Inward ticks.
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a0 = rot + k * (TAU / 4);
    const c = Math.cos(a0), s = Math.sin(a0);
    ctx.moveTo(e.x + c * (rr + 7), e.y + s * (rr + 7));
    ctx.lineTo(e.x + c * (rr - 7), e.y + s * (rr - 7));
  }
  ctx.lineWidth = 3;
  ctx.stroke();
  // Pulsing centre dot.
  const p = 0.6 + 0.4 * Math.sin(time * 18);
  ctx.globalAlpha = clamp01(a * p);
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.arc(e.x, e.y, 3, 0, TAU);
  ctx.fill();
}

function drawHex(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
  // Ripple of hexagon cells radiating from the centre over a bubble.
  const front = easeOutCubic(t) * e.r * 1.15;
  const cell = e.r2;
  const a = e.a * (1 - t);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 1.6;
  const rows = Math.ceil(e.r / (cell * 1.5)) + 1;
  const hw = cell * Math.sqrt(3);
  ctx.beginPath();
  for (let row = -rows; row <= rows; row++) {
    const cy = row * cell * 1.5;
    const off = (row & 1) * hw * 0.5;
    for (let col = -rows; col <= rows; col++) {
      const cx = col * hw + off;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d > e.r) continue;
      const band = 1 - Math.abs(d - front) / (cell * 2.2);
      if (band <= 0) continue;
      const k = cell * 0.92 * (0.75 + 0.25 * band);
      for (let v = 0; v <= 6; v++) {
        const ang = Math.PI / 6 + v * (TAU / 6);
        const px = e.x + cx + Math.cos(ang) * k, py = e.y + cy + Math.sin(ang) * k;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
  }
  ctx.globalAlpha = clamp01(a);
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, e: Effect): void {
  const c = e.canvas;
  if (!c) return;
  const t = e.t;
  // Bouncy pop (ease-out-back), then a slow rise and fade.
  const pop = t < 0.32 ? easeOutBack(t / 0.32, 2.6) : 1;
  const s = (0.25 + 0.75 * pop) * e.r;
  const rise = easeOutCubic(clamp01(t / e.life)) * e.r2;
  const fade = clamp01((e.life - t) / (e.life * 0.3));
  const w = e.w * s, h = e.h * s;
  ctx.globalAlpha = fade * e.a;
  ctx.drawImage(c, e.x - w / 2, e.y - rise - h / 2, w, h);
}

function drawChunk(ctx: CanvasRenderingContext2D, e: Effect): void {
  const fade = clamp01((e.life - e.t) / 0.4);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.rot);
  ctx.globalAlpha = fade;
  // Charred turret dome + barrel stub, team-tinted rim.
  ctx.fillStyle = '#2a2624';
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(4, -2.5, 22, 5);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 9, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}
