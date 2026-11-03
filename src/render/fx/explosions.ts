/**
 * Layered explosions per ExplosionKind. Every blast is built from the same vocabulary (flash →
 * fireball core → smoke billows → sparks/embers/debris → shockwave + ground dust) tuned per kind and
 * scaled by radius. Secondary blasts (primary=false) are lighter and barely touch the camera.
 */
import type { ExplosionKind } from '../../core/weapons.ts';
import { TAU, clamp } from '../../core/math.ts';
import { F_BOUNCE, LAYER_BACK, P_DEBRIS, P_GLOW, P_SPARK } from '../particles.ts';
import { E_BOLT, E_FIREBALL, E_IMPLODE, jaggedLine } from './effects.ts';
import { rand, rr, type Kit } from './kit.ts';

const FIREWORK_COLORS = ['#ff4fd8', '#5ee7ff', '#ffe45c', '#7dff8a', '#ff7a45', '#b18cff'];

export function explode(k: Kit, kind: ExplosionKind, x: number, y: number, R: number, primary: boolean, color: string, glow: string): void {
  if (kind === 'none') return;
  const m = primary ? 1 : 0.55;
  // Colour-identity blasts keep a normal-blend body on their sparks/stars.
  k.p.bodyMode = kind === 'electric' || kind === 'void' || kind === 'beam' || kind === 'firework';
  switch (kind) {
    case 'standard': standard(k, x, y, R, m, glow); break;
    case 'heavy': heavy(k, x, y, R, m, glow); break;
    case 'small': small(k, x, y, R, m, glow); break;
    case 'electric': electric(k, x, y, R, m, color); break;
    case 'fire': fireBlast(k, x, y, R, m); break;
    case 'void': voidBlast(k, x, y, R, m, color, glow); break;
    case 'beam': beamBlast(k, x, y, R, m); break;
    case 'dirt': dirt(k, x, y, R, m, color); break;
    case 'firework': firework(k, x, y, R, m, color); break;
  }
  k.p.bodyMode = false;
  // Camera response proportional to size.
  const trauma = clamp(R / 120, 0.12, 0.8) * (primary ? 1 : 0.45) * (kind === 'heavy' ? 1.35 : 1);
  k.shake(trauma);
  if (primary && R >= 34) k.shockwave(x, y, clamp(R / 90, 0.25, 1) * (kind === 'heavy' ? 1.2 : 1));
  if (primary && (kind === 'heavy' || kind === 'void' || kind === 'beam')) k.chroma(kind === 'heavy' ? 0.55 : 0.45);
  if (primary && R >= 70) k.flashScreen(kind === 'void' ? '#c9a6ff' : '#fff1d6', 0.28);
  if (primary && kind === 'heavy') k.hitStop(0.07);
}

/** Classic: flash → fireball → billows → sparks/embers/debris → ring + ground dust. */
function standard(k: Kit, x: number, y: number, R: number, m: number, tint: string): void {
  const s = R / 42;
  k.flash(x, y, R * 1.25, k.glowWhite, 0.12);
  k.flash(x, y, R * 2.4, k.glowSpr(tint, 0.3), 0.3, 0.35);
  const fb = k.fx.add(E_FIREBALL, x, y - R * 0.1, 0.75 + 0.1 * s);
  fb.r = R * 1.15;
  k.fire(x, y - R * 0.15, 16 * s * m, R * 0.35, R * 0.9, 0.6, R * 2.6);
  k.sparks(x, y, 22 * s * m, 220, 640, k.sparkSpr(tint), 0.55, 3.4);
  k.embers(x, y - R * 0.2, 14 * s * m, 160, k.emberOrange, 1.6, 5);
  k.debris(x, y, R, 18 * s * m, 260 + R * 4, 5.5);
  k.later(0.12, () => k.smoke(x, y - R * 0.6, 4 * m + 0.5, R * 0.45, R * 1.6, 2.8, 38, true, 0.7));
  k.ring(x, y, R * 0.4, R * 2.1, k.ringWhite, 0.4, 0.5 * m);
  k.dustRing(x, y, R, 10 * s * m, R * 0.75);
  k.light(x, y, R * 4.2, '#ffa040', 1.5 * m, 0.4);
}

