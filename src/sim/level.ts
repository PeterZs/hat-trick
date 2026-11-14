import type { PropKind } from './types';

// Static level data. Levels are immutable and referenced by id from the game
// state, so they are never snapshotted.

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
}

const W = (x: number, y: number, hw: number, hh: number, kind: Wall['kind'] = 'wall'): Wall =>
  ({ x, y, hw, hh, high: kind === 'wall' || kind === 'box' || kind === 'net', kind });

/** Border walls around [-w,w]x[-h,h], with optional gaps on the left/right sides (|y| < gap). */
function border(w: number, h: number, sideGap = 0): Wall[] {
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

function spawnsRing(w: number, h: number): Spawn[] {
  const s: Spawn[] = [];
  const pts: [number, number][] = [
    [-0.8, -0.75], [0.8, 0.75], [0.8, -0.75], [-0.8, 0.75],
    [0, -0.8], [0, 0.8], [-0.85, 0], [0.85, 0],
  ];
  for (const [px, py] of pts) s.push({ x: px * w, y: py * h, team: -1 });
  return s;
}

const courtyard: Level = {
  id: 'courtyard',
  name: 'Courtyard',
  w: 15, h: 10,
  floor: ['#a7d58a', '#9dcc80'],
  walls: [
    ...border(15, 10),
    W(0, 0, 1.4, 1.4, 'box'),
    W(-6, -4, 2.5, 0.35, 'low'),
    W(6, 4, 2.5, 0.35, 'low'),
    W(-9.5, 3, 0.45, 2.6),
    W(9.5, -3, 0.45, 2.6),
    W(-3.5, 6, 0.8, 0.8, 'box'),
    W(3.5, -6, 0.8, 0.8, 'box'),
    W(-12, -7, 0.8, 0.8, 'box'),
    W(12, 7, 0.8, 0.8, 'box'),
    W(0, -7.5, 0.35, 1.5, 'low'),
    W(0, 7.5, 0.35, 1.5, 'low'),
  ],
  spawns: spawnsRing(15, 10),
  goals: [],
  bases: [{ team: 0, x: -12.5, y: 0 }, { team: 1, x: 12.5, y: 0 }],
  props: [
    { kind: 'tree', x: -13, y: -2.5 },
    { kind: 'tree', x: 13, y: 2.5 },
    { kind: 'crate', x: -6, y: -1.6 },
    { kind: 'crate', x: 6, y: 1.6 },
    { kind: 'barrel', x: -2.6, y: -2.6 },
    { kind: 'barrel', x: 2.6, y: 2.6 },
    { kind: 'bush', x: -11.5, y: 5.5 },
    { kind: 'bush', x: 11.5, y: -5.5 },
    { kind: 'rock', x: -6.5, y: 8.3 },
    { kind: 'rock', x: 6.5, y: -8.3 },
  ],
};

const pitchW = 16, pitchH = 10, goalHalf = 3, netDepth = 2.4;
const pitch: Level = {
  id: 'pitch',
  name: 'Pitch',
  w: pitchW, h: pitchH,
  floor: ['#7cc96b', '#72bf61'],
  walls: [
    ...border(pitchW, pitchH, goalHalf),
    // Nets behind each goal mouth.
    ...[-1, 1].flatMap((sx) => [
      W(sx * (pitchW + netDepth + 0.25), 0, 0.25, goalHalf + 0.5, 'net'),
      W(sx * (pitchW + netDepth / 2), -goalHalf - 0.25, netDepth / 2, 0.25, 'net'),
      W(sx * (pitchW + netDepth / 2), goalHalf + 0.25, netDepth / 2, 0.25, 'net'),
    ]),
    W(-7, -6, 0.7, 0.7, 'box'),
    W(7, 6, 0.7, 0.7, 'box'),
    W(-7, 6, 0.7, 0.7, 'box'),
    W(7, -6, 0.7, 0.7, 'box'),
  ],
  spawns: [
    { x: -6, y: 0, team: 0 }, { x: -10, y: -4, team: 0 }, { x: -10, y: 4, team: 0 }, { x: -13, y: 0, team: 0 },
    { x: 6, y: 0, team: 1 }, { x: 10, y: 4, team: 1 }, { x: 10, y: -4, team: 1 }, { x: 13, y: 0, team: 1 },
  ],
  goals: [
    { team: 0, x0: -pitchW - netDepth, y0: -goalHalf, x1: -pitchW - 0.2, y1: goalHalf },
    { team: 1, x0: pitchW + 0.2, y0: -goalHalf, x1: pitchW + netDepth, y1: goalHalf },
  ],
  bases: [{ team: 0, x: -13, y: 0 }, { team: 1, x: 13, y: 0 }],
  props: [
  ],
};

const fortress: Level = {
  id: 'fortress',
  name: 'Fortress',
  w: 18, h: 11,
  floor: ['#d9c79a', '#cfbd8f'],
  walls: [
    ...border(18, 11),
    // Left fort
    W(-12, -4.5, 0.4, 2.0), W(-12, 4.5, 0.4, 2.0),
    W(-14.5, -6.5, 2.1, 0.4, 'low'), W(-14.5, 6.5, 2.1, 0.4, 'low'),
    // Right fort
    W(12, -4.5, 0.4, 2.0), W(12, 4.5, 0.4, 2.0),
    W(14.5, -6.5, 2.1, 0.4, 'low'), W(14.5, 6.5, 2.1, 0.4, 'low'),
    // Middle
    W(0, 0, 0.6, 3.0),
    W(-5, -6, 1.8, 0.4, 'low'), W(5, 6, 1.8, 0.4, 'low'),
    W(-5, 5, 0.8, 0.8, 'box'), W(5, -5, 0.8, 0.8, 'box'),
    W(0, -8.5, 0.8, 0.8, 'box'), W(0, 8.5, 0.8, 0.8, 'box'),
  ],
  spawns: [
    { x: -15.5, y: -2.5, team: 0 }, { x: -15.5, y: 2.5, team: 0 }, { x: -13.5, y: -9, team: 0 }, { x: -13.5, y: 9, team: 0 },
    { x: 15.5, y: 2.5, team: 1 }, { x: 15.5, y: -2.5, team: 1 }, { x: 13.5, y: 9, team: 1 }, { x: 13.5, y: -9, team: 1 },
  ],
  goals: [],
  bases: [{ team: 0, x: -15.5, y: 0 }, { team: 1, x: 15.5, y: 0 }],
  props: [
    { kind: 'rock', x: -8, y: -2 },
    { kind: 'rock', x: 8, y: 2 },
    { kind: 'bush', x: -14, y: -3.8 },
    { kind: 'bush', x: 14, y: 3.8 },
    { kind: 'barrel', x: 0, y: -5 },
    { kind: 'barrel', x: 0, y: 5 },
    { kind: 'crate', x: -4, y: 0 },
    { kind: 'crate', x: 4, y: 0 },
    { kind: 'tree', x: -9, y: 8.5 },
    { kind: 'tree', x: 9, y: -8.5 },
  ],
};

const clearing: Level = {
  id: 'clearing',
  name: 'Clearing',
  w: 15, h: 10,
  floor: ['#9fd47e', '#95ca74'],
  walls: [
    ...border(15, 10),
    W(-8, -2, 0.7, 0.7, 'box'),
    W(8, 2, 0.7, 0.7, 'box'),
    W(0, -5.5, 2.2, 0.35, 'low'),
    W(0, 5.5, 2.2, 0.35, 'low'),
  ],
  spawns: spawnsRing(15, 10),
  goals: [],
  bases: [{ team: 0, x: -12.5, y: 0 }, { team: 1, x: 12.5, y: 0 }],
  props: [
    { kind: 'rock', x: -11, y: 4 },
    { kind: 'rock', x: 11, y: -4 },
    { kind: 'barrel', x: -4, y: -1 },
    { kind: 'barrel', x: 4, y: 1 },
    { kind: 'bush', x: -4, y: -7.5 },
    { kind: 'bush', x: 4, y: 7.5 },
  ],
};

// Open loop around a central island: room to drive.
const raceway: Level = {
  id: 'raceway',
  name: 'Raceway',
  w: 18, h: 11,
  floor: ['#b9c0c8', '#aeb5bd'],
  walls: [
    ...border(18, 11),
    W(0, 0, 7, 1.6),                 // central island
    W(-7.6, 0, 0.6, 0.6, 'box'), W(7.6, 0, 0.6, 0.6, 'box'),
    W(-12, -6.5, 0.35, 1.6, 'low'), W(12, 6.5, 0.35, 1.6, 'low'),
    W(-4, 7.2, 1.6, 0.35, 'low'), W(4, -7.2, 1.6, 0.35, 'low'),
    W(-15.5, 8.5, 0.8, 0.8, 'box'), W(15.5, -8.5, 0.8, 0.8, 'box'),
  ],
  spawns: [
    { x: -14, y: -5, team: -1 }, { x: 14, y: 5, team: -1 }, { x: 14, y: -5, team: -1 }, { x: -14, y: 5, team: -1 },
    { x: 0, y: -8, team: -1 }, { x: 0, y: 8, team: -1 }, { x: -9, y: -4.5, team: -1 }, { x: 9, y: 4.5, team: -1 },
  ],
  goals: [],
  bases: [{ team: 0, x: -14, y: 0 }, { team: 1, x: 14, y: 0 }],
  props: [
    { kind: 'crate', x: -10, y: -8 },
    { kind: 'crate', x: 10, y: 8 },
    { kind: 'crate', x: -3, y: -9.5 },
    { kind: 'crate', x: 3, y: 9.5 },
    { kind: 'barrel', x: -16, y: 0 },
    { kind: 'barrel', x: 16, y: 0 },
    { kind: 'barrel', x: 0, y: -4.5 },
    { kind: 'barrel', x: 0, y: 4.5 },
    { kind: 'bush', x: -6, y: -4.3 },
    { kind: 'bush', x: 6, y: 4.3 },
  ],
};

export const LEVELS: Record<string, Level> = { courtyard, pitch, fortress, clearing, raceway };
export const LEVEL_IDS = Object.keys(LEVELS);

export function getLevel(id: string): Level {
  return LEVELS[id] ?? courtyard;
}

/** Outer extents including nets (for camera framing / rendering). */
export function levelBounds(l: Level): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = -l.w, y0 = -l.h, x1 = l.w, y1 = l.h;
  for (const w of l.walls) {
    x0 = Math.min(x0, w.x - w.hw); x1 = Math.max(x1, w.x + w.hw);
    y0 = Math.min(y0, w.y - w.hh); y1 = Math.max(y1, w.y + w.hh);
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// Navigation grid for bots (static per level, cached).

export interface NavGrid { cell: number; nx: number; ny: number; x0: number; y0: number; blocked: Uint8Array }

const navCache = new Map<string, NavGrid>();

export function navGrid(l: Level, clearance = 0.6): NavGrid {
  const key = l.id + ':' + clearance;
  let g = navCache.get(key);
  if (g) return g;
  const b = levelBounds(l);
  const cell = 0.5;
  const nx = Math.ceil((b.x1 - b.x0) / cell), ny = Math.ceil((b.y1 - b.y0) / cell);
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = b.x0 + (i + 0.5) * cell, cy = b.y0 + (j + 0.5) * cell;
      for (const w of l.walls) {
        if (Math.abs(cx - w.x) < w.hw + clearance && Math.abs(cy - w.y) < w.hh + clearance) {
          blocked[j * nx + i] = 1; break;
        }
      }
    }
  }
  g = { cell, nx, ny, x0: b.x0, y0: b.y0, blocked };
  navCache.set(key, g);
  return g;
}
