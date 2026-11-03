/**
 * Keyboard + pointer input for the battlefield. Keys are tracked as held state and converted to
 * game commands in update() so repeat timing is frame-rate independent and accelerates while held.
 * The window listener runs in the bubble phase: HUD widgets (weapon picker) that consume a key call
 * stopPropagation()/preventDefault() and never reach us.
 */
import type { InputApi, InputDeps } from '../contracts.ts';
import { turretPivot } from '../core/geometry.ts';
import { clamp } from '../core/math.ts';

/** Seconds a key must be held before auto-repeat kicks in. */
const REPEAT_DELAY = 0.24;
/** Repeat rate in steps/s: starts slow, accelerates to max over RAMP_TIME. */
const RATE_START = 9;
const RATE_MAX = 46;
const RATE_FINE_START = 7;
const RATE_FINE_MAX = 22;
const RAMP_TIME = 1.4;
/** World units of drag distance for full power. */
const DRAG_FULL_POWER = 420;
/** Minimum drag distance before the angle follows the pointer (avoids jitter near the pivot). */
const DRAG_DEADZONE = 10;
const TICK_INTERVAL = 0.065;
const WHEEL_CYCLE_INTERVAL = 0.14;

interface Axis {
  /** -1, 0, +1 from the held keys (last pressed wins). */
  dir: -1 | 0 | 1;
  held: number;
  acc: number;
}

const isTextTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
};

export class Input implements InputApi {
  private deps: InputDeps;
  private target: HTMLElement | null = null;
  private keys = new Set<string>();
  /** Order in which direction keys were pressed so the most recent one wins. */
  private angle: Axis = { dir: 0, held: 0, acc: 0 };
  private power: Axis = { dir: 0, held: 0, acc: 0 };
  private fine = false;
  private moveSent: -1 | 0 | 1 = 0;
  private lastLeftRight: 'l' | 'r' | null = null;
  private lastUpDown: 'u' | 'd' | null = null;
  private lastDrive: -1 | 1 | null = null;
  private tickCooldown = 0;
  private wheelCooldown = 0;
  private dragId = -1;

  constructor(deps: InputDeps) {
    this.deps = deps;
  }

  attach(target: HTMLElement): void {
    this.detach();
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('lostpointercapture', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    // Stop page scroll / pinch zoom / double-tap zoom / context menu on the battlefield.
    target.addEventListener('touchstart', this.prevent, { passive: false });
    target.addEventListener('touchmove', this.prevent, { passive: false });
    target.addEventListener('gesturestart', this.prevent as EventListener, { passive: false });
    target.addEventListener('dblclick', this.prevent);
    target.addEventListener('contextmenu', this.prevent);
    target.style.touchAction = 'none';
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.releaseAll);
    const t = this.target;
    if (t) {
      t.removeEventListener('pointerdown', this.onPointerDown);
      t.removeEventListener('pointermove', this.onPointerMove);
      t.removeEventListener('pointerup', this.onPointerUp);
      t.removeEventListener('pointercancel', this.onPointerUp);
      t.removeEventListener('lostpointercapture', this.onPointerUp);
      t.removeEventListener('wheel', this.onWheel);
      t.removeEventListener('touchstart', this.prevent);
      t.removeEventListener('touchmove', this.prevent);
      t.removeEventListener('gesturestart', this.prevent as EventListener);
      t.removeEventListener('dblclick', this.prevent);
      t.removeEventListener('contextmenu', this.prevent);
    }
    this.target = null;
    this.releaseAll();
  }

