// Game state. Everything that affects the future lives here, as plain
// JSON-serializable data (numbers, strings, booleans, arrays, plain objects),
// so it can be snapshotted with structuredClone for rollback, hashed for
// desync detection, and sent to late-joining peers.

import type { Params } from './params';
import type { PlayerInput } from './input';

export type ModeId = 'ffa' | 'teams' | 'ctf' | 'soccer' | 'hazard';
export type Phase = 'lobby' | 'countdown' | 'playing' | 'roundOver' | 'matchOver';
export type Role = 'fighter' | 'overlord';

export const HAT_HELD = 0;
export const HAT_OUT = 1;
export const HAT_RETURN = 2;
export const HAT_GROUND = 3;
export const HAT_RECALL = 4;

export interface Player {
  id: number;           // slot index into state.players
  active: boolean;      // slot in use
  peer: number;         // owning peer (0 = host / local)
  device: string;       // device key on the owning peer
  name: string;
  ball: number;         // character index (BALLS)
  team: number;
  isBot: boolean;
  role: Role;
  joinFrame: number;

  alive: boolean;
  respawnT: number;     // frames until respawn (when dead)
  x: number; y: number;
  vx: number; vy: number;
  kx: number; ky: number; // knockback velocity
  fx: number; fy: number; // facing (unit)

  dashT: number; dashCd: number; dashDx: number; dashDy: number;
  slashT: number;       // frames since attack start, -1 if none
  slashKind: number;    // 0 slash, 1 kick
  slashCd: number;
  charging: boolean; charge: number;
  recalling: boolean;
  prevB: number;
  stunT: number; invulnT: number;

  speedT: number; phaseT: number; shield: number; maxHats: number;
  riding: number;       // slot we ride on, -1
  rider: number;        // slot riding us, -1
  car: number;          // car id driven, -1

  cursorX: number; cursorY: number; bombCd: number; // overlord

  kills: number; deaths: number;

  // Bot memory (part of state for determinism).
  botT: number; botMx: number; botMy: number; botStrafe: number; botAimT: number;
}

export interface Hat {
  id: number;
  owner: number;
  state: number;         // HAT_*
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
  dist: number;          // distance travelled outward
  range: number;
  t: number;             // frames in current state
}

export type PickupKind = 'speed' | 'shield' | 'double' | 'phase';
export const PICKUP_KINDS: PickupKind[] = ['speed', 'shield', 'double', 'phase'];

export interface Pickup { id: number; kind: PickupKind; x: number; y: number; t: number }

export interface Car {
  id: number;
  x: number; y: number;
  hx: number; hy: number; // heading (unit)
  heading: number;        // angle (radians), source of truth for hx/hy
  speed: number;
  driver: number;         // slot or -1
  t: number;              // frames remaining once driven
  dead: boolean;
}

export interface SoccerBall { x: number; y: number; vx: number; vy: number; lastTouch: number }

export interface Flag {
  team: number;
  x: number; y: number;
  homeX: number; homeY: number;
  carrier: number;       // slot or -1
  atHome: boolean;
  dropT: number;         // frames until auto-return when dropped
}

export interface Bomb { id: number; owner: number; x: number; y: number; t: number }

export type SimEvent =
  | { e: 'kill'; victim: number; killer: number; x: number; y: number }
  | { e: 'shield'; who: number; x: number; y: number }
  | { e: 'clash'; a: number; b: number; x: number; y: number }
  | { e: 'slash'; who: number; kind: number }
  | { e: 'parry'; who: number; hat: number; x: number; y: number }
  | { e: 'throw'; who: number; hat: number; charge: number }
  | { e: 'catch'; who: number; hat: number }
  | { e: 'clank'; hat: number; x: number; y: number }
  | { e: 'dash'; who: number }
  | { e: 'kick'; who: number; target: number }
  | { e: 'pickup'; who: number; kind: string; x: number; y: number }
  | { e: 'spawn'; who: number }
  | { e: 'goal'; team: number }
  | { e: 'flag'; what: 'take' | 'drop' | 'return' | 'score'; team: number; who: number }
  | { e: 'boom'; x: number; y: number }
  | { e: 'round'; winner: number }
  | { e: 'match'; winner: number }
  | { e: 'join'; who: number }
  | { e: 'leave'; who: number }
  | { e: 'car'; what: 'enter' | 'exit' | 'crash'; who: number; x: number; y: number }
  | { e: 'piggy'; what: 'on' | 'off'; who: number; mount: number };

export interface MatchConfig {
  mode: ModeId;
  level: string;
  winScore: number;
}

export interface GameState {
  frame: number;
  rng: number;
  params: Params;
  cfg: MatchConfig;
  phase: Phase;
  phaseT: number;        // frames in current phase
  round: number;
  timer: number;         // frames remaining (hazard survival)
  players: Player[];
  hats: Hat[];
  pickups: Pickup[];
  cars: Car[];
  ball: SoccerBall | null;
  flags: Flag[];
  bombs: Bomb[];
  scores: number[];      // indexed by team (FFA: by slot)
  lastWinner: number;    // team, -1 = draw
  pickupT: number;
  nextId: number;
  events: SimEvent[];    // emitted during the last step (render/audio only)
}

/** Commands change the roster/match. They travel in the input stream so they
 *  are applied at the same frame on every peer. */
export type Command =
  | { t: 'join'; device: string; name: string; ball: number; team?: number }
  | { t: 'leave'; device: string }
  | { t: 'setBall'; device: string; ball: number }
  | { t: 'setTeam'; device: string; team: number }
  | { t: 'setRole'; device: string; role: Role }
  | { t: 'addBot'; team?: number }
  | { t: 'removeBot' }
  | { t: 'start'; cfg: MatchConfig }
  | { t: 'lobby'; cfg?: MatchConfig }
  | { t: 'params'; params: Params }
  | { t: 'peerLeft'; peer: number };

/** Everything one peer contributes to one frame. */
export interface PeerFrame {
  peer: number;
  inputs: Record<string, PlayerInput>; // by device key
  cmds: Command[];
}
