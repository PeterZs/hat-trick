// App shell: menu <-> game, the fixed-timestep loop, devices -> session -> renderer.

import './style.css';
import { Renderer } from './render/renderer';
import { LocalSession, type Session } from './net/session';
import { RollbackSession } from './net/rollback';
import { cleanRoomCode, hostRoom, joinRoom, randomRoomCode } from './net/peerLink';
import { DeviceManager, type AimContext } from './input/devices';
import { anyKey, endInputFrame, installKeyboard } from './input/keyboard';
import { TouchControls } from './input/touch';
import { NEUTRAL, type PlayerInput } from './sim/input';
import { BALLS, HZ, MAX_PLAYERS } from './sim/const';
import { createState } from './sim/sim';
import type { Command, GameState, MatchConfig } from './sim/types';
import { Menu } from './ui/menu';
import { LookEditor } from './ui/lookEditor';
import { presetLook, type Look } from './sim/look';
import { Hud } from './ui/hud';
import { GamepadNav } from './ui/gamepadNav';
import { SettingsPanel } from './ui/settings';
import { loadPrefs, savePrefs } from './ui/prefs';
import * as sfxModule from './audio/sfx';
import { playCue, playEvent, setVolume, unlockAudio } from './audio/sfx';

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

/** Identifies this browser tab across reloads (sessionStorage is per tab), so
 *  an online game can hand a reloaded tab its players back. */
const TAB_ID = (() => {
  const fresh = () => Math.random().toString(36).slice(2, 12);
  try {
    let id = sessionStorage.getItem('hatTrickTab');
    if (!id) { id = fresh(); sessionStorage.setItem('hatTrickTab', id); }
    return id;
  } catch { return fresh(); }
})();
let roomCode = '';
const pendingJoin = new Map<string, number>(); // device -> time requested

const settings = new SettingsPanel(uiRoot, prefs);
settings.onParams = (p) => { if (session?.isHost) session.command({ t: 'params', params: p }); };
settings.onPrefs = (p) => {
  setVolume(p.volume);
  renderer.opts.showHitboxes = p.showHitboxes;
  renameFirstLocalPlayer(p.name);
};

/** The name setting also renames your first local player in the current game. */
function renameFirstLocalPlayer(name: string): void {
  const n = name.trim().slice(0, 16);
  if (!session?.state || !n) return;
  const p = session.state.players.find((q) => q.active && !q.isBot && q.peer === session!.peer);
  if (p && p.name !== n) session.command({ t: 'setName', device: p.device, name: n });
}

const hud = new Hud(hudRoot, () => ({
  peer: session?.peer ?? 0,
  isHost: session?.isHost ?? true,
  online: session?.online ?? false,
  roomCode,
  status: session?.status() ?? '',
  waiting: waitingText(),
  command: (c: Command) => session?.command(c),
  rememberName: (name: string) => { prefs.name = name; savePrefs(prefs); },
  openSettings: () => settings.toggle(),
  quit: () => quitToMenu(),
  editLook: (device, look, note) => editLook(device, look, note),
  savedLook: (device) => prefs.looks[device],
}));
hud.show(false);

/** 'Waiting for …' when the online game can't advance (someone's inputs are late). */
function waitingText(): string {
  if (!(session instanceof RollbackSession) || !session.started) return '';
  if (session.migrating) return '⏳ The host left — switching hosts…';
  if (performance.now() < hostNotice.until) return hostNotice.text;
  if (session.stalledMs() < 700) return '';
  const peers = session.waitingOn();
  const names = session.state.players.filter((p) => p.active && !p.isBot && peers.includes(p.peer)).map((p) => p.name);
  if (names.length) return `⏳ Waiting for ${names.join(', ')}…`;
  return peers.includes(session.host) ? '⏳ Waiting for the host…' : '⏳ Waiting for a player who is joining…';
}

