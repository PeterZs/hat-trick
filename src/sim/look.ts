// A character's look: a procedural ball pattern + hat, all as plain data.
// Purely cosmetic (the sim never reads it), but it lives in the game state so
// every peer sees everyone's look and late joiners get it in the snapshot.

import { BALLS, HATS } from './const';

export interface BallLook {
  pat: number;        // index into BALL_PATTERNS
  c: string[];        // 4 colors '#rrggbb'
  n: number;          // pattern detail (stripe count, dot size...) 1..8
}

export interface HatLook {
  shape: number;      // index into HAT_SHAPES
  c: string[];        // 4 colors
  h: number;          // height scale 0.5..1.8
  w: number;          // width scale 0.7..1.4
  deco: number;       // index into HAT_DECOS
  dc: string;         // decoration color
}

export interface Look {
  ball: BallLook;
  hat: HatLook;
  eyes: number;       // index into EYES
}

/** The 16 sports-ball patterns (recolorable), then generic ones. */
export const BALL_PATTERNS = [...BALLS, 'Solid', 'Stripes', 'Segments', 'Checker', 'Polka dots', 'Two-tone', 'Spiral', 'Speckles'];
export const HAT_SHAPES = HATS;
export const HAT_DECOS = ['None', 'Pompom', 'Feather', 'Antenna', 'Flower', 'Star', 'Propeller', 'Horns', 'Bunny ears', 'Candle'];
export const EYES = ['Normal', 'Big', 'Sleepy', 'Angry', 'Happy'];

/** Default colors of the preset balls/hats (one per sport, matching BALLS/HATS). */
const BALL_COLORS: string[][] = [
  ['#fafafa', '#222222', '#888888', '#444444'], ['#f07a2a', '#3a1d0e', '#ffffff', '#000000'],
  ['#cfe83c', '#f8f8f0', '#ffffff', '#000000'], ['#f7f4ea', '#d8322e', '#ffffff', '#000000'],
  ['#ff4b4b', '#ffffff', '#ffcf33', '#3d8bff'], ['#1a1a1a', '#ffffff', '#111111', '#000000'],
  ['#27357e', '#5b74d6', '#0a0a14', '#000000'], ['#ffffff', '#ffd23f', '#2f6fe0', '#000000'],
  ['#fbfbfb', '#d6d6d6', '#ffffff', '#000000'], ['#ff8c2a', '#ffffff', '#ffffff', '#000000'],
  ['#4d555e', '#7c858f', '#5d6670', '#000000'], ['#e63946', '#ffffff', '#1d4ed8', '#000000'],
  ['#ffd23f', '#1e5bd8', '#ffffff', '#000000'], ['#ff7ab8', '#e0559a', '#ffffff', '#000000'],
  ['#e8f040', '#d8322e', '#ffffff', '#000000'], ['#80d940', '#a6f06a', '#6cc42f', '#000000'],
];
const HAT_COLORS: string[][] = [
  ['#262626', '#d23b3b', '#222222', '#000000'], ['#6fa35b', '#5f8f4e', '#000000', '#000000'],
  ['#ffffff', '#2bb673', '#000000', '#000000'], ['#1f3c88', '#d23b3b', '#000000', '#000000'],
  ['#f1d27a', '#ff6f91', '#000000', '#000000'], ['#8b6a46', '#2b2b2b', '#7a5a3a', '#000000'],
  ['#3a2a20', '#3a2a20', '#000000', '#000000'], ['#e94e77', '#ffffff', '#000000', '#000000'],
  ['#8a8f6a', '#7a7f5c', '#000000', '#000000'], ['#e63946', '#ffd23f', '#1d4ed8', '#2bb673'],
  ['#9aa3ab', '#c8a24a', '#f3ead2', '#000000'], ['#e63946', '#e63946', '#000000', '#000000'],
  ['#1e5bd8', '#ffffff', '#000000', '#000000'], ['#c0392b', '#222222', '#000000', '#000000'],
  ['#b57837', '#5a3a1a', '#a0672f', '#000000'], ['#f4c430', '#e63946', '#1d4ed8', '#000000'],
];

