// Scripted scenes for the fx sandbox: each triggers one explosion kind / event family.
import type { GameEvent } from '../../src/core/events.ts';
import type { GameState, HazardKind, HazardState } from '../../src/core/types.ts';
import { BIOMES } from '../../src/core/biomes.ts';
import { WEAPONS, type ExplosionKind, type WeaponId } from '../../src/core/weapons.ts';
import type { Vec2 } from '../../src/core/math.ts';
import type { Terrain } from '../../src/sim/terrain.ts';
import { makeDirtPainter } from '../../src/sim/terrainGen.ts';

export interface SceneApi {
  readonly state: GameState;
  readonly terrain: Terrain;
  readonly spawns: [number, number];
  emit(e: GameEvent): void;
  addHazard(kind: HazardKind, weapon: WeaponId, x: number, y: number, life: number, radius: number): HazardState;
  at(t: number, fn: () => void): void;
  /** Per-step callback; return false to stop. */
  tick(fn: (dt: number) => boolean): void;
  blast(x: number, y: number, kind: ExplosionKind, weapon: WeaponId, radius: number, primary?: boolean, carve?: boolean): void;
  ground(x: number): number;
  muzzle(i: 0 | 1): Vec2;
  center(i: 0 | 1): Vec2;
  pivot(i: 0 | 1): Vec2;
}

export interface Scene { length: number; run(api: SceneApi): void }

const W = 1920;

