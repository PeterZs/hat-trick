// Gamepad navigation for DOM menus: D-pad / left stick moves a highlighted
// focus between buttons and inputs (spatially), A activates, B goes back.
// Left/right adjusts selects, sliders and number fields.

const FOCUSABLE = 'button, select, input, a[href], [data-mode]';

type Dir = 'up' | 'down' | 'left' | 'right';

export class GamepadNav {
  private focused: HTMLElement | null = null;
  private prev = new Map<string, boolean>();
  private held: { dir: Dir | null; since: number; last: number } = { dir: null, since: 0, last: 0 };
  /** Returns the container to navigate, or null when menus aren't active. */
  constructor(private root: () => HTMLElement | null, private onBack: () => void) {}

  /** True while a menu is being navigated (game input from pads should be ignored). */
  get active(): boolean { return !!this.root(); }

  update(now = performance.now()): void {
    const root = this.root();
    const pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
    if (!root || pads.length === 0) { this.setFocus(null); this.prev.clear(); return; }

    const btn = (i: number) => pads.some((p) => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); });
    const axis = (i: number) => pads.reduce((m, p) => (Math.abs(p.axes[i] ?? 0) > Math.abs(m) ? p.axes[i] ?? 0 : m), 0);
    const edge = (key: string, down: boolean) => { const r = down && !this.prev.get(key); this.prev.set(key, down); return r; };

    let dir: Dir | null = null;
    const ax = axis(0), ay = axis(1);
    if (btn(12) || ay < -0.6) dir = 'up';
    else if (btn(13) || ay > 0.6) dir = 'down';
    else if (btn(14) || ax < -0.6) dir = 'left';
    else if (btn(15) || ax > 0.6) dir = 'right';

    // Keep focus valid (menus re-render their DOM).
    if (!this.focused || !root.contains(this.focused) || !visible(this.focused)) this.setFocus(this.reacquire(root));

    // Direction with key-repeat.
    if (dir !== this.held.dir) {
      this.held = { dir, since: now, last: now };
      if (dir) this.move(root, dir);
    } else if (dir && now - this.held.since > 380 && now - this.held.last > 110) {
      this.held.last = now;
      this.move(root, dir);
    }

    if (edge('a', btn(0))) this.activate(root);
    if (edge('b', btn(1))) this.onBack();
  }

  private move(root: HTMLElement, dir: Dir): void {
    const el = this.focused;
    if (el && (dir === 'left' || dir === 'right') && adjust(el, dir === 'right' ? 1 : -1)) return;
    const next = el ? spatialNext(root, el, dir) : firstFocusable(root);
    if (next) this.setFocus(next);
  }

  private activate(root: HTMLElement): void {
    const el = this.focused;
    if (!el) return;
    const key = keyOf(el);
    if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number'))) {
      adjust(el, 1);
    } else if (el instanceof HTMLInputElement && el.type === 'text') {
      el.focus();
    } else {
      el.click();
    }
    // Clicking may re-render the menu: re-find the same control.
    if (!root.contains(el) && key) {
      const again = root.querySelector<HTMLElement>(key);
      if (again) this.setFocus(again);
    }
  }

  private reacquire(root: HTMLElement): HTMLElement | null {
    const key = this.focused ? keyOf(this.focused) : null;
    if (key) { const again = root.querySelector<HTMLElement>(key); if (again && visible(again)) return again; }
    return root.querySelector<HTMLElement>('button.primary:not([disabled])') ?? firstFocusable(root);
  }

  private setFocus(el: HTMLElement | null): void {
    if (this.focused === el) return;
    this.focused?.classList.remove('gp-focus');
    this.focused = el;
    if (el) {
      el.classList.add('gp-focus');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
}

function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function firstFocusable(root: HTMLElement): HTMLElement | null {
  return focusables(root)[0] ?? null;
}

/** Nearest focusable in a direction, preferring alignment with the current one. */
function spatialNext(root: HTMLElement, from: HTMLElement, dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of focusables(root)) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    let main: number, cross: number;
    switch (dir) {
      case 'up': main = -dy; cross = dx; break;
      case 'down': main = dy; cross = dx; break;
      case 'left': main = -dx; cross = dy; break;
      case 'right': main = dx; cross = dy; break;
    }
    if (main <= 4) continue;
    const score = main + Math.abs(cross) * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/** Left/right on value controls. Returns true if the element consumed it. */
function adjust(el: HTMLElement, step: number): boolean {
  if (el instanceof HTMLSelectElement) {
    const n = el.options.length;
    el.selectedIndex = (el.selectedIndex + step + n) % n;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number')) {
    if (step > 0) el.stepUp(); else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return false;
  return false;
}

/** A selector that finds "the same" control after a re-render. */
function keyOf(el: HTMLElement): string | null {
  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith('data-')) {
      const v = el.getAttribute(attr);
      return v ? `[${attr}="${CSS.escape(v)}"]` : `[${attr}]`;
    }
  }
  return null;
}
