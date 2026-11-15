// Procedural low-poly, flat-colored models.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BallLook, HatLook } from '../sim/look';

export const PLAYER_COLORS = ['#ff5a5a', '#4a8dff', '#ffd23f', '#4fd17a', '#c77dff', '#ff9f43', '#2ed3d3', '#ff6fb5'];
export const TEAM_COLORS = ['#ff5a5a', '#4a8dff', '#ffd23f', '#4fd17a'];
export const TEAM_NAMES = ['Red', 'Blue', 'Yellow', 'Green'];

const matCache = new Map<string, THREE.Material>();
export function mat(color: string, opts: { transparent?: boolean; opacity?: number; emissive?: string } = {}): THREE.MeshLambertMaterial {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: !!opts.transparent, opacity: opts.opacity ?? 1 });
    if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
    matCache.set(key, m);
  }
  return m;
}

export const vertexColorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function mesh(geo: THREE.BufferGeometry, color: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

// ---------------------------------------------------------------------------
// Balls

/** Face color from the face normal `n`, the look's colors `c` and detail `k`. */
type Pattern = (n: THREE.Vector3, c: string[], k: number) => string;

const ICO_VERTS = (() => {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
    if (!out.some((o) => o.distanceTo(v) < 1e-3)) out.push(v);
  }
  return out;
})();

const seam = (n: THREE.Vector3) => Math.abs(n.y - 0.55 * Math.sin(2 * Math.atan2(n.z, n.x)));
const azimuth = (n: THREE.Vector3) => (Math.atan2(n.z, n.x) + Math.PI) / (2 * Math.PI); // 0..1
const BOWLING_HOLES = [new THREE.Vector3(0.25, 0.85, 0.45), new THREE.Vector3(-0.2, 0.88, 0.42), new THREE.Vector3(0.0, 0.7, 0.71)].map((v) => v.normalize());
/** Evenly spread points on the sphere (for polka dots). */
const fibCache = new Map<number, THREE.Vector3[]>();
const fib = (count: number) => {
  let pts = fibCache.get(count);
  if (!pts) {
    pts = Array.from({ length: count }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / count, rr = Math.sqrt(1 - y * y), a = i * 2.399963;
      return new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr);
    });
    fibCache.set(count, pts);
  }
  return pts;
};

