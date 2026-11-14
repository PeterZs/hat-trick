// More arenas. Coordinates: x to the right, y toward the camera; each level
// spans [-w, w] x [-h, h]. Layouts are checked by tests/levels.test.ts
// (spawns and breakables clear of walls and hazards).

import { border, R, spawnsRing, W, type Level, type Spawn, type Wall } from './levelkit';
import type { PropKind } from './types';

const P = (kind: PropKind, x: number, y: number) => ({ kind, x, y });
const S = (x: number, y: number, team = -1): Spawn => ({ x, y, team });
const mirror = (pts: [number, number][]): Spawn[] => pts.flatMap(([x, y]) => [S(x, y), S(-x, -y)]);

// ---------------------------------------------------------------------------
// Layout only

const shop: Level = {
  id: 'shop', name: 'Hat Shop', w: 15, h: 10, floor: ['#e8c9a0', '#dfbf95'],
  walls: [
    ...border(15, 10),
    // Tall shelves make long aisles, with one cross aisle through the middle.
    ...[-9, -4.5, 0, 4.5, 9].flatMap((x) => [W(x, -5.4, 0.5, 3.1), W(x, 5.4, 0.5, 3.1)]),
  ],
  spawns: mirror([[-12, -6], [12, -6], [-2.25, -6], [-6.75, 6]]),
  goals: [], bases: [{ team: 0, x: -12.2, y: 0 }, { team: 1, x: 12.2, y: 0 }],
  props: [P('crate', -6.75, 0), P('crate', 6.75, 0), P('bush', -13.4, -8.6), P('bush', 13.4, 8.6), P('crate', -2.25, 8.7), P('crate', 2.25, -8.7)],
};

const daycare: Level = {
  id: 'daycare', name: 'Ball Pit Daycare', w: 14, h: 10, floor: ['#ffd6e8', '#ffcade'],
  walls: [
    ...border(14, 10),
    W(-3.5, -6, 2, 0.3, 'low'), W(3.5, 6, 2, 0.3, 'low'),
    W(-10, 0, 0.3, 2, 'low'), W(10, 0, 0.3, 2, 'low'),
  ],
  spawns: mirror([[-12, -7.5], [12, -7.5], [0, -8.5], [-6, 0]]),
  goals: [], bases: [{ team: 0, x: -12.2, y: 0 }, { team: 1, x: 12.2, y: 0 }],
  props: [
    // "Ball pits": clusters of bushes you can hide behind (hats pass through).
    ...[[-7, -4], [7, 4], [0, 0], [-7, 5], [7, -5]].flatMap(([x, y]) => [P('bush', x, y), P('bush', x + 1.1, y + 0.3), P('bush', x - 0.4, y + 1.1)]),
    P('crate', -2, -3), P('crate', 2, 3), P('crate', 10.5, -5.6), P('crate', -10.5, 5.6),
  ],
};

const bowling: Level = {
  id: 'bowling', name: 'Bowling Alley', w: 16, h: 10, floor: ['#e9d3a5', '#e2ca97'],
  walls: [
    ...border(16, 10),
    // Gutters: low walls between lanes (throw across, can't walk across).
    W(0, -5, 11, 0.25, 'low'), W(0, 0, 11, 0.25, 'low'), W(0, 5, 11, 0.25, 'low'),
  ],
  spawns: mirror([[-14, -7.5], [14, -7.5], [-14, -2.5], [14, -2.5]]),
  goals: [], bases: [{ team: 0, x: -14, y: 0 }, { team: 1, x: 14, y: 0 }],
  // Explosive pins at both ends of every lane.
  props: [-7.5, -2.5, 2.5, 7.5].flatMap((y) => [P('barrel', 9.5, y), P('barrel', -9.5, y)]),
};

