/** Weapon picker popover: grid of all weapons with ammo, keyboard navigation and a detail footer. */
import type { UiActions } from '../../contracts.ts';
import type { TankState } from '../../core/types.ts';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../../core/weapons.ts';
import { UI_ICONS, weaponIcon } from '../icons.ts';
import { button, el } from './dom.ts';

const CATEGORY_LABEL: Record<string, string> = {
  shell: 'Shell', cluster: 'Cluster', trick: 'Trick shot', elemental: 'Elemental', terrain: 'Terrain', utility: 'Utility',
};

interface Cell {
  id: WeaponId;
  btn: HTMLButtonElement;
  ammo: HTMLElement;
  lastAmmo: number;
}

export class WeaponPicker {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private grid: HTMLElement;
  private cells: Cell[] = [];
  private infoIcon: HTMLElement;
  private infoName: HTMLElement;
  private infoCat: HTMLElement;
  private infoDesc: HTMLElement;
  private infoStats: HTMLElement;
  private infoId: WeaponId | null = null;
  private current: WeaponId | null = null;
  private opened = false;
  private actions: UiActions;
  private onPick: (id: WeaponId) => void;
  private onClose: () => void;
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement, actions: UiActions, onPick: (id: WeaponId) => void, onClose: () => void) {
    this.actions = actions;
    this.onPick = onPick;
    this.onClose = onClose;
    const r = el('div', 'cc-picker', '', parent);
    this.root = r;
    r.setAttribute('aria-hidden', 'true');
    const scrim = el('div', 'cc-picker__scrim', '', r);
    scrim.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.onClose();
    });
    const panel = el('div', 'cc-picker__panel glass', '', r);
    this.panel = panel;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose weapon');
    const head = el('div', 'cc-picker__head', '', panel);
    el('div', 'cc-picker__title', 'Arsenal', head);
    el('div', 'cc-picker__hint', '<kbd>←↑↓→</kbd> move · <kbd>Enter</kbd> select · <kbd>Esc</kbd> close', head);
    const close = button('cc-ibtn cc-picker__close', UI_ICONS.close, 'Close', head);
    close.addEventListener('click', () => this.onClose());

    this.grid = el('div', 'cc-picker__grid', '', panel);
    this.grid.setAttribute('role', 'listbox');
    WEAPON_ORDER.forEach((id, i) => {
      const def = WEAPONS[id];
      const b = button('cc-wcard', '', def.name, this.grid);
      b.setAttribute('role', 'option');
      b.style.setProperty('--wc', def.color);
      b.style.setProperty('--i', String(i));
      b.dataset.id = id;
      el('span', 'cc-wcard__icon', weaponIcon(id, 30), b);
      const txt = el('span', 'cc-wcard__txt', '', b);
      el('span', 'cc-wcard__name', def.name, txt);
      el('span', 'cc-wcard__tag', def.tagline, txt);
      const ammo = el('span', 'cc-wcard__ammo tabular', '', b);
      b.addEventListener('click', () => this.pick(id));
      b.addEventListener('pointerenter', () => this.showInfo(id));
      b.addEventListener('focus', () => this.showInfo(id));
      this.cells.push({ id, btn: b, ammo, lastAmmo: NaN });
    });

    const info = el('div', 'cc-picker__info', '', panel);
    this.infoIcon = el('div', 'cc-picker__info-icon', '', info);
    const it = el('div', 'cc-picker__info-txt', '', info);
    const line = el('div', 'cc-picker__info-line', '', it);
    this.infoName = el('span', 'cc-picker__info-name', '', line);
    this.infoCat = el('span', 'cc-picker__info-cat', '', line);
    this.infoDesc = el('div', 'cc-picker__info-desc', '', it);
    this.infoStats = el('div', 'cc-picker__info-stats tabular', '', info);

    panel.addEventListener('keydown', this.onKey);
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(tank: TankState): void {
    if (this.opened) return;
    this.opened = true;
    this.sync(tank);
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cur = this.cells.find(c => c.id === tank.weapon);
    this.showInfo(tank.weapon);
    // Focus without scrolling; deferred one frame so the open transition is not interrupted.
    requestAnimationFrame(() => cur?.btn.focus({ preventScroll: true }));
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    if (this.panel.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
      this.returnFocus?.focus({ preventScroll: true });
    }
    this.returnFocus = null;
  }

  /** Ammo / current weapon (diffed; only while open). */
  sync(tank: TankState): void {
    for (const c of this.cells) {
      const n = tank.ammo[c.id] ?? 0;
      if (n !== c.lastAmmo) {
        c.lastAmmo = n;
        c.ammo.textContent = n === Infinity ? '∞' : String(n);
        c.btn.classList.toggle('is-empty', n <= 0);
        c.btn.setAttribute('aria-disabled', n <= 0 ? 'true' : 'false');
      }
    }
    if (tank.weapon !== this.current) {
      this.current = tank.weapon;
      for (const c of this.cells) {
        const on = c.id === tank.weapon;
        c.btn.classList.toggle('is-current', on);
        c.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
  }

  private pick(id: WeaponId): void {
    const c = this.cells.find(x => x.id === id);
    if (!c || c.lastAmmo <= 0) {
      this.actions.uiSound('error');
      if (c) {
        c.btn.classList.remove('is-denied');
        void c.btn.offsetWidth;
        c.btn.classList.add('is-denied');
      }
      return;
    }
    this.onPick(id);
  }

  private showInfo(id: WeaponId): void {
    if (id === this.infoId) return;
    this.infoId = id;
    const d = WEAPONS[id];
    this.infoIcon.innerHTML = weaponIcon(id, 40);
    this.infoIcon.style.setProperty('--wc', d.color);
    this.infoName.textContent = d.name;
    this.infoCat.textContent = CATEGORY_LABEL[d.category] ?? d.category;
    this.infoDesc.textContent = d.description;
    const stats: string[] = [];
    if (d.damage > 0) stats.push(`<span><b>${d.damage}</b>dmg</span>`);
    if (d.radius > 0 && d.category !== 'utility') stats.push(`<span><b>${d.radius}</b>blast</span>`);
    if (d.instant) stats.push('<span><b>Instant</b></span>');
    this.infoStats.innerHTML = stats.join('');
  }

  private onKey = (e: KeyboardEvent): void => {
    const key = e.key;
    const idx = this.cells.findIndex(c => c.btn === document.activeElement);
    // Column count follows the responsive grid; read only on navigation keys.
    const cols = Math.max(1, getComputedStyle(this.grid).gridTemplateColumns.split(' ').length);
    let next = -1;
    if (key === 'ArrowRight') next = idx + 1;
    else if (key === 'ArrowLeft') next = idx - 1;
    else if (key === 'ArrowDown') next = idx + cols;
    else if (key === 'ArrowUp') next = idx - cols;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = this.cells.length - 1;
    else if (key === 'Escape' || key === 'Tab' || key === 'w' || key === 'W') {
      e.preventDefault();
      e.stopPropagation();
      this.onClose();
      return;
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (idx >= 0) this.pick(this.cells[idx].id);
      return;
    } else {
      // Keep all other keys (angle, fire…) away from the battlefield while the picker owns focus.
      if (key.length === 1 || key.startsWith('Arrow')) e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (idx < 0) next = 0;
    next = Math.max(0, Math.min(this.cells.length - 1, next));
    this.cells[next].btn.focus({ preventScroll: true });
    this.actions.uiSound('hover');
  };
}
