/**
 * Lightweight confetti / ash for the match-over screen. Fixed-size typed-array pool,
 * no allocation per frame; driven by Menus.update(dt).
 */
const MAX = 260;

export type ConfettiMode = 'celebrate' | 'ash';

export class Confetti {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly rot = new Float32Array(MAX);
  private readonly vr = new Float32Array(MAX);
  private readonly flip = new Float32Array(MAX);
  private readonly vf = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly col = new Uint8Array(MAX);
  private colors: string[] = ['#ffc457'];
  private mode: ConfettiMode = 'celebrate';
  private count = 0;
  private rain = 0;
  private w = 0;
  private hgt = 0;
  private dpr = 1;
  private active = false;
  /** Piece size relative to a 1080p screen, so phones get proportionate confetti. */
  private scale = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mn-confetti';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.hgt = Math.max(1, r.height);
    this.scale = Math.min(1.2, Math.max(0.55, this.hgt / 1000));
    const cw = Math.round(this.w * this.dpr);
    const ch = Math.round(this.hgt * this.dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
  }

  /** Starts an effect; must be called once the canvas is laid out. */
  start(mode: ConfettiMode, colors: string[]): void {
    this.resize();
    this.mode = mode;
    this.colors = colors;
    this.count = 0;
    this.active = true;
    if (mode === 'celebrate') {
      // Two cannons from the lower corners, then a gentle rain for a few seconds.
      for (let i = 0; i < 130; i++) this.spawn(i % 2 === 0 ? 0 : 1);
      this.rain = 4.5;
    } else {
      this.rain = 1e9;
    }
  }

  stop(): void {
    this.active = false;
    this.count = 0;
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** side: 0 = left cannon, 1 = right cannon, 2 = rain from the top. */
  private spawn(side: 0 | 1 | 2): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    const w = this.w;
    const hh = this.hgt;
    if (side === 2) {
      this.x[i] = Math.random() * w;
      this.y[i] = -20;
      this.vx[i] = (Math.random() - 0.5) * 40;
      this.vy[i] = this.mode === 'ash' ? 20 + Math.random() * 30 : 60 + Math.random() * 80;
    } else {
      const a = (side === 0 ? -62 : -118) * (Math.PI / 180) + (Math.random() - 0.5) * 0.6;
      const sp = (0.8 + Math.random() * 0.6) * hh * 2.1;
      this.x[i] = side === 0 ? -10 : w + 10;
      this.y[i] = hh * 0.95;
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
    }
    this.rot[i] = Math.random() * Math.PI * 2;
    this.vr[i] = (Math.random() - 0.5) * 10;
    this.flip[i] = Math.random() * Math.PI * 2;
    this.vf[i] = 4 + Math.random() * 8;
    this.size[i] = (this.mode === 'ash' ? 1.5 + Math.random() * 2.5 : 8 + Math.random() * 8) * this.scale;
    this.life[i] = this.mode === 'ash' ? 6 + Math.random() * 6 : 5 + Math.random() * 3;
    this.col[i] = (Math.random() * this.colors.length) | 0;
  }

  update(dt: number): void {
    if (!this.active || !this.ctx) return;
    if (dt > 0.05) dt = 0.05;
    const hh = this.hgt;
    if (this.rain > 0) {
      this.rain -= dt;
      const rate = this.mode === 'ash' ? 14 : 34;
      let n = rate * dt + Math.random() * 0.999;
      while (n >= 1) { this.spawn(2); n -= 1; }
    }
    const ash = this.mode === 'ash';
    const g = ash ? 6 : hh * 0.9;
    for (let i = 0; i < this.count; i++) {
      // Drag pulls everything toward a flutter-y terminal velocity.
      const drag = ash ? 0.4 : 1.6;
      this.vx[i] -= this.vx[i] * drag * dt;
      this.vy[i] += (g - this.vy[i] * drag) * dt;
      this.x[i] += (this.vx[i] + Math.sin(this.flip[i] * 0.5) * (ash ? 12 : 30)) * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      this.flip[i] += this.vf[i] * dt;
      this.life[i] -= dt;
      if (this.life[i] <= 0 || this.y[i] > hh + 30) {
        // Swap-remove keeps the live set dense.
        const j = --this.count;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j]; this.flip[i] = this.flip[j]; this.vf[i] = this.vf[j];
        this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.col[i] = this.col[j];
        i--;
      }
    }
    this.draw();
    if (this.count === 0 && this.rain <= 0) this.active = false;
  }

  private draw(): void {
    const c = this.ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const d = this.dpr;
    const ash = this.mode === 'ash';
    for (let k = 0; k < this.colors.length; k++) {
      c.fillStyle = this.colors[k];
      for (let i = 0; i < this.count; i++) {
        if (this.col[i] !== k) continue;
        const s = this.size[i];
        const fade = this.life[i] < 1 ? this.life[i] : 1;
        c.globalAlpha = ash ? fade * 0.55 : fade;
        const cr = Math.cos(this.rot[i]);
        const sr = Math.sin(this.rot[i]);
        // Paper flip: squash one axis by cos(flip) so pieces twinkle as they tumble.
        const fl = Math.cos(this.flip[i]);
        c.setTransform(cr * d, sr * d, -sr * fl * d, cr * fl * d, this.x[i] * d, this.y[i] * d);
        if (ash) c.fillRect(-s * 0.5, -s * 0.5, s, s);
        else c.fillRect(-s * 0.5, -s * 0.3, s, s * 0.6);
      }
    }
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}
