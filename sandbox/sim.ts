/**
 * Simulation sandbox: a plain debug view of the Game (no renderer modules needed).
 * URL: ?biome=<id>|random&seed=<n>&mode=attract|cpu|duel&difficulty=<d>&weapon=<id>&manual=1
 * window.sim = { game, step(seconds), shoot(angle, power, weapon?) } for scripted screenshots.
 */
import { Game } from '../src/sim/game.ts';
import { planShot } from '../src/sim/ai.ts';
import { Rng } from '../src/core/rng.ts';
import { TEAMS } from '../src/core/teams.ts';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../src/core/weapons.ts';
import { BIOMES, type BiomeId } from '../src/core/biomes.ts';
import { muzzlePoint, tankCenter, turretPivot } from '../src/core/geometry.ts';
import { DEG } from '../src/core/math.ts';
import { TANK_HALF_WIDTH, TANK_HULL_HEIGHT, WORLD_H, WORLD_W, CRATE_SIZE } from '../src/core/constants.ts';
import type { GameEvent } from '../src/core/events.ts';
import type { Difficulty, TankState } from '../src/core/types.ts';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const terrainCanvas = document.createElement('canvas');
terrainCanvas.width = WORLD_W;
terrainCanvas.height = WORLD_H;
const tctx = terrainCanvas.getContext('2d')!;

const game = new Game();
const mode = q.get('mode') ?? 'attract';
const difficulty = (q.get('difficulty') ?? 'normal') as Difficulty;
game.newMatch({
  players: [
    { name: 'Azure', kind: mode === 'duel' ? 'human' : mode === 'cpu' ? 'human' : 'cpu', difficulty },
    { name: 'Blaze', kind: mode === 'duel' ? 'human' : 'cpu', difficulty },
  ],
  biome: (q.get('biome') ?? 'random') as BiomeId | 'random',
  roundsToWin: 3, crates: true, seed: Number(q.get('seed') ?? 7), attract: mode === 'attract',
});
const forced = q.get('weapon') as WeaponId | null;

const log: string[] = [];
const flashes: { x: number; y: number; r: number; t: number; color: string }[] = [];
const bolts: { x1: number; y1: number; x2: number; y2: number; t: number }[] = [];
game.events.on((e: GameEvent) => {
  if (e.type === 'explosion') flashes.push({ x: e.x, y: e.y, r: e.radius, t: 0.35, color: WEAPONS[e.weapon].glow });
  if (e.type === 'lightning') bolts.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, t: 0.15 });
  if (e.type === 'roundStart') tctx.clearRect(0, 0, WORLD_W, WORLD_H);
  if (e.type === 'turnStart' && forced) {
    const t = game.state.tanks[e.player];
    t.ammo[forced] = 9;
  }
  if (e.type !== 'dirtFall') {
    log.push(`${e.type} ${JSON.stringify(e).slice(9 + e.type.length, 90)}`);
    if (log.length > 14) log.shift();
  }
});

let img: ImageData | null = null;
function syncTerrain(): void {
  const t = game.state.terrain;
  const d = t.takeDirty();
  if (!d) return;
  const w = d.x1 - d.x0, h = d.y1 - d.y0;
  if (w <= 0 || h <= 0) return;
  if (!img || img.width !== w || img.height !== h) img = new ImageData(w, h);
  t.writeRGBA(d, img.data);
  tctx.putImageData(img, d.x0, d.y0);
}

