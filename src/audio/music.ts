/**
 * Calm generative score. A lookahead scheduler (setTimeout + AudioContext clock, never per frame)
 * plays eighth-note steps: slow detuned pads per chord, a bass line, a sparse generative arpeggio
 * with tempo-synced echo, an occasional bell melody, and (battle) a soft pulse with hats.
 * Each mood/biome is a data entry; switching crossfades two independent Score instances.
 */
import type { BiomeId } from '../core/biomes.ts';
import type { MusicMode } from '../contracts.ts';
import { ahr, midiHz, perc, rnd, type Synth, type Voice } from './synth.ts';

type Timbre = 'pluck' | 'bell' | 'glass' | 'oud';

interface MoodDef {
  bpm: number;
  /** MIDI root of the key. */
  root: number;
  /** Scale as semitone offsets (7 notes). */
  scale: readonly number[];
  /** Chord roots as scale degrees; chords are stacked thirds inside the scale. */
  progression: readonly number[];
  /** Steps (eighths) per chord. */
  chordSteps: number;
  /** Notes per pad chord (3 = triad, 4 = seventh). */
  chordSize: number;
  pad: { type: OscillatorType; cutoff: number; gain: number; detune: number };
  arp: { timbre: Timbre; density: number; octave: number; gain: number; sixteenths: boolean };
  bass: { gain: number; type: OscillatorType; pulse: boolean };
  /** Soft kick + hats (battle tension). */
  drums: number;
  /** Chance per bar of a bell melody phrase. */
  melody: number;
  reverb: number;
  /** One-shot opening gesture (victory/defeat). */
  intro?: 'win' | 'lose';
}

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];

const MENU: MoodDef = {
  bpm: 74, root: 53, scale: IONIAN, progression: [0, 5, 3, 4, 0, 2, 3, 4], chordSteps: 16, chordSize: 4,
  pad: { type: 'sawtooth', cutoff: 900, gain: 0.07, detune: 9 },
  arp: { timbre: 'pluck', density: 0.55, octave: 2, gain: 0.11, sixteenths: false },
  bass: { gain: 0.14, type: 'triangle', pulse: false }, drums: 0, melody: 0.35, reverb: 0.55,
};

const BATTLE: Record<BiomeId, MoodDef> = {
  verdant: {
    bpm: 92, root: 50, scale: LYDIAN, progression: [0, 4, 5, 3], chordSteps: 16, chordSize: 3,
    pad: { type: 'sawtooth', cutoff: 1100, gain: 0.065, detune: 8 },
    arp: { timbre: 'pluck', density: 0.6, octave: 2, gain: 0.1, sixteenths: false },
    bass: { gain: 0.15, type: 'triangle', pulse: true }, drums: 0.7, melody: 0.25, reverb: 0.4,
  },
  dunes: {
    bpm: 84, root: 52, scale: PHRYGIAN_DOM, progression: [0, 1, 0, 6], chordSteps: 16, chordSize: 3,
    pad: { type: 'sawtooth', cutoff: 800, gain: 0.05, detune: 12 },
    arp: { timbre: 'oud', density: 0.5, octave: 1, gain: 0.12, sixteenths: true },
    bass: { gain: 0.16, type: 'sine', pulse: true }, drums: 0.8, melody: 0.2, reverb: 0.45,
  },
  frost: {
    bpm: 86, root: 54, scale: DORIAN, progression: [0, 3, 6, 4], chordSteps: 16, chordSize: 4,
    pad: { type: 'triangle', cutoff: 2200, gain: 0.07, detune: 6 },
    arp: { timbre: 'glass', density: 0.5, octave: 2, gain: 0.09, sixteenths: false },
    bass: { gain: 0.13, type: 'sine', pulse: true }, drums: 0.5, melody: 0.3, reverb: 0.6,
  },
  cinder: {
    bpm: 96, root: 48, scale: HARM_MINOR, progression: [0, 5, 3, 4], chordSteps: 16, chordSize: 3,
    pad: { type: 'square', cutoff: 700, gain: 0.04, detune: 10 },
    arp: { timbre: 'pluck', density: 0.55, octave: 1, gain: 0.1, sixteenths: true },
    bass: { gain: 0.18, type: 'sawtooth', pulse: true }, drums: 1, melody: 0.15, reverb: 0.35,
  },
  lunar: {
    bpm: 68, root: 57, scale: LYDIAN, progression: [0, 1, 0, 4], chordSteps: 16, chordSize: 4,
    pad: { type: 'sine', cutoff: 3000, gain: 0.06, detune: 5 },
    arp: { timbre: 'bell', density: 0.35, octave: 2, gain: 0.08, sixteenths: false },
    bass: { gain: 0.12, type: 'sine', pulse: false }, drums: 0.2, melody: 0.4, reverb: 0.75,
  },
};

