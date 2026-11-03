/**
 * Low-level WebAudio plumbing shared by SFX and music: pre-generated noise buffers,
 * a generated reverb impulse, envelope helpers and a bounded voice manager.
 *
 * A Voice is a tiny disposable graph (sources → filters/gains → out gain → panner → bus [+ reverb send]).
 * Every node it creates is tracked so the whole graph is disconnected as soon as its last source ends,
 * and voice groups have hard caps (oldest voice is faded out and stolen) so the node count stays bounded.
 */
import { WORLD_W } from '../core/constants.ts';
import { clamp } from '../core/math.ts';

export type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle' | 'rubble';

/** Random in [-1, 1). Presentation code may use Math.random(). */
export const rnd = (): number => Math.random() * 2 - 1;
/** x ± x·amount, uniformly. */
export const vary = (x: number, amount: number): number => x * (1 + rnd() * amount);
export const pick = <T>(list: readonly T[]): T => list[(Math.random() * list.length) | 0];
/** Semitones → frequency ratio. */
export const semi = (n: number): number => Math.pow(2, n / 12);
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** World x → stereo pan, kept inside ±0.8 so nothing is hard-panned. */
export const panForX = (x: number): number => clamp((x / WORLD_W) * 2 - 1, -1, 1) * 0.8;

const EPS = 0.0001;

// -------------------------------------------------------------------------------------------
// Envelope helpers (all times are AudioContext seconds)
// -------------------------------------------------------------------------------------------

/** Percussive envelope: 0 → peak in `attack`, exponential fall to silence over `decay`. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(EPS, t + attack + decay);
  p.setValueAtTime(0, t + attack + decay + 0.005);
  return t + attack + decay + 0.01;
}

/** Attack, hold, release envelope (linear attack, exponential release). */
export function ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setValueAtTime(peak, t + attack + hold);
  p.exponentialRampToValueAtTime(EPS, t + attack + hold + release);
  p.setValueAtTime(0, t + attack + hold + release + 0.005);
  return t + attack + hold + release + 0.01;
}

/** Exponential sweep from → to over dur (values must be > 0). */
export function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, EPS), t);
  p.exponentialRampToValueAtTime(Math.max(to, EPS), t + Math.max(dur, 0.002));
}

/** Smoothly glide an always-on parameter toward a value (safe to call every frame). */
export function glide(p: AudioParam, value: number, now: number, timeConstant: number): void {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(value, now, timeConstant);
}

// -------------------------------------------------------------------------------------------
// Buffers
// -------------------------------------------------------------------------------------------

function makeNoise(ctx: BaseAudioContext, kind: NoiseKind, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's refined pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    // Sparse impulses: 'crackle' = sharp ticks (fire, fireworks), 'rubble' = soft lumps (dirt, debris).
    const sharp = kind === 'crackle';
    const rate = sharp ? 140 : 55; // events per second
    let i = 0;
    while (i < len) {
      i += Math.floor((-Math.log(1 - Math.random()) / rate) * ctx.sampleRate);
      if (i >= len) break;
      const amp = (0.25 + Math.random() * 0.75) * (Math.random() < 0.5 ? -1 : 1);
      const n = sharp ? 6 + ((Math.random() * 30) | 0) : 120 + ((Math.random() * 500) | 0);
      for (let k = 0; k < n && i + k < len; k++) {
        const env = Math.exp((-k / n) * 5);
        d[i + k] += amp * env * (sharp ? Math.random() * 2 - 1 : Math.sin((k / n) * Math.PI * (2 + Math.random())));
      }
    }
  }
  return buf;
}

/** Stereo hall-ish impulse: a few early reflections then a darkening exponential tail. */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // One-pole lowpass whose cutoff falls over time: the tail gets darker like a real room.
      const k = 0.65 - 0.55 * Math.min(1, t / seconds);
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t / seconds, decay) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let r = 0; r < 7; r++) {
      const at = Math.floor(sr * (0.007 + Math.random() * 0.06));
      d[at] += (Math.random() * 0.6 + 0.3) * (Math.random() < 0.5 ? -1 : 1);
    }
  }
  return buf;
}

// -------------------------------------------------------------------------------------------
// Voices
// -------------------------------------------------------------------------------------------

export interface VoiceOptions {
  /** Voice group for capping (e.g. 'boom', 'ui'). */
  group?: string;
  /** World x for stereo pan; omit for centre. */
  x?: number;
  /** Output gain. */
  gain?: number;
  /** Reverb send amount 0..1. */
  send?: number;
  /** Reverb send destination override (music uses its own send). */
  sendTo?: AudioNode;
  /** Destination override (defaults to the sfx bus). */
  dest?: AudioNode;
  /** Start delay in seconds. */
  delay?: number;
}

type Src = AudioScheduledSourceNode;

