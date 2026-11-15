// Breakable props: trees, crates, explosive barrels, rocks and bushes.
// Standing props block bodies (and most block hats). Slashes and thrown hats
// damage them. Levels place fixed props that regrow in place; Lumberjacks
// also scatters trees that regrow somewhere new.

import { scoreIndex, teamOf } from './const';
import { dist2, len } from './dmath';
import { circleOverlapsWalls } from './collision';
import { rand, randInt, randRange } from './rng';
import { BAD_PICKUPS, GOOD_PICKUPS, HAT_GROUND, HAT_HELD, type GameState, type Prop, type PropKind } from './types';
import { canBeHit, dropHat, emit, hitstop, kill, level, newId, sec } from './common';
import { safeSpot } from './hazards';

export interface PropInfo { hp: number; r: number; blocksHats: boolean; solid: boolean; name: string }

export function propInfo(s: GameState, kind: PropKind): PropInfo {
  const P = s.params;
  switch (kind) {
    case 'tree': return { hp: Math.round(P.treeHp), r: P.treeRadius, blocksHats: true, solid: true, name: 'Tree' };
    case 'crate': return { hp: 2, r: 0.55, blocksHats: true, solid: true, name: 'Crate' };
    case 'barrel': return { hp: 1, r: 0.45, blocksHats: true, solid: true, name: 'Barrel' };
    case 'rock': return { hp: 5, r: 0.8, blocksHats: true, solid: true, name: 'Rock' };
    case 'bush': return { hp: 1, r: 0.55, blocksHats: false, solid: true, name: 'Bush' };
    // Tall grass: walk and throw straight through; hides whoever is in it.
    case 'grass': return { hp: 1, r: 0.95, blocksHats: false, solid: false, name: 'Grass' };
  }
}

export function isStanding(t: Prop): boolean {
  return t.hp > 0;
}

function makeProp(s: GameState, kind: PropKind, x: number, y: number, fixed: boolean): Prop {
  return { id: newId(s), kind, x, y, hp: propInfo(s, kind).hp, regrowT: 0, grow: 30, fixed };
}

function treeSpot(s: GameState): { x: number; y: number } | null {
  const L = level(s);
  const r = s.params.treeRadius;
  for (let tries = 0; tries < 16; tries++) {
    const x = randRange(s, -L.w + 1.5, L.w - 1.5), y = randRange(s, -L.h + 1.5, L.h - 1.5);
    if (circleOverlapsWalls(x, y, r + 0.9, L.walls, false) || !safeSpot(s, x, y, r + 0.5)) continue;
    let ok = true;
    for (const t of s.props) if (isStanding(t) && dist2(t.x, t.y, x, y) < 3 * 3) ok = false;
    for (const p of s.players) if (p.active && p.alive && dist2(p.x, p.y, x, y) < 2.5 * 2.5) ok = false;
    for (const sp of L.spawns) if (dist2(sp.x, sp.y, x, y) < 2 * 2) ok = false;
    if (ok) return { x, y };
  }
  return null;
}

export function resetProps(s: GameState): void {
  s.props = level(s).props.map((d) => makeProp(s, d.kind, d.x, d.y, true));
  if (s.cfg.mode !== 'lumber') return;
  const n = Math.round(s.params.treeCount);
  for (let i = 0; i < n; i++) {
    const spot = treeSpot(s);
    if (spot) s.props.push(makeProp(s, 'tree', spot.x, spot.y, false));
  }
}

