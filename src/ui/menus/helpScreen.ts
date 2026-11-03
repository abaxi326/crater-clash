/** How to Play: illustrated basics + controls, and the weapon roster. */
import { WEAPONS, WEAPON_ORDER, type WeaponCategory } from '../../core/weapons.ts';
import { h, header, raw, stagger, type Screen, type ScreenCtx } from './dom.ts';
import { weaponIcon } from './iconProvider.ts';

const G = '<path d="M0 74 C 30 66 46 70 70 64 S 120 70 160 60 V 90 H 0 Z" fill="url(#hg)"/>';
const DEFS = '<defs><linearGradient id="hg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6e8c63"/><stop offset=".1" stop-color="#4c5f45"/><stop offset="1" stop-color="#252c25"/></linearGradient></defs>';
const tank = (x: number, y: number, c: string, a = -40): string =>
  `<g transform="translate(${x} ${y})"><rect x="-9" y="-4" width="18" height="5" rx="2.5" fill="#1b2230"/>` +
  `<path d="M-8 -4 L-6 -9 H6 L8 -4 Z" fill="${c}"/><circle cy="-9" r="4" fill="${c}"/>` +
  `<rect x="0" y="-10.2" width="10" height="2.4" rx="1.2" fill="${c}" transform="rotate(${a} 0 -9)"/></g>`;

const ILLU = {
  aim: `<svg viewBox="0 0 160 90">${DEFS}${G}
    <path d="M30 56 Q 78 -6 128 58" fill="none" stroke="#ffc457" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
    <path d="M44 66 A 14 14 0 0 0 38 54" fill="none" stroke="#b5ecff" stroke-width="1.6"/>
    ${tank(30, 68, '#3fc1ff', -52)}${tank(130, 62, '#ff7448', -140)}
    <circle cx="128" cy="58" r="9" fill="#ffc457" opacity=".35"/><circle cx="128" cy="58" r="4" fill="#fff4d6"/>
    <rect x="12" y="10" width="40" height="5" rx="2.5" fill="#ffffff22"/><rect x="12" y="10" width="28" height="5" rx="2.5" fill="#ffc457"/></svg>`,
  wind: `<svg viewBox="0 0 160 90">${DEFS}${G}
    <g stroke="#b5ecff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".75">
      <path d="M20 22 H70 a6 6 0 1 0 -6 -6"/><path d="M34 34 H96"/><path d="M50 46 H88 a6 6 0 1 1 -6 6"/></g>
    <path d="M30 62 Q 60 0 120 50" fill="none" stroke="#ffc457" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
    <path d="M30 62 Q 60 6 92 58" fill="none" stroke="#ffffff55" stroke-width="1.5" stroke-dasharray="3 4"/>
    <path d="M128 18 l10 4 -10 4z" fill="#ff7448"/><path d="M128 16 V 44" stroke="#dfe7f5" stroke-width="1.6"/>
    ${tank(30, 68, '#3fc1ff', -60)}</svg>`,
  terrain: `<svg viewBox="0 0 160 90"><defs><linearGradient id="hg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c98a52"/><stop offset=".12" stop-color="#8e5a36"/><stop offset="1" stop-color="#3c2418"/></linearGradient></defs>
    <path d="M0 52 H58 A22 22 0 0 0 102 52 H160 V90 H0 Z" fill="url(#hg2)"/>
    <path d="M60 52 A20 20 0 0 0 100 52" fill="none" stroke="#ff8a3d" stroke-width="2.4" opacity=".9"/>
    <rect x="72" y="26" width="14" height="10" rx="2" fill="#a86c40" transform="rotate(14 79 31)"/>
    <rect x="92" y="18" width="8" height="7" rx="1.5" fill="#8e5a36" transform="rotate(-20 96 21)"/>
    <path d="M79 40 v8 M96 30 v10" stroke="#ffffffaa" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="2 3"/>
    ${tank(122, 52, '#ff7448', -150)}${tank(30, 52, '#3fc1ff', -40)}</svg>`,
  crates: `<svg viewBox="0 0 160 90">${DEFS}${G}
    <path d="M58 30 Q 80 2 102 30 Z" fill="#ffc457"/><path d="M58 30 Q 80 14 102 30" fill="#ff8a3d"/>
    <path d="M60 30 L74 52 M100 30 L86 52 M80 30 V52" stroke="#e8ecf5" stroke-width="1.2"/>
    <rect x="70" y="50" width="20" height="16" rx="2.5" fill="#9c6b3f" stroke="#ffd28a" stroke-width="1.4"/>
    <path d="M70 58 H90 M80 50 V66" stroke="#ffd28a" stroke-width="1.2"/>
    <g fill="#fff4d6"><circle cx="50" cy="20" r="1.4"/><circle cx="112" cy="40" r="1.2"/><circle cx="118" cy="16" r="1"/></g></svg>`,
};

