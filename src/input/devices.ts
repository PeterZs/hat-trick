// Input devices. Each device produces one PlayerInput per frame for the player
// it controls. Devices are identified by a stable key ('kbm', 'kb2', 'pad0',
// 'touch') that, together with the peer id, identifies the player in the sim.

import { BTN_ATTACK, BTN_DASH, BTN_THROW, makeInput, NEUTRAL, type PlayerInput } from '../sim/input';
import { anyKey, keys, mouse, mouseButtons } from './keyboard';
import type { TouchControls } from './touch';

export interface AimContext {
  /** World position of the player controlled by a device, if any. */
  playerPos(device: string): { x: number; y: number } | null;
  screenToWorld(cx: number, cy: number): { x: number; y: number } | null;
}

export interface Device {
  key: string;
  label: string;
  kind: 'kbm' | 'kb2' | 'pad' | 'touch';
  /** Called once per frame before reading. */
  update(): void;
  poll(ctx: AimContext): PlayerInput;
  joinPressed(): boolean;
  leavePressed(): boolean;
  /** Start/menu button (gamepads). */
  menuPressed(): boolean;
  /** Lobby navigation: -1/+1 to cycle character, team. */
  cycleBall(): number;
  cycleTeam(): number;
  connected(): boolean;
}

class Edge {
  // Starts 'held': a button already down when a device first appears (e.g. a
  // controller resting on something) must not count as a press.
  private prev = true;
  rise(now: boolean): boolean { const r = now && !this.prev; this.prev = now; return r; }
}

export class KeyboardMouseDevice implements Device {
  key = 'kbm'; label = 'Keyboard + Mouse'; kind = 'kbm' as const;
  private join = new Edge(); private leave = new Edge(); private ballL = new Edge(); private ballR = new Edge(); private team = new Edge();
  private j = false; private l = false; private bl = 0; private t = 0;
  update(): void {
    this.j = this.join.rise(anyKey('Enter', 'KeyE', 'Space', 'KeyC', 'KeyV', 'KeyB') || (mouseButtons() & 1) === 1);
    this.l = this.leave.rise(anyKey('Backspace'));
    this.bl = this.ballL.rise(anyKey('KeyQ')) ? -1 : this.ballR.rise(anyKey('KeyR')) ? 1 : 0;
    this.t = this.team.rise(anyKey('KeyT')) ? 1 : 0;
  }
  poll(ctx: AimContext): PlayerInput {
    const mx = (anyKey('KeyD') ? 1 : 0) - (anyKey('KeyA') ? 1 : 0);
    const my = (anyKey('KeyS') ? 1 : 0) - (anyKey('KeyW') ? 1 : 0);
    let ax = 0, ay = 0;
    const pos = ctx.playerPos(this.key);
    if (pos && mouse.inside) {
      const w = ctx.screenToWorld(mouse.x, mouse.y);
      if (w) { ax = w.x - pos.x; ay = w.y - pos.y; if (Math.hypot(ax, ay) < 0.3) { ax = 0; ay = 0; } }
    }
    let b = 0;
    // C/V/B = dash/slash/throw; Space also slashes, left click throws, right click slashes.
    if ((mouseButtons() & 2) || anyKey('KeyV', 'Space')) b |= BTN_ATTACK;
    if ((mouseButtons() & 1) || anyKey('KeyB')) b |= BTN_THROW;
    if (anyKey('KeyC')) b |= BTN_DASH;
    return makeInput(mx, my, ax, ay, b);
  }
  joinPressed() { return this.j; }
  leavePressed() { return this.l; }
  menuPressed() { return false; }
  cycleBall() { return this.bl; }
  cycleTeam() { return this.t; }
  connected() { return true; }
}

/** A second player on the same keyboard: arrows + . / , */
export class Keyboard2Device implements Device {
  key = 'kb2'; label = 'Keyboard (arrows)'; kind = 'kb2' as const;
  private join = new Edge(); private leave = new Edge(); private ballL = new Edge(); private ballR = new Edge(); private team = new Edge();
  private j = false; private l = false; private bl = 0; private t = 0;
  update(): void {
    this.j = this.join.rise(anyKey('Period', 'Slash', 'ShiftRight'));
    this.l = this.leave.rise(anyKey('Delete'));
    this.bl = this.ballL.rise(anyKey('BracketLeft')) ? -1 : this.ballR.rise(anyKey('BracketRight')) ? 1 : 0;
    this.t = this.team.rise(anyKey('Backslash')) ? 1 : 0;
  }
  poll(): PlayerInput {
    const mx = (anyKey('ArrowRight') ? 1 : 0) - (anyKey('ArrowLeft') ? 1 : 0);
    const my = (anyKey('ArrowDown') ? 1 : 0) - (anyKey('ArrowUp') ? 1 : 0);
    let b = 0;
    if (anyKey('Period')) b |= BTN_ATTACK;
    if (anyKey('Slash')) b |= BTN_THROW;
    if (anyKey('Comma', 'ShiftRight')) b |= BTN_DASH;
    return makeInput(mx, my, 0, 0, b);
  }
  joinPressed() { return this.j; }
  leavePressed() { return this.l; }
  menuPressed() { return false; }
  cycleBall() { return this.bl; }
  cycleTeam() { return this.t; }
  connected() { return true; }
}

