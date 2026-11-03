/**
 * Continuous sounds driven from GameState each frame: falling-shell whistles (2 voices), tank engine,
 * drill grind, wind bed, collapsing-dirt rumble and lava sizzle. Each loop builds its graph lazily when
 * it becomes audible and tears it down after a short silence, so idle loops cost nothing.
 * Parameter updates are thresholded (no AudioParam spam, no per-frame allocation).
 */
import { MAX_WIND } from '../core/constants.ts';
import { clamp, smoothstep } from '../core/math.ts';
import type { GameState } from '../core/types.ts';
import { panForX, type NoiseKind, type Synth } from './synth.ts';

/** A smoothed AudioParam target that only touches the param when the target moves noticeably. */
class Smooth {
  private last = Number.NaN;
  param: AudioParam | null = null;
  private readonly eps: number;
  private readonly tc: number;
  constructor(eps: number, tc: number) {
    this.eps = eps;
    this.tc = tc;
  }
  set(value: number, now: number, tc = this.tc): void {
    if (!this.param) return;
    if (Math.abs(value - this.last) <= this.eps * Math.max(1, Math.abs(this.last))) return;
    this.last = value;
    this.param.cancelScheduledValues(now);
    this.param.setTargetAtTime(value, now, tc);
  }
  bind(p: AudioParam | null, initial: number): void {
    this.param = p;
    this.last = initial;
    if (p) p.value = initial;
  }
}

type Builder = (l: Loop) => void;

class Loop {
  readonly synth: Synth;
  private readonly dest: AudioNode;
  private readonly builder: Builder;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  out: GainNode | null = null;
  readonly gain = new Smooth(0.02, 0.08);
  readonly pan = new Smooth(0.02, 0.1);
  /** Named modulation targets (frequencies etc.) bound by the builder. */
  readonly a = new Smooth(0.004, 0.06);
  readonly b = new Smooth(0.004, 0.06);
  readonly c = new Smooth(0.01, 0.06);
  private silentFor = 0;

  constructor(synth: Synth, dest: AudioNode, builder: Builder) {
    this.synth = synth;
    this.dest = dest;
    this.builder = builder;
  }

  get live(): boolean {
    return this.out !== null;
  }

  // ---- builder helpers ----
  node<T extends AudioNode>(n: T, to: AudioNode | AudioParam | null): T {
    this.nodes.push(n);
    if (to instanceof AudioNode) n.connect(to);
    else if (to) n.connect(to);
    return n;
  }
  g(value: number, to: AudioNode | AudioParam | null): GainNode {
    const n = this.node(this.synth.ctx.createGain(), to);
    n.gain.value = value;
    return n;
  }
  f(type: BiquadFilterType, freq: number, q: number, to: AudioNode): BiquadFilterNode {
    const n = this.node(this.synth.ctx.createBiquadFilter(), to);
    n.type = type;
    n.frequency.value = freq;
    n.Q.value = q;
    return n;
  }
  osc(type: OscillatorType, freq: number, to: AudioNode | AudioParam): OscillatorNode {
    const o = this.node(this.synth.ctx.createOscillator(), to);
    o.type = type;
    o.frequency.value = freq;
    o.start();
    this.sources.push(o);
    return o;
  }
  noise(kind: NoiseKind, to: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = this.node(this.synth.ctx.createBufferSource(), to);
    s.buffer = this.synth.buffer(kind);
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * 1.5);
    this.sources.push(s);
    return s;
  }

  private build(): void {
    const ctx = this.synth.ctx;
    const pan = ctx.createStereoPanner();
    pan.connect(this.dest);
    this.nodes.push(pan);
    this.out = this.g(0, pan);
    this.gain.bind(this.out.gain, 0);
    this.pan.bind(pan.pan, 0);
    this.builder(this);
  }

  private teardown(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* ignore */ }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.out = null;
    this.gain.bind(null, 0);
    this.pan.bind(null, 0);
    this.a.bind(null, 0);
    this.b.bind(null, 0);
    this.c.bind(null, 0);
  }

  /** Sets the loudness target; returns true when the graph is live and modulation should be updated. */
  level(target: number, dt: number, now: number, tc?: number): boolean {
    if (target > 0.001) {
      this.silentFor = 0;
      if (!this.out) this.build();
    } else if (this.out) {
      this.silentFor += dt;
      if (this.silentFor > 1.5) {
        this.teardown();
        return false;
      }
    }
    if (!this.out) return false;
    this.gain.set(target, now, tc);
    return true;
  }

  setX(x: number, now: number): void {
    this.pan.set(panForX(x), now);
  }

  kill(): void {
    if (this.out) this.teardown();
  }
}