export class Voice {
  readonly t: number;
  readonly out: GainNode;
  readonly group: string;
  /** Pitch multiplier (slow-mo) and duration stretch to apply in recipes. */
  readonly p: number;
  readonly s: number;
  endAt = 0;
  held = false;
  dead = false;
  private nodes: AudioNode[] = [];
  private sources: Src[] = [];
  private pending = 0;
  private readonly synth: Synth;

  constructor(synth: Synth, opts: VoiceOptions) {
    this.synth = synth;
    const ctx = synth.ctx;
    this.group = opts.group ?? 'sfx';
    this.p = synth.pitch;
    this.s = synth.stretch;
    this.t = ctx.currentTime + 0.005 + (opts.delay ?? 0);
    this.out = ctx.createGain();
    this.out.gain.value = opts.gain ?? 1;
    this.nodes.push(this.out);
    let tail: AudioNode = this.out;
    if (opts.x !== undefined) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = panForX(opts.x);
      this.out.connect(pan);
      this.nodes.push(pan);
      tail = pan;
    }
    tail.connect(opts.dest ?? synth.sfxIn);
    const send = opts.send ?? 0;
    if (send > 0) {
      const g = ctx.createGain();
      g.gain.value = send;
      tail.connect(g);
      g.connect(opts.sendTo ?? synth.reverbIn);
      this.nodes.push(g);
    }
  }

  private track<T extends AudioNode>(n: T, dest: AudioNode | null): T {
    this.nodes.push(n);
    if (dest) n.connect(dest);
    return n;
  }

  private schedule(src: Src, start: number, stop: number | null): void {
    this.sources.push(src);
    this.pending++;
    src.onended = this.onEnded;
    src.start(start);
    if (stop !== null) {
      src.stop(stop);
      if (stop > this.endAt) this.endAt = stop;
    } else {
      this.held = true;
    }
  }

  private onEnded = (): void => {
    if (--this.pending <= 0) this.dispose();
  };

  gain(value: number, dest: AudioNode | null = this.out): GainNode {
    const g = this.track(this.synth.ctx.createGain(), dest);
    g.gain.value = value;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7, dest: AudioNode | null = this.out): BiquadFilterNode {
    const f = this.track(this.synth.ctx.createBiquadFilter(), dest);
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Oscillator from start (absolute) for dur seconds (dur ≤ 0 = held until release()). */
  osc(type: OscillatorType, freq: number, start: number, dur: number, dest: AudioNode | null = this.out): OscillatorNode {
    const o = this.track(this.synth.ctx.createOscillator(), dest);
    o.type = type;
    o.frequency.value = freq;
    this.schedule(o, start, dur > 0 ? start + dur : null);
    return o;
  }

  /** Looping noise buffer from a random offset. */
  noise(kind: NoiseKind, start: number, dur: number, dest: AudioNode | null = this.out, rate = 1): AudioBufferSourceNode {
    const b = this.synth.buffer(kind);
    const s = this.track(this.synth.ctx.createBufferSource(), dest);
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    this.sources.push(s);
    this.pending++;
    s.onended = this.onEnded;
    s.start(start, Math.random() * (b.duration - 0.1));
    if (dur > 0) {
      s.stop(start + dur);
      if (start + dur > this.endAt) this.endAt = start + dur;
    } else this.held = true;
    return s;
  }

  /** Constant offset source (handy as a modulation bias). */
  lfo(freq: number, depth: number, target: AudioParam, start: number, dur: number, type: OscillatorType = 'sine'): OscillatorNode {
    const g = this.gain(depth, null);
    g.connect(target);
    return this.osc(type, freq, start, dur, g);
  }

  /** Fade out and stop everything (held voices, voice stealing). */
  release(fade = 0.08, at = this.synth.ctx.currentTime): void {
    if (this.dead) return;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.setTargetAtTime(0, at, fade / 4);
    const stop = at + fade + 0.02;
    for (const s of this.sources) {
      try { s.stop(stop); } catch { /* already stopped */ }
    }
    this.held = false;
    this.endAt = stop;
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* not started or already stopped */ }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.synth.forget(this);
  }
}

// -------------------------------------------------------------------------------------------
// Synth: context + routing + voice bookkeeping
// -------------------------------------------------------------------------------------------

/** Per-group concurrency caps. Anything not listed shares the generic 'sfx' cap. */
const GROUP_CAPS: Record<string, number> = {
  boom: 7, small: 8, ui: 6, tick: 4, metal: 5, zap: 6, chime: 5, grain: 10, sfx: 20, held: 6, music: 64,
};
const MAX_VOICES = 72;
/** Held voices are force-released after this long (safety net). */
const MAX_HOLD = 12;

