/**
 * Weapon behaviours: projectile flight modes (ballistic, split, skip, ricochet, drill, homing,
 * stars, beacons) and hazards (lava, tesla, singularity, beam, quake). Behaviour specs live in the
 * comments of src/core/weapons.ts. The Game supplies a SimCtx for blasts, damage, spawning, events.
 */
import {
  MAX_HP, PROJECTILE_MAX_AGE, TANK_HALF_WIDTH, TANK_HULL_HEIGHT, WORLD_H, WORLD_W,
} from '../core/constants.ts';
import type { GameEvent } from '../core/events.ts';
import { tankCenter } from '../core/geometry.ts';
import { angleDiff, easeOutCubic } from '../core/math.ts';
import type { Rng } from '../core/rng.ts';
import type { GameState, HazardKind, HazardState, PlayerIndex, ProjectileState } from '../core/types.ts';
import { WEAPONS, type ExplosionKind, type WeaponId } from '../core/weapons.ts';
import {
  CONTACT_TANK, CONTACT_TERRAIN, OWNER_IMMUNITY, gravityAccel, integrate, outOfWorld, sweep, windAccel,
  type Contact, type TankTargets,
} from './physics.ts';

/** Services the Game provides to weapon behaviours. */
export interface SimCtx {
  readonly state: GameState;
  readonly rng: Rng;
  emit(e: GameEvent): void;
  /**
   * Damaging blast: emits 'explosion', carves a crater (unless carve=false), damages tanks per the
   * blast model (directTarget takes full damage), collects overlapping crates for the owner.
   */
  blast(x: number, y: number, radius: number, damage: number, weapon: WeaponId, kind: ExplosionKind,
    owner: PlayerIndex, primary: boolean, directTarget: number, carve?: boolean): void;
  damageTank(target: PlayerIndex, amount: number, weapon: WeaponId, direct: boolean, by: PlayerIndex | null, x: number, y: number): void;
  spawnProjectile(weapon: WeaponId, owner: PlayerIndex, x: number, y: number, vx: number, vy: number, mode: string, fragment: boolean): ProjectileState;
  /** Returns null when the hazard cap is reached. */
  spawnHazard(kind: HazardKind, weapon: WeaponId, owner: PlayerIndex, x: number, y: number, life: number, radius: number): HazardState | null;
  /** Warps a tank to the surface at x (blink). */
  teleport(player: PlayerIndex, x: number): void;
  /** Slides a grounded tank horizontally (singularity pull), respecting slopes and edges. */
  pushTank(player: PlayerIndex, dx: number): void;
  /** Earthmaker: piles a dome of loose dirt, never inside tank hulls. */
  raiseMound(x: number, radius: number, height: number): void;
  /** Cooled lava: a small basalt blob. */
  fillBasalt(x: number, y: number, radius: number): void;
  collectCratesRect(x0: number, y0: number, x1: number, y1: number, owner: PlayerIndex): void;
  /** Lava damage a tank has already taken during the current shot (balance cap, see LAVA_DAMAGE_CAP). */
  lavaTaken: [number, number];
}

/**
 * Balance: lava from one shot deals at most this much to each tank. Without it a pool of droplets
 * under a hull (16 droplets × 3 dmg every 0.3 s for 4.5 s) could deal several hundred damage.
 */
export const LAVA_DAMAGE_CAP = 24;

const dead = (o: { data: Record<string, number> }): boolean => o.data.dead === 1;
export const isDead = dead;
const kill = (o: { data: Record<string, number> }): void => { o.data.dead = 1; };

/** Minimum homing speed so a seeker launched near-vertically still reaches its target. */
const MIN_HOMING_SPEED = 260;
/** Extra homing turn rate gained per second of homing so missiles never orbit forever. */
const HOMING_TURN_GAIN = 1.4;
/** Speed below which a ricochet simply detonates (prevents endless creeping). */
const RICOCHET_MIN_SPEED = 70;

// =====================================================================================
// Projectiles
// =====================================================================================

const contact: Contact = { kind: 0, x: 0, y: 0, fx: 0, fy: 0, tank: -1 };

