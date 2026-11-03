/**
 * Live hazard visuals, drawn every frame straight from state.hazards: molten lava blobs, tesla orbs,
 * singularities, the sunbeam (charge + fire) and the faultline's travelling dust front. Emission
 * (sparks, smoke, infalling matter) happens in updateHazards(); drawing never spawns.
 */
import type { GameState, HazardState } from '../../core/types.ts';
import { WEAPONS } from '../../core/weapons.ts';
import { TAU, clamp01 } from '../../core/math.ts';
import type { ViewInfo } from '../../contracts.ts';
import { P_DEBRIS, P_DUST, P_EMBER, P_SPARK } from '../particles.ts';
import { sprite, type SpriteCanvas } from '../sprites.ts';
import { jaggedLine } from './effects.ts';
import { rand, rr, type Kit } from './kit.ts';

const BEAM_CHARGE = WEAPONS.sunbeam.params.chargeTime ?? 0.9;
const TESLA_PULSE = WEAPONS.tesla.params.pulseInterval ?? 0.38;

/** Lava colour ramp from fresh (index 0) to cooled basalt (last). */
const LAVA_RAMP = ['#fff2a8', '#ffd04a', '#ff9a1f', '#f2621a', '#c63a14', '#8a2a16', '#5a2a20', '#3a2622', '#2c2320'];

const scratch = new Float32Array(64);

let beamGlowC: SpriteCanvas | null = null;
let beamCoreC: SpriteCanvas | null = null;
let voidDiscC: SpriteCanvas | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Horizontal beam profiles (stretched vertically): a broad warm glow and a white-hot core. */
function beamSprites(): void {
  if (beamGlowC) return;
  const g = makeCanvas(128, 4);
  let ctx = g.getContext('2d')!;
  let grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,190,40,0)');
  grad.addColorStop(0.25, 'rgba(255,200,60,0.25)');
  grad.addColorStop(0.42, 'rgba(255,224,120,0.75)');
  grad.addColorStop(0.5, 'rgba(255,240,180,0.95)');
  grad.addColorStop(0.58, 'rgba(255,224,120,0.75)');
  grad.addColorStop(0.75, 'rgba(255,200,60,0.25)');
  grad.addColorStop(1, 'rgba(255,190,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 4);
  beamGlowC = g;
  const c = makeCanvas(64, 4);
  ctx = c.getContext('2d')!;
  grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.2, 'rgba(255,250,220,0.7)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.8, 'rgba(255,250,220,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 4);
  beamCoreC = c;
}