export class Synth {
  readonly ctx: BaseAudioContext;
  /** Final chain: master → glue compressor → limiter → destination. */
  readonly master: GainNode;
  /** Post-limiter output (for metering). */
  readonly output: AudioNode;
  /** SFX volume → duck → slow-mo lowpass → master. Voices connect to sfxIn. */
  readonly sfxIn: GainNode;
  readonly sfxVol: GainNode;
  readonly sfxDuck: GainNode;
  readonly sfxFilter: BiquadFilterNode;
  /** Ambience (wind, beds) joins the SFX chain so it follows SFX volume and slow-mo. */
  readonly ambIn: GainNode;
  /** Music volume → duck → master. */
  readonly musicIn: GainNode;
  readonly musicVol: GainNode;
  readonly musicDuck: GainNode;
  /** Reverb sends (one per bus so they follow their bus volume/duck) → convolver → master. */
  readonly reverbIn: GainNode;
  readonly musicReverbIn: GainNode;
  readonly reverb: ConvolverNode;
  /** Pitch multiplier and time stretch applied by recipes (slow motion). */
  pitch = 1;
  stretch = 1;
  private buffers: Record<NoiseKind, AudioBuffer>;
  private voices: Voice[] = [];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const g = (v = 1): GainNode => { const n = ctx.createGain(); n.gain.value = v; return n; };

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 12; glue.ratio.value = 3.5;
    glue.attack.value = 0.004; glue.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.08;
    this.master = g(0);
    this.master.connect(glue); glue.connect(limiter); limiter.connect(ctx.destination);
    this.output = limiter;

    this.sfxIn = g(1); this.sfxVol = g(1); this.sfxDuck = g(1);
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass'; this.sfxFilter.frequency.value = 20000; this.sfxFilter.Q.value = 0.5;
    this.ambIn = g(1);
    this.sfxIn.connect(this.sfxVol); this.ambIn.connect(this.sfxVol);
    this.sfxVol.connect(this.sfxDuck); this.sfxDuck.connect(this.sfxFilter); this.sfxFilter.connect(this.master);

    this.musicIn = g(1); this.musicVol = g(1); this.musicDuck = g(1);
    this.musicIn.connect(this.musicVol); this.musicVol.connect(this.musicDuck); this.musicDuck.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.6, 2.4);
    const ret = g(0.9);
    this.reverb.connect(ret); ret.connect(this.master);
    // Sends pass through copies of the bus volume/duck gains so reverb tails follow them.
    this.reverbIn = g(1);
    const rvVol = g(1), rvDuck = g(1);
    this.reverbIn.connect(rvVol); rvVol.connect(rvDuck); rvDuck.connect(this.reverb);
    this.sfxSendGains = [rvVol, rvDuck];
    this.musicReverbIn = g(1);
    const mvVol = g(1), mvDuck = g(1);
    this.musicReverbIn.connect(mvVol); mvVol.connect(mvDuck); mvDuck.connect(this.reverb);
    this.musicSendGains = [mvVol, mvDuck];

    this.buffers = {
      white: makeNoise(ctx, 'white', 2),
      pink: makeNoise(ctx, 'pink', 3),
      brown: makeNoise(ctx, 'brown', 3),
      crackle: makeNoise(ctx, 'crackle', 2.5),
      rubble: makeNoise(ctx, 'rubble', 2.5),
    };
  }

  /** [volume, duck] gains on the sfx and music reverb sends. */
  readonly sfxSendGains: [GainNode, GainNode];
  readonly musicSendGains: [GainNode, GainNode];

  buffer(kind: NoiseKind): AudioBuffer {
    return this.buffers[kind];
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Allocates a voice, stealing the oldest one in its group (or overall) when at a cap. */
  voice(opts: VoiceOptions = {}): Voice {
    const group = opts.group ?? 'sfx';
    const cap = GROUP_CAPS[group] ?? GROUP_CAPS.sfx;
    let inGroup = 0;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.group !== group) continue;
      inGroup++;
      if (!oldest) oldest = v;
    }
    if (inGroup >= cap && oldest) this.steal(oldest);
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.find(v => v.group !== 'music') ?? this.voices[0];
      this.steal(victim);
    }
    const v = new Voice(this, opts);
    this.voices.push(v);
    return v;
  }

  /** Number of live voices in a group (or all). */
  count(group?: string): number {
    if (!group) return this.voices.length;
    let n = 0;
    for (const v of this.voices) if (v.group === group) n++;
    return n;
  }

  private steal(v: Voice): void {
    // Not audible yet (same-frame burst): drop it outright.
    if (this.ctx.currentTime <= v.t) {
      v.dispose();
      return;
    }
    // Otherwise a 40 ms fade (no click); it leaves the books now and is disposed shortly after.
    v.release(0.04);
    this.forget(v);
    setTimeout(() => v.dispose(), 120);
  }

  forget(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Housekeeping, called regularly: disposes overdue voices and releases runaway held voices. */
  sweep(): void {
    const now = this.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.held) {
        if (now - v.t > MAX_HOLD) v.release(0.3);
      } else if ((v.endAt > 0 && now > v.endAt + 1) || (v.endAt === 0 && now > v.t + 2)) {
        v.dispose();
      }
    }
  }
}