/** Advances one projectile by one substep. Marks it dead (data.dead = 1) when it is gone. */
export function updateProjectile(ctx: SimCtx, p: ProjectileState, dt: number, targets: TankTargets): void {
  if (dead(p)) return;
  const st = ctx.state;
  const w = WEAPONS[p.weapon];
  const startAge = p.age;
  p.age += dt;
  const ignore = startAge < OWNER_IMMUNITY ? p.owner : -1;
  const px = p.x, py = p.y, pvy = p.vy;

  if (p.mode === 'drill') {
    updateDrill(ctx, p, dt, targets, ignore);
    return;
  }
  if (p.mode === 'homing') {
    steerHoming(ctx, p, dt);
    integrate(p, 0, 0, dt);
  } else {
    integrate(p, windAccel(w, st.wind), gravityAccel(w, st.gravity), dt);
  }

  if (sweep(st.terrain, targets, px, py, p.x, p.y, ignore, true, contact)) {
    onContact(ctx, p, contact);
  } else {
    // Apex: vy crosses from rising to falling (or never rose and has flown a moment).
    if (!p.fragment && p.data.apex !== 1 && p.vy >= 0 && (pvy < 0 || p.age > 0.3)) {
      p.data.apex = 1;
      onApex(ctx, p);
    }
    if (!dead(p) && p.mode === 'star' && p.weapon === 'fireworks' && p.age >= (p.data.fuse ?? 0.5)) {
      starBurst(ctx, p, -1);
    }
  }
  if (dead(p)) return;
  if (outOfWorld(p.x, p.y)) {
    kill(p);
    if (p.mode === 'beacon') ctx.emit({ type: 'fizzle', weapon: p.weapon, x: p.x, y: p.y });
    else ctx.emit({ type: 'outOfBounds', weapon: p.weapon, x: p.x, y: p.y });
    return;
  }
  if (p.age > PROJECTILE_MAX_AGE) {
    kill(p);
    ctx.emit({ type: 'fizzle', weapon: p.weapon, x: p.x, y: p.y });
    return;
  }
  // Visual rotation: discs spin, everything else faces its heading.
  if (w.projectile.spin) p.rotation += dt * (p.vx >= 0 ? 16 : -16);
  else p.rotation = Math.atan2(p.vy, p.vx);
}

function onApex(ctx: SimCtx, p: ProjectileState): void {
  const w = WEAPONS[p.weapon];
  if (p.weapon === 'trident') {
    const n = w.params.fragments, spread = w.params.spread;
    for (let i = 0; i < n; i++) {
      const f = ctx.spawnProjectile('trident', p.owner, p.x, p.y, p.vx + (i - (n - 1) / 2) * spread, p.vy, 'ballistic', true);
      f.age = p.age; // keeps the owner-immunity window continuous
    }
    ctx.emit({ type: 'split', weapon: 'trident', x: p.x, y: p.y, count: n });
    kill(p);
  } else if (p.weapon === 'starfall') {
    const n = w.params.fragments, spread = w.params.spread, up = w.params.upKick;
    for (let i = 0; i < n; i++) {
      const jitter = ctx.rng.range(-7, 7);
      const f = ctx.spawnProjectile('starfall', p.owner, p.x, p.y,
        p.vx + (i - (n - 1) / 2) * spread + jitter, -up * ctx.rng.range(0.6, 1), 'star', true);
      f.age = p.age;
      f.data.hue = 40 + ctx.rng.range(0, 20);
    }
    ctx.emit({ type: 'split', weapon: 'starfall', x: p.x, y: p.y, count: n });
    kill(p);
  } else if (p.weapon === 'seeker') {
    const target = (1 - p.owner) as PlayerIndex;
    const t = ctx.state.tanks[target];
    if (!t.alive) return;
    p.mode = 'homing';
    p.data.homeT = 0;
    ctx.emit({ type: 'lockOn', x: p.x, y: p.y, target });
  }
}