// Same order as BALL_PATTERNS (src/sim/look.ts): the sports balls, then generic patterns.
const PATTERNS: Pattern[] = [
  // Soccer
  (n, c) => (ICO_VERTS.some((v) => v.dot(n) > 0.94) ? c[1] : c[0]),
  // Basketball
  (n, c) => (Math.abs(n.x) < 0.07 || Math.abs(n.y) < 0.07 || Math.abs(Math.abs(n.z) - 0.72) < 0.07 ? c[1] : c[0]),
  // Tennis
  (n, c) => (seam(n) < 0.1 ? c[1] : c[0]),
  // Baseball
  (n, c) => (Math.abs(seam(n) - 0.14) < 0.05 ? c[1] : c[0]),
  // Beach ball
  (n, c) => (Math.abs(n.y) > 0.88 ? c[1] : [c[0], c[1], c[2], c[1], c[3], c[1]][Math.floor(azimuth(n) * 6) % 6]),
  // Eight ball
  (n, c) => (n.z > 0.72 ? (n.z > 0.93 && Math.abs(n.x) < 0.12 ? c[2] : c[1]) : c[0]),
  // Bowling ball
  (n, c) => (BOWLING_HOLES.some((h) => h.dot(n) > 0.985) ? c[2] : Math.sin(n.x * 7 + n.y * 4 + n.z * 3) > 0.55 ? c[1] : c[0]),
  // Volleyball
  (n, c) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) return Math.abs(n.y) < 0.2 ? c[1] : c[0];
    if (ay >= az) return Math.abs(n.z) < 0.2 ? c[2] : c[0];
    return Math.abs(n.x) < 0.2 ? c[1] : c[2];
  },
  // Golf: dimples
  (n, c) => (dimple(n, 9) ? c[1] : c[0]),
  // Table tennis: thin seam
  (n, c) => (Math.abs(n.y) < 0.05 ? c[1] : c[0]),
  // Shot put: mottled
  (n, c) => (hash3(n, 13) > 0.6 ? c[1] : hash3(n, 29) > 0.5 ? c[2] : c[0]),
  // Handball: panels
  (n, c) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) return n.x > 0 ? c[0] : c[1];
    if (ay >= az) return n.y > 0 ? c[2] : c[0];
    return n.z > 0 ? c[1] : c[2];
  },
  // Water polo: grip grooves
  (n, c) => (Math.abs(n.x) < 0.07 || Math.abs(n.z) < 0.07 || Math.abs(n.y - 0.5) < 0.05 || Math.abs(n.y + 0.5) < 0.05 ? c[1] : c[0]),
  // Field hockey: dimples
  (n, c) => (dimple(n, 7) ? c[1] : c[0]),
  // Softball: seams
  (n, c) => (Math.abs(seam(n) - 0.14) < 0.05 ? c[1] : c[0]),
  // Lacrosse: slight sheen
  (n, c) => (n.y > 0.8 ? c[1] : hash3(n, 5) > 0.85 ? c[2] : c[0]),
  // Solid
  (_n, c) => c[0],
  // Stripes (horizontal bands)
  (n, c, k) => [c[0], c[1]][Math.floor(((n.y + 1) / 2) * (2 * k + 1)) % 2],
  // Segments (around, like a beach ball), capped poles
  (n, c, k) => (Math.abs(n.y) > 0.9 ? c[2] : [c[0], c[1]][Math.floor(azimuth(n) * 2 * (k + 1)) % 2]),
  // Checker
  (n, c, k) => [c[0], c[1]][(Math.floor(azimuth(n) * 2 * (k + 1)) + Math.floor(((n.y + 1) / 2) * (k + 2))) % 2],
  // Polka dots: more, smaller dots with more detail (about 40% covered; each
  // dot stays several faces wide on the low-poly sphere)
  (n, c, k) => {
    const dots = fib(3 + k * 2);
    let best = -2, bi = 0;
    dots.forEach((d, i) => { const v = d.dot(n); if (v > best) { best = v; bi = i; } });
    return best > 1 - 0.85 / dots.length ? (bi % 2 ? c[2] : c[1]) : c[0];
  },
  // Two-tone with a belt
  (n, c, k) => (Math.abs(n.y) < 0.03 * k ? c[2] : n.y > 0 ? c[0] : c[1]),
  // Spiral: four wide bands twisting from pole to pole (detail = how much they
  // twist, up to one and a half turns), with capped poles where bands would pinch
  (n, c, k) => {
    if (Math.abs(n.y) > 0.9) return c[2];
    const t = Math.acos(n.y) / Math.PI; // 0 top .. 1 bottom
    return [c[0], c[1]][Math.floor(4 * azimuth(n) + 4 * t * (0.15 + 0.17 * k) + 64) % 2];
  },
  // Speckles
  (n, c, k) => (hash3(n, 17) > 1 - k * 0.06 ? (hash3(n, 31) > 0.5 ? c[1] : c[2]) : c[0]),
];

function hash3(n: THREE.Vector3, k: number): number {
  const v = Math.sin(n.x * 127.1 * k + n.y * 311.7 + n.z * 74.7 * k) * 43758.5453;
  return v - Math.floor(v);
}

/** Speckled 'dimples' on roughly a quarter of the faces. */
function dimple(n: THREE.Vector3, k: number): boolean {
  return Math.sin(n.x * k * 3.1) * Math.sin(n.y * k * 2.7) * Math.sin(n.z * k * 3.3) > 0.25;
}

const ballGeoCache = new Map<string, THREE.BufferGeometry>();
/** A flat-shaded, per-face colored ball. Pass `cache = false` for throwaway
 *  previews (the caller disposes the geometry). */
