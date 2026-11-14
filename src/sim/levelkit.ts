// Level data types and small builders shared by level definitions.

import type { PropKind } from './types';

export interface Wall {
  x: number; y: number;   // center
  hw: number; hh: number; // half extents
  high: boolean;          // high walls stop hats; low walls only stop bodies
  kind: 'wall' | 'box' | 'low' | 'net';
}

export interface Spawn { x: number; y: number; team: number } // team -1 = anyone

export interface Goal { team: number; x0: number; y0: number; x1: number; y1: number } // team that defends it

export interface Level {
  id: string;
  name: string;
  w: number; h: number;   // half extents of the playfield floor
  walls: Wall[];
  spawns: Spawn[];
  goals: Goal[];
  bases: { team: number; x: number; y: number }[];
  floor: [string, string];
  /** Breakables placed by the level. */
  props: { kind: PropKind; x: number; y: number }[];
  // --- Optional hazards and features ---------------------------------------
  /** Holes you fall into (static). */
  pits?: Rect[];
  /** Pits are water (drawn blue). */
  water?: boolean;
  /** No border: anything outside [-w,w]x[-h,h] is a fall. */
  open?: boolean;
  /** Slippery floor. */
  ice?: Rect[];
  /** Belts that carry bodies, grounded hats and balls. */
  conveyors?: Conveyor[];
  /** Pinball bumpers that fling things away. */
  bumpers?: Bumper[];
  /** Teleporters; `to` is the index of the partner portal. */
  portals?: Portal[];
  /** Wind zones that push flying hats (and, gently, bodies). */
  wind?: Wind[];
  /** Floor made of tiles that can fall away (collapse / lava). */
  tiles?: TileSpec;
  /** Day/night lighting cycle (visual only). */
  night?: boolean;
  /** Golf holes (Golf mode). */
  holes?: GolfHole[];
  /** Ground color outside the arena (e.g. water around open levels). */
  outside?: string;
  /** Only these modes can use this arena (default: any). */
  modes?: string[];
  /** Mode this arena is made for (shown first / used as its default). */
  short?: string;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Conveyor extends Rect { vx: number; vy: number }
export interface Bumper { x: number; y: number; r: number }
export interface Portal { x: number; y: number; to: number }
export interface Wind extends Rect { fx: number; fy: number }
export interface TileSpec {
  cell: number;               // tile size
  circle?: number;            // only tiles within this radius exist (round platform)
  collapse?: boolean;         // the floor shrinks toward the center during a round
  lava?: boolean;             // fallen tiles are lava (else a drop into the void)
}
export interface GolfHole { tees: [number, number][]; cup: [number, number] }

export const R = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

export const W = (x: number, y: number, hw: number, hh: number, kind: Wall['kind'] = 'wall'): Wall =>
  ({ x, y, hw, hh, high: kind === 'wall' || kind === 'box' || kind === 'net', kind });

/** Border walls around [-w,w]x[-h,h], with optional gaps on the left/right sides (|y| < gap). */
export function border(w: number, h: number, sideGap = 0): Wall[] {
  const t = 0.5;
  const out = [W(0, -h - t, w + 2 * t, t), W(0, h + t, w + 2 * t, t)];
  if (sideGap <= 0) {
    out.push(W(-w - t, 0, t, h + 2 * t), W(w + t, 0, t, h + 2 * t));
  } else {
    const seg = (h - sideGap) / 2;
    const cy = sideGap + seg;
    for (const sx of [-1, 1]) {
      out.push(W(sx * (w + t), -cy - t, t, seg + t), W(sx * (w + t), cy + t, t, seg + t));
    }
  }
  return out;
}

export function spawnsRing(w: number, h: number): Spawn[] {
  const s: Spawn[] = [];
  const pts: [number, number][] = [
    [-0.8, -0.75], [0.8, 0.75], [0.8, -0.75], [-0.8, 0.75],
    [0, -0.8], [0, 0.8], [-0.85, 0], [0.85, 0],
  ];
  for (const [px, py] of pts) s.push({ x: px * w, y: py * h, team: -1 });
  return s;
}