export const SCENES: Record<string, Scene> = {
  intro: {
    length: 2,
    run(a) {
      a.at(0, () => {
        for (const t of a.state.tanks) { t.airborne = true; t.y = a.ground(t.x) - 260; t.fallStartY = t.y; t.vy = 0; }
      });
    },
  },
  fire: {
    length: 1.6,
    run(a) {
      a.at(0.1, () => { const m = a.muzzle(0); const t = a.state.tanks[0]; t.recoil = 1; a.emit({ type: 'fire', player: 0, weapon: 'ember', x: m.x, y: m.y, angle: t.angle, power: 60 }); });
      a.at(0.7, () => { const m = a.muzzle(1); const t = a.state.tanks[1]; t.recoil = 1; a.emit({ type: 'fire', player: 1, weapon: 'thunderhead', x: m.x, y: m.y, angle: t.angle, power: 70 }); });
    },
  },
  standard: {
    length: 2.6,
    run(a) {
      a.at(0.1, () => a.blast(W * 0.42, a.ground(W * 0.42), 'standard', 'ember', 42));
      a.at(1.0, () => a.blast(W * 0.58, a.ground(W * 0.58), 'standard', 'trident', 34));
    },
  },
  heavy: {
    length: 3.2,
    run(a) {
      a.at(0.1, () => {
        const x = a.state.tanks[1].x - 70;
        a.blast(x, a.ground(x), 'heavy', 'thunderhead', 78);
        const c = a.center(1);
        a.state.tanks[1].hp = 55;
        a.emit({ type: 'damage', target: 1, amount: 45, absorbed: 0, x: c.x, y: c.y, weapon: 'thunderhead', direct: false, hpAfter: 55, by: 0 });
      });
    },
  },
  small: {
    length: 2.4,
    run(a) {
      const x0 = W * 0.5;
      a.at(0.05, () => a.emit({ type: 'split', weapon: 'starfall', x: x0, y: 260, count: 9 }));
      for (let i = 0; i < 9; i++) {
        const x = x0 - 200 + i * 50;
        a.at(0.6 + i * 0.07, () => a.blast(x, a.ground(x), 'small', 'starfall', 24, false));
      }
    },
  },
  electric: {
    length: 2.6,
    run(a) {
      const x = a.state.tanks[1].x - 150;
      let y = 0;
      a.at(0.1, () => {
        y = a.ground(x);
        a.blast(x, y, 'electric', 'tesla', 26);
        a.addHazard('tesla', 'tesla', x, y - 4, 1.3, 26);
      });
      for (let p = 0; p < 3; p++) {
        a.at(0.2 + p * 0.38, () => {
          const c = a.center(1);
          a.emit({ type: 'lightning', x1: x, y1: y - 4, x2: c.x, y2: c.y, target: 1 });
          for (let g = 0; g < 2; g++) {
            const gx = x + (Math.random() - 0.5) * 260;
            a.emit({ type: 'lightning', x1: x, y1: y - 4, x2: gx, y2: a.ground(gx), target: null });
          }
          a.emit({ type: 'damage', target: 1, amount: 9, absorbed: 0, x: c.x, y: c.y, weapon: 'tesla', direct: false, hpAfter: 40, by: 0 });
        });
      }
    },
  },
  magma: {
    length: 5.4,
    run(a) {
      const x = W * 0.36;
      a.at(0.1, () => {
        const y = a.ground(x);
        a.blast(x, y, 'fire', 'magma', 30);
        for (let i = 0; i < 16; i++) {
          const h = a.addHazard('lava', 'magma', x, y - 6, 4.5, 4 + Math.random() * 2.5);
          h.vx = (Math.random() - 0.5) * 320; h.vy = -120 - Math.random() * 200;
          a.emit({ type: 'lava', phase: 'spawn', x, y: y - 6 });
          a.tick((dt) => {
            if (h.age >= h.life - 0.02) { a.emit({ type: 'lava', phase: 'cool', x: h.x, y: h.y }); return false; }
            h.vy += 520 * dt;
            const nx = h.x + h.vx * dt, ny = h.y + h.vy * dt;
            const gy = a.terrain.surfaceY(nx, Math.max(0, ny - 20));
            if (ny >= gy) {
              // Slide downhill.
              const l = a.terrain.surfaceY(nx - 3, gy - 20), r = a.terrain.surfaceY(nx + 3, gy - 20);
              h.vx = h.vx * 0.9 + (r - l) * 8 * dt * 60; h.vx *= 0.94; h.vy = 0;
              h.x = nx; h.y = a.terrain.surfaceY(nx, Math.max(0, gy - 20));
            } else { h.x = nx; h.y = ny; }
            return true;
          });
        }
      });
    },
  },
  void: {
    length: 3.2,
    run(a) {
      const x = W * 0.62;
      a.at(0.1, () => {
        const y = a.ground(x) - 10;
        a.emit({ type: 'singularity', phase: 'open', x, y, radius: 4 });
        const h = a.addHazard('singularity', 'singularity', x, y, 1.6, 4);
        a.tick(() => {
          const k = Math.min(1, h.age / 1.6);
          h.radius = 4 + 72 * (1 - (1 - k) * (1 - k));
          a.terrain.carveCircle(h.x, h.y, h.radius * 0.8, 0);
          if (h.age >= 1.58) {
            a.emit({ type: 'singularity', phase: 'collapse', x, y, radius: h.radius });
            a.blast(x, y, 'void', 'singularity', 50);
            return false;
          }
          return true;
        });
      });
    },
  },
  beam: {
    length: 3.4,
    run(a) {
      const x = W * 0.5;
      a.at(0.1, () => {
        const y = a.ground(x);
        a.emit({ type: 'beam', phase: 'mark', x, y, halfWidth: 26 });
        const h = a.addHazard('beam', 'sunbeam', x, y, 0.9 + 0.75, 26);
        let fired = false;
        a.tick(() => {
          if (!fired && h.age >= 0.9) {
            fired = true;
            a.emit({ type: 'beam', phase: 'fire', x, y: a.ground(x), halfWidth: 26 });
            a.blast(x, a.ground(x), 'beam', 'sunbeam', 26, true, false);
          }
          if (fired) {
            const depth = Math.min(1, (h.age - 0.9) / 0.75) * 240;
            a.terrain.carveRect(x - 26, 0, x + 26, Math.min(1080 - 30, y + depth));
          }
          if (h.age >= h.life - 0.02) { a.emit({ type: 'beam', phase: 'end', x, y: a.ground(x), halfWidth: 26 }); return false; }
          return true;
        });
      });
    },
  },
  dirt: {
    length: 2.4,
    run(a) {
      const x = W * 0.44;
      a.at(0.1, () => {
        const y = a.ground(x) - 40;
        a.blast(x, y, 'dirt', 'earthmaker', 92, true, false);
        a.terrain.fillCircle(x, y, 80, makeDirtPainter(BIOMES[a.state.biome], 3));
        a.emit({ type: 'mound', x, y, radius: 80 });
      });
    },
  },
  firework: {
    length: 2.8,
    run(a) {
      const x = W * 0.55;
      a.at(0.1, () => a.blast(x, a.ground(x), 'firework', 'fireworks', 28));
      for (let i = 0; i < 6; i++) {
        a.at(0.9 + i * 0.1, () => {
          const sx = x - 220 + i * 90, sy = a.ground(x) - 220 - Math.random() * 120;
          a.emit({ type: 'explosion', weapon: 'fireworks', kind: 'firework', x: sx, y: sy, radius: 22, owner: 0, primary: false });
        });
      }
    },
  },
  quake: {
    length: 2.6,
    run(a) {
      const x = W * 0.5;
      a.at(0.1, () => {
        const y = a.ground(x);
        a.blast(x, y, 'standard', 'faultline', 30);
        const h = a.addHazard('quake', 'faultline', x, y, 0.62, 0);
        let step = 0;
        a.tick(() => {
          h.radius = h.age * 420;
          while (step < 4 && h.radius >= (step + 1) * 60) {
            step++;
            for (const s of [-1, 1]) {
              const ex = x + s * step * 60, ey = a.ground(ex);
              a.emit({ type: 'quake', x: ex, y: ey, step });
              a.blast(ex, ey, 'small', 'faultline', 26, false);
            }
          }
          return h.age < h.life;
        });
      });
    },
  },
  utility: {
    length: 6.4,
    run(a) {
      const t0 = a.state.tanks[0];
      a.at(0.1, () => { const c = a.center(0); a.emit({ type: 'utility', player: 0, weapon: 'repair', x: c.x, y: c.y, amount: 30 }); a.emit({ type: 'heal', target: 0, amount: 30, x: c.x, y: c.y }); });
      a.at(0.9, () => { t0.shield = 45; a.emit({ type: 'shieldUp', target: 0, amount: 45 }); });
      a.at(1.6, () => { const c = a.center(0); a.emit({ type: 'damage', target: 0, amount: 6, absorbed: 24, x: c.x, y: c.y, weapon: 'ember', direct: true, hpAfter: 94, by: 1 }); });
      a.at(2.1, () => { const c = a.center(0); t0.shield = 0; a.emit({ type: 'shieldBreak', target: 0, x: c.x, y: c.y }); });
      a.at(2.4, () => { const m = a.muzzle(1); a.emit({ type: 'lockOn', x: m.x - 300, y: m.y - 200, target: 0 }); });
      for (let i = 0; i < 3; i++) {
        const x = W * 0.3 + i * 110;
        a.at(2.6 + i * 0.25, () => a.emit({ type: 'bounce', weapon: i === 2 ? 'ricochet' : 'skipper', x, y: a.ground(x), speed: 520 }));
      }
      a.at(3.4, () => { const x = W * 0.66; a.emit({ type: 'drill', phase: 'start', x, y: a.ground(x) }); });
      a.at(3.9, () => { const x = W * 0.7; a.emit({ type: 'drill', phase: 'end', x, y: a.ground(x) }); });
      a.at(4.2, () => {
        const fromX = t0.x, fromY = t0.y, toX = t0.x + 140;
        a.emit({ type: 'teleport', player: 0, fromX, fromY, toX, toY: a.ground(toX) });
        t0.x = toX;
      });
      a.at(4.6, () => a.emit({ type: 'fizzle', weapon: 'blink', x: W * 0.5, y: a.ground(W * 0.5) - 5 }));
      a.at(4.8, () => { const x = W * 0.48; a.emit({ type: 'crate', phase: 'land', id: 1, x, y: a.ground(x), weapon: 'tesla', amount: 1, by: null }); });
      a.at(5.2, () => { const x = W * 0.48; a.emit({ type: 'crate', phase: 'collect', id: 1, x, y: a.ground(x), weapon: 'thunderhead', amount: 1, by: 0 }); });
      a.at(5.4, () => a.emit({ type: 'dirtFall', x0: W * 0.4, x1: W * 0.47, amount: 300 }));
    },
  },
  damage: {
    length: 2.4,
    run(a) {
      a.at(0.1, () => { const c = a.center(1); a.emit({ type: 'damage', target: 1, amount: 50, absorbed: 0, x: c.x, y: c.y, weapon: 'thunderhead', direct: true, hpAfter: 35, by: 0 }); });
      a.at(0.4, () => { const c = a.center(0); a.emit({ type: 'damage', target: 0, amount: 12, absorbed: 0, x: c.x, y: c.y, weapon: 'starfall', direct: false, hpAfter: 70, by: 1 }); });
      a.at(0.55, () => { const c = a.center(0); a.emit({ type: 'damage', target: 0, amount: 8, absorbed: 0, x: c.x, y: c.y, weapon: 'fall', direct: false, hpAfter: 62, by: null }); });
    },
  },
  ambient: {
    length: 3,
    run(a) {
      a.at(0, () => {
        const [t0, t1] = a.state.tanks;
        t0.hp = 40; t0.moveDir = 1;
        t1.hp = 18;
        a.tick((dt) => { t0.x += 30 * dt; t0.treadPhase += 30 * dt; return true; });
      });
      a.at(2.9, () => { a.state.tanks[0].moveDir = 0; });
    },
  },
  destroy: {
    length: 4.2,
    run(a) {
      a.at(0.1, () => {
        const t = a.state.tanks[1];
        const c = a.center(1);
        a.emit({ type: 'damage', target: 1, amount: 18, absorbed: 0, x: c.x, y: c.y, weapon: 'ember', direct: true, hpAfter: 0, by: 0 });
        t.hp = 0; t.alive = false;
        a.emit({ type: 'tankDestroyed', target: 1, x: t.x, y: t.y - 12, by: 0 });
      });
    },
  },
};

void WEAPONS;