/** Soft-edged black disc for the singularity's event horizon. */
function voidDisc(): SpriteCanvas {
  if (voidDiscC) return voidDiscC;
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(2,0,8,1)');
  g.addColorStop(0.68, 'rgba(4,0,14,1)');
  g.addColorStop(0.78, 'rgba(20,6,48,0.7)');
  g.addColorStop(0.9, 'rgba(40,14,90,0.22)');
  g.addColorStop(1, 'rgba(40,14,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  voidDiscC = c;
  return c;
}

const beamFiring = (h: HazardState): boolean => (h.data.firing !== undefined ? h.data.firing > 0 : h.age >= BEAM_CHARGE);

// --- Update / emission -------------------------------------------------------------------

export function updateHazards(k: Kit, state: GameState, dt: number): void {
  if (dt <= 0) return;
  const amb = k.scale;
  for (const h of state.hazards) {
    switch (h.kind) {
      case 'lava': {
        const heat = 1 - clamp01(h.age / h.life);
        if (heat > 0.35 && rand() < dt * 3 * amb) {
          const j = k.p.spawn(P_EMBER, h.x + rr(-3, 3), h.y - h.radius, rr(-15, 15), rr(-60, -25), rr(0.4, 0.9), rr(3, 5), k.emberOrange);
          if (j >= 0) k.p.grav[j] = 0.2;
        }
        if (rand() < dt * (heat < 0.5 ? 2.2 : 0.7) * amb) k.smoke(h.x, h.y - h.radius, 1, 2, h.radius * 3, 1.1, 22, false, 0.22);
        break;
      }
      case 'tesla': {
        if (rand() < dt * 14 * amb) k.sparks(h.x, h.y, 1, 80, 240, k.sparkSpr('#9af4ff'), 0.25, 2.2, 0, Math.PI);
        break;
      }
      case 'singularity': {
        const r = Math.max(6, h.radius);
        const n = k.n(dt * 70);
        for (let i = 0; i < n; i++) {
          const a = rand() * TAU;
          const d = r * rr(2, 3.4);
          const life = rr(0.35, 0.6);
          const sp = (d - r * 0.4) / life;
          // Inward with a tangential twist so streaks read as a spiral.
          const j = k.p.spawn(P_SPARK, h.x + Math.cos(a) * d, h.y + Math.sin(a) * d,
            -Math.cos(a - 0.5) * sp, -Math.sin(a - 0.5) * sp, life, rr(2, 3.4), k.sparkSpr(rand() < 0.5 ? '#b388ff' : '#e0d0ff'));
          if (j < 0) break;
          k.p.drag[j] = 0; k.p.grav[j] = 0; k.p.flags[j] = 0;
        }
        // Debris torn from the ground spirals in too.
        if (k.terrain && rand() < dt * 10 * amb) {
          const a = rand() * TAU, d = r * rr(1.1, 1.6);
          const c = k.terrain.colorAt(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d);
          if (c >>> 24 >= 128) {
            const j = k.p.spawn(P_DEBRIS, h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, -Math.cos(a - 0.6) * 90, -Math.sin(a - 0.6) * 90, 0.5, rr(2.5, 5), c);
            if (j >= 0) { k.p.grav[j] = 0; k.p.drag[j] = 0; k.p.flags[j] = 0; }
          }
        }
        break;
      }
      case 'beam': {
        const gy = k.terrain ? k.terrain.surfaceY(h.x, 0) : h.y;
        if (beamFiring(h)) {
          k.sparks(h.x + rr(-h.radius, h.radius), gy, dt * 90, 260, 760, k.sparkSpr('#ffd84a'), 0.6, 3.2, -Math.PI / 2, 0.75);
          if (rand() < dt * 30 * amb) {
            const j = k.p.spawn(P_EMBER, h.x + rr(-h.radius, h.radius) * 1.2, gy, rr(-120, 120), rr(-320, -120), rr(0.6, 1.2), rr(4, 7), k.emberSpr('#ffcf3a'));
            if (j >= 0) k.p.grav[j] = 0.6;
          }
          if (rand() < dt * 8 * amb) k.smoke(h.x + rr(-1, 1) * h.radius * 1.6, gy - 10, 1, 10, h.radius * 2.5, 1.8, 50, true, 0.4);
        } else if (rand() < dt * 10 * amb) {
          // Charging: motes drift up the targeting line.
          const j = k.p.spawn(P_EMBER, h.x + rr(-4, 4), gy - rr(0, 200), 0, rr(-90, -40), 0.6, rr(3, 5), k.emberSpr('#fff27a'));
          if (j >= 0) { k.p.grav[j] = 0; k.p.wind[j] = 0; }
        }
        break;
      }
      case 'quake': {
        const life = clamp01(h.age / h.life);
        const strength = 1 - life;
        for (let side = -1; side <= 1; side += 2) {
          const fx = h.x + side * h.radius;
          if (fx < 0 || fx > (k.terrain?.w ?? 1920)) continue;
          const gy = k.terrain ? k.terrain.surfaceY(fx, 0) : h.y;
          if (rand() < dt * 26 * strength * amb) {
            const j = k.p.spawn(P_DUST, fx + rr(-8, 8), gy - 2, side * rr(20, 60), rr(-40, -10), rr(0.6, 1.1), rr(14, 26), k.dust[(rand() * 4) | 0]);
            if (j >= 0) { k.p.s1[j] = k.p.s0[j] * 2.2; k.p.alpha[j] = 0.5; }
          }
          if (rand() < dt * 14 * strength * amb && k.terrain) {
            const c = k.terrain.colorAt(fx, gy + 3);
            if (c >>> 24 >= 128) k.p.spawn(P_DEBRIS, fx, gy - 2, side * rr(10, 60), rr(-160, -60), rr(0.8, 1.4), rr(2.5, 4.5), c);
          }
        }
        break;
      }
    }
  }
}

// --- Drawing -------------------------------------------------------------------------------

export function drawHazards(ctx: CanvasRenderingContext2D, k: Kit, state: GameState, view: ViewInfo): void {
  const hz = state.hazards;
  if (!hz.length) return;
  const time = view.time;
  // Lava first (it sits on the ground), then the rest on top.
  for (const h of hz) if (h.kind === 'lava') drawLava(ctx, k, h, time);
  for (const h of hz) {
    switch (h.kind) {
      case 'tesla': drawTesla(ctx, k, h, time); break;
      case 'singularity': drawSingularity(ctx, k, h, time); break;
      case 'beam': drawBeam(ctx, k, h, view); break;
      case 'quake': drawQuake(ctx, k, h); break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawLava(ctx: CanvasRenderingContext2D, k: Kit, h: HazardState, time: number): void {
  const cool = clamp01(h.age / h.life);
  const heat = 1 - cool;
  const r = Math.max(2.5, h.radius) * (1 + 0.08 * Math.sin(time * 7 + h.id * 1.7));
  // Glow under/around the blob.
  ctx.globalCompositeOperation = 'lighter';
  if (heat > 0.05) {
    const gs = r * (5 + 3 * heat);
    ctx.globalAlpha = 0.55 * heat;
    ctx.drawImage(sprite(k.glowOrange), h.x - gs / 2, h.y - gs / 2, gs, gs);
  }
  // Molten body: colour by cooling, slightly flattened as it spreads.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const ri = Math.min(LAVA_RAMP.length - 1, Math.floor(cool * (LAVA_RAMP.length - 1) + 1.5));
  ctx.fillStyle = LAVA_RAMP[ri];
  ctx.beginPath();
  ctx.ellipse(h.x, h.y - r * 0.15, r * 1.25, r * 0.9, 0, 0, TAU);
  ctx.fill();
  // Bright core and specular glint while hot.
  if (heat > 0.15) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = heat;
    ctx.fillStyle = LAVA_RAMP[Math.min(3, Math.floor(cool * 6))];
    ctx.beginPath();
    ctx.ellipse(h.x, h.y - r * 0.25, r * 0.7, r * 0.5, 0, 0, TAU);
    ctx.fill();
    const cs = r * 2.6;
    ctx.globalAlpha = 0.7 * heat;
    ctx.drawImage(sprite(k.emberOrange), h.x - cs / 2, h.y - r * 0.3 - cs / 2, cs, cs);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawTesla(ctx: CanvasRenderingContext2D, k: Kit, h: HazardState, time: number): void {
  const phase = (h.age % TESLA_PULSE) / TESLA_PULSE;
  const pulse = phase < 0.18 ? 1 - phase / 0.18 : 0;
  const fade = clamp01((h.life - h.age) / 0.25) * clamp01(h.age / 0.1);
  const flick = 0.75 + 0.25 * Math.sin(time * 53 + h.id) * Math.sin(time * 31);
  ctx.globalCompositeOperation = 'lighter';
  // Outer glow + pulse bloom.
  const gs = (54 + pulse * 70) * fade;
  ctx.globalAlpha = (0.32 + pulse * 0.4) * flick * fade;
  ctx.drawImage(sprite(k.glowSpr('#38b6ff', 0.3)), h.x - gs / 2, h.y - gs / 2, gs, gs);
  const cs = (22 + pulse * 16) * fade;
  ctx.globalAlpha = fade;
  ctx.drawImage(sprite(k.glowSpr('#e8fbff', 0.9)), h.x - cs / 2, h.y - cs / 2, cs, cs);
  if (pulse > 0) {
    const rr2 = 20 + (1 - pulse) * 120;
    const s = rr2 * 2 / 0.68;
    ctx.globalAlpha = pulse * 0.8 * fade;
    ctx.drawImage(sprite(k.ringSpr('#7af0ff')), h.x - s / 2, h.y - s / 2, s, s);
  }
  // Mini arcs crawling around the orb (re-jittered each frame into a scratch buffer).
  ctx.strokeStyle = '#bff8ff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const a = time * (3 + i) + i * 2.1 + h.id;
    const len = 16 + 14 * Math.sin(time * 11 + i * 4);
    const n = jaggedLine(scratch, h.x + Math.cos(a) * 5, h.y + Math.sin(a) * 5, h.x + Math.cos(a) * len, h.y + Math.sin(a) * len, 6, 1.4);
    ctx.beginPath();
    ctx.moveTo(scratch[0], scratch[1]);
    for (let p = 1; p < n; p++) ctx.lineTo(scratch[p * 2], scratch[p * 2 + 1]);
    ctx.globalAlpha = 0.35 * fade;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 0.95 * fade * flick;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSingularity(ctx: CanvasRenderingContext2D, k: Kit, h: HazardState, time: number): void {
  const r = Math.max(4, h.radius);
  const appear = clamp01(h.age / 0.2);
  const end = clamp01((h.life - h.age) / 0.15);
  const vis = appear * (0.4 + 0.6 * end);
  // Lensing halo: a faint bright ring hugging the horizon, plus a broad violet glow.
  ctx.globalCompositeOperation = 'lighter';
  const lens = r * 3.6;
  ctx.globalAlpha = 0.45 * vis;
  ctx.drawImage(sprite(k.ringSpr('#d9c8ff')), h.x - lens / 2, h.y - lens / 2, lens, lens);
  const halo = r * 6;
  ctx.globalAlpha = 0.6 * vis;
  ctx.drawImage(sprite(k.glowSpr('#7c4dff', 0.1)), h.x - halo / 2, h.y - halo / 2, halo, halo);
  // Accretion disk (back half): tilted swirling arcs.
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(1, 0.42);
  ctx.lineCap = 'round';
  drawDisk(ctx, r, time, vis, Math.PI, TAU);
  ctx.restore();
  // Event horizon (normal blend) with a thin photon ring.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = vis;
  const d = r * 1.4;
  ctx.drawImage(voidDisc(), h.x - d, h.y - d, d * 2, d * 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#efe6ff';
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = (0.55 + 0.25 * Math.sin(time * 20)) * vis;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 0.98, 0, TAU);
  ctx.stroke();
  // Front half of the disk passes in front of the horizon.
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(1, 0.42);
  drawDisk(ctx, r, time, vis, 0, Math.PI);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Accretion disk streams (in a vertically squashed space), clipped to the angular window
 * [from, to] so the back half can go behind the horizon and the front half in front of it.
 */
function drawDisk(ctx: CanvasRenderingContext2D, r: number, time: number, vis: number, from: number, to: number): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const rad = r * (1.15 + i * 0.17);
    const speed = 4.4 - i * 0.5;
    ctx.strokeStyle = i % 3 === 0 ? '#efe2ff' : i % 3 === 1 ? '#b388ff' : '#7c4dff';
    ctx.lineWidth = r * (0.15 - i * 0.016) + 1;
    for (let s = 0; s < 3; s++) {
      // Three streaks per lane, wrapped and clipped to the window.
      let a0 = (time * speed + i * 1.3 + s * 2.1) % TAU;
      let a1 = a0 + 1.1 + 0.25 * s;
      if (a1 <= from || a0 >= to) {
        a0 -= TAU; a1 -= TAU;
        if (a1 <= from) continue;
      }
      const c0 = Math.max(a0, from), c1 = Math.min(a1, to);
      if (c1 <= c0) continue;
      // Approaching side (left, angle near PI) is brighter: relativistic beaming.
      const beam = 0.55 + 0.45 * Math.cos((c0 + c1) / 2 - Math.PI);
      ctx.globalAlpha = (0.95 - i * 0.12) * vis * beam;
      ctx.beginPath();
      ctx.arc(0, 0, rad, c0, c1);
      ctx.stroke();
    }
  }
}

function drawBeam(ctx: CanvasRenderingContext2D, k: Kit, h: HazardState, view: ViewInfo): void {
  beamSprites();
  const gy = k.terrain ? Math.min(k.terrain.surfaceY(h.x, 0), view.bottom) : h.y;
  const top = view.top - 20;
  const hw = Math.max(6, h.radius);
  const time = view.time;
  if (!beamFiring(h)) {
    // Gold underlay (normal blend) so the targeting line keeps its colour over bright skies.
    const c0 = clamp01(h.age / BEAM_CHARGE);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.35 + 0.35 * c0;
    ctx.fillStyle = '#ffb000';
    ctx.fillRect(h.x - 1.5 - c0, top, 3 + c0 * 2, gy - top);
  } else {
    const env0 = clamp01((h.age - BEAM_CHARGE) / 0.08) * clamp01((h.life - h.age) / 0.18);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55 * env0;
    ctx.drawImage(beamGlowC!, h.x - hw * 3.6, top, hw * 7.2, gy - top + 10);
  }
  ctx.globalCompositeOperation = 'lighter';
  if (!beamFiring(h)) {
    // Charge: thin flickering targeting line and a converging ground reticle.
    const c = clamp01(h.age / BEAM_CHARGE);
    const blink = 0.55 + 0.45 * Math.sin(time * (14 + c * 30));
    ctx.globalAlpha = (0.2 + 0.6 * c) * blink;
    ctx.fillStyle = '#fff27a';
    const lw = 1 + c * 2;
    ctx.fillRect(h.x - lw / 2, top, lw, gy - top);
    ctx.globalAlpha = 0.25 * c;
    ctx.drawImage(beamGlowC!, h.x - hw * 0.6, top, hw * 1.2, gy - top);
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = 2;
    ctx.save();
    ctx.translate(h.x, gy - 2);
    ctx.scale(1, 0.32);
    for (let i = 0; i < 3; i++) {
      const rad = hw * (2.6 - c * 1.5) * (1 + i * 0.35);
      const rot = time * (i & 1 ? -2 : 2) + i;
      ctx.globalAlpha = (0.35 + 0.55 * c) * (1 - i * 0.25);
      ctx.beginPath();
      for (let s = 0; s < 3; s++) {
        const a0 = rot + s * (TAU / 3);
        ctx.moveTo(Math.cos(a0) * rad, Math.sin(a0) * rad);
        ctx.arc(0, 0, rad, a0, a0 + TAU / 3 - 0.5);
      }
      ctx.stroke();
    }
    ctx.restore();
    const gs = 40 + 60 * c;
    ctx.globalAlpha = 0.5 + 0.5 * c * blink;
    ctx.drawImage(sprite(k.glowSpr('#ffd400', 0.6)), h.x - gs / 2, gy - gs / 2, gs, gs);
  } else {
    const ft = h.age - BEAM_CHARGE;
    const remain = h.life - h.age;
    const env = clamp01(ft / 0.08) * clamp01(remain / 0.18);
    const throb = 1 + 0.06 * Math.sin(time * 40) + 0.04 * Math.sin(time * 67);
    const w = hw * throb * (0.7 + 0.3 * env);
    // Broad halo.
    ctx.globalAlpha = 0.65 * env;
    ctx.drawImage(beamGlowC!, h.x - w * 3.2, top, w * 6.4, gy - top + 10);
    ctx.globalAlpha = 0.9 * env;
    ctx.drawImage(beamGlowC!, h.x - w * 1.6, top, w * 3.2, gy - top + 6);
    // Core with heat shimmer: drawn in slices, each nudged sideways by a travelling wave.
    const slice = 36;
    ctx.globalAlpha = env;
    for (let y = top; y < gy; y += slice) {
      const off = Math.sin(y * 0.045 + time * 26) * 1.6 + Math.sin(y * 0.11 - time * 17) * 0.9;
      const hgt = Math.min(slice + 1, gy - y + 2);
      ctx.drawImage(beamCoreC!, h.x - w * 0.75 + off, y, w * 1.5, hgt);
    }
    // Edge glints racing downward.
    ctx.fillStyle = '#fff8d8';
    for (let i = 0; i < 6; i++) {
      const yy = top + (((time * 1400 + i * 173) % (gy - top + 1)) | 0);
      ctx.globalAlpha = 0.6 * env;
      ctx.fillRect(h.x + (i & 1 ? w : -w) * 0.8 - 1, yy, 2, 26);
    }
    // Impact bloom on the ground.
    const gs = w * 9 * throb;
    ctx.globalAlpha = env;
    ctx.drawImage(sprite(k.glowSpr('#ffe27a', 0.85)), h.x - gs / 2, gy - gs / 2, gs, gs);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawQuake(ctx: CanvasRenderingContext2D, k: Kit, h: HazardState): void {
  const strength = 1 - clamp01(h.age / h.life);
  if (strength <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  for (let side = -1; side <= 1; side += 2) {
    const fx = h.x + side * h.radius;
    const gy = k.terrain ? k.terrain.surfaceY(fx, 0) : h.y;
    const gs = 60 * strength;
    ctx.globalAlpha = 0.5 * strength;
    ctx.drawImage(sprite(k.glowSpr('#ffa26b', 0.3)), fx - gs / 2, gy - gs / 2, gs, gs);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// --- Lights --------------------------------------------------------------------------------

export type LightPush = (x: number, y: number, r: number, c: string, i: number) => void;

/** Emits hazard light sources through `push`. */
export function hazardLights(k: Kit, state: GameState, time: number, push: LightPush): void {
  for (const h of state.hazards) {
    switch (h.kind) {
      case 'lava': {
        const heat = 1 - clamp01(h.age / h.life);
        if (heat > 0.1) push(h.x, h.y, 40 + 50 * heat, '#ff7a1a', 0.7 * heat * (0.9 + 0.1 * Math.sin(time * 9 + h.id)));
        break;
      }
      case 'tesla': {
        const phase = (h.age % TESLA_PULSE) / TESLA_PULSE;
        push(h.x, h.y, 150 + (phase < 0.2 ? 120 : 0), '#6fdcff', 0.8 + (phase < 0.2 ? 0.8 : 0));
        break;
      }
      case 'singularity': push(h.x, h.y, Math.max(40, h.radius * 3.5), '#8a5cff', 0.7); break;
      case 'beam': {
        const gy = k.terrain ? k.terrain.surfaceY(h.x, 0) : h.y;
        if (beamFiring(h)) {
          push(h.x, gy, 380, '#ffd75a', 2.2);
          push(h.x, gy - 300, 300, '#fff1b0', 1.2);
        } else push(h.x, gy, 90, '#ffe14a', 0.4 + 0.5 * clamp01(h.age / BEAM_CHARGE));
        break;
      }
      case 'quake': break;
    }
  }
}
