/** Match setup: players, CPU difficulty, battlefield, rules, Start Battle. */
import { BIOMES, BIOME_IDS, type BiomeDef, type BiomeId } from '../../core/biomes.ts';
import type { Difficulty, MatchConfig } from '../../core/types.ts';
import { button, h, header, iconEl, segmented, stagger, toggle, type Screen, type ScreenCtx, type Segmented } from './dom.ts';

export type SetupMode = 'cpu' | 'duel';
type BiomeChoice = BiomeId | 'random';

const THUMB_W = 384;
const THUMB_H = 216;
const NAME_MAX = 16;

const NOTES: Record<Difficulty | 'duel', [string, string]> = {
  easy: ['Rookie gunner', 'Loose aim and wild guesses. Perfect for learning the ropes.'],
  normal: ['Seasoned gunner', 'Solid aim that sharpens as the round goes on.'],
  hard: ['Sharpshooter', 'Reads wind and terrain like a map. Rarely misses twice.'],
  duel: ['Hot-seat duel', 'Take turns on one keyboard, or pass the device between shots.'],
};

/** Short physics summary for a biome card, e.g. ['Low gravity', 'No wind']. */
export function biomeModifiers(b: BiomeDef): string[] {
  const g = b.gravityScale < 0.9 ? 'Low gravity' : b.gravityScale > 1.02 ? 'Heavy gravity' : 'Normal gravity';
  const w = b.windScale === 0 ? 'No wind' : b.windScale > 1.05 ? 'Gusty winds' : b.windScale < 0.95 ? 'Calmer winds' : 'Normal wind';
  return [g, w];
}

/** CSS stand-in for a biome preview when the renderer cannot provide one. */
function fallbackThumb(b: BiomeDef): HTMLElement {
  const p = b.palette;
  const el = h('div', 'mn-biome__fallback');
  el.style.background =
    `radial-gradient(circle at 72% 30%, ${p.celestial} 0 6%, ${p.celestialGlow}88 7%, transparent 22%),` +
    `linear-gradient(176deg, transparent 0 58%, ${p.far[1]} 58.5% 64%, transparent 64.5%),` +
    `linear-gradient(183deg, transparent 0 66%, ${p.surface} 66.5% 71%, ${p.strata[0]} 71.5% 82%, ${p.strata[2]} 82.5%),` +
    `linear-gradient(180deg, ${p.sky[0]}, ${p.sky[1]} 40%, ${p.sky[2]} 62%)`;
  return el;
}

export class SetupScreen implements Screen {
  readonly id = 'setup' as const;
  readonly el: HTMLElement;
  private mode: SetupMode = 'cpu';
  private difficulty: Difficulty = 'normal';
  private biome: BiomeChoice = 'random';
  private rounds = 2;
  private crates = true;
  private p1Edited = false;
  private readonly ctx: ScreenCtx;
  private readonly kicker: HTMLElement;
  private readonly p1: HTMLInputElement;
  private readonly p2: HTMLInputElement;
  private readonly p2Card: HTMLElement;
  private readonly p2Role: HTMLElement;
  private readonly p2Icon: HTMLElement;
  private readonly diffWrap: HTMLElement;
  private readonly diff: Segmented<Difficulty>;
  private readonly cards = new Map<BiomeChoice, HTMLButtonElement>();
  private readonly thumbs: HTMLElement[] = [];
  private thumbsLoaded = false;
  private readonly start: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly noteTitle: HTMLElement;
  private readonly noteText: HTMLElement;

