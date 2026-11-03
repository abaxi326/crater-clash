/**
 * Projectile bodies, one painter per ProjectileStyle. Each painter works in a local frame where +x is
 * the direction of travel and "up" (−y) is kept toward the sky (the frame is mirrored when flying
 * left), so the rim light always comes from above. Gradients live in local coordinates and are
 * cached per weapon; per frame we only set transforms and fill paths.
 */
import { hexToRgb, mixHex, shadeHex } from '../../core/color.ts';
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';
import type { ProjectileState } from '../../core/types.ts';
import { blit, coreSprite, glowSprite, starSprite } from './sprites.ts';

const TAU = Math.PI * 2;
const OUTLINE = 'rgba(12,8,16,0.6)';

export interface BodyFrame {
  /** Real time for blinking/pulsing. */
  time: number;
  lowQuality: boolean;
}

/** Per-weapon cached colours and gradients (lazily built on first draw). */
interface Kit {
  base: string;
  light: string;
  dark: string;
  deep: string;
  glow: string;
  rgb: [number, number, number];
  grads: Map<string, CanvasGradient>;
}

const kits = new Map<WeaponId, Kit>();

function kit(id: WeaponId): Kit {
  let k = kits.get(id);
  if (!k) {
    const w = WEAPONS[id];
    k = {
      base: w.color,
      light: mixHex(w.color, '#ffffff', 0.6),
      dark: shadeHex(w.color, 0.5),
      deep: mixHex(shadeHex(w.color, 0.35), '#140a12', 0.35),
      glow: w.glow,
      rgb: hexToRgb(w.color),
      grads: new Map(),
    };
    kits.set(id, k);
  }
  return k;
}

/** Vertical (across-the-body) metallic gradient: highlight top, base, deep shadow below. */
function bodyGrad(ctx: CanvasRenderingContext2D, k: Kit, key: string, r: number, top: string, mid: string, bot: string): CanvasGradient {
  let g = k.grads.get(key);
  if (!g) {
    g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, top);
    g.addColorStop(0.28, mixHex(top, mid, 0.5));
    g.addColorStop(0.5, mid);
    g.addColorStop(1, bot);
    k.grads.set(key, g);
  }
  return g;
}

