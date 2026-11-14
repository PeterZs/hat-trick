// Simulation entry points: create a game state and advance it one frame.
//
//   step(state, frameInputs) mutates `state` in place and is a pure function
//   of (state, frameInputs). No wall-clock time, DOM, Math.random or
//   non-deterministic Math functions are used anywhere under src/sim.

import { MAX_PLAYERS } from './const';
import { cloneParams, type Params } from './params';
import { NEUTRAL, type PlayerInput } from './input';
import { randInt } from './rng';
import type { Command, GameState, MatchConfig, PeerFrame, Player } from './types';
import { detach, die, emit, spawnPlayer } from './common';
import { canAct, resolveHatHits, resolveMelee, separatePlayers, updateCars, updateHats, updatePlayer } from './actors';
import {
  resetArena, startRound, toLobby, updateBall, updateBombs, updateCarsMode, updateFlags, updateOverlord, updatePickups, updateRules,
} from './modes';
import { botInput } from './bot';
import { updateProps } from './props';

export function createState(cfg: MatchConfig, params: Params, seed = 0x1234abcd): GameState {
  const s: GameState = {
    frame: 0,
    rng: seed >>> 0,
    params: cloneParams(params),
    cfg: { ...cfg },
    phase: 'lobby',
    phaseT: 0,
    round: 0,
    timer: 0,
    players: [],
    hats: [],
    pickups: [],
    cars: [],
    ball: null,
    flags: [],
    bombs: [],
    props: [],
    scores: new Array(MAX_PLAYERS).fill(0),
    lastWinner: -1,
    pickupT: 0,
    carSpawnT: 0,
    hitstop: 0,
    nextId: 1,
    events: [],
  };
  resetArena(s);
  return s;
}

function newPlayer(id: number, peer: number, device: string, name: string, ball: number, team: number, isBot: boolean, frame: number): Player {
  return {
    id, active: true, peer, device, name, ball, team, isBot, skill: 1, role: 'fighter', joinFrame: frame,
    alive: false, respawnT: 0, x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, fx: 1, fy: 0,
    dashT: 0, dashCd: 0, dashDx: 0, dashDy: 0, slashT: -1, slashKind: 0, slashCd: 0,
    charging: false, aiming: false, holdT: 0, charge: 0, recalling: false, prevB: 0, stunT: 0, invulnT: 0,
    speedT: 0, phaseT: 0, shield: 0, maxHats: 1, slowT: 0, reverseT: 0, invisT: 0, revealT: 0, riding: -1, rider: -1, car: -1,
    cursorX: 0, cursorY: 0, bombCd: 0, lastBombX: 0, lastBombY: 0, kills: 0, deaths: 0, trees: 0,
    botT: 0, botMx: 0, botMy: 0, botStrafe: 1, botAimT: 0,
  };
}

export function findPlayer(s: GameState, peer: number, device: string): Player | undefined {
  return s.players.find((p) => p.active && p.peer === peer && p.device === device);
}

/** Like findPlayer, but bots (unique device keys) can be edited by anyone. */
function findEditable(s: GameState, peer: number, device: string): Player | undefined {
  return findPlayer(s, peer, device) ?? s.players.find((p) => p.active && p.isBot && p.device === device);
}

function teamCounts(s: GameState): number[] {
  const c = [0, 0];
  for (const p of s.players) if (p.active && p.role === 'fighter') c[p.team % 2]++;
  return c;
}

function addPlayer(s: GameState, peer: number, device: string, name: string, ball: number, isBot: boolean, team?: number): Player | null {
  const counts = teamCounts(s);
  let slot = s.players.findIndex((p) => !p.active);
  if (slot < 0) {
    if (s.players.length >= MAX_PLAYERS) return null;
    slot = s.players.length;
  }
  const t = team ?? (counts[0] <= counts[1] ? 0 : 1);
  const p = newPlayer(slot, peer, device, name, ball, t, isBot, s.frame);
  s.players[slot] = p;
  s.scores[slot] = s.cfg.mode === 'ffa' ? 0 : s.scores[slot];
  if (s.cfg.mode === 'hazard' && s.phase !== 'lobby') p.role = 'fighter';
  if (s.phase === 'countdown' || s.phase === 'lobby' || s.phase === 'playing') spawnPlayer(s, p);
  emit(s, { e: 'join', who: slot });
  return p;
}

function removePlayer(s: GameState, p: Player): void {
  if (p.alive) die(s, p, -1);
  detach(s, p);
  s.hats = s.hats.filter((h) => h.owner !== p.id);
  p.active = false;
  p.alive = false;
  emit(s, { e: 'leave', who: p.id });
}

