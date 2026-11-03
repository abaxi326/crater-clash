/**
 * One-shot sound recipes. Every recipe builds a small Voice graph from oscillators, noise buffers,
 * filters and envelopes, with per-instance random variation in pitch and timing so repeats never
 * sound identical. Data tables drive the weapon/explosion families.
 */
import { clamp } from '../core/math.ts';
import type { ExplosionKind, SoundProfile, WeaponId } from '../core/weapons.ts';
import type { UiSound } from '../contracts.ts';
import { ahr, midiHz, perc, semi, sweep, vary, type NoiseKind, type Synth, type Voice } from './synth.ts';

// -------------------------------------------------------------------------------------------
// Building blocks
// -------------------------------------------------------------------------------------------

/** Simple enveloped oscillator, optionally through a lowpass. */
function tone(v: Voice, type: OscillatorType, f: number, t: number, gain: number, attack: number, decay: number, lp = 0): OscillatorNode {
  const g = v.gain(0);
  const dest = lp > 0 ? v.filter('lowpass', lp, 0.7, g) : g;
  perc(g.gain, t, gain, attack, decay);
  return v.osc(type, f * v.p, t, attack + decay + 0.02, dest);
}

/** FM bell: sine carrier modulated by an inharmonic sine whose index decays (glassy, warm). */
function bell(v: Voice, f: number, t: number, gain: number, decay: number, ratio = 1.4, index = 1.6): void {
  f *= v.p;
  const g = v.gain(0);
  perc(g.gain, t, gain, 0.004, decay);
  const car = v.osc('sine', f, t, decay + 0.03, g);
  const mg = v.gain(0, null);
  mg.connect(car.frequency);
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.02, t + decay * 0.7);
  v.osc('sine', f * ratio, t, decay + 0.03, mg);
}

/** Enveloped noise through a filter with an exponential cutoff sweep. */
function noiseBurst(
  v: Voice, kind: NoiseKind, t: number, gain: number, attack: number, decay: number,
  type: BiquadFilterType, fFrom: number, fTo: number, q = 0.8, rate = 1,
): BiquadFilterNode {
  const g = v.gain(0);
  perc(g.gain, t, gain, attack, decay);
  const f = v.filter(type, fFrom, q, g);
  sweep(f.frequency, t, fFrom * v.p, fTo * v.p, attack + decay);
  v.noise(kind, t, attack + decay + 0.02, f, rate * v.p);
  return f;
}

/** Sine with an exponential pitch drop: kicks, thuds and sub-bass. */
function drop(v: Voice, t: number, gain: number, from: number, to: number, dur: number, attack = 0.003, type: OscillatorType = 'sine'): void {
  const g = v.gain(0);
  perc(g.gain, t, gain, attack, dur);
  const o = v.osc(type, from * v.p, t, attack + dur + 0.02, g);
  sweep(o.frequency, t, from * v.p, to * v.p, attack + dur * 0.8);
}

/** Inharmonic metallic partials (ting, clank). */
const METAL = [1, 2.76, 5.4, 8.93] as const;
function metal(v: Voice, f: number, t: number, gain: number, decay: number): void {
  for (let i = 0; i < METAL.length; i++) {
    tone(v, 'sine', f * METAL[i] * vary(1, 0.01), t, gain / (1 + i * 0.8), 0.001, decay / (1 + i * 0.6));
  }
}

// -------------------------------------------------------------------------------------------
// Explosion table
// -------------------------------------------------------------------------------------------

interface BoomSpec {
  /** Transient click level. */
  click: number;
  /** Main noise burst: level, duration (s at size 1), noise colour, lowpass sweep. */
  body: number; bodyDur: number; noise: NoiseKind; lpFrom: number; lpTo: number;
  /** Sub-bass sine drop. */
  sub: number; subFrom: number; subTo: number; subDur: number;
  /** Crackle tail (sparse impulses through a highpass). */
  crackle: number; crackleDur: number;
  /** Low brown-noise rumble tail. */
  rumble: number; rumbleDur: number;
  send: number;
}

const BOOMS: Record<Exclude<ExplosionKind, 'none'>, BoomSpec> = {
  standard: { click: 0.5, body: 0.9, bodyDur: 0.55, noise: 'pink', lpFrom: 5200, lpTo: 260, sub: 0.9, subFrom: 120, subTo: 38, subDur: 0.5, crackle: 0.25, crackleDur: 0.7, rumble: 0.35, rumbleDur: 0.9, send: 0.28 },
  heavy:    { click: 0.6, body: 1.0, bodyDur: 0.9, noise: 'brown', lpFrom: 4200, lpTo: 140, sub: 1.1, subFrom: 95, subTo: 26, subDur: 1.1, crackle: 0.3, crackleDur: 1.3, rumble: 0.7, rumbleDur: 2.2, send: 0.36 },
  small:    { click: 0.35, body: 0.55, bodyDur: 0.28, noise: 'pink', lpFrom: 6500, lpTo: 500, sub: 0.45, subFrom: 170, subTo: 60, subDur: 0.25, crackle: 0.12, crackleDur: 0.35, rumble: 0, rumbleDur: 0, send: 0.2 },
  electric: { click: 0.7, body: 0.5, bodyDur: 0.35, noise: 'white', lpFrom: 9000, lpTo: 900, sub: 0.6, subFrom: 140, subTo: 50, subDur: 0.35, crackle: 0.35, crackleDur: 0.6, rumble: 0, rumbleDur: 0, send: 0.35 },
  fire:     { click: 0.4, body: 0.85, bodyDur: 0.7, noise: 'pink', lpFrom: 3800, lpTo: 300, sub: 0.75, subFrom: 110, subTo: 40, subDur: 0.5, crackle: 0.45, crackleDur: 1.4, rumble: 0.3, rumbleDur: 0.9, send: 0.3 },
  void:     { click: 0.2, body: 0.6, bodyDur: 0.8, noise: 'brown', lpFrom: 2400, lpTo: 90, sub: 1.2, subFrom: 70, subTo: 22, subDur: 1.2, crackle: 0, crackleDur: 0, rumble: 0.6, rumbleDur: 1.6, send: 0.5 },
  beam:     { click: 0.3, body: 0.7, bodyDur: 0.6, noise: 'white', lpFrom: 7000, lpTo: 600, sub: 0.7, subFrom: 90, subTo: 35, subDur: 0.6, crackle: 0.3, crackleDur: 0.8, rumble: 0.4, rumbleDur: 1.2, send: 0.4 },
  dirt:     { click: 0.25, body: 0.6, bodyDur: 0.5, noise: 'brown', lpFrom: 1600, lpTo: 180, sub: 0.8, subFrom: 90, subTo: 35, subDur: 0.4, crackle: 0, crackleDur: 0, rumble: 0.5, rumbleDur: 1.0, send: 0.18 },
  firework: { click: 0.55, body: 0.5, bodyDur: 0.4, noise: 'pink', lpFrom: 8000, lpTo: 700, sub: 0.4, subFrom: 150, subTo: 60, subDur: 0.3, crackle: 0.5, crackleDur: 1.6, rumble: 0, rumbleDur: 0, send: 0.45 },
};