function radial(ctx: CanvasRenderingContext2D, k: Kit, key: string, cx: number, cy: number, r: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  let g = k.grads.get(key);
  if (!g) {
    g = ctx.createRadialGradient(cx, cy, 0, 0, 0, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    k.grads.set(key, g);
  }
  return g;
}

/** Glossy specular streak along the upper flank. */
function spec(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.quadraticCurveTo((x0 + x1) / 2, y - h, x1, y);
  ctx.quadraticCurveTo((x0 + x1) / 2, y - h * 0.2, x0, y);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// shell — sleek bullet with an ogive nose and a copper driving band
// ---------------------------------------------------------------------------------------------

function paintShell(ctx: CanvasRenderingContext2D, k: Kit, s: number): void {
  const r = s * 0.95, L = s * 3.5;
  const tail = -L * 0.45, nose = L * 0.55, shoulder = L * 0.12;
  ctx.beginPath();
  ctx.moveTo(tail, -r * 0.78);
  ctx.lineTo(tail + r * 0.35, -r);
  ctx.lineTo(shoulder, -r);
  ctx.bezierCurveTo(shoulder + (nose - shoulder) * 0.55, -r, nose - r * 0.25, -r * 0.3, nose, 0);
  ctx.bezierCurveTo(nose - r * 0.25, r * 0.3, shoulder + (nose - shoulder) * 0.55, r, shoulder, r);
  ctx.lineTo(tail + r * 0.35, r);
  ctx.lineTo(tail, r * 0.78);
  ctx.closePath();
  ctx.fillStyle = bodyGrad(ctx, k, 'shell', r, k.light, k.base, k.deep);
  ctx.fill();
  ctx.lineWidth = s * 0.16;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Driving band and seam.
  ctx.fillStyle = bodyGrad(ctx, k, 'band', r, '#ffd9a0', '#b0642c', '#4a2210');
  ctx.fillRect(tail + r * 0.55, -r, s * 0.5, r * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(shoulder - s * 0.12, -r, s * 0.14, r * 2);
  spec(ctx, tail + r * 0.4, nose - r * 0.6, -r * 0.45, r * 0.5, 0.75);
}

// ---------------------------------------------------------------------------------------------
// heavy — fat finned bomb with a hazard band
// ---------------------------------------------------------------------------------------------

function paintHeavy(ctx: CanvasRenderingContext2D, k: Kit, s: number): void {
  const r = s * 1.08, L = s * 3.7;
  const tail = -L * 0.5, nose = L * 0.5;
  // Fins (behind the body): upper/lower trapezoids plus the edge-on centre fin.
  ctx.fillStyle = bodyGrad(ctx, k, 'fin', r * 1.9, k.base, k.dark, k.deep);
  ctx.beginPath();
  ctx.moveTo(tail + s * 0.9, -r * 0.55);
  ctx.lineTo(tail - s * 0.15, -r * 1.75);
  ctx.lineTo(tail - s * 0.65, -r * 1.75);
  ctx.lineTo(tail - s * 0.3, -r * 0.3);
  ctx.closePath();
  ctx.moveTo(tail + s * 0.9, r * 0.55);
  ctx.lineTo(tail - s * 0.15, r * 1.75);
  ctx.lineTo(tail - s * 0.65, r * 1.75);
  ctx.lineTo(tail - s * 0.3, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = k.deep;
  ctx.fillRect(tail - s * 0.7, -s * 0.16, s * 1.4, s * 0.32);
  // Body: teardrop with a blunt rounded nose.
  ctx.beginPath();
  ctx.moveTo(tail - s * 0.25, -r * 0.42);
  ctx.bezierCurveTo(tail + L * 0.25, -r * 1.15, nose - r * 0.2, -r * 1.12, nose, 0);
  ctx.bezierCurveTo(nose - r * 0.2, r * 1.12, tail + L * 0.25, r * 1.15, tail - s * 0.25, r * 0.42);
  ctx.closePath();
  ctx.fillStyle = bodyGrad(ctx, k, 'heavy', r, mixHex(k.base, '#ffffff', 0.25), shadeHex(k.base, 0.72), mixHex(k.deep, '#000000', 0.3));
  ctx.fill();
  ctx.lineWidth = s * 0.16;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Hazard band: dark ring with bright stripes.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#1d1416';
  ctx.fillRect(-s * 0.25, -r * 1.2, s * 0.85, r * 2.4);
  ctx.fillStyle = k.light;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    const y = i * r * 0.42;
    ctx.moveTo(-s * 0.25, y);
    ctx.lineTo(-s * 0.25, y + r * 0.18);
    ctx.lineTo(s * 0.6, y + r * 0.18 + r * 0.25);
    ctx.lineTo(s * 0.6, y + r * 0.25);
    ctx.fill();
  }
  ctx.restore();
  // Nose cap.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(nose - r * 0.45, 0, r * 0.45, r * 0.7, 0, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  spec(ctx, tail + s * 0.6, nose - r * 0.4, -r * 0.5, r * 0.55, 0.6);
}

// ---------------------------------------------------------------------------------------------
// spike — faceted crystal dart (trident) / spiral drill bit (burrower)
// ---------------------------------------------------------------------------------------------

function paintSpike(ctx: CanvasRenderingContext2D, k: Kit, s: number, drill: boolean, spin: number): void {
  const r = s * 0.72, L = s * 4.1;
  const tail = -L * 0.42, nose = L * 0.58, waist = -L * 0.05;
  // Tail shards.
  ctx.fillStyle = k.dark;
  ctx.beginPath();
  ctx.moveTo(tail + s * 0.6, -r * 0.4);
  ctx.lineTo(tail - s * 0.5, -r * 1.45);
  ctx.lineTo(tail + s * 0.05, -r * 0.2);
  ctx.closePath();
  ctx.moveTo(tail + s * 0.6, r * 0.4);
  ctx.lineTo(tail - s * 0.5, r * 1.45);
  ctx.lineTo(tail + s * 0.05, r * 0.2);
  ctx.closePath();
  ctx.fill();
  if (drill) {
    // Collar + conical bit with spiral flutes sliding with spin.
    ctx.beginPath();
    ctx.moveTo(tail, -r * 0.8);
    ctx.lineTo(waist, -r * 0.95);
    ctx.lineTo(nose, 0);
    ctx.lineTo(waist, r * 0.95);
    ctx.lineTo(tail, r * 0.8);
    ctx.closePath();
    ctx.fillStyle = bodyGrad(ctx, k, 'drill', r, '#f6efe4', '#9c9a9a', '#3c3a40');
    ctx.fill();
    ctx.lineWidth = s * 0.15;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = k.base;
    const step = s * 0.95, ph = ((spin * s * 1.6) % step + step) % step;
    for (let x = waist - step + ph; x < nose; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, -r);
      ctx.lineTo(x + s * 0.42, -r);
      ctx.lineTo(x + s * 0.42 + r * 0.7, r);
      ctx.lineTo(x + r * 0.7, r);
      ctx.fill();
    }
    ctx.fillStyle = bodyGrad(ctx, k, 'collar', r, k.light, k.base, k.deep);
    ctx.fillRect(tail, -r, waist - tail, r * 2);
    ctx.restore();
    spec(ctx, tail + s * 0.3, nose - s * 1.2, -r * 0.42, r * 0.4, 0.55);
    return;
  }
  // Crystal: upper facet light, lower facet dark, bright ridge.
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(waist, -r);
  ctx.lineTo(nose, 0);
  ctx.closePath();
  ctx.fillStyle = k.light;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(waist, r);
  ctx.lineTo(nose, 0);
  ctx.closePath();
  ctx.fillStyle = k.dark;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(waist, -r);
  ctx.lineTo(waist + s * 0.5, 0);
  ctx.lineTo(nose, 0);
  ctx.closePath();
  ctx.fillStyle = k.base;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(waist, -r);
  ctx.lineTo(nose, 0);
  ctx.lineTo(waist, r);
  ctx.closePath();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = s * 0.12;
  ctx.beginPath();
  ctx.moveTo(tail + s * 0.3, -r * 0.05);
  ctx.lineTo(nose - s * 0.2, 0);
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// orb — glowing core with a pulsing halo; per-weapon flourishes
// ---------------------------------------------------------------------------------------------

function paintOrb(ctx: CanvasRenderingContext2D, k: Kit, id: WeaponId, s: number, t: number, spin: number): void {
  const r = s * 1.1;
  const pulse = 0.5 + 0.5 * Math.sin(t * 7.5);
  if (id === 'singularity') {
    // Event-horizon core with a violet rim and a tilted accretion ring.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = k.light;
    ctx.lineWidth = s * 0.22;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.75, r * 0.55, -0.35 + Math.sin(t * 1.3) * 0.08, Math.PI + spin, TAU + spin * 0.0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = radial(ctx, k, 'void', 0, 0, r, [[0, '#000000'], [0.62, '#0a0418'], [0.85, '#3b1d7a'], [1, k.light]]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.75, r * 0.55, -0.35 + Math.sin(t * 1.3) * 0.08, 0, Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  ctx.fillStyle = radial(ctx, k, 'orb', -r * 0.3, -r * 0.35, r, [[0, '#ffffff'], [0.25, k.light], [0.65, k.base], [1, k.dark]]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.45 * pulse;
  blit(ctx, coreSprite(k.base), 0, 0, r * 2.2);
  ctx.globalAlpha = 1;
  if (id === 'starfall') {
    // Rotating four-point flare.
    ctx.save();
    ctx.rotate(t * 1.8);
    ctx.globalAlpha = 0.65 + 0.35 * pulse;
    blit(ctx, starSprite(k.light), 0, 0, r * (5.2 + pulse * 1.4));
    ctx.restore();
  } else if (id === 'ricochet') {
    // Orbiting ring, front half drawn over the core.
    ctx.strokeStyle = k.light;
    ctx.lineWidth = s * 0.18;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.6, r * 0.5, spin * 0.6 + t * 2.2, 0, TAU);
    ctx.stroke();
  } else if (id === 'tesla') {
    // Crackling micro-arcs hugging the surface.
    const roll = Math.floor(t * 20);
    ctx.strokeStyle = '#eafcff';
    ctx.lineWidth = s * 0.13;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let a = 0; a < 3; a++) {
      const base = fract(Math.sin((roll + a * 13.1) * 91.7) * 4375.5) * TAU;
      for (let q = 0; q <= 4; q++) {
        const ang = base + q * 0.45;
        const rr = r * (1.15 + 0.45 * fract(Math.sin((roll * 7 + a * 5 + q) * 12.9) * 9371.3));
        const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Glass highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.42, r * 0.32, r * 0.18, -0.6, 0, TAU);
  ctx.fill();
}

const fract = (v: number): number => v - Math.floor(v);

// ---------------------------------------------------------------------------------------------
// disc — spinning saucer seen slightly from above; rim studs travel around with rotation
// ---------------------------------------------------------------------------------------------

function paintDisc(ctx: CanvasRenderingContext2D, k: Kit, s: number, spin: number): void {
  const rx = s * 1.55, ry = s * 0.62, th = s * 0.42;
  // Underside / thickness.
  ctx.fillStyle = k.deep;
  ctx.beginPath();
  ctx.ellipse(0, th * 0.5, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(-rx, -th * 0.5);
  ctx.ellipse(0, -th * 0.5, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Top face.
  ctx.fillStyle = radial(ctx, k, 'disc', -rx * 0.2, -th - ry * 0.4, rx, [[0, k.light], [0.55, k.base], [1, k.dark]]);
  ctx.beginPath();
  ctx.ellipse(0, -th * 0.5, rx, ry, 0, 0, TAU);
  ctx.fill();
  // Spinning spokes on the top face.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = s * 0.16;
  ctx.beginPath();
  for (let q = 0; q < 3; q++) {
    const a = spin + q * TAU / 3;
    const c = Math.cos(a), sn = Math.sin(a);
    ctx.moveTo(c * rx * 0.3, -th * 0.5 + sn * ry * 0.3);
    ctx.lineTo(c * rx * 0.85, -th * 0.5 + sn * ry * 0.85);
  }
  ctx.stroke();
  // Centre dome.
  ctx.fillStyle = k.light;
  ctx.beginPath();
  ctx.ellipse(0, -th * 0.5 - ry * 0.12, rx * 0.32, ry * 0.42, 0, 0, TAU);
  ctx.fill();
  // Rim studs on the front half.
  ctx.fillStyle = '#ffffff';
  for (let q = 0; q < 8; q++) {
    const a = spin * 1.0 + q * TAU / 8;
    const sn = Math.sin(a);
    if (sn < 0.05) continue;
    ctx.globalAlpha = 0.35 + 0.65 * sn;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rx * 0.97, th * 0.05 + sn * ry * 0.9, s * 0.17, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// missile — slim airframe, fins, flickering exhaust, blinking nav light
// ---------------------------------------------------------------------------------------------

function paintMissile(ctx: CanvasRenderingContext2D, k: Kit, s: number, t: number, homing: boolean): void {
  const r = s * 0.62, L = s * 4.3;
  const tail = -L * 0.45, nose = L * 0.55;
  // Exhaust (additive, stretched hot-core sprite with flicker).
  const fl = 0.8 + 0.2 * Math.sin(t * 53) + 0.12 * Math.sin(t * 31);
  const flen = s * (homing ? 4.4 : 3.4) * fl;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(glowSprite('#ff6a1a'), tail - flen * 1.05, -r * 1.7, flen * 1.4, r * 3.4);
  ctx.drawImage(coreSprite('#ffc24a'), tail - flen * 0.7, -r * 0.95, flen * 0.95, r * 1.9);
  ctx.globalCompositeOperation = 'source-over';
  // Fins.
  ctx.fillStyle = k.dark;
  ctx.beginPath();
  ctx.moveTo(tail + s * 1.3, -r);
  ctx.lineTo(tail + s * 0.1, -r * 2.2);
  ctx.lineTo(tail - s * 0.2, -r * 2.2);
  ctx.lineTo(tail, -r);
  ctx.closePath();
  ctx.moveTo(tail + s * 1.3, r);
  ctx.lineTo(tail + s * 0.1, r * 2.2);
  ctx.lineTo(tail - s * 0.2, r * 2.2);
  ctx.lineTo(tail, r);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.12;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Airframe: light grey body with a red warhead.
  ctx.beginPath();
  ctx.moveTo(tail, -r);
  ctx.lineTo(nose - s * 1.3, -r);
  ctx.quadraticCurveTo(nose - s * 0.2, -r * 0.85, nose, 0);
  ctx.quadraticCurveTo(nose - s * 0.2, r * 0.85, nose - s * 1.3, r);
  ctx.lineTo(tail, r);
  ctx.closePath();
  ctx.fillStyle = bodyGrad(ctx, k, 'airframe', r, '#ffffff', '#c9cdd6', '#4a4f5c');
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = bodyGrad(ctx, k, 'warhead', r, k.light, k.base, k.deep);
  ctx.fillRect(nose - s * 1.5, -r, s * 1.6, r * 2);
  ctx.fillRect(tail + s * 0.55, -r, s * 0.32, r * 2);
  ctx.restore();
  // Nav light: slow blink when cruising, rapid once homing.
  const rate = homing ? 7 : 2.2;
  const on = Math.sin(t * rate * TAU) > 0.2;
  if (on) {
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, coreSprite(k.base), tail + s * 0.9, -r * 1.05, s * 2.6);
    ctx.globalCompositeOperation = 'source-over';
  }
  spec(ctx, tail + s * 0.2, nose - s * 0.9, -r * 0.4, r * 0.45, 0.7);
}

// ---------------------------------------------------------------------------------------------
// glob — wobbly molten blob (magma) / clod of earth (earthmaker), stretched by speed
// ---------------------------------------------------------------------------------------------

function paintGlob(ctx: CanvasRenderingContext2D, k: Kit, id: WeaponId, s: number, t: number, speed: number): void {
  const R = s * 1.05;
  const stretch = 1 + Math.min(0.35, speed / 2600);
  const earth = id === 'earthmaker';
  ctx.beginPath();
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const w = 1 + 0.11 * Math.sin(3 * a + t * 7.3) + 0.07 * Math.sin(5 * a - t * 11.1) + (earth ? 0.06 * Math.sin(7 * a) : 0);
    const x = Math.cos(a) * R * w * stretch - (Math.cos(a) < 0 ? R * 0.12 : 0);
    const y = Math.sin(a) * R * w / Math.sqrt(stretch);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (earth) {
    ctx.fillStyle = radial(ctx, k, 'earth', -R * 0.3, -R * 0.4, R * 1.2, [[0, '#f4d9a8'], [0.45, k.base], [1, '#5a3d22']]);
  } else {
    ctx.fillStyle = radial(ctx, k, 'magma', R * 0.15, 0, R * 1.2, [[0, '#fff6c2'], [0.3, '#ffcf3a'], [0.62, k.base], [1, '#8a1d06']]);
  }
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = earth ? 'rgba(40,24,10,0.7)' : 'rgba(70,10,0,0.55)';
  ctx.stroke();
  ctx.save();
  ctx.clip();
  // Surface detail: drifting crust plates (magma) or pebbles (earth).
  ctx.fillStyle = earth ? 'rgba(70,45,22,0.55)' : 'rgba(90,20,4,0.5)';
  for (let q = 0; q < 4; q++) {
    const a = q * 1.7 + (earth ? 0 : t * 0.9);
    const x = Math.cos(a) * R * 0.55, y = Math.sin(a * 1.3) * R * 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, R * 0.28, R * 0.17, a, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  if (!earth) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 9);
    blit(ctx, coreSprite('#ffb000'), R * 0.15, 0, R * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(R * 0.1, -R * 0.5, R * 0.35, R * 0.14, -0.2, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// beacon — metal capsule with a coloured cap, antenna and blinking light
// ---------------------------------------------------------------------------------------------

function paintBeacon(ctx: CanvasRenderingContext2D, k: Kit, s: number, t: number, rate: number): void {
  const r = s * 0.78, L = s * 3.3;
  const tail = -L * 0.5, nose = L * 0.5;
  ctx.beginPath();
  ctx.moveTo(tail + r, -r);
  ctx.lineTo(nose - r, -r);
  ctx.arc(nose - r, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(tail + r, r);
  ctx.arc(tail + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fillStyle = bodyGrad(ctx, k, 'capsule', r, '#ffffff', '#aeb6c2', '#363c48');
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = bodyGrad(ctx, k, 'cap', r, k.light, k.base, k.deep);
  ctx.fillRect(nose - r * 1.4, -r, r * 1.4, r * 2);
  ctx.fillRect(tail + r * 1.1, -r, s * 0.35, r * 2);
  ctx.restore();
  // Antenna stub out the back.
  ctx.strokeStyle = '#2b2f38';
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(tail - s * 0.9, 0);
  ctx.stroke();
  const on = Math.sin(t * rate * TAU) > 0;
  ctx.fillStyle = on ? '#ffffff' : k.dark;
  ctx.beginPath();
  ctx.arc(nose - r * 0.55, 0, r * 0.38, 0, TAU);
  ctx.fill();
  if (on) {
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, coreSprite(k.base), nose - r * 0.55, 0, s * 3.4);
    ctx.globalCompositeOperation = 'source-over';
  }
  spec(ctx, tail + r * 0.6, nose - r * 0.8, -r * 0.45, r * 0.45, 0.7);
}

// ---------------------------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------------------------

const FRAGMENT_SCALE = 0.68;

/** True when a beacon has planted itself (mode 'planted' or effectively at rest). */
export function isPlanted(p: ProjectileState): boolean {
  return WEAPONS[p.weapon].projectile.style === 'beacon' && (p.mode === 'planted' || Math.abs(p.vx) + Math.abs(p.vy) < 1);
}

/** Pulsing ground marker + light column + upright beacon for a planted beacon. */
function drawPlanted(ctx: CanvasRenderingContext2D, p: ProjectileState, k: Kit, s: number, t: number): void {
  const local = t;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalCompositeOperation = 'lighter';
  // Light column.
  let col = k.grads.get('column');
  if (!col) {
    col = ctx.createLinearGradient(0, 0, 0, -220);
    col.addColorStop(0, `rgba(${k.rgb[0]},${k.rgb[1]},${k.rgb[2]},0.55)`);
    col.addColorStop(0.35, `rgba(${k.rgb[0]},${k.rgb[1]},${k.rgb[2]},0.16)`);
    col.addColorStop(1, `rgba(${k.rgb[0]},${k.rgb[1]},${k.rgb[2]},0)`);
    k.grads.set('column', col);
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 9);
  ctx.globalAlpha = 0.55 + 0.35 * pulse;
  ctx.fillStyle = col;
  ctx.fillRect(-s * 1.1, -220, s * 2.2, 220);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(-s * 0.3, -220, s * 0.6, 220);
  // Expanding ground rings (flattened ellipses read as lying on the ground).
  ctx.strokeStyle = k.light;
  for (let i = 0; i < 3; i++) {
    const ph = (local * 0.9 + i / 3) % 1;
    const rx = s * 1.5 + s * 7.5 * ph;
    ctx.globalAlpha = (1 - ph) * 0.85;
    ctx.lineWidth = s * 0.3 * (1 - ph) + 0.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * 0.28, 0, 0, TAU);
    ctx.stroke();
  }
  // Reticle ticks.
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = s * 0.25;
  const rr = s * 4.6;
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2 + t * 0.8;
    const c = Math.cos(a), sn = Math.sin(a) * 0.28;
    ctx.moveTo(c * rr, sn * rr);
    ctx.lineTo(c * rr * 1.3, sn * rr * 1.3);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.7 + 0.3 * pulse;
  ctx.drawImage(glowSprite(k.glow), -s * 4, -s * 1.4, s * 8, s * 2.8);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Upright capsule, half-buried.
  ctx.translate(0, -s * 0.9);
  ctx.rotate(-Math.PI / 2);
  paintBeacon(ctx, k, s, t, 3.5);
  ctx.restore();
}

/** Draws one projectile body with its additive halo. World-space ctx. */
export function drawBody(ctx: CanvasRenderingContext2D, p: ProjectileState, f: BodyFrame): void {
  const w = WEAPONS[p.weapon];
  const style = w.projectile.style;
  if (style === 'none') return;
  const k = kit(p.weapon);
  const t = f.time + p.id * 0.37;
  const s = Math.max(3, w.projectile.size) * (p.fragment ? FRAGMENT_SCALE : 1);
  const speed = Math.hypot(p.vx, p.vy);

  if (style === 'beacon' && isPlanted(p)) { drawPlanted(ctx, p, k, s, t); return; }

  // Hue-tinted firework stars and starfall starlets are pure light: glow + twinkle, no hull.
  if (p.fragment && (p.weapon === 'fireworks' || p.weapon === 'starfall')) {
    const hue = p.data.hue;
    const col = p.weapon === 'fireworks' && hue !== undefined ? hueHex(hue) : k.base;
    const tw = 0.75 + 0.25 * Math.sin(t * 23);
    // Small solid nucleus first so the starlet still reads on bright skies.
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s * 0.55, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    blit(ctx, glowSprite(col), p.x, p.y, s * 6 * tw);
    ctx.globalAlpha = 1;
    blit(ctx, coreSprite(col), p.x, p.y, s * 2.4);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(t * 2.5);
    ctx.globalAlpha = 0.85;
    blit(ctx, starSprite(col), 0, 0, s * 5 * tw);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  const drilling = p.mode === 'drill';
  // Halo.
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.5 + 0.5 * Math.sin(t * 7.5);
  if (style === 'orb') {
    ctx.globalAlpha = p.weapon === 'singularity' ? 0.75 : 0.65 + 0.35 * pulse;
    blit(ctx, glowSprite(w.glow), p.x, p.y, s * (8.5 + 2.5 * pulse));
  } else if (p.weapon !== 'earthmaker') {
    ctx.globalAlpha = drilling ? 0.5 + 0.4 * pulse : 0.55;
    blit(ctx, glowSprite(w.glow), p.x, p.y, s * (drilling ? 9 : 6.5));
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.save();
  if (drilling) {
    // Rumble and ghosting: the drill is seen "through" the ground.
    ctx.translate(p.x + (Math.random() - 0.5) * 1.2, p.y + (Math.random() - 0.5) * 1.2);
    ctx.globalAlpha = 0.85;
  } else {
    ctx.translate(p.x, p.y);
  }
  const heading = speed > 1e-3 ? Math.atan2(p.vy, p.vx) : (p.data.heading ?? 0);
  switch (style) {
    case 'orb':
      paintOrb(ctx, k, p.weapon, s, t, p.rotation);
      break;
    case 'disc': {
      const tilt = Math.atan2(p.vy, Math.abs(p.vx) + 1e-6) * 0.35 * (p.vx < 0 ? -1 : 1);
      ctx.rotate(tilt);
      paintDisc(ctx, k, s, p.rotation);
      break;
    }
    default: {
      ctx.rotate(heading);
      if (Math.cos(heading) < 0) ctx.scale(1, -1);
      if (style === 'shell') paintShell(ctx, k, s);
      else if (style === 'heavy') paintHeavy(ctx, k, s);
      else if (style === 'spike') paintSpike(ctx, k, s, p.weapon === 'burrower', drilling ? p.age * 14 : p.age * 3);
      else if (style === 'missile') paintMissile(ctx, k, s, t, p.mode === 'homing');
      else if (style === 'glob') paintGlob(ctx, k, p.weapon, s, t, speed);
      else if (style === 'beacon') paintBeacon(ctx, k, s, t, 2);
      break;
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

const hueHexCache = new Map<number, string>();
function hueHex(h: number): string {
  const deg = Math.round(((h <= 1 && h >= 0 ? h * 360 : h) % 360 + 360) % 360 / 10) * 10;
  let c = hueHexCache.get(deg);
  if (!c) {
    const f = (n: number): number => {
      const kk = (n + deg / 30) % 12;
      return 0.62 - 0.38 * Math.max(-1, Math.min(kk - 3, Math.min(9 - kk, 1)));
    };
    const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
    c = `#${to(f(0))}${to(f(8))}${to(f(4))}`;
    hueHexCache.set(deg, c);
  }
  return c;
}

/** Hue in degrees from a fragment's data.hue (accepts 0..1 or degrees). */
export function fragmentHue(p: ProjectileState): number {
  const h = p.data.hue;
  if (h === undefined) return -1;
  return h <= 1 && h >= 0 ? h * 360 : h;
}