export function ballGeometry(look: BallLook, r: number, cache = true): THREE.BufferGeometry {
  const key = JSON.stringify(look) + r.toFixed(2);
  const cached = cache && ballGeoCache.get(key);
  if (cached) return cached;
  const g = new THREE.IcosahedronGeometry(r, 3);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const col = new THREE.Color();
  const pat = PATTERNS[look.pat % PATTERNS.length];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = a.add(b).add(c).normalize();
    col.set(pat(n, look.c, look.n));
    for (let k = 0; k < 3; k++) { colors[(i + k) * 3] = col.r; colors[(i + k) * 3 + 1] = col.g; colors[(i + k) * 3 + 2] = col.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  if (cache) {
    if (ballGeoCache.size > 200) ballGeoCache.delete(ballGeoCache.keys().next().value!);
    ballGeoCache.set(key, g);
  }
  return g;
}

export function makeBall(look: BallLook, r: number, cache = true): THREE.Mesh {
  const m = new THREE.Mesh(ballGeometry(look, r, cache), vertexColorMat);
  m.castShadow = true;
  return m;
}

/** Eyes on the front (+x) of a ball of radius r. `lid` colors sleepy eyelids. */
export function makeEyes(r: number, style = 0, lid = '#ffffff'): THREE.Group {
  const g = new THREE.Group();
  const big = style === 1 ? 1.35 : 1;
  const white = new THREE.SphereGeometry(r * 0.2 * big, 10, 8);
  const pupil = new THREE.SphereGeometry(r * 0.11 * big, 8, 6);
  for (const s of [-1, 1]) {
    const a = s * 0.38;
    const at = new THREE.Vector3(Math.cos(a) * r * 0.93, r * 1.12, Math.sin(a) * r * 0.93);
    if (style === 4) { // happy: closed ∩ arcs
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r * 0.13, r * 0.04, 4, 8, Math.PI), mat('#222222'));
      arc.position.copy(at); arc.position.x += r * 0.08; arc.rotation.y = Math.PI / 2;
      g.add(arc);
      continue;
    }
    const e = new THREE.Mesh(white, mat('#ffffff'));
    e.position.copy(at);
    const p = new THREE.Mesh(pupil, mat('#111111'));
    p.position.set(r * 0.12 * big, style === 2 ? -r * 0.04 : 0, 0);
    e.add(p);
    if (style === 2) { // sleepy: half-closed lids
      const lidM = new THREE.Mesh(new THREE.SphereGeometry(r * 0.215, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(lid));
      lidM.rotation.z = -0.35;
      e.add(lidM);
    }
    if (style === 3) { // angry: brows slanting down to the middle
      const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.06, r * 0.06, r * 0.32), mat('#222222'));
      brow.position.set(r * 0.08, r * 0.24, 0);
      brow.rotation.x = -s * 0.5;
      e.add(brow);
    }
    g.add(e);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Hats (built at unit scale, ~1.0 wide). Origin = bottom center.

function cyl(rt: number, rb: number, h: number, color: string, seg = 10): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), color);
  m.position.y = h / 2;
  return m;
}

/** A hat from its look: one of the shapes (in the look's colors), stretched,
 *  with an optional decoration on top. */
export function makeHat(look: HatLook): THREE.Group {
  const body = hatShape(look.shape, look.c);
  body.scale.set(look.w, look.h, look.w);
  const g = new THREE.Group();
  g.add(body);
  if (look.deco) {
    body.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(body).max.y;
    const d = hatDeco(look.deco, look.dc);
    d.position.y = top - 0.03;
    g.add(d);
  }
  return g;
}

