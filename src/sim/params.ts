// Tunable gameplay parameters. Units: world units (~1 ball diameter = 1.1),
// seconds, units/second. The values live in defaultParams.json so the
// settings panel can download an updated file to drop in as the new defaults.

import defaults from './defaultParams.json';

export interface ParamDef {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  bool?: boolean; // shown as a checkbox; 0 = off, 1 = on
}

const D = (key: string, label: string, group: string, min: number, max: number, step: number): ParamDef =>
  ({ key, label, group, min, max, step });

export const PARAM_DEFS: ParamDef[] = [
  D('moveSpeed', 'Running speed', 'Movement', 1, 20, 0.1),
  D('moveAccel', 'Acceleration (responsiveness)', 'Movement', 1, 80, 1),
  D('playerRadius', 'Player body radius', 'Movement', 0.2, 1.5, 0.05),
  D('dashSpeed', 'Dash speed', 'Dash', 5, 60, 0.5),
  D('dashTime', 'Dash duration (s)', 'Dash', 0.03, 0.6, 0.01),
  D('dashCooldown', 'Dash cooldown (s)', 'Dash', 0, 3, 0.05),
  D('slashWindup', 'Slash windup (s)', 'Melee', 0, 0.3, 0.01),
  D('slashActive', 'Slash active time (s)', 'Melee', 0.02, 0.4, 0.01),
  D('slashCooldown', 'Slash cooldown (s)', 'Melee', 0, 2, 0.05),
  D('slashRange', 'Attack radius', 'Melee', 0.5, 5, 0.05),
  D('slashArcDeg', 'Attack arc (degrees)', 'Melee', 30, 360, 5),
  D('clashWindow', 'Clash window (s)', 'Melee', 0, 0.4, 0.01),
  D('clashKnockback', 'Clash knockback', 'Melee', 0, 40, 0.5),
  D('kickRange', 'Kick radius (no hat)', 'Melee', 0.5, 4, 0.05),
  D('kickKnockback', 'Kick knockback', 'Melee', 0, 80, 0.5),
  D('kickStunTime', 'Kick stun (s)', 'Melee', 0, 2, 0.05),
  D('hitstopKick', 'Hit-stop on kick (frames)', 'Juice', 0, 12, 1),
  D('knockbackDecay', 'Knockback decay (1/s)', 'Melee', 0.5, 30, 0.5),
  D('stunTime', 'Stun after knockback (s)', 'Melee', 0, 1, 0.01),
  D('hitRadius', 'Hit radius (hurtbox)', 'Melee', 0.1, 1.5, 0.05),
  D('hatSpeed', 'Hat speed (tap throw)', 'Throw', 5, 60, 0.5),
  D('hatRange', 'Hat distance (tap throw)', 'Throw', 1, 40, 0.5),
  D('chargedHatSpeed', 'Hold-throw speed', 'Throw', 5, 80, 0.5),
  D('chargedHatRange', 'Hold-throw distance', 'Throw', 1, 60, 0.5),
  D('aimHoldTime', 'Hold to enter stationary aim (s)', 'Throw', 0, 3, 0.05),
  D('chargeTime', 'Aimed-throw charge time (s)', 'Throw', 0.05, 3, 0.05),
  D('aimMoveFactor', 'Move speed in stationary aim (x)', 'Throw', 0, 1, 0.05),
  D('hatReturnSpeed', 'Hat return speed', 'Throw', 2, 60, 0.5),
  D('hatHoming', 'Hat return acceleration', 'Throw', 5, 600, 5),
  D('hatRadius', 'Hat radius', 'Throw', 0.1, 1.5, 0.05),
  D('hatStuckTime', 'Pinned hat drops after (s)', 'Throw', 0.02, 2, 0.01),
  D('catchRadius', 'Catch radius', 'Throw', 0.2, 3, 0.05),
  D('recallAccel', 'Recall acceleration', 'Throw', 1, 80, 0.5),
  D('recallMaxSpeed', 'Recall max speed', 'Throw', 1, 60, 0.5),
  D('recallLethalSpeed', 'Recall lethal min speed', 'Throw', 0, 20, 0.5),
  D('powerupInterval', 'Power-up spawn interval (s)', 'Power-ups', 1, 60, 0.5),
  D('powerupMax', 'Max power-ups on field', 'Power-ups', 0, 10, 1),
  D('speedBoostMult', 'Speed boost multiplier', 'Power-ups', 1, 3, 0.05),
  D('speedBoostTime', 'Speed boost duration (s)', 'Power-ups', 1, 60, 0.5),
  { ...D('hidePowerups', 'Hide power-up identity until picked up', 'Power-ups', 0, 1, 1), bool: true },
  D('badPowerupChance', 'Chance a power-up is bad', 'Power-ups', 0, 1, 0.05),
  D('slowMult', 'Slowpoke speed multiplier', 'Power-ups', 0.1, 1, 0.05),
  D('slowTime', 'Slowpoke duration (s)', 'Power-ups', 1, 60, 0.5),
  D('reverseTime', 'Reversed controls duration (s)', 'Power-ups', 1, 60, 0.5),
  D('invisTime', 'Invisibility duration (s)', 'Power-ups', 1, 60, 0.5),
  D('invisRevealTime', 'Visible after attacking (s)', 'Power-ups', 0, 3, 0.05),
  D('phaseDashTime', 'Phase-dash duration (s)', 'Power-ups', 1, 60, 0.5),
  D('carChance', 'Car spawn chance', 'Power-ups', 0, 1, 0.01),
  D('carMaxSpeed', 'Car max speed', 'Car', 2, 60, 0.5),
  D('carAccel', 'Car acceleration', 'Car', 1, 100, 1),
  D('carTurnRate', 'Car turn rate (rad/s)', 'Car', 0.5, 10, 0.1),
  D('carTime', 'Car lifetime (s)', 'Car', 2, 60, 1),
  D('carKillSpeed', 'Car lethal speed', 'Car', 0, 30, 0.5),
  D('carRespawnTime', 'Cars mode: replacement car delay (s)', 'Car', 0, 10, 0.1),
  D('piggyMountSpeedMult', 'Piggyback mount speed (x)', 'Piggyback', 0.5, 4, 0.05),
  D('hitstopKill', 'Hit-stop on kill (frames)', 'Juice', 0, 12, 1),
  D('hitstopClash', 'Hit-stop on weapon clash (frames)', 'Juice', 0, 12, 1),
  D('dashBumpKnockback', 'Dash bump knockback', 'Melee', 0, 60, 0.5),
  D('fallCreditTime', 'Shove credit for falls (s)', 'Arena', 0, 10, 0.5),
  D('iceGrip', 'Ice grip (x accel)', 'Arena', 0.02, 1, 0.01),
  D('bumperForce', 'Bumper force', 'Arena', 0, 60, 0.5),
  D('portalCooldown', 'Portal cooldown (s)', 'Arena', 0, 3, 0.05),
  D('windOnPlayers', 'Wind effect on players (x)', 'Arena', 0, 2, 0.05),
  D('tileWarnTime', 'Tile warning before it falls (s)', 'Arena', 0.2, 5, 0.1),
  D('collapseTime', 'Collapsing floor: time to shrink (s)', 'Arena', 5, 300, 5),
  D('respawnTime', 'Respawn time (s)', 'Rules', 0, 10, 0.1),
  D('spawnInvulnTime', 'Spawn protection (s)', 'Rules', 0, 5, 0.1),
  D('roundEndDelay', 'Round end delay (s)', 'Rules', 0.5, 10, 0.1),
  D('countdownTime', 'Countdown (s)', 'Rules', 0, 5, 0.1),
  D('ballRadius', 'Soccer ball radius', 'Soccer', 0.3, 2, 0.05),
  D('ballFriction', 'Soccer ball friction', 'Soccer', 0, 5, 0.05),
  D('ballPushImpulse', 'Ball push strength', 'Soccer', 0, 4, 0.05),
  D('ballSlashImpulse', 'Ball slash impulse', 'Soccer', 0, 60, 0.5),
  D('ballKickImpulse', 'Ball kick impulse', 'Soccer', 0, 100, 0.5),
  D('ballHatImpulse', 'Ball hat impulse', 'Soccer', 0, 40, 0.5),
  D('flagReturnTime', 'Dropped flag return (s)', 'CTF', 1, 60, 1),
  D('lumberTime', 'Match length (s)', 'Lumberjacks', 10, 600, 5),
  D('treeCount', 'Trees standing', 'Lumberjacks', 1, 30, 1),
  D('treeHp', 'Hits to fell a tree', 'Lumberjacks', 1, 10, 1),
  D('treeRegrowTime', 'Regrow time (s)', 'Lumberjacks', 0, 30, 0.5),
  D('treeRadius', 'Tree trunk radius', 'Lumberjacks', 0.2, 1.5, 0.05),
  D('propRegrowTime', 'Level breakables regrow (s)', 'Breakables', 1, 120, 1),
  D('crateDropChance', 'Crate power-up drop chance', 'Breakables', 0, 1, 0.05),
  D('barrelBlastRadius', 'Barrel blast radius', 'Breakables', 0.5, 6, 0.1),
  D('bombCooldown', 'Delay between bombs (s)', 'Overlord', 0.05, 5, 0.05),
  D('bombFallTime', 'Bomb fall time (s)', 'Overlord', 0.2, 4, 0.05),
  D('bombRadius', 'Bomb blast radius', 'Overlord', 0, 6, 0.1),
  D('bombHats', 'Hats per bomb', 'Overlord', 0, 16, 1),
  D('bombHatSpeed', 'Bomb hat speed', 'Overlord', 2, 40, 0.5),
  D('bombHatRange', 'Bomb hat distance', 'Overlord', 1, 20, 0.5),
  D('cursorSpeed', 'Overlord cursor speed', 'Overlord', 2, 40, 0.5),
  D('hazardRoundTime', 'Survive time (s)', 'Overlord', 5, 180, 1),
];

export type Params = Record<string, number>;

export const DEFAULT_PARAMS: Params = { ...(defaults as Params) };

export function cloneParams(p: Params): Params {
  const out: Params = {};
  // Fixed key order (PARAM_DEFS) keeps serialization/hash deterministic.
  for (const d of PARAM_DEFS) out[d.key] = p[d.key] ?? DEFAULT_PARAMS[d.key];
  return out;
}