// -------------------------------------------------------------------------------------------
// The loop set
// -------------------------------------------------------------------------------------------

export class Loops {
  private readonly synth: Synth;
  private readonly whistles: [Loop, Loop];
  private readonly whistleId = [-1, -1];
  private readonly engine: Loop;
  private readonly drill: Loop;
  private readonly wind: Loop;
  private readonly dirt: Loop;
  private readonly sizzle: Loop;
  private readonly all: readonly Loop[];
  /** Dirt rumble energy (fed by dirtFall events, decays). */
  private dirtEnergy = 0;
  private dirtX = 960;
  /** Drill flag from events (covers the gap before the sim switches projectile mode). */
  drillFlag = false;
  drillX = 960;
  private time = 0;

  constructor(synth: Synth) {
    this.synth = synth;
    const sfx = synth.sfxIn;
    const amb = synth.ambIn;

    const whistle = (l: Loop): void => {
      const out = l.out as GainNode;
      const o = l.osc('sine', 1800, out);
      const o2 = l.osc('sine', 3600, l.g(0.12, out));
      l.a.bind(o.frequency, 1800);
      l.b.bind(o2.frequency, 3600);
      // Gentle vibrato and an airy breath band tracking the tone.
      const vib = l.g(14, null);
      vib.connect(o.detune);
      vib.connect(o2.detune);
      l.osc('sine', 5.5 + Math.random(), vib);
      const bp = l.f('bandpass', 1800, 5, l.g(0.9, out));
      l.noise('white', bp);
      l.c.bind(bp.frequency, 1800);
    };
    this.whistles = [new Loop(synth, sfx, whistle), new Loop(synth, sfx, whistle)];

    this.engine = new Loop(synth, sfx, l => {
      const out = l.out as GainNode;
      const lp = l.f('lowpass', 320, 2, out);
      const o1 = l.osc('sawtooth', 42, lp);
      const o2 = l.osc('square', 63, l.g(0.4, lp));
      l.a.bind(o1.frequency, 42);
      l.b.bind(o2.frequency, 63);
      // Tread clatter: rubble grains gated by a square LFO at tread rate.
      const clatter = l.g(0.5, out);
      l.noise('rubble', l.f('bandpass', 900, 1.2, l.g(0.9, clatter)), 1.4);
      const lfo = l.osc('square', 11, l.g(0.45, clatter.gain));
      l.c.bind(lfo.frequency, 11);
      l.osc('sine', 7, l.g(4, o1.frequency));
    });

    this.drill = new Loop(synth, sfx, l => {
      const out = l.out as GainNode;
      const saw = l.osc('sawtooth', 92, l.f('bandpass', 900, 2, l.g(0.5, out)));
      l.a.bind(saw.frequency, 92);
      const grind = l.g(0.5, out);
      l.noise('white', l.f('bandpass', 2300, 3, grind));
      l.osc('square', 23, l.g(0.45, grind.gain));
      l.noise('rubble', l.f('lowpass', 700, 0.8, l.g(1.2, out)), 1.6);
      l.osc('sine', 3.2, l.g(9, saw.frequency));
    });

    this.wind = new Loop(synth, amb, l => {
      const out = l.out as GainNode;
      const bp = l.f('bandpass', 400, 0.7, out);
      l.noise('pink', bp);
      l.a.bind(bp.frequency, 400);
      const hiss = l.g(0, out);
      const bp2 = l.f('bandpass', 900, 9, hiss);
      l.noise('white', bp2);
      l.b.bind(bp2.frequency, 900);
      l.c.bind(hiss.gain, 0);
    });

    this.dirt = new Loop(synth, sfx, l => {
      const out = l.out as GainNode;
      l.noise('brown', l.f('lowpass', 240, 0.8, out));
      l.noise('rubble', l.f('bandpass', 650, 0.9, l.g(0.9, out)), 0.9);
    });

    this.sizzle = new Loop(synth, sfx, l => {
      const out = l.out as GainNode;
      l.noise('white', l.f('highpass', 4200, 0.6, l.g(0.35, out)));
      l.noise('crackle', l.f('highpass', 2400, 0.7, out), 0.8);
    });
    this.all = [this.whistles[0], this.whistles[1], this.engine, this.drill, this.wind, this.dirt, this.sizzle];
  }

  addDirt(x0: number, x1: number, amount: number): void {
    this.dirtEnergy = Math.min(1.2, this.dirtEnergy + clamp(amount / 900, 0.05, 0.6));
    this.dirtX = (x0 + x1) / 2;
  }

  private findProjectile(state: GameState | null, id: number): GameState['projectiles'][number] | null {
    if (!state || id < 0) return null;
    const ps = state.projectiles;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }

