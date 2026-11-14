// Lumberjacks mode: choppable trees. Standing trees block bodies and hats;
// felling one scores for the chopper, and a new tree grows elsewhere.

import { scoreIndex, teamOf } from './const';
import { dist2, len } from './dmath';
import { circleOverlapsWalls } from './collision';
import { randRange } from './rng';
import type { GameState, Tree } from './types';
import { emit, hitstop, level, newId, sec } from './common';

export function isStanding(t: Tree): boolean {
  return t.hp > 0;
}

function treeSpot(s: GameState): { x: number; y: number } | null {
  const L = level(s);
  const r = s.params.treeRadius;
  for (let tries = 0; tries < 16; tries++) {
    const x = randRange(s, -L.w + 1.5, L.w - 1.5), y = randRange(s, -L.h + 1.5, L.h - 1.5);
    if (circleOverlapsWalls(x, y, r + 0.9, L.walls, false)) continue;
    let ok = true;
    for (const t of s.trees) if (isStanding(t) && dist2(t.x, t.y, x, y) < 3 * 3) ok = false;
    for (const p of s.players) if (p.active && p.alive && dist2(p.x, p.y, x, y) < 2.5 * 2.5) ok = false;
    for (const sp of L.spawns) if (dist2(sp.x, sp.y, x, y) < 2 * 2) ok = false;
    if (ok) return { x, y };
  }
  return null;
}

export function resetTrees(s: GameState): void {
  s.trees = [];
  if (s.cfg.mode !== 'lumber') return;
  const n = Math.round(s.params.treeCount);
  for (let i = 0; i < n; i++) {
    const spot = treeSpot(s);
    if (!spot) continue;
    s.trees.push({ id: newId(s), x: spot.x, y: spot.y, hp: Math.round(s.params.treeHp), regrowT: 0, grow: 0 });
  }
}

/** One hit on a tree from player `who`, coming from direction (dx, dy). */
export function chopTree(s: GameState, t: Tree, who: number, dx: number, dy: number): void {
  if (!isStanding(t)) return;
  t.hp--;
  emit(s, { e: 'chop', tree: t.id, who, x: t.x, y: t.y });
  if (t.hp > 0) return;
  const d = Math.max(1e-6, len(dx, dy));
  emit(s, { e: 'fell', tree: t.id, who, x: t.x, y: t.y, dx: dx / d, dy: dy / d });
  t.regrowT = sec(s, 'treeRegrowTime');
  hitstop(s, s.params.hitstopClash);
  const p = s.players[who];
  if (p && p.active && s.phase === 'playing') s.scores[scoreIndex(s, teamOf(s, p))]++;
  if (p) p.trees++;
}

export function updateTrees(s: GameState): void {
  for (const t of s.trees) {
    if (t.grow < 30) t.grow++;
    if (isStanding(t)) continue;
    if (t.regrowT > 0) { t.regrowT--; continue; }
    const spot = treeSpot(s);
    if (!spot) continue;
    t.x = spot.x; t.y = spot.y; t.hp = Math.round(s.params.treeHp); t.grow = 0;
    t.id = newId(s); // new tree, new view
  }
}

/** Push a circle out of standing trees. Returns the tree hit, if any. */
export function collideTrees(s: GameState, c: { x: number; y: number }, r: number): Tree | null {
  let hit: Tree | null = null;
  const tr = s.params.treeRadius;
  for (const t of s.trees) {
    if (!isStanding(t)) continue;
    const dx = c.x - t.x, dy = c.y - t.y, m = r + tr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= m * m) continue;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    c.x = t.x + nx * m; c.y = t.y + ny * m;
    hit = t;
  }
  return hit;
}