function drawTank(t: TankState): void {
  const team = TEAMS[t.index];
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.tilt);
  ctx.fillStyle = t.alive ? team.primary : '#333';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-TANK_HALF_WIDTH, -TANK_HULL_HEIGHT * 0.6, TANK_HALF_WIDTH * 2, TANK_HULL_HEIGHT * 0.6, 5);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.fillRect(-TANK_HALF_WIDTH, -4, TANK_HALF_WIDTH * 2, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 6; i++) ctx.fillRect(-TANK_HALF_WIDTH + ((i * 10 + t.treadPhase) % 56 + 56) % 56, -4, 3, 4);
  ctx.beginPath();
  ctx.fillStyle = t.alive ? team.light : '#444';
  ctx.arc(0, -TANK_HULL_HEIGHT * 0.6, 11, Math.PI, 0);
  ctx.fill(); ctx.stroke();
  ctx.restore();
  const p = turretPivot(t), m = muzzlePoint(t, 34 - t.recoil * 8);
  ctx.strokeStyle = t.hitFlash > 0 ? '#fff' : '#111';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.stroke();
  const c = tankCenter(t);
  ctx.fillStyle = '#000a';
  ctx.fillRect(c.x - 30, c.y - 52, 60, 7);
  ctx.fillStyle = team.primary;
  ctx.fillRect(c.x - 30, c.y - 52, 60 * (t.hp / t.maxHp), 7);
  if (t.shield > 0) {
    ctx.strokeStyle = '#6ee7ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y - 4, 38, 0, Math.PI * 2); ctx.stroke();
  }
  if (t.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${t.hitFlash * 0.6})`;
    ctx.beginPath(); ctx.arc(c.x, c.y, 26, 0, Math.PI * 2); ctx.fill();
  }
}

function draw(dt: number): void {
  const st = game.state;
  const biome = BIOMES[st.biome];
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, biome.palette.sky[0]);
  sky.addColorStop(1, biome.palette.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  syncTerrain();
  ctx.drawImage(terrainCanvas, 0, 0);
  // Aim guide.
  if (st.phase === 'aiming') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const v of game.aimGuide(900)) { ctx.fillRect(v.x - 1.5, v.y - 1.5, 3, 3); }
  }
  for (const i of [0, 1] as const) {
    const path = game.lastShotPath(i);
    ctx.strokeStyle = TEAMS[i].primary + '55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((v, k) => (k ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.stroke();
  }
  for (const c of st.crates) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.sway);
    if (c.parachute > 0) {
      ctx.globalAlpha = c.parachute;
      ctx.fillStyle = '#f5f0e6';
      ctx.beginPath(); ctx.arc(0, -CRATE_SIZE - 34, 26, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#ccc';
      ctx.beginPath(); ctx.moveTo(-26, -CRATE_SIZE - 34); ctx.lineTo(-8, -CRATE_SIZE); ctx.moveTo(26, -CRATE_SIZE - 34); ctx.lineTo(8, -CRATE_SIZE); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#b07a3c';
    ctx.fillRect(-CRATE_SIZE / 2, -CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
    ctx.fillStyle = WEAPONS[c.weapon].color;
    ctx.fillRect(-5, -CRATE_SIZE + 6, 10, 10);
    ctx.restore();
  }
  for (const t of st.tanks) drawTank(t);
  for (const h of st.hazards) {
    const w = WEAPONS[h.weapon];
    ctx.strokeStyle = w.glow;
    ctx.fillStyle = w.color;
    if (h.kind === 'lava') { ctx.beginPath(); ctx.arc(h.x, h.y - h.radius * 0.6, h.radius, 0, Math.PI * 2); ctx.fill(); }
    else if (h.kind === 'singularity') { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(h.x, h.y, h.radius * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2); ctx.stroke(); }
    else if (h.kind === 'beam') {
      ctx.globalAlpha = h.data.fired ? 0.8 : 0.25;
      ctx.fillRect(h.x - h.radius, 0, h.radius * 2, h.data.fired ? h.data.bottom : h.data.surface);
      ctx.globalAlpha = 1;
    } else if (h.kind === 'tesla') { ctx.beginPath(); ctx.arc(h.x, h.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2); ctx.stroke(); }
    else if (h.kind === 'quake') { ctx.fillRect(h.x - h.radius, h.y - 4, 4, 8); ctx.fillRect(h.x + h.radius, h.y - 4, 4, 8); }
  }
  for (const p of st.projectiles) {
    const w = WEAPONS[p.weapon];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.data.hue !== undefined ? `hsl(${p.data.hue},100%,65%)` : w.color;
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 0, w.projectile.size * 1.4, w.projectile.size * 0.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t -= dt;
    if (f.t <= 0) { flashes.splice(i, 1); continue; }
    ctx.globalAlpha = f.t / 0.35;
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.3 - f.t), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#bff';
  ctx.lineWidth = 2;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t -= dt;
    if (b.t <= 0) { bolts.splice(i, 1); continue; }
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo((b.x1 + b.x2) / 2 + 8, (b.y1 + b.y2) / 2 - 8); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  const a = st.tanks[st.activePlayer];
  hud.textContent = `${st.biome}  round ${st.round}  turn ${st.turn}  phase ${st.phase} ${st.phaseTime.toFixed(1)}s  wind ${st.wind}  wins ${st.wins.join(':')}\n` +
    `active P${st.activePlayer} ${a.weapon} angle ${a.angle} power ${a.power} fuel ${a.fuel.toFixed(0)} cpuThinking ${st.cpuThinking}\n` +
    `projectiles ${st.projectiles.length} hazards ${st.hazards.length} crates ${st.crates.length}  hp ${st.tanks.map(t => t.hp).join(' / ')}\n\n` +
    log.join('\n');
}

let last = performance.now();
const manual = q.get('manual') === '1';
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual) game.update(dt);
  draw(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { sim: unknown }).sim = {
  game,
  /** Advance the sim instantly by `seconds` at 60 Hz. */
  step(seconds: number): void { for (let t = 0; t < seconds; t += 1 / 60) game.update(1 / 60); },
  /** Human-controlled shot (mode=duel or cpu with player 0). */
  shoot(angle: number, power: number, weapon?: WeaponId): boolean {
    const t = game.state.tanks[game.state.activePlayer];
    if (weapon) { t.ammo[weapon] = Math.max(1, t.ammo[weapon]); game.selectWeapon(weapon); }
    game.setAngle(angle);
    game.setPower(power);
    return game.fire();
  },
  /** Fires `weapon` with a hard-CPU solution (ember ballistics) for the active player. */
  aim(weapon: WeaponId, offsetPower = 0): boolean {
    const st = game.state;
    const t = st.tanks[st.activePlayer];
    const saved = { ...t.ammo };
    for (const id of WEAPON_ORDER) if (id !== 'ember') t.ammo[id] = 0;
    const plan = planShot(st, st.activePlayer, 'hard', new Rng(1));
    Object.assign(t.ammo, saved);
    t.ammo[weapon] = Math.max(1, t.ammo[weapon]);
    game.selectWeapon(weapon);
    game.setAngle(plan.angle);
    game.setPower(plan.power + offsetPower);
    return game.fire();
  },
  weapons: WEAPON_ORDER,
  DEG,
};
