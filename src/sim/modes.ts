// Power-ups, game-mode objects (ball, flags, bombs) and round flow.

import { DT, HZ, allies, isRoundMode, scoreIndex, teamOf } from './const';
import { clamp, dist2, frames, len } from './dmath';
import { collideCircle, circleOverlapsWalls, type Push } from './collision';
import { rand, randInt, randRange } from './rng';
import { BTN_ATTACK, type PlayerInput } from './input';
import {
  BAD_PICKUPS, GOOD_PICKUPS, HAT_GROUND, HAT_OUT, HAT_RECALL, HAT_RETURN,
  type GameState, type Player,
} from './types';
import { canBeHit, die, dropHat, emit, giveHats, kill, level, newId, sec, spawnPlayer } from './common';
import { bounceHat, isLethal, spawnCar } from './actors';
import { resetTrees } from './trees';

const tmp: Push = { x: 0, y: 0, hit: false, nx: 0, ny: 0 };

// ---------------------------------------------------------------------------
// Power-ups

function freeSpot(s: GameState): { x: number; y: number } | null {
  const L = level(s);
  for (let tries = 0; tries < 12; tries++) {
    const x = randRange(s, -L.w + 1.5, L.w - 1.5), y = randRange(s, -L.h + 1.5, L.h - 1.5);
    if (circleOverlapsWalls(x, y, 1.2, L.walls, false)) continue;
    let ok = true;
    for (const p of s.players) if (p.active && p.alive && dist2(p.x, p.y, x, y) < 9) ok = false;
    for (const q of s.pickups) if (dist2(q.x, q.y, x, y) < 9) ok = false;
    if (ok) return { x, y };
  }
  return null;
}

/** Cars mode: keep cfg.cars cars on the field, replacing wrecks after a delay. */
export function carCount(s: GameState): number {
  return Math.max(1, Math.min(8, Math.round(s.cfg.cars ?? 2)));
}

function spawnModeCar(s: GameState): boolean {
  const spot = freeSpot(s);
  if (!spot) return false;
  spawnCar(s, spot.x, spot.y, rand(s) * 6.283);
  emit(s, { e: 'car', what: 'spawn', who: -1, x: spot.x, y: spot.y });
  return true;
}

export function updateCarsMode(s: GameState): void {
  if (s.cfg.mode !== 'cars' || s.phase === 'matchOver') return;
  if (s.cars.length >= carCount(s)) { s.carSpawnT = sec(s, 'carRespawnTime'); return; }
  // Never leave the field empty: the last car is replaced immediately.
  if (--s.carSpawnT <= 0 || s.cars.length === 0) {
    if (spawnModeCar(s)) s.carSpawnT = sec(s, 'carRespawnTime');
  }
}

export function updatePickups(s: GameState): void {
  const P = s.params;
  if (s.phase !== 'playing' && s.phase !== 'lobby') return;
  if (--s.pickupT <= 0) {
    s.pickupT = sec(s, 'powerupInterval');
    const carCount = s.cars.length;
    if (s.pickups.length < P.powerupMax) {
      const spot = freeSpot(s);
      if (spot) {
        if (carCount === 0 && rand(s) < P.carChance && s.cfg.mode !== 'soccer' && s.cfg.mode !== 'lumber' && s.cfg.mode !== 'cars') {
          spawnCar(s, spot.x, spot.y, rand(s) * 6.283);
        } else {
          const pool = rand(s) < P.badPowerupChance ? BAD_PICKUPS : GOOD_PICKUPS;
          s.pickups.push({ id: newId(s), kind: pool[randInt(s, pool.length)], x: spot.x, y: spot.y, t: 0 });
        }
      }
    }
  }
  for (const q of s.pickups) q.t++;
  const r = P.playerRadius + 0.6;
  s.pickups = s.pickups.filter((q) => {
    for (const p of s.players) {
      if (!p.active || !p.alive || p.role !== 'fighter' || p.car >= 0) continue;
      if (dist2(p.x, p.y, q.x, q.y) > r * r) continue;
      applyPickup(s, p, q.kind);
      emit(s, { e: 'pickup', who: p.id, kind: q.kind, x: q.x, y: q.y });
      return false;
    }
    return true;
  });
}