const crateLine = (x0: number, y0: number, x1: number, y1: number, gapAt = -1) => {
  const out: ReturnType<typeof P>[] = [];
  const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.1);
  for (let i = 0; i <= n; i++) {
    if (i === gapAt) continue;
    out.push(P(i % 4 === 2 ? 'rock' : 'crate', x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
  }
  return out;
};

const rooftops: Level = {
  id: 'rooftops', name: 'Rooftops', w: 15, h: 10, floor: ['#9aa3ab', '#8f989f'],
  walls: [...border(15, 10), W(-10, -5, 0.8, 0.8, 'box'), W(10, 5, 0.8, 0.8, 'box'), W(-10, 5, 0.6, 0.6, 'box'), W(10, -5, 0.6, 0.6, 'box')],
  spawns: mirror([[-12.5, -7.5], [12.5, -7.5], [-12.5, 0], [0, -6.5]]),
  goals: [], bases: [{ team: 0, x: -12.5, y: 2.5 }, { team: 1, x: 12.5, y: -2.5 }],
  // Rows of crates (and a few rocks) to smash your way through.
  props: [...crateLine(-5, -9, -5, 9, 8), ...crateLine(5, -9, 5, 9, 8), ...crateLine(-4, 0, 4, 0, 4)],
};

const lockers: Level = {
  id: 'lockers', name: 'Locker Room', w: 16, h: 10, floor: ['#cfe3ef', '#c3d9e7'],
  walls: [
    ...border(16, 10),
    // Central shower room with doors top and bottom.
    W(-3, 0, 0.3, 3), W(3, 0, 0.3, 3),
    W(-2.1, -3, 1.2, 0.3), W(2.1, -3, 1.2, 0.3), W(-2.1, 3, 1.2, 0.3), W(2.1, 3, 1.2, 0.3),
    // Locker rows and benches.
    W(-9, -6, 0.4, 2.5), W(-9, 6, 0.4, 2.5), W(9, -6, 0.4, 2.5), W(9, 6, 0.4, 2.5),
    W(-6, 0, 0.4, 2), W(6, 0, 0.4, 2),
    W(-12.5, 0, 1.5, 0.3, 'low'), W(12.5, 0, 1.5, 0.3, 'low'), W(0, -7.5, 2, 0.3, 'low'), W(0, 7.5, 2, 0.3, 'low'),
  ],
  spawns: mirror([[-14, -8], [14, -8], [-14, 3.5], [-4.5, -8.6]]),
  goals: [], bases: [{ team: 0, x: -14, y: -3 }, { team: 1, x: 14, y: 3 }],
  props: [P('bush', 0, 0), P('crate', -12, -6), P('crate', 12, 6)],
};

const stadium: Level = {
  id: 'stadium', name: 'Stadium', w: 18, h: 11, floor: ['#7cc96b', '#72bf61'],
  walls: [
    ...border(18, 11),
    W(0, 0, 6, 2, 'low'), // infield: throw over it, run around it
    W(-8, -8.6, 4, 0.3, 'low'), W(8, -8.6, 4, 0.3, 'low'), W(-8, 8.6, 4, 0.3, 'low'), W(8, 8.6, 4, 0.3, 'low'),
    W(-15.5, 0, 0.6, 0.6, 'box'), W(15.5, 0, 0.6, 0.6, 'box'),
  ],
  spawns: mirror([[-14, -5], [14, -5], [0, -6], [-9, 4.5]]),
  goals: [], bases: [{ team: 0, x: -13, y: 0 }, { team: 1, x: 13, y: 0 }],
  props: [P('crate', -10, 0), P('crate', 10, 0), P('barrel', 0, -9.8), P('barrel', 0, 9.8)],
};

// ---------------------------------------------------------------------------
// One new feature each

const iceHalf = 2.5, iceW = 16, iceH = 9, iceNet = 2;
const icerink: Level = {
  id: 'icerink', name: 'Ice Rink', w: iceW, h: iceH, floor: ['#eef7fc', '#e2f0f9'],
  ice: [R(-iceW - iceNet, -iceH, iceW + iceNet, iceH)],
  walls: [
    ...border(iceW, iceH, iceHalf),
    ...[-1, 1].flatMap((sx) => [
      W(sx * (iceW + iceNet + 0.25), 0, 0.25, iceHalf + 0.5, 'net'),
      W(sx * (iceW + iceNet / 2), -iceHalf - 0.25, iceNet / 2, 0.25, 'net'),
      W(sx * (iceW + iceNet / 2), iceHalf + 0.25, iceNet / 2, 0.25, 'net'),
    ]),
    W(0, -5.5, 0.3, 1.5, 'low'), W(0, 5.5, 0.3, 1.5, 'low'),
  ],
  spawns: [S(-6, 0, 0), S(-10, -4, 0), S(-10, 4, 0), S(-13, 0, 0), S(6, 0, 1), S(10, 4, 1), S(10, -4, 1), S(13, 0, 1)],
  goals: [
    { team: 0, x0: -iceW - iceNet, y0: -iceHalf, x1: -iceW - 0.2, y1: iceHalf },
    { team: 1, x0: iceW + 0.2, y0: -iceHalf, x1: iceW + iceNet, y1: iceHalf },
  ],
  bases: [{ team: 0, x: -13, y: 0 }, { team: 1, x: 13, y: 0 }],
  props: [],
};

const pitarena: Level = {
  id: 'pitarena', name: 'Pit Arena', w: 15, h: 10, floor: ['#c9b38a', '#bfa97f'],
  walls: [...border(15, 10), W(0, -6.5, 1.2, 0.3, 'low'), W(0, 6.5, 1.2, 0.3, 'low')],
  pits: [R(-2, -2, 2, 2), R(-9, -7, -6, -4), R(6, 4, 9, 7), R(-9, 4, -6, 7), R(6, -7, 9, -4), R(-13, -1, -11, 1), R(11, -1, 13, 1)],
  spawns: mirror([[-12.5, -7.5], [12.5, -7.5], [0, -8.7], [-5, 0]]),
  goals: [], bases: [{ team: 0, x: -12, y: -4 }, { team: 1, x: 12, y: 4 }],
  props: [P('barrel', -3.5, -4), P('barrel', 3.5, 4), P('rock', -10.5, 8.5), P('rock', 10.5, -8.5)],
};

const factory: Level = {
  id: 'factory', name: 'Conveyor Factory', w: 16, h: 10, floor: ['#b9bec4', '#aeb3ba'],
  conveyors: [
    { ...R(-12, -6, 12, -4), vx: 5, vy: 0 },
    { ...R(-12, 4, 12, 6), vx: -5, vy: 0 },
    { ...R(-1, -3, 1, 3), vx: 0, vy: 4 },
  ],
  walls: [...border(16, 10), W(-8, 0, 1.2, 1.2, 'box'), W(8, 0, 1.2, 1.2, 'box'), W(-14, -8.6, 1, 0.6, 'box'), W(14, 8.6, 1, 0.6, 'box')],
  spawns: mirror([[-14, -2.5], [14, -2.5], [-5, 2], [-4, -8]]),
  goals: [], bases: [{ team: 0, x: -13, y: 2 }, { team: 1, x: 13, y: -2 }],
  props: [P('barrel', -12, -8.5), P('barrel', 12, 8.5), P('crate', -4, -1.5), P('crate', 4, 1.5)],
};

const pinball: Level = {
  id: 'pinball', name: 'Pinball', w: 12, h: 14, floor: ['#3a2f5b', '#33294f'],
  bumpers: [
    { x: -4, y: -6, r: 1 }, { x: 4, y: -6, r: 1 }, { x: 0, y: -2, r: 1.2 },
    { x: -5, y: 3, r: 0.9 }, { x: 5, y: 3, r: 0.9 }, { x: 0, y: 7.5, r: 1 },
  ],
  walls: [...border(12, 14), W(-6.5, 10.5, 2.5, 0.3, 'low'), W(6.5, 10.5, 2.5, 0.3, 'low'), W(-9.5, -10, 0.6, 0.6, 'box'), W(9.5, -10, 0.6, 0.6, 'box')],
  spawns: mirror([[-9, -12], [9, -12], [-9, 0], [0, -11.5]]),
  goals: [], bases: [{ team: 0, x: -9, y: -6 }, { team: 1, x: 9, y: 6 }],
  props: [],
};

const temple: Level = {
  id: 'temple', name: 'Teleporter Temple', w: 16, h: 10, floor: ['#d9c79a', '#cfbd8f'],
  walls: [
    ...border(16, 10),
    W(0, 0, 0.5, 10.5), // the two halves only connect through the portals
    W(-11, 0, 0.7, 0.7, 'box'), W(11, 0, 0.7, 0.7, 'box'),
    W(-5, -4, 0.6, 0.6, 'box'), W(5, 4, 0.6, 0.6, 'box'), W(-5, 4, 0.6, 0.6, 'box'), W(5, -4, 0.6, 0.6, 'box'),
  ],
  portals: [
    { x: -8, y: -7, to: 1 }, { x: 8, y: 7, to: 0 },
    { x: -8, y: 7, to: 3 }, { x: 8, y: -7, to: 2 },
  ],
  spawns: mirror([[-13, -7], [13, -7], [-3, 0], [-13, 3]]),
  goals: [], bases: [{ team: 0, x: -13, y: 0 }, { team: 1, x: 13, y: 0 }],
  props: [P('bush', -2.5, -7.5), P('bush', 2.5, 7.5)],
};

const cliffs: Level = {
  id: 'cliffs', name: 'Windy Cliffs', w: 15, h: 10, floor: ['#9fd47e', '#95ca74'], outside: '#7fb8e0', open: true,
  walls: [
    W(-15.5, 0, 0.5, 10.5), W(15.5, 0, 0.5, 10.5),
    W(-8, -9.3, 3, 0.3, 'low'), W(8, 9.3, 3, 0.3, 'low'),
    W(-4, 0, 0.7, 0.7, 'box'), W(4, 0, 0.7, 0.7, 'box'),
  ],
  // Gusts: the left half blows toward the near cliff, the right half away.
  wind: [{ ...R(-15, -10, 0, 10), fx: 0, fy: 7 }, { ...R(0, -10, 15, 10), fx: 0, fy: -7 }],
  spawns: mirror([[-12, -5], [12, -5], [0, -5.5], [-8, 0]]),
  goals: [], bases: [{ team: 0, x: -12, y: 0 }, { team: 1, x: 12, y: 0 }],
  props: [P('rock', -10, 3), P('rock', 10, -3), P('bush', 0, 0)],
};

// ---------------------------------------------------------------------------
// Bigger features

const lavarising: Level = {
  id: 'lavarising', name: 'Lava Rising', w: 14, h: 10, floor: ['#5a5550', '#514c47'],
  tiles: { cell: 2, collapse: true, lava: true },
  walls: [...border(14, 10), W(-5, -3, 0.6, 0.6, 'box'), W(5, 3, 0.6, 0.6, 'box'), W(0, 0, 1.6, 0.3, 'low')],
  spawns: mirror([[-8, -5], [8, -5], [0, -6], [-10, 1]]),
  goals: [], bases: [{ team: 0, x: -9, y: 0 }, { team: 1, x: 9, y: 0 }],
  props: [P('rock', -2, 4), P('rock', 2, -4)],
};

const nightmarket: Level = {
  id: 'nightmarket', name: 'Night Market', w: 15, h: 10, floor: ['#c9a27a', '#bf9870'], night: true,
  walls: [
    ...border(15, 10),
    W(-9, -5, 1.5, 1, 'box'), W(-9, 5, 1.5, 1, 'box'), W(9, -5, 1.5, 1, 'box'), W(9, 5, 1.5, 1, 'box'),
    W(0, -5, 1.5, 1, 'box'), W(0, 5, 1.5, 1, 'box'),
    W(-4.5, 0, 1.5, 0.3, 'low'), W(4.5, 0, 1.5, 0.3, 'low'),
  ],
  spawns: spawnsRing(15, 10),
  goals: [], bases: [{ team: 0, x: -12, y: 2.5 }, { team: 1, x: 12, y: -2.5 }],
  props: [P('crate', -4.5, -2.5), P('crate', 4.5, 2.5), P('barrel', -13.5, 4.5), P('barrel', 13.5, -4.5), P('bush', 0, 0)],
};

/** A room with high corners, a window (low wall) or door in the middle of each side. */
function room(cx: number, cy: number, hw: number, hh: number, doors: ('n' | 's' | 'e' | 'w')[]): Wall[] {
  const t = 0.25, out: Wall[] = [];
  const side = (horizontal: boolean, at: number, from: number, to: number, door: boolean) => {
    const L = to - from, a = from + L * 0.3, b = from + L * 0.7;
    const seg = (s0: number, s1: number, kind: Wall['kind']) =>
      out.push(horizontal ? W((s0 + s1) / 2, at, (s1 - s0) / 2, t, kind) : W(at, (s0 + s1) / 2, t, (s1 - s0) / 2, kind));
    seg(from, a, 'wall');
    if (!door) seg(a, b, 'low'); // window: hats fly through
    seg(b, to, 'wall');
  };
  side(true, cy - hh, cx - hw, cx + hw, doors.includes('n'));
  side(true, cy + hh, cx - hw, cx + hw, doors.includes('s'));
  side(false, cx - hw, cy - hh, cy + hh, doors.includes('w'));
  side(false, cx + hw, cy - hh, cy + hh, doors.includes('e'));
  return out;
}

const downtown: Level = {
  id: 'downtown', name: 'Downtown', w: 17, h: 11, floor: ['#8d939a', '#858b92'],
  walls: [
    ...border(17, 11),
    ...room(-10, -5.5, 3.2, 2.6, ['s', 'w']), ...room(0, -5.5, 3.2, 2.6, ['s']), ...room(10, -5.5, 3.2, 2.6, ['s', 'e']),
    ...room(-10, 5.5, 3.2, 2.6, ['n', 'w']), ...room(0, 5.5, 3.2, 2.6, ['n']), ...room(10, 5.5, 3.2, 2.6, ['n', 'e']),
  ],
  spawns: mirror([[-15, -9.5], [15, -9.5], [-5, 0], [-15, 0]]),
  goals: [], bases: [{ team: 0, x: -15.2, y: -4 }, { team: 1, x: 15.2, y: 4 }],
  props: [
    P('crate', -10, -5.5), P('crate', 0, -5.5), P('crate', 10, -5.5), P('crate', -10, 5.5), P('crate', 0, 5.5), P('crate', 10, 5.5),
    P('barrel', -5, -9.6), P('barrel', 5, 9.6), P('bush', 10.3, 0), P('bush', -10.3, 0),
  ],
};

// Six pens split by chasms too wide to dash across: hat throwing only.
const penX = [-10.5, 0, 10.5], penY = [-5.5, 5.5], penHW = 2.5, penHH = 2.5;
const canyon: Level = {
  id: 'canyon', name: 'Sniper Canyon', w: 16, h: 10, floor: ['#c2a27a', '#b8986f'], outside: '#3b2b22', open: true,
  modes: ['ffa', 'teams', 'hazard', 'lava'],
  walls: penX.flatMap((x) => penY.flatMap((y) => [
    W(x, y - penHH, penHW, 0.2, 'low'), W(x, y + penHH, penHW, 0.2, 'low'),
    W(x - penHW, y, 0.2, penHH, 'low'), W(x + penHW, y, 0.2, penHH, 'low'),
  ])),
  pits: [
    R(-16, -10, -13.2, 10), R(13.2, -10, 16, 10),          // outer edges
    R(-7.8, -10, -2.7, 10), R(2.7, -10, 7.8, 10),          // between columns
    R(-16, -2.8, 16, 2.8),                                  // between rows
    R(-16, -10, 16, -8.2), R(-16, 8.2, 16, 10),            // top and bottom
  ],
  spawns: [S(-10.5, -5.5), S(10.5, 5.5), S(10.5, -5.5), S(-10.5, 5.5), S(0, -5.5), S(0, 5.5), S(-11.3, -4.7), S(11.3, 4.7)],
  goals: [], bases: [{ team: 0, x: -10.5, y: 5.5 }, { team: 1, x: 10.5, y: -5.5 }],
  props: [],
};

// Bumper Balls: a round platform over the water whose edge crumbles inward.
const platform: Level = {
  id: 'platform', name: 'Crumbling Platform', w: 12, h: 12, floor: ['#ffd6a5', '#ffcb8e'], outside: '#5aa0d8', open: true,
  tiles: { cell: 1.5, circle: 11, collapse: true },
  walls: [],
  spawns: Array.from({ length: 8 }, (_, i) => S(Math.round(Math.cos((i * Math.PI) / 4) * 600) / 100, Math.round(Math.sin((i * Math.PI) / 4) * 600) / 100)),
  goals: [], bases: [{ team: 0, x: -6, y: 0 }, { team: 1, x: 6, y: 0 }],
  props: [],
};

// Golf course with ponds.
const links: Level = {
  id: 'links', name: 'Links', w: 18, h: 11, floor: ['#8fd16f', '#86c866'], short: 'golf', water: true,
  walls: [...border(18, 11), W(-6, -4, 0.4, 2.2), W(6, 4, 0.4, 2.2), W(-12, 6, 0.6, 0.6, 'box'), W(12, -6, 0.6, 0.6, 'box')],
  pits: [R(-3, -2, 3, 2), R(6, -10, 10, -6.5), R(-10, 2.5, -7, 6)],
  holes: [
    { tees: [[-15, -8], [-15, -6]], cup: [12.5, 6.5] },
    { tees: [[15, -3], [15, -1]], cup: [-14, 8] },
    { tees: [[-1, 8.5], [1, 8.5]], cup: [0, -8] },
  ],
  spawns: [S(-15, -3, 0), S(-13, -9, 0), S(-15, 3, 0), S(-11, 0, 0), S(15, 3, 1), S(13, 9, 1), S(15, -6, 1), S(11, 0, 1)],
  goals: [], bases: [{ team: 0, x: -14, y: 0 }, { team: 1, x: 14, y: 0 }],
  props: [P('bush', -13, -1), P('bush', 13, 1), P('tree', 0, 6), P('tree', 3, -6)],
};

export const MORE_LEVELS: Record<string, Level> = {
  shop, daycare, bowling, rooftops, lockers, stadium,
  icerink, pitarena, factory, pinball, temple, cliffs,
  lavarising, nightmarket, downtown, canyon, platform, links,
};
