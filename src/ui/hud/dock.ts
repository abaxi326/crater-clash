/**
 * Bottom glass dock: weapon selector, angle dial, power bar, drive pad with fuel and the FIRE button.
 * All values are diffed; hold-to-repeat buttons are advanced from update().
 */
import type { GameApi, UiActions } from '../../contracts.ts';
import { FUEL_PER_ROUND } from '../../core/constants.ts';
import { clamp } from '../../core/math.ts';
import { TEAMS } from '../../core/teams.ts';
import type { GameState, PlayerIndex } from '../../core/types.ts';
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';
import { UI_ICONS, weaponIcon } from '../icons.ts';
import { ClassSlot, HoldRepeat, StyleSlot, TextSlot, button, el, f3, retrigger } from './dom.ts';

const MINUS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>`;
const PLUS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>`;
const DIAL = `<svg class="cc-dial__arc" viewBox="0 0 48 28" aria-hidden="true"><path d="M4 25a20 20 0 0 1 40 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1.2 3.06" stroke-linecap="round" opacity="0.55"/><path d="M24 25h-21M24 25h21" stroke="currentColor" stroke-width="1" opacity="0.25"/></svg>`;

export interface DockCallbacks {
  togglePicker(): void;
}

export class Dock {
  readonly root: HTMLElement;
  private actions: UiActions;
  private cb: DockCallbacks;
  private game: GameApi | null = null;

  private wIcon: HTMLElement;
  private wName: TextSlot;
  private wAmmo: TextSlot;
  private wBtn: HTMLButtonElement;
  private weapon: WeaponId | null = null;
  private angleTxt: TextSlot;
  private needle: StyleSlot;
  private powerTxt: TextSlot;
  private powerFill: StyleSlot;
  private powerKnob: StyleSlot;
  private powerMark: StyleSlot;
  private powerMarkOn: ClassSlot;
  private powerBar: HTMLElement;
  private fuelFill: StyleSlot;
  private fuelLow: ClassSlot;
  private fireBtn: HTMLButtonElement;
  private status: HTMLElement;
  private statusTxt: TextSlot;
  private statusIco: HTMLElement;
  private statusKind = '';
  private lockedSlot: ClassSlot;
  private readySlot: ClassSlot;
  private statusSlot: ClassSlot;
  private movingL: ClassSlot;
  private movingR: ClassSlot;
  private repeats: HoldRepeat[] = [];
  private controls: HTMLButtonElement[] = [];
  private enabled: boolean | null = null;
  private team: PlayerIndex | -1 = -1;
  private lastPower: [number, number] = [-1, -1];
  private dragId = -1;
  private ariaPower = -1;
  private dragLeft = 0;
  private dragWidth = 1;
  private driveDir: -1 | 0 | 1 = 0;
  private drivePointer = -1;