// -------------------------------------------------------------------------------------------
// Fire table: per sound profile, a base recipe; weapons add optional character layers.
// -------------------------------------------------------------------------------------------

type FireLayer = (v: Voice, t: number, k: number) => void;

const FIRE: Record<SoundProfile, FireLayer> = {
  thump: (v, t, k) => {
    drop(v, t, 0.9 * k, 150, 48, 0.28);
    noiseBurst(v, 'brown', t, 0.7 * k, 0.004, 0.25, 'lowpass', 1400, 200);
    noiseBurst(v, 'rubble', t + 0.02, 0.4 * k, 0.01, 0.35, 'bandpass', 900, 300, 1.2);
  },
  boom: (v, t, k) => {
    noiseBurst(v, 'white', t, 0.45 * k, 0.001, 0.035, 'highpass', 2500, 1500);
    noiseBurst(v, 'pink', t, 0.85 * k, 0.003, 0.42, 'lowpass', 4200, 240, 0.9);
    drop(v, t, 0.8 * k, 165, 46, 0.3);
    noiseBurst(v, 'brown', t + 0.05, 0.35 * k, 0.04, 0.6, 'lowpass', 700, 120);
  },
  heavy: (v, t, k) => {
    noiseBurst(v, 'white', t, 0.5 * k, 0.001, 0.05, 'highpass', 2000, 1200);
    noiseBurst(v, 'brown', t, 1.0 * k, 0.004, 0.75, 'lowpass', 3000, 120, 1.1);
    drop(v, t, 1.0 * k, 120, 30, 0.6);
    metal(v, vary(96, 0.05), t + 0.01, 0.12 * k, 0.9);
    noiseBurst(v, 'pink', t + 0.08, 0.3 * k, 0.1, 1.0, 'lowpass', 900, 100);
  },
  pop: (v, t, k) => {
    drop(v, t, 0.7 * k, vary(620, 0.08), 140, 0.14);
    noiseBurst(v, 'pink', t, 0.5 * k, 0.002, 0.18, 'bandpass', 2600, 700, 1.1);
    noiseBurst(v, 'brown', t + 0.02, 0.25 * k, 0.01, 0.3, 'lowpass', 800, 150);
  },
  zap: (v, t, k) => {
    const g = v.gain(0);
    perc(g.gain, t, 0.35 * k, 0.003, 0.32);
    const bp = v.filter('bandpass', 1800, 3, g);
    const o = v.osc('sawtooth', 1600 * v.p, t, 0.36, bp);
    sweep(o.frequency, t, 1900 * v.p, 140 * v.p, 0.3);
    sweep(bp.frequency, t, 4200 * v.p, 600 * v.p, 0.3);
    v.lfo(vary(55, 0.2), 300, o.frequency, t, 0.36, 'square');
    drop(v, t, 0.5 * k, 220, 60, 0.2);
    noiseBurst(v, 'crackle', t, 0.5 * k, 0.002, 0.3, 'highpass', 3000, 2000);
  },
  whoosh: (v, t, k) => {
    noiseBurst(v, 'pink', t, 0.7 * k, 0.06, 0.55, 'bandpass', 600, 3600, 2.2);
    drop(v, t, 0.6 * k, 90, 40, 0.5, 0.02);
    tone(v, 'sine', 220, t, 0.18 * k, 0.05, 0.5);
  },
  chime: (v, t, k) => {
    drop(v, t, 0.45 * k, 420, 120, 0.12);
    noiseBurst(v, 'pink', t, 0.3 * k, 0.002, 0.15, 'bandpass', 2400, 900, 1);
    bell(v, vary(1318, 0.02), t + 0.03, 0.18 * k, 0.9, 2.0, 1.2);
    bell(v, vary(1976, 0.02), t + 0.09, 0.11 * k, 0.8, 2.0, 1.0);
  },
  drill: (v, t, k) => {
    FIRE.boom(v, t, k * 0.75);
    const g = v.gain(0);
    ahr(g.gain, t + 0.05, 0.2 * k, 0.15, 0.2, 0.3);
    const o = v.osc('sawtooth', 70 * v.p, t + 0.05, 0.7, v.filter('lowpass', 1400, 2, g));
    sweep(o.frequency, t + 0.05, 70 * v.p, 260 * v.p, 0.5);
  },
};

