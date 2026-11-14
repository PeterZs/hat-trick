// Simple deterministic bots. Bot "thinking" runs inside the sim step using the
// sim RNG, so bots behave identically on every peer and under rollback.

import { allies } from './const';
import { clamp, dist2, len } from './dmath';
import { segmentBlocked } from './collision';
import { rand } from './rng';
import { BTN_ATTACK, BTN_DASH, BTN_THROW, makeInput, NEUTRAL, type PlayerInput } from './input';
import { navGrid } from './level';
import { HAT_GROUND, HAT_HELD, type GameState, type Player } from './types';
import { heldHats, isInvisible, level } from './common';
import { isStanding } from './trees';
import { isLethal } from './actors';

function nearestEnemy(s: GameState, p: Player): Player | null {
  let best: Player | null = null, bd = 1e18;
  for (const o of s.players) {
    if (!o.active || !o.alive || o.role !== 'fighter' || allies(s, p, o)) continue;
    const d = dist2(p.x, p.y, o.x, o.y);
    if (isInvisible(o) && d > 2 * 2) continue; // can't see them
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Direction to walk from (x,y) toward (tx,ty), routing around walls. */
export function pathDir(s: GameState, x: number, y: number, tx: number, ty: number): [number, number] {
  const L = level(s);
  const dx = tx - x, dy = ty - y, d = len(dx, dy);
  if (d < 1e-3) return [0, 0];
  if (!segmentBlocked(x, y, tx, ty, L.walls, false, 0.45)) return [dx / d, dy / d];
  const g = navGrid(L);
  const ci = (vx: number) => clamp(Math.floor((vx - g.x0) / g.cell), 0, g.nx - 1);
  const cj = (vy: number) => clamp(Math.floor((vy - g.y0) / g.cell), 0, g.ny - 1);
  const start = cj(y) * g.nx + ci(x), goal = cj(ty) * g.nx + ci(tx);
  // BFS from the goal so each cell knows its distance to the goal.
  const n = g.nx * g.ny;
  const dist = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  dist[goal] = 0; q[qt++] = goal;
  while (qh < qt) {
    const c = q[qh++];
    if (c === start) break;
    const cx = c % g.nx, cy = (c - cx) / g.nx;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= g.nx || ny >= g.ny) continue;
      const ni = ny * g.nx + nx;
      if (dist[ni] >= 0 || (g.blocked[ni] && ni !== start)) continue;
      if (ox && oy && (g.blocked[cy * g.nx + nx] || g.blocked[ny * g.nx + cx])) continue;
      dist[ni] = dist[c] + 1; q[qt++] = ni;
    }
  }
  if (dist[start] < 0) return [dx / d, dy / d];
  // Walk down the gradient a few steps; aim at the farthest visible cell.
  let cur = start, aim = start;
  for (let k = 0; k < 8; k++) {
    const cx = cur % g.nx, cy = (cur - cx) / g.nx;
    let next = cur;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= g.nx || ny >= g.ny) continue;
      const ni = ny * g.nx + nx;
      if (dist[ni] >= 0 && dist[ni] < dist[next]) next = ni;
    }
    if (next === cur) break;
    cur = next;
    const px = g.x0 + ((cur % g.nx) + 0.5) * g.cell, py = g.y0 + (Math.floor(cur / g.nx) + 0.5) * g.cell;
    if (!segmentBlocked(x, y, px, py, L.walls, false, 0.4)) aim = cur;
  }
  if (aim === start) aim = cur;
  const ax = g.x0 + ((aim % g.nx) + 0.5) * g.cell - x, ay = g.y0 + (Math.floor(aim / g.nx) + 0.5) * g.cell - y;
  const al = Math.max(1e-3, len(ax, ay));
  return [ax / al, ay / al];
}

