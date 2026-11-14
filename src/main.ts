// App shell: menu <-> game, the fixed-timestep loop, devices -> session -> renderer.

import './style.css';
import { Renderer } from './render/renderer';
import { LocalSession, type Session } from './net/session';
import { RollbackSession } from './net/rollback';
import { hostRoom, joinRoom, randomRoomCode } from './net/peerLink';
import { DeviceManager, type AimContext } from './input/devices';
import { endInputFrame, installKeyboard, keys } from './input/keyboard';
import { TouchControls } from './input/touch';
import { NEUTRAL, type PlayerInput } from './sim/input';
import { BALLS, HZ, MAX_PLAYERS } from './sim/const';
import { createState } from './sim/sim';
import type { Command, MatchConfig } from './sim/types';
import { Menu } from './ui/menu';
import { Hud } from './ui/hud';
import { SettingsPanel } from './ui/settings';
import { loadPrefs, savePrefs } from './ui/prefs';
import { playEvent, setVolume, unlockAudio } from './audio/sfx';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const hudRoot = document.getElementById('hud')!;
const prefs = loadPrefs();
setVolume(prefs.volume);

const renderer = new Renderer(canvas, document.getElementById('labels')!);
renderer.opts.showHitboxes = prefs.showHitboxes;
installKeyboard(canvas);
const touch = new TouchControls(document.body);
touch.setJoined(false, false);
const devices = new DeviceManager(touch);

let session: Session | null = null;
let roomCode = '';
const pendingJoin = new Map<string, number>(); // device -> time requested

const settings = new SettingsPanel(uiRoot, prefs);
settings.onParams = (p) => { if (session?.isHost) session.command({ t: 'params', params: p }); };
settings.onPrefs = (p) => { setVolume(p.volume); renderer.opts.showHitboxes = p.showHitboxes; };

const hud = new Hud(hudRoot, () => ({
  peer: session?.peer ?? 0,
  isHost: session?.isHost ?? true,
  online: session?.online ?? false,
  roomCode,
  status: session?.status() ?? '',
  command: (c: Command) => session?.command(c),
  openSettings: () => settings.toggle(),
  quit: () => quitToMenu(),
}));
hud.show(false);

const menu = new Menu(uiRoot, prefs, {
  playLocal: (cfg) => startSession(new LocalSession(cfg, settings.params)),
  host: (cfg) => void hostOnline(cfg),
  join: (code) => void joinOnline(code),
  openSettings: () => settings.toggle(true),
});

// Backdrop: a demo match with bots behind the menu.
function demoSession(): Session {
  const s = new LocalSession({ mode: 'ffa', level: 'courtyard', winScore: 99 }, settings.params);
  for (let i = 0; i < 4; i++) s.command({ t: 'addBot' });
  return s;
}
let demo: Session | null = demoSession();

function startSession(s: Session): void {
  savePrefs(prefs);
  demo?.dispose(); demo = null;
  session?.dispose();
  session = s;
  pendingJoin.clear();
  menu.show(false);
  hud.show(true);
  unlockAudio();
}

function quitToMenu(error = ''): void {
  session?.dispose();
  session = null;
  roomCode = '';
  hud.show(false);
  menu.show(true, error);
  touch.setJoined(false, false);
  demo = demoSession();
  if (location.search) history.replaceState(null, '', location.pathname);
}

async function hostOnline(cfg: MatchConfig): Promise<void> {
  menu.show(true, 'Creating room…');
  try {
    const code = randomRoomCode();
    const link = await hostRoom(code);
    roomCode = code;
    const state = createState(cfg, settings.params, (Math.random() * 2 ** 32) >>> 0);
    const s = new RollbackSession(link, state, { inputDelay: prefs.inputDelay });
    startSession(s);
  } catch (e) {
    menu.show(true, 'Could not host: ' + (e as Error).message);
  }
}

