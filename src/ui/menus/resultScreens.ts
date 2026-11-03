/** Round-over banner (auto-continue countdown) and match-over celebration. */
import { TEAMS } from '../../core/teams.ts';
import type { GameState, PlayerIndex, TankStats } from '../../core/types.ts';
import { button, h, iconEl, stagger, type Screen, type ScreenCtx } from './dom.ts';
import { Confetti } from './confetti.ts';

const AUTO_CONTINUE = 5;
const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** "You takes the round" reads wrong; the default solo name is "You". */
const isYou = (name: string): boolean => name.trim().toLowerCase() === 'you';

const reducedMotion = (): boolean => document.documentElement.classList.contains('reduced-motion') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Score pips: one per round needed, filled for rounds won. */
function pips(state: GameState, p: PlayerIndex, fresh: boolean): HTMLElement {
  const el = h('div', `mn-pips mn-pips--p${p}`, { 'aria-label': `${state.wins[p]} of ${state.config.roundsToWin} rounds` });
  for (let i = 0; i < state.config.roundsToWin; i++) {
    const pip = h('i', i < state.wins[p] ? (fresh && i === state.wins[p] - 1 ? 'is-on is-new' : 'is-on') : '');
    pip.style.setProperty('--k', String(i));
    el.append(pip);
  }
  return el;
}

function statBlock(s: TankStats): HTMLElement {
  const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
  const cell = (v: string, l: string): HTMLElement => h('div', 'mn-stat', null, h('b', 'tabular', null, v), h('span', null, null, l));
  return h('div', 'mn-stats', null,
    cell(String(Math.round(s.damageDealt)), 'Damage'), cell(String(s.shots), 'Shots'),
    cell(String(s.hits), 'Hits'), cell(`${acc}%`, 'Accuracy'));
}

/** One player's column: name, pips, stats. */
function playerCard(state: GameState, p: PlayerIndex, winner: PlayerIndex | null, cls: string): HTMLElement {
  const won = winner === p;
  const card = h('div', `${cls} mn-pcard mn-pcard--p${p} st${won ? ' is-win' : ''}`, null,
    h('div', 'mn-pcard__head', null,
      iconEl(state.config.players[p].kind === 'cpu' ? 'cpu' : 'user', 'mn-pcard__ico'),
      h('span', 'mn-pcard__name', null, state.config.players[p].name),
      won ? iconEl('trophy', 'mn-pcard__trophy') : null),
    pips(state, p, won),
    statBlock(state.tanks[p].stats));
  return card;
}

export class RoundOverScreen implements Screen {
  readonly id = 'roundOver' as const;
  readonly el: HTMLElement;
  private readonly ctx: ScreenCtx;
  private readonly body: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly ring: SVGCircleElement;
  private readonly count: HTMLElement;
  private remaining = AUTO_CONTINUE;
  private running = false;
  private shownSec = -1;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const el = h('section', 'mn-screen mn-round', { 'aria-label': 'Round over', 'aria-live': 'polite' });
    this.body = h('div', 'mn-round__body');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'mn-ring');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(ns, 'circle');
    this.ring = document.createElementNS(ns, 'circle');
    for (const c of [track, this.ring]) {
      c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'mn-ring__track');
    this.ring.setAttribute('class', 'mn-ring__fill');
    this.ring.setAttribute('stroke-dasharray', RING_C.toFixed(2));
    svg.append(track, this.ring);
    this.count = h('span', 'mn-ring__num tabular', null, '5');
    this.next = button({ label: 'Next Round', variant: 'primary', cls: 'mn-next st', onClick: () => this.go() });
    this.next.prepend(h('span', 'mn-ring__wrap', null, svg, this.count));
    el.append(h('div', 'mn-band', null, this.body, h('div', 'mn-round__actions', null, this.next)));
    this.el = el;
  }

  enter(state: GameState | null): void {
    this.body.replaceChildren();
    this.remaining = AUTO_CONTINUE;
    this.running = true;
    this.shownSec = -1;
    this.paintRing();
    if (state) {
      const w = state.roundWinner;
      const round = state.round;
      this.el.style.setProperty('--team', w === null ? 'var(--accent)' : `var(${TEAMS[w].cssVar})`);
      this.el.style.setProperty('--team-glow', w === null ? 'var(--accent-glow)' : TEAMS[w].glow + '88');
      const head = h('div', 'mn-round__head', null,
        h('div', 'mn-round__kicker st', null, h('span', null, null, `Round ${round}`)),
        w === null
          ? h('h2', 'mn-round__winner st', null, 'Draw')
          : h('h2', 'mn-round__winner st', null, h('span', 'mn-round__name', null, state.config.players[w].name)),
        h('p', 'mn-round__sub st', null, w === null ? 'Both tanks went down together' : isYou(state.config.players[w].name) ? 'take the round' : 'takes the round'));
      const cols = h('div', 'mn-round__cols', null,
        playerCard(state, 0, w, 'mn-round__p'),
        h('div', 'mn-round__score st tabular', null, h('b', 'mn-c0', null, String(state.wins[0])), h('i', null, null, ':'), h('b', 'mn-c1', null, String(state.wins[1]))),
        playerCard(state, 1, w, 'mn-round__p'));
      this.body.append(head, cols);
    }
    stagger(this.el);
  }

  leave(): void {
    this.running = false;
  }

  private paintRing(): void {
    const f = Math.max(0, this.remaining / AUTO_CONTINUE);
    this.ring.setAttribute('stroke-dashoffset', (RING_C * (1 - f)).toFixed(2));
    const sec = Math.ceil(this.remaining);
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.count.textContent = String(Math.max(0, sec));
    }
  }

  update(dt: number): void {
    if (!this.running) return;
    this.remaining -= dt;
    this.paintRing();
    if (this.remaining <= 0) this.go();
  }

  private go(): void {
    if (!this.running) return;
    this.running = false;
    this.ctx.sound('confirm');
    this.ctx.actions.nextRound();
    if (this.ctx.current() === 'roundOver') this.ctx.hideAll();
  }

  /** Esc is swallowed: there is nothing behind this screen, and skipping by accident would be rude. */
  back(): boolean {
    return true;
  }

  initialFocus(): HTMLElement {
    return this.next;
  }
}

