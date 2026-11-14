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
  D('kickKnockback', 'Kick knockback', 'Melee', 0, 50, 0.5),
  D('knockbackDecay', 'Knockback decay (1/s)', 'Melee', 0.5, 30, 0.5),
  D('stunTime', 'Stun after knockback (s)', 'Melee', 0, 1, 0.01),
  D('hitRadius', 'Hit radius (hurtbox)', 'Melee', 0.1, 1.5, 0.05),
  D('hatSpeed', 'Hat speed (tap throw)', 'Throw', 5, 60, 0.5),
  D('hatRange', 'Hat distance (tap throw)', 'Throw', 1, 40, 0.5),
  D('chargedHatSpeed', 'Hold-throw speed', 'Throw', 5, 80, 0.5),
  D('chargedHatRange', 'Hold-throw distance', 'Throw', 1, 60, 0.5),
  D('chargeTime', 'Hold-throw charge time (s)', 'Throw', 0.05, 3, 0.05),
  D('aimMoveFactor', 'Move speed while aiming (x)', 'Throw', 0, 1, 0.05),
  D('hatReturnSpeed', 'Hat return speed', 'Throw', 2, 60, 0.5),
  D('hatHoming', 'Hat homing strength', 'Throw', 1, 200, 1),
  D('hatRadius', 'Hat radius', 'Throw', 0.1, 1.5, 0.05),
  D('catchRadius', 'Catch radius', 'Throw', 0.2, 3, 0.05),
  D('recallAccel', 'Recall acceleration', 'Throw', 1, 80, 0.5),
  D('recallMaxSpeed', 'Recall max speed', 'Throw', 1, 60, 0.5),
  D('recallLethalSpeed', 'Recall lethal min speed', 'Throw', 0, 20, 0.5),
  D('powerupInterval', 'Power-up spawn interval (s)', 'Power-ups', 1, 60, 0.5),
  D('powerupMax', 'Max power-ups on field', 'Power-ups', 0, 10, 1),
  D('speedBoostMult', 'Speed boost multiplier', 'Power-ups', 1, 3, 0.05),
  D('speedBoostTime', 'Speed boost duration (s)', 'Power-ups', 1, 60, 0.5),
  D('phaseDashTime', 'Phase-dash duration (s)', 'Power-ups', 1, 60, 0.5),
  D('carChance', 'Car spawn chance', 'Power-ups', 0, 1, 0.01),
  D('carMaxSpeed', 'Car max speed', 'Car', 2, 60, 0.5),
  D('carAccel', 'Car acceleration', 'Car', 1, 100, 1),
  D('carTurnRate', 'Car turn rate (rad/s)', 'Car', 0.5, 10, 0.1),
  D('carTime', 'Car lifetime (s)', 'Car', 2, 60, 1),
  D('carKillSpeed', 'Car lethal speed', 'Car', 0, 30, 0.5),
  D('piggyMountSpeedMult', 'Piggyback mount speed (x)', 'Piggyback', 0.5, 4, 0.05),
  D('respawnTime', 'Respawn time (s)', 'Rules', 0, 10, 0.1),
  D('spawnInvulnTime', 'Spawn protection (s)', 'Rules', 0, 5, 0.1),
  D('roundEndDelay', 'Round end delay (s)', 'Rules', 0.5, 10, 0.1),
  D('countdownTime', 'Countdown (s)', 'Rules', 0, 5, 0.1),
  D('ballRadius', 'Soccer ball radius', 'Soccer', 0.3, 2, 0.05),
  D('ballFriction', 'Soccer ball friction', 'Soccer', 0, 5, 0.05),
  D('ballPushImpulse', 'Ball push strength', 'Soccer', 0, 4, 0.05),
  D('ballSlashImpulse', 'Ball slash impulse', 'Soccer', 0, 60, 0.5),
  D('ballHatImpulse', 'Ball hat impulse', 'Soccer', 0, 40, 0.5),
  D('flagReturnTime', 'Dropped flag return (s)', 'CTF', 1, 60, 1),
  D('bombCooldown', 'Overlord bomb cooldown (s)', 'Hazard', 0.1, 5, 0.05),
  D('bombFallTime', 'Bomb fall time (s)', 'Hazard', 0.2, 4, 0.05),
  D('bombRadius', 'Bomb blast radius', 'Hazard', 0.5, 6, 0.1),
  D('cursorSpeed', 'Overlord cursor speed', 'Hazard', 2, 40, 0.5),
  D('hazardRoundTime', 'Survive time (s)', 'Hazard', 5, 180, 1),
];

export type Params = Record<string, number>;

export const DEFAULT_PARAMS: Params = { ...(defaults as Params) };

export function cloneParams(p: Params): Params {
  const out: Params = {};
  // Fixed key order (PARAM_DEFS) keeps serialization/hash deterministic.
  for (const d of PARAM_DEFS) out[d.key] = p[d.key] ?? DEFAULT_PARAMS[d.key];
  return out;
}