  constructor(parent: HTMLElement, actions: UiActions, cb: DockCallbacks) {
    this.actions = actions;
    this.cb = cb;
    const r = el('div', 'cc-dock', '', parent);
    this.root = r;
    const panel = el('div', 'cc-dock__panel glass', '', r);
    // Mouse/touch presses must not move focus onto dock buttons: Space/Enter should keep firing.
    panel.addEventListener('mousedown', e => e.preventDefault());

    // --- Weapon selector
    const wg = el('div', 'cc-grp cc-weapon', '', panel);
    const prev = button('cc-ibtn cc-weapon__step', UI_ICONS.left, 'Previous weapon (Q)', wg);
    this.wBtn = button('cc-weapon__btn', '', 'Choose weapon (Tab)', wg);
    this.wIcon = el('span', 'cc-weapon__icon', '', this.wBtn);
    const wText = el('span', 'cc-weapon__text', '', this.wBtn);
    this.wName = new TextSlot(el('span', 'cc-weapon__name', '', wText));
    const ammoRow = el('span', 'cc-weapon__ammo tabular', '', wText);
    this.wAmmo = new TextSlot(el('span', '', '', ammoRow));
    el('span', 'cc-weapon__grid', UI_ICONS.grid, this.wBtn);
    const next = button('cc-ibtn cc-weapon__step', UI_ICONS.right, 'Next weapon (E)', wg);
    prev.addEventListener('click', () => this.cycle(-1));
    next.addEventListener('click', () => this.cycle(1));
    this.wBtn.addEventListener('click', () => this.cb.togglePicker());
    this.controls.push(prev, next, this.wBtn);

    // --- Angle
    const ag = el('div', 'cc-grp cc-angle', '', panel);
    const aMinus = button('cc-ibtn cc-sbtn', MINUS, 'Angle right (→)', ag);
    const aMid = el('div', 'cc-angle__mid', '', ag);
    const dial = el('div', 'cc-dial', DIAL, aMid);
    const needle = el('div', 'cc-dial__needle', '', dial);
    const aText = el('div', 'cc-readout', '', aMid);
    el('span', 'cc-readout__label', 'Angle', aText);
    this.angleTxt = new TextSlot(el('span', 'cc-readout__val tabular', '45.0°', aText));
    const aPlus = button('cc-ibtn cc-sbtn', PLUS, 'Angle left (←)', ag);
    this.needle = new StyleSlot(needle, 'transform');
    this.repeats.push(new HoldRepeat(aMinus, n => this.adjust(true, -n)), new HoldRepeat(aPlus, n => this.adjust(true, n)));
    this.controls.push(aMinus, aPlus);

    // --- Power
    const pg = el('div', 'cc-grp cc-power', '', panel);
    const pMinus = button('cc-ibtn cc-sbtn', MINUS, 'Less power (↓)', pg);
    const pMid = el('div', 'cc-power__mid', '', pg);
    const pText = el('div', 'cc-readout cc-readout--row', '', pMid);
    el('span', 'cc-readout__label', 'Power', pText);
    this.powerTxt = new TextSlot(el('span', 'cc-readout__val tabular', '50', pText));
    const bar = el('div', 'cc-pbar', '', pMid);
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Power');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    this.powerBar = bar;
    const fillWrap = el('div', 'cc-pbar__track', '', bar);
    el('div', 'cc-pbar__fill', '', fillWrap);
    const cover = el('div', 'cc-pbar__cover', '', fillWrap);
    const markRail = el('div', 'cc-pbar__rail', '', bar);
    const mark = el('div', 'cc-pbar__mark', '', markRail);
    mark.title = 'Last shot';
    const knobRail = el('div', 'cc-pbar__rail', '', bar);
    el('div', 'cc-pbar__knob', '', knobRail);
    const pPlus = button('cc-ibtn cc-sbtn', PLUS, 'More power (↑)', pg);
    this.powerFill = new StyleSlot(cover, 'transform');
    this.powerKnob = new StyleSlot(knobRail, 'transform');
    this.powerMark = new StyleSlot(markRail, 'transform');
    this.powerMarkOn = new ClassSlot(mark, 'is-on');
    this.repeats.push(new HoldRepeat(pMinus, n => this.adjust(false, -n)), new HoldRepeat(pPlus, n => this.adjust(false, n)));
    this.controls.push(pMinus, pPlus);
    bar.addEventListener('pointerdown', this.barDown);
    bar.addEventListener('pointermove', this.barMove);
    bar.addEventListener('pointerup', this.barUp);
    bar.addEventListener('pointercancel', this.barUp);
    bar.addEventListener('lostpointercapture', this.barUp);

    // --- Drive
    const dg = el('div', 'cc-grp cc-drive', '', panel);
    const dl = button('cc-ibtn cc-drive__btn', UI_ICONS.left, 'Drive left (A)', dg);
    const fuel = el('div', 'cc-drive__fuel', '', dg);
    el('span', 'cc-drive__ico', UI_ICONS.fuel, fuel);
    const ft = el('div', 'cc-drive__track', '', fuel);
    const ff = el('div', 'cc-drive__fill', '', ft);
    const dr = button('cc-ibtn cc-drive__btn', UI_ICONS.right, 'Drive right (D)', dg);
    this.fuelFill = new StyleSlot(ff, 'transform');
    this.fuelLow = new ClassSlot(fuel, 'is-low');
    this.movingL = new ClassSlot(dl, 'is-on');
    this.movingR = new ClassSlot(dr, 'is-on');
    this.bindDrive(dl, -1);
    this.bindDrive(dr, 1);
    this.controls.push(dl, dr);

    // --- Fire
    this.fireBtn = button('cc-fire', `<span class="cc-fire__ring"></span><span class="cc-fire__core">${UI_ICONS.fire}<span class="cc-fire__txt">Fire</span></span>`, 'Fire (Space)', panel);
    this.fireBtn.addEventListener('click', () => this.fire());
    this.controls.push(this.fireBtn);

    // --- Status shown when the dock is locked (CPU turn / other player).
    this.status = el('div', 'cc-dock__status glass', '', r);
    this.statusIco = el('span', 'cc-dock__status-ico', '', this.status);
    this.statusTxt = new TextSlot(el('span', 'cc-dock__status-txt', '', this.status));
    el('span', 'cc-dots', '<i></i><i></i><i></i>', this.status);

    this.lockedSlot = new ClassSlot(r, 'is-locked');
    this.readySlot = new ClassSlot(r, 'is-ready');
    this.statusSlot = new ClassSlot(r, 'has-status');
  }