function steerHoming(ctx: SimCtx, p: ProjectileState, dt: number): void {
  const target = ctx.state.tanks[1 - p.owner];
  p.data.homeT = (p.data.homeT ?? 0) + dt;
  let speed = Math.hypot(p.vx, p.vy);
  if (speed < MIN_HOMING_SPEED) speed = Math.min(MIN_HOMING_SPEED, speed + 420 * dt);
  let heading = Math.atan2(p.vy, p.vx);
  if (target.alive) {
    const c = tankCenter(target);
    const want = Math.atan2(c.y - p.y, c.x - p.x);
    const diff = angleDiff(heading, want);
    const maxTurn = (WEAPONS.seeker.params.turnRate + HOMING_TURN_GAIN * p.data.homeT) * dt;
    heading += diff < -maxTurn ? -maxTurn : diff > maxTurn ? maxTurn : diff;
  }
  p.vx = Math.cos(heading) * speed;
  p.vy = Math.sin(heading) * speed;
}

function onContact(ctx: SimCtx, p: ProjectileState, c: Contact): void {
  const w = WEAPONS[p.weapon];
  const st = ctx.state;
  const hitTank = c.kind === CONTACT_TANK ? c.tank : -1;

  // Bouncers on terrain.
  if (c.kind === CONTACT_TERRAIN && p.weapon === 'skipper' && p.bounces < w.params.bounces) {
    p.bounces++;
    ctx.blast(c.x, c.y, w.params.bounceRadius, w.params.bounceDamage, 'skipper', 'small', p.owner, false, -1);
    const n = st.terrain.normalAt(c.fx, c.fy, 5);
    p.x = c.fx; p.y = c.fy;
    if (Math.abs(n.x) > 0.75 && n.x * p.vx < 0) p.vx = -p.vx; // glancing off a wall
    p.vy = -Math.abs(p.vy) * w.params.restitution;
    p.vx *= w.params.friction;
    ctx.emit({ type: 'bounce', weapon: 'skipper', x: c.x, y: c.y, speed: Math.hypot(p.vx, p.vy) });
    return;
  }
  if (c.kind === CONTACT_TERRAIN && p.weapon === 'ricochet' && p.bounces < w.params.bounces) {
    const n = st.terrain.normalAt(c.fx, c.fy, 6);
    const dot = p.vx * n.x + p.vy * n.y;
    if (dot < 0) {
      const r = w.params.restitution;
      p.vx = (p.vx - 2 * dot * n.x) * r;
      p.vy = (p.vy - 2 * dot * n.y) * r;
    }
    const speed = Math.hypot(p.vx, p.vy);
    if (speed >= RICOCHET_MIN_SPEED) {
      p.bounces++;
      p.x = c.fx + n.x * 0.75; p.y = c.fy + n.y * 0.75;
      ctx.emit({ type: 'bounce', weapon: 'ricochet', x: c.x, y: c.y, speed });
      return;
    }
  }
  if (c.kind === CONTACT_TERRAIN && p.weapon === 'burrower' && !p.fragment) {
    startDrill(ctx, p, c);
    return;
  }

  p.x = c.x; p.y = c.y;
  kill(p);
  impact(ctx, p, c.x, c.y, hitTank, c.fx, c.fy);
}