/** One hit on a prop from player `who`, coming from direction (dx, dy). */
export function chopProp(s: GameState, t: Prop, who: number, dx: number, dy: number): void {
  if (!isStanding(t)) return;
  t.hp--;
  emit(s, { e: 'chop', prop: t.id, kind: t.kind, who, x: t.x, y: t.y });
  if (t.hp > 0) return;
  const d = Math.max(1e-6, len(dx, dy));
  emit(s, { e: 'fell', prop: t.id, kind: t.kind, who, x: t.x, y: t.y, dx: dx / d, dy: dy / d });
  t.regrowT = t.kind === 'grass' ? sec(s, 'grassRegrowTime')
    : t.fixed ? Math.round(sec(s, 'propRegrowTime') * (level(s).regrowScale ?? 1)) : sec(s, 'treeRegrowTime');
  if (t.kind !== 'grass') hitstop(s, s.params.hitstopClash);
  const p = s.players[who];
  switch (t.kind) {
    case 'tree':
      if (p && p.active && s.phase === 'playing' && s.cfg.mode === 'lumber') s.scores[scoreIndex(s, teamOf(s, p))]++;
      if (p) p.trees++;
      break;
    case 'crate':
      if (rand(s) < s.params.crateDropChance && s.cfg.mode !== 'lumber') {
        const pool = rand(s) < s.params.badPowerupChance ? BAD_PICKUPS : GOOD_PICKUPS;
        s.pickups.push({ id: newId(s), kind: pool[randInt(s, pool.length)], x: t.x, y: t.y, t: 0 });
      }
      break;
    case 'barrel':
      explode(s, t.x, t.y, who);
      break;
  }
}

/** Barrel blast: pops everyone in range (the breaker included), knocks hats down, sets off other barrels. */
function explode(s: GameState, x: number, y: number, who: number): void {
  const R = s.params.barrelBlastRadius;
  emit(s, { e: 'boom', x, y });
  for (const p of s.players) {
    if (canBeHit(p) && dist2(p.x, p.y, x, y) < (R + s.params.hitRadius) ** 2) kill(s, p, who);
  }
  for (const h of s.hats) {
    if (h.state !== HAT_GROUND && h.state !== HAT_HELD && dist2(h.x, h.y, x, y) < R * R) dropHat(s, h);
  }
  for (const o of s.props) {
    if (o.kind === 'barrel' && isStanding(o) && dist2(o.x, o.y, x, y) < R * R) chopProp(s, o, who, o.x - x, o.y - y);
  }
}

export function updateProps(s: GameState): void {
  // Who is hidden in tall grass? Anywhere the tufts visibly cover the ball's center.
  const P = s.params;
  const hideR = propInfo(s, 'grass').r + P.playerRadius * 0.6;
  for (const p of s.players) {
    p.inGrass = false;
    if (!p.active || !p.alive) continue;
    for (const t of s.props) {
      if (t.kind === 'grass' && isStanding(t) && dist2(p.x, p.y, t.x, t.y) < hideR * hideR) { p.inGrass = true; break; }
    }
  }
  for (const t of s.props) {
    if (t.grow < 30) t.grow++;
    if (isStanding(t)) continue;
    if (t.regrowT > 0) { t.regrowT--; continue; }
    if (t.fixed && propInfo(s, t.kind).solid) {
      // Regrow in place, but never on top of someone (grass can grow around you).
      const r = propInfo(s, t.kind).r + s.params.playerRadius + 0.2;
      if (s.players.some((p) => p.active && p.alive && dist2(p.x, p.y, t.x, t.y) < r * r)) continue;
    } else if (!t.fixed) {
      const spot = treeSpot(s);
      if (!spot) continue;
      t.x = spot.x; t.y = spot.y;
    }
    t.hp = propInfo(s, t.kind).hp; t.grow = 0;
    t.id = newId(s); // a new prop, a new view
  }
}

/** Push a circle out of standing props. Returns the prop hit (and whether it blocks), if any. */
export function collideProps(s: GameState, c: { x: number; y: number }, r: number, forHat = false): Prop | null {
  let hit: Prop | null = null;
  for (const t of s.props) {
    if (!isStanding(t)) continue;
    const info = propInfo(s, t.kind);
    if (!info.solid) continue;
    const dx = c.x - t.x, dy = c.y - t.y, m = r + info.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= m * m) continue;
    hit = t;
    if (forHat && !info.blocksHats) continue; // hats pass through bushes
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    c.x = t.x + nx * m; c.y = t.y + ny * m;
  }
  return hit;
}

export type { Prop, PropKind };