  update(dt: number, state: GameState | null, pitch: number): void {
    const now = this.synth.now;
    this.time += dt;
    const ps = state ? state.projectiles : null;

    // --- Whistles: the two fastest-descending projectiles (sticky assignment by id). ---
    let idA = -1, idB = -1, vA = 0, vB = 0;
    if (ps) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p.vy < 160 || p.mode === 'drill') continue;
        if (p.vy > vA) { idB = idA; vB = vA; idA = p.id; vA = p.vy; } else if (p.vy > vB) { idB = p.id; vB = p.vy; }
      }
    }
    // Keep a channel on the projectile it already follows to avoid pitch jumps.
    if (this.whistleId[0] === idB || this.whistleId[1] === idA) {
      this.whistleId[0] = idB; this.whistleId[1] = idA;
    } else {
      this.whistleId[0] = idA; this.whistleId[1] = idB;
    }
    for (let k = 0; k < 2; k++) {
      const p = this.findProjectile(state, this.whistleId[k]);
      const loop = this.whistles[k];
      const lvl = p ? smoothstep(160, 460, p.vy) * (p.fragment ? 0.05 : 0.09) : 0;
      if (loop.level(lvl, dt, now, lvl > 0 ? 0.06 : 0.04) && p) {
        // Classic falling-shell glide: high near the apex, lower as it speeds up.
        const f = clamp(2500 - p.vy * 1.45, 780, 2500) * pitch;
        loop.a.set(f, now);
        loop.b.set(f * 2.01, now);
        loop.c.set(f, now);
        loop.setX(p.x, now);
      }
    }

    // --- Engine: any tank driving. ---
    let driveX = -1;
    if (state) for (const t of state.tanks) if (t.alive && t.moveDir !== 0) driveX = t.x;
    if (this.engine.level(driveX >= 0 ? 0.32 : 0, dt, now, driveX >= 0 ? 0.06 : 0.12) && driveX >= 0) {
      this.engine.a.set(46 * pitch, now);
      this.engine.b.set(69 * pitch, now);
      this.engine.c.set(11 * pitch, now);
      this.engine.setX(driveX, now);
    }

    // --- Drill: a projectile in drill mode (or the event flag while a projectile exists). ---
    let drillX = -1;
    if (ps) for (const p of ps) if (p.mode === 'drill') drillX = p.x;
    if (drillX < 0 && this.drillFlag && ps && ps.length > 0) drillX = this.drillX;
    if (drillX < 0) this.drillFlag = false;
    if (this.drill.level(drillX >= 0 ? 0.5 : 0, dt, now, drillX >= 0 ? 0.03 : 0.08)) {
      this.drill.a.set((88 + Math.sin(this.time * 9) * 6) * pitch, now);
      if (drillX >= 0) this.drill.setX(drillX, now);
    }

    // --- Wind bed: level and brightness proportional to |wind|, with slow gusts. ---
    const w = state ? Math.abs(state.wind) / MAX_WIND : 0;
    const gust = 0.78 + 0.22 * Math.sin(this.time * 0.63) * Math.sin(this.time * 0.21 + 1.3);
    if (this.wind.level(w > 0.005 ? Math.pow(w, 1.15) * 0.2 * gust : 0, dt, now, 0.5)) {
      this.wind.a.set((260 + w * 700 * gust) * pitch, now);
      this.wind.b.set((700 + w * 900 * gust) * pitch, now);
      this.wind.c.set(w * w * 0.35 * gust, now);
      this.wind.pan.set(state ? Math.sign(state.wind) * 0.25 : 0, now);
    }

    // --- Collapsing dirt rumble. ---
    this.dirtEnergy = Math.max(0, this.dirtEnergy - dt * 1.6);
    if (this.dirt.level(this.dirtEnergy > 0.01 ? Math.min(1, this.dirtEnergy) * 0.45 : 0, dt, now, 0.07)) {
      this.dirt.setX(this.dirtX, now);
    }

    // --- Lava sizzle bed. ---
    let lava = 0, lx = 0;
    if (state) for (const h of state.hazards) if (h.kind === 'lava') { lava++; lx += h.x; }
    const flicker = 0.75 + Math.random() * 0.25;
    if (this.sizzle.level(lava > 0 ? Math.min(1, lava / 10) * 0.18 * flicker : 0, dt, now, 0.1) && lava > 0) {
      this.sizzle.setX(lx / lava, now);
    }
  }

  /** Silence everything immediately (round start / teardown). */
  reset(): void {
    for (const l of this.all) l.kill();
    this.dirtEnergy = 0;
    this.drillFlag = false;
  }

  /** Number of live loops (debug). */
  liveCount(): number {
    let n = 0;
    for (const l of this.all) if (l.live) n++;
    return n;
  }
}