/** Final impact of a projectile at (x, y). hitTank = tank index on direct contact. */
function impact(ctx: SimCtx, p: ProjectileState, x: number, y: number, hitTank: number, fx: number, fy: number): void {
  const w = WEAPONS[p.weapon];
  const o = p.owner;
  switch (p.weapon) {
    case 'starfall':
      if (p.fragment) { ctx.blast(x, y, w.radius, w.damage, 'starfall', 'small', o, false, hitTank); return; }
      break;
    case 'trident':
      if (p.fragment) { ctx.blast(x, y, w.radius, w.damage, 'trident', w.explosion, o, false, hitTank); return; }
      break;
    case 'fireworks':
      if (p.mode === 'star') { starBurst(ctx, p, hitTank); return; }
      ctx.blast(x, y, w.radius, w.damage, 'fireworks', 'firework', o, true, hitTank);
      spawnStars(ctx, p, fx, fy);
      return;
    case 'magma':
      ctx.blast(x, y, w.radius, w.damage, 'magma', 'fire', o, true, hitTank);
      spawnLava(ctx, p, fx, fy);
      return;
    case 'tesla': {
      ctx.blast(x, y, w.radius, w.damage, 'tesla', 'electric', o, true, hitTank);
      const h = ctx.spawnHazard('tesla', 'tesla', o, fx, fy - 8, w.params.pulses * w.params.pulseInterval + 0.3, w.params.arcRange);
      if (h) { h.data.pulses = 0; h.data.next = w.params.pulseInterval; }
      return;
    }
    case 'singularity': {
      const h = ctx.spawnHazard('singularity', 'singularity', o, x, y - 10, w.params.duration, 0);
      if (h) {
        h.data.carved = 0;
        ctx.emit({ type: 'singularity', phase: 'open', x: h.x, y: h.y, radius: w.params.maxRadius });
      } else {
        ctx.blast(x, y, w.radius, w.damage, 'singularity', 'void', o, true, hitTank);
      }
      return;
    }
    case 'sunbeam':
      plantBeam(ctx, p, x);
      return;
    case 'earthmaker': {
      const r = w.params.moundRadius;
      ctx.emit({ type: 'explosion', weapon: 'earthmaker', kind: 'dirt', x, y, radius: r, owner: o, primary: true });
      ctx.raiseMound(x, r, r * 0.9);
      ctx.emit({ type: 'mound', x, y, radius: r });
      return;
    }
    case 'faultline': {
      ctx.blast(x, y, w.radius, w.damage, 'faultline', w.explosion, o, true, hitTank);
      const life = (w.params.eruptions * w.params.spacing) / w.params.waveSpeed + 0.2;
      const h = ctx.spawnHazard('quake', 'faultline', o, x, y, life, 0);
      if (h) { h.data.front = 0; h.data.steps = 0; }
      return;
    }
    case 'blink':
      if (hitTank >= 0) ctx.emit({ type: 'fizzle', weapon: 'blink', x, y });
      else ctx.teleport(o, x);
      return;
    default:
      break;
  }
  ctx.blast(x, y, w.radius, w.damage, p.weapon, w.explosion, o, true, hitTank);
}

// --- Burrower -------------------------------------------------------------------------

function startDrill(ctx: SimCtx, p: ProjectileState, c: Contact): void {
  const w = WEAPONS.burrower;
  let dx = p.vx, dy = p.vy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  p.x = c.fx; p.y = c.fy;
  p.vx = dx * w.params.drillSpeed;
  p.vy = dy * w.params.drillSpeed;
  p.mode = 'drill';
  p.data.drilled = 0;
  p.data.carveAcc = 99;
  p.data.cx = p.x;
  p.data.cy = p.y;
  p.rotation = Math.atan2(dy, dx);
  ctx.emit({ type: 'drill', phase: 'start', x: c.x, y: c.y });
}

function updateDrill(ctx: SimCtx, p: ProjectileState, dt: number, targets: TankTargets, ignore: number): void {
  const w = WEAPONS.burrower;
  const t = ctx.state.terrain;
  const r = w.params.tunnelRadius;
  const px = p.x, py = p.y;
  integrate(p, 0, 0, dt);
  const step = Math.hypot(p.x - px, p.y - py);
  p.data.drilled += step;
  p.data.carveAcc += step;
  if (sweep(t, targets, px, py, p.x, p.y, ignore, false, contact)) {
    finishDrill(ctx, p, contact.x, contact.y, contact.tank);
    return;
  }
  if (p.data.carveAcc >= r * 0.45) {
    t.carveCapsule(p.data.cx, p.data.cy, p.x, p.y, r);
    p.data.cx = p.x;
    p.data.cy = p.y;
    p.data.carveAcc = 0;
  }
  const speed = w.params.drillSpeed;
  const ux = p.vx / speed, uy = p.vy / speed;
  const poppedOut = p.data.drilled > 20 && !t.isSolid(p.x + ux * (r + 3), p.y + uy * (r + 3)) &&
    !t.isSolid(p.x + ux * (r + 8), p.y + uy * (r + 8));
  if (p.data.drilled >= w.params.drillDistance || poppedOut || p.y >= t.bedrockTop - r ||
    p.x < 1 || p.x > WORLD_W - 1 || p.y < 0) {
    finishDrill(ctx, p, p.x, p.y, -1);
  }
}