const VICTORY: MoodDef = {
  ...MENU, bpm: 80, root: 55, progression: [0, 3, 5, 4], arp: { ...MENU.arp, density: 0.4 }, melody: 0.3, intro: 'win',
};
const DEFEAT: MoodDef = {
  ...MENU, bpm: 64, root: 50, scale: AEOLIAN, progression: [0, 5, 3, 4], arp: { ...MENU.arp, density: 0.25, timbre: 'glass' },
  pad: { ...MENU.pad, cutoff: 650 }, melody: 0.15, intro: 'lose',
};

/** MIDI note of scale degree d (any integer) above root. */
function degree(def: MoodDef, d: number): number {
  const n = def.scale.length;
  const oct = Math.floor(d / n);
  return def.root + def.scale[((d % n) + n) % n] + 12 * oct;
}

// -------------------------------------------------------------------------------------------
// Instruments (each call = one short-lived Voice routed into the score)
// -------------------------------------------------------------------------------------------

function pluckNote(v: Voice, timbre: Timbre, f: number, t: number, gain: number): void {
  const g = v.gain(0);
  if (timbre === 'pluck') {
    perc(g.gain, t, gain, 0.004, 0.9);
    const lp = v.filter('lowpass', f * 6, 1.2, g);
    lp.frequency.setValueAtTime(Math.min(f * 8, 9000), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.35);
    v.osc('triangle', f, t, 0.95, lp);
    v.osc('sawtooth', f * 1.003, t, 0.95, v.gain(0.35, lp));
  } else if (timbre === 'oud') {
    perc(g.gain, t, gain, 0.003, 0.5);
    const bp = v.filter('bandpass', f * 3, 2.5, g);
    const o = v.osc('sawtooth', f, t, 0.55, bp);
    o.frequency.setValueAtTime(f * 0.985, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    v.osc('triangle', f, t, 0.55, v.gain(0.5, g));
  } else if (timbre === 'glass') {
    perc(g.gain, t, gain, 0.006, 1.6);
    v.osc('sine', f, t, 1.65, g);
    const h = v.gain(0.0);
    perc(h.gain, t, gain * 0.25, 0.003, 0.4);
    v.osc('sine', f * 3.01, t, 0.45, h);
  } else {
    // FM bell
    perc(g.gain, t, gain, 0.004, 2.2);
    const car = v.osc('sine', f, t, 2.25, g);
    const mg = v.gain(0, null);
    mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * 1.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.01, t + 1.5);
    v.osc('sine', f * 3.5, t, 2.25, mg);
  }
}

// -------------------------------------------------------------------------------------------
// Score: one running instance of a mood
// -------------------------------------------------------------------------------------------

class Score {
  readonly def: MoodDef;
  readonly out: GainNode;
  private readonly synth: Synth;
  private readonly arpBus: GainNode;
  private readonly delay: DelayNode;
  private readonly fb: GainNode;
  private readonly fbFilter: BiquadFilterNode;
  private readonly stepDur: number;
  private step = 0;
  next: number;
  stopped = false;
  private chord: number[] = [];
  private arpIdx = 0;
  private arpDir = 1;
  private melodyDeg = 7;
  private melodyLeft = 0;

