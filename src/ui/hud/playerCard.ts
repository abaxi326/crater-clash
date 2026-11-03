/** Top-corner player card: identity, HP with damage chip + counting number, shield, round pips, fuel. */
import { FUEL_PER_ROUND } from '../../core/constants.ts';
import { damp } from '../../core/math.ts';
import { TEAMS } from '../../core/teams.ts';
import type { GameState, PlayerIndex } from '../../core/types.ts';
import { UI_ICONS } from '../icons.ts';
import { ClassSlot, StyleSlot, TextSlot, el, f3, retrigger } from './dom.ts';

/** Seconds the white damage chip lingers before draining. */
const CHIP_HOLD = 0.6;

export class PlayerCard {
  readonly root: HTMLElement;
  private index: PlayerIndex;
  private name: TextSlot;
  private badge: HTMLElement;
  private avatar: HTMLElement;
  private pips: HTMLElement;
  private pipEls: HTMLElement[] = [];
  private fill: StyleSlot;
  private chip: StyleSlot;
  private shieldBar: StyleSlot;
  private hpNum: TextSlot;
  private shieldNum: TextSlot;
  private fuelBar: StyleSlot;
  private activeSlot: ClassSlot;
  private lowSlot: ClassSlot;
  private deadSlot: ClassSlot;
  private shieldSlot: ClassSlot;
  private fuelLowSlot: ClassSlot;
  private hpEl: HTMLElement;

  // Animated values (fractions of max HP).
  private shown = 1;
  private chipV = 1;
  private chipHold = 0;
  private num = 100;
  private lastHp = -1;
  private shieldShown = 0;
  private wins = -1;
  private pipCount = -1;

  constructor(index: PlayerIndex, parent: HTMLElement) {
    this.index = index;
    const team = TEAMS[index];
    const r = el('div', `cc-card cc-card--p${index}`, '', parent);
    r.style.setProperty('--tc', `var(${team.cssVar})`);
    r.style.setProperty('--tc-light', `var(${team.cssVar}-light)`);
    r.style.setProperty('--tc-dark', `var(${team.cssVar}-dark)`);
    this.root = r;
    el('div', 'cc-card__glow', '', r);
    const top = el('div', 'cc-card__top', '', r);
    this.avatar = el('div', 'cc-card__avatar', UI_ICONS.user, top);
    const id = el('div', 'cc-card__id', '', top);
    this.name = new TextSlot(el('div', 'cc-card__name', '', id));
    this.badge = el('div', 'cc-badge', '', id);
    this.pips = el('div', 'cc-pips', '', top);

    const hp = el('div', 'cc-hp', '', r);
    this.hpEl = hp;
    const track = el('div', 'cc-hp__track', '', hp);
    const chip = el('div', 'cc-hp__chip', '', track);
    const fill = el('div', 'cc-hp__fill', '', track);
    el('div', 'cc-hp__ticks', '', track);
    const shield = el('div', 'cc-hp__shield', '', track);
    const nums = el('div', 'cc-hp__nums tabular', '', hp);
    this.hpNum = new TextSlot(el('span', 'cc-hp__num', '100', nums));
    const sh = el('span', 'cc-hp__sh', UI_ICONS.shield, nums);
    this.shieldNum = new TextSlot(el('span', '', '', sh));

    const meta = el('div', 'cc-card__meta', '', r);
    el('span', 'cc-fuel__ico', UI_ICONS.fuel, meta);
    const fuelTrack = el('div', 'cc-fuel', '', meta);
    const fuelFill = el('div', 'cc-fuel__fill', '', fuelTrack);

    this.fill = new StyleSlot(fill, 'transform');
    this.chip = new StyleSlot(chip, 'transform');
    this.shieldBar = new StyleSlot(shield, 'transform');
    this.fuelBar = new StyleSlot(fuelFill, 'transform');
    this.activeSlot = new ClassSlot(r, 'is-active');
    this.lowSlot = new ClassSlot(r, 'is-low');
    this.deadSlot = new ClassSlot(r, 'is-dead');
    this.shieldSlot = new ClassSlot(r, 'has-shield');
    this.fuelLowSlot = new ClassSlot(meta, 'is-low');
  }

