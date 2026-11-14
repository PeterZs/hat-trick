// Procedural low-poly, flat-colored models.

import * as THREE from 'three';

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

type Pattern = (n: THREE.Vector3) => string;

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

const PATTERNS: Pattern[] = [
  // Soccer
  (n) => (ICO_VERTS.some((v) => v.dot(n) > 0.94) ? '#222222' : '#fafafa'),
  // Basketball
  (n) => (Math.abs(n.x) < 0.07 || Math.abs(n.y) < 0.07 || Math.abs(Math.abs(n.z) - 0.72) < 0.07 ? '#3a1d0e' : '#f07a2a'),
  // Tennis
  (n) => (seam(n) < 0.1 ? '#f8f8f0' : '#cfe83c'),
  // Baseball
  (n) => (Math.abs(seam(n) - 0.14) < 0.05 ? '#d8322e' : '#f7f4ea'),
  // Beach ball
  (n) => {
    if (Math.abs(n.y) > 0.88) return '#ffffff';
    const a = Math.atan2(n.z, n.x) + Math.PI;
    return ['#ff4b4b', '#ffffff', '#ffcf33', '#ffffff', '#3d8bff', '#ffffff'][Math.floor((a / (2 * Math.PI)) * 6) % 6];
  },
  // Eight ball
  (n) => (n.z > 0.72 ? (n.z > 0.93 && Math.abs(n.x) < 0.12 ? '#111111' : '#ffffff') : '#1a1a1a'),
  // Bowling ball
  (n) => {
    const holes = [new THREE.Vector3(0.25, 0.85, 0.45), new THREE.Vector3(-0.2, 0.88, 0.42), new THREE.Vector3(0.0, 0.7, 0.71)];
    if (holes.some((h) => h.clone().normalize().dot(n) > 0.985)) return '#0a0a14';
    return Math.sin(n.x * 7 + n.y * 4 + n.z * 3) > 0.55 ? '#5b74d6' : '#27357e';
  },
  // Volleyball
  (n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax >= ay && ax >= az) return Math.abs(n.y) < 0.2 ? '#ffd23f' : '#ffffff';
    if (ay >= az) return Math.abs(n.z) < 0.2 ? '#2f6fe0' : '#ffffff';
    return Math.abs(n.x) < 0.2 ? '#ffd23f' : '#2f6fe0';
  },
];

const ballGeoCache = new Map<number, THREE.BufferGeometry>();
export function ballGeometry(kind: number, r: number): THREE.BufferGeometry {
  const key = kind * 1000 + Math.round(r * 100);
  const cached = ballGeoCache.get(key);
  if (cached) return cached;
  const g = new THREE.IcosahedronGeometry(r, 3);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const col = new THREE.Color();
  const pat = PATTERNS[kind % PATTERNS.length];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = a.add(b).add(c).normalize();
    col.set(pat(n));
    for (let k = 0; k < 3; k++) { colors[(i + k) * 3] = col.r; colors[(i + k) * 3 + 1] = col.g; colors[(i + k) * 3 + 2] = col.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  ballGeoCache.set(key, g);
  return g;
}

export function makeBall(kind: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(ballGeometry(kind, r), vertexColorMat);
  m.castShadow = true;
  return m;
}

export function makeEyes(r: number): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.SphereGeometry(r * 0.2, 10, 8);
  const pupil = new THREE.SphereGeometry(r * 0.11, 8, 6);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(white, mat('#ffffff'));
    const a = s * 0.38;
    e.position.set(Math.cos(a) * r * 0.93, r * 1.12, Math.sin(a) * r * 0.93);
    const p = new THREE.Mesh(pupil, mat('#111111'));
    p.position.set(r * 0.12, 0, 0);
    e.add(p);
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

export function makeHat(kind: number): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Object3D, y = 0) => { m.position.y += y; g.add(m); return m; };
  switch (kind % 8) {
    case 0: // Top hat
      add(cyl(0.6, 0.6, 0.05, '#222'));
      add(cyl(0.36, 0.34, 0.55, '#262626'), 0.04);
      add(cyl(0.355, 0.355, 0.1, '#d23b3b'), 0.06);
      break;
    case 1: // Bucket hat
      add(cyl(0.38, 0.58, 0.16, '#5f8f4e'));
      add(cyl(0.32, 0.38, 0.3, '#6fa35b'), 0.12);
      break;
    case 2: { // Visor
      add(cyl(0.38, 0.38, 0.14, '#ffffff'));
      const bill = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 12, 1, false, -Math.PI / 2, Math.PI), '#2bb673');
      bill.position.set(0.15, 0.03, 0); add(bill);
      break;
    }
    case 3: { // Baseball cap
      const dome = mesh(new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#1f3c88');
      add(dome);
      const bill = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12, 1, false, -Math.PI / 2, Math.PI), '#1f3c88');
      bill.position.set(0.18, 0.02, 0); add(bill);
      add(cyl(0.05, 0.05, 0.05, '#d23b3b', 6), 0.36);
      break;
    }
    case 4: // Sun hat
      add(cyl(0.75, 0.75, 0.04, '#f1d27a', 14));
      add(cyl(0.3, 0.36, 0.26, '#f1d27a'), 0.03);
      add(cyl(0.365, 0.365, 0.08, '#ff6f91'), 0.04);
      break;
    case 5: // Fedora
      add(cyl(0.58, 0.58, 0.04, '#7a5a3a', 12));
      add(cyl(0.3, 0.37, 0.32, '#8b6a46'), 0.03);
      add(cyl(0.375, 0.375, 0.07, '#2b2b2b'), 0.04);
      break;
    case 6: { // Bowler
      add(cyl(0.5, 0.5, 0.04, '#3a2a20', 12));
      const dome = mesh(new THREE.SphereGeometry(0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#3a2a20');
      dome.scale.y = 1.1; add(dome, 0.03);
      break;
    }
    case 7: { // Beanie with pompom
      const dome = mesh(new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#e94e77');
      dome.scale.y = 1.15; add(dome);
      add(cyl(0.39, 0.39, 0.1, '#ffffff'));
      const pom = mesh(new THREE.IcosahedronGeometry(0.12, 0), '#ffffff');
      pom.position.y = 0.46; add(pom);
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

export function makeStump(): THREE.Group {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.35, 7), '#8a5a3b');
  s.position.y = 0.17; g.add(s);
  const top = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 7), '#e9c99a');
  top.position.y = 0.36; g.add(top);
  return g;
}

export { PICKUP_COLORS, PICKUP_ICONS };
