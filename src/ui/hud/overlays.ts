/** Turn/round banners and per-side toast stacks. Animations are pure CSS (transform/opacity). */
import { TEAMS } from '../../core/teams.ts';
import type { PlayerIndex } from '../../core/types.ts';
import { el, retrigger } from './dom.ts';

export class Banner {
  readonly root: HTMLElement;
  private turn: HTMLElement;
  private turnName: HTMLElement;
  private turnSub: HTMLElement;
  private round: HTMLElement;
  private roundTitle: HTMLElement;
  private roundSub: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    const r = el('div', 'cc-banner', '', parent);
    this.root = r;
    this.turn = el('div', 'cc-banner__turn', '', r);
    el('span', 'cc-banner__streak', '', this.turn);
    const tt = el('div', 'cc-banner__turn-txt', '', this.turn);
    this.turnName = el('span', 'cc-banner__turn-name', '', tt);
    this.turnSub = el('span', 'cc-banner__turn-sub', '', tt);
    this.round = el('div', 'cc-banner__round', '', r);
    el('span', 'cc-banner__rule', '', this.round);
    this.roundTitle = el('div', 'cc-banner__round-title', '', this.round);
    this.roundSub = el('div', 'cc-banner__round-sub', '', this.round);
    el('span', 'cc-banner__rule', '', this.round);
  }

  showTurn(player: PlayerIndex, title: string, sub: string): void {
    const tc = TEAMS[player].cssVar;
    this.turn.style.setProperty('--tc', `var(${tc})`);
    this.turn.style.setProperty('--tc-light', `var(${tc}-light)`);
    this.turn.classList.toggle('is-right', player === 1);
    this.turnName.textContent = title;
    this.turnSub.textContent = sub;
    this.round.classList.remove('is-on');
    retrigger(this.turn, 'is-on');
    this.timer = 1.25;
  }

  showRound(round: number, biome: string, sub: string): void {
    this.roundTitle.textContent = `Round ${round}`;
    this.roundSub.textContent = sub ? `${biome}  ·  ${sub}` : biome;
    this.turn.classList.remove('is-on');
    retrigger(this.round, 'is-on');
    this.timer = 2.1;
  }

  clear(): void {
    this.turn.classList.remove('is-on');
    this.round.classList.remove('is-on');
    this.timer = 0;
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.clear();
  }
}

export type ToastTone = 'good' | 'bad' | 'info' | 'shield';

interface Toast {
  node: HTMLElement;
  life: number;
  out: boolean;
}

const TOAST_LIFE = 2.6;
const MAX_TOASTS = 4;

export class Toasts {
  readonly root: HTMLElement;
  private stacks: [HTMLElement, HTMLElement, HTMLElement];
  private live: Toast[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'cc-toasts', '', parent);
    this.stacks = [
      el('div', 'cc-toasts__stack cc-toasts__stack--p0', '', this.root),
      el('div', 'cc-toasts__stack cc-toasts__stack--p1', '', this.root),
      el('div', 'cc-toasts__stack cc-toasts__stack--mid', '', this.root),
    ];
    this.stacks[0].setAttribute('aria-live', 'polite');
    this.stacks[1].setAttribute('aria-live', 'polite');
  }

  /** side: player whose card the toast hangs under, or null for the centre stack. */
  show(side: PlayerIndex | null, iconHtml: string, html: string, tone: ToastTone, accent?: string): void {
    const stack = this.stacks[side === null ? 2 : side];
    const n = el('div', `cc-toast cc-toast--${tone} glass`);
    if (accent) n.style.setProperty('--ta', accent);
    el('span', 'cc-toast__ico', iconHtml, n);
    el('span', 'cc-toast__txt', html, n);
    stack.prepend(n);
    this.live.push({ node: n, life: TOAST_LIFE, out: false });
    // Cap per stack: oldest leave first.
    let count = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      if (t.node.parentElement !== stack || t.out) continue;
      if (++count > MAX_TOASTS) this.dismiss(t);
    }
  }

  clear(): void {
    for (const t of this.live) t.node.remove();
    this.live.length = 0;
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.life -= dt;
      if (!t.out && t.life <= 0) this.dismiss(t);
      if (t.out && t.life <= -0.35) {
        t.node.remove();
        this.live.splice(i, 1);
      }
    }
  }

  private dismiss(t: Toast): void {
    t.out = true;
    t.life = Math.min(t.life, 0);
    t.node.classList.add('is-out');
  }
}
