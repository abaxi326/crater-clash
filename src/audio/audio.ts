/**
 * AudioEngine: fully procedural WebAudio for Crater Clash.
 *
 * Routing: voices → sfx bus (volume → duck → slow-mo lowpass) ─┐
 *          ambience loops ─────────────────────────────────────┤→ master → glue comp → limiter → out
 *          music scores → music bus (volume → duck) ───────────┤
 *          per-bus reverb sends → generated-impulse convolver ─┘
 * No AudioContext exists until unlock(); every call before that is a cheap no-op (music mode is remembered).
 */
import type { AudioApi, MusicMode, UiSound } from '../contracts.ts';
import type { BiomeId } from '../core/biomes.ts';
import type { GameEvent } from '../core/events.ts';
import { clamp } from '../core/math.ts';
import type { GameState, PlayerIndex } from '../core/types.ts';
import { WEAPONS } from '../core/weapons.ts';
import { Loops } from './loops.ts';
import { Music } from './music.ts';
import { Sfx } from './sfx.ts';
import { glide, Synth, type Voice } from './synth.ts';

type Outcome = 'win' | 'lose' | 'draw';

export interface AudioDebugInfo {
  state: AudioContextState | 'none';
  voices: number;
  groups: Record<string, number>;
  loops: number;
  music: string;
  /** Peak absolute sample at the output since the last call (0..1+). */
  peak: number;
}

export class AudioEngine implements AudioApi {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private sfx: Sfx | null = null;
  private music: Music | null = null;
  private loops: Loops | null = null;
  private analyser: AnalyserNode | null = null;
  private peakBuf: Float32Array<ArrayBuffer> | null = null;

  private vol = { master: 0.8, sfx: 0.9, music: 0.45 };
  private ducked = false;
  private wantMusic: MusicMode = 'off';
  private wantBiome: BiomeId = 'verdant';

  /** Smoothed slow-mo pitch factor. */
  private pitch = 1;
  private lowpass = 20000;
  private housekeeping: ReturnType<typeof setInterval> | null = null;
  private lastUpdate = 0;

  // Held voices for long effects.
  private beamVoice: Voice | null = null;
  private voidVoice: Voice | null = null;