function heavy(k: Kit, x: number, y: number, R: number, m: number, tint: string): void {
  const s = R / 42;
  // Stage 1: blinding core and the primary fireball.
  k.flash(x, y, R * 1.4, k.glowWhite, 0.16);
  k.flash(x, y, R * 3, k.glowSpr(tint, 0.25), 0.45, 0.45);
  const fb = k.fx.add(E_FIREBALL, x, y - R * 0.1, 0.8);
  fb.r = R * 1.05;
  k.fire(x, y - R * 0.1, 26 * s * m, R * 0.35, R * 1.0, 0.7, R * 2.6);
  k.sparks(x, y, 34 * s * m, 280, 820, k.sparkSpr(tint), 0.7, 3.8);
  k.debris(x, y, R, 34 * s * m, 340 + R * 4, 7);
  k.ring(x, y, R * 0.5, R * 2.7, k.ringWhite, 0.55, 0.55 * m);
  k.light(x, y, R * 5, '#ff8a30', 2 * m, 0.55);
  // Stage 2: a second, higher fireball erupts as the first rolls up.
  k.later(0.13, () => {
    const f2 = k.fx.add(E_FIREBALL, x + rr(-0.2, 0.2) * R, y - R * 0.55, 0.75);
    f2.r = R * 0.85;
    k.flash(x, y - R * 0.4, R * 1.4, k.glowOrange, 0.25, 0.8);
    k.fire(x, y - R * 0.6, 18 * s * m, R * 0.4, R * 0.9, 0.7, R * 1.8);
    k.embers(x, y - R * 0.4, 30 * s * m, 220, k.emberOrange, 2.2, 5.5, R * 0.3);
  });
  // Ground dust wave and a lingering smoke column.
  k.dustRing(x, y, R * 1.4, 22 * s * m, R * 0.8);
  for (let i = 0; i < 6; i++) {
    k.later(0.1 + i * 0.22, () => k.smoke(x + rr(-0.15, 0.15) * R, y - R * (0.4 + i * 0.15), 2 * m + 0.5, R * 0.3, R * 1.3, 3.4, 62 + i * 6, true, 0.68));
  }
}

function small(k: Kit, x: number, y: number, R: number, m: number, tint: string): void {
  const s = R / 24;
  k.flash(x, y, R * 1.6, k.glowWhite, 0.12);
  k.flash(x, y, R * 2.2, k.glowSpr(tint, 0.3), 0.22, 0.5);
  const fb = k.fx.add(E_FIREBALL, x, y, 0.36);
  fb.r = R * 0.75;
  k.sparks(x, y, 10 * s * m, 160, 420, k.sparkSpr(tint), 0.4, 2.6);
  k.debris(x, y, R, 6 * s * m, 200, 3.2);
  k.smoke(x, y - R * 0.3, 1, R * 0.2, R * 1.3, 1.4, 26, true, 0.42);
  k.ring(x, y, R * 0.3, R * 1.8, k.ringWhite, 0.28, 0.5);
  k.light(x, y, R * 4, '#ffb050', 0.9 * m, 0.25);
}

function electric(k: Kit, x: number, y: number, R: number, m: number, color: string): void {
  const s = R / 26;
  const cyan = '#7af0ff';
  k.tint(x, y, R * 3.4, '#38b6ff', 0.45, 0.55);
  k.flash(x, y, R * 1.8, k.glowSpr('#e8fbff', 0.9), 0.14);
  k.flash(x, y, R * 3.6, k.glowSpr('#38b6ff', 0.3), 0.35, 0.4);
  k.ring(x, y, R * 0.4, R * 3, k.ringSpr(cyan), 0.4, 0.6);
  // Radial jagged arcs.
  const arcs = Math.max(4, Math.round(7 * m));
  for (let i = 0; i < arcs; i++) {
    const a = (i / arcs) * TAU + rr(-0.3, 0.3);
    const len = R * rr(1.6, 3);
    bolt(k, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, color, 0.28 + rand() * 0.2, 1.6, rand() * 0.06);
  }
  k.sparks(x, y, 26 * s * m, 200, 600, k.sparkSpr(cyan), 0.45, 2.6, 0, Math.PI);
  k.stars(x, y, 8 * m, 160, k.starSpr('#bff8ff'), 0.5, 12);
  k.debris(x, y, R, 8 * m, 220, 3.5);
  k.smoke(x, y - R * 0.3, 1, R * 0.3, R * 1.4, 1.4, 22, false, 0.3);
  k.light(x, y, R * 6, '#6fdcff', 1.8 * m, 0.45);
}

/** Lightning bolt effect helper (shared by events). */
export function bolt(k: Kit, x1: number, y1: number, x2: number, y2: number, color: string, life: number, width: number, delay = 0): void {
  const e = k.fx.add(E_BOLT, x1, y1, life);
  e.delay = delay;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const segs = clamp(Math.round(len / 9), 6, 40);
  if (!e.pts || e.pts.length < 82) e.pts = new Float32Array(82);
  e.n = jaggedLine(e.pts, x1, y1, x2, y2, segs, 1);
  e.r = width; e.color = color;
  e.vx = 0; e.vy = 0;
  // Endpoints for re-jitter (bolts crackle by regenerating a few times).
  e.w = x2; e.h = y2; e.r2 = segs;
  e.lightR = Math.min(260, len * 0.8 + 60); e.lightI = 0.9; e.lightColor = '#8fe8ff';
}

