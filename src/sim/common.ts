// Helpers shared by the simulation modules.

import { DT, HZ, allies, teamOf } from './const';
import { getLevel, type Level } from './level';
import { circleOverlapsWalls } from './collision';
import { rand } from './rng';
import { frames } from './dmath';
import { HAT_GROUND, HAT_HELD, type GameState, type Hat, type Player, type SimEvent } from './types';

export function level(s: GameState): Level {
  return getLevel(s.cfg.level);
}

export function emit(s: GameState, e: SimEvent): void {
  s.events.push(e);
}

export function newId(s: GameState): number {
  return s.nextId++;
}

export function sec(s: GameState, key: string): number {
  return frames(s.params[key], HZ);
}

/** Freeze the world for `frames` frames (impact pause). */
export function hitstop(s: GameState, frames: number): void {
  s.hitstop = Math.max(s.hitstop, Math.round(frames));
}

export function heldHats(s: GameState, p: Player): number {
  let n = 0;
  for (const h of s.hats) if (h.owner === p.id && h.state === HAT_HELD) n++;
  return n;
}

export function hatsOf(s: GameState, p: Player): Hat[] {
  return s.hats.filter((h) => h.owner === p.id);
}

export function giveHats(s: GameState, p: Player): void {
  s.hats = s.hats.filter((h) => h.owner !== p.id);
  for (let i = 0; i < p.maxHats; i++) {
    s.hats.push({ id: newId(s), owner: p.id, state: HAT_HELD, x: p.x, y: p.y, vx: 0, vy: 0, speed: 0, dist: 0, range: 0, t: 0, stuck: 0, lastD: 0, hitCd: 0 });
  }
}

export function dropHat(s: GameState, h: Hat): void {
  if (h.state === HAT_GROUND) return;
  h.state = HAT_GROUND;
  h.vx = 0; h.vy = 0; h.speed = 0; h.t = 0; h.stuck = 0;
  emit(s, { e: 'clank', hat: h.id, x: h.x, y: h.y });
}

export function isFighter(p: Player): boolean {
  return p.active && p.role === 'fighter';
}

export function canBeHit(p: Player): boolean {
  return p.active && p.alive && p.role === 'fighter' && p.invulnT <= 0;
}

/** Detach a player from piggyback / car. */
export function detach(s: GameState, p: Player): void {
  if (p.riding >= 0) {
    const m = s.players[p.riding];
    if (m) m.rider = -1;
    p.riding = -1;
  }
  if (p.rider >= 0) {
    const r = s.players[p.rider];
    if (r) { r.riding = -1; r.x = p.x + 0.8; r.y = p.y; }
    p.rider = -1;
  }
  if (p.car >= 0) {
    const c = s.cars.find((c) => c.id === p.car);
    if (c) { c.driver = -1; c.speed *= 0.5; }
    p.car = -1;
  }
}

/** Lethal hit. Returns true if the victim died (false if blocked by a shield). */
export function kill(s: GameState, victim: Player, killer: number): boolean {
  if (!canBeHit(victim)) return false;
  if (victim.shield > 0) {
    victim.shield--;
    victim.invulnT = frames(0.6, HZ);
    emit(s, { e: 'shield', who: victim.id, x: victim.x, y: victim.y });
    return false;
  }
  die(s, victim, killer);
  return true;
}

export function die(s: GameState, victim: Player, killer: number): void {
  victim.alive = false;
  victim.deaths++;
  victim.respawnT = sec(s, 'respawnTime');
  victim.charging = false; victim.aiming = false; victim.holdT = 0; victim.charge = 0; victim.slashT = -1;
  if (killer >= 0 && killer !== victim.id) {
    const k = s.players[killer];
    if (k) k.kills++;
  }
  if (killer >= 0) hitstop(s, s.params.hitstopKill);
  emit(s, { e: 'kill', victim: victim.id, killer, x: victim.x, y: victim.y });
  detach(s, victim);
  // Hats fall where they are; held hats tumble out around the body.
  let i = 0;
  for (const h of s.hats) {
    if (h.owner !== victim.id) continue;
    if (h.state === HAT_HELD) {
      const a = (i++ * 2.4) % 6.283;
      h.x = victim.x + Math.sign(a - 3.14) * 0.4; h.y = victim.y + 0.3;
    }
    h.state = HAT_GROUND; h.vx = 0; h.vy = 0; h.speed = 0; h.t = 0;
  }
  // Drop any carried flag.
  for (const f of s.flags) {
    if (f.carrier === victim.id) {
      f.carrier = -1; f.x = victim.x; f.y = victim.y; f.dropT = sec(s, 'flagReturnTime');
      emit(s, { e: 'flag', what: 'drop', team: f.team, who: victim.id });
    }
  }
  // Power-ups are lost on death.
  victim.speedT = 0; victim.phaseT = 0; victim.shield = 0; victim.maxHats = 1; victim.slowT = 0; victim.reverseT = 0;
}

/** Pick the spawn point farthest from enemies (deterministic tie-breaking). */
export function chooseSpawn(s: GameState, p: Player): { x: number; y: number } {
  const L = level(s);
  const team = s.cfg.mode === 'ctf' || s.cfg.mode === 'soccer' ? p.team % 2 : -1;
  let cands = L.spawns.filter((sp) => sp.team === -1 || team === -1 || sp.team === team);
  if (cands.length === 0) cands = L.spawns;
  let best = cands[0], bestScore = -1;
  for (const sp of cands) {
    let nearest = 1e9;
    for (const o of s.players) {
      if (!o.active || !o.alive || o.id === p.id) continue;
      const d = (o.x - sp.x) ** 2 + (o.y - sp.y) ** 2;
      const w = allies(s, o, p) ? 0.25 : 1; // allies matter less
      nearest = Math.min(nearest, d / w);
    }
    const score = nearest + rand(s) * 0.01;
    if (score > bestScore) { bestScore = score; best = sp; }
  }
  // Nudge off any wall/occupied spot.
  let x = best.x, y = best.y;
  for (let k = 0; k < 8 && circleOverlapsWalls(x, y, 0.6, L.walls, false); k++) x += 0.5;
  return { x, y };
}

export function spawnPlayer(s: GameState, p: Player, at?: { x: number; y: number }): void {
  const pos = at ?? chooseSpawn(s, p);
  p.alive = true;
  p.x = pos.x; p.y = pos.y;
  p.vx = p.vy = p.kx = p.ky = 0;
  p.fx = p.x > 0 ? -1 : 1; p.fy = 0;
  p.dashT = 0; p.dashCd = 0; p.slashT = -1; p.slashCd = 0;
  p.charging = false; p.aiming = false; p.holdT = 0; p.charge = 0; p.recalling = false;
  p.stunT = 0; p.invulnT = sec(s, 'spawnInvulnTime');
  p.riding = -1; p.rider = -1; p.car = -1;
  p.speedT = 0; p.phaseT = 0; p.shield = 0; p.maxHats = 1; p.slowT = 0; p.reverseT = 0;
  p.respawnT = 0;
  giveHats(s, p);
  emit(s, { e: 'spawn', who: p.id });
}

export function activePlayers(s: GameState): Player[] {
  return s.players.filter((p) => p.active);
}

export { DT, HZ, teamOf };