function applyPickup(s: GameState, p: Player, kind: string): void {
  switch (kind) {
    case 'speed': p.speedT = sec(s, 'speedBoostTime'); p.slowT = 0; break;
    case 'slow': p.slowT = sec(s, 'slowTime'); p.speedT = 0; break;
    case 'reverse': p.reverseT = sec(s, 'reverseTime'); break;
    case 'invis': p.invisT = sec(s, 'invisTime'); p.revealT = 0; break;
    case 'shield': p.shield = 1; break;
    case 'phase': p.phaseT = sec(s, 'phaseDashTime'); break;
    case 'double':
      if (p.maxHats < 2) {
        p.maxHats = 2;
        s.hats.push({ id: newId(s), owner: p.id, state: 0, x: p.x, y: p.y, vx: 0, vy: 0, speed: 0, dist: 0, range: 0, t: 0, stuck: 0, lastD: 0, hitCd: 0 });
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Soccer

export function resetBall(s: GameState): void {
  s.ball = { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1 };
}

export function updateBall(s: GameState): void {
  const b = s.ball;
  if (!b) return;
  const P = s.params;
  const L = level(s);
  // Players push the ball.
  for (const p of s.players) {
    if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0) continue;
    const r = P.playerRadius + P.ballRadius;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r || d2 < 1e-9) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    b.x = p.x + nx * r; b.y = p.y + ny * r;
    const pv = Math.max(0, p.vx * nx + p.vy * ny);
    const bv = b.vx * nx + b.vy * ny;
    const target = pv * (1 + P.ballPushImpulse);
    if (bv < target) { b.vx += (target - bv) * nx; b.vy += (target - bv) * ny; }
    b.lastTouch = p.id;
  }
  // Hats smack the ball.
  for (const h of s.hats) {
    if (!isLethal(s, h)) continue;
    const r = P.hatRadius + P.ballRadius;
    if (h.hitCd <= 0 && dist2(h.x, h.y, b.x, b.y) < r * r) {
      const hl = Math.max(0.01, len(h.vx, h.vy));
      b.vx = (h.vx / hl) * P.ballHatImpulse; b.vy = (h.vy / hl) * P.ballHatImpulse;
      b.lastTouch = h.owner;
      h.hitCd = 10;
      if (h.state !== HAT_RECALL) {
        const dx = h.x - b.x, dy = h.y - b.y, d = Math.max(1e-6, len(dx, dy));
        bounceHat(s, h, dx / d, dy / d);
      }
    }
  }
  const f = Math.max(0, 1 - P.ballFriction * DT);
  b.vx *= f; b.vy *= f;
  const steps = 2;
  for (let k = 0; k < steps; k++) {
    b.x += (b.vx * DT) / steps; b.y += (b.vy * DT) / steps;
    collideCircle(b.x, b.y, P.ballRadius, L.walls, false, tmp);
    if (tmp.hit) {
      b.x = tmp.x; b.y = tmp.y;
      const vn = b.vx * tmp.nx + b.vy * tmp.ny;
      if (vn < 0) { b.vx -= 1.75 * vn * tmp.nx; b.vy -= 1.75 * vn * tmp.ny; }
    }
  }
  if (s.phase !== 'playing') return;
  for (const g of L.goals) {
    if (b.x > g.x0 && b.x < g.x1 && b.y > g.y0 && b.y < g.y1) {
      const scorer = 1 - g.team;
      s.scores[scorer]++;
      emit(s, { e: 'goal', team: scorer });
      endRound(s, scorer);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Capture the flag

export function resetFlags(s: GameState): void {
  const L = level(s);
  s.flags = L.bases.slice(0, 2).map((b) => ({ team: b.team, x: b.x, y: b.y, homeX: b.x, homeY: b.y, carrier: -1, atHome: true, dropT: 0 }));
}

export function updateFlags(s: GameState): void {
  if (s.phase !== 'playing' && s.phase !== 'lobby') return;
  const r2 = 1.3 * 1.3;
  for (const f of s.flags) {
    if (f.carrier >= 0) {
      const c = s.players[f.carrier];
      if (!c || !c.active || !c.alive) { f.carrier = -1; f.dropT = sec(s, 'flagReturnTime'); continue; }
      f.x = c.x; f.y = c.y;
      // Score: carrier reaches own base while own flag is home.
      const own = s.flags.find((o) => o.team === c.team % 2);
      if (own && own.atHome && dist2(c.x, c.y, own.homeX, own.homeY) < 2.0 * 2.0) {
        f.carrier = -1; f.atHome = true; f.x = f.homeX; f.y = f.homeY;
        emit(s, { e: 'flag', what: 'score', team: c.team % 2, who: c.id });
        if (s.phase === 'playing') {
          s.scores[c.team % 2]++;
          if (s.scores[c.team % 2] >= s.cfg.winScore) endMatch(s, c.team % 2);
        }
      }
      continue;
    }
    if (!f.atHome && --f.dropT <= 0) {
      f.atHome = true; f.x = f.homeX; f.y = f.homeY;
      emit(s, { e: 'flag', what: 'return', team: f.team, who: -1 });
    }
    for (const p of s.players) {
      if (!p.active || !p.alive || p.role !== 'fighter' || p.car >= 0) continue;
      if (dist2(p.x, p.y, f.x, f.y) > r2) continue;
      if (p.team % 2 === f.team) {
        if (!f.atHome) {
          f.atHome = true; f.x = f.homeX; f.y = f.homeY;
          emit(s, { e: 'flag', what: 'return', team: f.team, who: p.id });
        }
      } else if (!s.flags.some((o) => o.carrier === p.id)) {
        f.carrier = p.id; f.atHome = false;
        emit(s, { e: 'flag', what: 'take', team: f.team, who: p.id });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Overlord (asymmetric): overlords move a cursor and drop bombs.

export function updateOverlord(s: GameState, p: Player, inp: PlayerInput): void {
  const P = s.params;
  const L = level(s);
  const pressed = inp.b & ~p.prevB;
  p.prevB = inp.b;
  p.cursorX = clamp(p.cursorX + (inp.mx / 127) * P.cursorSpeed * DT, -L.w, L.w);
  p.cursorY = clamp(p.cursorY + (inp.my / 127) * P.cursorSpeed * DT, -L.h, L.h);
  if (p.bombCd > 0) p.bombCd--;
  if ((pressed & BTN_ATTACK) && p.bombCd <= 0 && s.phase === 'playing') {
    s.bombs.push({ id: newId(s), owner: p.id, x: p.cursorX, y: p.cursorY, t: 0 });
    p.bombCd = sec(s, 'bombCooldown');
  }
}

export function updateBombs(s: GameState): void {
  const P = s.params;
  const fall = sec(s, 'bombFallTime');
  s.bombs = s.bombs.filter((b) => {
    if (++b.t < fall) return true;
    emit(s, { e: 'boom', x: b.x, y: b.y });
    for (const p of s.players) {
      if (!canBeHit(p)) continue;
      if (dist2(p.x, p.y, b.x, b.y) < (P.bombRadius + P.hitRadius) ** 2) kill(s, p, b.owner);
    }
    for (const h of s.hats) {
      if (h.state !== HAT_GROUND && h.state !== 0 && dist2(h.x, h.y, b.x, b.y) < P.bombRadius ** 2) dropHat(s, h);
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Round & match flow

export function resetArena(s: GameState): void {
  s.hats = [];
  s.pickups = [];
  s.cars = [];
  s.bombs = [];
  s.pickupT = sec(s, 'powerupInterval');
  resetTrees(s);
  if (s.cfg.mode === 'cars') { for (let i = 0; i < carCount(s); i++) spawnModeCar(s); s.carSpawnT = sec(s, 'carRespawnTime'); }
  s.ball = s.cfg.mode === 'soccer' ? { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1 } : null;
  if (s.cfg.mode === 'ctf') resetFlags(s); else s.flags = [];
  // Respawn everyone at deterministic spawn points.
  for (const p of s.players) {
    if (!p.active) continue;
    p.alive = false;
  }
  for (const p of s.players) {
    if (!p.active) continue;
    if (p.role === 'overlord') { p.alive = false; p.cursorX = 0; p.cursorY = 0; p.bombCd = 0; continue; }
    spawnPlayer(s, p);
  }
}

export function toLobby(s: GameState): void {
  s.phase = 'lobby';
  s.phaseT = 0;
  s.round = 0;
  s.scores = s.scores.map(() => 0);
  s.lastWinner = -1;
  resetArena(s);
}

export function startRound(s: GameState): void {
  s.round++;
  s.phase = s.params.countdownTime > 0 ? 'countdown' : 'playing';
  s.phaseT = 0;
  s.timer = s.cfg.mode === 'hazard' ? sec(s, 'hazardRoundTime') : s.cfg.mode === 'lumber' ? sec(s, 'lumberTime') : 0;
  resetArena(s);
}

export function endRound(s: GameState, winnerTeam: number): void {
  s.phase = 'roundOver';
  s.phaseT = 0;
  s.lastWinner = winnerTeam;
  emit(s, { e: 'round', winner: winnerTeam });
}

export function endMatch(s: GameState, winnerTeam: number): void {
  s.phase = 'matchOver';
  s.phaseT = 0;
  s.lastWinner = winnerTeam;
  emit(s, { e: 'match', winner: winnerTeam });
}

/** Called every frame: respawns, round end detection, phase timers. */
export function updateRules(s: GameState): void {
  s.phaseT++;
  const mode = s.cfg.mode;
  const fighters = s.players.filter((p) => p.active && p.role === 'fighter');

  // Respawning (lobby, and modes without elimination).
  const respawns = s.phase === 'lobby' || (s.phase === 'playing' && !isRoundMode(mode)) ||
    (s.phase === 'playing' && fighters.length < 2);
  for (const p of fighters) {
    if (p.alive) continue;
    if (respawns || (s.phase === 'roundOver' && !isRoundMode(mode))) {
      if (--p.respawnT <= 0) spawnPlayer(s, p);
    }
  }

  switch (s.phase) {
    case 'countdown':
      if (s.phaseT >= sec(s, 'countdownTime')) { s.phase = 'playing'; s.phaseT = 0; }
      break;
    case 'playing': {
      if (mode === 'lumber') {
        if (--s.timer <= 0) {
          // Most trees wins; a tie is a draw.
          let best = -1, winner = -1;
          for (const p of fighters) {
            const sc = s.scores[p.id];
            if (sc > best) { best = sc; winner = 100 + p.id; } else if (sc === best) winner = -1;
          }
          endMatch(s, winner);
        }
        break;
      }
      if (mode === 'hazard') {
        const runners = fighters.filter((p) => p.alive);
        const overlords = s.players.filter((p) => p.active && p.role === 'overlord');
        if (--s.timer <= 0) { s.scores[0]++; endRound(s, 0); }
        else if (fighters.length > 0 && overlords.length > 0 && runners.length === 0) { s.scores[1]++; endRound(s, 1); }
        break;
      }
      if (!isRoundMode(mode)) break;
      if (fighters.length < 2) break;
      const aliveTeams = new Set<number>();
      for (const p of fighters) if (p.alive) aliveTeams.add(teamOf(s, p));
      const allTeams = new Set<number>(fighters.map((p) => teamOf(s, p)));
      if (allTeams.size < 2) break;
      if (aliveTeams.size <= 1) {
        const w = aliveTeams.size === 1 ? [...aliveTeams][0] : -1;
        if (w >= 0) s.scores[scoreIndex(s, w)]++;
        endRound(s, w);
      }
      break;
    }
    case 'roundOver':
      if (s.phaseT >= sec(s, 'roundEndDelay')) {
        const best = Math.max(...s.scores);
        if (best >= s.cfg.winScore) {
          const winner = s.scores.indexOf(best);
          endMatch(s, mode === 'ffa' ? 100 + winner : winner);
        } else if (mode === 'soccer') {
          s.phase = 'countdown'; s.phaseT = 0;
          s.ball = { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1 };
          s.bombs = [];
          for (const p of fighters) spawnPlayer(s, p);
        } else {
          startRound(s);
        }
      }
      break;
    case 'matchOver':
      if (s.phaseT >= frames(8, HZ)) toLobby(s);
      break;
  }
}

export { HZ, frames, allies, die };