/** Extra character per weapon, layered over the profile recipe. */
const FIRE_EXTRA: Partial<Record<WeaponId, FireLayer>> = {
  seeker: (v, t, k) => noiseBurst(v, 'white', t + 0.02, 0.32 * k, 0.05, 0.75, 'bandpass', 1500, 4500, 1.5),
  magma: (v, t, k) => {
    const o = tone(v, 'sine', 260, t + 0.04, 0.22 * k, 0.01, 0.3);
    v.lfo(32, 90, o.frequency, t + 0.04, 0.32);
    sweep(o.frequency, t + 0.04, 260 * v.p, 120 * v.p, 0.3);
  },
  trident: (v, t, k) => { for (let i = 0; i < 3; i++) bell(v, midiHz(86 + i * 4), t + 0.03 + i * 0.03, 0.05 * k, 0.4, 3.5, 0.8); },
  starfall: (v, t, k) => { for (let i = 0; i < 4; i++) bell(v, midiHz(88 + i * 3) * vary(1, 0.01), t + 0.04 + i * 0.045, 0.045 * k, 0.5, 2.0, 0.6); },
  fireworks: (v, t, k) => noiseBurst(v, 'crackle', t + 0.05, 0.4 * k, 0.1, 0.6, 'highpass', 3000, 5000, 0.7),
  tesla: (v, t, k) => noiseBurst(v, 'crackle', t, 0.45 * k, 0.01, 0.5, 'bandpass', 4000, 2500, 1.4),
  singularity: (v, t, k) => drop(v, t, 0.7 * k, 60, 28, 0.9, 0.05),
  blink: (v, t, k) => { for (let i = 0; i < 5; i++) tone(v, 'sine', midiHz(84 + i * 2), t + i * 0.035, 0.05 * k, 0.005, 0.25); },
  skipper: (v, t, k) => tone(v, 'triangle', vary(880, 0.04), t, 0.12 * k, 0.002, 0.1),
  ricochet: (v, t, k) => metal(v, vary(1400, 0.04), t + 0.01, 0.06 * k, 0.4),
  earthmaker: (v, t, k) => noiseBurst(v, 'brown', t + 0.05, 0.35 * k, 0.05, 0.4, 'lowpass', 500, 160),
  thunderhead: (v, t, k) => noiseBurst(v, 'brown', t + 0.15, 0.4 * k, 0.2, 1.4, 'lowpass', 400, 60),
};

// -------------------------------------------------------------------------------------------
// Sfx: the public recipe set used by AudioEngine
// -------------------------------------------------------------------------------------------

export class Sfx {
  private readonly s: Synth;
  /** Recent explosion start times, for stacking compensation. */
  private boomTimes = new Float64Array(16).fill(-10);
  private boomHead = 0;

  constructor(synth: Synth) {
    this.s = synth;
  }

  /** Gain compensation when several blasts land within ~180 ms (starlets, fragments, eruptions). */
  private stackGain(): number {
    const now = this.s.now;
    let n = 0;
    for (let i = 0; i < this.boomTimes.length; i++) if (now - this.boomTimes[i] < 0.18) n++;
    this.boomTimes[this.boomHead] = now;
    this.boomHead = (this.boomHead + 1) % this.boomTimes.length;
    return 1 / Math.sqrt(1 + n * 0.7);
  }

  // ---- weapons ------------------------------------------------------------------------

  fire(profile: SoundProfile, weapon: WeaponId, x: number, power: number): void {
    const k = 0.55 + 0.45 * clamp(power / 100, 0, 1);
    const v = this.s.voice({ group: 'boom', x, gain: vary(0.8, 0.06), send: 0.22 });
    const t = v.t + Math.random() * 0.006;
    FIRE[profile](v, t, k);
    FIRE_EXTRA[weapon]?.(v, t, k);
  }

  explosion(kind: ExplosionKind, x: number, radius: number, primary: boolean): void {
    if (kind === 'none') return;
    const spec = BOOMS[kind];
    const size = clamp(radius / 42, 0.4, 2.4);
    const small = !primary || kind === 'small';
    const lvl = (primary ? 1.45 : 0.75) * this.stackGain() * clamp(0.6 + size * 0.4, 0.6, 1.4) * (kind === 'firework' ? 1.4 : 1);
    const v = this.s.voice({ group: small ? 'small' : 'boom', x, gain: lvl * vary(0.85, 0.08), send: spec.send });
    const t = v.t + Math.random() * 0.01;
    const st = Math.sqrt(size) * v.s;              // time scaling
    const pf = Math.pow(size, -0.3) * vary(1, 0.07); // pitch scaling: bigger = deeper
    const lf = Math.pow(size, -0.4) * vary(1, 0.1);

    if (spec.click > 0) noiseBurst(v, 'white', t, spec.click, 0.0008, 0.03, 'highpass', 1800, 900);
    const bf = noiseBurst(v, spec.noise, t, spec.body, 0.004, spec.bodyDur * st, 'lowpass', spec.lpFrom * lf, spec.lpTo * lf, 1.0);
    bf.Q.value = 1.4; // slight resonance gives the sweep its "whump"
    drop(v, t, spec.sub, spec.subFrom * pf, spec.subTo * pf, spec.subDur * st, 0.004);
    if (spec.crackle > 0) noiseBurst(v, 'crackle', t + 0.06 * st, spec.crackle, 0.08 * st, spec.crackleDur * st, 'highpass', 2200, 1200, 0.7, vary(1, 0.2));
    if (spec.rumble > 0) noiseBurst(v, 'brown', t + 0.03, spec.rumble, 0.12 * st, spec.rumbleDur * st, 'lowpass', 420 * lf, 70, 0.7);

    switch (kind) {
      case 'heavy':
        // Second stage: a delayed, deeper body hit + debris.
        drop(v, t + 0.11 * st, 0.8, 70 * pf, 24, 0.9 * st, 0.01);
        noiseBurst(v, 'rubble', t + 0.15 * st, 0.6, 0.05, 1.4 * st, 'lowpass', 1600, 300, 0.8, 0.7);
        break;
      case 'electric':
        for (let i = 0; i < 4; i++) this.zapLayer(v, t + i * vary(0.05, 0.4), 0.22 / (1 + i * 0.4));
        break;
      case 'void':
        // Inward suck rising into a deep implosion.
        noiseBurst(v, 'pink', t, 0.45, 0.22 * v.s, 0.03, 'bandpass', 200, 3500, 2.5);
        drop(v, t + 0.2 * v.s, 1.0, 55 * pf, 18, 1.4 * st, 0.02);
        tone(v, 'sine', 110 * pf, t + 0.2, 0.25, 0.01, 1.4 * st);
        break;
      case 'beam':
        noiseBurst(v, 'white', t, 0.4, 0.01, 0.8 * st, 'bandpass', 3000, 1200, 2);
        break;
      case 'firework':
        for (let i = 0; i < 6; i++) {
          noiseBurst(v, 'white', t + 0.25 + Math.random() * 0.9, 0.18, 0.001, 0.05, 'highpass', 4000, 3000);
        }
        bell(v, midiHz(84 + ((Math.random() * 12) | 0)), t + 0.05, 0.06, 0.6, 2.0, 0.8);
        break;
      case 'dirt':
        noiseBurst(v, 'rubble', t + 0.05, 0.8, 0.05, 1.1, 'lowpass', 1200, 200, 0.8, 0.8);
        break;
      default:
        noiseBurst(v, 'rubble', t + 0.08 * st, 0.35 * size, 0.05, 0.6 * st, 'lowpass', 1800, 300, 0.7);
    }
  }