  update(dt: number): void {
    if (this.tickCooldown > 0) this.tickCooldown -= dt;
    if (this.wheelCooldown > 0) this.wheelCooldown -= dt;
    const game = this.deps.game;
    const control = game.canControl() && !this.deps.isBlocked();
    if (!control) {
      // Control lost (turn ended, menu opened): forget the drive intent so it is re-sent later.
      if (this.moveSent !== 0 && game.canControl()) game.setMove(0);
      this.moveSent = 0;
      this.angle.held = this.power.held = 0;
      this.angle.acc = this.power.acc = 0;
      return;
    }
    this.stepAxis(this.angle, dt, true);
    this.stepAxis(this.power, dt, false);
    const drive: -1 | 0 | 1 = this.keys.has('drive-l') || this.keys.has('drive-r') ? (this.lastDrive ?? 0) : 0;
    if (drive !== this.moveSent) {
      game.setMove(drive);
      this.moveSent = drive;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Held-key repeat

  private stepAxis(axis: Axis, dt: number, isAngle: boolean): void {
    if (axis.dir === 0) {
      axis.held = 0;
      axis.acc = 0;
      return;
    }
    const first = axis.held === 0;
    axis.held += dt;
    const step = this.fine ? 0.1 : 1;
    let steps = 0;
    if (first) steps = 1;
    else if (axis.held > REPEAT_DELAY) {
      const ramp = clamp((axis.held - REPEAT_DELAY) / RAMP_TIME, 0, 1);
      const r0 = this.fine ? RATE_FINE_START : RATE_START;
      const r1 = this.fine ? RATE_FINE_MAX : RATE_MAX;
      axis.acc += (r0 + (r1 - r0) * ramp * ramp) * dt;
      steps = Math.floor(axis.acc);
      axis.acc -= steps;
    }
    if (steps > 0) this.nudge(isAngle, axis.dir * steps * step);
  }

  /** Applies an angle/power delta and plays a throttled tick if the value actually changed. */
  private nudge(isAngle: boolean, delta: number): void {
    const game = this.deps.game;
    const tank = game.state.tanks[game.state.activePlayer];
    const before = isAngle ? tank.angle : tank.power;
    if (isAngle) game.adjustAngle(delta);
    else game.adjustPower(delta);
    const after = isAngle ? tank.angle : tank.power;
    if (after !== before) this.tick();
  }

  private tick(): void {
    if (this.tickCooldown > 0) return;
    this.tickCooldown = TICK_INTERVAL;
    this.deps.uiSound('tick');
  }

  private refreshAxes(): void {
    const l = this.keys.has('angle-l'), r = this.keys.has('angle-r');
    // Left arrow swings the barrel toward the left (angle grows toward 180).
    this.angle.dir = l && r ? (this.lastLeftRight === 'l' ? 1 : -1) : l ? 1 : r ? -1 : 0;
    const u = this.keys.has('power-u'), d = this.keys.has('power-d');
    this.power.dir = u && d ? (this.lastUpDown === 'u' ? 1 : -1) : u ? 1 : d ? -1 : 0;
  }

  private releaseAll = (): void => {
    this.keys.clear();
    this.fine = false;
    this.refreshAxes();
    this.endDrag();
  };

  private prevent = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };

  // ------------------------------------------------------------------------------------------
  // Keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    this.fine = e.shiftKey;
    const code = e.code;
    if (code === 'Escape' || code === 'KeyP') {
      if (code === 'KeyP' && (isTextTarget(e.target) || this.deps.isBlocked())) return;
      if (e.repeat) return;
      e.preventDefault();
      this.releaseAll();
      this.deps.onPause();
      return;
    }
    if (isTextTarget(e.target) || this.deps.isBlocked() || e.ctrlKey || e.metaKey || e.altKey) return;
    // Space/Enter on a focused HUD button activates that button instead of firing.
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, [role="button"], [role="option"]') !== null;
    switch (code) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        if (e.repeat) return;
        const left = code === 'ArrowLeft';
        this.keys.add(left ? 'angle-l' : 'angle-r');
        this.lastLeftRight = left ? 'l' : 'r';
        this.refreshAxes();
        this.pressStep(this.angle, true);
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        if (e.repeat) return;
        const up = code === 'ArrowUp';
        this.keys.add(up ? 'power-u' : 'power-d');
        this.lastUpDown = up ? 'u' : 'd';
        this.refreshAxes();
        this.pressStep(this.power, false);
        return;
      }
      case 'KeyA':
      case 'KeyD': {
        e.preventDefault();
        if (e.repeat) return;
        const l = code === 'KeyA';
        this.keys.add(l ? 'drive-l' : 'drive-r');
        this.lastDrive = l ? -1 : 1;
        return;
      }
      case 'KeyQ':
      case 'KeyE': {
        e.preventDefault();
        if (e.repeat) return;
        if (this.deps.game.canControl()) {
          this.deps.game.cycleWeapon(code === 'KeyE' ? 1 : -1);
          this.deps.uiSound('select');
        }
        return;
      }
      case 'Tab':
      case 'KeyW': {
        e.preventDefault();
        if (e.repeat) return;
        this.deps.onToggleWeapons();
        return;
      }
      case 'Space':
      case 'Enter':
      case 'NumpadEnter': {
        if (onButton) return;
        e.preventDefault();
        if (e.repeat) return;
        if (this.deps.game.canControl()) {
          this.setMoveNow(0);
          if (!this.deps.game.fire()) this.deps.uiSound('error');
        }
        return;
      }
      case 'ShiftLeft':
      case 'ShiftRight':
        this.fine = true;
        return;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.fine = e.shiftKey;
    switch (e.code) {
      case 'ArrowLeft': this.keys.delete('angle-l'); break;
      case 'ArrowRight': this.keys.delete('angle-r'); break;
      case 'ArrowUp': this.keys.delete('power-u'); break;
      case 'ArrowDown': this.keys.delete('power-d'); break;
      case 'KeyA':
        this.keys.delete('drive-l');
        if (this.keys.has('drive-r')) this.lastDrive = 1;
        break;
      case 'KeyD':
        this.keys.delete('drive-r');
        if (this.keys.has('drive-l')) this.lastDrive = -1;
        break;
      default: return;
    }
    this.refreshAxes();
  };

  /** A fresh key press steps once immediately (so quick taps are never lost between frames). */
  private pressStep(axis: Axis, isAngle: boolean): void {
    if (axis.dir === 0 || !this.deps.game.canControl()) return;
    axis.held = 1e-6;
    axis.acc = 0;
    this.nudge(isAngle, axis.dir * (this.fine ? 0.1 : 1));
  }

  private setMoveNow(dir: -1 | 0 | 1): void {
    if (this.moveSent !== dir) this.deps.game.setMove(dir);
    this.moveSent = dir;
  }

  // ------------------------------------------------------------------------------------------
  // Pointer: drag anywhere on the battlefield to aim. Release never fires.

  private onPointerDown = (e: PointerEvent): void => {
    if (this.dragId !== -1 || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (this.deps.isBlocked() || !this.deps.game.canControl()) return;
    this.dragId = e.pointerId;
    try {
      this.target?.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; dragging still works while over the stage.
    }
    e.preventDefault();
    this.aimAt(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    if (this.deps.isBlocked() || !this.deps.game.canControl()) {
      this.endDrag();
      return;
    }
    this.aimAt(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.dragId) this.endDrag();
  };

  private endDrag(): void {
    if (this.dragId === -1) return;
    const id = this.dragId;
    this.dragId = -1;
    try {
      if (this.target?.hasPointerCapture(id)) this.target.releasePointerCapture(id);
    } catch {
      // Already released.
    }
  }

  private aimAt(clientX: number, clientY: number): void {
    const game = this.deps.game;
    const tank = game.state.tanks[game.state.activePlayer];
    const p = turretPivot(tank);
    const w = this.deps.screenToWorld(clientX, clientY);
    const dx = w.x - p.x;
    const dy = p.y - w.y; // up is positive
    const d = Math.hypot(dx, dy);
    const beforeA = tank.angle, beforeP = tank.power;
    if (d > DRAG_DEADZONE) {
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Below the pivot: pin to the nearest horizontal so the barrel never flips through the ground.
      if (deg < 0) deg = deg < -90 ? 180 : 0;
      game.setAngle(Math.round(deg * 10) / 10);
    }
    game.setPower(Math.round(clamp((d / DRAG_FULL_POWER) * 100, 0, 100) * 10) / 10);
    if (tank.angle !== beforeA || tank.power !== beforeP) this.tick();
  }

  // ------------------------------------------------------------------------------------------
  // Wheel: power; Shift+wheel cycles weapons.

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.deps.isBlocked() || !this.deps.game.canControl()) return;
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (raw === 0) return;
    if (e.shiftKey) {
      if (this.wheelCooldown > 0) return;
      this.wheelCooldown = WHEEL_CYCLE_INTERVAL;
      this.deps.game.cycleWeapon(raw > 0 ? 1 : -1);
      this.deps.uiSound('select');
      return;
    }
    // One notch (≈100 px) = 1 power; trackpads give smaller deltas and scroll proportionally.
    const px = e.deltaMode === 1 ? raw * 33 : e.deltaMode === 2 ? raw * 400 : raw;
    const delta = clamp(-px / 100, -5, 5);
    this.nudge(false, Math.abs(delta) < 0.1 ? Math.sign(delta) * 0.1 : Math.round(delta * 10) / 10);
  };
}