function finishDrill(ctx: SimCtx, p: ProjectileState, x: number, y: number, hitTank: number): void {
  const w = WEAPONS.burrower;
  kill(p);
  p.x = x; p.y = y;
  ctx.emit({ type: 'drill', phase: 'end', x, y });
  ctx.blast(x, y, w.radius, w.damage, 'burrower', w.explosion, p.owner, true, hitTank);
}

// --- Fireworks ----------------------------------------------------------------------

function spawnStars(ctx: SimCtx, p: ProjectileState, x: number, y: number): void {
  const w = WEAPONS.fireworks;
  const n = w.params.stars;
  const rng = ctx.rng;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + 0.8 * (i + 0.5) / n) + rng.range(-0.07, 0.07);
    const sp = w.params.starSpeed * rng.range(0.8, 1.1);
    const s = ctx.spawnProjectile('fireworks', p.owner, x, y - 4, Math.cos(a) * sp, -Math.sin(a) * sp, 'star', true);
    s.data.fuse = w.params.starDelay * rng.range(0.85, 1.15);
    s.data.hue = (i * 360 / n + rng.range(0, 24)) % 360;
  }
  ctx.emit({ type: 'split', weapon: 'fireworks', x, y, count: n });
}

function starBurst(ctx: SimCtx, p: ProjectileState, hitTank: number): void {
  const w = WEAPONS.fireworks;
  kill(p);
  ctx.blast(p.x, p.y, w.params.starRadius, w.params.starDamage, 'fireworks', 'firework', p.owner, false, hitTank);
}

// --- Magma & Sunbeam spawners --------------------------------------------------------

function spawnLava(ctx: SimCtx, p: ProjectileState, x: number, y: number): void {
  const w = WEAPONS.magma;
  const rng = ctx.rng;
  for (let i = 0; i < w.params.droplets; i++) {
    const life = w.params.lavaLife * rng.range(0.85, 1.15);
    const h = ctx.spawnHazard('lava', 'magma', p.owner, x + rng.range(-6, 6), y - 4, life, rng.range(3.5, 5.5));
    if (!h) break;
    h.vx = rng.range(-160, 160);
    h.vy = -rng.range(120, 320);
    h.data.st = 0;
    h.data.t0 = 99; h.data.t1 = 99;
    ctx.emit({ type: 'lava', phase: 'spawn', x: h.x, y: h.y });
  }
}

function plantBeam(ctx: SimCtx, p: ProjectileState, x: number): void {
  const w = WEAPONS.sunbeam;
  const hw = w.params.halfWidth;
  const bx = Math.max(hw, Math.min(WORLD_W - hw, x));
  const surface = Math.min(ctx.state.terrain.heightAt(bx), WORLD_H);
  const h = ctx.spawnHazard('beam', 'sunbeam', p.owner, bx, surface, w.params.chargeTime + w.params.beamTime + 0.12, hw);
  if (!h) return;
  h.data.surface = surface;
  h.data.bottom = 0;
  h.data.carved = 0;
  h.data.fired = 0;
  h.data.ended = 0;
  h.data.hit0 = 0; h.data.hit1 = 0;
  ctx.emit({ type: 'beam', phase: 'mark', x: bx, y: surface, halfWidth: hw });
}

// =====================================================================================
// Hazards
// =====================================================================================

/** Advances one hazard by one substep. Marks it dead (data.dead = 1) when finished. */
export function updateHazard(ctx: SimCtx, h: HazardState, dt: number): void {
  if (dead(h)) return;
  h.age += dt;
  switch (h.kind) {
    case 'lava': updateLava(ctx, h, dt); break;
    case 'tesla': updateTesla(ctx, h); break;
    case 'singularity': updateSingularity(ctx, h, dt); break;
    case 'beam': updateBeam(ctx, h); break;
    case 'quake': updateQuake(ctx, h, dt); break;
  }
}

