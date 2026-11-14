// Virtual touchpad controls for phones/tablets: a floating move stick on the
// left half, and on the right an aim/throw stick plus action buttons.

import { BTN_ATTACK, BTN_DASH, BTN_INTERACT, BTN_THROW, makeInput, type PlayerInput } from '../sim/input';

interface Stick { id: number; ox: number; oy: number; x: number; y: number; el: HTMLElement; knob: HTMLElement }

export class TouchControls {
  enabled = false;
  root: HTMLElement;
  private move: Stick | null = null;
  private aim: Stick | null = null;
  private buttons = 0;
  private joinFlag = false;
  private joinBtn: HTMLElement;
  private lastAim: [number, number] = [0, 0];
  private aimRelease = 0; // frames to keep THROW released after a drag

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-root';
    this.root.innerHTML = `
      <div class="touch-zone touch-left"></div>
      <div class="touch-btns">
        <div class="tbtn tbtn-throw" data-b="throw"><span>THROW</span><small>hold to aim</small></div>
        <div class="tbtn tbtn-attack" data-b="attack">SLASH</div>
        <div class="tbtn tbtn-dash" data-b="dash">DASH</div>
        <div class="tbtn tbtn-interact" data-b="interact">RIDE</div>
      </div>
      <div class="tbtn tbtn-join">TAP TO JOIN</div>`;
    parent.appendChild(this.root);
    this.joinBtn = this.root.querySelector('.tbtn-join')!;
    this.joinBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.joinFlag = true; });

    const left = this.root.querySelector('.touch-left') as HTMLElement;
    left.addEventListener('pointerdown', (e) => {
      if (this.move) return;
      e.preventDefault();
      left.setPointerCapture(e.pointerId);
      this.move = this.makeStick(e);
    });
    left.addEventListener('pointermove', (e) => this.dragStick(this.move, e));
    const endMove = (e: PointerEvent) => { if (this.move?.id === e.pointerId) { this.move.el.remove(); this.move = null; } };
    left.addEventListener('pointerup', endMove);
    left.addEventListener('pointercancel', endMove);

    for (const el of this.root.querySelectorAll<HTMLElement>('.touch-btns .tbtn')) {
      const kind = el.dataset.b!;
      const bit = kind === 'attack' ? BTN_ATTACK : kind === 'dash' ? BTN_DASH : kind === 'interact' ? BTN_INTERACT : BTN_THROW;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('down');
        this.buttons |= bit;
        if (bit === BTN_THROW) {
          this.aim = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, el: document.createElement('div'), knob: document.createElement('div') };
        }
      });
      if (bit === BTN_THROW) el.addEventListener('pointermove', (e) => {
        if (!this.aim || this.aim.id !== e.pointerId) return;
        const dx = e.clientX - this.aim.ox, dy = e.clientY - this.aim.oy;
        const l = Math.hypot(dx, dy);
        if (l > 12) { this.aim.x = dx / l; this.aim.y = dy / l; }
      });
      const up = (e: PointerEvent) => {
        el.classList.remove('down');
        this.buttons &= ~bit;
        if (bit === BTN_THROW && this.aim?.id === e.pointerId) {
          this.lastAim = [this.aim.x, this.aim.y];
          this.aimRelease = 2;
          this.aim = null;
        }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    const enable = () => this.setEnabled(true);
    window.addEventListener('touchstart', enable, { once: true, passive: true });
    if (new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches) this.setEnabled(true);
    else this.refresh();
  }

  private makeStick(e: PointerEvent): Stick {
    const el = document.createElement('div');
    el.className = 'tstick';
    const knob = document.createElement('div');
    knob.className = 'tknob';
    el.appendChild(knob);
    el.style.left = e.clientX + 'px';
    el.style.top = e.clientY + 'px';
    this.root.appendChild(el);
    return { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, el, knob };
  }

  private dragStick(s: Stick | null, e: PointerEvent): void {
    if (!s || s.id !== e.pointerId) return;
    const R = 55;
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      // Drag the stick base along (floating stick).
      s.ox += (dx / l) * (l - R); s.oy += (dy / l) * (l - R);
      s.el.style.left = s.ox + 'px'; s.el.style.top = s.oy + 'px';
      dx = (dx / l) * R; dy = (dy / l) * R;
    }
    s.x = dx / R; s.y = dy / R;
    s.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private inGame = false;
  private joined = false;

  setEnabled(on: boolean): void {
    this.enabled = on;
    document.body.classList.toggle('touch', on);
    this.refresh();
  }

  setJoined(joined: boolean, inGame: boolean): void {
    if (joined === this.joined && inGame === this.inGame) return;
    this.joined = joined; this.inGame = inGame;
    this.refresh();
  }

  private refresh(): void {
    this.root.style.display = this.enabled && this.inGame ? '' : 'none';
    this.joinBtn.style.display = !this.joined ? '' : 'none';
    this.root.querySelector<HTMLElement>('.touch-btns')!.style.display = this.joined ? '' : 'none';
    this.root.querySelector<HTMLElement>('.touch-left')!.style.display = this.joined ? '' : 'none';
    if (!this.joined) { this.move?.el.remove(); this.move = null; this.aim = null; this.buttons = 0; }
  }

  update(): void {}

  read(): PlayerInput {
    const mx = this.move?.x ?? 0, my = this.move?.y ?? 0;
    let ax = 0, ay = 0, b = this.buttons;
    if (this.aim) { ax = this.aim.x; ay = this.aim.y; }
    else if (this.aimRelease > 0) { this.aimRelease--; [ax, ay] = this.lastAim; b &= ~BTN_THROW; }
    return makeInput(mx, my, ax, ay, b);
  }

  consumeJoin(): boolean { const j = this.joinFlag; this.joinFlag = false; return j; }
}