const DEAD = 0.22;
function stick(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  if (l < DEAD) return [0, 0];
  const s = Math.min(1, (l - DEAD) / (1 - DEAD)) / l;
  return [x * s, y * s];
}

export class GamepadDevice implements Device {
  kind = 'pad' as const;
  key: string; label: string;
  private pad: Gamepad | null = null;
  private join = new Edge(); private leave = new Edge(); private ballL = new Edge(); private ballR = new Edge(); private team = new Edge();
  private j = false; private l = false; private bl = 0; private t = 0;
  private menu = new Edge(); private m = false;
  constructor(public index: number) { this.key = 'pad' + index; this.label = 'Gamepad ' + (index + 1); }
  private btn(i: number): boolean { const b = this.pad?.buttons[i]; return !!b && (b.pressed || b.value > 0.35); }
  update(): void {
    this.pad = navigator.getGamepads?.()[this.index] ?? null;
    if (this.pad) this.label = this.pad.id.replace(/\(.*\)/, '').trim().slice(0, 24) || 'Gamepad ' + (this.index + 1);
    this.j = this.join.rise(this.btn(9) || this.btn(0));
    this.m = this.menu.rise(this.btn(9));
    this.l = this.leave.rise(this.btn(8));
    this.bl = this.ballL.rise(this.btn(14)) ? -1 : this.ballR.rise(this.btn(15)) ? 1 : 0;
    this.t = this.team.rise(this.btn(12) || this.btn(13)) ? 1 : 0;
  }
  poll(): PlayerInput {
    const p = this.pad;
    if (!p) return NEUTRAL;
    const [mx, my] = stick(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const [ax, ay] = stick(p.axes[2] ?? 0, p.axes[3] ?? 0);
    let b = 0;
    // Face buttons: Y slash, X throw, B dash (A is free: it joins and selects in menus).
    // Shoulders/triggers: RB slash, LB dash, LT/RT throw.
    if (this.btn(1) || this.btn(4)) b |= BTN_DASH;
    if (this.btn(3) || this.btn(5)) b |= BTN_ATTACK;
    if (this.btn(2) || this.btn(6) || this.btn(7)) b |= BTN_THROW;
    return makeInput(mx, my, ax, ay, b);
  }
  joinPressed() { return this.j; }
  leavePressed() { return this.l; }
  menuPressed() { return this.m; }
  cycleBall() { return this.bl; }
  cycleTeam() { return this.t; }
  connected() { return !!this.pad && this.pad.connected; }
}

export class TouchDevice implements Device {
  key = 'touch'; label = 'Touch'; kind = 'touch' as const;
  constructor(private tc: TouchControls) {}
  update(): void { this.tc.update(); }
  poll(): PlayerInput { return this.tc.read(); }
  joinPressed() { return this.tc.consumeJoin(); }
  leavePressed() { return false; }
  menuPressed() { return false; }
  cycleBall() { return 0; }
  cycleTeam() { return 0; }
  connected() { return this.tc.enabled; }
}

export class DeviceManager {
  devices: Device[] = [];
  private pads = new Map<number, GamepadDevice>();
  constructor(touch: TouchControls | null) {
    this.devices.push(new KeyboardMouseDevice(), new Keyboard2Device());
    if (touch) this.devices.push(new TouchDevice(touch));
  }
  update(): void {
    const gps = navigator.getGamepads?.() ?? [];
    for (const gp of gps) {
      if (gp && !this.pads.has(gp.index)) {
        const d = new GamepadDevice(gp.index);
        this.pads.set(gp.index, d);
        this.devices.push(d);
      }
    }
    for (const d of this.devices) d.update();
  }
  get(key: string): Device | undefined { return this.devices.find((d) => d.key === key); }
}

export { keys };