/** Resolves a hazard immediately (flight timeout / round end): runs its final effect without waiting. */
export function finishHazard(ctx: SimCtx, h: HazardState): void {
  if (dead(h)) return;
  switch (h.kind) {
    case 'lava': coolLava(ctx, h); break;
    case 'singularity': collapseSingularity(ctx, h); break;
    case 'beam':
      if (h.data.fired === 1 && h.data.ended !== 1) ctx.emit({ type: 'beam', phase: 'end', x: h.x, y: h.data.surface, halfWidth: h.radius });
      break;
    default: break;
  }
  kill(h);
}

// --- Lava -------------------------------------------------------------------------------

const LAVA_SLIDE_GRAVITY = 0.6;
const LAVA_FRICTION = 2.4;

function updateLava(ctx: SimCtx, h: HazardState, dt: number): void {
  const st = ctx.state;
  const t = st.terrain;
  const w = WEAPONS.magma;
  if (h.data.st === 0) {
    // Airborne droplet: plain ballistic fall (no wind).
    const px = h.x, py = h.y;
    integrate(h, 0, st.gravity, dt);
    if (sweep(t, null, px, py, h.x, h.y, -1, true, contact)) {
      h.x = contact.fx;
      h.y = t.surfaceY(contact.fx, contact.y - 6);
      h.vx *= 0.45;
      h.vy = 0;
      h.data.st = 1;
    }
  } else {
    // Sliding along the surface, accelerating downhill, settling into hollows.
    const gl = t.surfaceY(h.x - 3, h.y - 8), gr = t.surfaceY(h.x + 3, h.y - 8);
    const slope = (gr - gl) / 6;
    h.vx += (st.gravity * LAVA_SLIDE_GRAVITY * slope) / Math.sqrt(1 + slope * slope) * dt;
    h.vx *= Math.exp(-LAVA_FRICTION * dt);
    if (Math.abs(h.vx) < 2 && Math.abs(slope) < 0.08) h.vx = 0;
    const nx = h.x + h.vx * dt;
    if (nx < 1 || nx > WORLD_W - 1) { kill(h); return; }
    const ng = t.surfaceY(nx, h.y - 8);
    if (ng <= Math.floor(h.y - 8)) {
      h.vx = 0; // wall: pool against it
      const g = t.surfaceY(h.x, h.y - 8);
      if (g > Math.floor(h.y - 8)) h.y = g;
    } else if (ng > h.y + 6) {
      h.x = nx; h.vy = 0; h.data.st = 0; // ran off a ledge
    } else {
      h.x = nx; h.y = ng;
    }
  }
  if (h.y > WORLD_H + 60 || h.x < -60 || h.x > WORLD_W + 60) { kill(h); return; }

  // Scorch tanks the blob touches (per droplet, per tank, at most once per tickInterval).
  for (let i = 0; i < 2; i++) {
    const key = i === 0 ? 't0' : 't1';
    h.data[key] += dt;
    const tank = st.tanks[i];
    if (!tank.alive || h.data[key] < w.params.tickInterval) continue;
    const r = h.radius;
    if (Math.abs(h.x - tank.x) < TANK_HALF_WIDTH + r && h.y > tank.y - TANK_HULL_HEIGHT - r && h.y < tank.y + r + 3) {
      h.data[key] = 0;
      const amount = Math.min(w.params.dropletDamage, LAVA_DAMAGE_CAP - ctx.lavaTaken[i]);
      if (amount <= 0) continue;
      ctx.lavaTaken[i] += amount;
      ctx.damageTank(i as PlayerIndex, amount, 'magma', false, h.owner, h.x, h.y);
    }
  }
  if (h.age >= h.life) coolLava(ctx, h);
}