async function joinOnline(code: string): Promise<void> {
  menu.show(true, `Joining ${code}…`);
  try {
    const link = await joinRoom(code);
    roomCode = code;
    const s = new RollbackSession(link, null, { inputDelay: prefs.inputDelay });
    s.onHostLost = (reason) => quitToMenu(reason);
    startSession(s);
  } catch (e) {
    menu.show(true, 'Could not join: ' + (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Devices -> commands/inputs

const aimCtx: AimContext = {
  playerPos: (device) => {
    const s = session?.state;
    if (!s) return null;
    const p = s.players.find((p) => p.active && p.peer === session!.peer && p.device === device);
    return p ? { x: p.x, y: p.y } : null;
  },
  screenToWorld: (x, y) => renderer.screenToWorld(x, y),
};

function localName(): string {
  const s = session!.state;
  const mine = s.players.filter((p) => p.active && p.peer === session!.peer && !p.isBot).length;
  return mine === 0 ? prefs.name : `${prefs.name} ${mine + 1}`;
}

function handleDevices(): Record<string, PlayerInput> {
  const inputs: Record<string, PlayerInput> = {};
  if (!session || !session.state) return inputs;
  const s = session.state;
  const now = performance.now();
  let touchJoined = false;
  for (const d of devices.devices) {
    if (!d.connected()) continue;
    const p = s.players.find((p) => p.active && p.peer === session!.peer && p.device === d.key);
    if (d.key === 'touch') touchJoined = !!p;
    if (!p) {
      if (hud.paused || settings.open && d.kind !== 'pad') continue;
      if (d.joinPressed() && now - (pendingJoin.get(d.key) ?? 0) > 1000) {
        if (s.players.filter((q) => q.active).length >= MAX_PLAYERS) continue;
        pendingJoin.set(d.key, now);
        session.command({ t: 'join', device: d.key, name: localName(), ball: (s.players.length * 3 + devices.devices.indexOf(d)) % BALLS.length });
      }
      continue;
    }
    if (d.leavePressed()) { session.command({ t: 'leave', device: d.key }); continue; }
    if (s.phase === 'lobby') {
      const cb = d.cycleBall();
      if (cb) session.command({ t: 'setBall', device: d.key, ball: (p.ball + cb + BALLS.length) % BALLS.length });
      if (d.cycleTeam()) session.command({ t: 'setTeam', device: d.key, team: (p.team + 1) % (s.cfg.mode === 'teams' ? 4 : 2) });
    }
  }
  touch.setJoined(touchJoined, true);
  return inputs;
}

function pollInputs(): Record<string, PlayerInput> {
  const inputs: Record<string, PlayerInput> = {};
  if (!session || !session.state) return inputs;
  const s = session.state;
  for (const d of devices.devices) {
    if (!d.connected()) continue;
    const p = s.players.find((p) => p.active && p.peer === session!.peer && p.device === d.key);
    if (!p) continue;
    inputs[d.key] = hud.paused ? NEUTRAL : d.poll(aimCtx);
  }
  return inputs;
}

// Global keys.
const edges = new Set<string>();
function pressedOnce(code: string): boolean {
  const down = keys.has(code);
  if (down && !edges.has(code)) { edges.add(code); return true; }
  if (!down) edges.delete(code);
  return false;
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('pointerdown', () => unlockAudio(), { once: false });
window.addEventListener('keydown', () => unlockAudio());

// ---------------------------------------------------------------------------
// Main loop: fixed 60 Hz simulation, render every animation frame.

const FRAME_MS = 1000 / HZ;
let acc = 0;
let last = performance.now();
const seenEvents = new Map<string, number>();

function loop(now: number): void {
  requestAnimationFrame(loop);
  const elapsed = Math.min(250, now - last);
  last = now;
  acc += elapsed;

  devices.update();
  if (pressedOnce('Backquote')) settings.toggle();
  if (pressedOnce('Escape') && session) hud.togglePause();

  const active = session ?? demo;
  if (session) handleDevices();
  let ticks = 0;
  while (acc >= FRAME_MS && ticks < 8) {
    acc -= FRAME_MS;
    ticks++;
    if (active) active.tick(session ? pollInputs() : {});
    // Taps are only latched for the first tick; then real key state applies.
    endInputFrame();
  }
  if (ticks >= 8) acc = 0;

  if (active && active.state) {
    const s = active.state;
    if (session) settings.setLive(s.params, !session.isHost);
    for (const { frame, ev } of active.takeEvents()) {
      const key = frame + JSON.stringify(ev);
      if (seenEvents.has(key)) continue;
      seenEvents.set(key, frame);
      renderer.onEvent(s, ev);
      if (session) playEvent(ev);
    }
    if (seenEvents.size > 2000) for (const [k, f] of seenEvents) if (f < s.frame - 300) seenEvents.delete(k);
    renderer.sync(s, elapsed / 1000);
    if (session) hud.update(s);
  }
  renderer.render(elapsed / 1000);
}
requestAnimationFrame(loop);

// Deep link: ?join=CODE
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) void joinOnline(joinCode.toUpperCase());
