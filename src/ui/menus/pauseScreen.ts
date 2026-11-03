/** Pause menu with an inline quit confirmation. */
import type { GameState } from '../../core/types.ts';
import { BIOMES } from '../../core/biomes.ts';
import { button, h, iconEl, stagger, type Screen, type ScreenCtx } from './dom.ts';

export class PauseScreen implements Screen {
  readonly id = 'pause' as const;
  readonly el: HTMLElement;
  private readonly ctx: ScreenCtx;
  private readonly panel: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private confirming = false;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const el = h('section', 'mn-screen mn-pause', { 'aria-label': 'Paused', role: 'dialog', 'aria-modal': 'true' });
    this.summary = h('div', 'mn-pause__summary st');
    this.resumeBtn = button({ label: 'Resume', icon: 'play', variant: 'primary', kbd: 'Esc', cls: 'st', onClick: () => this.resume() });
    this.quitBtn = button({ label: 'Quit to Menu', icon: 'close', variant: 'ghost', cls: 'st mn-pause__quit', onClick: () => this.confirm(true) });
    const menu = h('div', 'mn-pause__menu', null,
      this.resumeBtn,
      button({ label: 'Settings', icon: 'settings', variant: 'secondary', cls: 'st', onClick: () => { ctx.sound('open'); ctx.push('settings'); } }),
      button({ label: 'How to Play', icon: 'help', variant: 'secondary', cls: 'st', onClick: () => { ctx.sound('open'); ctx.push('help'); } }),
      this.quitBtn);

    this.cancelBtn = button({ label: 'Keep Playing', variant: 'secondary', onClick: () => this.confirm(false) });
    const confirm = h('div', 'mn-confirm', { role: 'alertdialog', 'aria-labelledby': 'mn-confirm-t', 'aria-describedby': 'mn-confirm-d' },
      iconEl('close', 'mn-confirm__ico'),
      h('h3', 'mn-confirm__title', { id: 'mn-confirm-t' }, 'Quit to menu?'),
      h('p', 'mn-confirm__text', { id: 'mn-confirm-d' }, 'This match will be lost.'),
      h('div', 'mn-confirm__btns', null,
        this.cancelBtn,
        button({ label: 'Quit', variant: 'danger', onClick: () => this.quit() })));

    this.panel = h('div', 'mn-panel mn-pause__panel', null,
      h('div', 'mn-pause__badge st', { 'aria-hidden': 'true' }, iconEl('pause')),
      h('h2', 'mn-title mn-pause__title st', null, 'Paused'),
      this.summary, menu, confirm);
    el.append(this.panel);
    stagger(el);
    this.el = el;
  }

  enter(state: GameState | null): void {
    this.setConfirm(false);
    this.summary.replaceChildren();
    if (!state) return;
    const [a, b] = state.config.players;
    const score = h('div', 'mn-pause__score tabular', null,
      h('span', 'mn-team mn-team--p0', null, a.name),
      h('b', null, null, `${state.wins[0]}`), h('i', null, null, '–'), h('b', null, null, `${state.wins[1]}`),
      h('span', 'mn-team mn-team--p1', null, b.name));
    const meta = h('div', 'mn-pause__meta', null, `Round ${state.round} · ${BIOMES[state.biome].name} · First to ${state.config.roundsToWin}`);
    this.summary.append(score, meta);
  }

  private setConfirm(on: boolean): void {
    this.confirming = on;
    this.panel.classList.toggle('is-confirm', on);
  }

  private confirm(on: boolean): void {
    this.ctx.sound(on ? 'open' : 'back');
    this.setConfirm(on);
    (on ? this.cancelBtn : this.quitBtn).focus({ preventScroll: true });
  }

  private resume(): void {
    this.ctx.sound('close');
    this.ctx.hideAll();
    this.ctx.actions.resume();
  }

  private quit(): void {
    this.ctx.sound('confirm');
    this.setConfirm(false);
    this.ctx.actions.quitToMenu();
    // The shell normally shows the main menu itself; make sure we never stay on a dead pause screen.
    if (this.ctx.current() === 'pause') this.ctx.go('main');
  }

  back(): boolean {
    if (this.confirming) {
      this.confirm(false);
      return true;
    }
    this.resume();
    return true;
  }

  initialFocus(): HTMLElement {
    return this.resumeBtn;
  }
}
