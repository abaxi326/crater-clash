/** Tiny DOM helpers and form widgets shared by the menu screens. */
import type { MenuScreen, UiActions, UiSound } from '../../contracts.ts';
import type { GameState } from '../../core/types.ts';
import { icon, type UiIconName } from './iconProvider.ts';

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Creates an element. `cls` may hold several classes; attrs with false/undefined are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** An element whose inner markup is trusted static SVG/HTML (icons, illustrations). */
export function raw(tag: keyof HTMLElementTagNameMap, cls: string, html: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.innerHTML = html;
  return el;
}

export const iconEl = (name: UiIconName, cls = 'mn-ico'): HTMLElement => {
  const el = raw('span', cls, icon(name));
  el.setAttribute('aria-hidden', 'true');
  return el;
};

/** Services every screen gets from the Menus controller. */
export interface ScreenCtx {
  actions: UiActions;
  sound(s: UiSound): void;
  /** Opens a screen on top of the current one (settings/help); back() returns. */
  push(screen: MenuScreen): void;
  /** Replaces the whole stack. */
  go(screen: MenuScreen, state?: GameState | null): void;
  /** Same as Esc. */
  back(): void;
  /** Hide everything (e.g. after starting a match). */
  hideAll(): void;
  /** Last state handed to show()/update(). */
  state(): GameState | null;
  /** Screen currently on top. */
  current(): MenuScreen;
}

export interface Screen {
  readonly id: MenuScreen;
  readonly el: HTMLElement;
  /** Refresh content right before the screen animates in. */
  enter(state: GameState | null): void;
  leave?(): void;
  update?(dt: number, state: GameState | null): void;
  /** Screen-local Esc handling (closing a confirm, a tab…). True if consumed. */
  back?(): boolean;
  /** Element to focus when the screen opens. */
  initialFocus(): HTMLElement | null;
}

/** Assigns the stagger index used by the CSS entrance animation, in document order. */
export function stagger(root: HTMLElement): void {
  const items = root.querySelectorAll<HTMLElement>('.st');
  for (let i = 0; i < items.length; i++) items[i].style.setProperty('--i', String(i));
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'hero';

export interface ButtonOpts {
  label: string;
  sub?: string;
  icon?: UiIconName;
  variant?: ButtonVariant;
  cls?: string;
  kbd?: string;
  onClick(ev: MouseEvent): void;
}

export function button(o: ButtonOpts): HTMLButtonElement {
  const b = h('button', `mn-btn mn-btn--${o.variant ?? 'secondary'}${o.cls ? ' ' + o.cls : ''}`, { type: 'button' });
  if (o.icon) b.append(iconEl(o.icon, 'mn-btn__ico'));
  const text = h('span', 'mn-btn__text', null, h('span', 'mn-btn__label', null, o.label));
  if (o.sub) text.append(h('span', 'mn-btn__sub', null, o.sub));
  b.append(text);
  if (o.kbd) b.append(h('kbd', 'mn-kbd', null, o.kbd));
  b.addEventListener('click', o.onClick);
  return b;
}

/** Small round icon button (back / close). */
export function iconButton(name: UiIconName, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', `mn-iconbtn ${cls}`, { type: 'button', 'aria-label': label, title: label });
  b.append(iconEl(name));
  b.addEventListener('click', onClick);
  return b;
}

export interface Segmented<T extends string | number> {
  el: HTMLElement;
  set(v: T): void;
}

/** Segmented control (radio group of buttons) with a sliding thumb. */
export function segmented<T extends string | number>(
  label: string, options: readonly { value: T; label: string }[], value: T, onChange: (v: T) => void, sound: (s: UiSound) => void,
): Segmented<T> {
  const el = h('div', 'mn-seg', { role: 'radiogroup', 'aria-label': label });
  el.style.setProperty('--n', String(options.length));
  const thumb = h('span', 'mn-seg__thumb', { 'aria-hidden': 'true' });
  el.append(thumb);
  const btns: HTMLButtonElement[] = [];
  let current = value;
  const set = (v: T): void => {
    current = v;
    const idx = Math.max(0, options.findIndex(o => o.value === v));
    el.style.setProperty('--idx', String(idx));
    btns.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === idx));
      b.classList.toggle('is-on', i === idx);
    });
  };
  options.forEach(o => {
    const b = h('button', 'mn-seg__opt', { type: 'button', role: 'radio' }, o.label);
    b.addEventListener('click', () => {
      if (o.value === current) return;
      sound('select');
      set(o.value);
      onChange(o.value);
    });
    btns.push(b);
    el.append(b);
  });
  set(value);
  return { el, set };
}

export interface Toggle {
  el: HTMLButtonElement;
  set(v: boolean): void;
}

/** On/off switch (role=switch). */
export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, sound: (s: UiSound) => void): Toggle {
  const el = h('button', 'mn-switch', { type: 'button', role: 'switch', 'aria-label': label });
  el.append(h('span', 'mn-switch__track', { 'aria-hidden': 'true' }, h('span', 'mn-switch__knob')));
  let on = value;
  const set = (v: boolean): void => {
    on = v;
    el.setAttribute('aria-checked', String(v));
    el.classList.toggle('is-on', v);
  };
  el.addEventListener('click', () => {
    set(!on);
    sound('toggle');
    onChange(on);
  });
  set(value);
  return { el, set };
}

export interface Slider {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: number): void;
}

/** 0..1 slider with a filled track and a percentage readout. */
export function slider(label: string, value: number, onInput: (v: number) => void, sound: (s: UiSound) => void): Slider {
  const input = h('input', 'mn-range', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
  const out = h('output', 'mn-range__val tabular', null);
  const el = h('div', 'mn-slider', null, input, out);
  let lastTick = -1;
  const paint = (pct: number): void => {
    el.style.setProperty('--v', `${pct}%`);
    out.textContent = `${pct}%`;
    input.setAttribute('aria-valuetext', `${pct}%`);
  };
  const set = (v: number): void => {
    const pct = Math.round(v * 100);
    input.value = String(pct);
    paint(pct);
  };
  input.addEventListener('input', () => {
    const pct = Number(input.value);
    paint(pct);
    // Tick every 10% so dragging feels mechanical without machine-gunning the audio.
    const step = Math.floor(pct / 10);
    if (step !== lastTick) {
      lastTick = step;
      sound('tick');
    }
    onInput(pct / 100);
  });
  set(value);
  return { el, input, set };
}

/** A labelled settings row: label (+hint) on the left, control on the right. */
export function row(label: string, control: HTMLElement, hint?: string, cls = ''): HTMLElement {
  const lab = h('div', 'mn-row__label', null, h('span', 'mn-row__title', null, label));
  if (hint) lab.append(h('span', 'mn-row__hint', null, hint));
  return h('div', `mn-row st ${cls}`, null, lab, h('div', 'mn-row__ctrl', null, control));
}

/** Screen header: optional back button, kicker and title. */
export function header(title: string, kicker: string | null, onBack: (() => void) | null): HTMLElement {
  const hd = h('header', 'mn-head st');
  if (onBack) hd.append(iconButton('back', 'Back', onBack, 'mn-head__back'));
  const t = h('div', 'mn-head__titles');
  if (kicker) t.append(h('div', 'mn-kicker', null, kicker));
  t.append(h('h2', 'mn-title', null, title));
  hd.append(t);
  return hd;
}