const TIPS: { illu: keyof typeof ILLU; title: string; text: string }[] = [
  { illu: 'aim', title: 'Aim, power, fire', text: 'Set the barrel angle and shot power, then fire. Take turns until one tank is left standing.' },
  { illu: 'wind', title: 'Read the wind', text: 'Wind changes every turn and bends every shell. Watch the gauge and lead your shots.' },
  { illu: 'terrain', title: 'The ground fights back', text: 'Blasts carve craters, dirt collapses and tanks fall. Dig your enemy out, or bury them.' },
  { illu: 'crates', title: 'Grab the crates', text: 'Supply crates parachute in. Hit one with a blast or a shell to claim the weapon inside.' },
];

const CONTROLS: [string, string, string, string][] = [
  ['Aim', '← →', 'Drag on the battlefield', 'Drag'],
  ['Fine aim', 'Shift + ← →', '', ''],
  ['Power', '↑ ↓', 'Drag further / closer', 'Drag'],
  ['Drive', 'A  D', 'Move buttons', 'Move buttons'],
  ['Weapon', 'Q  E  ·  Tab', 'Wheel · Weapon button', 'Weapon button'],
  ['Fire', 'Space · Enter', 'Fire button', 'Fire button'],
  ['Pause', 'Esc · P', 'Pause button', 'Pause button'],
];

const CATEGORY: Record<WeaponCategory, string> = {
  shell: 'Shell', cluster: 'Cluster', trick: 'Trick shot', elemental: 'Elemental', terrain: 'Terrain', utility: 'Utility',
};

const keys = (s: string): HTMLElement => {
  const wrap = h('span', 'mn-keys');
  if (!s) { wrap.append(h('span', 'mn-dim', null, '—')); return wrap; }
  for (const part of s.split(/\s+/)) {
    if (part === '·' || part === '+') wrap.append(h('span', 'mn-dim', null, part));
    else wrap.append(h('kbd', 'mn-kbd', null, part));
  }
  return wrap;
};

export class HelpScreen implements Screen {
  readonly id = 'help' as const;
  readonly el: HTMLElement;
  private readonly ctx: ScreenCtx;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly pages: HTMLElement[] = [];
  private readonly scroll: HTMLElement;
  private page = 0;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const el = h('section', 'mn-screen mn-help', { 'aria-label': 'How to play' });
    const head = header('How to Play', 'Field manual', () => ctx.back());
    const tabbar = h('div', 'mn-tabs st', { role: 'tablist' });
    ['Basics', 'Arsenal'].forEach((label, i) => {
      const t = h('button', 'mn-tab', { type: 'button', role: 'tab', id: `mn-tab-${i}`, 'aria-controls': `mn-page-${i}` }, label);
      const pick = (): void => { if (this.page !== i) { ctx.sound('select'); this.setPage(i); } };
      t.addEventListener('click', pick);
      // Arrow-key focus switches tabs immediately (standard tablist behaviour).
      t.addEventListener('focus', pick);
      this.tabs.push(t);
      tabbar.append(t);
    });
    head.append(tabbar);