function fireBlast(k: Kit, x: number, y: number, R: number, m: number): void {
  const s = R / 30;
  k.flash(x, y, R * 1.4, k.glowSpr('#fff2c0', 0.8), 0.13);
  k.flash(x, y, R * 3.2, k.glowSpr('#ff6a00', 0.3), 0.45, 0.45);
  const fb = k.fx.add(E_FIREBALL, x, y - R * 0.1, 0.8);
  fb.r = R * 1.25;
  k.fire(x, y - R * 0.2, 26 * s * m, R * 0.45, R * 1.1, 0.8, R * 3);
  k.embers(x, y, 30 * s * m, 240, k.emberSpr('#ffb000'), 2, 5.5, R * 0.3);
  k.sparks(x, y, 14 * s * m, 180, 480, k.sparkGold, 0.5, 3);
  k.debris(x, y, R, 8 * s * m, 240, 4);
  k.ring(x, y, R * 0.4, R * 2.2, k.ringSpr('#ffb36a'), 0.4, 0.6);
  // Lingering flames licking the crater rim.
  for (let i = 0; i < 6; i++) {
    k.later(0.15 + i * 0.18, () => {
      const gx = x + rr(-1, 1) * R * 0.9;
      k.fire(gx, k.groundY(gx, y) - 4, 3 * m + 1, 6, R * 0.6, 0.7, 40);
    });
  }
  k.later(0.2, () => k.smoke(x, y - R * 0.6, 3 * m, R * 0.4, R * 1.4, 2.6, 40));
  k.light(x, y, R * 5, '#ff7a1a', 1.7 * m, 0.9);
}

function voidBlast(k: Kit, x: number, y: number, R: number, m: number, color: string, glow: string): void {
  const s = R / 50;
  const violet = k.glowSpr(glow, 0.3);
  // Implosion: particles rush inward along spiral paths, a ring contracts.
  const imp = k.fx.add(E_IMPLODE, x, y, 0.26);
  imp.r = R * 2.4; imp.spr = k.ringSpr(color); imp.a = 0.9;
  const n = k.n(40 * s * m);
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU;
    const d = R * rr(1.6, 3);
    const sp = d / 0.26;
    const j = k.p.spawn(P_GLOW, x + Math.cos(a) * d, y + Math.sin(a) * d,
      -Math.cos(a + 0.35) * sp, -Math.sin(a + 0.35) * sp, 0.26, rr(6, 12), violet);
    if (j < 0) break;
    k.p.drag[j] = 0; k.p.s1[j] = 2;
  }
  k.later(0.26, () => {
    k.tint(x, y, R * 3, color, 0.6, 0.65);
    k.flash(x, y, R * 1.3, k.glowSpr('#f4e8ff', 0.9), 0.14);
    k.flash(x, y, R * 3.6, violet, 0.55, 0.55);
    k.ring(x, y, R * 0.4, R * 3.2, k.ringSpr(glow), 0.6, 0.9).normal = true;
    k.ring(x, y, R * 0.2, R * 1.8, k.ringSpr(color), 0.35, 0.7);
    k.shards(x, y, 18 * s * m, 420, color, 0.9, 10);
    k.sparks(x, y, 24 * s * m, 260, 700, k.sparkSpr(glow), 0.5, 3, 0, Math.PI);
    k.embers(x, y, 18 * s * m, 200, k.emberSpr(color), 1.4, 5, R * 0.3);
    k.debris(x, y, R, 14 * s * m, 300, 4.5);
    k.light(x, y, R * 5, '#9a6bff', 2 * m, 0.5);
  });
}

function beamBlast(k: Kit, x: number, y: number, R: number, m: number): void {
  const s = R / 26;
  k.tint(x, y, R * 5, '#ffb800', 0.6, 0.6);
  k.flash(x, y, R * 3, k.glowSpr('#fffbe6', 0.9), 0.2);
  k.flash(x, y, R * 5, k.glowSpr('#ffd400', 0.4), 0.5, 0.8);
  k.fire(x, y, 18 * s * m, R * 0.6, R * 1.1, 0.6, R * 3);
  // Molten splash: heavy upward sparks and glowing droplets.
  k.sparks(x, y, 40 * s * m, 300, 900, k.sparkSpr('#ffd84a'), 0.7, 3.4, -Math.PI / 2, 0.45);
  k.embers(x, y, 24 * s * m, 300, k.emberSpr('#ffcf3a'), 1.6, 6, R * 0.5);
  k.debris(x, y, R, 12 * s * m, 360, 4);
  k.ring(x, y, R * 0.6, R * 3.2, k.ringSpr('#ffe88a'), 0.45, 0.8);
  k.dustRing(x, y, R * 1.6, 14 * m, R * 0.9);
  k.light(x, y, R * 7, '#ffd75a', 2 * m, 0.5);
}