  private zapLayer(v: Voice, t: number, gain: number): void {
    const g = v.gain(0);
    perc(g.gain, t, gain, 0.002, vary(0.09, 0.3));
    const o = v.osc('sawtooth', vary(900, 0.4) * v.p, t, 0.14, v.filter('bandpass', vary(2400, 0.3), 2.5, g));
    sweep(o.frequency, t, vary(1400, 0.3) * v.p, vary(300, 0.3) * v.p, 0.1);
  }

  split(x: number, count: number): void {
    const v = this.s.voice({ group: 'small', x, gain: 0.7, send: 0.35 });
    const t = v.t;
    drop(v, t, 0.5, 700, 180, 0.12);
    noiseBurst(v, 'pink', t, 0.4, 0.002, 0.15, 'bandpass', 3500, 1200, 1.2);
    const n = Math.min(count, 6);
    for (let i = 0; i < n; i++) bell(v, midiHz(81 + i * 3 + ((Math.random() * 2) | 0)), t + 0.02 + i * 0.03, 0.06, 0.45, 2.0, 0.9);
  }

  bounce(weapon: WeaponId, x: number, speed: number): void {
    const k = clamp(speed / 500, 0.3, 1);
    const v = this.s.voice({ group: 'metal', x, gain: 0.75 * k, send: 0.3 });
    const t = v.t;
    if (weapon === 'ricochet') {
      metal(v, vary(1250, 0.12), t, 0.28, 0.6);
      noiseBurst(v, 'white', t, 0.3, 0.001, 0.025, 'highpass', 5000, 4000);
      const o = tone(v, 'sine', 2600, t, 0.08, 0.001, 0.25);
      sweep(o.frequency, t, 2600 * v.p, 3400 * v.p, 0.2); // the "pyew"
    } else {
      drop(v, t, 0.6, vary(260, 0.1), 90, 0.12);
      noiseBurst(v, 'pink', t, 0.35, 0.002, 0.12, 'bandpass', 1400, 500, 1);
      tone(v, 'triangle', vary(990, 0.05), t, 0.08, 0.001, 0.12);
    }
  }

  lockOn(x: number): void {
    const v = this.s.voice({ group: 'chime', x, gain: 1.0, send: 0.12 });
    for (let i = 0; i < 3; i++) {
      const t = v.t + i * 0.085;
      tone(v, 'square', i < 2 ? 1568 : 2093, t, 0.12, 0.002, i < 2 ? 0.05 : 0.14, 4000);
    }
  }

  lightning(x: number, strike: boolean): void {
    const v = this.s.voice({ group: 'zap', x, gain: strike ? 0.85 : 0.45, send: 0.35 });
    const t = v.t;
    noiseBurst(v, 'white', t, 0.8, 0.0005, 0.06, 'highpass', 3000, 1200, 0.6);
    for (let i = 0; i < 3; i++) this.zapLayer(v, t + i * 0.025, 0.3);
    noiseBurst(v, 'crackle', t, 0.5, 0.003, 0.3, 'bandpass', 5000, 2000, 1);
    if (strike) noiseBurst(v, 'brown', t + 0.03, 0.6, 0.02, 0.7, 'lowpass', 600, 80);
  }

  // ---- world ------------------------------------------------------------------------

  /** Landing thud; intro drops get a heavier suspension clank. */
  landed(x: number, fall: number, intro: boolean): void {
    const k = clamp(fall / 220, 0.25, 1) * (intro ? 1 : 0.85);
    const v = this.s.voice({ group: 'sfx', x, gain: 0.85 * k, send: 0.15 });
    const t = v.t;
    drop(v, t, 0.9, vary(110, 0.08), 38, 0.3);
    noiseBurst(v, 'brown', t, 0.7, 0.003, 0.3, 'lowpass', 900, 120);
    noiseBurst(v, 'rubble', t + 0.02, 0.5, 0.01, 0.5, 'lowpass', 1500, 300, 0.8);
    metal(v, vary(180, 0.06), t + 0.01, 0.07, 0.35);
    // Spring rattle: two quick soft clicks.
    for (let i = 1; i <= 2; i++) noiseBurst(v, 'pink', t + 0.07 * i + Math.random() * 0.02, 0.18 / i, 0.001, 0.04, 'bandpass', 2400, 1800, 2);
  }

