/**
 * Test scene for the postfx sandbox: gradient sky, bright sun, glowing dots, dark terrain,
 * an orientation marker and colour-check swatches. Gradients and the glow sprite are cached.
 */

const TAU = Math.PI * 2;

export class TestScene {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private sky: CanvasGradient | null = null;
  private haze: CanvasGradient | null = null;
  private readonly glow: HTMLCanvasElement;
  private readonly sun: HTMLCanvasElement;

  private readonly p: typeof DUSK;

  constructor(w: number, h: number, night = false) {
    this.p = night ? NIGHT : DUSK;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.glow = makeGlow(64);
    this.sun = makeSun(256);
    this.resize(w, h);
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;
    this.sky = ctx.createLinearGradient(0, 0, 0, h * 0.78);
    this.sky.addColorStop(0, this.p.sky[0]);
    this.sky.addColorStop(0.45, this.p.sky[1]);
    this.sky.addColorStop(0.8, this.p.sky[2]);
    this.sky.addColorStop(1, this.p.sky[3]);
    this.haze = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.8);
    this.haze.addColorStop(0, this.p.haze[0]);
    this.haze.addColorStop(1, this.p.haze[1]);
  }

  draw(t: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const s = h / 900;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.sky!;
    ctx.fillRect(0, 0, w, h);

    // Sun: pre-rendered disc + corona.
    const sr = 230 * s * this.p.sun;
    ctx.drawImage(this.sun, w * 0.68 - sr, h * 0.5 - sr, sr * 2, sr * 2);

    // Far ridge (lighter, atmospheric) then haze.
    ctx.fillStyle = this.p.far;
    ridge(ctx, w, h, h * 0.62, 34 * s, 0.006 / s, 1.3, t * 0.0);
    ctx.fillStyle = this.haze!;
    ctx.fillRect(0, h * 0.5, w, h * 0.3);
    ctx.fillStyle = this.p.mid;
    ridge(ctx, w, h, h * 0.7, 46 * s, 0.0042 / s, 4.1, 0);

    // Foreground terrain: dark silhouette with a lit rim.
    ctx.fillStyle = this.p.near;
    ridge(ctx, w, h, h * 0.8, 60 * s, 0.0031 / s, 2.2, 0);
    ctx.strokeStyle = this.p.rim;
    ctx.lineWidth = 2.5 * s;
    ridge(ctx, w, h, h * 0.8, 60 * s, 0.0031 / s, 2.2, 0, true);

    // Glowing dots (embers / projectiles), additive sprites.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const ph = i * 2.399;
      const x = ((i * 0.137 + t * 0.018 * (1 + (i % 3))) % 1) * w;
      const y = h * (0.22 + 0.5 * ((Math.sin(ph) * 0.5 + 0.5) * 0.9)) + Math.sin(t * 1.3 + ph) * 18 * s;
      const r = (10 + (i % 4) * 7) * s;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.glow, x - r, y - r, r * 2, r * 2);
    }
    // A hot "explosion" core near the terrain.
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    const er = 70 * s * pulse;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.glow, w * 0.3 - er, h * 0.66 - er, er * 2, er * 2);
    ctx.drawImage(this.glow, w * 0.3 - er * 0.5, h * 0.66 - er * 0.5, er, er);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Orientation marker (must appear top-left, upright) and colour swatches (bottom).
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(34 * s)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('TOP ↑ LEFT', 24 * s, 54 * s);
    const sw = 56 * s, sy = h - sw - 18 * s;
    const sw8 = ['#ff0000', '#00ff00', '#0000ff', '#3fc1ff', '#ff7448', '#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'];
    for (let i = 0; i < sw8.length; i++) {
      ctx.fillStyle = sw8[i];
      ctx.fillRect(24 * s + i * (sw + 6 * s), sy, sw, sw);
    }
  }
}

function ridge(ctx: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number, freq: number, seed: number, shift: number, line = false): void {
  ctx.beginPath();
  if (!line) ctx.moveTo(0, h);
  for (let x = 0; x <= w + 8; x += 8) {
    const y = base - amp * (Math.sin((x + shift) * freq + seed) * 0.6 + Math.sin((x + shift) * freq * 2.7 + seed * 3) * 0.3 + Math.sin(x * freq * 7.1 + seed) * 0.1);
    ctx.lineTo(x, y);
  }
  if (line) {
    ctx.stroke();
    return;
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function makeGlow(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.18, 'rgba(255,200,110,0.95)');
  grad.addColorStop(0.45, 'rgba(255,120,50,0.35)');
  grad.addColorStop(1, 'rgba(255,80,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeSun(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const corona = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  corona.addColorStop(0, 'rgba(255,214,150,0.65)');
  corona.addColorStop(0.5, 'rgba(255,150,110,0.18)');
  corona.addColorStop(1, 'rgba(255,120,100,0)');
  g.fillStyle = corona;
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#fff4d6';
  g.beginPath();
  g.arc(r, r, r * 0.26, 0, TAU);
  g.fill();
  return c;
}

const DUSK = {
  sky: ['#141c46', '#6b3f86', '#e0738a', '#ffc184'],
  haze: ['rgba(255,190,150,0)', 'rgba(255,190,150,0.35)'],
  far: '#9b4f78', mid: '#4d2550', near: '#1a0f1e', rim: '#ffcf9a', sun: 1,
};
const NIGHT: typeof DUSK = {
  sky: ['#04050b', '#100c1c', '#2e1220', '#6a2416'],
  haze: ['rgba(255,90,40,0)', 'rgba(255,90,40,0.22)'],
  far: '#2a1218', mid: '#170a0e', near: '#090507', rim: '#ff8a4a', sun: 0.45,
};
