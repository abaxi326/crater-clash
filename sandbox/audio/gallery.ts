/**
 * Offline gallery: renders every recipe through the real Synth graph with an OfflineAudioContext,
 * then draws waveform + log-frequency spectrogram and reports peak / RMS / audible length, so the
 * sounds can be inspected (and balanced) without listening.
 */
import { Sfx } from '../../src/audio/sfx.ts';
import { Synth } from '../../src/audio/synth.ts';
import { Music } from '../../src/audio/music.ts';
import { WEAPONS, type ExplosionKind, type WeaponId } from '../../src/core/weapons.ts';
import type { BiomeId } from '../../src/core/biomes.ts';
import type { MusicMode, UiSound } from '../../src/contracts.ts';

const SR = 44100;
type Recipe = [name: string, seconds: number, play: (sfx: Sfx, synth: Synth) => void];

const fire = (w: WeaponId): Recipe => [`fire ${w}`, 1.6, s => s.fire(WEAPONS[w].sound, w, 960, 80)];
const boom = (k: ExplosionKind, r: number, primary = true): Recipe => [`boom ${k} r${r}`, k === 'heavy' || k === 'void' ? 3.2 : 2.4, s => s.explosion(k, 960, r, primary)];
const ui = (u: UiSound): Recipe => [`ui ${u}`, 0.8, s => s.ui(u)];
const music = (m: MusicMode, b?: BiomeId): Recipe => [`music ${m}${b ? ' ' + b : ''}`, 12, (_s, synth) => {
  const mu = new Music(synth);
  mu.set(m, b);
  mu.prerender(synth.now + 12);
}];

const RECIPES: Recipe[] = [
  ...(['ember', 'thunderhead', 'trident', 'starfall', 'skipper', 'ricochet', 'burrower', 'seeker', 'magma', 'tesla',
    'singularity', 'sunbeam', 'earthmaker', 'faultline', 'fireworks', 'blink'] as WeaponId[]).map(fire),
  boom('standard', 42), boom('heavy', 78), boom('small', 24), boom('small', 18, false), boom('electric', 26),
  boom('fire', 30), boom('void', 50), boom('beam', 26), boom('dirt', 60), boom('firework', 28),
  ['split', 1.2, s => s.split(960, 9)],
  ['bounce skipper', 0.8, s => s.bounce('skipper', 960, 420)],
  ['ricochet ting', 1.0, s => s.bounce('ricochet', 960, 520)],
  ['lockOn', 0.8, s => s.lockOn(960)],
  ['lightning strike', 1.2, s => s.lightning(960, true)],
  ['ground arc', 0.8, s => s.lightning(960, false)],
  ['landed intro', 1.0, s => s.landed(960, 260, true)],
  ['damage 30', 1.0, s => s.damage(960, 30, false)],
  ['shield hit', 1.0, s => s.shieldHit(960, 20)],
  ['shield up', 1.6, s => s.shieldUp(960)],
  ['shield break', 1.2, s => s.shieldBreak(960)],
  ['heal', 1.8, s => s.heal(960)],
  ['utility', 0.8, s => s.utility(960)],
  ['teleport out+in', 1.2, s => { s.teleport(700, false); s.teleport(1200, true); }],
  ['fizzle', 1.0, s => s.fizzle(960)],
  ['mound', 2.0, s => s.mound(960, 92)],
  ['quake step', 1.2, s => s.quake(960, 1)],
  ['lava spawn', 0.8, s => s.lavaSpawn(960)],
  ['lava cool', 1.0, s => s.lavaCool(960)],
  ['tank destroyed', 3.0, s => s.tankDestroyed(960)],
  ['crate spawn', 2.2, s => s.crateSpawn(960)],
  ['crate land', 0.8, s => s.crateLand(960)],
  ['crate collect', 1.2, s => s.crateCollect(960)],
  ['beam mark', 1.4, s => s.beamMark(960, 0.9)],
  ['beam roar 0.75s', 1.8, (s, synth) => { const v = s.beamRoar(960); v.release(0.6, synth.now + 0.75); }],
  ['void hum 1.6s', 2.4, (s, synth) => { const v = s.voidHum(960, 1.6); v.release(0.12, synth.now + 1.6); }],
  ['turn chime P1', 1.6, s => s.turnChime(0, false)],
  ['turn chime P2', 1.6, s => s.turnChime(1, true)],
  ['aim tick', 0.3, s => s.aimTick(90, false)],
  ['weapon select', 0.6, s => s.weaponSelect()],
  ['drive start', 0.8, s => s.drive(960, true)],
  ['drive stop', 0.8, s => s.drive(960, false)],
  ['round start', 2.4, s => s.roundStart()],
  ['round win', 2.4, s => s.stinger('win', false)],
  ['match win', 3.4, s => s.stinger('win', true)],
  ['round lose', 2.6, s => s.stinger('lose', false)],
  ['match lose', 3.4, s => s.stinger('lose', true)],
  ['draw', 2.0, s => s.stinger('draw', false)],
  ...(['click', 'hover', 'select', 'back', 'tick', 'error', 'start', 'toggle', 'open', 'close', 'confirm'] as UiSound[]).map(ui),
  music('menu'), music('battle', 'verdant'), music('battle', 'dunes'), music('battle', 'frost'), music('battle', 'cinder'),
  music('battle', 'lunar'), music('victory'), music('defeat'),
];