  damage(x: number, amount: number, fall: boolean): void {
    const k = clamp(0.4 + amount / 40, 0.4, 1.2);
    const v = this.s.voice({ group: 'metal', x, gain: 0.7 * k, send: 0.2 });
    const t = v.t + 0.01;
    // Armour clank: inharmonic plate ring + body thunk.
    metal(v, vary(fall ? 150 : 210, 0.1), t, 0.22, fall ? 0.3 : 0.55);
    drop(v, t, 0.5, vary(180, 0.1), 70, 0.15);
    noiseBurst(v, 'white', t, 0.35, 0.001, 0.05, 'bandpass', 3200, 1500, 1.5);
    if (amount >= 25) noiseBurst(v, 'rubble', t + 0.04, 0.3, 0.01, 0.4, 'highpass', 1500, 800, 0.8, 1.5);
  }

  shieldHit(x: number, amount: number): void {
    const v = this.s.voice({ group: 'metal', x, gain: clamp(0.4 + amount / 50, 0.4, 0.9), send: 0.4 });
    const t = v.t;
    const o = tone(v, 'sine', vary(520, 0.05), t, 0.3, 0.003, 0.5);
    v.lfo(vary(11, 0.2), 30, o.frequency, t, 0.52); // the bubble wobbles
    bell(v, vary(1560, 0.04), t, 0.12, 0.6, 1.41, 2.2);
    noiseBurst(v, 'pink', t, 0.25, 0.002, 0.2, 'bandpass', 2600, 4800, 3);
  }

  shieldUp(x: number): void {
    const v = this.s.voice({ group: 'chime', x, gain: 0.6, send: 0.45 });
    const t = v.t;
    const g = v.gain(0);
    ahr(g.gain, t, 0.22, 0.25, 0.15, 0.6);
    const o1 = v.osc('sine', 220 * v.p, t, 1.05, g);
    const o2 = v.osc('triangle', 331 * v.p, t, 1.05, v.filter('lowpass', 1800, 1, g));
    sweep(o1.frequency, t, 220 * v.p, 440 * v.p, 0.4);
    sweep(o2.frequency, t, 331 * v.p, 662 * v.p, 0.4);
    for (let i = 0; i < 5; i++) bell(v, midiHz(76 + [0, 4, 7, 11, 14][i]), t + 0.12 + i * 0.05, 0.05, 0.6, 2.0, 0.6);
  }

  shieldBreak(x: number): void {
    const v = this.s.voice({ group: 'metal', x, gain: 0.8, send: 0.45 });
    const t = v.t;
    noiseBurst(v, 'white', t, 0.6, 0.001, 0.25, 'highpass', 6000, 2500, 0.8);
    for (let i = 0; i < 9; i++) {
      tone(v, 'sine', vary(2400, 0.45), t + Math.random() * 0.22, 0.07, 0.001, vary(0.18, 0.4));
    }
    const o = tone(v, 'sawtooth', 700, t, 0.15, 0.003, 0.5, 2200);
    sweep(o.frequency, t, 700 * v.p, 90 * v.p, 0.5);
    drop(v, t, 0.4, 160, 50, 0.3);
  }

  heal(x: number): void {
    const v = this.s.voice({ group: 'chime', x, gain: 1.0, send: 0.5 });
    const notes = [72, 76, 79, 84, 88];
    for (let i = 0; i < notes.length; i++) bell(v, midiHz(notes[i]) * vary(1, 0.004), v.t + i * 0.07, 0.12, 0.9, 2.0, 0.7);
    const g = v.gain(0);
    ahr(g.gain, v.t, 0.06, 0.2, 0.2, 0.6);
    v.osc('triangle', midiHz(60) * v.p, v.t, 1.05, v.filter('lowpass', 1200, 0.7, g));
  }

