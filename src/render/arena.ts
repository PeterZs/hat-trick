// Visuals for arena hazards and gadgets (render-only): pits, tile floors
// (collapse/lava), ice, conveyors, bumpers, portals, wind, golf, day/night.

import * as THREE from 'three';
import type { Level } from '../sim/level';
import type { GameState } from '../sim/types';
import { HZ } from '../sim/const';
import { tileCenter, tileGrid, TILE_FALLEN, TILE_NONE } from '../sim/hazards';
import { GOLF_BALL_R } from '../sim/golf';
import { makeBall, mat, TEAM_COLORS } from './models';

const PIT = '#241d2b';
/** Thickness of floor slabs (how deep a fallen tile's hole looks). */
const SLAB_DEPTH = 1.6;

function flat(w: number, h: number, color: string, y: number, opts: Partial<THREE.MeshBasicMaterialParameters> = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, ...opts }));
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  return m;
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d4249'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f4c430';
  g.beginPath(); g.moveTo(14, 8); g.lineTo(40, 32); g.lineTo(14, 56); g.lineTo(26, 56); g.lineTo(52, 32); g.lineTo(26, 8); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Belt { tex: THREE.Texture; speed: number; along: 'x' | 'y'; sign: number }
interface Streak { m: THREE.Mesh; zone: number; life: number }

export class ArenaView {
  readonly group = new THREE.Group();
  private belts: Belt[] = [];
  private bumpers: { m: THREE.Group; squash: number }[] = [];
  private portals: THREE.Group[] = [];
  private streaks: Streak[] = [];
  private tiles: THREE.InstancedMesh | null = null;
  private under: THREE.Mesh | null = null;
  private tileObjs: THREE.Object3D[] = [];
  private tileKey = '';
  private prevTiles: number[] = [];
  private fallAt = new Map<number, number>();
  /** True while a tiled floor replaces the normal floor. */
  tilesActive = false;
  private golfGroup = new THREE.Group();
  private golfBalls: THREE.Group[] = [];
  private golfCup: THREE.Group | null = null;
  private lights: THREE.PointLight[] = [];
  private L: Level | null = null;
  darkness = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  build(L: Level): void {
    this.L = L;
    this.group.clear();
    this.belts = []; this.bumpers = []; this.portals = []; this.streaks = [];
    this.tiles = null; this.under = null; this.tileObjs = []; this.tileKey = ''; this.tilesActive = false;
    this.golfGroup = new THREE.Group(); this.group.add(this.golfGroup);
    this.golfBalls = []; this.golfCup = null;
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];
    const pitColor = L.water ? '#4aa3df' : L.outside ?? PIT;