const menu = new Menu(uiRoot, prefs, {
  playLocal: (cfg) => startSession(new LocalSession(cfg, settings.params)),
  online: (cfg, code) => void playOnline(cfg, code),
  openSettings: () => settings.toggle(true),
  customize: () => editLook(),
});

// Character editor. Looks are remembered per local device and applied when
// that device joins; editing one in a game updates it for everyone.
const lookEditor = new LookEditor(uiRoot);
const myPlayer = (device: string) => session?.state?.players.find((p) => p.active && !p.isBot && p.peer === session!.peer && p.device === device);
function editLook(device?: string, start?: Look, note?: string): void {
  const connected = devices.devices.filter((d) => d.connected() || d.key === 'kbm');
  // Default: the device being edited, else one of ours in the game, else the first.
  const dev = device ?? connected.find((d) => myPlayer(d.key))?.key ?? connected[0].key;
  const lookFor = (k: string) => prefs.looks[k] ?? (myPlayer(k) ? hudLook(myPlayer(k)!) : presetLook(devices.devices.findIndex((d) => d.key === k)));
  lookEditor.show({
    look: start ?? lookFor(dev),
    devices: device ? connected.filter((d) => d.key === device) : connected.map((d) => ({ key: d.key, label: d.label })),
    device: dev,
    lookFor,
    note,
    onSave: (look, key) => {
      prefs.looks[key] = look;
      savePrefs(prefs);
      if (myPlayer(key)) session!.command({ t: 'setLook', device: key, look });
    },
  });
}
const hudLook = (p: { look: Look | null; ball: number }) => p.look ?? presetLook(p.ball);

// Gamepads drive the menus: main menu, pause menu, and the settings panel.
const nav = new GamepadNav(
  // While playing, the settings panel is left to mouse/keyboard so pads keep
  // controlling their players (tune params while playing).
  () => lookEditor.open ? lookEditor.el : !session ? (settings.open ? settings.el : menu.el) : hud.paused ? hud.pauseEl : null,
  () => { if (lookEditor.open) lookEditor.close(); else if (!session && settings.open) settings.toggle(false); else if (hud.paused) hud.togglePause(false); },
);

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
  (window as unknown as { session: Session }).session = s; // for debugging in the console
  pendingJoin.clear();
  pendingNames.clear();
  for (const d of devices.devices) if (d.kind === 'pad') padSuppressed.add(d.key);
  setUrlRoom(s.online ? roomCode : '');
  if (s.online) s.command({ t: 'hello', tab: TAB_ID });
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
  setUrlRoom('');
}

/** Keep `?join=CODE` in the address bar while in an online game, so a reload
 *  (or a copied URL) gets back into the same room. */
function setUrlRoom(code: string): void {
  const q = new URLSearchParams(location.search);
  if (code) q.set('join', code); else q.delete('join');
  const search = q.toString();
  history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
}

/** Join room `typed` if someone is in it, otherwise start it (a blank code
 *  starts a new random room). `cfg` only matters if we end up hosting. */
function playOnline(cfg: MatchConfig, typed: string): Promise<void> {
  menuTry++;
  const code = cleanRoomCode(typed);
  return code ? joinOnline(code, cfg) : hostOnline(cfg, randomRoomCode());
}

const errType = (e: unknown) => (e as { type?: string }).type;

/** Whoever ends up hosting changes over time (host migration), so every
 *  online session handles losing or changing hosts. */
function watchHost(s: RollbackSession): void {
  s.onHostLost = (reason) => { if (session === s) quitToMenu(reason); else { s.dispose(); menu.show(true, reason); } };
  s.onHostChanged = () => {
    hostNotice = { text: s.isHost ? "👑 The host left — you're the host now" : '🌐 The host left — the game carries on', until: performance.now() + 3000 };
  };
}
let hostNotice = { text: '', until: 0 };