function hatShape(kind: number, c: string[]): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Object3D, y = 0) => { m.position.y += y; g.add(m); return m; };
  switch (kind % 16) {
    case 0: // Top hat
      add(cyl(0.6, 0.6, 0.05, c[2]));
      add(cyl(0.36, 0.34, 0.55, c[0]), 0.04);
      add(cyl(0.355, 0.355, 0.1, c[1]), 0.06);
      break;
    case 1: // Bucket hat
      add(cyl(0.38, 0.58, 0.16, c[1]));
      add(cyl(0.32, 0.38, 0.3, c[0]), 0.12);
      break;
    case 2: { // Visor
      add(cyl(0.38, 0.38, 0.14, c[0]));
      const bill = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 12, 1, false, -Math.PI / 2, Math.PI), c[1]);
      bill.position.set(0.15, 0.03, 0); add(bill);
      break;
    }
    case 3: { // Baseball cap
      const dome = mesh(new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      add(dome);
      const bill = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12, 1, false, -Math.PI / 2, Math.PI), c[0]);
      bill.position.set(0.18, 0.02, 0); add(bill);
      add(cyl(0.05, 0.05, 0.05, c[1], 6), 0.36);
      break;
    }
    case 4: // Sun hat
      add(cyl(0.75, 0.75, 0.04, c[0], 14));
      add(cyl(0.3, 0.36, 0.26, c[0]), 0.03);
      add(cyl(0.365, 0.365, 0.08, c[1]), 0.04);
      break;
    case 5: // Fedora
      add(cyl(0.58, 0.58, 0.04, c[2], 12));
      add(cyl(0.3, 0.37, 0.32, c[0]), 0.03);
      add(cyl(0.375, 0.375, 0.07, c[1]), 0.04);
      break;
    case 6: { // Bowler
      add(cyl(0.5, 0.5, 0.04, c[1], 12));
      const dome = mesh(new THREE.SphereGeometry(0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      dome.scale.y = 1.1; add(dome, 0.03);
      break;
    }
    case 7: { // Beanie with pompom
      const dome = mesh(new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      dome.scale.y = 1.15; add(dome);
      add(cyl(0.39, 0.39, 0.1, c[1]));
      const pom = mesh(new THREE.IcosahedronGeometry(0.12, 0), c[1]);
      pom.position.y = 0.46; add(pom);
      break;
    }
    case 8: { // Flat cap
      const dome = mesh(new THREE.SphereGeometry(0.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      dome.scale.y = 0.45; add(dome);
      const bill = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12, 1, false, -Math.PI / 2.4, Math.PI / 1.2), c[1]);
      bill.position.set(0.12, 0.04, 0); add(bill);
      break;
    }
    case 9: { // Propeller beanie
      for (let i = 0; i < 4; i++) {
        const seg = mesh(new THREE.SphereGeometry(0.38, 4, 5, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2), c[i]);
        add(seg);
      }
      add(cyl(0.03, 0.03, 0.18, '#444', 6), 0.36);
      const blade = mesh(new THREE.BoxGeometry(0.7, 0.02, 0.1), c[0]);
      blade.position.y = 0.55; blade.rotation.y = 0.6; add(blade);
      break;
    }
    case 10: { // Viking helmet
      const dome = mesh(new THREE.SphereGeometry(0.39, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      add(dome);
      add(cyl(0.4, 0.4, 0.08, c[1]));
      for (const s of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.08, 0.38, 6), c[2]);
        horn.position.set(0, 0.28, s * 0.38); horn.rotation.x = s * -0.9; add(horn);
      }
      break;
    }
    case 11: { // Headband
      const band = mesh(new THREE.TorusGeometry(0.36, 0.06, 6, 16), c[0]);
      band.rotation.x = Math.PI / 2; band.position.y = 0.08; add(band);
      const knot = mesh(new THREE.BoxGeometry(0.06, 0.14, 0.18), c[1]);
      knot.position.set(-0.4, 0.08, 0); knot.rotation.z = 0.4; add(knot);
      break;
    }
    case 12: { // Swim cap (water polo, with ear guards)
      const dome = mesh(new THREE.SphereGeometry(0.39, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), c[0]);
      dome.scale.y = 1.05; add(dome);
      for (const s of [-1, 1]) {
        const ear = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10), c[1]);
        ear.rotation.x = Math.PI / 2; ear.position.set(0, 0.08, s * 0.38); add(ear);
      }
      break;
    }
    case 13: // Fez
      add(cyl(0.24, 0.32, 0.4, c[0]));
      add(cyl(0.02, 0.02, 0.06, c[1], 4), 0.4);
      { const tassel = mesh(new THREE.ConeGeometry(0.05, 0.22, 5), c[1]); tassel.position.set(-0.18, 0.32, 0); tassel.rotation.z = 0.3; add(tassel); }
      break;
    case 14: { // Cowboy hat
      const brim = mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.04, 14), c[2]);
      add(brim);
      for (const s of [-1, 1]) {
        const curl = mesh(new THREE.BoxGeometry(0.9, 0.04, 0.2), c[2]);
        curl.position.set(0, 0.08, s * 0.62); curl.rotation.x = s * 0.6; add(curl);
      }
      add(cyl(0.3, 0.36, 0.36, c[0]), 0.03);
      add(cyl(0.365, 0.365, 0.07, c[1]), 0.05);
      break;
    }
    case 15: { // Crown
      add(cyl(0.36, 0.36, 0.18, c[0], 12));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = mesh(new THREE.ConeGeometry(0.08, 0.2, 4), c[0]);
        spike.position.set(Math.cos(a) * 0.32, 0.27, Math.sin(a) * 0.32); add(spike);
        const gem = mesh(new THREE.OctahedronGeometry(0.045, 0), i % 2 ? c[1] : c[2]);
        gem.position.set(Math.cos(a) * 0.37, 0.09, Math.sin(a) * 0.37); add(gem);
      }
      break;
    }
  }
  return g;
}