function coolLava(ctx: SimCtx, h: HazardState): void {
  kill(h);
  if (h.x < 0 || h.x >= WORLD_W || h.y > WORLD_H) return;
  if (h.data.st === 1) ctx.fillBasalt(h.x, h.y - 1, 3);
  ctx.emit({ type: 'lava', phase: 'cool', x: h.x, y: h.y });
  if (h.data.st === 1) ctx.emit({ type: 'mound', x: h.x, y: h.y - 1, radius: 3 });
}

// --- Tesla ------------------------------------------------------------------------------

function updateTesla(ctx: SimCtx, h: HazardState): void {
  const w = WEAPONS.tesla;
  const st = ctx.state;
  const rng = ctx.rng;
  while (h.data.pulses < w.params.pulses && h.age >= h.data.next) {
    h.data.pulses++;
    h.data.next += w.params.pulseInterval;
    for (let i = 0; i < 2; i++) {
      const tank = st.tanks[i];
      if (!tank.alive) continue;
      const c = tankCenter(tank);
      if (Math.hypot(c.x - h.x, c.y - h.y) > w.params.arcRange) continue;
      ctx.emit({ type: 'lightning', x1: h.x, y1: h.y, x2: c.x, y2: c.y, target: i as PlayerIndex });
      ctx.damageTank(i as PlayerIndex, w.params.arcDamage, 'tesla', false, h.owner, c.x, c.y);
    }
    const arcs = rng.int(2, 3);
    for (let k = 0; k < arcs; k++) {
      const x2 = Math.max(0, Math.min(WORLD_W - 1, h.x + rng.sign() * rng.range(30, w.params.arcRange * 0.55)));
      let y2 = st.terrain.surfaceY(x2, h.y - 70);
      if (y2 > h.y + 90) y2 = h.y + 90;
      ctx.emit({ type: 'lightning', x1: h.x, y1: h.y, x2, y2, target: null });
    }
  }
  if (h.age >= h.life) kill(h);
}

// --- Singularity ----------------------------------------------------------------------

function updateSingularity(ctx: SimCtx, h: HazardState, dt: number): void {
  const w = WEAPONS.singularity;
  const st = ctx.state;
  const k = Math.min(1, h.age / w.params.duration);
  h.radius = w.params.maxRadius * easeOutCubic(k);
  if (h.radius - h.data.carved >= 2 || (k >= 1 && h.data.carved < h.radius)) {
    st.terrain.carveCircle(h.x, h.y, h.radius, 0.5);
    h.data.carved = h.radius;
  }
  for (let i = 0; i < 2; i++) {
    const tank = st.tanks[i];
    if (!tank.alive || tank.airborne) continue;
    const c = tankCenter(tank);
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    if (d > w.params.pullRadius || Math.abs(tank.x - h.x) < 3) continue;
    const speed = w.params.pullSpeed * (0.35 + 0.65 * (1 - d / w.params.pullRadius));
    ctx.pushTank(i as PlayerIndex, (h.x > tank.x ? 1 : -1) * speed * dt);
  }
  if (h.age >= h.life) collapseSingularity(ctx, h);
}

function collapseSingularity(ctx: SimCtx, h: HazardState): void {
  const w = WEAPONS.singularity;
  kill(h);
  ctx.emit({ type: 'singularity', phase: 'collapse', x: h.x, y: h.y, radius: h.radius });
  ctx.blast(h.x, h.y, w.radius, w.damage, 'singularity', 'void', h.owner, true, -1);
}

// --- Sunbeam ----------------------------------------------------------------------------