async function hostOnline(cfg: MatchConfig, code: string, tries = 2): Promise<void> {
  menu.show(true, `Creating room ${code}…`);
  try {
    let link;
    try {
      link = await hostRoom(code);
    } catch (e) {
      // Someone just started that room: join it instead.
      if (errType(e) === 'unavailable-id' && tries > 1) { void joinOnline(code, cfg, tries - 1); return; }
      throw e;
    }
    roomCode = code;
    const state = createState(cfg, settings.params, (Math.random() * 2 ** 32) >>> 0);
    const s = new RollbackSession(link, state, { inputDelay: prefs.inputDelay });
    watchHost(s);
    startSession(s);
  } catch (e) {
    menu.show(true, 'Could not start room: ' + (e as Error).message);
  }
}

/** `patience`: extra attempts before deciding an empty room is ours to start.
 *  After a reload the room may be briefly unreachable — if we were the host,
 *  the others are still switching hosts and reclaiming the code. */
let menuTry = 0; // bumped by each online attempt the player starts
async function joinOnline(code: string, cfg: MatchConfig, tries = 2, patience = 0): Promise<void> {
  const myTry = menuTry;
  menu.show(true, `Looking for room ${code}…`);
  try {
    let link;
    try {
      link = await joinRoom(code);
    } catch (e) {
      if (errType(e) === 'peer-unavailable' && patience > 0) {
        // …unless the player has meanwhile started something else.
        setTimeout(() => { if (!session && menuTry === myTry) void joinOnline(code, cfg, tries, patience - 1); }, 2500);
        return;
      }
      // Nobody's in that room: start it.
      if (errType(e) === 'peer-unavailable' && tries > 1) { void hostOnline(cfg, code, tries - 1); return; }
      throw e;
    }
    const s = new RollbackSession(link, null, { inputDelay: prefs.inputDelay });
    watchHost(s);
    // Stay on the menu until the host's snapshot arrives, then enter the game.
    menu.show(true, `Connected to room ${code} — waiting for the host…`);
    s.onStarted = () => { roomCode = code; startSession(s); };
    setTimeout(() => {
      if (!s.started) { s.dispose(); menu.show(true, `Room ${code} didn't respond. Is the host's game open and in front?`); }
    }, 10000);
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
  const taken = new Set(s.players.filter((p) => p.active).map((p) => p.name));
  for (const n of pendingNames.values()) taken.add(n);
  let name = prefs.name;
  for (let i = 2; taken.has(name); i++) name = `${prefs.name} ${i}`;
  return name;
}
const pendingNames = new Map<string, string>(); // device -> name requested

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
    if (p) pendingNames.delete(d.key);
    if (!p) {
      if (now - (pendingJoin.get(d.key) ?? 0) > 1000) pendingNames.delete(d.key);
      if (hud.paused || (settings.open && d.kind !== 'pad') || (nav.active && d.kind === 'pad')) continue;
      if (d.joinPressed() && now - (pendingJoin.get(d.key) ?? 0) > 1000) {
        if (s.players.filter((q) => q.active).length >= MAX_PLAYERS) continue;
        pendingJoin.set(d.key, now);
        const name = localName();
        pendingNames.set(d.key, name);
        session.command({ t: 'join', device: d.key, name, ball: (s.players.length * 3 + devices.devices.indexOf(d)) % BALLS.length, look: prefs.looks[d.key] });
      }
      continue;
    }
    if (d.leavePressed()) { session.command({ t: 'leave', device: d.key }); continue; }
    if (d.menuPressed()) {
      // Start: begin the match from the lobby (host), otherwise pause menu.
      if (s.phase === 'lobby' && !hud.paused) session.command({ t: 'start', cfg: s.cfg });
      else hud.togglePause();
      continue;
    }
    if (s.phase === 'lobby') {
      const cb = d.cycleBall();
      if (cb) session.command({ t: 'setBall', device: d.key, ball: (p.ball + cb + BALLS.length) % BALLS.length });
      if (d.cycleTeam()) session.command({ t: 'setTeam', device: d.key, team: (p.team + 1) % (s.cfg.mode === 'teams' ? 4 : 2) });
    }
  }
  touch.setJoined(touchJoined, true);
  return inputs;
}

