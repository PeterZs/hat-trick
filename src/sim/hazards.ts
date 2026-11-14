// Arena hazards and gadgets: pits and open edges, tile floors that collapse or
// turn to lava, ice, conveyors, bumpers, portals and wind. All deterministic.

import { DT, HZ } from './const';
import { clamp, dist2, len } from './dmath';
import { collideCircle, type Push } from './collision';
import { randInt } from './rng';
import type { Level, TileSpec } from './level';
import { HAT_GROUND, HAT_HELD, HAT_OUT, HAT_RECALL, HAT_RETURN, type GameState, type Player } from './types';
import { die, emit, level, sec } from './common';
import { bounceHat, crashCar } from './actors';

const tmp: Push = { x: 0, y: 0, hit: false, nx: 0, ny: 0 };

export const TILE_SOLID = 0;
export const TILE_FALLEN = -1;
export const TILE_NONE = -2;

// ---------------------------------------------------------------------------
// Tiles

export interface TileGrid { cell: number; nx: number; ny: number; x0: number; y0: number; spec: TileSpec }

/** The tile layout for the current arena/mode (null = plain floor). */
export function tileGrid(s: GameState): TileGrid | null {
  const L = level(s);
  const spec = L.tiles ?? (s.cfg.mode === 'lava' ? { cell: 2, lava: true } : null);
  if (!spec) return null;
  const nx = Math.ceil((2 * L.w) / spec.cell), ny = Math.ceil((2 * L.h) / spec.cell);
  return { cell: spec.cell, nx, ny, x0: -nx * spec.cell / 2, y0: -ny * spec.cell / 2, spec };
}

export function tileCenter(g: TileGrid, i: number): [number, number] {
  const tx = i % g.nx, ty = (i - tx) / g.nx;
  return [g.x0 + (tx + 0.5) * g.cell, g.y0 + (ty + 0.5) * g.cell];
}

export function tileIndex(g: TileGrid, x: number, y: number): number {
  const tx = Math.floor((x - g.x0) / g.cell), ty = Math.floor((y - g.y0) / g.cell);
  if (tx < 0 || ty < 0 || tx >= g.nx || ty >= g.ny) return -1;
  return ty * g.nx + tx;
}

/** Is the floor gone (or lava) here? */
export function isHazard(s: GameState, x: number, y: number): 'pit' | 'lava' | null {
  const L = level(s);
  if (L.open && (Math.abs(x) > L.w || Math.abs(y) > L.h)) return 'pit';
  for (const p of L.pits ?? []) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) return 'pit';
  if (s.tiles.length) {
    const g = tileGrid(s);
    if (g) {
      const i = tileIndex(g, x, y);
      if (i >= 0) {
        const t = s.tiles[i];
        if (t === TILE_NONE) return 'pit';
        if (t === TILE_FALLEN) return g.spec.lava ? 'lava' : 'pit';
      }
    }
  }
  return null;
}

export function resetTiles(s: GameState): void {
  s.tileT = 0;
  const g = tileGrid(s);
  if (!g) { s.tiles = []; return; }
  s.tiles = new Array(g.nx * g.ny).fill(TILE_SOLID);
  if (g.spec.circle) {
    for (let i = 0; i < s.tiles.length; i++) {
      const [cx, cy] = tileCenter(g, i);
      if (cx * cx + cy * cy > g.spec.circle * g.spec.circle) s.tiles[i] = TILE_NONE;
    }
  }
}

function warnTile(s: GameState, i: number): void {
  if (s.tiles[i] !== TILE_SOLID) return;
  s.tiles[i] = Math.max(1, sec(s, 'tileWarnTime'));
  emit(s, { e: 'tile', i, what: 'warn' });
}

