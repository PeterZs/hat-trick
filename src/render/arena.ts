// Visuals for arena hazards and gadgets (render-only): pits, tile floors
// (collapse/lava), ice, conveyors, bumpers, portals, wind, golf, day/night.

import * as THREE from 'three';
import type { Level } from '../sim/level';
import type { GameState } from '../sim/types';
import { HZ } from '../sim/const';
import { tileCenter, tileGrid, TILE_FALLEN, TILE_NONE, TILE_SOLID } from '../sim/hazards';
import { GOLF_BALL_R } from '../sim/golf';
import { makeBall, mat, TEAM_COLORS } from './models';

const PIT = '#241d2b';

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
  private tileKey = '';
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
    this.tiles = null; this.tileKey = '';
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

  private updateTiles(s: GameState, time: number): void {
    const g = s.tiles.length ? tileGrid(s) : null;
    const key = g ? `${g.nx}x${g.ny}:${g.cell}` : '';
    if (key !== this.tileKey) {
      if (this.tiles) { this.group.remove(this.tiles); this.tiles.dispose(); this.tiles = null; }
      this.tileKey = key;
      if (g) {
        const geo = new THREE.PlaneGeometry(g.cell * 0.98, g.cell * 0.98);
        geo.rotateX(-Math.PI / 2);
        this.tiles = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), g.nx * g.ny);
        this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(this.tiles);
      }
    }
    if (!g || !this.tiles) return;
    const L = this.L!;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const lava = !!g.spec.lava;
    const voidColor = new THREE.Color(L.outside ?? PIT);
    const flashRed = new THREE.Color('#ff4a2a'), floor = new THREE.Color(L.floor[0]);
    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      const [x, z] = tileCenter(g, i);
      if (t === TILE_SOLID) { m.makeScale(0, 0, 0); this.tiles.setMatrixAt(i, m); continue; }
      m.makeTranslation(x, 0.018, z);
      this.tiles.setMatrixAt(i, m);
      if (t > 0) {
        // Warning: flash faster as it's about to go.
        const f = Math.sin(time * (10 + 30 / Math.max(1, t / 10))) * 0.5 + 0.5;
        c.copy(floor).lerp(flashRed, 0.35 + 0.5 * f);
      } else if (t === TILE_FALLEN && lava) {
        const glow = 0.75 + 0.25 * Math.sin(time * 3 + x * 0.7 + z * 0.5);
        c.setRGB(1.0 * glow, 0.38 * glow, 0.08);
      } else {
        c.copy(voidColor);
        if (t === TILE_NONE) c.multiplyScalar(1);
      }
      this.tiles.setColorAt(i, c);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
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
