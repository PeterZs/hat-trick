// Global keyboard/mouse state shared by keyboard-based devices.

export const keys = new Set<string>();
/** Keys pressed since the last endFrame(), so taps shorter than a frame still register. */
const tapped = new Set<string>();
export const mouse = { x: 0, y: 0, buttons: 0, tapped: 0, moved: false, inside: false };

/** Call once per animation frame after inputs were read. */
export function endInputFrame(): void {
  tapped.clear();
  mouse.tapped = 0;
}

export function mouseButtons(): number {
  return mouse.buttons | mouse.tapped;
}

let installed = false;
export function installKeyboard(canvas: HTMLElement): void {
  if (installed) return;
  installed = true;
  const isTyping = () => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  };
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    keys.add(e.code);
    tapped.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.buttons = 0; });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.moved = true; mouse.inside = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.buttons = e.buttons; mouse.tapped |= e.buttons; mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
  });
  window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') mouse.buttons = e.buttons; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function anyKey(...codes: string[]): boolean {
  for (const c of codes) if (keys.has(c) || tapped.has(c)) return true;
  return false;
}
