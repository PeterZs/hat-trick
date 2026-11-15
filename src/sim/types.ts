// Game state. Everything that affects the future lives here, as plain
// JSON-serializable data (numbers, strings, booleans, arrays, plain objects),
// so it can be snapshotted with structuredClone for rollback, hashed for
// desync detection, and sent to late-joining peers.

import type { Params } from './params';
import type { PlayerInput } from './input';

export type ModeId = 'ffa' | 'teams' | 'ctf' | 'soccer' | 'hazard' | 'lumber' | 'cars' | 'bumper' | 'golf' | 'lava' | 'ghost';
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
  skill: number;        // bots: 0 extra easy, 1 easy, 2 normal, 3 hard
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
  charging: boolean;    // throw held with a hat (quick throw on release)
  aiming: boolean;      // stationary aim mode (after holding aimHoldTime)
  holdT: number;        // frames the throw button has been held
  charge: number;       // 0..1 throw power, builds only while aiming
  recalling: boolean;
  prevB: number;
  stunT: number; invulnT: number;

  speedT: number; phaseT: number; shield: number; maxHats: number;
  slowT: number;        // bad: half speed
  reverseT: number;     // bad: reversed movement controls
  invisT: number;       // invisible (except while/just after attacking)
  revealT: number;      // frames left visible after an attack
  riding: number;       // slot we ride on, -1
  rider: number;        // slot riding us, -1
  car: number;          // car id driven, -1

  cursorX: number; cursorY: number; bombCd: number; // overlord
  lastBombX: number; lastBombY: number;              // overlord: where bomb hats return to

  kills: number; deaths: number; trees: number;

  // Bot memory (part of state for determinism).
  botT: number; botMx: number; botMy: number; botStrafe: number; botAimT: number;
  lastHitBy: number; lastHitT: number;   // who last shoved us (credit for falls)
  portalCd: number;
  inGrass: boolean;     // hidden in tall grass
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
  stuck: number;         // frames pinned against an obstacle without getting closer to the owner
  lastD: number;         // distance to owner last frame (stuck detection)
  hitCd: number;         // frames until it can chop/smack again (trees, ball)
  portalCd: number;
  bomb: boolean;         // launched by an Overlord bomb: returns to the bomb target, then vanishes
}

export type PickupKind = 'speed' | 'shield' | 'double' | 'phase' | 'invis' | 'slow' | 'reverse';
export const GOOD_PICKUPS: PickupKind[] = ['speed', 'shield', 'double', 'phase', 'invis'];
/** Bad power-ups: picking one up hurts you. */
export const BAD_PICKUPS: PickupKind[] = ['slow', 'reverse'];

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

export interface SoccerBall { x: number; y: number; vx: number; vy: number; lastTouch: number; portalCd?: number }

export interface GolfBall {
  team: number;
  x: number; y: number; vx: number; vy: number;
  strokes: number;
  sunk: boolean;
  restX: number; restY: number;   // where it last came to rest (water hazard returns here)
  hitCd: number;
  portalCd: number;
}

export interface GolfState {
  hole: number;
  cupX: number; cupY: number;
  balls: GolfBall[];
  t: number;                      // frames into the hole
}

export interface Flag {
  team: number;
  x: number; y: number;
  homeX: number; homeY: number;
  carrier: number;       // slot or -1
  atHome: boolean;
  dropT: number;         // frames until auto-return when dropped
}

export type PropKind = 'tree' | 'crate' | 'barrel' | 'rock' | 'bush' | 'grass';

/** A breakable prop. */
export interface Prop {
  id: number;
  kind: PropKind;
  x: number; y: number;
  hp: number;            // 0 = broken
  regrowT: number;       // frames until it comes back (when broken)
  grow: number;          // frames since (re)appearing (render pop-in)
  fixed: boolean;        // placed by the level (regrows in place) vs scattered (Lumberjacks trees)
}

export interface Bomb { id: number; owner: number; x: number; y: number; t: number }

export type SimEvent =
  | { e: 'kill'; victim: number; killer: number; x: number; y: number; cause?: 'fall' | 'lava' }
  | { e: 'shield'; who: number; x: number; y: number }
  | { e: 'clash'; a: number; b: number; x: number; y: number }
  | { e: 'slash'; who: number; kind: number }
  | { e: 'parry'; who: number; hat: number; x: number; y: number }
  | { e: 'throw'; who: number; hat: number; charge: number }
  | { e: 'catch'; who: number; hat: number }
  | { e: 'clank'; hat: number; x: number; y: number }
  | { e: 'bounce'; hat: number; x: number; y: number }
  | { e: 'hatclash'; a: number; b: number; x: number; y: number }
  | { e: 'dash'; who: number }
  | { e: 'kick'; who: number; target: number; x: number; y: number }
  | { e: 'ballkick'; who: number; x: number; y: number }
  | { e: 'pickup'; who: number; kind: string; x: number; y: number }
  | { e: 'spawn'; who: number }
  | { e: 'goal'; team: number }
  | { e: 'flag'; what: 'take' | 'drop' | 'return' | 'score'; team: number; who: number }
  | { e: 'boom'; x: number; y: number }
  | { e: 'bump'; x: number; y: number; i: number }
  | { e: 'portal'; x: number; y: number; x2: number; y2: number }
  | { e: 'tile'; i: number; what: 'warn' | 'fall' }
  | { e: 'stroke'; team: number; x: number; y: number }
  | { e: 'sunk'; team: number; strokes: number; x: number; y: number }
  | { e: 'splash'; x: number; y: number }
  | { e: 'chop'; prop: number; kind: PropKind; who: number; x: number; y: number }
  | { e: 'fell'; prop: number; kind: PropKind; who: number; x: number; y: number; dx: number; dy: number }
  | { e: 'round'; winner: number }
  | { e: 'match'; winner: number }
  | { e: 'join'; who: number }
  | { e: 'leave'; who: number }
  | { e: 'car'; what: 'enter' | 'exit' | 'crash' | 'spawn' | 'bump'; who: number; x: number; y: number }
  | { e: 'piggy'; what: 'on' | 'off'; who: number; mount: number };

export interface MatchConfig {
  mode: ModeId;
  level: string;
  winScore: number;
  cars?: number;         // Cars mode: cars always on the field
}

export interface GameState {
  frame: number;
  rng: number;
  params: Params;
  cfg: MatchConfig;
  arena: string;         // the arena actually being played (cfg.level may be 'random')
  arenaPrev: string;     // previous random pick (avoid repeats)
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
  props: Prop[];
  tiles: number[];       // floor tiles: 0 solid, >0 warning frames left, -1 fallen, -2 never there
  tileT: number;         // frames into the tile schedule this round
  golf: GolfState | null;
  scores: number[];      // indexed by team (FFA: by slot)
  lastWinner: number;    // team, -1 = draw
  pickupT: number;
  carSpawnT: number;     // Cars mode: frames until the next replacement car
  hitstop: number;       // frames of freeze remaining (impact pause)
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
  | { t: 'addBot'; team?: number; skill?: number }
  | { t: 'setSkill'; device: string; skill: number }
  | { t: 'setName'; device: string; name: string }
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
