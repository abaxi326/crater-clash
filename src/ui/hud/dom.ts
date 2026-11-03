/** Small DOM helpers for the HUD: element creation and change-only writes (no layout reads). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export function button(cls: string, html: string, label: string, parent?: HTMLElement): HTMLButtonElement {
  const b = el('button', cls, html, parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

/** Caches the last written value per element/property so per-frame updates only touch the DOM on change. */
export class TextSlot {
  private last = '\u0000';
  readonly node: HTMLElement;
  constructor(node: HTMLElement) {
    this.node = node;
  }
  set(v: string): void {
    if (v === this.last) return;
    this.last = v;
    this.node.textContent = v;
  }
}

export class StyleSlot {
  private last = '\u0000';
  private node: HTMLElement;
  private prop: string;
  constructor(node: HTMLElement, prop: string) {
    this.node = node;
    this.prop = prop;
  }
  set(v: string): void {
    if (v === this.last) return;
    this.last = v;
    this.node.style.setProperty(this.prop, v);
  }
}

/** Toggles a class only when the boolean changes. */
export class ClassSlot {
  private last: boolean | null = null;
  private node: HTMLElement;
  private cls: string;
  constructor(node: HTMLElement, cls: string) {
    this.node = node;
    this.cls = cls;
  }
  set(on: boolean): void {
    if (on === this.last) return;
    this.last = on;
    this.node.classList.toggle(this.cls, on);
  }
}

/** Restarts a CSS animation class (forces a style flush only on this element, only when triggered). */
export function retrigger(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** 3-decimal string for CSS numbers so tiny float noise does not cause DOM writes. */
export const f3 = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/**
 * Press-and-hold auto-repeat for buttons. One step on press, then after a delay steps at an
 * accelerating rate; advanced from the HUD's frame update so it is frame-rate independent.
 */
export class HoldRepeat {
  private held = -1;
  private acc = 0;
  private pointer = -1;
  private fn: (steps: number) => void;
  private target: HTMLElement;

  constructor(target: HTMLElement, fn: (steps: number) => void) {
    this.target = target;
    this.fn = fn;
    target.addEventListener('pointerdown', this.down);
    target.addEventListener('pointerup', this.up);
    target.addEventListener('pointercancel', this.up);
    target.addEventListener('lostpointercapture', this.up);
    target.addEventListener('contextmenu', e => e.preventDefault());
    // Keyboard activation (focus + Enter/Space) does a single step.
    target.addEventListener('click', e => {
      if (e.detail === 0) this.fn(1);
    });
  }

  get active(): boolean {
    return this.held >= 0;
  }

  private down = (e: PointerEvent): void => {
    if (e.button !== 0 || this.held >= 0 || (this.target as HTMLButtonElement).disabled) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.held = 0;
    this.acc = 0;
    this.target.classList.add('is-held');
    this.fn(1);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.cancel();
  };

  cancel(): void {
    if (this.held < 0) return;
    this.held = -1;
    this.pointer = -1;
    this.target.classList.remove('is-held');
  }

  update(dt: number): void {
    if (this.held < 0) return;
    if ((this.target as HTMLButtonElement).disabled) {
      this.cancel();
      return;
    }
    this.held += dt;
    if (this.held < 0.3) return;
    const ramp = Math.min(1, (this.held - 0.3) / 1.3);
    this.acc += (10 + 34 * ramp * ramp) * dt;
    const n = Math.floor(this.acc);
    if (n > 0) {
      this.acc -= n;
      this.fn(n);
    }
  }
}
