/** Player-facing settings, persisted in localStorage. */

export type Quality = 'low' | 'medium' | 'high';
export type AimGuide = 'off' | 'short' | 'full';

export interface Settings {
  masterVolume: number;   // 0..1
  sfxVolume: number;      // 0..1
  musicVolume: number;    // 0..1
  /** 'auto' adapts to measured frame rate. */
  quality: Quality | 'auto';
  /** WebGL bloom/distortion/grade pass. */
  postFx: boolean;
  /** Camera shake multiplier 0..1. */
  screenShake: number;
  /** Disables shake, flashes, slow-mo and heavy camera moves. */
  reducedMotion: boolean;
  /** Trajectory preview length while aiming. */
  aimGuide: AimGuide;
  showFps: boolean;
  /** Name shown for player 1 in solo games. */
  playerName: string;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.45,
  quality: 'auto',
  postFx: true,
  screenShake: 1,
  reducedMotion: false,
  aimGuide: 'short',
  showFps: false,
  playerName: 'You',
};

const KEY = 'crater-clash:settings:v1';

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;

export function sanitizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS;
  const quality = raw.quality;
  const aim = raw.aimGuide;
  const name = typeof raw.playerName === 'string' ? raw.playerName.trim().slice(0, 16) : '';
  return {
    masterVolume: unit(raw.masterVolume, d.masterVolume),
    sfxVolume: unit(raw.sfxVolume, d.sfxVolume),
    musicVolume: unit(raw.musicVolume, d.musicVolume),
    quality: quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'auto' ? quality : d.quality,
    postFx: typeof raw.postFx === 'boolean' ? raw.postFx : d.postFx,
    screenShake: unit(raw.screenShake, d.screenShake),
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : d.reducedMotion,
    aimGuide: aim === 'off' || aim === 'short' || aim === 'full' ? aim : d.aimGuide,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : d.showFps,
    playerName: name || d.playerName,
  };
}

export function loadSettings(): Settings {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    const base = stored ? sanitizeSettings(JSON.parse(stored)) : { ...DEFAULT_SETTINGS };
    if (!stored && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) base.reducedMotion = true;
    return base;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}