/** Decorations (HAT_DECOS order), origin at the top of the hat. */
function hatDeco(kind: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Object3D, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };
  switch (kind) {
    case 1: // Pompom
      add(mesh(new THREE.IcosahedronGeometry(0.13, 0), color), 0, 0.1, 0);
      break;
    case 2: { // Feather
      const f = add(mesh(new THREE.ConeGeometry(0.06, 0.6, 5), color), -0.15, 0.22, 0.12);
      f.rotation.z = 0.6; f.scale.z = 0.4;
      break;
    }
    case 3: // Antenna
      add(cyl(0.015, 0.015, 0.3, '#444', 5), 0, 0, 0);
      add(mesh(new THREE.IcosahedronGeometry(0.07, 0), color), 0, 0.33, 0);
      break;
    case 4: // Flower
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(mesh(new THREE.IcosahedronGeometry(0.06, 0), color), Math.cos(a) * 0.08, 0.1, Math.sin(a) * 0.08);
      }
      add(mesh(new THREE.IcosahedronGeometry(0.055, 0), '#ffd23f'), 0, 0.12, 0);
      add(cyl(0.015, 0.015, 0.1, '#3c9a3c', 4), 0, 0, 0);
      break;
    case 5: { // Star
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.07 : 0.17;
        if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      const star = add(mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }), color), 0, 0.2, -0.025);
      star.rotation.y = Math.PI / 2;
      add(cyl(0.015, 0.015, 0.06, '#444', 4), 0, 0, 0);
      break;
    }
    case 6: { // Propeller
      add(cyl(0.025, 0.025, 0.16, '#444', 6), 0, 0, 0);
      const blade = add(mesh(new THREE.BoxGeometry(0.7, 0.02, 0.1), color), 0, 0.17, 0);
      blade.rotation.y = 0.6;
      break;
    }
    case 7: // Horns
      for (const s of [-1, 1]) {
        const horn = add(mesh(new THREE.ConeGeometry(0.06, 0.3, 6), color), 0, 0.06, s * 0.18);
        horn.rotation.x = s * -0.5;
      }
      break;
    case 8: // Bunny ears
      for (const s of [-1, 1]) {
        const ear = add(mesh(new THREE.SphereGeometry(0.08, 8, 6), color), -0.05, 0.22, s * 0.12);
        ear.scale.set(0.6, 3, 1);
        ear.rotation.x = s * -0.2;
      }
      break;
    case 9: { // Candle
      add(cyl(0.05, 0.05, 0.2, color, 8), 0, 0, 0);
      const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), mat('#ffb020', { emissive: '#ff8a00' })), 0, 0.26, 0);
      flame.castShadow = false;
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Props

export function makeCar(color = '#e8463c'): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(2.2, 0.5, 1.3), color);
  body.position.y = 0.45; g.add(body);
  const cabin = mesh(new THREE.BoxGeometry(1.0, 0.45, 1.1), '#bfe3ff');
  cabin.position.set(-0.2, 0.9, 0); g.add(cabin);
  const roof = mesh(new THREE.BoxGeometry(1.05, 0.08, 1.15), color);
  roof.position.set(-0.2, 1.15, 0); g.add(roof);
  const wheel = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 8);
  for (const [x, z] of [[0.7, 0.65], [-0.7, 0.65], [0.7, -0.65], [-0.7, -0.65]]) {
    const w = mesh(wheel, '#222');
    w.rotation.x = Math.PI / 2; w.position.set(x, 0.28, z); g.add(w);
  }
  const light = mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), '#fff6a0');
  light.position.set(1.11, 0.5, 0.4); g.add(light);
  const light2 = light.clone(); light2.position.z = -0.4; g.add(light2);
  return g;
}