export function botInput(s: GameState, p: Player): PlayerInput {
  if (!p.active) return NEUTRAL;
  const P = s.params;
  const L = level(s);

  if (p.role === 'overlord') {
    let target: Player | null = null, bd = 1e18;
    for (const o of s.players) {
      if (!o.active || !o.alive || o.role !== 'fighter') continue;
      const d = dist2(p.cursorX, p.cursorY, o.x, o.y);
      if (d < bd) { bd = d; target = o; }
    }
    if (!target) return NEUTRAL;
    const lead = P.bombFallTime * 0.6;
    const tx = target.x + target.vx * lead, ty = target.y + target.vy * lead;
    const dx = tx - p.cursorX, dy = ty - p.cursorY, d = len(dx, dy);
    const b = d < 1.2 && p.bombCd <= 0 && rand(s) < 0.2 ? BTN_ATTACK : 0;
    return makeInput(d > 0.2 ? dx / Math.max(d, 1) : 0, d > 0.2 ? dy / Math.max(d, 1) : 0, 0, 0, b);
  }
  if (!p.alive) return NEUTRAL;
  if (p.car >= 0) {
    // Drive toward the nearest enemy.
    const e = nearestEnemy(s, p);
    if (!e) return makeInput(0, -1, 0, 0, 0);
    const car = s.cars.find((c) => c.id === p.car);
    if (!car) return NEUTRAL;
    const dx = e.x - car.x, dy = e.y - car.y;
    const cross = car.hx * dy - car.hy * dx;
    return makeInput(clamp(cross, -1, 1), -1, 0, 0, 0);
  }

  let b = 0;
  let goalX = p.x, goalY = p.y;
  let aimX = 0, aimY = 0;
  const held = heldHats(s, p);
  let enemy = nearestEnemy(s, p);
  const mode = s.cfg.mode;

  // Where do we want to be?
  if (mode === 'soccer' && s.ball) {
    const ball = s.ball;
    const goal = L.goals.find((g) => g.team !== p.team % 2);
    const gx = goal ? (goal.x0 + goal.x1) / 2 : 0, gy = 0;
    const gdx = gx - ball.x, gdy = gy - ball.y, gl = Math.max(0.01, len(gdx, gdy));
    const behindX = ball.x - (gdx / gl) * 1.4, behindY = ball.y - (gdy / gl) * 1.4;
    if (dist2(p.x, p.y, behindX, behindY) > 0.8) { goalX = behindX; goalY = behindY; }
    else { goalX = ball.x; goalY = ball.y; }
    if (dist2(p.x, p.y, ball.x, ball.y) < (P.slashRange + 0.3) ** 2 && rand(s) < 0.1) {
      b |= BTN_ATTACK; aimX = gdx; aimY = gdy;
    }
  } else if (mode === 'ctf' && s.flags.length === 2) {
    const mine = s.flags.find((f) => f.team === p.team % 2)!;
    const theirs = s.flags.find((f) => f.team !== p.team % 2)!;
    if (theirs.carrier === p.id) { goalX = mine.homeX; goalY = mine.homeY; }
    else if (mine.carrier >= 0) { const c = s.players[mine.carrier]; goalX = c.x; goalY = c.y; }
    else if (!mine.atHome && p.id % 2 === 0) { goalX = mine.x; goalY = mine.y; }
    else if (theirs.carrier >= 0) { const c = s.players[theirs.carrier]; goalX = c.x + 1.5; goalY = c.y; }
    else { goalX = theirs.x; goalY = theirs.y; }
  } else if (mode === 'lumber') {
    // Chop the nearest standing tree; only fight rivals who come close.
    let tree = null, bd = 1e18;
    for (const t of s.trees) {
      if (!isStanding(t)) continue;
      const d = dist2(p.x, p.y, t.x, t.y);
      if (d < bd) { bd = d; tree = t; }
    }
    if (enemy && dist2(p.x, p.y, enemy.x, enemy.y) > 4 * 4) enemy = null;
    if (tree && !enemy) {
      const dx = tree.x - p.x, dy = tree.y - p.y, d = Math.sqrt(bd);
      const reach = P.slashRange + P.treeRadius - 0.3;
      if (d > reach) { goalX = tree.x - (dx / d) * (reach - 0.2); goalY = tree.y - (dy / d) * (reach - 0.2); }
      aimX = dx; aimY = dy;
      if (held > 0 && d <= reach + 0.2 && p.slashCd <= 0 && rand(s) < 0.5) b |= BTN_ATTACK;
      else if (held > 0 && d > 4 && d < P.hatRange && p.botAimT <= 0 && rand(s) < 0.02 &&
               !segmentBlocked(p.x, p.y, tree.x, tree.y, L.walls, true)) {
        b |= BTN_THROW; p.botAimT = 0; // tap-throw at the tree
      }
    }
  } else if (enemy) {
    goalX = enemy.x; goalY = enemy.y;
  } else {
    // Wander.
    if (--p.botT <= 0) { p.botT = 60 + Math.floor(rand(s) * 90); p.botMx = rand(s) * 2 - 1; p.botMy = rand(s) * 2 - 1; }
    goalX = p.x + p.botMx * 4; goalY = p.y + p.botMy * 4;
  }

  // Grab a nearby power-up.
  for (const q of s.pickups) {
    if (dist2(p.x, p.y, q.x, q.y) < 25) { goalX = q.x; goalY = q.y; break; }
  }

  // Hat management.
  if (held === 0) {
    const mine = s.hats.find((h) => h.owner === p.id && h.state === HAT_GROUND);
    if (mine) {
      const d2 = dist2(p.x, p.y, mine.x, mine.y);
      if (d2 > 16 && !segmentBlocked(p.x, p.y, mine.x, mine.y, L.walls, true)) b |= BTN_THROW; // recall
      else if (mode !== 'soccer') { goalX = mine.x; goalY = mine.y; }
    }
  }

  // Combat.
  if (enemy) {
    const dx = enemy.x - p.x, dy = enemy.y - p.y, d = len(dx, dy);
    const los = !segmentBlocked(p.x, p.y, enemy.x, enemy.y, L.walls, true);
    if (p.botAimT > 0) {
      // Holding a charged throw; track the target with lead.
      p.botAimT--;
      const t = d / Math.max(1, P.chargedHatSpeed);
      aimX = enemy.x + enemy.vx * t - p.x; aimY = enemy.y + enemy.vy * t - p.y;
      if (p.botAimT > 0) b |= BTN_THROW;
    } else if (held > 0 && d < P.slashRange + P.hitRadius + 0.4 && p.slashCd <= 0) {
      if (rand(s) < 0.35) { b |= BTN_ATTACK; aimX = dx; aimY = dy; }
    } else if (held === 0 && d < P.kickRange + 0.3 && p.slashCd <= 0 && rand(s) < 0.15) {
      b |= BTN_ATTACK; aimX = dx; aimY = dy;
    } else if (held > 0 && los && d > 3 && d < P.chargedHatRange && rand(s) < 0.02 && mode !== 'soccer') {
      // Close targets get a quick throw; far ones a stationary, powered throw.
      const aimHold = Math.round(P.aimHoldTime * 60);
      p.botAimT = d < P.hatRange * 0.9 ? 2 : aimHold + 4 + Math.floor(rand(s) * P.chargeTime * 60);
      b |= BTN_THROW; aimX = dx; aimY = dy;
    }
    // Keep a little distance and strafe when armed and far.
    if (--p.botT <= 0) { p.botT = 40 + Math.floor(rand(s) * 60); p.botStrafe = rand(s) < 0.5 ? -1 : 1; }
  }

  // Dodge incoming hats.
  if (p.dashCd <= 0) {
    for (const h of s.hats) {
      if (!isLethal(s, h) || h.owner === p.id) continue;
      const o = s.players[h.owner];
      if (o && allies(s, o, p)) continue;
      const rx = p.x - h.x, ry = p.y - h.y, rd = len(rx, ry);
      if (rd > 5) continue;
      const vl = Math.max(0.01, len(h.vx, h.vy));
      if ((rx * h.vx + ry * h.vy) / (rd * vl) > 0.85 && rand(s) < 0.25) {
        b |= BTN_DASH;
        const side = p.botStrafe || 1;
        return makeInput((-h.vy / vl) * side, (h.vx / vl) * side, aimX, aimY, b);
      }
    }
  }

  let [mx, my] = pathDir(s, p.x, p.y, goalX, goalY);
  const gd = len(goalX - p.x, goalY - p.y);
  if (enemy && goalX === enemy.x && goalY === enemy.y && held > 0 && gd < 6) {
    // Circle the enemy a bit instead of beelining.
    mx += -my * p.botStrafe * 0.6; my += mx * p.botStrafe * 0.6;
  }
  if (gd < 0.3) { mx = 0; my = 0; }
  return makeInput(mx, my, aimX, aimY, b);
}

export { HAT_HELD };