  // Rate limiting (AudioContext seconds).
  private lastAt: Record<string, number> = {};
  // CPU aim tick accumulators.
  private aimAngle = Number.NaN;
  private aimPower = Number.NaN;
  private aimAccA = 0;
  private aimAccP = 0;
  private aimCooldown = 0;
  // Stinger de-duplication between roundOver/matchOver and setMusic('victory' | 'defeat').
  private pendingRound: { outcome: Outcome; at: number } | null = null;
  private stingAt = -10;
  private musicStingAt = -10;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const synth = new Synth(this.ctx);
    this.synth = synth;
    this.sfx = new Sfx(synth);
    this.music = new Music(synth);
    this.loops = new Loops(synth);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    synth.output.connect(this.analyser);
    this.applyVolumes(0.02);
    this.applyDuck(0.02);
    // Gentle fade-in from silence.
    synth.master.gain.setValueAtTime(0, this.ctx.currentTime);
    synth.master.gain.setTargetAtTime(this.masterGain(), this.ctx.currentTime + 0.02, 0.15);
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (this.wantMusic !== 'off') this.music.set(this.wantMusic, this.wantBiome);
    // Housekeeping independent of the frame loop: voice cleanup, deferred stingers, idle loops.
    this.housekeeping = setInterval(this.tick, 250);
  }

  // ---- volumes / ducking --------------------------------------------------------------

  /** Perceptual (squared) volume curve; master has a little headroom for the limiter. */
  private masterGain(): number {
    return this.vol.master * this.vol.master * 0.9;
  }

  private applyVolumes(tc = 0.08): void {
    const s = this.synth;
    if (!s) return;
    const now = s.now;
    const sfx = this.vol.sfx * this.vol.sfx;
    const mus = this.vol.music * this.vol.music * 1.8;
    glide(s.master.gain, this.masterGain(), now, tc);
    glide(s.sfxVol.gain, sfx, now, tc);
    glide(s.sfxSendGains[0].gain, sfx, now, tc);
    glide(s.musicVol.gain, mus, now, tc);
    glide(s.musicSendGains[0].gain, mus, now, tc);
  }

  private applyDuck(tc = 0.25): void {
    const s = this.synth;
    if (!s) return;
    const now = s.now;
    const sfx = this.ducked ? 0.32 : 1;
    const mus = this.ducked ? 0.5 : 1;
    glide(s.sfxDuck.gain, sfx, now, tc);
    glide(s.sfxSendGains[1].gain, sfx, now, tc);
    glide(s.musicDuck.gain, mus, now, tc);
    glide(s.musicSendGains[1].gain, mus, now, tc);
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.vol.master = clamp(master, 0, 1);
    this.vol.sfx = clamp(sfx, 0, 1);
    this.vol.music = clamp(music, 0, 1);
    this.applyVolumes();
  }

  setDucked(ducked: boolean): void {
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    this.applyDuck();
  }

  // ---- music ----------------------------------------------------------------------------

  setMusic(mode: MusicMode, biome?: BiomeId): void {
    this.wantMusic = mode;
    if (biome) this.wantBiome = biome;
    if (!this.music || !this.synth) return;
    const sting = mode === 'victory' || mode === 'defeat';
    // If the match stinger just played as SFX, start the score after it without a second intro.
    const skipIntro = sting && this.synth.now - this.stingAt < 3;
    if (sting && !skipIntro) this.musicStingAt = this.synth.now;
    this.music.set(mode, this.wantBiome, skipIntro);
  }

  // ---- UI -------------------------------------------------------------------------------

  ui(sound: UiSound): void {
    if (!this.sfx || !this.synth) return;
    // Hover/tick can fire in bursts (sliders, sweeping the pointer over a list).
    if ((sound === 'hover' || sound === 'tick') && !this.gate(sound, sound === 'hover' ? 0.035 : 0.028)) return;
    this.sfx.ui(sound);
  }

  /** True if at least `interval` seconds passed since the last accepted call with this key. */
  private gate(key: string, interval: number): boolean {
    const now = this.synth ? this.synth.now : 0;
    const last = this.lastAt[key] ?? -1;
    if (now - last < interval) return false;
    this.lastAt[key] = now;
    return true;
  }

  private outcome(winner: PlayerIndex | null, state: GameState): Outcome | null {
    if (state.config.attract) return null;
    if (winner === null) return 'draw';
    const players = state.config.players;
    const humans = (players[0].kind === 'human' ? 1 : 0) + (players[1].kind === 'human' ? 1 : 0);
    if (humans === 1) return players[winner].kind === 'human' ? 'win' : 'lose';
    return humans === 0 ? null : 'win';
  }

  // ---- game events ----------------------------------------------------------------------

  handleEvent(e: GameEvent, state: GameState): void {
    const sfx = this.sfx;
    const synth = this.synth;
    const loops = this.loops;
    if (!sfx || !synth || !loops) return;
    switch (e.type) {
      case 'matchStart':
        break;
      case 'roundStart':
        this.releaseHeld();
        loops.reset();
        this.pendingRound = null;
        if (!state.config.attract) sfx.roundStart();
        break;
      case 'tankLanded':
        sfx.landed(e.x, e.fallDistance, e.intro);
        break;
      case 'turnStart':
        this.aimAngle = Number.NaN;
        this.aimPower = Number.NaN;
        sfx.turnChime(e.player, state.config.players[e.player].kind === 'cpu');
        break;
      case 'weaponSelect':
        if (this.gate('weapon', 0.06)) sfx.weaponSelect();
        break;
      case 'drive':
        sfx.drive(state.tanks[e.player].x, e.moving);
        break;
      case 'fire': {
        const def = WEAPONS[e.weapon];
        // Instant utilities are voiced by their utility/heal/shield events.
        if (!def.instant) sfx.fire(def.sound, e.weapon, e.x, e.power);
        break;
      }
      case 'utility':
        sfx.utility(e.x);
        break;
      case 'split':
        sfx.split(e.x, e.count);
        break;
      case 'bounce':
        sfx.bounce(e.weapon, e.x, e.speed);
        break;
      case 'drill':
        loops.drillFlag = e.phase === 'start';
        loops.drillX = e.x;
        break;
      case 'lockOn':
        sfx.lockOn(e.x);
        break;
      case 'explosion':
        sfx.explosion(e.kind, e.x, e.radius, e.primary);
        break;
      case 'mound':
        sfx.mound(e.x, e.radius);
        break;
      case 'damage':
        if (e.absorbed > 0) sfx.shieldHit(e.x, e.absorbed);
        // Lava/tesla ticks can be rapid: keep the clank readable rather than a machine-gun.
        if (e.amount > 0 && this.gate(e.target === 0 ? 'dmg0' : 'dmg1', 0.11)) sfx.damage(e.x, e.amount, e.weapon === 'fall');
        break;
      case 'heal':
        sfx.heal(e.x);
        break;
      case 'shieldUp':
        sfx.shieldUp(state.tanks[e.target].x);
        break;
      case 'shieldBreak':
        sfx.shieldBreak(e.x);
        break;
      case 'tankDestroyed':
        sfx.tankDestroyed(e.x);
        break;
      case 'lightning':
        if (e.target !== null || this.gate('arc', 0.06)) sfx.lightning(e.x2, e.target !== null);
        break;
      case 'singularity':
        this.voidVoice?.release(e.phase === 'open' ? 0.1 : 0.12);
        this.voidVoice = e.phase === 'open' ? sfx.voidHum(e.x, WEAPONS.singularity.params.duration ?? 1.6) : null;
        break;
      case 'beam':
        if (e.phase === 'mark') {
          sfx.beamMark(e.x, WEAPONS.sunbeam.params.chargeTime ?? 0.9);
        } else {
          this.beamVoice?.release(e.phase === 'fire' ? 0.1 : 0.6);
          this.beamVoice = e.phase === 'fire' ? sfx.beamRoar(e.x) : null;
        }
        break;
      case 'lava':
        if (e.phase === 'spawn') {
          if (this.gate('lavaS', 0.045)) sfx.lavaSpawn(e.x);
        } else if (this.gate('lavaC', 0.09)) sfx.lavaCool(e.x);
        break;
      case 'quake':
        sfx.quake(e.x, e.step);
        break;
      case 'teleport':
        sfx.teleport(e.fromX, false);
        sfx.teleport(e.toX, true);
        break;
      case 'fizzle':
        sfx.fizzle(e.x);
        break;
      case 'crate':
        if (e.phase === 'spawn') sfx.crateSpawn(e.x);
        else if (e.phase === 'land') sfx.crateLand(e.x);
        else sfx.crateCollect(e.x);
        break;
      case 'dirtFall':
        loops.addDirt(e.x0, e.x1, e.amount);
        break;
      case 'outOfBounds':
        sfx.outOfBounds(e.x);
        break;
      case 'turnEnd':
        break;
      case 'roundOver': {
        // Deferred a moment: if the same update also ends the match, the match stinger replaces it.
        const o = this.outcome(e.winner, state);
        this.pendingRound = o ? { outcome: o, at: synth.now } : null;
        break;
      }
      case 'matchOver': {
        this.pendingRound = null;
        const o = this.outcome(e.winner, state);
        if (o && synth.now - this.musicStingAt > 3) {
          sfx.stinger(o, true);
          this.stingAt = synth.now;
        }
        break;
      }
    }
  }

  private releaseHeld(): void {
    this.beamVoice?.release(0.2);
    this.voidVoice?.release(0.2);
    this.beamVoice = null;
    this.voidVoice = null;
  }

  // ---- per frame ------------------------------------------------------------------------

  update(dt: number, state: GameState, timeScale: number): void {
    const synth = this.synth;
    const loops = this.loops;
    if (!synth || !loops) return;
    const now = synth.now;
    this.lastUpdate = now;
    const frameDt = clamp(dt, 0, 0.1);

    // Slow motion (0 < scale < 1): lower the pitch of continuous and new sounds, close a lowpass
    // on the SFX bus. Hit-stop (scale 0) is too brief to bend pitch and is ignored.
    const slow = timeScale > 0 && timeScale < 0.98;
    const targetPitch = slow ? 0.55 + 0.45 * timeScale : 1;
    // dt may be 0 during hit-stop/pause: smooth with a minimum step so recovery still happens.
    const k = 1 - Math.exp(-Math.max(frameDt, 1 / 120) * (slow ? 6 : 3));
    this.pitch += (targetPitch - this.pitch) * k;
    if (Math.abs(this.pitch - 1) < 0.002) this.pitch = 1;
    synth.pitch = this.pitch;
    synth.stretch = 1 / this.pitch;
    const lp = slow ? 700 + 5000 * timeScale * timeScale : 20000;
    if (Math.abs(lp - this.lowpass) > 1) {
      this.lowpass = lp;
      glide(synth.sfxFilter.frequency, lp, now, slow ? 0.12 : 0.35);
    }

    loops.update(Math.max(frameDt, 1 / 120), state, this.pitch);
    this.cpuAim(frameDt, state);
    // Held voices whose hazard is gone (e.g. the sim cleared it without an end event): release.
    if (this.beamVoice && !this.hasHazard(state, 'beam')) { this.beamVoice.release(0.5); this.beamVoice = null; }
    if (this.voidVoice && !this.hasHazard(state, 'singularity')) { this.voidVoice.release(0.15); this.voidVoice = null; }
  }

  private hasHazard(state: GameState, kind: string): boolean {
    for (const h of state.hazards) if (h.kind === kind) return true;
    return false;
  }

  /** Subtle ticks while the CPU sweeps its barrel/power (it "thinks" audibly as well as visibly). */
  private cpuAim(dt: number, state: GameState): void {
    this.aimCooldown -= dt;
    if (!state.cpuThinking || state.phase !== 'aiming') {
      this.aimAngle = Number.NaN;
      return;
    }
    const t = state.tanks[state.activePlayer];
    if (Number.isNaN(this.aimAngle)) {
      this.aimAngle = t.angle;
      this.aimPower = t.power;
      this.aimAccA = 0;
      this.aimAccP = 0;
      return;
    }
    this.aimAccA += Math.abs(t.angle - this.aimAngle);
    this.aimAccP += Math.abs(t.power - this.aimPower);
    this.aimAngle = t.angle;
    this.aimPower = t.power;
    if (this.aimCooldown > 0) return;
    if (this.aimAccA >= 3) {
      this.aimAccA = 0;
      this.aimCooldown = 0.05;
      this.sfx?.aimTick(t.angle, false);
    } else if (this.aimAccP >= 4) {
      this.aimAccP = 0;
      this.aimCooldown = 0.05;
      this.sfx?.aimTick(t.angle, true);
    }
  }

  /** Housekeeping every 250 ms, independent of the frame loop. */
  private tick = (): void => {
    const synth = this.synth;
    if (!synth || !this.sfx || !this.loops) return;
    synth.sweep();
    const now = synth.now;
    if (this.pendingRound && now - this.pendingRound.at > 0.05) {
      this.sfx.stinger(this.pendingRound.outcome, false);
      this.pendingRound = null;
    }
    // The frame loop stopped calling update (menus without a match): let continuous loops fade out.
    if (now - this.lastUpdate > 0.3) {
      this.loops.update(0.25, null, 1);
      if (this.pitch !== 1 || this.lowpass !== 20000) {
        this.pitch = 1;
        synth.pitch = 1;
        synth.stretch = 1;
        this.lowpass = 20000;
        glide(synth.sfxFilter.frequency, 20000, now, 0.3);
      }
    }
  };

  // ---- debug ----------------------------------------------------------------------------

  /** Live diagnostics for the sandbox/QA (voice counts, peak output level). */
  debug(): AudioDebugInfo {
    const groups: Record<string, number> = {};
    for (const g of ['boom', 'small', 'ui', 'tick', 'metal', 'zap', 'chime', 'grain', 'sfx', 'held', 'music']) {
      const n = this.synth ? this.synth.count(g) : 0;
      if (n) groups[g] = n;
    }
    let peak = 0;
    if (this.analyser) {
      if (!this.peakBuf) this.peakBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.analyser.getFloatTimeDomainData(this.peakBuf);
      for (let i = 0; i < this.peakBuf.length; i++) peak = Math.max(peak, Math.abs(this.peakBuf[i]));
    }
    return {
      state: this.ctx ? this.ctx.state : 'none',
      voices: this.synth ? this.synth.count() : 0,
      groups,
      loops: this.loops ? this.loops.liveCount() : 0,
      music: this.music ? this.music.mode : 'off',
      peak,
    };
  }

  /** Stops everything and closes the context. */
  dispose(): void {
    if (this.housekeeping !== null) clearInterval(this.housekeeping);
    this.housekeeping = null;
    this.music?.stop();
    this.loops?.reset();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.synth = null;
    this.sfx = null;
    this.music = null;
    this.loops = null;
  }
}
