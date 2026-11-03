// Minimal stand-ins for the render modules so the render core can be tested in isolation.
import { BIOMES, type BiomeId } from '../../src/core/biomes.ts';
import { mixHex, rgba } from '../../src/core/color.ts';
import { WORLD_H, WORLD_W } from '../../src/core/constants.ts';
import type { GameEvent } from '../../src/core/events.ts';
import { turretPivot } from '../../src/core/geometry.ts';
import { DEG, TAU } from '../../src/core/math.ts';
import type { Quality } from '../../src/core/settings.ts';
import type { GameState, TankState } from '../../src/core/types.ts';
import { WEAPONS } from '../../src/core/weapons.ts';
import type {
  BackgroundApi, EntityRendererApi, FxApi, FxHooks, LightSource, TankDrawInfo, TankRendererApi, ViewInfo,
} from '../../src/contracts.ts';

export class StubBackground implements BackgroundApi {
  private biome: BiomeId = 'verdant';
  setBiome(biome: BiomeId): void { this.biome = biome; }
  update(): void {}
  drawBack(ctx: CanvasRenderingContext2D, v: ViewInfo): void {
    const p = BIOMES[this.biome].palette;
    // World y → device y.
    const yOf = (wy: number): number => (wy - v.top) * (v.ch / (v.bottom - v.top));
    const xOf = (wx: number): number => (wx - v.left) * (v.cw / (v.right - v.left));
    const g = ctx.createLinearGradient(0, yOf(-400), 0, yOf(WORLD_H * 0.7));
    g.addColorStop(0, p.sky[0]);
    g.addColorStop(0.55, p.sky[1]);
    g.addColorStop(1, p.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.cw, v.ch);
    // Celestial body.
    const cx = xOf(WORLD_W * 0.72), cy = yOf(WORLD_H * 0.22), r = 60 * (v.cw / (v.right - v.left));
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
    glow.addColorStop(0, rgba(p.celestialGlow, 0.55));
    glow.addColorStop(1, rgba(p.celestialGlow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 4, cy - r * 4, r * 8, r * 8);
    ctx.fillStyle = p.celestial;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    // Three parallax-free silhouette layers.
    for (let L = 0; L < 3; L++) {
      ctx.fillStyle = p.far[L];
      ctx.beginPath();
      ctx.moveTo(0, v.ch);
      for (let x = -200; x <= WORLD_W + 200; x += 40) {
        const wy = WORLD_H * (0.42 + L * 0.07) + Math.sin(x * 0.004 + L * 2) * 60 + Math.sin(x * 0.011 + L) * 25;
        ctx.lineTo(xOf(x), yOf(wy));
      }
      ctx.lineTo(v.cw, v.ch);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = rgba(p.haze, 0.18);
    ctx.fillRect(0, yOf(WORLD_H * 0.5), v.cw, v.ch);
  }
  drawFront(): void {}
  thumbnail(biome: BiomeId, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = BIOMES[biome].palette.sky[1];
    g.fillRect(0, 0, w, h);
    return c;
  }
}

export class StubTanks implements TankRendererApi {
  draw(ctx: CanvasRenderingContext2D, t: TankState, info: TankDrawInfo): void {
    if (!t.alive) return;
    const p = turretPivot(t);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.tilt);
    ctx.fillStyle = '#20242c';
    ctx.beginPath();
    ctx.roundRect(-28, -10, 56, 10, 5);
    ctx.fill();
    ctx.fillStyle = info.team.primary;
    ctx.beginPath();
    ctx.moveTo(-25, -10); ctx.lineTo(-20, -20); ctx.lineTo(20, -20); ctx.lineTo(26, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = info.team.light;
    ctx.fillRect(-18, -20, 36, 2);
    ctx.restore();
    ctx.strokeStyle = info.team.dark;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(t.angle * DEG) * 32, p.y - Math.sin(t.angle * DEG) * 32);
    ctx.stroke();
    ctx.fillStyle = mixHex(info.team.primary, '#ffffff', 0.2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, Math.PI, TAU);
    ctx.fill();
  }
}

export class StubEntities implements EntityRendererApi {
  update(): void {}
  handleEvent(): void {}
  drawCrates(): void {}
  drawProjectiles(ctx: CanvasRenderingContext2D, s: GameState): void {
    for (const p of s.projectiles) {
      const w = WEAPONS[p.weapon];
      ctx.strokeStyle = rgba(w.glow, 0.5);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
      ctx.stroke();
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, TAU);
      ctx.fill();
    }
  }
  clear(): void {}
}

interface Boom { x: number; y: number; r: number; age: number }

export class StubFx implements FxApi {
  private booms: Boom[] = [];
  private lightList: LightSource[] = [];
  private readonly hooks: FxHooks;
  constructor(hooks: FxHooks) { this.hooks = hooks; }
  handleEvent(e: GameEvent): void {
    if (e.type === 'explosion') {
      this.booms.push({ x: e.x, y: e.y, r: e.radius, age: 0 });
      this.hooks.shake(0.45);
      this.hooks.shockwave(e.x, e.y, 0.7);
      this.hooks.flash('#ffd9a0', 0.25);
    }
    if (e.type === 'tankDestroyed') this.hooks.focus(e.x, e.y, 1.35, 2.4);
  }
  update(dt: number): void {
    for (const b of this.booms) b.age += dt;
    this.booms = this.booms.filter(b => b.age < 0.8);
    this.lightList = this.booms.map(b => ({ x: b.x, y: b.y, radius: b.r * 3.2, color: '#ffb060', intensity: 1.4 * (1 - b.age / 0.8) }));
  }
  drawBack(): void {}
  drawFront(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.booms) {
      const k = b.age / 0.8;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * (1 + k));
      g.addColorStop(0, `rgba(255,240,200,${0.9 * (1 - k)})`);
      g.addColorStop(0.5, `rgba(255,140,40,${0.6 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (1 + k), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  lights(): readonly LightSource[] { return this.lightList; }
  particleCount(): number { return 0; }
  setQuality(_q: Quality, _rm: boolean): void {}
  clear(): void { this.booms = []; }
}