// Buttons still held from menu navigation (e.g. B to close) must not leak
// into the game: ignore a pad's buttons until they are all released.
const padSuppressed = new Set<string>();

function pollInputs(): Record<string, PlayerInput> {
  const inputs: Record<string, PlayerInput> = {};
  if (!session || !session.state) return inputs;
  const s = session.state;
  for (const d of devices.devices) {
    if (!d.connected()) continue;
    const p = s.players.find((p) => p.active && p.peer === session!.peer && p.device === d.key);
    if (!p) continue;
    if (d.kind === 'pad' && (nav.active || hud.paused)) padSuppressed.add(d.key);
    if (hud.paused || (nav.active && d.kind === 'pad')) { inputs[d.key] = NEUTRAL; continue; }
    let inp = d.poll(aimCtx);
    if (padSuppressed.has(d.key)) {
      if (inp.b === 0) padSuppressed.delete(d.key);
      else inp = { ...inp, b: 0 };
    }
    inputs[d.key] = inp;
  }
  return inputs;
}

// Global keys.
const edges = new Set<string>();
function pressedOnce(code: string): boolean {
  const down = anyKey(code); // includes taps shorter than a frame
  if (down && !edges.has(code)) { edges.add(code); return true; }
  if (!down) edges.delete(code);
  return false;
}

window.addEventListener('resize', () => renderer.resize());
// iOS Safari: block pinch-zoom gestures and double-tap zoom.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
window.addEventListener('pointerdown', () => unlockAudio(), { once: false });
window.addEventListener('keydown', () => unlockAudio());

// ---------------------------------------------------------------------------
// Main loop: fixed 60 Hz simulation, render every animation frame.

const FRAME_MS = 1000 / HZ;
let acc = 0;
let last = performance.now();
const seenEvents = new Map<string, number>();

// Start on a gamepad at the main menu presses the on-screen Play button (to
// the lobby). The same press also joins that pad, like A on Play does.
function startFromMenuWithStart(): void {
  if (!devices.devices.some((d) => d.kind === 'pad' && d.connected() && d.menuPressed())) return;
  menu.el.querySelector<HTMLButtonElement>('[data-act=local]')?.click();
}

// Countdown beeps (3, 2, 1) and GO! derived from the phase timer.
let lastCue = '';
function countdownCues(s: GameState): void {
  let cue = '';
  if (s.phase === 'countdown') cue = 'c' + Math.ceil(s.params.countdownTime - s.phaseT / HZ) + ':' + s.round;
  else if (s.phase === 'playing' && s.phaseT < 30) cue = 'go:' + s.round;
  if (cue && cue !== lastCue) playCue(cue.startsWith('go') ? 'go' : 'tick');
  lastCue = cue;
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  const elapsed = Math.min(250, now - last);
  last = now;
  acc += elapsed;

  devices.update();
  nav.update(now);
  if (pressedOnce('Backquote')) settings.toggle();
  if (pressedOnce('Escape') && session) hud.togglePause();

  const active = session ?? demo;
  if (!session && !settings.open) startFromMenuWithStart();
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
      if (session) playEvent(ev, s);
    }
    if (seenEvents.size > 2000) for (const [k, f] of seenEvents) if (f < s.frame - 300) seenEvents.delete(k);
    renderer.localPeer = session?.peer ?? 0;
    renderer.sync(s, elapsed / 1000);
    if (session) { hud.update(s); countdownCues(s); }
  }
  renderer.render(elapsed / 1000);
}
requestAnimationFrame(loop);

// Deep link: ?join=CODE
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode && cleanRoomCode(joinCode)) void joinOnline(cleanRoomCode(joinCode), menu.cfg(), 2, 4);

// Dev hook for automated audio checks.
(window as unknown as Record<string, unknown>).sfxDebug = async () => sfxModule;
(window as unknown as Record<string, unknown>).renderer = renderer;