function updateBeam(ctx: SimCtx, h: HazardState): void {
  const w = WEAPONS.sunbeam;
  const st = ctx.state;
  const charge = w.params.chargeTime, dur = w.params.beamTime, hw = h.radius;
  if (h.age < charge) return;
  if (h.data.fired !== 1) {
    h.data.fired = 1;
    ctx.emit({ type: 'beam', phase: 'fire', x: h.x, y: h.data.surface, halfWidth: hw });
    ctx.emit({ type: 'explosion', weapon: 'sunbeam', kind: 'beam', x: h.x, y: h.data.surface, radius: hw, owner: h.owner, primary: true });
  }
  if (h.data.ended === 1) {
    if (h.age >= h.life) kill(h);
    return;
  }
  const p = Math.min(1, (h.age - charge) / dur);
  // The column of light is open from the sky at once; the trench bites from just above the surface down.
  const top = h.data.surface - 30;
  const bottom = Math.min(st.terrain.bedrockTop, top + (w.params.depth + 30) * p);
  h.data.bottom = bottom;
  if (bottom - h.data.carved >= 3 || p >= 1) {
    st.terrain.carveRect(h.x - hw, 0, h.x + hw, bottom);
    h.data.carved = bottom;
    ctx.collectCratesRect(h.x - hw, -200, h.x + hw, bottom, h.owner);
  }
  for (let i = 0; i < 2; i++) {
    const key = i === 0 ? 'hit0' : 'hit1';
    const tank = st.tanks[i];
    if (h.data[key] === 1 || !tank.alive) continue;
    const overlap = Math.min(tank.x + TANK_HALF_WIDTH, h.x + hw) - Math.max(tank.x - TANK_HALF_WIDTH, h.x - hw);
    if (overlap <= 0 || bottom < tank.y - TANK_HULL_HEIGHT) continue;
    h.data[key] = 1;
    const frac = Math.min(1, overlap / (2 * Math.min(TANK_HALF_WIDTH, hw)));
    const dmg = Math.round(w.damage * (0.5 + 0.5 * frac));
    ctx.damageTank(i as PlayerIndex, dmg, 'sunbeam', frac >= 0.95, h.owner, tank.x, tank.y - TANK_HULL_HEIGHT * 0.5);
  }
  if (p >= 1) {
    h.data.ended = 1;
    st.terrain.carveCircle(h.x, bottom, hw, 1);
    ctx.emit({ type: 'beam', phase: 'end', x: h.x, y: h.data.surface, halfWidth: hw });
  }
}

// --- Faultline ---------------------------------------------------------------------------

function updateQuake(ctx: SimCtx, h: HazardState, dt: number): void {
  const w = WEAPONS.faultline;
  const t = ctx.state.terrain;
  h.data.front += w.params.waveSpeed * dt;
  h.radius = h.data.front;
  while (h.data.steps < w.params.eruptions && h.data.front >= (h.data.steps + 1) * w.params.spacing) {
    const step = ++h.data.steps;
    for (let side = -1; side <= 1; side += 2) {
      const ex = h.x + side * step * w.params.spacing;
      if (ex < 0 || ex >= WORLD_W) continue;
      const ey = Math.min(t.heightAt(ex), t.bedrockTop);
      ctx.emit({ type: 'quake', x: ex, y: ey, step });
      ctx.blast(ex, ey, w.params.eruptionRadius, w.params.eruptionDamage, 'faultline', 'small', h.owner, false, -1);
    }
  }
  if (h.data.steps >= w.params.eruptions || h.age >= h.life + 1) kill(h);
}

/** Heal and shield utilities. Returns the amount applied. */
export function applyUtility(ctx: SimCtx, player: PlayerIndex, weapon: WeaponId): number {
  const tank = ctx.state.tanks[player];
  const w = WEAPONS[weapon];
  if (weapon === 'repair') {
    const amount = Math.max(0, Math.min(w.params.heal, (tank.maxHp || MAX_HP) - tank.hp));
    tank.hp += amount;
    ctx.emit({ type: 'utility', player, weapon, x: tank.x, y: tank.y, amount });
    ctx.emit({ type: 'heal', target: player, amount, x: tank.x, y: tank.y - TANK_HULL_HEIGHT });
    return amount;
  }
  if (weapon === 'aegis') {
    const before = tank.shield;
    tank.shield = Math.max(before, Math.min(AEGIS_CAP, before + w.params.shield));
    const amount = tank.shield - before;
    ctx.emit({ type: 'utility', player, weapon, x: tank.x, y: tank.y, amount });
    ctx.emit({ type: 'shieldUp', target: player, amount: tank.shield });
    return amount;
  }
  return 0;
}

/** Shields never stack above this. */
export const AEGIS_CAP = 60;