  constructor(synth: Synth, def: MoodDef, start: number, skipIntro: boolean) {
    this.synth = synth;
    this.def = def;
    const ctx = synth.ctx;
    this.stepDur = 60 / def.bpm / 2;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, start);
    this.out.gain.linearRampToValueAtTime(1, start + (def.intro ? 0.15 : 2.5));
    this.out.connect(synth.musicIn);
    // Tempo-synced dotted-eighth echo for the arpeggio.
    this.arpBus = ctx.createGain();
    this.arpBus.connect(this.out);
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = this.stepDur * 3;
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.32;
    this.fbFilter = ctx.createBiquadFilter();
    this.fbFilter.type = 'lowpass';
    this.fbFilter.frequency.value = 2200;
    const send = ctx.createGain();
    send.gain.value = 0.3;
    this.arpBus.connect(send);
    send.connect(this.delay);
    this.delay.connect(this.fbFilter);
    this.fbFilter.connect(this.fb);
    this.fb.connect(this.delay);
    this.fbFilter.connect(this.out);
    this.next = start + 0.05;
    if (def.intro && !skipIntro) this.next = this.intro(def.intro, start + 0.05);
  }

  private voice(dest: AudioNode, gain = 1): Voice {
    return this.synth.voice({ group: 'music', dest, gain, send: this.def.reverb, sendTo: this.synth.musicReverbIn });
  }

  /** Victory / defeat opening gesture; returns when the loop should begin. */
  private intro(kind: 'win' | 'lose', t: number): number {
    const d = this.def;
    const v = this.voice(this.out);
    if (kind === 'win') {
      const steps = [0, 2, 4, 7, 9, 11, 14];
      steps.forEach((deg, i) => pluckNote(v, 'bell', midiHz(degree(d, deg) + 12), t + i * 0.09, 0.09));
      this.pad(t + 0.5, [0, 2, 4, 7].map(x => degree(d, x)), 3.2, 0.3);
      return t + 3.4;
    }
    const steps = [7, 5, 4, 2, 0];
    steps.forEach((deg, i) => pluckNote(v, 'glass', midiHz(degree(d, deg) + 12), t + i * 0.32, 0.1));
    this.pad(t + 0.3, [0, 2, 4].map(x => degree(d, x) - 12), 3.5, 0.5);
    return t + 4;
  }

  /** Detuned pad chord with a slowly breathing lowpass. */
  private pad(t: number, notes: readonly number[], dur: number, attack = -1): void {
    const p = this.def.pad;
    const v = this.voice(this.out);
    const g = v.gain(0);
    const atk = attack > 0 ? attack : Math.min(1.6, dur * 0.35);
    ahr(g.gain, t, p.gain, atk, Math.max(0.1, dur - atk), 1.8);
    const lp = v.filter('lowpass', p.cutoff, 0.8, g);
    const total = dur + 1.9;
    v.lfo(0.08 + Math.random() * 0.08, p.cutoff * 0.35, lp.frequency, t, total);
    for (const n of notes) {
      const f = midiHz(n);
      for (const det of [-p.detune, p.detune]) {
        const o = v.osc(p.type, f, t, total, lp);
        o.detune.value = det + rnd() * 3;
      }
    }
  }

  /** Schedules every step whose time falls before `until`. */
  schedule(now: number, until: number): void {
    // After a long stall (suspended context, frozen tab) skip ahead instead of bursting the backlog.
    if (this.next < now - 0.25) this.next = now + 0.05;
    while (!this.stopped && this.next < until) {
      this.playStep(this.step, this.next);
      this.step++;
      this.next += this.stepDur;
    }
  }

  private playStep(step: number, t: number): void {
    const d = this.def;
    const sd = this.stepDur;
    const human = (): number => t + Math.random() * 0.012;

    if (step % d.chordSteps === 0) {
      const ci = Math.floor(step / d.chordSteps) % d.progression.length;
      const rootDeg = d.progression[ci];
      this.chord.length = 0;
      for (let i = 0; i < d.chordSize; i++) this.chord.push(degree(d, rootDeg + i * 2));
      this.pad(t, this.chord, d.chordSteps * sd);
      // Long bass root under each chord.
      const bv = this.voice(this.out);
      const g = bv.gain(0);
      ahr(g.gain, t, d.bass.gain * (d.bass.pulse ? 0.6 : 1), 0.3, d.chordSteps * sd - 0.4, 0.8);
      bv.osc('sine', midiHz(this.chord[0] - 12), t, d.chordSteps * sd + 0.9, g);
    }

    // Soft pulse: muted bass on every beat with a gentle swell (tension without aggression).
    if (d.bass.pulse && step % 2 === 0) {
      const v = this.voice(this.out);
      const g = v.gain(0);
      const accent = step % 8 === 0 ? 1 : 0.7;
      perc(g.gain, human(), d.bass.gain * accent, 0.012, sd * 1.6);
      const lp = v.filter('lowpass', 420, 2, g);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + sd * 1.5);
      v.osc(d.bass.type, midiHz(this.chord[0] - 12), t, sd * 1.8, lp);
    }

    // Drums: very soft kick on the downbeat, hats breathing on offbeats.
    if (d.drums > 0) {
      if (step % 8 === 0 || (d.drums > 0.75 && step % 16 === 11)) {
        const v = this.voice(this.out);
        const g = v.gain(0);
        perc(g.gain, t, 0.22 * d.drums, 0.002, 0.25);
        const o = v.osc('sine', 110, t, 0.3, g);
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      }
      if (step % 2 === 1 && Math.random() < 0.55 + d.drums * 0.4) {
        const v = this.voice(this.out);
        const g = v.gain(0);
        perc(g.gain, human(), (0.03 + Math.random() * 0.025) * d.drums, 0.001, step % 4 === 3 ? 0.08 : 0.035);
        v.noise('white', t, 0.12, v.filter('highpass', 7500, 0.8, g));
      }
    }

    // Generative arpeggio over chord tones with occasional direction changes and leaps.
    const subs = d.arp.sixteenths && Math.random() < 0.35 ? 2 : 1;
    for (let s = 0; s < subs; s++) {
      if (Math.random() > d.arp.density) continue;
      const n = this.chord.length;
      this.arpIdx += this.arpDir;
      if (this.arpIdx >= n * 2 || this.arpIdx < 0 || Math.random() < 0.12) {
        this.arpDir = -this.arpDir;
        this.arpIdx = Math.max(0, Math.min(n * 2 - 1, this.arpIdx));
      }
      const note = this.chord[this.arpIdx % n] + 12 * (d.arp.octave - 1 + Math.floor(this.arpIdx / n));
      const vel = d.arp.gain * (0.6 + Math.random() * 0.4) * (step % 4 === 0 ? 1.15 : 1);
      pluckNote(this.voice(this.arpBus), d.arp.timbre, midiHz(note), human() + s * sd * 0.5, vel);
    }

    // Occasional bell melody: a short random walk on the scale, resolving toward chord tones.
    if (step % 8 === 0 && this.melodyLeft === 0 && Math.random() < d.melody) this.melodyLeft = 3 + ((Math.random() * 3) | 0);
    if (this.melodyLeft > 0 && step % 2 === 0) {
      this.melodyLeft--;
      this.melodyDeg += [-2, -1, -1, 1, 1, 2][(Math.random() * 6) | 0];
      this.melodyDeg = Math.max(4, Math.min(12, this.melodyDeg));
      const midi = degree(d, this.melodyDeg) + 12;
      pluckNote(this.voice(this.arpBus), 'bell', midiHz(midi), human(), 0.06);
    }
  }

  fadeOut(now: number, seconds: number): void {
    this.stopped = true;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, seconds / 4);
    setTimeout(() => this.dispose(), (seconds + 3) * 1000);
  }

  private dispose(): void {
    this.out.disconnect();
    this.arpBus.disconnect();
    this.delay.disconnect();
    this.fb.disconnect();
    this.fbFilter.disconnect();
  }
}

