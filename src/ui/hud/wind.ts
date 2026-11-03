/** Top-centre wind gauge + round/turn label. Flowing streaks inside a pill, colour-coded by strength. */
import { BIOMES } from '../../core/biomes.ts';
import { MAX_WIND } from '../../core/constants.ts';
import { damp } from '../../core/math.ts';
import type { GameState } from '../../core/types.ts';
import { UI_ICONS } from '../icons.ts';
import { ClassSlot, StyleSlot, TextSlot, el, f3, retrigger } from './dom.ts';

const ARROW = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5 10.5 12 5 17.5"/><path d="M12.5 6.5 18 12l-5.5 5.5"/></svg>`;

const level = (w: number): number => {
  const a = Math.abs(w);
  return a < 0.05 ? 0 : a < 2.5 ? 1 : a < 5.5 ? 2 : a < 8 ? 3 : 4;
};

export class WindGauge {
  readonly root: HTMLElement;
  private label: TextSlot;
  private pill: HTMLElement;
  private value: TextSlot;
  private meterL: StyleSlot;
  private meterR: StyleSlot;
  private speed: StyleSlot;
  private dirSlot: ClassSlot;
  private calmSlot: ClassSlot;
  private noneSlot: ClassSlot;
  private lvl = -1;
  private shown = 0;
  private lastWind = NaN;

  constructor(parent: HTMLElement) {
    const r = el('div', 'cc-top', '', parent);
    this.root = r;
    this.label = new TextSlot(el('div', 'cc-top__label', '', r));
    const pill = el('div', 'cc-wind glass', '', r);
    this.pill = pill;
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-label', 'Wind');
    const streaks = el('div', 'cc-wind__streaks', '', pill);
    el('span', 'cc-wind__s cc-wind__s--a', '', streaks);
    el('span', 'cc-wind__s cc-wind__s--b', '', streaks);
    el('span', 'cc-wind__s cc-wind__s--c', '', streaks);
    el('span', 'cc-wind__arrow cc-wind__arrow--l', ARROW, pill);
    const mid = el('div', 'cc-wind__mid', '', pill);
    el('span', 'cc-wind__ico', UI_ICONS.wind, mid);
    this.value = new TextSlot(el('span', 'cc-wind__val tabular', '0.0', mid));
    el('span', 'cc-wind__arrow cc-wind__arrow--r', ARROW, pill);
    const meter = el('div', 'cc-wind__meter', '', pill);
    const ml = el('span', 'cc-wind__bar cc-wind__bar--l', '', meter);
    const mr = el('span', 'cc-wind__bar cc-wind__bar--r', '', meter);
    this.meterL = new StyleSlot(ml, 'transform');
    this.meterR = new StyleSlot(mr, 'transform');
    this.speed = new StyleSlot(pill, '--wind-dur');
    this.dirSlot = new ClassSlot(pill, 'is-left');
    this.calmSlot = new ClassSlot(pill, 'is-calm');
    this.noneSlot = new ClassSlot(pill, 'is-none');
  }

  reset(state: GameState): void {
    this.shown = state.wind;
    this.lastWind = NaN;
    this.update(state, 0);
  }

  /** turnStart: flash when the wind changed. */
  changed(wind: number, previous: number): void {
    if (Math.abs(wind - previous) < 0.05) return;
    retrigger(this.pill, 'is-changed');
  }

  update(state: GameState, dt: number): void {
    const none = (BIOMES[state.biome]?.windScale ?? 1) === 0;
    this.noneSlot.set(none);
    const w = state.wind;
    // The readout rolls toward the new value instead of snapping (reads as "the wind shifted").
    this.shown = dt > 0 ? damp(this.shown, w, 6, dt) : w;
    if (Math.abs(this.shown - w) < 0.05) this.shown = w;
    const s = this.shown;
    const a = Math.abs(s);
    this.value.set(none ? 'NO WIND' : a.toFixed(1));
    const frac = Math.min(1, a / MAX_WIND);
    this.meterL.set(`scaleX(${f3(s < 0 ? frac : 0)})`);
    this.meterR.set(`scaleX(${f3(s > 0 ? frac : 0)})`);
    if (w !== this.lastWind) {
      this.lastWind = w;
      const lv = none ? 0 : level(w);
      if (lv !== this.lvl) {
        this.lvl = lv;
        this.pill.dataset.level = String(lv);
      }
      this.dirSlot.set(w < 0);
      this.calmSlot.set(lv === 0);
      // Streak speed: ~2.4 s per sweep in a breeze down to ~0.45 s in a gale.
      this.speed.set(`${f3(2.6 - 2.15 * Math.min(1, Math.abs(w) / MAX_WIND))}s`);
    }
    const phase = state.phase;
    const round = `Round ${state.round}`;
    this.label.set(phase === 'intro' || phase === 'roundOver' || phase === 'matchOver' ? round : `${round}  ·  Turn ${state.turn}`);
  }
}