  constructor(ctx: ScreenCtx) {
    this.ctx = ctx;
    const el = h('section', 'mn-screen mn-setup', { 'aria-label': 'Match setup' });
    const head = header('Prepare for Battle', 'Play vs CPU', () => ctx.back());
    this.kicker = head.querySelector('.mn-kicker') as HTMLElement;

    // --- Players -----------------------------------------------------------------------
    this.p1 = h('input', 'mn-input', { type: 'text', maxlength: NAME_MAX, 'aria-label': 'Player 1 name', spellcheck: 'false', autocomplete: 'off' });
    this.p1.addEventListener('input', () => { this.p1Edited = true; });
    this.p2 = h('input', 'mn-input', { type: 'text', maxlength: NAME_MAX, 'aria-label': 'Player 2 name', spellcheck: 'false', autocomplete: 'off' });
    for (const inp of [this.p1, this.p2]) {
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); this.start.focus(); } });
    }
    const p1Card = h('div', 'mn-player mn-player--p0 st', null,
      h('div', 'mn-player__top', null, iconEl('user', 'mn-player__ico'), h('span', 'mn-player__role', null, 'Player 1 · Azure')),
      this.p1);
    this.p2Icon = iconEl('cpu', 'mn-player__ico');
    this.p2Role = h('span', 'mn-player__role', null, 'CPU · Blaze');
    this.diff = segmented<Difficulty>('CPU difficulty', [
      { value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' },
    ], this.difficulty, v => { this.difficulty = v; this.paintNote(); }, s => ctx.sound(s));
    this.diffWrap = h('div', 'mn-player__diff', null, h('span', 'mn-mini-label', null, 'Difficulty'), this.diff.el);
    this.p2Card = h('div', 'mn-player mn-player--p1 st', null,
      h('div', 'mn-player__top', null, this.p2Icon, this.p2Role), this.p2, this.diffWrap);
    const vs = h('div', 'mn-vs st', { 'aria-hidden': 'true' }, h('span', null, null, 'VS'));
    this.noteTitle = h('b');
    this.noteText = h('span');
    this.note = h('div', 'mn-note st', null, iconEl('help', 'mn-note__ico'), h('div', 'mn-note__body', null, this.noteTitle, this.noteText));
    const players = h('div', 'mn-panel mn-setup__players', null,
      h('h3', 'mn-panel__title st', null, 'Combatants'), h('div', 'mn-players', null, p1Card, vs, this.p2Card), this.note);

    // --- Battlefield -------------------------------------------------------------------
    const grid = h('div', 'mn-biomes', { role: 'radiogroup', 'aria-label': 'Battlefield' });
    grid.append(this.card('random', 'Surprise Me', 'A new battlefield every round.', ['Mixed'], this.randomThumb()));
    for (const id of BIOME_IDS) {
      const b = BIOMES[id];
      const slot = h('div', 'mn-biome__thumbslot');
      this.thumbs.push(slot);
      grid.append(this.card(id, b.name, b.tagline, biomeModifiers(b), slot));
    }
    const field = h('div', 'mn-panel mn-setup__field', null, h('h3', 'mn-panel__title st', null, 'Battlefield'), grid);

    // --- Rules -------------------------------------------------------------------------
    const rounds = segmented<number>('Rounds to win', [
      { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
    ], this.rounds, v => { this.rounds = v; }, s => ctx.sound(s));
    const crates = toggle('Supply crates', this.crates, v => { this.crates = v; }, s => ctx.sound(s));
    const rules = h('div', 'mn-panel mn-setup__rules', null,
      h('h3', 'mn-panel__title st', null, 'Rules'),
      h('div', 'mn-rule st', null, h('div', 'mn-rule__label', null, h('span', 'mn-row__title', null, 'Rounds to win'), h('span', 'mn-row__hint', null, 'First to win this many rounds')), rounds.el),
      h('div', 'mn-rule st', null, iconEl('crate', 'mn-rule__ico'), h('div', 'mn-rule__label', null, h('span', 'mn-row__title', null, 'Supply crates'), h('span', 'mn-row__hint', null, 'Parachuted weapons, free to grab')), crates.el));

    this.start = button({ label: 'Start Battle', icon: 'play', variant: 'primary', cls: 'mn-start st', onClick: () => this.launch() });
    const foot = h('div', 'mn-setup__foot', null, rules, this.start);

    el.append(h('div', 'mn-scroll', null, h('div', 'mn-setup__inner', null, head, h('div', 'mn-setup__grid', null, players, field), foot)));
    stagger(el);
    this.el = el;
    this.selectBiome(this.biome, false);
  }

  setMode(mode: SetupMode): void {
    if (mode !== this.mode) this.p2.value = '';
    this.mode = mode;
  }

  private card(id: BiomeChoice, name: string, tagline: string, mods: string[], thumb: HTMLElement): HTMLButtonElement {
    const chips = h('div', 'mn-biome__mods');
    for (const m of mods) chips.append(h('span', 'mn-chip', null, m));
    const b = h('button', `mn-biome mn-biome--${id} st`, { type: 'button', role: 'radio', 'aria-label': `${name}. ${tagline} ${mods.join(', ')}` },
      h('div', 'mn-biome__thumb', null, thumb, h('span', 'mn-biome__check', { 'aria-hidden': 'true' })),
      h('div', 'mn-biome__body', null, h('span', 'mn-biome__name', null, name), h('span', 'mn-biome__tag', null, tagline), chips));
    b.addEventListener('click', () => {
      if (this.biome !== id) this.ctx.sound('select');
      this.selectBiome(id, true);
    });
    this.cards.set(id, b);
    return b;
  }

  private randomThumb(): HTMLElement {
    const el = h('div', 'mn-biome__random');
    for (const id of BIOME_IDS) {
      const p = BIOMES[id].palette;
      const s = h('i');
      s.style.background = `linear-gradient(180deg, ${p.sky[0]}, ${p.sky[2]} 60%, ${p.surface} 61%, ${p.strata[1]})`;
      el.append(s);
    }
    el.append(h('span', 'mn-biome__q', { 'aria-hidden': 'true' }, '?'));
    return el;
  }

  private selectBiome(id: BiomeChoice, _user: boolean): void {
    this.biome = id;
    for (const [k, b] of this.cards) {
      b.classList.toggle('is-on', k === id);
      b.setAttribute('aria-checked', String(k === id));
    }
  }

  /** Previews are requested lazily the first time the screen opens (the renderer may not exist earlier). */
  private loadThumbs(): void {
    if (this.thumbsLoaded) return;
    this.thumbsLoaded = true;
    BIOME_IDS.forEach((id, i) => {
      let node: HTMLElement;
      try {
        const c = this.ctx.actions.thumbnail(id, THUMB_W, THUMB_H);
        node = c ?? fallbackThumb(BIOMES[id]);
      } catch {
        node = fallbackThumb(BIOMES[id]);
      }
      node.classList.add('mn-biome__img');
      this.thumbs[i].replaceChildren(node);
    });
  }

  enter(): void {
    this.loadThumbs();
    const cpu = this.mode === 'cpu';
    this.kicker.textContent = cpu ? 'Play vs CPU' : 'Local Duel';
    this.el.classList.toggle('is-duel', !cpu);
    if (!this.p1Edited || !this.p1.value) this.p1.value = this.ctx.actions.getSettings().playerName;
    if (!this.p2.value) this.p2.value = cpu ? 'CPU' : 'Player 2';
    this.p2Role.textContent = cpu ? 'CPU · Blaze' : 'Player 2 · Blaze';
    this.p2Icon.innerHTML = iconEl(cpu ? 'cpu' : 'user').innerHTML;
    this.diffWrap.hidden = !cpu;
    this.p2Card.classList.toggle('is-cpu', cpu);
    this.paintNote();
  }

  private paintNote(): void {
    const [title, text] = NOTES[this.mode === 'cpu' ? this.difficulty : 'duel'];
    this.noteTitle.textContent = title;
    this.noteText.textContent = text;
    this.note.dataset.level = this.mode === 'cpu' ? this.difficulty : 'duel';
  }

  private launch(): void {
    const settings = this.ctx.actions.getSettings();
    const n1 = this.p1.value.trim().slice(0, NAME_MAX) || settings.playerName;
    const n2 = this.p2.value.trim().slice(0, NAME_MAX) || (this.mode === 'cpu' ? 'CPU' : 'Player 2');
    // Player 1's name doubles as the profile name.
    if (n1 !== settings.playerName) this.ctx.actions.applySettings({ ...settings, playerName: n1 });
    const config: MatchConfig = {
      players: [
        { name: n1, kind: 'human', difficulty: this.difficulty },
        { name: n2, kind: this.mode === 'cpu' ? 'cpu' : 'human', difficulty: this.difficulty },
      ],
      biome: this.biome,
      roundsToWin: this.rounds,
      crates: this.crates,
      seed: Math.floor(Math.random() * 0x7fffffff),
      attract: false,
    };
    this.ctx.sound('start');
    this.ctx.actions.startMatch(config);
    if (this.ctx.current() === 'setup') this.ctx.hideAll();
  }

  initialFocus(): HTMLElement {
    return this.start;
  }
}
