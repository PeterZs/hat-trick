import type { GameState, ModeId, Player } from './types';

export const HZ = 60;
export const DT = 1 / HZ;
export const MAX_PLAYERS = 16;

export const BALLS = ['Soccer', 'Basketball', 'Tennis', 'Baseball', 'Beach', 'Eight', 'Bowling', 'Volley',
  'Golf', 'Table tennis', 'Shot put', 'Handball', 'Water polo', 'Field hockey', 'Softball', 'Lacrosse'];
export const HATS = ['Top hat', 'Bucket hat', 'Visor', 'Baseball cap', 'Sun hat', 'Fedora', 'Bowler', 'Beanie',
  'Flat cap', 'Propeller beanie', 'Viking helmet', 'Headband', 'Swim cap', 'Fez', 'Cowboy hat', 'Crown'];

export const MODES: { id: ModeId; name: string; desc: string; level: string }[] = [
  { id: 'ffa', name: 'Free-for-all', desc: 'Last ball standing wins the round.', level: 'courtyard' },
  { id: 'teams', name: 'Teams', desc: 'Last team standing wins the round.', level: 'courtyard' },
  { id: 'ctf', name: 'Capture the Flag', desc: "Grab the enemy flag and bring it home.", level: 'fortress' },
  { id: 'soccer', name: 'Soccer', desc: 'Hit the ball into the other net.', level: 'pitch' },
  { id: 'hazard', name: 'Overlord', desc: 'Overlords drop bombs; runners survive the clock.', level: 'courtyard' },
  { id: 'lumber', name: 'Lumberjacks', desc: 'Chop down the most trees before time runs out.', level: 'clearing' },
  { id: 'cars', name: 'Cars', desc: 'Free-for-all with cars always on the field. Run them over!', level: 'raceway' },
];

export function isTeamMode(m: ModeId): boolean {
  return m !== 'ffa' && m !== 'lumber' && m !== 'cars';
}

/** Modes scored per player rather than per team. */
export function isSoloMode(m: ModeId): boolean {
  return m === 'ffa' || m === 'lumber' || m === 'cars';
}

/** The team used for friendly fire and scoring. */
export function teamOf(s: GameState, p: Player): number {
  switch (s.cfg.mode) {
    case 'ffa': case 'lumber': case 'cars': return 100 + p.id;
    case 'hazard': return p.role === 'overlord' ? 1 : 0;
    default: return p.team;
  }
}

export function scoreIndex(s: GameState, team: number): number {
  return team >= 100 ? team - 100 : team;
}

export function allies(s: GameState, a: Player, b: Player): boolean {
  return a.id === b.id || teamOf(s, a) === teamOf(s, b);
}

/** Round-based modes end when one side remains. */
export function isRoundMode(m: ModeId): boolean {
  return m === 'ffa' || m === 'teams' || m === 'hazard' || m === 'cars';
}
