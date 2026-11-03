/** A busy animated stand-in for the live battle behind the menus (sandbox only). */
import { BIOMES, type BiomeId } from '../../src/core/biomes.ts';

export function startFakeScene(canvas: HTMLCanvasElement, biome: BiomeId): void {
  const ctx = canvas.getContext('2d')!;
  const p = BIOMES[biome].palette;
  let w = 0, hh = 0;
  const resize = (): void => {
    w = canvas.width = innerWidth;
    hh = canvas.height = innerHeight;
  };
  resize();
  addEventListener('resize', resize);
  const ground = (x: number): number => hh * (0.66 + 0.08 * Math.sin(x / w * 7.1) + 0.04 * Math.sin(x / w * 17 + 1));
  const frame = (t: number): void => {
    const s = t / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, p.sky[0]); g.addColorStop(0.5, p.sky[1]); g.addColorStop(0.75, p.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    // Sun / planet.
    ctx.fillStyle = p.celestialGlow + '55';
    ctx.beginPath(); ctx.arc(w * 0.78, hh * 0.24, hh * 0.13, 0, 7); ctx.fill();
    ctx.fillStyle = p.celestial;
    ctx.beginPath(); ctx.arc(w * 0.78, hh * 0.24, hh * 0.07, 0, 7); ctx.fill();
    // Parallax ridges.
    for (let L = 0; L < 3; L++) {
      ctx.fillStyle = p.far[L];
      ctx.beginPath(); ctx.moveTo(0, hh);
      for (let x = 0; x <= w; x += 20) ctx.lineTo(x, hh * (0.45 + L * 0.07) + Math.sin(x / (120 + L * 60) + L * 2 + s * 0.05 * (L + 1)) * hh * 0.05);
      ctx.lineTo(w, hh); ctx.fill();
    }
    // Terrain with strata.
    const tg = ctx.createLinearGradient(0, hh * 0.55, 0, hh);
    tg.addColorStop(0, p.surface); tg.addColorStop(0.08, p.strata[0]); tg.addColorStop(0.4, p.strata[2]); tg.addColorStop(1, p.bedrock);
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(0, hh);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, ground(x));
    ctx.lineTo(w, hh); ctx.fill();
    // Tanks.
    const tank = (x: number, c: string): void => {
      const y = ground(x);
      ctx.fillStyle = '#1b2230'; ctx.fillRect(x - 28, y - 10, 56, 10);
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - 26, y - 10); ctx.lineTo(x - 18, y - 24); ctx.lineTo(x + 18, y - 24); ctx.lineTo(x + 26, y - 10); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 24, 11, Math.PI, 0); ctx.fill();
    };
    tank(w * 0.22, '#3fc1ff');
    tank(w * 0.8, '#ff7448');
    // A looping shell with a glowing trail and a periodic explosion.
    const k = (s % 3.2) / 2.6;
    const x0 = w * 0.22, x1 = w * 0.8;
    if (k < 1) {
      for (let i = 0; i < 18; i++) {
        const kk = Math.max(0, k - i * 0.012);
        const x = x0 + (x1 - x0) * kk, y = ground(x0) - 40 - Math.sin(kk * Math.PI) * hh * 0.45;
        ctx.fillStyle = `rgba(255,200,120,${0.5 - i * 0.026})`;
        ctx.beginPath(); ctx.arc(x, y, 6 - i * 0.25, 0, 7); ctx.fill();
      }
    } else {
      const e = (k - 1) / 0.23;
      const r = 30 + e * 120;
      const eg = ctx.createRadialGradient(x1, ground(x1) - 20, 0, x1, ground(x1) - 20, r);
      eg.addColorStop(0, `rgba(255,250,220,${1 - e})`); eg.addColorStop(0.4, `rgba(255,140,40,${0.8 * (1 - e)})`); eg.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(x1, ground(x1) - 20, r, 0, 7); ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Simulated renderer thumbnail (the real one comes from Background.thumbnail). */
export function fakeThumbnail(biome: BiomeId, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const p = BIOMES[biome].palette;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.sky[0]); g.addColorStop(0.55, p.sky[1]); g.addColorStop(0.8, p.sky[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = p.celestialGlow + '66'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.3, h * 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = p.celestial; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.3, h * 0.1, 0, 7); ctx.fill();
  for (let L = 0; L < 3; L++) {
    ctx.fillStyle = p.far[L]; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, h * (0.5 + L * 0.08) + Math.sin(x / (30 + L * 14) + L) * h * 0.06);
    ctx.lineTo(w, h); ctx.fill();
  }
  ctx.fillStyle = p.surface; ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, h * 0.74 + Math.sin(x / 40) * h * 0.05);
  ctx.lineTo(w, h); ctx.fill();
  ctx.fillStyle = p.strata[1]; ctx.fillRect(0, h * 0.86, w, h);
  return c;
}
