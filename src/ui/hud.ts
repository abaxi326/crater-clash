/**
 * In-game HUD: player cards, wind gauge, control dock, weapon picker, banners, toasts, pause and FPS.
 * DOM lives in #hud (pointer-events: none on the container; interactive parts opt back in).
 * update() runs every frame and only writes to the DOM when a displayed value changes.
 */
import './base.css';
import './hud.css';
import type { GameApi, HudApi, UiActions } from '../contracts.ts';
import { BIOMES } from '../core/biomes.ts';
import type { GameEvent } from '../core/events.ts';
import type { GameState, PlayerIndex } from '../core/types.ts';
import { WEAPONS, type WeaponId } from '../core/weapons.ts';
import { Dock } from './hud/dock.ts';
import { ClassSlot, TextSlot, button, el } from './hud/dom.ts';
import { Banner, Toasts } from './hud/overlays.ts';
import { WeaponPicker } from './hud/picker.ts';
import { PlayerCard } from './hud/playerCard.ts';
import { WindGauge } from './hud/wind.ts';
import { UI_ICONS, weaponIcon } from './icons.ts';

export class Hud implements HudApi {
  private actions: UiActions;
  private root: HTMLElement | null = null;
  private cards: PlayerCard[] = [];
  private wind!: WindGauge;
  private dock!: Dock;
  private picker!: WeaponPicker;
  private banner!: Banner;
  private toasts!: Toasts;
  private fps!: TextSlot;
  private fpsEl!: HTMLElement;
  private visible = true;
  private visibleSlot!: ClassSlot;
  private dockShown!: ClassSlot;
  private phaseSlot = '';
  private state: GameState | null = null;
  private game: GameApi | null = null;
  // FPS: frames counted over a ~0.5 s window from update dt.
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsOn: boolean | null = null;
  private fuelWarned: [boolean, boolean] = [false, false];

  constructor(actions: UiActions) {
    this.actions = actions;
  }