export class MatchOverScreen implements Screen {
  readonly id = 'matchOver' as const;
  readonly el: HTMLElement;
  private readonly ctx: ScreenCtx;
  private readonly body: HTMLElement;
  private readonly rematch: HTMLButtonElement;
  private readonly confetti = new Confetti();
  private pending: { mode: 'celebrate' | 'ash'; colors: string[] } | null = null;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const el = h('section', 'mn-screen mn-match', { 'aria-label': 'Match over', 'aria-live': 'polite' });
    this.body = h('div', 'mn-match__body');
    this.rematch = button({
      label: 'Rematch', icon: 'play', variant: 'primary', cls: 'st',
      onClick: () => {
        ctx.sound('start');
        ctx.actions.rematch();
        if (ctx.current() === 'matchOver') ctx.hideAll();
      },
    });
    const menu = button({
      label: 'Main Menu', icon: 'back', variant: 'secondary', cls: 'st',
      onClick: () => {
        ctx.sound('back');
        ctx.actions.quitToMenu();
        if (ctx.current() === 'matchOver') ctx.go('main');
      },
    });
    el.append(h('div', 'mn-match__burst', { 'aria-hidden': 'true' }), this.confetti.canvas, h('div', 'mn-match__inner', null, this.body, h('div', 'mn-match__actions', null, this.rematch, menu)));
    this.el = el;
  }

  enter(state: GameState | null): void {
    this.body.replaceChildren();
    this.confetti.stop();
    this.pending = null;
    if (!state) return;
    const w = state.matchWinner;
    const [a, b] = state.config.players;
    const solo = a.kind === 'human' && b.kind === 'cpu';
    let title: string;
    let tone: 'win' | 'loss' | 'draw' | 'duel';
    if (w === null) { title = 'Draw'; tone = 'draw'; }
    else if (solo) { title = w === 0 ? 'Victory' : 'Defeat'; tone = w === 0 ? 'win' : 'loss'; }
    else { const n = state.config.players[w].name; title = isYou(n) ? 'You win' : `${n} wins`; tone = 'duel'; }
    this.el.dataset.tone = tone;
    const team = w === null ? null : TEAMS[w];
    // Solo/draw tones are themed in CSS (gold victory, steel defeat); duels take the winner's colour.
    if (tone === 'duel' && team) {
      this.el.style.setProperty('--team', `var(${team.cssVar})`);
      this.el.style.setProperty('--team-light', team.light);
    } else {
      this.el.style.removeProperty('--team');
      this.el.style.removeProperty('--team-light');
    }
    const sub = tone === 'win' ? 'The battlefield is yours.'
      : tone === 'loss' ? `${b.name} takes the match. Run it back?`
      : tone === 'draw' ? 'Nobody blinked.' : 'Champion of the crater.';
    this.body.append(
      h('div', 'mn-match__kicker st', null, iconEl('trophy', 'mn-match__trophy'), h('span', null, null, 'Match over')),
      h('h2', `mn-match__title st${title.length > 9 ? ' is-long' : ''}`, { 'aria-label': title },
        h('span', 'mn-match__outline', { 'aria-hidden': 'true' }, title), h('span', 'mn-match__fill', { 'aria-hidden': 'true' }, title)),
      h('p', 'mn-match__sub st', null, sub),
      h('div', 'mn-match__final st tabular', { 'aria-label': `Final score ${state.wins[0]} to ${state.wins[1]}` },
        h('span', 'mn-team mn-team--p0', null, a.name), h('b', 'mn-c0', null, String(state.wins[0])),
        h('i', null, null, '–'), h('b', 'mn-c1', null, String(state.wins[1])), h('span', 'mn-team mn-team--p1', null, b.name)),
      h('div', 'mn-match__cols', null, playerCard(state, 0, w, 'mn-match__p'), playerCard(state, 1, w, 'mn-match__p')));
    stagger(this.el);
    if (!reducedMotion()) {
      this.pending = tone === 'loss'
        ? { mode: 'ash', colors: ['#9aa3b5', '#5d6577', '#ff7448'] }
        : { mode: 'celebrate', colors: tone === 'duel' && team ? [team.primary, team.light, '#ffc457', '#ffffff', team.glow] : ['#ffc457', '#ffe08f', '#3fc1ff', '#ffffff', '#ff8a3d', '#5dff9b', '#ff6fb5'] };
    }
  }

  leave(): void {
    this.confetti.stop();
    this.pending = null;
  }

  update(dt: number): void {
    // Start a frame after showing so the canvas has its final layout size.
    if (this.pending) {
      this.confetti.start(this.pending.mode, this.pending.colors);
      this.pending = null;
    }
    this.confetti.update(dt);
  }

  /** Esc does nothing here; the player must pick Rematch or Main Menu. */
  back(): boolean {
    return true;
  }

  initialFocus(): HTMLElement {
    return this.rematch;
  }
}