/** The built-in character for ball index `i` (what `Player.ball` selects). */
export function presetLook(i: number): Look {
  const k = ((i % BALLS.length) + BALLS.length) % BALLS.length;
  return {
    ball: { pat: k, c: [...BALL_COLORS[k]], n: 3 },
    hat: { shape: k, c: [...HAT_COLORS[k]], h: 1, w: 1, deco: 0, dc: '#ffffff' },
    eyes: 0,
  };
}

const HEX = /^#[0-9a-f]{6}$/;
const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : d);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.round(Math.min(hi, Math.max(lo, x)) * 100) / 100;
};
const int = (v: unknown, n: number) => Math.min(n - 1, Math.max(0, Math.round(num(v, 0, n - 1, 0))));
const colors = (v: unknown, d: string[]) => d.map((dc, i) => color(Array.isArray(v) ? v[i] : undefined, dc));

/** Validate a look from the network or storage; null if it isn't one. */
export function sanitizeLook(v: unknown): Look | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Partial<{ ball: Partial<BallLook>; hat: Partial<HatLook>; eyes: number }>;
  if (!l.ball || !l.hat || typeof l.ball !== 'object' || typeof l.hat !== 'object') return null;
  const b = l.ball, h = l.hat;
  const pat = int(b.pat, BALL_PATTERNS.length), shape = int(h.shape, HAT_SHAPES.length);
  const base = presetLook(pat < BALLS.length ? pat : 0);
  return {
    ball: { pat, c: colors(b.c, base.ball.c), n: Math.round(num(b.n, 1, 8, 3)) },
    hat: {
      shape, c: colors(h.c, presetLook(shape).hat.c),
      h: num(h.h, 0.5, 1.8, 1), w: num(h.w, 0.7, 1.4, 1),
      deco: int(h.deco, HAT_DECOS.length), dc: color(h.dc, '#ffffff'),
    },
    eyes: int(l.eyes, EYES.length),
  };
}

/** A random look (UI only: uses Math.random, never call from the sim). */
export function randomLook(rand = Math.random): Look {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const hue = rand() * 360;
  const hsl = (h: number, s: number, l: number) => {
    const f = (n: number) => {
      const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const scheme = () => [hsl(hue, 0.75, 0.55), pick([hsl(hue + 180, 0.7, 0.5), '#ffffff', hsl(hue + 40, 0.8, 0.6)]),
    hsl(hue + 120 + rand() * 120, 0.75, 0.55), hsl(hue + 200, 0.6, 0.35)];
  return sanitizeLook({
    ball: { pat: Math.floor(rand() * BALL_PATTERNS.length), c: scheme(), n: 1 + Math.floor(rand() * 6) },
    hat: {
      shape: Math.floor(rand() * HAT_SHAPES.length), c: scheme(),
      h: 0.8 + rand() * 0.6, w: 0.85 + rand() * 0.3, deco: rand() < 0.5 ? 0 : 1 + Math.floor(rand() * (HAT_DECOS.length - 1)),
      dc: hsl(hue + 90, 0.8, 0.6),
    },
    eyes: Math.floor(rand() * EYES.length),
  })!;
}

/** Share codes: `HT1.` + base64url(JSON). */
export function lookToCode(l: Look): string {
  const json = JSON.stringify([l.ball.pat, l.ball.c, l.ball.n, l.hat.shape, l.hat.c, l.hat.h, l.hat.w, l.hat.deco, l.hat.dc, l.eyes]);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'HT1.' + b64;
}

export function lookFromCode(code: string): Look | null {
  const m = code.trim().match(/^HT1\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const a = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(a)) return null;
    const [pat, bc, n, shape, hc, h, w, deco, dc, eyes] = a;
    return sanitizeLook({ ball: { pat, c: bc, n }, hat: { shape, c: hc, h, w, deco, dc }, eyes });
  } catch { return null; }
}