    // Basics
    const tips = h('div', 'mn-tips');
    for (const t of TIPS) {
      tips.append(h('article', 'mn-tip st', null,
        raw('div', 'mn-tip__illu', ILLU[t.illu]), h('h4', 'mn-tip__title', null, t.title), h('p', 'mn-tip__text', null, t.text)));
    }
    const table = h('div', 'mn-controls st', { role: 'table', 'aria-label': 'Controls' });
    table.append(h('div', 'mn-controls__row mn-controls__head', { role: 'row' },
      h('span', null, { role: 'columnheader' }, ''), h('span', null, { role: 'columnheader' }, 'Keyboard'),
      h('span', null, { role: 'columnheader' }, 'Mouse'), h('span', null, { role: 'columnheader' }, 'Touch')));
    for (const [what, kb, mouse, touch] of CONTROLS) {
      table.append(h('div', 'mn-controls__row', { role: 'row' },
        h('span', 'mn-controls__what', { role: 'rowheader' }, what), h('span', null, { role: 'cell' }, keys(kb)),
        h('span', 'mn-controls__txt', { role: 'cell' }, mouse || '—'), h('span', 'mn-controls__txt', { role: 'cell' }, touch || '—')));
    }
    const basics = h('div', 'mn-page', { role: 'tabpanel', id: 'mn-page-0', 'aria-labelledby': 'mn-tab-0' },
      tips, h('h3', 'mn-panel__title st', null, 'Controls'), table);

    // Arsenal
    const roster = h('div', 'mn-roster');
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const card = h('article', 'mn-weapon st', { 'aria-label': `${w.name}: ${w.tagline}` });
      card.style.setProperty('--wc', w.color);
      card.style.setProperty('--wg', w.glow);
      const ammo = w.ammo === Infinity ? '∞' : String(w.ammo);
      card.append(
        raw('div', 'mn-weapon__ico', weaponIcon(id, 40)),
        h('div', 'mn-weapon__body', null,
          h('div', 'mn-weapon__name', null, w.name),
          h('div', 'mn-weapon__tag', null, w.tagline),
          h('div', 'mn-weapon__meta tabular', null,
            h('span', 'mn-chip mn-chip--w', null, CATEGORY[w.category]),
            w.damage > 0 ? h('span', 'mn-weapon__stat', { title: 'Damage' }, `${w.damage} dmg`) : null,
            h('span', 'mn-weapon__stat', { title: 'Ammo per round' }, `×${ammo}`))));
      card.title = w.description;
      roster.append(card);
    }
    const arsenal = h('div', 'mn-page', { role: 'tabpanel', id: 'mn-page-1', 'aria-labelledby': 'mn-tab-1' },
      h('p', 'mn-help__lead st', null, 'Eighteen ways to ruin a landscape. The Ember Shell never runs out; everything else is limited per round, and crates bring more.'), roster);

    this.pages.push(basics, arsenal);
    this.scroll = h('div', 'mn-scroll mn-help__scroll', null, basics, arsenal);
    el.append(h('div', 'mn-help__inner', null, head, this.scroll));
    stagger(el);
    this.el = el;
    this.setPage(0);
  }

  setPage(i: number): void {
    this.page = i;
    this.tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.classList.toggle('is-on', k === i);
      t.tabIndex = k === i ? 0 : -1;
    });
    this.pages.forEach((p, k) => {
      p.hidden = k !== i;
      if (k === i) {
        // Replay the staggered entrance for the newly shown page.
        p.classList.remove('is-anim');
        stagger(p);
        void p.offsetWidth;
        p.classList.add('is-anim');
      }
    });
    this.scroll.scrollTop = 0;
    this.el.style.setProperty('--tab', String(i));
  }

  enter(): void {
    this.setPage(0);
  }

  initialFocus(): HTMLElement {
    return this.tabs[0];
  }
}