  /** Snap all animated values (round/match start). */
  reset(state: GameState): void {
    const p = state.config.players[this.index];
    const t = state.tanks[this.index];
    this.name.set(p.name);
    const cpu = p.kind === 'cpu';
    this.avatar.innerHTML = cpu ? UI_ICONS.cpu : UI_ICONS.user;
    this.badge.textContent = cpu ? `CPU · ${p.difficulty}` : TEAMS[this.index].name;
    this.badge.classList.toggle('is-cpu', cpu);
    const f = t.maxHp > 0 ? t.hp / t.maxHp : 0;
    this.shown = this.chipV = f;
    this.chipHold = 0;
    this.num = t.hp;
    this.lastHp = t.hp;
    this.shieldShown = t.shield / Math.max(1, t.maxHp);
    this.wins = -1;
    this.pipCount = -1;
    this.apply(t.maxHp);
    this.update(state, 0);
  }

  /** Damage event: shake and let the chip linger. */
  hit(heavy: boolean): void {
    retrigger(this.root, heavy ? 'is-hit-heavy' : 'is-hit');
  }

  heal(): void {
    retrigger(this.hpEl, 'is-heal');
  }

  update(state: GameState, dt: number): void {
    const t = state.tanks[this.index];
    const max = Math.max(1, t.maxHp);
    const target = Math.max(0, t.hp) / max;

    if (t.hp !== this.lastHp) {
      if (t.hp < this.lastHp) {
        // Keep the chip where the bar was before this hit; restart the hold.
        this.chipV = Math.max(this.chipV, this.shown);
        this.chipHold = CHIP_HOLD;
      } else {
        this.chipV = target;
      }
      this.lastHp = t.hp;
    }
    this.shown = damp(this.shown, target, 16, dt);
    if (Math.abs(this.shown - target) < 0.001) this.shown = target;
    if (this.chipHold > 0) this.chipHold -= dt;
    else this.chipV = damp(this.chipV, this.shown, 5, dt);
    if (this.chipV < this.shown) this.chipV = this.shown;
    this.num = damp(this.num, Math.max(0, t.hp), 9, dt);
    if (Math.abs(this.num - t.hp) < 0.5) this.num = Math.max(0, t.hp);
    this.shieldShown = damp(this.shieldShown, t.shield / max, 12, dt);
    if (Math.abs(this.shieldShown - t.shield / max) < 0.002) this.shieldShown = t.shield / max;
    this.apply(max);

    this.shieldNum.set(t.shield > 0 ? String(Math.ceil(t.shield)) : '');
    this.shieldSlot.set(t.shield > 0);
    const fuel = Math.max(0, Math.min(1, t.fuel / FUEL_PER_ROUND));
    this.fuelBar.set(`scaleX(${f3(fuel)})`);
    this.fuelLowSlot.set(fuel < 0.2);
    const active = (state.phase === 'aiming' || state.phase === 'flight' || state.phase === 'settle') && state.activePlayer === this.index;
    this.activeSlot.set(active);
    this.lowSlot.set(t.alive && t.hp > 0 && target <= 0.25);
    this.deadSlot.set(!t.alive);

    const need = Math.max(1, state.config.roundsToWin);
    if (need !== this.pipCount) {
      this.pipCount = need;
      this.pips.innerHTML = '';
      this.pipEls.length = 0;
      for (let i = 0; i < need; i++) this.pipEls.push(el('span', 'cc-pip', '', this.pips));
      this.pips.hidden = need <= 1 && state.config.attract;
      this.wins = -1;
    }
    const w = state.wins[this.index];
    if (w !== this.wins) {
      const gained = this.wins >= 0 && w > this.wins;
      this.wins = w;
      for (let i = 0; i < this.pipEls.length; i++) {
        const on = i < w;
        this.pipEls[i].classList.toggle('is-on', on);
        if (gained && i === w - 1) retrigger(this.pipEls[i], 'is-new');
      }
    }
  }

  private apply(max: number): void {
    this.fill.set(`scaleX(${f3(this.shown)})`);
    this.chip.set(`scaleX(${f3(this.chipV)})`);
    this.shieldBar.set(`scaleX(${f3(Math.min(1, this.shieldShown))})`);
    this.hpNum.set(String(Math.ceil(Math.min(this.num, max))));
  }
}
