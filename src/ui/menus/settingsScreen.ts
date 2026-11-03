/** Settings: audio, graphics, gameplay. Every change applies live through actions.applySettings. */
import type { AimGuide, Quality, Settings } from '../../core/settings.ts';
import { h, header, iconEl, row, segmented, slider, stagger, toggle, type Screen, type ScreenCtx, type Segmented, type Slider, type Toggle } from './dom.ts';
import type { UiIconName } from './iconProvider.ts';

export class SettingsScreen implements Screen {
  readonly id = 'settings' as const;
  readonly el: HTMLElement;
  private readonly ctx: ScreenCtx;
  private readonly sliders: Partial<Record<keyof Settings, Slider>> = {};
  private readonly toggles: Partial<Record<keyof Settings, Toggle>> = {};
  private readonly quality: Segmented<Quality | 'auto'>;
  private readonly aim: Segmented<AimGuide>;
  private readonly name: HTMLInputElement;
  private readonly first: HTMLElement;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const s = ctx.actions.getSettings();
    const snd = ctx.sound.bind(ctx);
    const el = h('section', 'mn-screen mn-settings', { 'aria-label': 'Settings' });
    const head = header('Settings', 'Options', () => ctx.back());

    const sl = (key: 'masterVolume' | 'sfxVolume' | 'musicVolume' | 'screenShake', label: string, hint?: string): HTMLElement => {
      const c = slider(label, s[key], v => this.apply({ [key]: v }), snd);
      this.sliders[key] = c;
      return row(label, c.el, hint);
    };
    const tg = (key: 'postFx' | 'reducedMotion' | 'showFps', label: string, hint?: string): HTMLElement => {
      const c = toggle(label, s[key], v => this.apply({ [key]: v }), snd);
      this.toggles[key] = c;
      return row(label, c.el, hint);
    };

    const masterRow = sl('masterVolume', 'Master volume');
    this.first = masterRow.querySelector('input') as HTMLElement;
    const audio = this.group('Audio', 'sound', masterRow, sl('sfxVolume', 'Sound effects'), sl('musicVolume', 'Music'));

    this.quality = segmented<Quality | 'auto'>('Graphics quality', [
      { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' },
    ], s.quality, v => this.apply({ quality: v }), snd);
    const graphics = this.group('Graphics', 'grid',
      row('Quality', this.quality.el, 'Auto adapts to your frame rate'),
      tg('postFx', 'Post-processing', 'Bloom, distortion and colour grading'),
      sl('screenShake', 'Screen shake'),
      tg('reducedMotion', 'Reduced motion', 'No shake, flashes or slow motion'));

    this.aim = segmented<AimGuide>('Aim guide', [
      { value: 'off', label: 'Off' }, { value: 'short', label: 'Short' }, { value: 'full', label: 'Full' },
    ], s.aimGuide, v => this.apply({ aimGuide: v }), snd);
    this.name = h('input', 'mn-input mn-input--sm', { type: 'text', maxlength: 16, 'aria-label': 'Player name', spellcheck: 'false', autocomplete: 'off' });
    this.name.addEventListener('change', () => {
      const v = this.name.value.trim().slice(0, 16);
      if (v) this.apply({ playerName: v });
      else this.name.value = ctx.actions.getSettings().playerName;
    });
    this.name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.name.blur(); } });
    const gameplay = this.group('Gameplay', 'fire',
      row('Aim guide', this.aim.el, 'Trajectory preview while aiming'),
      tg('showFps', 'Show FPS'),
      row('Player name', this.name, 'Used in solo matches'));

    el.append(h('div', 'mn-scroll', null, h('div', 'mn-settings__inner', null, head,
      h('div', 'mn-settings__cols', null, h('div', 'mn-settings__col', null, audio, gameplay), h('div', 'mn-settings__col', null, graphics)))));
    stagger(el);
    this.el = el;
  }

  private group(title: string, ico: UiIconName, ...rows: HTMLElement[]): HTMLElement {
    return h('div', 'mn-panel mn-group', null,
      h('h3', 'mn-panel__title st', null, iconEl(ico, 'mn-panel__ico'), title), ...rows);
  }

  private apply(patch: Partial<Settings>): void {
    this.ctx.actions.applySettings({ ...this.ctx.actions.getSettings(), ...patch });
  }

  enter(): void {
    // Re-read: settings can change elsewhere (name in setup, quality from the shell).
    const s = this.ctx.actions.getSettings();
    for (const k in this.sliders) this.sliders[k as keyof Settings]?.set(s[k as 'masterVolume']);
    for (const k in this.toggles) this.toggles[k as keyof Settings]?.set(s[k as 'postFx']);
    this.quality.set(s.quality);
    this.aim.set(s.aimGuide);
    this.name.value = s.playerName;
  }

  initialFocus(): HTMLElement {
    return this.first;
  }
}
