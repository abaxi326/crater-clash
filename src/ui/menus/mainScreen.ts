/** Title screen: animated wordmark over the live attract-mode battle. */
import { button, h, raw, stagger, type Screen, type ScreenCtx } from './dom.ts';

/** Emblem behind the wordmark: a crater bowl with an impact burst and two crossing arcs. */
const EMBLEM = `<svg viewBox="0 0 400 200" aria-hidden="true">
  <defs>
    <radialGradient id="mnBurst" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff6d8" stop-opacity=".95"/>
      <stop offset=".25" stop-color="#ffc457" stop-opacity=".7"/>
      <stop offset="1" stop-color="#ff7448" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mnArcA" x1="0" x2="1"><stop offset="0" stop-color="#3fc1ff" stop-opacity="0"/><stop offset="1" stop-color="#b5ecff"/></linearGradient>
    <linearGradient id="mnArcB" x1="1" x2="0"><stop offset="0" stop-color="#ff7448" stop-opacity="0"/><stop offset="1" stop-color="#ffc6a8"/></linearGradient>
  </defs>
  <path class="mn-emb__arc mn-emb__arc--a" d="M-10 190 Q 90 -30 200 92" stroke="url(#mnArcA)"/>
  <path class="mn-emb__arc mn-emb__arc--b" d="M410 190 Q 310 -30 200 92" stroke="url(#mnArcB)"/>
  <circle class="mn-emb__burst" cx="200" cy="92" r="70" fill="url(#mnBurst)"/>
  <circle class="mn-emb__ring" cx="200" cy="92" r="40" fill="none" stroke="#ffe7b0" stroke-width="2"/>
  <path class="mn-emb__star" d="M200 50 L208 84 L242 92 L208 100 L200 134 L192 100 L158 92 L192 84 Z" fill="#fff8e6"/>
  <path class="mn-emb__star mn-emb__star--b" d="M200 70 L204 88 L222 92 L204 96 L200 114 L196 96 L178 92 L196 88 Z" fill="#ffd27a"/>
</svg>`;

export class MainScreen implements Screen {
  readonly id = 'main' as const;
  readonly el: HTMLElement;
  private readonly first: HTMLButtonElement;

  constructor(ctx: ScreenCtx) {
    const el = h('section', 'mn-screen mn-main', { 'aria-label': 'Main menu' });

    const logo = h('div', 'mn-logo st');
    logo.append(h('div', 'mn-logo__halo'), raw('div', 'mn-logo__emblem', EMBLEM));
    const word = h('h1', 'mn-logo__word', { 'aria-label': 'Crater Clash' },
      h('span', 'mn-word mn-word--a', { 'data-t': 'CRATER', 'aria-hidden': 'true' }, 'CRATER'),
      h('span', 'mn-word mn-word--b', { 'data-t': 'CLASH', 'aria-hidden': 'true' }, 'CLASH'));
    logo.append(word);
    // Ember sparks drifting up from the wordmark; positions/timings randomised once (pure CSS animation).
    const sparks = h('div', 'mn-sparks', { 'aria-hidden': 'true' });
    for (let i = 0; i < 22; i++) {
      const s = h('i');
      s.style.setProperty('--x', `${(8 + Math.random() * 84).toFixed(1)}%`);
      s.style.setProperty('--d', `${(2.4 + Math.random() * 2.8).toFixed(2)}s`);
      s.style.setProperty('--delay', `${(-Math.random() * 5).toFixed(2)}s`);
      s.style.setProperty('--dx', `${((Math.random() - 0.5) * 6).toFixed(2)}rem`);
      s.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
      sparks.append(s);
    }
    logo.append(sparks);

    const tagline = h('p', 'mn-tagline st', null, 'Two tanks. One crumbling world. ', h('b', null, null, 'Make every shell count.'));

    this.first = button({
      label: 'Play vs CPU', sub: 'Outwit the machine', icon: 'cpu', variant: 'hero', cls: 'st mn-hero--p0',
      onClick: () => { ctx.sound('open'); this.onMode?.('cpu'); ctx.go('setup'); },
    });
    const duel = button({
      label: 'Local Duel', sub: 'Two players, one screen', icon: 'user', variant: 'hero', cls: 'st mn-hero--p1',
      onClick: () => { ctx.sound('open'); this.onMode?.('duel'); ctx.go('setup'); },
    });
    const primary = h('div', 'mn-main__primary', null, this.first, duel);

    const secondary = h('div', 'mn-main__secondary', null,
      button({ label: 'How to Play', icon: 'help', variant: 'ghost', cls: 'st', onClick: () => { ctx.sound('open'); ctx.push('help'); } }),
      button({ label: 'Settings', icon: 'settings', variant: 'ghost', cls: 'st', onClick: () => { ctx.sound('open'); ctx.push('settings'); } }));

    const foot = h('footer', 'mn-foot st', null,
      h('span', 'mn-foot__hint', null, h('kbd', 'mn-kbd', null, '←'), h('kbd', 'mn-kbd', null, '→'), ' Navigate'),
      h('span', 'mn-foot__hint', null, h('kbd', 'mn-kbd', null, 'Enter'), ' Select'),
      h('span', 'mn-foot__hint mn-foot__hint--wide', null, 'Aim with ', h('kbd', 'mn-kbd', null, '←→'), ' power ', h('kbd', 'mn-kbd', null, '↑↓'), ' fire ', h('kbd', 'mn-kbd', null, 'Space')));

    el.append(h('div', 'mn-main__inner', null, logo, tagline, primary, secondary), foot);
    stagger(el);
    this.el = el;
  }

  /** Set by the controller so the setup screen knows which mode was chosen. */
  onMode: ((mode: 'cpu' | 'duel') => void) | null = null;

  enter(): void {}

  initialFocus(): HTMLElement {
    return this.first;
  }
}