export function makeFlag(color: string): THREE.Group {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), '#eeeeee');
  pole.position.y = 1.1; g.add(pole);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(0.9, -0.3); shape.lineTo(0, -0.6);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
  cloth.position.set(0.05, 2.15, 0); cloth.castShadow = true;
  cloth.name = 'cloth';
  g.add(cloth);
  return g;
}

export function makeBase(color: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02;
  return m;
}

export const PICKUP_INFO: Record<string, { name: string; icon: string; color: string; bad?: boolean }> = {
  speed: { name: 'Speed!', icon: '⚡', color: '#ffd23f' },
  shield: { name: 'Bubble Shield!', icon: '🫧', color: '#2ed3d3' },
  double: { name: 'Double Hat!', icon: '🎩', color: '#ff6fb5' },
  phase: { name: 'Phase Dash!', icon: '👻', color: '#a77dff' },
  invis: { name: 'Invisible!', icon: '🕶️', color: '#7f9fb8' },
  slow: { name: 'Slowpoke…', icon: '🐌', color: '#7a8a3a', bad: true },
  reverse: { name: 'Reversed!', icon: '😵‍💫', color: '#c0392b', bad: true },
};
const PICKUP_COLORS: Record<string, string> = Object.fromEntries(Object.entries(PICKUP_INFO).map(([k, v]) => [k, v.color]));
const PICKUP_ICONS: Record<string, string> = Object.fromEntries(Object.entries(PICKUP_INFO).map(([k, v]) => [k, v.icon]));

function iconTexture(icon: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '96px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icon, 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makePickup(kind: string, hidden = false): THREE.Group {
  const g = new THREE.Group();
  if (hidden) {
    // Mystery box: every power-up looks the same until someone grabs it.
    const box = mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), '#f4f1ff');
    box.position.y = 0.7; box.name = 'gem';
    g.add(box);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('❓'), depthTest: false }));
    sprite.scale.set(0.8, 0.8, 0.8); sprite.position.y = 1.55; sprite.renderOrder = 5;
    g.add(sprite);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 20), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    return g;
  }
  // Good power-ups are smooth gems; bad ones are dark, spiky lumps.
  const bad = PICKUP_INFO[kind]?.bad;
  const box = mesh(bad ? new THREE.TetrahedronGeometry(0.5, 0) : new THREE.OctahedronGeometry(0.45, 0), PICKUP_COLORS[kind] ?? '#fff');
  box.position.y = 0.7; box.name = 'gem';
  g.add(box);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(PICKUP_ICONS[kind] ?? '?'), depthTest: false }));
  sprite.scale.set(0.8, 0.8, 0.8); sprite.position.y = 1.55; sprite.renderOrder = 5;
  g.add(sprite);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 20), new THREE.MeshBasicMaterial({ color: PICKUP_COLORS[kind], transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  return g;
}

/** Choppable tree, origin at the base of the trunk. */
export function makeTree(seed: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.3, 7), '#8a5a3b');
  trunk.position.y = 0.65; g.add(trunk);
  const canopy = new THREE.Group();
  canopy.name = 'canopy';
  const greens = ['#3f9b5b', '#4fae62', '#5cbf6b'];
  const tall = 0.8 + (seed % 3) * 0.15;
  for (let i = 0; i < 3; i++) {
    const c = mesh(new THREE.ConeGeometry(1.25 - i * 0.3, 1.2 * tall, 7), greens[(i + seed) % 3]);
    c.position.y = 1.5 + i * 0.6 * tall;
    c.rotation.y = i * 0.7 + seed;
    canopy.add(c);
  }
  g.add(canopy);
  return g;
}