// -------------------------------------------------------------------------------------------
// Music: mode switching + the lookahead clock
// -------------------------------------------------------------------------------------------

export class Music {
  private readonly synth: Synth;
  private current: Score | null = null;
  private key = 'off';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(synth: Synth) {
    this.synth = synth;
  }

  get mode(): string {
    return this.key;
  }

  /** Crossfades to a new mood. Same mood + biome again is a no-op. */
  set(mode: MusicMode, biome: BiomeId = 'verdant', skipIntro = false): void {
    const key = mode === 'battle' ? `battle:${biome}` : mode;
    if (key === this.key) return;
    this.key = key;
    const now = this.synth.now;
    const sting = mode === 'victory' || mode === 'defeat';
    if (this.current) this.current.fadeOut(now, sting ? 0.8 : 2.2);
    this.current = null;
    if (mode === 'off') return;
    const def = mode === 'menu' ? MENU : mode === 'battle' ? BATTLE[biome] : mode === 'victory' ? VICTORY : DEFEAT;
    this.current = new Score(this.synth, def, now + 0.05, skipIntro);
    this.tick();
  }

  private tick = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.current) return;
    // Background tabs throttle timers to ~1 Hz: look further ahead there so the score never gaps.
    const hidden = typeof document !== 'undefined' && document.hidden;
    const now = this.synth.now;
    this.current.schedule(now, now + (hidden ? 1.6 : 0.3));
    this.timer = setTimeout(this.tick, hidden ? 450 : 90);
  };

  stop(): void {
    this.set('off');
  }

  /** Schedules the current score up to an absolute time (offline rendering / tests). */
  prerender(until: number): void {
    this.current?.schedule(this.synth.now, until);
  }
}