/** Advance collapsing floors and Floor-is-Lava (only while a round is being played). */
function updateTiles(s: GameState): void {
  if (!s.tiles.length) return;
  const g = tileGrid(s)!;
  for (let i = 0; i < s.tiles.length; i++) {
    if (s.tiles[i] > 0 && --s.tiles[i] === 0) { s.tiles[i] = TILE_FALLEN; emit(s, { e: 'tile', i, what: 'fall' }); }
  }
  if (s.phase !== 'playing') return;
  s.tileT++;
  const P = s.params;
  if (g.spec.collapse) {
    // The edge creeps in: tiles beyond radius R(t) start to go.
    const L = level(s);
    const rMax = g.spec.circle ?? Math.max(L.w, L.h), rMin = g.cell * 1.5;
    const k = Math.min(1, s.tileT / Math.max(1, sec(s, 'collapseTime')));
    const r = rMax - (rMax - rMin) * k;
    for (let i = 0; i < s.tiles.length; i++) {
      if (s.tiles[i] !== TILE_SOLID) continue;
      const [cx, cy] = tileCenter(g, i);
      // Rectangular floors shrink as rectangles, round ones as circles.
      const d = g.spec.circle ? len(cx, cy) : Math.max(Math.abs(cx) * rMax / L.w, Math.abs(cy) * rMax / L.h);
      if (d > r) warnTile(s, i);
    }
  }
  if (s.cfg.mode === 'lava') {
    // Random tiles turn to lava, faster and faster.
    const ramp = Math.min(1, s.tileT / Math.max(1, sec(s, 'lavaRampTime')));
    const every = Math.max(1, Math.round((P.lavaStartInterval + (P.lavaMinInterval - P.lavaStartInterval) * ramp) * HZ));
    if (s.tileT % every === 0) {
      const solid: number[] = [];
      for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === TILE_SOLID) solid.push(i);
      if (solid.length > 2) warnTile(s, solid[randInt(s, solid.length)]);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-frame hazard effects

function inRect(r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): boolean {
  return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
}

export function onIce(s: GameState, x: number, y: number): boolean {
  for (const r of level(s).ice ?? []) if (inRect(r, x, y)) return true;
  return false;
}

/** Conveyor push and wind at a point. */
function flow(L: Level, x: number, y: number): [number, number] {
  let vx = 0, vy = 0;
  for (const c of L.conveyors ?? []) if (inRect(c, x, y)) { vx += c.vx; vy += c.vy; }
  return [vx, vy];
}

function windAt(L: Level, x: number, y: number): [number, number] {
  let fx = 0, fy = 0;
  for (const w of L.wind ?? []) if (inRect(w, x, y)) { fx += w.fx; fy += w.fy; }
  return [fx, fy];
}

/** Bodies, grounded hats and balls ride conveyors; wind bends flying hats. */
export function applyFields(s: GameState): void {
  const L = level(s);
  if (!L.conveyors && !L.wind) return;
  const P = s.params;
  for (const p of s.players) {
    if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0 || p.car >= 0) continue;
    const [vx, vy] = flow(L, p.x, p.y);
    const [fx, fy] = windAt(L, p.x, p.y);
    if (!vx && !vy && !fx && !fy) continue;
    p.x += vx * DT; p.y += vy * DT;
    p.kx += fx * P.windOnPlayers * DT; p.ky += fy * P.windOnPlayers * DT;
    collideCircle(p.x, p.y, P.playerRadius, L.walls, false, tmp);
    p.x = tmp.x; p.y = tmp.y;
  }
  for (const h of s.hats) {
    if (h.state === HAT_GROUND) {
      const [vx, vy] = flow(L, h.x, h.y);
      if (vx || vy) {
        h.x += vx * DT; h.y += vy * DT;
        collideCircle(h.x, h.y, P.hatRadius, L.walls, false, tmp);
        h.x = tmp.x; h.y = tmp.y;
      }
    } else if (h.state === HAT_OUT || h.state === HAT_RETURN) {
      const [fx, fy] = windAt(L, h.x, h.y);
      h.vx += fx * DT; h.vy += fy * DT;
    }
  }
  const balls = [...(s.ball ? [s.ball] : []), ...(s.golf?.balls.filter((b) => !b.sunk) ?? [])];
  for (const b of balls) {
    const [vx, vy] = flow(L, b.x, b.y);
    const [fx, fy] = windAt(L, b.x, b.y);
    b.x += vx * DT; b.y += vy * DT;
    b.vx += fx * 0.4 * DT; b.vy += fy * 0.4 * DT;
  }
}

/** Falls, lava, bumpers and portals. Runs after everything has moved. */
export function updateHazards(s: GameState): void {
  updateTiles(s);
  const L = level(s);
  const P = s.params;

  // --- Bumpers fling bodies, hats, balls and cars.
  L.bumpers?.forEach((bm, i) => {
    for (const p of s.players) {
      if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0 || p.car >= 0) continue;
      const r = bm.r + P.playerRadius;
      const dx = p.x - bm.x, dy = p.y - bm.y, d = len(dx, dy);
      if (d >= r || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      p.x = bm.x + nx * r; p.y = bm.y + ny * r;
      p.vx = 0; p.vy = 0; p.dashT = 0;
      p.kx = nx * P.bumperForce; p.ky = ny * P.bumperForce;
      p.stunT = Math.max(p.stunT, sec(s, 'stunTime') >> 1);
      emit(s, { e: 'bump', x: bm.x + nx * bm.r, y: bm.y + ny * bm.r, i });
    }
    for (const h of s.hats) {
      if (h.state !== HAT_OUT && h.state !== HAT_RETURN) continue;
      const r = bm.r + P.hatRadius * 0.6;
      const dx = h.x - bm.x, dy = h.y - bm.y, d = len(dx, dy);
      if (d >= r || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      h.x = bm.x + nx * r; h.y = bm.y + ny * r;
      // Reflect and speed up; outbound hats turn for home.
      const vn = h.vx * nx + h.vy * ny;
      if (vn < 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
      h.speed *= 1.15; h.vx *= 1.15; h.vy *= 1.15;
      if (h.state === HAT_OUT) bounceHat(s, h, nx, ny);
      emit(s, { e: 'bump', x: bm.x + nx * bm.r, y: bm.y + ny * bm.r, i });
    }
    const balls = [...(s.ball ? [s.ball] : []), ...(s.golf?.balls.filter((b) => !b.sunk) ?? [])];
    for (const b of balls) {
      const r = bm.r + P.ballRadius * (s.golf ? 0.5 : 1);
      const dx = b.x - bm.x, dy = b.y - bm.y, d = len(dx, dy);
      if (d >= r || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      b.x = bm.x + nx * r; b.y = bm.y + ny * r;
      const sp = Math.max(len(b.vx, b.vy), P.bumperForce * 0.8);
      b.vx = nx * sp; b.vy = ny * sp;
      emit(s, { e: 'bump', x: bm.x + nx * bm.r, y: bm.y + ny * bm.r, i });
    }
    for (const c of s.cars) {
      const r = bm.r + 1.0;
      const dx = c.x - bm.x, dy = c.y - bm.y, d = len(dx, dy);
      if (d >= r || d < 1e-6) continue;
      c.x = bm.x + (dx / d) * r; c.y = bm.y + (dy / d) * r; c.speed *= -0.8;
      emit(s, { e: 'bump', x: bm.x, y: bm.y, i });
    }
  });

  // --- Portals: step in, come out of the partner, keeping your momentum.
  if (L.portals?.length) {
    const exit = (i: number, vx: number, vy: number): [number, number] => {
      const to = L.portals![L.portals![i].to];
      const v = len(vx, vy);
      return v > 0.5 ? [to.x + (vx / v) * 1.3, to.y + (vy / v) * 1.3] : [to.x, to.y + 1.3];
    };
    L.portals.forEach((pt, i) => {
      for (const p of s.players) {
        if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0 || p.car >= 0 || p.portalCd > 0) continue;
        if (dist2(p.x, p.y, pt.x, pt.y) > 0.8 * 0.8) continue;
        const [nx, ny] = exit(i, p.vx + p.kx, p.vy + p.ky);
        emit(s, { e: 'portal', x: p.x, y: p.y, x2: nx, y2: ny });
        p.x = nx; p.y = ny; p.portalCd = sec(s, 'portalCooldown');
        const r = s.players[p.rider];
        if (r) { r.x = nx; r.y = ny; }
      }
      for (const h of s.hats) {
        if (h.state === HAT_HELD || h.state === HAT_GROUND || h.portalCd > 0) continue;
        if (dist2(h.x, h.y, pt.x, pt.y) > 0.8 * 0.8) continue;
        const [nx, ny] = exit(i, h.vx, h.vy);
        emit(s, { e: 'portal', x: h.x, y: h.y, x2: nx, y2: ny });
        h.x = nx; h.y = ny; h.portalCd = sec(s, 'portalCooldown');
      }
      const balls = [...(s.ball ? [s.ball] : []), ...(s.golf?.balls.filter((b) => !b.sunk) ?? [])];
      for (const b of balls) {
        if ((b.portalCd ?? 0) > 0 || dist2(b.x, b.y, pt.x, pt.y) > 0.8 * 0.8) continue;
        const [nx, ny] = exit(i, b.vx, b.vy);
        emit(s, { e: 'portal', x: b.x, y: b.y, x2: nx, y2: ny });
        b.x = nx; b.y = ny; b.portalCd = sec(s, 'portalCooldown');
      }
    });
  }
  for (const p of s.players) if (p.portalCd > 0) p.portalCd--;
  for (const h of s.hats) if (h.portalCd > 0) h.portalCd--;
  if (s.ball && (s.ball.portalCd ?? 0) > 0) s.ball.portalCd!--;
  for (const b of s.golf?.balls ?? []) if (b.portalCd > 0) b.portalCd--;

  // --- Falling and lava.
  for (const p of s.players) {
    if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0) continue;
    if (p.car >= 0) {
      const c = s.cars.find((c) => c.id === p.car);
      if (c && isHazard(s, c.x, c.y)) { crashCar(s, c); fall(s, p, isHazard(s, p.x, p.y) ?? 'pit'); }
      continue;
    }
    if (p.dashT > 0) continue; // dashing skims over gaps
    const hz = isHazard(s, p.x, p.y);
    if (hz) fall(s, p, hz);
  }
  for (const c of s.cars) if (c.driver < 0 && !c.dead && isHazard(s, c.x, c.y)) crashCar(s, c);
  // Grounded hats that fall in pop back into their owner's hands.
  for (const h of s.hats) {
    if (h.state !== HAT_GROUND || h.bomb || !isHazard(s, h.x, h.y)) continue;
    const owner = s.players[h.owner];
    emit(s, { e: 'splash', x: h.x, y: h.y });
    // Back to its owner (even a popped one: they respawn holding it).
    h.state = HAT_HELD; h.vx = h.vy = 0;
    if (owner) { h.x = owner.x; h.y = owner.y; if (owner.alive) emit(s, { e: 'catch', who: owner.id, hat: h.id }); }
  }
  if (s.ball && isHazard(s, s.ball.x, s.ball.y)) {
    emit(s, { e: 'splash', x: s.ball.x, y: s.ball.y });
    s.ball = { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1 };
  }
}

/** Shoved into a pit or lava: credit whoever shoved you recently. */
function fall(s: GameState, p: Player, how: 'pit' | 'lava'): void {
  const credit = s.frame - p.lastHitT < sec(s, 'fallCreditTime') ? p.lastHitBy : -1;
  emit(s, { e: 'splash', x: p.x, y: p.y });
  die(s, p, credit, how === 'lava' ? 'lava' : 'fall');
}

/** Record who shoved a player (kicks, clashes, dash bumps). */
export function shovedBy(s: GameState, victim: Player, by: number): void {
  victim.lastHitBy = by;
  victim.lastHitT = s.frame;
}

/** Is it safe to stand here? (for spawning and bots) */
export function safeSpot(s: GameState, x: number, y: number, margin = 0.6): boolean {
  if (isHazard(s, x, y)) return false;
  for (const [dx, dy] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin]]) if (isHazard(s, x + dx, y + dy)) return false;
  // Tiles about to fall aren't safe either.
  if (s.tiles.length) {
    const g = tileGrid(s);
    const i = g ? tileIndex(g, x, y) : -1;
    if (i >= 0 && s.tiles[i] > 0) return false;
  }
  return true;
}

/** A random safe tile center (when every spawn point is gone). */
export function anySafeSpot(s: GameState): { x: number; y: number } | null {
  const g = tileGrid(s);
  if (!g) return null;
  const ok: number[] = [];
  for (let i = 0; i < s.tiles.length; i++) {
    const [x, y] = tileCenter(g, i);
    if (s.tiles[i] === TILE_SOLID && safeSpot(s, x, y) && !collideCircle(x, y, 0.6, level(s).walls, false, tmp).hit) ok.push(i);
  }
  if (!ok.length) return null;
  const [x, y] = tileCenter(g, ok[randInt(s, ok.length)]);
  return { x, y };
}

export { clamp };
