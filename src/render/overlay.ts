/**
 * In-world overlay (world-space, drawn after weather): aim guide with a ghost of the previous
 * shot, the active-tank chevron and name tag, the CPU "thinking" dots and edge arrows for
 * projectiles above the view. Sizes are expressed in CSS pixels so they stay readable at any zoom.
 */
import { rgba } from '../core/color.ts';
import { turretPivot } from '../core/geometry.ts';
import { TAU, clamp, easeOutBack, smoothstep } from '../core/math.ts';
import { TEAMS, type TeamColors } from '../core/teams.ts';
import type { GameState } from '../core/types.ts';
import { WEAPONS } from '../core/weapons.ts';
import type { GameApi, RenderFrame, ViewInfo } from '../contracts.ts';
import { ctx2d, makeCanvas } from './terrainLayer.ts';

const AIM_LEN = { off: 0, short: 260, full: 2600 } as const;
const DOT_SPACING = 17;
const GHOST_DASH: number[] = [7, 9];
const NO_DASH: number[] = [];
const SPR = 3; // sprite supersampling

interface TagSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

function dotSprite(team: TeamColors): HTMLCanvasElement {
  const c = makeCanvas(32, 32);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.28, team.light);
  gr.addColorStop(0.45, rgba(team.primary, 0.75));
  gr.addColorStop(1, rgba(team.glow, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function chevronSprite(team: TeamColors): HTMLCanvasElement {
  const w = 26, h = 20;
  const c = makeCanvas(w * SPR, h * SPR);
  const g = ctx2d(c);
  g.scale(SPR, SPR);
  g.lineJoin = 'round';
  const path = (): void => {
    g.beginPath();
    g.moveTo(3, 4);
    g.lineTo(13, 13);
    g.lineTo(23, 4);
    g.lineTo(23, 8.5);
    g.lineTo(13, 17.5);
    g.lineTo(3, 8.5);
    g.closePath();
  };
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.translate(0, 1.4);
  path();
  g.fill();
  g.translate(0, -1.4);
  const gr = g.createLinearGradient(0, 3, 0, 18);
  gr.addColorStop(0, team.light);
  gr.addColorStop(0.5, team.primary);
  gr.addColorStop(1, team.dark);
  g.fillStyle = gr;
  path();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 1;
  g.stroke();
  return c;
}

export class Overlay {
  private readonly dots: [HTMLCanvasElement, HTMLCanvasElement];
  private readonly chevrons: [HTMLCanvasElement, HTMLCanvasElement];
  private readonly tags = new Map<string, TagSprite>();
  private fontsReady = false;

  constructor() {
    this.dots = [dotSprite(TEAMS[0]), dotSprite(TEAMS[1])];
    this.chevrons = [chevronSprite(TEAMS[0]), chevronSprite(TEAMS[1])];
  }

  private tag(name: string, team: TeamColors): TagSprite {
    if (!this.fontsReady && typeof document !== 'undefined' && document.fonts?.check?.('600 13px Outfit')) {
      this.fontsReady = true;
      this.tags.clear();
    }
    const key = `${team.index}:${name}`;
    let t = this.tags.get(key);
    if (t) return t;
    const font = '600 13px Outfit, "DM Sans", system-ui, sans-serif';
    const probe = ctx2d(makeCanvas(1, 1));
    probe.font = font;
    const tw = Math.ceil(probe.measureText(name).width);
    const w = tw + 26, h = 24;
    const c = makeCanvas(w * SPR, h * SPR);
    const g = ctx2d(c);
    g.scale(SPR, SPR);
    // Dark glass pill with a team-colour dot.
    const pill = (): void => {
      g.beginPath();
      g.roundRect(1, 1, w - 2, h - 2, (h - 2) / 2);
    };
    g.fillStyle = 'rgba(8,12,22,0.72)';
    pill();
    g.fill();
    g.strokeStyle = rgba(team.primary, 0.7);
    g.lineWidth = 1.2;
    pill();
    g.stroke();
    g.fillStyle = team.primary;
    g.beginPath();
    g.arc(11, h / 2, 3.2, 0, TAU);
    g.fill();
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = '#f4f7ff';
    g.fillText(name, 18, h / 2 + 0.5);
    t = { canvas: c, w, h };
    if (this.tags.size > 16) this.tags.clear();
    this.tags.set(key, t);
    return t;
  }

  /** World-space overlay. */
  draw(ctx: CanvasRenderingContext2D, view: ViewInfo, state: GameState, game: GameApi, frame: RenderFrame): void {
    // World units per CSS pixel, clamped so markers neither vanish nor balloon.
    const k = view.dpr / view.scale;
    const ui = clamp(k, 0.8, 2.6);
    const time = view.time;
    const tank = state.tanks[state.activePlayer];
    const team = TEAMS[state.activePlayer];
    const aiming = state.phase === 'aiming' && !state.paused;
    ctx.globalCompositeOperation = 'source-over';

    if (frame.showAimGuide && aiming && tank.alive && !frame.attract) {
      this.drawGhost(ctx, game.lastShotPath(state.activePlayer), ui);
      const len = AIM_LEN[frame.settings.aimGuide];
      if (len > 0) this.drawAim(ctx, game.aimGuide(len), len, state.activePlayer, ui, time, team);
    }
    if (!frame.attract && tank.alive && (aiming || state.phase === 'turnEnd')) {
      this.drawMarker(ctx, state, ui, time);
    }
    this.drawOffscreen(ctx, view, state, ui, time);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawGhost(ctx: CanvasRenderingContext2D, path: readonly { x: number; y: number }[], ui: number): void {
    if (path.length < 2) return;
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * ui;
    ctx.lineCap = 'round';
    GHOST_DASH[0] = 7 * ui;
    GHOST_DASH[1] = 9 * ui;
    ctx.setLineDash(GHOST_DASH);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;
  }

  private drawAim(ctx: CanvasRenderingContext2D, pts: readonly { x: number; y: number }[], maxLen: number, player: 0 | 1, ui: number, time: number, team: TeamColors): void {
    if (pts.length < 2) return;
    // Total length (to fade relative to the visible arc).
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (total < 1) return;
    const fadeLen = Math.min(total, maxLen);
    const sprite = this.dots[player];
    const spacing = DOT_SPACING * Math.max(1, ui * 0.8);
    // Dots march outward along the arc.
    let next = (time * 34) % spacing;
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
      const seg = Math.hypot(bx - ax, by - ay);
      while (next <= walked + seg) {
        const f = seg > 0 ? (next - walked) / seg : 0;
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        const u = next / fadeLen;
        const a = smoothstep(0, 0.06, u) * Math.pow(Math.max(0, 1 - u), 1.15);
        if (a > 0.01) {
          const r = (3.4 + 2.2 * (1 - u)) * ui;
          ctx.globalAlpha = Math.min(1, a * 1.05);
          ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
        }
        next += spacing;
      }
      walked += seg;
    }
    // Landing reticle when the predicted path ends on something before the guide length.
    if (total < maxLen - 12) {
      const end = pts[pts.length - 1];
      const a = 0.35 + 0.65 * Math.pow(Math.max(0, 1 - total / fadeLen), 0.5);
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = team.light;
      ctx.lineWidth = 1.6 * ui;
      ctx.beginPath();
      ctx.arc(end.x, end.y, (7 + pulse * 3) * ui, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.arc(end.x, end.y, (13 + pulse * 5) * ui, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawMarker(ctx: CanvasRenderingContext2D, state: GameState, ui: number, time: number): void {
    const tank = state.tanks[state.activePlayer];
    const team = TEAMS[state.activePlayer];
    const pivot = turretPivot(tank);
    const appear = state.phase === 'aiming' ? clamp(state.phaseTime / 0.35, 0, 1) : 1;
    const pop = easeOutBack(appear);
    const bob = Math.sin(time * 3.4) * 3.2 * ui;
    const baseY = pivot.y - 40 - 16 * ui + bob;
    // Chevron.
    const cw = 26 * ui * pop, ch = 20 * ui * pop;
    ctx.globalAlpha = appear;
    ctx.drawImage(this.chevrons[state.activePlayer], tank.x - cw / 2, baseY - ch / 2, cw, ch);

    // Name tag early in the turn; CPU thinking dots while the CPU plans.
    const thinking = state.cpuThinking && state.phase === 'aiming';
    const dotsA = thinking ? smoothstep(0.15, 0.5, state.phaseTime) : 0;
    const tagA = state.phase === 'aiming' ? (1 - smoothstep(2.2, 2.8, state.phaseTime)) * (1 - dotsA) * appear : 0;
    const pillY = baseY - ch / 2 - 15 * ui;
    if (tagA > 0.01) {
      const name = state.config.players[state.activePlayer].name;
      const tag = this.tag(name, team);
      const w = tag.w * ui * 0.9, h = tag.h * ui * 0.9;
      ctx.globalAlpha = tagA;
      ctx.drawImage(tag.canvas, tank.x - w / 2, pillY - h / 2 + (1 - tagA) * 6 * ui, w, h);
    }
    if (dotsA > 0.01) {
      const w = 40 * ui, h = 18 * ui;
      ctx.globalAlpha = dotsA * 0.78;
      ctx.fillStyle = 'rgba(8,12,22,0.8)';
      ctx.beginPath();
      ctx.roundRect(tank.x - w / 2, pillY - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = dotsA;
      ctx.fillStyle = team.light;
      for (let i = 0; i < 3; i++) {
        const ph = time * 7 - i * 0.9;
        const lift = Math.max(0, Math.sin(ph)) * 3.2 * ui;
        const r = (2.1 + Math.max(0, Math.sin(ph)) * 0.6) * ui;
        ctx.beginPath();
        ctx.arc(tank.x + (i - 1) * 9 * ui, pillY - lift + 0.5 * ui, r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOffscreen(ctx: CanvasRenderingContext2D, view: ViewInfo, state: GameState, ui: number, time: number): void {
    const ps = state.projectiles;
    let shown = 0;
    for (let i = 0; i < ps.length && shown < 6; i++) {
      const p = ps[i];
      if (p.y > view.top + 6 * ui) continue;
      shown++;
      const x = clamp(p.x, view.left + 26 * ui, view.right - 26 * ui);
      const y = view.top + 20 * ui;
      const color = WEAPONS[p.weapon].color;
      const pulse = 0.85 + 0.15 * Math.sin(time * 9 + p.id);
      const s = 9 * ui * pulse;
      // Arrow.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(8,12,22,0.65)';
      ctx.beginPath();
      ctx.arc(x, y + 4 * ui, 15 * ui, 0, TAU);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 * ui;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.85, y + s * 0.55);
      ctx.lineTo(x, y + s * 0.15);
      ctx.lineTo(x - s * 0.85, y + s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Altitude above the view edge.
      const alt = Math.max(0, Math.round((view.top - p.y) / 10) * 10);
      ctx.font = `600 ${Math.round(11 * ui)}px Outfit, "DM Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(`${alt}`, x + 0.8 * ui, y + 16 * ui + 0.8 * ui);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${alt}`, x, y + 16 * ui);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }
}