  utility(x: number): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 1.1, send: 0.2 });
    const t = v.t;
    const o = tone(v, 'square', 300, t, 0.08, 0.005, 0.22, 1800);
    sweep(o.frequency, t, 300 * v.p, 900 * v.p, 0.2);
    noiseBurst(v, 'pink', t, 0.15, 0.04, 0.25, 'bandpass', 1500, 5000, 2);
  }

  teleport(x: number, arrive: boolean): void {
    const v = this.s.voice({ group: 'chime', x, gain: 0.6, send: 0.5, delay: arrive ? 0.12 : 0 });
    const t = v.t;
    const g = v.gain(0);
    ahr(g.gain, t, 0.15, 0.03, 0.15, 0.3);
    const o = v.osc('sine', 300 * v.p, t, 0.5, g);
    const [a, b] = arrive ? [1800, 500] : [400, 2400];
    sweep(o.frequency, t, a * v.p, b * v.p, 0.35);
    v.lfo(18, 120, o.frequency, t, 0.5);
    noiseBurst(v, 'white', t, 0.18, 0.05, 0.35, 'bandpass', arrive ? 7000 : 2000, arrive ? 2000 : 8000, 4);
    for (let i = 0; i < 6; i++) tone(v, 'sine', midiHz(88 + ((Math.random() * 12) | 0)), t + Math.random() * 0.35, 0.04, 0.002, 0.15);
  }

  fizzle(x: number): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 1.0, send: 0.2 });
    const t = v.t;
    const o = tone(v, 'triangle', 700, t, 0.15, 0.005, 0.4, 2500);
    sweep(o.frequency, t, 700 * v.p, 160 * v.p, 0.4);
    noiseBurst(v, 'crackle', t, 0.25, 0.01, 0.5, 'bandpass', 3000, 900, 1);
  }

  outOfBounds(x: number): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 0.25, send: 0.3 });
    noiseBurst(v, 'pink', v.t, 0.4, 0.05, 0.45, 'bandpass', 2000, 500, 1.5);
  }

  mound(x: number, radius: number): void {
    if (radius <= 4) return; // cooled lava blobs: handled by the sizzle cool
    const k = clamp(radius / 92, 0.4, 1);
    const v = this.s.voice({ group: 'boom', x, gain: 0.8 * k, send: 0.2 });
    const t = v.t;
    drop(v, t, 0.7, 80, 35, 0.6, 0.06);
    noiseBurst(v, 'brown', t, 0.8, 0.08, 1.0, 'lowpass', 400, 900);
    noiseBurst(v, 'rubble', t + 0.1, 0.7, 0.1, 1.2, 'lowpass', 2200, 500, 0.8, 0.9);
  }

  quake(x: number, step: number): void {
    const v = this.s.voice({ group: 'small', x, gain: clamp(0.85 - step * 0.1, 0.4, 0.85), send: 0.15 });
    const t = v.t;
    noiseBurst(v, 'brown', t, 0.9, 0.03, 0.55, 'lowpass', 300, 60);
    drop(v, t, 0.6, vary(70, 0.1), 30, 0.4, 0.02);
    noiseBurst(v, 'rubble', t + 0.03, 0.5, 0.02, 0.6, 'lowpass', 1400, 300, 0.8, 0.7);
  }

  lavaSpawn(x: number): void {
    const v = this.s.voice({ group: 'grain', x, gain: vary(0.35, 0.2), send: 0.1 });
    noiseBurst(v, 'crackle', v.t, 0.6, 0.01, vary(0.4, 0.3), 'highpass', 2500, 4000, 0.7);
    const o = tone(v, 'sine', vary(300, 0.3), v.t, 0.12, 0.005, 0.12);
    sweep(o.frequency, v.t, 300 * v.p, 700 * v.p, 0.1); // bloop
  }

  lavaCool(x: number): void {
    const v = this.s.voice({ group: 'grain', x, gain: vary(0.3, 0.2), send: 0.15 });
    noiseBurst(v, 'white', v.t, 0.35, 0.02, 0.6, 'highpass', 6000, 2500, 0.5);
  }

  tankDestroyed(x: number): void {
    const v = this.s.voice({ group: 'boom', x, gain: 0.9, send: 0.45 });
    const t = v.t + 0.04;
    // Deep secondary detonation + tearing metal + debris rain.
    drop(v, t, 1.1, 85, 22, 1.4, 0.01);
    noiseBurst(v, 'brown', t, 0.9, 0.01, 1.6, 'lowpass', 2600, 90, 1.2);
    metal(v, 92, t, 0.18, 1.4);
    metal(v, 131, t + 0.05, 0.12, 1.1);
    const o = tone(v, 'sawtooth', 380, t + 0.05, 0.1, 0.02, 0.8, 1400);
    sweep(o.frequency, t + 0.05, 380 * v.p, 120 * v.p, 0.8); // groan
    noiseBurst(v, 'rubble', t + 0.25, 0.6, 0.15, 1.6, 'bandpass', 2400, 900, 0.8, 1.3);
  }

  crateSpawn(x: number): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 1.2, send: 0.3 });
    const t = v.t;
    // Canopy pops open (fwump) then flutters.
    noiseBurst(v, 'pink', t, 0.6, 0.02, 0.25, 'bandpass', 500, 1600, 1.4);
    const flutter = v.gain(0.6);
    const g = v.gain(0, flutter);
    ahr(g.gain, t + 0.15, 0.25, 0.2, 0.6, 0.6);
    const f = v.filter('bandpass', 900, 1.2, g);
    v.noise('pink', t + 0.15, 1.6, f);
    v.lfo(vary(9, 0.15), 0.4, flutter.gain, t + 0.15, 1.6); // canopy flutter
    bell(v, midiHz(79), t + 0.05, 0.05, 0.5, 2.0, 0.6);
  }

  crateLand(x: number): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 0.7, send: 0.15 });
    const t = v.t;
    drop(v, t, 0.6, vary(190, 0.08), 90, 0.12);
    noiseBurst(v, 'pink', t, 0.5, 0.001, 0.09, 'bandpass', 700, 400, 2.2); // woody knock
    noiseBurst(v, 'rubble', t + 0.02, 0.35, 0.01, 0.3, 'lowpass', 1600, 400, 0.8);
  }

  crateCollect(x: number): void {
    const v = this.s.voice({ group: 'chime', x, gain: 0.65, send: 0.4 });
    const notes = [79, 83, 86, 91];
    for (let i = 0; i < notes.length; i++) {
      bell(v, midiHz(notes[i]), v.t + i * 0.06, 0.13, 0.55, 3.0, 0.9);
      tone(v, 'triangle', midiHz(notes[i] - 12), v.t + i * 0.06, 0.06, 0.003, 0.2);
    }
  }

  /** Beacon planted: insistent beeps over a rising charge (lasts ~chargeTime). */
  beamMark(x: number, charge: number): void {
    const v = this.s.voice({ group: 'held', x, gain: 0.55, send: 0.35 });
    const t = v.t;
    const g = v.gain(0);
    ahr(g.gain, t, 0.22, charge * 0.85, 0.05, 0.1);
    const o = v.osc('sawtooth', 120 * v.p, t, charge + 0.2, v.filter('lowpass', 2400, 4, g));
    sweep(o.frequency, t, 110 * v.p, 880 * v.p, charge);
    v.lfo(14, 18, o.frequency, t, charge + 0.2);
    const n = Math.max(3, Math.round(charge / 0.15));
    for (let i = 0; i < n; i++) {
      const tt = t + charge * (1 - Math.pow(1 - i / n, 1.6));
      tone(v, 'sine', midiHz(91 + (i % 2) * 2), tt, 0.1, 0.002, 0.06);
    }
  }

  /** Sustained beam roar; returned voice is released by the caller on 'end'. */
  beamRoar(x: number): Voice {
    const v = this.s.voice({ group: 'held', x, gain: 0.9, send: 0.4 });
    const t = v.t;
    noiseBurst(v, 'white', t, 0.6, 0.001, 0.12, 'highpass', 2000, 1000);
    drop(v, t, 1.0, 110, 40, 0.6);
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.05);
    const f = v.filter('lowpass', 3000, 1.2, g);
    v.noise('pink', t, 0, f);
    v.lfo(7, 700, f.frequency, t, 0);
    const hum = v.gain(0.16, g);
    v.osc('sawtooth', 55 * v.p, t, 0, v.filter('lowpass', 500, 1, hum));
    v.osc('sawtooth', 82.5 * v.p * 1.003, t, 0, v.filter('lowpass', 700, 1, hum));
    const sizzle = v.gain(0.3, g);
    v.noise('crackle', t, 0, v.filter('highpass', 3000, 0.7, sizzle));
    return v;
  }

  /** Singularity hum: a deep drone whose swirl tightens over `duration`, released at collapse. */
  voidHum(x: number, duration: number): Voice {
    const v = this.s.voice({ group: 'held', x, gain: 0.36, send: 0.55 });
    const t = v.t;
    const g = v.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.25);
    g.gain.linearRampToValueAtTime(0.85, t + duration);
    const o = v.osc('sine', 62 * v.p, t, 0, g);
    sweep(o.frequency, t, 62 * v.p, 34 * v.p, duration);
    const o2 = v.osc('triangle', 93 * v.p, t, 0, v.filter('lowpass', 400, 1, g));
    sweep(o2.frequency, t, 93 * v.p, 46 * v.p, duration);
    const f = v.filter('bandpass', 400, 4, g);
    sweep(f.frequency, t, 300, 2600, duration); // swirling inward: the reversed whoosh
    v.noise('pink', t, 0, f);
    const lfo = v.lfo(3, 300, f.frequency, t, 0);
    sweep(lfo.frequency, t, 2, 14, duration);
    return v;
  }

  // ---- turn flow & feedback ---------------------------------------------------------

  turnChime(player: 0 | 1, cpu: boolean): void {
    const v = this.s.voice({ group: 'chime', gain: cpu ? 0.55 : 0.7, send: 0.45 });
    // Player 0 (Azure) rises to the fifth; player 1 (Blaze) a fourth lower and falls to the third.
    const notes = player === 0 ? [76, 83] : [71, 67];
    bell(v, midiHz(notes[0]), v.t, 0.14, 0.8, 2.0, 0.8);
    bell(v, midiHz(notes[1]), v.t + 0.09, 0.14, 1.1, 2.0, 0.7);
    tone(v, 'sine', midiHz(notes[1] - 24), v.t + 0.09, 0.06, 0.01, 0.6);
  }

  /** Soft mechanical tick while the CPU swings its barrel. */
  aimTick(angle: number, power: boolean): void {
    const v = this.s.voice({ group: 'tick', gain: 0.18 });
    const f = power ? 1700 : 900 + angle * 6;
    tone(v, 'triangle', vary(f, 0.02), v.t, 0.25, 0.001, 0.025);
    noiseBurst(v, 'white', v.t, 0.08, 0.0005, 0.012, 'highpass', 6000, 6000);
  }

  weaponSelect(): void {
    const v = this.s.voice({ group: 'ui', gain: 0.4, send: 0.08 });
    const t = v.t;
    noiseBurst(v, 'white', t, 0.4, 0.001, 0.02, 'bandpass', 3000, 2500, 3);
    tone(v, 'triangle', vary(420, 0.03), t, 0.12, 0.001, 0.05);
    noiseBurst(v, 'white', t + 0.07, 0.5, 0.001, 0.03, 'bandpass', 2000, 1600, 3); // chamber locks
    tone(v, 'triangle', vary(280, 0.03), t + 0.07, 0.15, 0.001, 0.07);
  }

  /** Engine start rev or stop hiss. */
  drive(x: number, moving: boolean): void {
    const v = this.s.voice({ group: 'sfx', x, gain: 0.35 });
    const t = v.t;
    if (moving) {
      const g = v.gain(0);
      perc(g.gain, t, 0.4, 0.05, 0.3);
      const o = v.osc('sawtooth', 40 * v.p, t, 0.4, v.filter('lowpass', 500, 2, g));
      sweep(o.frequency, t, 40 * v.p, 80 * v.p, 0.2);
    } else {
      noiseBurst(v, 'white', t, 0.15, 0.01, 0.25, 'highpass', 4000, 6000, 0.7); // brake hiss
      drop(v, t, 0.2, 90, 50, 0.15);
    }
  }

  // ---- stingers -----------------------------------------------------------------------

  /** Soft synth-brass note: detuned saws through an enveloped lowpass. */
  private brass(v: Voice, f: number, t: number, dur: number, gain: number): void {
    f *= v.p;
    const g = v.gain(0);
    ahr(g.gain, t, gain, 0.04, dur, 0.5);
    const lp = v.filter('lowpass', 600, 1.5, g);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(Math.min(f * 6, 5000), t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 2.5, 2500), t + 0.06 + dur);
    v.osc('sawtooth', f * semi(-0.07), t, dur + 0.6, lp);
    v.osc('sawtooth', f * semi(0.07), t, dur + 0.6, lp);
    v.osc('triangle', f / 2, t, dur + 0.6, lp);
  }

  /** Win fanfare (match = longer, with a final chord bloom) or defeat sting or draw. */
  stinger(kind: 'win' | 'lose' | 'draw', match: boolean): void {
    const v = this.s.voice({ group: 'held', gain: match ? 0.55 : 0.45, send: 0.5 });
    const t = v.t + 0.05;
    if (kind === 'win') {
      const run = match ? [60, 64, 67, 72] : [67, 72];
      const step = 0.11;
      run.forEach((n, i) => this.brass(v, midiHz(n), t + i * step, 0.08, 0.16));
      const tc = t + run.length * step;
      const chord = match ? [60, 64, 67, 72, 76] : [64, 67, 72];
      for (const n of chord) this.brass(v, midiHz(n), tc, match ? 1.2 : 0.6, 0.12);
      for (let i = 0; i < (match ? 8 : 4); i++) bell(v, midiHz(84 + [0, 4, 7, 12, 16, 19, 24, 28][i]), tc + 0.04 + i * 0.06, 0.06, 0.9, 2.0, 0.8);
      noiseBurst(v, 'white', tc, 0.12, 0.01, match ? 1.6 : 0.8, 'highpass', 7000, 5000, 0.5); // cymbal air
      drop(v, tc, 0.5, 110, 50, 0.4);
    } else if (kind === 'lose') {
      const run = [67, 63, 60];
      run.forEach((n, i) => this.brass(v, midiHz(n), t + i * 0.22, 0.16, 0.13));
      const tc = t + run.length * 0.22;
      for (const n of [48, 55, 60, 63]) this.brass(v, midiHz(n), tc, match ? 1.3 : 0.7, 0.1);
      const o = tone(v, 'sine', midiHz(43), tc, 0.25, 0.05, 1.6);
      sweep(o.frequency, tc, midiHz(43) * v.p, midiHz(36) * v.p, 1.5);
    } else {
      for (const n of [62, 67, 69]) this.brass(v, midiHz(n), t, 0.7, 0.11);
      bell(v, midiHz(81), t + 0.1, 0.06, 1.0, 2.0, 0.6);
    }
  }

  roundStart(): void {
    const v = this.s.voice({ group: 'sfx', gain: 0.35, send: 0.5 });
    const t = v.t;
    noiseBurst(v, 'pink', t, 0.5, 0.6, 0.5, 'bandpass', 300, 3000, 1.5); // riser
    bell(v, midiHz(74), t + 0.6, 0.1, 1.2, 2.0, 0.8);
    bell(v, midiHz(81), t + 0.6, 0.08, 1.2, 2.0, 0.8);
  }

  // ---- UI -----------------------------------------------------------------------------

  ui(sound: UiSound): void {
    const v = this.s.voice({ group: 'ui', gain: 0.5, send: sound === 'hover' || sound === 'tick' ? 0 : 0.12 });
    const t = v.t;
    switch (sound) {
      case 'hover':
        tone(v, 'sine', vary(2100, 0.02), t, 0.035, 0.004, 0.035);
        break;
      case 'tick':
        tone(v, 'triangle', vary(1900, 0.03), t, 0.07, 0.001, 0.018);
        break;
      case 'click':
        noiseBurst(v, 'white', t, 0.18, 0.0005, 0.012, 'bandpass', 4200, 3500, 2);
        sweep(tone(v, 'sine', 1150, t, 0.16, 0.002, 0.05).frequency, t, 1150 * v.p, 820 * v.p, 0.04);
        break;
      case 'select':
        tone(v, 'sine', midiHz(81), t, 0.12, 0.003, 0.08);
        bell(v, midiHz(88), t + 0.055, 0.08, 0.3, 2.0, 0.5);
        break;
      case 'confirm':
        bell(v, midiHz(79), t, 0.1, 0.4, 2.0, 0.6);
        bell(v, midiHz(86), t + 0.07, 0.1, 0.55, 2.0, 0.6);
        noiseBurst(v, 'white', t, 0.1, 0.0005, 0.01, 'bandpass', 4200, 3500, 2);
        break;
      case 'back':
        tone(v, 'sine', midiHz(84), t, 0.11, 0.003, 0.07);
        tone(v, 'sine', midiHz(77), t + 0.06, 0.1, 0.003, 0.12);
        break;
      case 'toggle':
        noiseBurst(v, 'white', t, 0.16, 0.0005, 0.01, 'bandpass', 3000, 3000, 2);
        tone(v, 'triangle', vary(1320, 0.02), t, 0.1, 0.002, 0.04);
        noiseBurst(v, 'white', t + 0.035, 0.12, 0.0005, 0.01, 'bandpass', 5000, 5000, 2);
        break;
      case 'open': {
        noiseBurst(v, 'pink', t, 0.14, 0.05, 0.12, 'bandpass', 800, 3200, 1.6);
        sweep(tone(v, 'sine', 600, t, 0.08, 0.02, 0.12).frequency, t, 600 * v.p, 1100 * v.p, 0.1);
        break;
      }
      case 'close': {
        noiseBurst(v, 'pink', t, 0.12, 0.03, 0.12, 'bandpass', 2800, 700, 1.6);
        sweep(tone(v, 'sine', 1000, t, 0.07, 0.01, 0.12).frequency, t, 1000 * v.p, 560 * v.p, 0.1);
        break;
      }
      case 'error':
        tone(v, 'square', 196, t, 0.07, 0.004, 0.08, 900);
        tone(v, 'square', 185, t + 0.11, 0.07, 0.004, 0.12, 900);
        break;
      case 'start': {
        noiseBurst(v, 'pink', t, 0.25, 0.25, 0.3, 'bandpass', 400, 4000, 1.4);
        const notes = [69, 74, 78, 81, 86];
        for (let i = 0; i < notes.length; i++) bell(v, midiHz(notes[i]), t + 0.08 + i * 0.045, 0.09, 0.9, 2.0, 0.7);
        drop(v, t + 0.28, 0.35, 120, 50, 0.3);
        break;
      }
    }
  }
}