  mount(root: HTMLElement): void {
    const r = el('div', 'cc-hud', '', root);
    this.root = r;
    const top = el('div', 'cc-hud__top', '', r);
    this.cards = [new PlayerCard(0, top), new PlayerCard(1, top)];
    this.wind = new WindGauge(top);
    // Keep DOM order left → centre → right for screen readers and focus order.
    top.insertBefore(this.wind.root, this.cards[1].root);
    const corner = el('div', 'cc-hud__corner', '', r);
    const pause = button('cc-ibtn cc-pausebtn glass', UI_ICONS.pause, 'Pause (Esc)', corner);
    pause.addEventListener('mousedown', e => e.preventDefault());
    pause.addEventListener('click', () => {
      this.actions.uiSound('click');
      this.actions.pause();
    });
    this.fpsEl = el('div', 'cc-fps tabular', '', corner);
    this.fps = new TextSlot(this.fpsEl);
    this.toasts = new Toasts(r);
    this.banner = new Banner(r);
    this.dock = new Dock(r, this.actions, { togglePicker: () => this.toggleWeaponPicker() });
    this.picker = new WeaponPicker(r, this.actions, id => this.pick(id), () => this.toggleWeaponPicker(false));
    this.visibleSlot = new ClassSlot(r, 'is-visible');
    this.dockShown = new ClassSlot(r, 'dock-on');
    this.visibleSlot.set(this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.visibleSlot?.set(visible);
    if (!visible) this.toggleWeaponPicker(false);
  }

  reset(state: GameState): void {
    this.state = state;
    for (const c of this.cards) c.reset(state);
    this.wind.reset(state);
    this.dock.reset();
    this.banner.clear();
    this.toasts.clear();
    this.toggleWeaponPicker(false);
    this.fuelWarned = [false, false];
  }

  update(state: GameState, game: GameApi, dt: number): void {
    if (!this.root) return;
    this.state = state;
    this.game = game;
    this.updateFps(dt);
    if (!this.visible) return;
    for (const c of this.cards) c.update(state, dt);
    this.wind.update(state, dt);
    const phase = state.phase;
    const dockOn = phase !== 'intro' && phase !== 'roundOver' && phase !== 'matchOver';
    this.dockShown.set(dockOn);
    if (phase !== this.phaseSlot) {
      this.phaseSlot = phase;
      this.root.dataset.phase = phase;
    }
    this.dock.update(state, game, dt);
    if (this.picker.isOpen()) {
      if (!game.canControl()) this.toggleWeaponPicker(false);
      else this.picker.sync(state.tanks[state.activePlayer]);
    }
    this.banner.update(dt);
    this.toasts.update(dt);
  }

  toggleWeaponPicker(open?: boolean): void {
    if (!this.picker) return;
    const want = open ?? !this.picker.isOpen();
    if (want === this.picker.isOpen()) return;
    if (want) {
      if (!this.state || !this.game || !this.game.canControl() || !this.visible) {
        if (open === undefined) this.actions.uiSound('error');
        return;
      }
      this.picker.open(this.state.tanks[this.state.activePlayer]);
      this.actions.uiSound('open');
    } else {
      this.picker.close();
      this.actions.uiSound('close');
    }
  }

  isWeaponPickerOpen(): boolean {
    return this.picker?.isOpen() ?? false;
  }

  private pick(id: WeaponId): void {
    const g = this.game;
    if (g && g.canControl()) {
      g.selectWeapon(id);
      this.actions.uiSound('select');
    }
    this.toggleWeaponPicker(false);
  }

  private updateFps(dt: number): void {
    const on = this.actions.getSettings().showFps;
    if (on !== this.fpsOn) {
      this.fpsOn = on;
      this.fpsEl.classList.toggle('is-on', on);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (!on || dt <= 0) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fps.set(`${fps} FPS`);
      this.fpsEl.classList.toggle('is-bad', fps < 50);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  handleEvent(e: GameEvent, state: GameState): void {
    if (!this.root) return;
    this.state = state;
    const attract = state.config.attract;
    switch (e.type) {
      case 'roundStart': {
        const need = state.config.roundsToWin;
        const [a, b] = state.wins;
        let sub = '';
        if (!attract && need > 1) {
          if (a === need - 1 && b === need - 1) sub = 'Decider';
          else if (a === need - 1 || b === need - 1) sub = 'Match point';
          else if (e.round === 1) sub = `First to ${need}`;
        }
        this.banner.showRound(e.round, BIOMES[e.biome]?.name ?? '', sub);
        this.fuelWarned = [false, false];
        break;
      }
      case 'turnStart': {
        const p = state.config.players[e.player];
        const human = p.kind === 'human';
        const humans = state.config.players[0].kind === 'human' && state.config.players[1].kind === 'human';
        // Solo games read "Your turn" for the human; hot-seat games always name the player.
        const title = human && !humans ? 'Your turn' : `${p.name}'s turn`;
        const sub = human ? (e.turn === 1 ? 'Drag to aim · Space to fire' : '') : `CPU · ${p.difficulty}`;
        if (!attract) this.banner.showTurn(e.player, title, sub);
        this.wind.changed(e.wind, e.previousWind);
        break;
      }
      case 'weaponSelect':
        this.dock.onWeaponSelect();
        break;
      case 'fire':
        this.dock.onFire(e.player, e.power);
        this.toggleWeaponPicker(false);
        break;
      case 'damage':
        if (e.amount > 0 || e.absorbed > 0) this.cards[e.target].hit(e.amount >= 25);
        break;
      case 'heal':
        this.cards[e.target].heal();
        if (!attract) this.toast(e.target, UI_ICONS.heart, `Repaired <b>+${Math.round(e.amount)}</b>`, 'good');
        break;
      case 'shieldUp':
        if (!attract) this.toast(e.target, UI_ICONS.shield, `Shield up <b>+${Math.round(e.amount)}</b>`, 'shield');
        break;
      case 'shieldBreak':
        if (!attract) this.toast(e.target, UI_ICONS.shield, 'Shield broken', 'bad');
        break;
      case 'crate':
        if (attract) break;
        if (e.phase === 'collect' && e.by !== null) {
          const w = WEAPONS[e.weapon];
          this.toast(e.by, weaponIcon(e.weapon, 24), `<b>+${e.amount}</b> ${w.name}`, 'good', w.color);
        } else if (e.phase === 'spawn') {
          this.toasts.show(null, UI_ICONS.crate, 'Supply drop incoming', 'info');
        }
        break;
      case 'drive': {
        const t = state.tanks[e.player];
        if (!e.moving && t.fuel <= 0.5 && !this.fuelWarned[e.player] && state.config.players[e.player].kind === 'human') {
          this.fuelWarned[e.player] = true;
          this.toast(e.player, UI_ICONS.fuel, 'Out of fuel', 'bad');
        }
        break;
      }
      case 'roundOver':
      case 'matchOver':
        this.toggleWeaponPicker(false);
        this.banner.clear();
        break;
    }
  }

  private toast(player: PlayerIndex, icon: string, html: string, tone: 'good' | 'bad' | 'info' | 'shield', accent?: string): void {
    this.toasts.show(player, icon, html, tone, accent);
  }
}