    for (const p of L.pits ?? []) {
      const m = flat(p.x1 - p.x0, p.y1 - p.y0, pitColor, 0.012);
      m.position.x = (p.x0 + p.x1) / 2; m.position.z = (p.y0 + p.y1) / 2;
      this.group.add(m);
      // A dark rim so the edge reads as a drop.
      const rim = flat(p.x1 - p.x0 + 0.24, p.y1 - p.y0 + 0.24, '#000000', 0.008, { transparent: true, opacity: 0.35 });
      rim.position.copy(m.position); rim.position.y = 0.008;
      this.group.add(rim);
    }
    for (const r of L.ice ?? []) {
      const m = flat(r.x1 - r.x0, r.y1 - r.y0, '#ffffff', 0.006, { transparent: true, opacity: 0.35 });
      m.position.x = (r.x0 + r.x1) / 2; m.position.z = (r.y0 + r.y1) / 2;
      this.group.add(m);
    }
    for (const c of L.conveyors ?? []) {
      // Lay the belt out along its direction of travel so the chevrons
      // (pointing +u in the texture) face downstream.
      const tex = chevronTexture();
      const w = c.x1 - c.x0, h = c.y1 - c.y0;
      const alongX = Math.abs(c.vx) >= Math.abs(c.vy);
      const len = alongX ? w : h, wid = alongX ? h : w;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, wid), new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      tex.repeat.set(len / 1.5, wid / 1.5);
      const holder = new THREE.Group();
      holder.add(m);
      holder.position.set((c.x0 + c.x1) / 2, 0.015, (c.y0 + c.y1) / 2);
      holder.rotation.y = Math.atan2(-c.vy, c.vx); // texture +u -> world (vx, vy)
      this.group.add(holder);
      this.belts.push({ tex, speed: Math.hypot(c.vx, c.vy) / 1.5, along: 'x', sign: 1 });
    }
    for (const b of L.bumpers ?? []) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r * 1.08, 0.7, 20), mat('#e63946'));
      body.position.y = 0.35; body.castShadow = true; g.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.7, b.r * 0.7, 0.06, 20), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
      top.position.y = 0.73; g.add(top);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r * 1.02, 0.08, 6, 24), mat('#ffffff'));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; g.add(ring);
      g.position.set(b.x, 0, b.y);
      this.group.add(g);
      this.bumpers.push({ m: g, squash: 0 });
    }
    const pairColors = ['#ff9f43', '#4a8dff', '#4fd17a', '#c77dff'];
    (L.portals ?? []).forEach((p, i) => {
      const color = pairColors[Math.floor(Math.min(i, p.to) / 1) % pairColors.length];
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 28), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; g.add(disc);
      for (let k = 0; k < 3; k++) {
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        orb.name = 'orb'; g.add(orb);
      }
      g.position.set(p.x, 0, p.y);
      this.group.add(g);
      this.portals.push(g);
    });
    (L.wind ?? []).forEach((_, zi) => {
      for (let k = 0; k < 14; k++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        this.group.add(m);
        this.streaks.push({ m, zone: zi, life: -Math.random() * 2 });
      }
    });
    if (L.night) {
      // A fixed pool of lights (changing light count recompiles shaders).
      for (let i = 0; i < 6; i++) {
        const l = new THREE.PointLight('#ffd9a0', 0, 9, 1.6);
        l.position.y = 2.2;
        this.scene.add(l);
        this.lights.push(l);
      }
    }
  }

  onBump(i: number): void { const b = this.bumpers[i]; if (b) b.squash = 1; }

  update(s: GameState, dt: number, time: number): void {
    const L = this.L;
    if (!L) return;
    for (const b of this.belts) {
      // Chevrons point +u; scroll the texture so they flow with the belt.
      b.tex.offset.x -= b.sign * b.speed * dt;
    }
    for (const b of this.bumpers) {
      b.squash = Math.max(0, b.squash - dt * 5);
      const k = Math.sin(b.squash * Math.PI) * 0.25;
      b.m.scale.set(1 + k, 1 - k, 1 + k);
    }
    for (const g of this.portals) {
      g.children[0].rotation.z = time * 2;
      let k = 0;
      for (const c of g.children) {
        if (c.name !== 'orb') continue;
        const a = time * 3 + (k++ * Math.PI * 2) / 3;
        c.position.set(Math.cos(a) * 0.7, 0.3 + 0.15 * Math.sin(time * 4 + k), Math.sin(a) * 0.7);
      }
    }
    for (const st of this.streaks) {
      const z = L.wind![st.zone];
      st.life -= dt;
      if (st.life <= 0) {
        st.life = 0.8 + Math.random() * 0.8;
        st.m.position.set(z.x0 + Math.random() * (z.x1 - z.x0), 0.3 + Math.random() * 1.2, z.y0 + Math.random() * (z.y1 - z.y0));
        st.m.rotation.z = -Math.atan2(z.fx, z.fy);
      }
      st.m.position.x += z.fx * dt * 1.2; st.m.position.z += z.fy * dt * 1.2;
      (st.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(0.45, st.life * 0.6));
    }
    this.updateTiles(s, time);
    this.updateGolf(s, time);
    this.updateNight(s);
  }

  /** Tiled floors: each tile is a thick slab, so a fallen tile leaves a
   *  recessed hole (neighbors' sides as walls) with lava/water/void below. */
  private updateTiles(s: GameState, time: number): void {
    const g = s.tiles.length ? tileGrid(s) : null;
    const key = g ? `${g.nx}x${g.ny}:${g.cell}:${this.L?.id}:${g.spec.lava}` : '';
    if (key !== this.tileKey) this.buildTiles(g, key);
    if (!g || !this.tiles) return;
    const L = this.L!;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const c0 = new THREE.Color(L.floor[0]), c1 = new THREE.Color(L.floor[1]), red = new THREE.Color('#ff4a2a');
    const D = SLAB_DEPTH;
    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      const prev = this.prevTiles[i];
      if (t === TILE_FALLEN && prev !== undefined && prev !== TILE_FALLEN) this.fallAt.set(i, time);
      this.prevTiles[i] = t;
      const [x, z] = tileCenter(g, i);
      const tx = i % g.nx, tz = (i - tx) / g.nx;
      const base = (tx + tz) % 2 ? c0 : c1;
      if (t === TILE_NONE) { m.makeScale(0, 0, 0); this.tiles.setMatrixAt(i, m); continue; }
      let y = -D / 2, jx = 0, jz = 0;
      c.copy(base);
      if (t > 0) {
        // Warning: flash red and jiggle, more as it's about to go.
        const urgency = 1 - Math.min(1, t / 60);
        const f = Math.sin(time * (10 + 25 * urgency)) * 0.5 + 0.5;
        c.lerp(red, 0.3 + 0.5 * f);
        jx = Math.sin(time * 47 + i) * 0.03 * (0.5 + urgency);
        jz = Math.cos(time * 53 + i * 1.7) * 0.03 * (0.5 + urgency);
        y -= 0.04 * urgency;
      } else if (t === TILE_FALLEN) {
        // Drop out of sight (or already gone).
        const t0 = this.fallAt.get(i);
        const k = t0 === undefined ? 99 : time - t0;
        if (k > 0.7) { m.makeScale(0, 0, 0); this.tiles.setMatrixAt(i, m); continue; }
        y -= 9 * k * k;
        c.multiplyScalar(Math.max(0.3, 1 - k));
      }
      m.makeTranslation(x + jx, y, z + jz);
      this.tiles.setMatrixAt(i, m);
      this.tiles.setColorAt(i, c);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    if (this.under && g.spec.lava) {
      const glow = 0.8 + 0.2 * Math.sin(time * 2.2);
      (this.under.material as THREE.MeshBasicMaterial).color.setRGB(1.0 * glow, 0.36 * glow, 0.06);
    }
  }

  private buildTiles(g: ReturnType<typeof tileGrid>, key: string): void {
    for (const o of this.tileObjs) { this.group.remove(o); }
    this.tileObjs = [];
    this.tiles = null; this.under = null;
    this.tileKey = key;
    this.prevTiles = []; this.fallAt.clear();
    this.tilesActive = !!g;
    if (!g) return;
    const L = this.L!;
    const D = SLAB_DEPTH;
    const W = g.nx * g.cell, H = g.ny * g.cell;
    // Slabs.
    // Slab sides are darker than the top so a hole's walls read as depth.
    const geo = new THREE.BoxGeometry(g.cell, D, g.cell).toNonIndexed();
    const nrm = geo.getAttribute('normal'), cols = new Float32Array(nrm.count * 3);
    for (let v = 0; v < nrm.count; v++) {
      const top = nrm.getY(v) > 0.5, shade = top ? 1 : 0.42;
      cols[v * 3] = shade * 0.95; cols[v * 3 + 1] = shade * 0.85; cols[v * 3 + 2] = shade * 0.8;
      if (top) { cols[v * 3] = cols[v * 3 + 1] = cols[v * 3 + 2] = 1; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const slabs = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true }), g.nx * g.ny);
    slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    slabs.receiveShadow = true;
    slabs.castShadow = false;
    // What's below: lava, water (open levels) or a dark pit.
    const lava = !!g.spec.lava;
    const belowColor = lava ? '#ff5c10' : L.outside ?? '#241d2b';
    const under = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.02, H + 0.02),
      lava ? new THREE.MeshBasicMaterial({ color: belowColor }) : new THREE.MeshLambertMaterial({ color: belowColor }));
    under.rotation.x = -Math.PI / 2; under.position.set(g.x0 + W / 2, -D * 0.95, g.y0 + H / 2);
    // Ground around the slab area with a matching hole, at the same height as
    // before for walled arenas, or at water level for open ones.
    const shape = new THREE.Shape();
    shape.moveTo(-120, -120); shape.lineTo(120, -120); shape.lineTo(120, 120); shape.lineTo(-120, 120); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(g.x0, g.y0); hole.lineTo(g.x0, g.y0 + H); hole.lineTo(g.x0 + W, g.y0 + H); hole.lineTo(g.x0 + W, g.y0); hole.closePath();
    shape.holes.push(hole);
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: L.outside ?? '#79b765', flatShading: true, side: THREE.DoubleSide }));
    ring.rotation.x = Math.PI / 2; // shape is in x/y; lay it on x/z (y -> z)
    ring.position.y = L.open ? -D * 0.95 : -0.02;
    ring.receiveShadow = true;
    // Under a walled arena the hole's outer rim needs sides down to the lava.
    const skirt = L.open ? null : new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, D, H + 0.4), new THREE.MeshLambertMaterial({ color: '#5b4a3a', side: THREE.BackSide }));
    if (skirt) skirt.position.set(g.x0 + W / 2, -D / 2 - 0.01, g.y0 + H / 2);
    for (const o of [slabs, under, ring, skirt]) if (o) { this.group.add(o); this.tileObjs.push(o); }
    this.tiles = slabs; this.under = under;
  }

  private updateGolf(s: GameState, time: number): void {
    const g = s.golf;
    this.golfGroup.visible = !!g;
    if (!g) return;
    if (!this.golfCup) {
      const cup = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: '#111111' }));
      hole.rotation.x = -Math.PI / 2; hole.position.y = 0.02; cup.add(hole);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), mat('#eeeeee'));
      pole.position.y = 1.3; cup.add(pole);
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.9, -0.28); shape.lineTo(0, -0.56);
      const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: '#ff3b3b', side: THREE.DoubleSide }));
      flag.position.set(0.04, 2.55, 0); flag.name = 'flag'; cup.add(flag);
      this.golfGroup.add(cup);
      this.golfCup = cup;
    }
    this.golfCup.position.set(g.cupX, 0, g.cupY);
    this.golfCup.getObjectByName('flag')!.rotation.y = Math.sin(time * 5) * 0.3;
    g.balls.forEach((b, i) => {
      let v = this.golfBalls[i];
      if (!v) {
        v = new THREE.Group();
        const ball = makeBall(8, GOLF_BALL_R); ball.name = 'ball'; ball.position.y = GOLF_BALL_R; v.add(ball);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 20), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[b.team % 4] }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; v.add(ring);
        this.golfGroup.add(v);
        this.golfBalls[i] = v;
      }
      const last = v.userData.last as [number, number] | undefined;
      if (last) {
        const dx = b.x - last[0], dz = b.y - last[1], d = Math.hypot(dx, dz);
        if (d > 1e-4 && d < 3) v.getObjectByName('ball')!.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), d / GOLF_BALL_R));
      }
      v.userData.last = [b.x, b.y];
      v.position.set(b.x, b.sunk ? -0.5 : 0, b.y);
      v.visible = !b.sunk;
    });
  }

  private updateNight(s: GameState): void {
    if (!this.L?.night) { this.darkness = 0; return; }
    // 30 s cycle: day, dusk, night, dawn (driven by the frame so every peer agrees).
    const t = (s.frame / HZ / 30) % 1;
    const d = t < 0.55 ? 0 : t < 0.62 ? (t - 0.55) / 0.07 : t < 0.93 ? 1 : 1 - (t - 0.93) / 0.07;
    this.darkness = d;
    const lit = s.players.filter((p) => p.active && p.alive && p.role === 'fighter');
    this.lights.forEach((l, i) => {
      const p = lit[i];
      l.intensity = p ? 12 * d : 0;
      if (p) { l.position.x = p.x; l.position.z = p.y; }
    });
  }
}