function applyCommand(s: GameState, peer: number, c: Command): void {
  switch (c.t) {
    case 'join': {
      if (findPlayer(s, peer, c.device)) return;
      addPlayer(s, peer, c.device, c.name.slice(0, 16), c.ball | 0, false, c.team);
      return;
    }
    case 'leave': {
      const p = findEditable(s, peer, c.device);
      if (p) removePlayer(s, p);
      return;
    }
    case 'setBall': {
      const p = findEditable(s, peer, c.device);
      if (p) p.ball = c.ball | 0;
      return;
    }
    case 'setTeam': {
      const p = findEditable(s, peer, c.device);
      if (p) p.team = Math.max(0, c.team | 0) % 4;
      return;
    }
    case 'setRole': {
      const p = findEditable(s, peer, c.device);
      if (!p || s.phase !== 'lobby') return;
      p.role = c.role;
      if (p.role === 'overlord') { if (p.alive) { detach(s, p); p.alive = false; s.hats = s.hats.filter((h) => h.owner !== p.id); } }
      else if (!p.alive) spawnPlayer(s, p);
      return;
    }
    case 'addBot': {
      const n = s.players.filter((p) => p.active && p.isBot).length + 1;
      const bot = addPlayer(s, peer, 'bot' + s.nextId++, 'Bot ' + n, randInt(s, 8), true, c.team);
      if (bot && c.skill !== undefined) bot.skill = Math.max(0, Math.min(2, c.skill | 0));
      return;
    }
    case 'setName': {
      const p = findEditable(s, peer, c.device);
      const name = String(c.name).trim().slice(0, 16);
      if (p && name) p.name = name;
      return;
    }
    case 'setSkill': {
      const p = findEditable(s, peer, c.device);
      if (p && p.isBot) p.skill = Math.max(0, Math.min(2, c.skill | 0));
      return;
    }
    case 'removeBot': {
      for (let i = s.players.length - 1; i >= 0; i--) {
        const p = s.players[i];
        if (p.active && p.isBot) { removePlayer(s, p); return; }
      }
      return;
    }
    case 'start': {
      if (peer !== 0) return; // only the host starts matches
      s.cfg = { ...c.cfg };
      s.scores = s.scores.map(() => 0);
      s.round = 0;
      for (const p of s.players) { p.kills = 0; p.deaths = 0; p.trees = 0; }
      if (s.cfg.mode === 'hazard') {
        const fighters = s.players.filter((p) => p.active);
        if (fighters.length > 1 && !fighters.some((p) => p.role === 'overlord')) {
          fighters[randInt(s, fighters.length)].role = 'overlord';
        }
      } else {
        for (const p of s.players) p.role = 'fighter';
      }
      startRound(s);
      return;
    }
    case 'lobby': {
      // Anyone can change the match settings while in the lobby; only the
      // host can send everyone back to the lobby from a match.
      if (peer !== 0 && s.phase !== 'lobby') return;
      if (c.cfg) s.cfg = { ...c.cfg };
      toLobby(s);
      return;
    }
    case 'params': {
      if (peer !== 0) return;
      s.params = cloneParams(c.params);
      return;
    }
    case 'peerLeft': {
      if (peer !== 0) return;
      for (const p of s.players) {
        if (!p.active || p.peer !== c.peer) continue;
        if (p.isBot) p.peer = 0; else removePlayer(s, p);
      }
      return;
    }
  }
}

/** Advance the game by one frame. `frame` lists every peer's contribution,
 *  sorted by peer id (missing peers = neutral input, no commands). */
export function step(s: GameState, frame: PeerFrame[]): void {
  s.events = [];
  for (const pf of frame) for (const c of pf.cmds) applyCommand(s, pf.peer, c);

  // Hit-stop: the world freezes for a few frames after a big impact. Button
  // history (prevB) is left untouched so presses during the freeze still count.
  if (s.hitstop > 0) {
    s.hitstop--;
    s.frame++;
    return;
  }

  const inputs: PlayerInput[] = new Array(s.players.length);
  const byPeer = new Map<number, PeerFrame>();
  for (const pf of frame) byPeer.set(pf.peer, pf);
  for (const p of s.players) {
    if (!p.active) continue;
    inputs[p.id] = p.isBot ? botInput(s, p) : byPeer.get(p.peer)?.inputs[p.device] ?? NEUTRAL;
  }

  if (canAct(s)) {
    for (const p of s.players) {
      if (!p.active) continue;
      if (p.role === 'overlord') { updateOverlord(s, p, inputs[p.id]); continue; }
      if (!p.alive) { p.prevB = inputs[p.id].b; continue; }
      updatePlayer(s, p, inputs[p.id]);
    }
    // Riders follow their mounts after the mounts have moved.
    for (const p of s.players) {
      if (p.active && p.alive && p.riding >= 0) {
        const m = s.players[p.riding];
        if (m && m.alive) { p.x = m.x; p.y = m.y; }
      }
    }
    separatePlayers(s);
    updateCars(s);
    updateHats(s);
    resolveMelee(s);
    resolveHatHits(s);
    updatePickups(s);
    updateBall(s);
    updateFlags(s);
    updateBombs(s);
    updateProps(s);
    updateCarsMode(s);
  } else {
    for (const p of s.players) if (p.active && inputs[p.id]) p.prevB = inputs[p.id].b;
  }
  updateRules(s);
  s.frame++;
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

/** FNV-1a hash of the serialized state (excluding transient events). */
export function hashState(s: GameState): number {
  const json = JSON.stringify({ ...s, events: undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type { GameState, MatchConfig, PeerFrame, Command };