// ---------------------------------------------------------------------------------------------
// Rendering + analysis
// ---------------------------------------------------------------------------------------------

async function render(r: Recipe): Promise<AudioBuffer> {
  // 0.4 s pre-roll: Chrome's compressors start in a gain-reduced state, which would make the first
  // sound unrepresentatively quiet. The recipe is triggered after it, and the pre-roll is cropped.
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (r[1] + PRE)), SR);
  const synth = new Synth(ctx);
  // Default in-game volumes (see AudioEngine.applyVolumes).
  synth.master.gain.value = 0.8 * 0.8 * 0.9;
  synth.sfxVol.gain.value = synth.sfxSendGains[0].gain.value = 0.81;
  synth.musicVol.gain.value = synth.musicSendGains[0].gain.value = 0.45 * 0.45 * 1.8;
  const sfx = new Sfx(synth);
  void ctx.suspend(PRE).then(() => { r[2](sfx, synth); void ctx.resume(); });
  const full = await ctx.startRendering();
  const out = new AudioBuffer({ numberOfChannels: 2, length: full.length - Math.floor(PRE * SR), sampleRate: SR });
  for (let c = 0; c < 2; c++) out.copyToChannel(full.getChannelData(c).subarray(Math.floor(PRE * SR)), c);
  return out;
}
const PRE = 0.4;

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
}

interface Stats { peak: number; rmsDb: number; audible: number; nan: boolean }

function analyse(buf: AudioBuffer): Stats {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, sum = 0, n = 0, lastLoud = 0, nan = false;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (Number.isNaN(a)) nan = true;
    if (a > peak) peak = a;
    if (a > 0.003) { lastLoud = i; sum += L[i] * L[i] + R[i] * R[i]; n += 2; }
  }
  return { peak, rmsDb: n ? 10 * Math.log10(sum / n) : -120, audible: lastLoud / SR, nan };
}

function draw(buf: AudioBuffer, canvas: HTMLCanvasElement): void {
  const W = canvas.width, H = canvas.height, WH = 46;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#070b16';
  g.fillRect(0, 0, W, H);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // Waveform (min/max per column), L in azure, R in blaze.
  for (const [data, col] of [[L, 'rgba(63,193,255,0.8)'], [R, 'rgba(255,116,72,0.55)']] as const) {
    g.fillStyle = col;
    const per = data.length / W;
    for (let x = 0; x < W; x++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      g.fillRect(x, WH / 2 - hi * WH / 2, 1, Math.max(1, (hi - lo) * WH / 2));
    }
  }
  // Spectrogram: 1024-pt FFT, log frequency 30 Hz..20 kHz.
  const N = 1024, top = WH + 2, SH = H - top;
  const frames = W;
  const hop = Math.max(1, Math.floor((L.length - N) / frames));
  const re = new Float32Array(N), im = new Float32Array(N);
  const img = g.createImageData(W, SH);
  for (let x = 0; x < frames; x++) {
    const off = x * hop;
    for (let i = 0; i < N; i++) {
      const wv = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re[i] = ((L[off + i] ?? 0) + (R[off + i] ?? 0)) * 0.5 * wv;
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < SH; y++) {
      const f = 30 * Math.pow(20000 / 30, 1 - y / SH);
      const bin = Math.min(N / 2 - 1, Math.round((f / SR) * N));
      const mag = Math.hypot(re[bin], im[bin]);
      const db = 20 * Math.log10(mag + 1e-9);
      const t = Math.max(0, Math.min(1, (db + 25) / 65));
      const o = (y * W + x) * 4;
      img.data[o] = 255 * Math.min(1, t * 1.8);
      img.data[o + 1] = 255 * Math.max(0, t * 1.6 - 0.5);
      img.data[o + 2] = 90 + 160 * Math.max(0, t - 0.6) - 60 * t;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, top);
}

async function main(): Promise<void> {
  const grid = document.getElementById('grid') as HTMLElement;
  const info = document.getElementById('info') as HTMLElement;
  const only = new URLSearchParams(location.search).get('only');
  const list = only ? RECIPES.filter(r => r[0].includes(only)) : RECIPES;
  const report: Record<string, Stats> = {};
  for (const r of list) {
    const buf = await render(r);
    const st = analyse(buf);
    report[r[0]] = st;
    const fig = document.createElement('figure');
    const hot = st.peak > 0.99 || st.nan;
    fig.innerHTML = `<figcaption><b>${r[0]}</b><span class="${hot ? 'hot' : ''}">pk ${st.peak.toFixed(2)} · ${st.rmsDb.toFixed(0)} dB · ${st.audible.toFixed(2)}s</span></figcaption>`;
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 150;
    fig.appendChild(c);
    grid.appendChild(fig);
    draw(buf, c);
  }
  info.textContent = `${list.length} renders done`;
  (window as unknown as Record<string, unknown>).__report = report;
}

void main();

// Ignore Vite full reloads caused by other modules changing (long offline render in progress).
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', (payload: { path?: string }) => { payload.path = '/__audio-gallery-pinned__.html'; });
}