  // ------------------------------------------------------------------------------------------
  // Control handlers

  private canAct(): boolean {
    return this.game !== null && this.game.canControl();
  }

  private cycle(dir: 1 | -1): void {
    if (!this.canAct()) return;
    this.game!.cycleWeapon(dir);
    this.actions.uiSound('select');
  }

  private adjust(angle: boolean, steps: number): void {
    if (!this.canAct()) return;
    const g = this.game!;
    const t = g.state.tanks[g.state.activePlayer];
    const before = angle ? t.angle : t.power;
    if (angle) g.adjustAngle(steps);
    else g.adjustPower(steps);
    if ((angle ? t.angle : t.power) !== before) this.actions.uiSound('tick');
  }

  private fire(): void {
    if (!this.canAct()) {
      this.actions.uiSound('error');
      return;
    }
    this.setDrive(0);
    if (!this.game!.fire()) this.actions.uiSound('error');
  }

  private setDrive(dir: -1 | 0 | 1): void {
    if (dir === this.driveDir) return;
    this.driveDir = dir;
    if (this.game && (dir === 0 || this.game.canControl())) this.game.setMove(dir);
  }

  private bindDrive(b: HTMLButtonElement, dir: -1 | 1): void {
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || b.disabled || !this.canAct()) return;
      e.preventDefault();
      this.drivePointer = e.pointerId;
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      this.setDrive(dir);
    });
    const stop = (e: PointerEvent): void => {
      if (e.pointerId !== this.drivePointer) return;
      this.drivePointer = -1;
      this.setDrive(0);
    };
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('lostpointercapture', stop);
    b.addEventListener('contextmenu', e => e.preventDefault());
    // Keyboard focus + Enter: a short nudge.
    b.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && this.canAct()) {
        e.preventDefault();
        e.stopPropagation();
        this.setDrive(dir);
      }
    });
    b.addEventListener('keyup', e => {
      if (e.key === 'Enter' || e.key === ' ') this.setDrive(0);
    });
    b.addEventListener('blur', () => this.setDrive(0));
  }

  private barDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.canAct()) return;
    e.preventDefault();
    // Reading the rect once per drag (event-driven, never per frame).
    const r = this.powerBar.getBoundingClientRect();
    this.dragLeft = r.left;
    this.dragWidth = Math.max(1, r.width);
    this.dragId = e.pointerId;
    try {
      this.powerBar.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.powerBar.classList.add('is-drag');
    this.barMove(e);
  };

  private barMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId || !this.canAct()) return;
    const v = clamp(((e.clientX - this.dragLeft) / this.dragWidth) * 100, 0, 100);
    const g = this.game!;
    const t = g.state.tanks[g.state.activePlayer];
    const before = t.power;
    g.setPower(Math.round(v));
    if (t.power !== before) this.actions.uiSound('tick');
  };

  private barUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.dragId = -1;
    this.powerBar.classList.remove('is-drag');
  };

  // ------------------------------------------------------------------------------------------
  // Events & frame update

  reset(): void {
    this.lastPower = [-1, -1];
    this.weapon = null;
    this.team = -1;
  }

  onFire(player: PlayerIndex, power: number): void {
    this.lastPower[player] = power;
    retrigger(this.fireBtn, 'is-fired');
  }

  onWeaponSelect(): void {
    retrigger(this.wIcon, 'is-swap');
  }

  update(state: GameState, game: GameApi, dt: number): void {
    this.game = game;
    const ap = state.activePlayer;
    const tank = state.tanks[ap];
    const player = state.config.players[ap];
    const control = game.canControl();
    for (const r of this.repeats) r.update(dt);
    if (!control && this.driveDir !== 0) this.driveDir = 0;

    if (ap !== this.team) {
      this.team = ap;
      const tc = TEAMS[ap].cssVar;
      this.root.style.setProperty('--tc', `var(${tc})`);
      this.root.style.setProperty('--tc-light', `var(${tc}-light)`);
      this.root.style.setProperty('--tc-dark', `var(${tc}-dark)`);
    }

    // Weapon
    if (tank.weapon !== this.weapon) {
      this.weapon = tank.weapon;
      const def = WEAPONS[tank.weapon];
      this.wIcon.innerHTML = weaponIcon(tank.weapon, 24);
      this.wName.set(def.name);
      this.wBtn.style.setProperty('--wc', def.color);
    }
    const ammo = tank.ammo[tank.weapon];
    this.wAmmo.set(ammo === Infinity ? '∞' : `×${ammo}`);

    // Angle / power
    this.angleTxt.set(`${tank.angle.toFixed(1)}°`);
    this.needle.set(`rotate(${f3(-tank.angle)}deg)`);
    const p = clamp(tank.power, 0, 100);
    this.powerTxt.set(p % 1 === 0 ? String(p) : p.toFixed(1));
    this.powerFill.set(`scaleX(${f3(1 - p / 100)})`);
    const pr = Math.round(p);
    if (pr !== this.ariaPower) {
      this.ariaPower = pr;
      this.powerBar.setAttribute('aria-valuenow', String(pr));
    }
    this.powerKnob.set(`translateX(${f3(p)}%)`);
    const lp = this.lastPower[ap];
    this.powerMarkOn.set(lp >= 0);
    if (lp >= 0) this.powerMark.set(`translateX(${f3(lp)}%)`);

    // Drive / fuel
    const fuel = clamp(tank.fuel / FUEL_PER_ROUND, 0, 1);
    this.fuelFill.set(`scaleX(${f3(fuel)})`);
    this.fuelLow.set(fuel < 0.2);
    this.movingL.set(tank.moveDir < 0);
    this.movingR.set(tank.moveDir > 0);

    // Lock state
    const locked = !control;
    this.lockedSlot.set(locked);
    this.readySlot.set(control);
    if (control !== this.enabled) {
      this.enabled = control;
      for (const b of this.controls) b.disabled = !control;
      if (!control) for (const r of this.repeats) r.cancel();
    }
    // Status pill: only while someone is aiming without local control (CPU thinking / paused), never mid-shot.
    const showStatus = locked && state.phase === 'aiming';
    this.statusSlot.set(showStatus);
    if (showStatus) {
      const cpu = player.kind === 'cpu';
      const thinking = cpu && !state.paused;
      const kind = (cpu ? 'c' : 'h') + (thinking ? '1' : '0');
      if (kind !== this.statusKind) {
        this.statusKind = kind;
        this.statusIco.innerHTML = cpu ? UI_ICONS.cpu : UI_ICONS.user;
        this.status.classList.toggle('is-thinking', thinking);
      }
      this.statusTxt.set(thinking ? `${player.name} is aiming` : state.paused ? 'Paused' : `${player.name}'s turn`);
    }
  }
}