function dirt(k: Kit, x: number, y: number, R: number, m: number, color: string): void {
  const s = R / 92;
  const fb = k.packHex(color);
  // Clods: big, heavy, terrain/earth coloured.
  const n = k.n(40 * s * m + 10);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + rr(-1.2, 1.2);
    const sp = rr(140, 420);
    const j = k.p.spawn(P_DEBRIS, x + rr(-R, R) * 0.3, y + rr(-R, R) * 0.2, Math.cos(a) * sp, Math.sin(a) * sp, rr(1.4, 2.4), rr(3, 8), fb);
    if (j < 0) break;
    if (rand() < 0.5 && k.terrain) {
      const c = k.terrain.colorAt(x + rr(-R, R) * 0.5, y + rr(0, R) * 0.4);
      if (c >>> 24 >= 128) k.p.spr[j] = c;
    }
  }
  k.dustPuff(x, y, 14 * s * m + 3, R * 0.5, R * 0.9, 2.2, 0, -40);
  k.dustRing(x, y, R, 12 * m, R * 0.6);
  k.flash(x, y, R * 0.9, k.glowSpr('#f0c98a', 0.3), 0.2, 0.45);
  k.later(0.15, () => k.dustPuff(x, y - R * 0.4, 8 * m + 2, R * 0.5, R * 1.1, 2.6, 0, -24));
}

function firework(k: Kit, x: number, y: number, R: number, m: number, color: string): void {
  const s = R / 28;
  k.flash(x, y, R * 2, k.glowWhite, 0.15);
  const bursts = m < 1 ? 1 : 3;
  for (let b = 0; b < bursts; b++) {
    // Secondary star blasts carry no hue in the event, so each gets a random palette colour.
    const c = b === 0 && m === 1 ? color : FIREWORK_COLORS[(rand() * FIREWORK_COLORS.length) | 0];
    const bx = x + (b ? rr(-R, R) : 0), by = y - (b ? rr(R * 0.4, R * 1.6) : 0);
    k.later(b * 0.12, () => {
      k.p.bodyMode = true;
      k.tint(bx, by, R * 2.2, c, 0.4, 0.45);
      k.flash(bx, by, R * 1.5, k.glowSpr(c, 0.5), 0.25, 0.8);
      // Radial star burst: even angular spacing reads as a firework, not an explosion.
      const n = k.n(36 * s * m, 10);
      const star = k.starSpr(c), spark = k.sparkSpr(c);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rr(-0.05, 0.05);
        const sp = rr(240, 300) * (0.7 + s * 0.3);
        const j = k.p.spawn(P_SPARK, bx, by, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.8, 1.1), 4.2, spark);
        if (j < 0) break;
        k.p.grav[j] = 0.25; k.p.drag[j] = 1.6; k.p.flags[j] &= ~F_BOUNCE;
        k.stars(bx + Math.cos(a) * 6, by + Math.sin(a) * 6, 0.7, 120, star, 1.5, 16);
      }
      k.light(bx, by, R * 5, c, 1.2 * m, 0.5);
      k.p.bodyMode = false;
    });
  }
  // Crackle pops: small delayed white sparkles scattered around the burst.
  const pops = k.n(10 * m);
  for (let i = 0; i < pops; i++) {
    const px = x + rr(-2, 2) * R, py = y - rr(-0.4, 2.2) * R;
    k.later(rr(0.45, 1.1), () => {
      k.flash(px, py, rr(10, 18), k.glowWhite, 0.1, 0.9);
      k.sparks(px, py, 4, 60, 160, k.sparkSpr('#fff6c8'), 0.25, 2, 0, Math.PI);
    });
  }
  k.smoke(x, y, 2 * m, R * 0.4, R, 2, 18, false, 0.25);
  k.debris(x, y, R, 5 * m, 200, 3);
}

/** Back-layer helper: a soft glow under the blast so the ground reads as lit. */
export function groundGlow(k: Kit, x: number, y: number, R: number, color: string): void {
  const j = k.glow(x, y, R * 2.5, R * 3.5, k.glowSpr(color, 0.2), 0.6, 0, 0, 0.6);
  if (j >= 0) k.p.layer[j] = LAYER_BACK;
}

