/**
 * Menus and overlays: title, match setup, pause, settings, how-to-play, round and match results.
 * DOM lives in #overlay over the live canvas. Screens slide in with staggered spring entrances;
 * a screen stack makes Settings/Help return to whichever screen opened them.
 */
import './menus.css';
import type { MenuScreen, MenusApi, UiActions, UiSound } from '../contracts.ts';
import type { GameEvent } from '../core/events.ts';
import type { GameState } from '../core/types.ts';
import { h, type Screen, type ScreenCtx } from './menus/dom.ts';
import { MainScreen } from './menus/mainScreen.ts';
import { SetupScreen } from './menus/setupScreen.ts';
import { PauseScreen } from './menus/pauseScreen.ts';
import { SettingsScreen } from './menus/settingsScreen.ts';
import { HelpScreen } from './menus/helpScreen.ts';
import { MatchOverScreen, RoundOverScreen } from './menus/resultScreens.ts';

export { setIconProvider } from './menus/iconProvider.ts';

/** Matches the CSS exit animation length. */
const EXIT_MS = 280;
const HOVER_THROTTLE_MS = 55;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = 'up' | 'down' | 'left' | 'right';
const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export class Menus implements MenusApi {
  private readonly actions: UiActions;
  private root: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private readonly screens = new Map<MenuScreen, Screen>();
  private stack: MenuScreen[] = [];
  private active: Screen | null = null;
  private readonly exitTimers = new Map<Screen, number>();
  private readonly lastFocus = new Map<Screen, HTMLElement>();
  private lastState: GameState | null = null;
  private lastHoverAt = 0;
  private lastHoverEl: Element | null = null;
  /** Time of an Esc we handled ourselves, so a second back() from the shell for the same key is ignored. */
  private keyBackAt = -1e9;

  constructor(actions: UiActions) {
    this.actions = actions;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    const layer = h('div', 'mn-root', { 'data-screen': 'none' });
    layer.append(h('div', 'mn-backdrop', { 'aria-hidden': 'true' }, h('div', 'mn-backdrop__tint'), h('div', 'mn-backdrop__vignette'), h('div', 'mn-backdrop__glow')));
    this.layer = layer;

    const ctx: ScreenCtx = {
      actions: this.actions,
      sound: s => this.sound(s),
      push: s => this.push(s),
      go: (s, st) => this.show(s, st ?? this.lastState ?? undefined),
      back: () => { this.back(); },
      hideAll: () => this.show('none'),
      state: () => this.lastState,
      current: () => this.current(),
    };
    const main = new MainScreen(ctx);
    const setup = new SetupScreen(ctx);
    main.onMode = m => setup.setMode(m);
    const list: Screen[] = [main, setup, new PauseScreen(ctx), new SettingsScreen(ctx), new HelpScreen(ctx), new RoundOverScreen(ctx), new MatchOverScreen(ctx)];
    for (const s of list) {
      s.el.hidden = true;
      this.screens.set(s.id, s);
      layer.append(s.el);
    }
    root.append(layer);

    window.addEventListener('keydown', this.onKey, true);
    layer.addEventListener('pointerover', this.onPointerOver);
  }

  show(screen: MenuScreen, state?: GameState): void {
    if (state) this.lastState = state;
    this.stack = screen === 'none' ? [] : [screen];
    this.activate(screen === 'none' ? null : this.screens.get(screen) ?? null, 'replace');
  }

  current(): MenuScreen {
    return this.stack.length ? this.stack[this.stack.length - 1] : 'none';
  }

  back(): boolean {
    const top = this.current();
    if (top === 'none') return false;
    // The shell may forward the same Esc we already handled.
    if (performance.now() - this.keyBackAt < 120) return true;
    const scr = this.screens.get(top);
    if (scr?.back?.()) return true;
    if (this.stack.length > 1) {
      this.stack.pop();
      this.sound('back');
      this.activate(this.screens.get(this.current()) ?? null, 'back');
      return true;
    }
    if (top === 'setup' || top === 'settings' || top === 'help') {
      this.sound('back');
      const inMatch = this.lastState && !this.lastState.config.attract && top !== 'setup';
      this.stack = [inMatch ? 'pause' : 'main'];
      this.activate(this.screens.get(this.current()) ?? null, 'back');
      return true;
    }
    return false;
  }

  handleEvent(e: GameEvent, state: GameState): void {
    // Results are driven by show(); keep the freshest state for screens that read it lazily.
    if (e.type === 'roundOver' || e.type === 'matchOver' || e.type === 'matchStart') this.lastState = state;
  }

  update(dt: number, state: GameState | null): void {
    if (state) this.lastState = state;
    this.active?.update?.(dt, state);
  }

  /** Detaches listeners and DOM (hot reload / tests). */
  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.layer?.remove();
    this.layer = null;
    this.root = null;
  }

  // --- internals ------------------------------------------------------------------------

  private push(screen: MenuScreen): void {
    if (screen === 'none' || this.current() === screen) return;
    this.stack.push(screen);
    this.activate(this.screens.get(screen) ?? null, 'forward');
  }

  private sound(s: UiSound): void {
    try {
      this.actions.uiSound(s);
    } catch {
      // Audio is optional; never let it break navigation.
    }
  }

  private activate(next: Screen | null, dir: 'forward' | 'back' | 'replace'): void {
    const layer = this.layer;
    if (!layer) return;
    const prev = this.active;
    layer.dataset.screen = next ? next.id : 'none';
    layer.dataset.dir = dir;
    layer.classList.toggle('is-open', !!next);

    if (prev && prev !== next) {
      // Remember where focus was so returning (Esc/back) lands on the same control.
      const fe = document.activeElement;
      if (fe instanceof HTMLElement && prev.el.contains(fe)) this.lastFocus.set(prev, fe);
      prev.leave?.();
      prev.el.classList.remove('is-in');
      prev.el.classList.add('is-out');
      prev.el.dataset.dir = dir;
      prev.el.setAttribute('aria-hidden', 'true');
      const t = window.setTimeout(() => {
        this.exitTimers.delete(prev);
        if (this.active !== prev) {
          prev.el.hidden = true;
          prev.el.classList.remove('is-out');
        }
      }, EXIT_MS);
      this.exitTimers.set(prev, t);
    }
    this.active = next;
    if (!next) {
      if (layer.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      return;
    }

    const pending = this.exitTimers.get(next);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.exitTimers.delete(next);
    }
    if (prev === next) next.leave?.();
    next.enter(this.lastState);
    const el = next.el;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    el.dataset.dir = dir;
    el.classList.remove('is-out', 'is-in');
    // Restart the entrance animation.
    void el.offsetWidth;
    el.classList.add('is-in');
    const remembered = dir === 'back' ? this.lastFocus.get(next) : undefined;
    const focus = remembered && remembered.isConnected && remembered.getClientRects().length ? remembered : next.initialFocus();
    if (focus) requestAnimationFrame(() => {
      if (this.active === next) focus.focus({ preventScroll: true });
    });
  }

  private readonly onPointerOver = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const target = (e.target as Element | null)?.closest?.('button, .mn-range');
    if (!target || target === this.lastHoverEl || (target as HTMLButtonElement).disabled) return;
    this.lastHoverEl = target;
    this.hoverSound();
  };

  private hoverSound(): void {
    const now = performance.now();
    if (now - this.lastHoverAt < HOVER_THROTTLE_MS) return;
    this.lastHoverAt = now;
    this.sound('hover');
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const scr = this.active;
    if (!scr || this.current() === 'none') return;
    const target = e.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement && target.type === 'text';

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (typing) { target.blur(); return; }
      this.keyBackAt = -1e9;
      this.back();
      this.keyBackAt = performance.now();
      return;
    }
    if ((e.key === 'p' || e.key === 'P') && !typing && this.current() === 'pause' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      this.back();
      return;
    }
    if (e.key === 'Tab') {
      this.trapTab(e, scr);
      return;
    }
    const dir = ARROWS[e.key];
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) return;
    if (target instanceof HTMLInputElement && target.type === 'range' && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    e.stopPropagation();
    this.moveFocus(scr, dir);
  };

  private focusables(scr: Screen): HTMLElement[] {
    const out: HTMLElement[] = [];
    const list = scr.el.querySelectorAll<HTMLElement>(FOCUSABLE);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.getClientRects().length === 0 || el.closest('[hidden]')) continue;
      if (el.closest('.mn-confirm') && !el.closest('.is-confirm')) continue;
      if (el.closest('.is-confirm') && el.closest('.mn-pause__menu')) continue;
      out.push(el);
    }
    return out;
  }

  private trapTab(e: KeyboardEvent, scr: Screen): void {
    const items = this.focusables(scr);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
      e.preventDefault();
      e.stopPropagation();
      items[i === -1 ? 0 : e.shiftKey ? items.length - 1 : 0].focus();
    }
  }

  /** Spatial navigation: nearest focusable in the arrow's direction, favouring alignment. */
  private moveFocus(scr: Screen, dir: Dir): void {
    const items = this.focusables(scr);
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) {
      const f = scr.initialFocus() ?? items[0];
      f?.focus();
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let primary: number;
      let cross: number;
      if (dir === 'up' || dir === 'down') {
        // Edge-based so a tall card beside short rows still counts as "below".
        primary = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        if (primary < -Math.min(a.height, b.height) * 0.5) continue;
        cross = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) + Math.abs(bx - ax) * 0.25;
      } else {
        primary = dir === 'right' ? b.left - a.right : a.left - b.right;
        if (primary < -Math.min(a.width, b.width) * 0.5) continue;
        cross = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) + Math.abs(by - ay) * 0.25;
      }
      const score = Math.max(0, primary) + cross * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.hoverSound();
    }
  }
}