/** Breakable prop model for a kind, origin at its base. */
export function makeProp(kind: string, seed: number): THREE.Group {
  if (kind === 'tree') return makeTree(seed);
  const g = new THREE.Group();
  switch (kind) {
    case 'crate': {
      // Light lid inside a darker rim of planks. The rim sits 0.03 above the lid
      // so no faces are coplanar (they used to z-fight).
      const box = mesh(new THREE.BoxGeometry(1.0, 0.97, 1.0), '#c98b4f');
      box.position.y = 0.485; g.add(box);
      for (const y of [0.06, 0.94]) {
        for (const [w, d, x, z] of [[1.04, 0.14, 0, 0.45], [1.04, 0.14, 0, -0.45], [0.14, 0.76, 0.45, 0], [0.14, 0.76, -0.45, 0]] as const) {
          const b = mesh(new THREE.BoxGeometry(w, 0.12, d), '#8a5a3b');
          b.position.set(x, y, z);
          g.add(b);
        }
      }
      for (let i = 0; i < 4; i++) {
        const brace = mesh(new THREE.BoxGeometry(0.12, 1.2, 0.04), '#8a5a3b');
        const a = (i * Math.PI) / 2;
        brace.position.set(Math.sin(a) * 0.51, 0.5, Math.cos(a) * 0.51);
        brace.rotation.y = a; brace.rotation.z = Math.PI / 4;
        g.add(brace);
      }
      break;
    }
    case 'barrel': {
      const body = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), '#d8392b');
      body.position.y = 0.5; g.add(body);
      for (const y of [0.18, 0.82]) {
        const band = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 12), '#5a1a14'); band.position.y = y; g.add(band);
      }
      const stripe = mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.16, 12), '#ffd23f'); stripe.position.y = 0.5; g.add(stripe);
      const lid = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12), '#b02a1e'); lid.position.y = 1.01; g.add(lid);
      break;
    }
    case 'rock': {
      const a = mesh(new THREE.DodecahedronGeometry(0.75, 0), '#9aa3ab');
      a.position.y = 0.45; a.scale.set(1, 0.8, 1); a.rotation.set(seed, seed * 2, 0); g.add(a);
      const b = mesh(new THREE.DodecahedronGeometry(0.4, 0), '#b4bcc3');
      b.position.set(0.45, 0.3, 0.25); b.rotation.set(seed * 3, 0, seed); g.add(b);
      break;
    }
    case 'grass': {
      // A solid clump of overlapping tufts that hides the ground (one merged mesh).
      const m = new THREE.Mesh(grassGeometry(seed % 3), vertexColorMat);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      break;
    }
    case 'bush': {
      const greens = ['#4a9e4f', '#5cb35e', '#3f8f45'];
      for (let i = 0; i < 4; i++) {
        const blob = mesh(new THREE.IcosahedronGeometry(0.42 - i * 0.04, 0), greens[(i + seed) % 3]);
        const a = i * 2.1 + seed;
        blob.position.set(i ? Math.cos(a) * 0.3 : 0, i ? 0.35 : 0.55, i ? Math.sin(a) * 0.3 : 0);
        g.add(blob);
      }
      break;
    }
  }
  return g;
}

const grassGeos: THREE.BufferGeometry[] = [];
/** Merged, vertex-colored tall-grass clump (three variants). */
export function grassGeometry(variant: number): THREE.BufferGeometry {
  if (grassGeos[variant]) return grassGeos[variant];
  const greens = ['#5fae4a', '#6fbf55', '#55a443', '#7cc760'].map((c) => new THREE.Color(c));
  let k = 17 + variant * 31;
  const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number, ry = 0) => {
    const gg = geo.toNonIndexed();
    gg.rotateY(ry); gg.translate(x, y, z);
    const cols = new Float32Array(gg.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) { cols[i] = color.r; cols[i + 1] = color.g; cols[i + 2] = color.b; }
    gg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    gg.deleteAttribute('uv');
    parts.push(gg);
  };
  // Ground cover.
  add(new THREE.CylinderGeometry(1.08, 1.12, 0.3, 9), greens[2], 0, 0.15, 0);
  // Ring of fat tufts plus a taller middle.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.5, r = 0.62 + rnd() * 0.18, h = 0.95 + rnd() * 0.35;
    add(new THREE.ConeGeometry(0.42 + rnd() * 0.1, h, 5), greens[i % 4], Math.cos(a) * r, h / 2 + 0.1, Math.sin(a) * r, rnd() * 3);
  }
  add(new THREE.ConeGeometry(0.55, 1.45, 6), greens[1], 0, 0.8, 0, rnd() * 3);
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  grassGeos[variant] = merged;
  return merged;
}

export function makeStump(): THREE.Group {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.35, 7), '#8a5a3b');
  s.position.y = 0.17; g.add(s);
  const top = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 7), '#e9c99a');
  top.position.y = 0.36; g.add(top);
  return g;
}

export { PICKUP_COLORS, PICKUP_ICONS };
