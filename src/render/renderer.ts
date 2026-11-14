// Three.js view of a GameState. Reads state, never writes it.

import * as THREE from 'three';
import { getLevel, levelBounds, type Level } from '../sim/level';
import { HAT_GROUND, HAT_HELD, HAT_RECALL, type GameState, type Player, type SimEvent } from '../sim/types';
import { isInvisible } from '../sim/common';
import { HZ, isSoloMode, isTeamMode } from '../sim/const';
import {
  PICKUP_INFO, PLAYER_COLORS, TEAM_COLORS, makeBall, makeBase, makeCar, makeEyes, makeFlag, makeHat, makePickup, makeStump, makeTree, mat, vertexColorMat,
} from './models';
import { Effects } from './effects';

const BALL_COLORS = [
  ['#ffffff', '#222222'], ['#f07a2a', '#3a1d0e'], ['#cfe83c', '#ffffff'], ['#f7f4ea', '#d8322e'],
  ['#ff4b4b', '#ffcf33', '#3d8bff'], ['#1a1a1a', '#ffffff'], ['#27357e', '#5b74d6'], ['#ffd23f', '#2f6fe0', '#ffffff'],
];

interface PlayerView {
  root: THREE.Group;
  ballKind: number;
  ball: THREE.Mesh;
  ballMat: THREE.MeshLambertMaterial;
  head: THREE.Group;
  hatStack: THREE.Group;
  hatCount: number;
  ring: THREE.Mesh;
  shield: THREE.Mesh;
  aim: THREE.Group;
  arc: THREE.Mesh;
  kickArc: THREE.Mesh;
  cursor: THREE.Group;
  label: HTMLDivElement;
  lastX: number; lastY: number;
  speedFx: THREE.Mesh;
  windup: THREE.Mesh;
  slashAnim: number;   // seconds into the hat-swing animation, -1 = idle
  slashSide: number;   // alternates the swing direction
  kickAnim: number;    // seconds into the kick lunge, -1 = idle
  squash: number;      // impact squash on the victim of a kick (1 -> 0)
  dustT: number;       // invisible dust-puff timer
}

export interface ViewOptions { showHitboxes: boolean }

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
  private levelGroup = new THREE.Group();
  private levelId = '';
  private players = new Map<number, PlayerView>();
  private hats = new Map<number, { g: THREE.Group; spin: number }>();
  private pickups = new Map<number, THREE.Group>();
  private cars = new Map<number, THREE.Group>();
  private flags: THREE.Group[] = [];
  private bombs = new Map<number, { shadow: THREE.Mesh; bomb: THREE.Mesh }>();
  private ballView: THREE.Mesh | null = null;
  private trees = new Map<number, { g: THREE.Group; wobble: number; wx: number; wz: number }>();
  /** Render-only animations of felled trees and leftover stumps. */
  private falling: { g: THREE.Group; axis: THREE.Vector3; t: number; landed: boolean; x: number; z: number }[] = [];
  private stumps: { g: THREE.Group; t: number; life: number }[] = [];
  private ballLast = { x: 0, y: 0 };
  private hitboxes = new THREE.Group();
  readonly effects: Effects;
  private shake = 0;
  private punch = 0;        // camera punch-in (0..1)
  private flash = 0;        // white screen flash (0..1)
  private flashEl: HTMLDivElement;
  private frozen = false;   // world is in hit-stop
  private baseFov = 32;
  private camBase = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private labels: HTMLElement;
  private sun: THREE.DirectionalLight;
  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
  private time = 0;
  opts: ViewOptions = { showHitboxes: false };
  /** Peer id of this browser (own players stay faintly visible when invisible). */
  localPeer = 0;
  /** Online: show own invisible players as a faint ghost. */
  ghostOwn = false;

  constructor(private canvas: HTMLCanvasElement, labelLayer: HTMLElement) {
    this.labels = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#8fd3ff');
    this.scene.fog = new THREE.Fog('#8fd3ff', 60, 120);

    const hemi = new THREE.HemisphereLight('#ffffff', '#7a9a6a', 1.6);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.9);
    this.sun.position.set(-12, 30, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.levelGroup, this.hitboxes);
    this.effects = new Effects(this.scene);
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:4;mix-blend-mode:screen';
    document.body.appendChild(this.flashEl);
  }

  // -------------------------------------------------------------------------
  // Level

  private buildLevel(L: Level): void {
    this.levelGroup.clear();
    const b = levelBounds(L);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;

    // Surrounding ground.
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#79b765'));
    outside.rotation.x = -Math.PI / 2; outside.position.y = -0.02; outside.receiveShadow = true;
    this.levelGroup.add(outside);

    // Checkered floor.
    const tile = 2;
    const nx = Math.ceil((2 * L.w) / tile), ny = Math.ceil((2 * L.h) / tile);
    const geo = new THREE.PlaneGeometry(2 * L.w, 2 * L.h, nx, ny).toNonIndexed();
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    const c0 = new THREE.Color(L.floor[0]), c1 = new THREE.Color(L.floor[1]);
    for (let q = 0; q < nx * ny; q++) {
      const i = q % nx, j = Math.floor(q / nx);
      const c = (i + j) % 2 ? c0 : c1;
      for (let k = 0; k < 6; k++) colors.set([c.r, c.g, c.b], (q * 6 + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const floor = new THREE.Mesh(geo, vertexColorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.levelGroup.add(floor);

    // Goal areas get their own floor.
    for (const g of L.goals) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(g.x1 - g.x0, g.y1 - g.y0), mat(TEAM_COLORS[g.team] + ''));
      f.rotation.x = -Math.PI / 2; f.position.set((g.x0 + g.x1) / 2, 0.01, (g.y0 + g.y1) / 2); f.receiveShadow = true;
      (f.material as THREE.MeshLambertMaterial).transparent = true; (f.material as THREE.MeshLambertMaterial).opacity = 0.5;
      this.levelGroup.add(f);
    }
    if (L.id === 'pitch') {
      // Center line & circle.
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 2 * L.h), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
      line.rotation.x = -Math.PI / 2; line.position.y = 0.015; this.levelGroup.add(line);
      const circ = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.05, 40), line.material);
      circ.rotation.x = -Math.PI / 2; circ.position.y = 0.015; this.levelGroup.add(circ);
    }

    for (const w of L.walls) {
      const h = w.kind === 'low' ? 0.55 : w.kind === 'box' ? 1.3 : w.kind === 'net' ? 1.4 : 1.5;
      if (w.kind === 'net') {
        const net = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, h, w.hh * 2), new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
        net.position.set(w.x, h / 2, w.y);
        this.levelGroup.add(net);
        continue;
      }
      const body = w.kind === 'box' ? '#c98b4f' : w.kind === 'low' ? '#e9c27d' : '#d98c5f';
      const top = w.kind === 'box' ? '#e0a96b' : w.kind === 'low' ? '#f6dca6' : '#f0b087';
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, h, w.hh * 2), mat(body));
      m.position.set(w.x, h / 2, w.y); m.castShadow = true; m.receiveShadow = true;
      this.levelGroup.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2 + 0.08, 0.12, w.hh * 2 + 0.08), mat(top));
      cap.position.set(w.x, h + 0.02, w.y); cap.castShadow = true; cap.receiveShadow = true;
      this.levelGroup.add(cap);
      if (w.kind === 'box') {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2 + 0.04, 0.14, w.hh * 2 + 0.04), mat('#9c6534'));
        band.position.set(w.x, h * 0.5, w.y); this.levelGroup.add(band);
      }
    }

    for (const base of L.bases) {
      if (L.id !== 'fortress') continue;
      const r = makeBase(TEAM_COLORS[base.team]);
      r.position.x = base.x; r.position.z = base.y;
      this.levelGroup.add(r);
    }

    // Decorative trees and rocks around the arena.
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = 4 + rnd() * 18;
      const x = cx + Math.cos(a) * (b.x1 - b.x0 + d * 2) / 2, z = cy + Math.sin(a) * (b.y1 - b.y0 + d * 2) / 2;
      if (x > b.x0 - 1.5 && x < b.x1 + 1.5 && z > b.y0 - 1.5 && z < b.y1 + 1.5) continue;
      const g = new THREE.Group();
      if (rnd() < 0.7) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 6), mat('#8a5a3b'));
        trunk.position.y = 0.4; g.add(trunk);
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.9 + rnd() * 0.5, 1.8 + rnd(), 7), mat(rnd() < 0.5 ? '#3f9b5b' : '#4fae62'));
        top.position.y = 1.6; top.castShadow = true; g.add(top);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rnd() * 0.5, 0), mat('#a9b1b8'));
        rock.position.y = 0.2; rock.castShadow = true; g.add(rock);
      }
      g.position.set(x, 0, z); g.rotation.y = rnd() * 6;
      this.levelGroup.add(g);
    }

    // Shadow camera covers the arena.
    const sc = this.sun.shadow.camera;
    const ext = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 6;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 100;
    this.sun.position.set(cx - 12, 30, cy + 14);
    this.sun.target.position.set(cx, 0, cy);
    sc.updateProjectionMatrix();
    this.fitCamera();
  }

  fitCamera(): void {
    const L = getLevel(this.levelId);
    const b = levelBounds(L);
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.fov = this.baseFov;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2;
    const tilt = (62 * Math.PI) / 180; // elevation of the camera
    const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    const target = new THREE.Vector3(cx, 0, cz + 0.6);
    const corners = [
      new THREE.Vector3(b.x0, 0, b.y0), new THREE.Vector3(b.x1, 0, b.y0),
      new THREE.Vector3(b.x0, 0, b.y1), new THREE.Vector3(b.x1, 0, b.y1),
      new THREE.Vector3(b.x0, 1.6, b.y0), new THREE.Vector3(b.x1, 1.6, b.y0),
    ];
    let lo = 5, hi = 200;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      this.camera.position.copy(target).addScaledVector(dir, d);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      const fits = corners.every((c) => { const p = c.clone().project(this.camera); return Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.93; });
      if (fits) hi = d; else lo = d;
    }
    this.camera.position.copy(target).addScaledVector(dir, hi);
    this.camera.lookAt(target);
    this.camBase.copy(this.camera.position);
    this.camTarget.copy(target);
  }

  screenToWorld(cx: number, cy: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, p)) return null;
    return { x: p.x, y: p.z };
  }

  worldToScreen(x: number, h: number, y: number): { x: number; y: number } {
    const p = new THREE.Vector3(x, h, y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  // -------------------------------------------------------------------------
  // Entities

  playerColor(s: GameState, p: Player): string {
    if (isSoloMode(s.cfg.mode)) return PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    if (s.cfg.mode === 'hazard') return p.role === 'overlord' ? '#a77dff' : TEAM_COLORS[0];
    return TEAM_COLORS[p.team % TEAM_COLORS.length];
  }

  private makePlayerView(p: Player, r: number): PlayerView {
    const root = new THREE.Group();
    const ballMat = vertexColorMat.clone();
    const ball = makeBall(p.ball, r);
    ball.material = ballMat;
    ball.position.y = r;
    root.add(ball);
    const head = new THREE.Group();
    head.add(makeEyes(r));
    const hatStack = new THREE.Group();
    hatStack.position.y = r * 1.75;
    head.add(hatStack);
    root.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.05, r * 1.35, 24), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    root.add(ring);
    const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.6, 1), new THREE.MeshLambertMaterial({ color: '#7ff3ff', transparent: true, opacity: 0.3, flatShading: true }));
    shield.position.y = r;
    root.add(shield);
    const speedFx = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 1.6, 24, 1, 0, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    speedFx.rotation.x = -Math.PI / 2; speedFx.position.y = 0.05;
    root.add(speedFx);

    // Wind-up ring: fills while holding throw, until stationary aim starts.
    const windup = new THREE.Mesh(new THREE.RingGeometry(r * 1.5, r * 1.75, 32, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    windup.rotation.x = -Math.PI / 2; windup.position.y = 0.05;
    root.add(windup);

    // Aim indicator: dashed path + arrow head along +x.
    const aim = new THREE.Group();
    const dashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 });
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.12), dashMat);
      d.rotation.x = -Math.PI / 2; d.position.set(0.8 + i * 0.75, 0.06, 0); d.name = 'dash';
      aim.add(d);
    }
    const head2 = new THREE.Mesh(new THREE.CircleGeometry(0.35, 3), dashMat);
    head2.rotation.x = -Math.PI / 2; head2.name = 'tip'; head2.position.y = 0.06;
    aim.add(head2);
    root.add(aim);

    const arcMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 20, 1, -1, 2), arcMat);
    arc.rotation.x = -Math.PI / 2; arc.position.y = 0.6;
    const arcG = new THREE.Group(); arcG.add(arc); root.add(arcG);
    const kickMat = new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const kickArc = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 12, 1, -0.6, 1.2), kickMat);
    kickArc.rotation.x = -Math.PI / 2; kickArc.position.y = 0.3;
    const kickG = new THREE.Group(); kickG.add(kickArc); root.add(kickG);

    const cursor = new THREE.Group();
    const cr = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 24), new THREE.MeshBasicMaterial({ color: '#a77dff', side: THREE.DoubleSide }));
    cr.rotation.x = -Math.PI / 2; cr.position.y = 0.06; cursor.add(cr);
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.12), cr.material);
    cross.rotation.x = -Math.PI / 2; cross.position.y = 0.06; cursor.add(cross);
    const cross2 = cross.clone(); cross2.rotation.z = Math.PI / 2; cursor.add(cross2);
    this.scene.add(cursor);

    const label = document.createElement('div');
    label.className = 'plabel';
    this.labels.appendChild(label);
    this.scene.add(root);
    return { root, ballKind: p.ball, ball, ballMat, head, hatStack, hatCount: -1, ring, shield, aim, arc: arcG as unknown as THREE.Mesh, kickArc: kickG as unknown as THREE.Mesh, cursor, label, lastX: p.x, lastY: p.y, speedFx, windup, slashAnim: -1, slashSide: 1, kickAnim: -1, squash: 0, dustT: 0 };
  }

  /** Hat swing: out from the head to attack range, sweep across the arc
   *  while spinning, then back onto the head. Timed to the sim's windup and
   *  active frames so the hat crosses the target when the hit lands. */
  private animateSwing(v: PlayerView, P: Record<string, number>, r: number, windup: number, active: number, dt: number): void {
    const headY = r * 1.75;
    if (v.slashAnim < 0) {
      v.hatStack.position.set(0, headY, 0);
      v.hatStack.rotation.set(0, 0, 0);
      return;
    }
    v.slashAnim += dt;
    const strike = Math.max(windup + active, 1) / HZ;   // swing across during windup+active
    const total = strike + 0.09;                          // ...then fly home
    const k = v.slashAnim / total;
    if (k >= 1) { v.slashAnim = -1; this.animateSwing(v, P, r, windup, active, 0); return; }
    const half = Math.min(Math.PI, (P.slashArcDeg * Math.PI) / 360);
    const sweep = Math.min(1, v.slashAnim / strike);
    const ease = sweep * sweep * (3 - 2 * sweep);
    const theta = v.slashSide * (-half + 2 * half * ease);
    // Reach: out quickly, hold during the sweep, back to the head at the end.
    const out = v.slashAnim < strike ? Math.min(1, v.slashAnim / (strike * 0.35)) : 1 - (v.slashAnim - strike) / (total - strike);
    const reach = Math.max(0, out) * Math.min(P.slashRange * 0.85, P.slashRange - 0.2);
    const y = headY + (0.75 - headY) * Math.max(0, out);
    v.hatStack.position.set(Math.cos(theta) * reach, y, Math.sin(theta) * reach);
    // Spin flat like a thrown disc, tilted into the swing.
    v.hatStack.rotation.set(0, -v.slashSide * v.slashAnim * 38, 0.25 * v.slashSide * Math.max(0, out));
  }

  /** Kick: the ball lunges forward with a hop and squash, then springs back. */
  private animateKick(v: PlayerView, fx: number, fy: number, r: number, dt: number): void {
    if (v.kickAnim < 0) { v.ball.position.set(0, r, 0); v.head.position.set(0, 0, 0); return; }
    v.kickAnim += dt;
    const dur = 0.3, k = v.kickAnim / dur;
    if (k >= 1) { v.kickAnim = -1; this.animateKick(v, fx, fy, r, 0); v.ball.scale.set(1, 1, 1); return; }
    // Fast lunge out (first 30%), slower spring back.
    const lunge = k < 0.3 ? 1 - Math.pow(1 - k / 0.3, 3) : 1 - Math.pow((k - 0.3) / 0.7, 2) * (3 - 2 * ((k - 0.3) / 0.7));
    const fwd = lunge * 0.75;
    const hop = Math.sin(Math.min(1, k / 0.55) * Math.PI) * 0.28;
    v.ball.position.set(fx * fwd, r + hop, fy * fwd);
    v.head.position.set(fx * fwd, hop, fy * fwd);
    // Stretch along the lunge, squash on the way back.
    const st = k < 0.3 ? 1 + 0.18 * lunge : 1 - 0.12 * Math.sin(((k - 0.3) / 0.7) * Math.PI);
    v.ball.scale.set(st, 2 - st, st);
  }

  private disposePlayerView(v: PlayerView): void {
    this.scene.remove(v.root, v.cursor);
    v.label.remove();
  }

  sync(s: GameState, dt: number): void {
    // During hit-stop everything visual freezes too (except shake/flash).
    this.frozen = s.hitstop > 0;
    if (this.frozen) dt = 0;
    this.time += dt;
    if (s.cfg.level !== this.levelId) { this.levelId = s.cfg.level; this.buildLevel(getLevel(this.levelId)); }
    const P = s.params;
    const r = P.playerRadius;
    const windup = Math.round(P.slashWindup * HZ), active = Math.round(P.slashActive * HZ);

    // --- Players
    const seen = new Set<number>();
    for (const p of s.players) {
      if (!p.active) continue;
      seen.add(p.id);
      let v = this.players.get(p.id);
      if (v && v.ballKind !== p.ball) { this.disposePlayerView(v); v = undefined; }
      if (!v) { v = this.makePlayerView(p, r); this.players.set(p.id, v); }
      const color = this.playerColor(s, p);
      (v.ring.material as THREE.MeshBasicMaterial).color.set(color);
      const overlord = p.role === 'overlord';
      v.cursor.visible = overlord;
      if (overlord) {
        v.cursor.position.set(p.cursorX, 0, p.cursorY);
        v.cursor.rotation.y = this.time * 2;
        ((v.cursor.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(p.bombCd > 0 ? '#777' : color);
      }
      const visible = p.alive && !overlord;
      v.root.visible = visible;
      // Label
      const inCar = p.car >= 0;
      const lp = overlord ? this.worldToScreen(p.cursorX, 0.5, p.cursorY + 1.3) : this.worldToScreen(p.x, p.riding >= 0 ? 3.2 : inCar ? 2.4 : 2.1, p.y);
      v.label.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -100%)`;
      let txt = p.name;
      if (!p.alive && !overlord) txt = s.phase === 'lobby' || p.respawnT > 0 ? `💀 ${p.name}` : '';
      if (overlord) txt = `👁 ${p.name}`;
      else if (p.alive) {
        // Status icons for active (good and bad) power-ups.
        const st = (p.speedT > 0 ? '⚡' : '') + (p.phaseT > 0 ? '👻' : '') + (p.maxHats > 1 ? '🎩' : '') + (p.slowT > 0 ? '🐌' : '') + (p.reverseT > 0 ? '😵‍💫' : '') + (p.invisT > 0 ? '🕶️' : '');
        if (st) txt += ' ' + st;
      }
      v.label.textContent = txt;
      v.label.style.color = color;
      v.label.style.display = (p.alive || overlord || p.respawnT > 0) && txt ? '' : 'none';
      if (!p.alive && !overlord) {
        const dp = this.worldToScreen(p.x, 0.5, p.y);
        v.label.style.transform = `translate(${dp.x}px, ${dp.y}px) translate(-50%, -100%)`;
        v.label.style.opacity = '0.5';
      } else v.label.style.opacity = '1';
      if (!visible) { v.lastX = p.x; v.lastY = p.y; continue; }

      const riding = p.riding >= 0;
      v.root.position.set(p.x, riding ? r * 1.7 : inCar ? 0.55 : 0, p.y);
      v.root.scale.setScalar(riding ? 0.8 : inCar ? 0.7 : 1);
      v.ring.visible = !riding && !inCar;

      // Rolling.
      const dx = p.x - v.lastX, dz = p.y - v.lastY;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4 && dist < 3 && !riding) {
        const axis = new THREE.Vector3(dz, 0, -dx).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axis, dist / r);
        v.ball.quaternion.premultiply(q);
      }
      v.lastX = p.x; v.lastY = p.y;
      const yaw = -Math.atan2(p.fy, p.fx);
      v.head.rotation.y = yaw + (p.reverseT > 0 ? Math.sin(this.time * 9) * 0.5 : 0);
      v.aim.rotation.y = yaw;
      v.arc.rotation.y = yaw;
      v.kickArc.rotation.y = yaw;

      // Hats on head.
      let held = 0;
      for (const h of s.hats) if (h.owner === p.id && h.state === HAT_HELD) held++;
      if (held !== v.hatCount) {
        v.hatStack.clear();
        for (let i = 0; i < held; i++) {
          const hat = makeHat(p.ball);
          hat.scale.setScalar(r * 1.45);
          hat.position.y = i * r * 0.45;
          hat.rotation.z = i ? 0.15 : 0;
          v.hatStack.add(hat);
        }
        v.hatCount = held;
      }
      // Slash: the hat leaves the head and slices across the attack arc.
      const slashing = p.slashT >= 0;
      this.animateSwing(v, P, r, windup, active, dt);
      this.animateKick(v, p.fx, p.fy, r, dt);
      v.arc.visible = slashing && p.slashKind === 0 && p.slashT >= windup;
      v.kickArc.visible = slashing && p.slashKind === 1 && p.slashT >= windup;
      if (v.arc.visible) {
        const arcRange = P.slashRange;
        const a = (P.slashArcDeg * Math.PI) / 180;
        const child = v.arc.children[0] as THREE.Mesh;
        if ((child.userData.key ?? '') !== `${arcRange}:${a}`) {
          child.geometry.dispose();
          child.geometry = new THREE.RingGeometry(r * 0.9, arcRange + P.hitRadius * 0.5, 24, 1, -a / 2, a);
          child.userData.key = `${arcRange}:${a}`;
        }
        (child.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - (p.slashT - windup) / Math.max(1, active + 1));
      }
      if (v.kickArc.visible) {
        const child = v.kickArc.children[0] as THREE.Mesh;
        child.scale.setScalar(P.kickRange);
      }
      // Squash when dashing (the kick lunge sets its own squash).
      const dashing = p.dashT > 0;
      if (v.squash > 0) {
        // Kicked: flatten hard then wobble back.
        v.squash = Math.max(0, v.squash - dt * 3);
        const w = Math.sin((1 - v.squash) * Math.PI * 3) * v.squash * 0.35;
        v.ball.scale.set(1 + w, 1 - w, 1 + w);
      } else if (v.kickAnim < 0) v.ball.scale.set(1, dashing ? 0.85 : 1, 1);

      // Aim indicator.
      const holdF = Math.max(1, Math.round(P.aimHoldTime * HZ));
      const showWindup = p.charging && !p.aiming && p.holdT > 8;
      v.windup.visible = showWindup;
      if (showWindup) {
        const k = Math.min(1, p.holdT / holdF);
        const key = Math.round(k * 40);
        if (v.windup.userData.key !== key) {
          v.windup.geometry.dispose();
          v.windup.geometry = new THREE.RingGeometry(r * 1.5, r * 1.75, 32, 1, Math.PI / 2, Math.max(0.01, k * Math.PI * 2));
          v.windup.userData.key = key;
        }
      }
      v.aim.visible = p.aiming;
      if (p.aiming) {
        const t = Math.min(1, Math.max(0, p.charge));
        const range = P.hatRange + (P.chargedHatRange - P.hatRange) * t;
        for (const c of v.aim.children) {
          if (c.name === 'dash') c.visible = c.position.x < range;
          if (c.name === 'tip') { c.position.x = range + 0.2; }
        }
        ((v.aim.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(t >= 1 ? '#ffd23f' : '#ffffff');
      }

      v.shield.visible = p.shield > 0;
      v.speedFx.visible = p.speedT > 0;
      if (p.speedT > 0) v.speedFx.rotation.z = this.time * 12;
      const phasing = p.phaseT > 0;
      // Invisible: hidden from everyone. Online, your own players stay a faint
      // ghost (nobody else sees your screen); on a shared screen they vanish too.
      const invis = isInvisible(p);
      const own = this.ghostOwn && p.peer === this.localPeer && !p.isBot;
      const ghost = invis ? (own ? 0.22 : 0) : 1;
      if (invis) {
        // A faint dust tell when moving.
        v.dustT -= dt;
        if (v.dustT <= 0 && Math.hypot(p.vx, p.vy) > 2) { v.dustT = 0.35; this.effects.puff(p.x, p.y, '#e8e4da', 2); }
      }
      v.ballMat.transparent = phasing || ghost < 1;
      v.ballMat.opacity = Math.min(ghost, phasing ? 0.55 + 0.2 * Math.sin(this.time * 10) : 1);
      v.root.visible = ghost > 0;
      v.ring.visible = v.ring.visible && !invis;
      v.shield.visible = v.shield.visible && !invis;
      v.speedFx.visible = v.speedFx.visible && !invis;
      if (invis && !own) v.label.style.display = 'none';
      if (invis && !own) { v.lastX = p.x; v.lastY = p.y; continue; }
      for (const h of v.hatStack.children) h.visible = ghost > 0;
      // Spawn protection blink.
      v.ball.visible = !(p.invulnT > 0 && Math.floor(this.time * 12) % 2 === 0);
      v.head.visible = v.ball.visible;
    }
    for (const [id, v] of this.players) if (!seen.has(id)) { this.disposePlayerView(v); this.players.delete(id); }

    // --- Flying / ground hats
    const hatSeen = new Set<number>();
    for (const h of s.hats) {
      if (h.state === HAT_HELD) continue;
      const owner = s.players[h.owner];
      if (!owner) continue;
      hatSeen.add(h.id);
      let hv = this.hats.get(h.id);
      if (!hv) {
        const g = new THREE.Group();
        const hat = makeHat(owner.ball);
        hat.scale.setScalar(r * 1.45);
        g.add(hat);
        this.scene.add(g);
        hv = { g, spin: 0 };
        this.hats.set(h.id, hv);
      }
      const ground = h.state === HAT_GROUND;
      const recall = h.state === HAT_RECALL;
      hv.g.position.set(h.x, ground ? 0.08 : recall ? 1.0 + 0.6 * Math.min(1, h.t / 20) : 0.85, h.y);
      if (ground) {
        hv.g.rotation.set(0.35, hv.g.rotation.y, 0.2);
      } else {
        hv.spin += dt * (recall ? 14 : 24);
        hv.g.rotation.set(0.25 * Math.sin(this.time * 3), hv.spin, 0.2);
      }
    }
    for (const [id, hv] of this.hats) if (!hatSeen.has(id)) { this.scene.remove(hv.g); this.hats.delete(id); }

    // --- Pickups
    const puSeen = new Set<number>();
    for (const q of s.pickups) {
      puSeen.add(q.id);
      let g = this.pickups.get(q.id);
      const look = s.params.hidePowerups ? '?' : q.kind;
      if (g && g.userData.look !== look) { this.scene.remove(g); g = undefined; }
      if (!g) { g = makePickup(q.kind, look === '?'); g.userData.look = look; this.scene.add(g); this.pickups.set(q.id, g); }
      g.position.set(q.x, 0, q.y);
      const gem = g.getObjectByName('gem')!;
      gem.rotation.y = this.time * 2;
      gem.position.y = 0.7 + Math.sin(this.time * 3 + q.id) * 0.12;
      g.scale.setScalar(Math.min(1, q.t / 15));
    }
    for (const [id, g] of this.pickups) if (!puSeen.has(id)) { this.scene.remove(g); this.pickups.delete(id); }

    // --- Cars
    const carSeen = new Set<number>();
    for (const c of s.cars) {
      carSeen.add(c.id);
      let g = this.cars.get(c.id);
      if (!g) { g = makeCar(); this.scene.add(g); this.cars.set(c.id, g); }
      g.position.set(c.x, 0, c.y);
      g.rotation.y = -Math.atan2(c.hy, c.hx);
      g.visible = !(c.driver >= 0 && c.t < 3 * HZ && Math.floor(this.time * 8) % 2 === 0);
      // "Get in" hint over free cars when one of this screen's players is near.
      let hint = g.getObjectByName('hint') as THREE.Sprite | undefined;
      if (!hint) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
        const cx = cv.getContext('2d')!;
        cx.font = '700 40px Fredoka, system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.lineWidth = 10; cx.strokeStyle = '#fff'; cx.lineJoin = 'round';
        cx.strokeText('Slash: drive', 128, 34); cx.fillStyle = '#2b2d42'; cx.fillText('Slash: drive', 128, 34);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        hint = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        hint.name = 'hint'; hint.scale.set(2.4, 0.6, 1); hint.position.y = 2.1; hint.renderOrder = 6;
        g.add(hint);
      }
      hint.visible = c.driver < 0 && s.players.some((p) => p.active && p.alive && !p.isBot && p.peer === this.localPeer && p.car < 0 && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < 3.5 * 3.5);
    }
    for (const [id, g] of this.cars) if (!carSeen.has(id)) { this.scene.remove(g); this.cars.delete(id); }

    // --- Soccer ball
    if (s.ball) {
      if (!this.ballView) {
        this.ballView = makeBall(0, P.ballRadius);
        this.scene.add(this.ballView);
        this.ballLast = { x: s.ball.x, y: s.ball.y };
      }
      const b = s.ball, bv = this.ballView;
      const dx = b.x - this.ballLast.x, dz = b.y - this.ballLast.y, dist = Math.hypot(dx, dz);
      if (dist > 1e-4 && dist < 4) bv.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), dist / P.ballRadius));
      this.ballLast = { x: b.x, y: b.y };
      bv.position.set(b.x, P.ballRadius, b.y);
    } else if (this.ballView) { this.scene.remove(this.ballView); this.ballView = null; }

    // --- Flags
    while (this.flags.length > s.flags.length) this.scene.remove(this.flags.pop()!);
    s.flags.forEach((f, i) => {
      if (!this.flags[i]) { this.flags[i] = makeFlag(TEAM_COLORS[f.team]); this.scene.add(this.flags[i]); }
      const g = this.flags[i];
      const carried = f.carrier >= 0;
      g.position.set(f.x, carried ? 0.9 : 0, f.y);
      g.scale.setScalar(carried ? 0.6 : 1);
      const cloth = g.getObjectByName('cloth')!;
      cloth.rotation.y = Math.sin(this.time * 6 + i) * 0.3;
    });

    // --- Bombs
    const fall = Math.round(P.bombFallTime * HZ);
    const bSeen = new Set<number>();
    for (const b of s.bombs) {
      bSeen.add(b.id);
      let bv = this.bombs.get(b.id);
      if (!bv) {
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3 }));
        shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.04;
        const bomb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('#2b2b33'));
        this.scene.add(shadow, bomb);
        bv = { shadow, bomb };
        this.bombs.set(b.id, bv);
      }
      const t = b.t / fall;
      bv.shadow.position.x = b.x; bv.shadow.position.z = b.y;
      bv.shadow.scale.setScalar(P.bombRadius * (0.3 + 0.7 * t));
      (bv.shadow.material as THREE.MeshBasicMaterial).color.set(t > 0.7 && Math.floor(this.time * 16) % 2 ? '#ff2a2a' : '#000');
      bv.bomb.position.set(b.x, 0.5 + (1 - t) * 14, b.y);
    }
    for (const [id, bv] of this.bombs) if (!bSeen.has(id)) { this.scene.remove(bv.shadow, bv.bomb); this.bombs.delete(id); }

    // --- Trees
    const tSeen = new Set<number>();
    for (const t of s.trees) {
      if (t.hp <= 0) continue;
      tSeen.add(t.id);
      let tv = this.trees.get(t.id);
      if (!tv) {
        const g = makeTree(t.id);
        g.rotation.y = t.id * 1.3;
        this.scene.add(g);
        tv = { g, wobble: 0, wx: 1, wz: 0 };
        this.trees.set(t.id, tv);
      }
      tv.g.position.set(t.x, 0, t.y);
      // Sprout pop-in with a little overshoot.
      const k = Math.min(1, t.grow / 30);
      const sc = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.25 : 1;
      tv.g.scale.setScalar(Math.max(0.01, sc));
      // Damped wobble after a chop, leaning away from the hit.
      tv.wobble = Math.max(0, tv.wobble - dt * 3);
      const lean = Math.sin(this.time * 38) * tv.wobble * 0.18;
      tv.g.rotation.x = tv.wz * lean;
      tv.g.rotation.z = -tv.wx * lean;
    }
    for (const [id, tv] of this.trees) if (!tSeen.has(id)) { this.scene.remove(tv.g); this.trees.delete(id); }
    this.animateFelled(dt, s);

    this.syncHitboxes(s);
  }

  private animateFelled(dt: number, s: GameState): void {
    this.falling = this.falling.filter((f) => {
      f.t += dt;
      // Accelerating topple over ~0.55 s, a small bounce, then sink away.
      const T = 0.55;
      let ang: number;
      if (f.t < T) ang = (Math.PI / 2) * Math.pow(f.t / T, 2.2);
      else ang = Math.PI / 2 - Math.abs(Math.sin((f.t - T) * 14)) * Math.max(0, 0.12 - (f.t - T) * 0.3);
      f.g.quaternion.setFromAxisAngle(f.axis, ang);
      if (!f.landed && f.t >= T) {
        f.landed = true;
        const dir = new THREE.Vector3(0, 0, 0).crossVectors(f.axis, new THREE.Vector3(0, 1, 0));
        const lx = f.x + dir.x * 2.2, lz = f.z + dir.z * 2.2;
        this.effects.burst(lx, 0.5, lz, ['#3f9b5b', '#4fae62', '#5cbf6b'], 24, 6, 0.9);
        this.effects.puff(lx, lz, '#e6dccb', 8);
        this.shake = Math.max(this.shake, 0.35);
      }
      if (f.t > 1.6) f.g.position.y = -(f.t - 1.6) * 2;
      if (f.t > 2.4) { this.scene.remove(f.g); return false; }
      return true;
    });
    this.stumps = this.stumps.filter((st) => {
      st.t += dt;
      if (st.t > st.life) st.g.position.y = -(st.t - st.life) * 0.8;
      if (st.t > st.life + 0.6) { this.scene.remove(st.g); return false; }
      return true;
    });
    void s;
  }

  private syncHitboxes(s: GameState): void {
    this.hitboxes.visible = this.opts.showHitboxes;
    if (!this.opts.showHitboxes) return;
    this.hitboxes.clear();
    const P = s.params;
    const circle = (x: number, y: number, rad: number, color: string) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(rad - 0.03, rad, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.1, y);
      this.hitboxes.add(m);
    };
    for (const p of s.players) {
      if (!p.active || !p.alive) continue;
      circle(p.x, p.y, P.playerRadius, '#00ff00');
      circle(p.x, p.y, P.hitRadius, '#ff0000');
      circle(p.x, p.y, P.slashRange + P.hitRadius, '#ffff00');
    }
    for (const h of s.hats) if (h.state !== HAT_HELD) circle(h.x, h.y, P.hatRadius, '#ff00ff');
  }

  // -------------------------------------------------------------------------
  // Events -> effects

  onEvent(s: GameState, e: SimEvent): void {
    const pc = (id: number) => { const p = s.players[id]; return p ? this.playerColor(s, p) : '#fff'; };
    switch (e.e) {
      case 'kill': {
        const p = s.players[e.victim];
        const cols = p ? BALL_COLORS[p.ball % BALL_COLORS.length] : ['#fff'];
        this.effects.sphere(e.x, e.y, '#ffffff', 1.6, 0.18);
        this.effects.burst(e.x, 0.6, e.y, cols, 34, 9, 1.1);
        this.effects.sparks(e.x, 0.6, e.y, ['#ffffff', '#ffe680', pc(e.victim)], 18, 16, 0.35);
        this.effects.ring(e.x, e.y, pc(e.victim), 3.5, 0.45);
        this.effects.ring(e.x, e.y, '#ffffff', 2, 0.25, 0.6);
        this.shake = Math.max(this.shake, 0.55);
        this.punch = 1;
        this.flash = Math.max(this.flash, 0.45);
        break;
      }
      case 'shield': this.effects.burst(e.x, 0.6, e.y, ['#7ff3ff', '#ffffff'], 18, 6, 0.6); this.effects.ring(e.x, e.y, '#7ff3ff', 2.5); break;
      case 'clash':
        this.effects.sparks(e.x, 0.8, e.y, ['#ffffff', '#ffe680', '#ffd23f'], 26, 18, 0.35);
        this.effects.burst(e.x, 0.8, e.y, ['#ffffff', '#ffe680'], 10, 6, 0.4);
        this.effects.ring(e.x, e.y, '#ffffff', 2.6, 0.22, 0.7);
        this.effects.sphere(e.x, e.y, '#fff6c0', 0.9, 0.12);
        this.shake = Math.max(this.shake, 0.4);
        this.punch = Math.max(this.punch, 0.6);
        this.flash = Math.max(this.flash, 0.25);
        break;
      case 'hatclash':
        this.effects.sparks(e.x, 0.85, e.y, ['#ffffff', '#ffd23f', '#ff9f43'], 22, 15, 0.3);
        this.effects.ring(e.x, e.y, '#ffd23f', 2, 0.2, 0.85);
        this.shake = Math.max(this.shake, 0.3);
        this.punch = Math.max(this.punch, 0.4);
        this.flash = Math.max(this.flash, 0.15);
        break;
      case 'parry':
        this.effects.sparks(e.x, 0.85, e.y, ['#ffffff', '#ffe680'], 14, 12, 0.25);
        this.effects.ring(e.x, e.y, '#ffffff', 1.4, 0.18, 0.85);
        this.shake = Math.max(this.shake, 0.25);
        this.punch = Math.max(this.punch, 0.3);
        break;
      case 'clank': this.effects.puff(e.x, e.y, '#e6dccb', 4); break;
      case 'bounce': this.effects.sparks(e.x, 0.85, e.y, ['#ffffff', '#ffe680'], 7, 8, 0.2); this.shake = Math.max(this.shake, 0.12); break;
      case 'boom':
        this.effects.sphere(e.x, e.y, '#ff9f43', s.params.bombRadius * 1.1, 0.35);
        this.effects.burst(e.x, 0.5, e.y, ['#ff9f43', '#ffd23f', '#555'], 24, 9, 0.8);
        this.shake = Math.max(this.shake, 0.5);
        break;
      case 'pickup': {
        const info = PICKUP_INFO[e.kind] ?? { name: e.kind, icon: '?', color: '#fff' };
        const p = s.players[e.who];
        const px = p ? p.x : e.x, pz = p ? p.y : e.y;
        this.effects.announce(px, 2.4, pz, info.icon, info.name, info.bad ? '#c0392b' : info.color);
        this.effects.ring(e.x, e.y, info.bad ? '#5a3a3a' : '#ffffff', 2.5);
        this.effects.burst(e.x, 1, e.y, info.bad ? ['#5a5a5a', info.color] : ['#ffffff', info.color], 14, 4, 0.5);
        if (info.bad) this.shake = Math.max(this.shake, 0.2);
        break;
      }
      case 'spawn': { const p = s.players[e.who]; if (p) this.effects.ring(p.x, p.y, pc(e.who), 2, 0.5); break; }
      case 'dash': { const p = s.players[e.who]; if (p) this.effects.puff(p.x, p.y, '#ffffff', 5); break; }
      case 'goal': {
        const g = getLevel(s.cfg.level).goals.find((g) => g.team !== e.team);
        if (g) this.effects.burst((g.x0 + g.x1) / 2, 1, 0, ['#ff5a5a', '#4a8dff', '#ffd23f', '#4fd17a', '#ffffff'], 60, 10, 1.4);
        this.shake = 0.4;
        break;
      }
      case 'car': if (e.what === 'spawn') { this.effects.ring(e.x, e.y, '#ffd23f', 3, 0.5); this.effects.puff(e.x, e.y, '#ffffff', 10); } else if (e.what === 'crash') { this.effects.burst(e.x, 0.6, e.y, ['#e8463c', '#222', '#bfe3ff'], 24, 8, 1); this.shake = 0.4; } break;
      case 'slash': {
        const v = this.players.get(e.who);
        if (v) {
          if (e.kind === 0) { v.slashAnim = 0; v.slashSide = -v.slashSide; }
          else v.kickAnim = 0;
        }
        break;
      }
      case 'kick': {
        this.effects.sparks(e.x, 0.6, e.y, ['#ffffff', '#ffe680', '#ffd23f'], 16, 14, 0.3);
        this.effects.ring(e.x, e.y, '#ffffff', 2.4, 0.22, 0.6);
        this.effects.text(e.x, 2.2, e.y, 'BONK!', '#ff9f43', 0.8, 0.8);
        const v = this.players.get(e.target);
        if (v) v.squash = 1;
        this.shake = Math.max(this.shake, 0.45);
        this.punch = Math.max(this.punch, 0.5);
        this.flash = Math.max(this.flash, 0.12);
        break;
      }
      case 'ballkick':
        this.effects.sparks(e.x, 0.6, e.y, ['#ffffff', '#ffe680'], 14, 14, 0.3);
        this.effects.ring(e.x, e.y, '#ffffff', 2, 0.2, 0.5);
        this.shake = Math.max(this.shake, 0.35);
        this.punch = Math.max(this.punch, 0.35);
        break;
      case 'catch': { const p = s.players[e.who]; if (p) this.effects.puff(p.x, p.y, '#ffffff', 3); break; }
      case 'piggy': { const p = s.players[e.who]; if (p) this.effects.ring(p.x, p.y, '#ffffff', 1.5); break; }
      case 'chop': {
        const tv = this.trees.get(e.tree);
        const p = s.players[e.who];
        if (tv) {
          tv.wobble = 1;
          if (p) { const dx = e.x - p.x, dz = e.y - p.y, d = Math.hypot(dx, dz) || 1; tv.wx = dx / d; tv.wz = dz / d; }
        }
        this.effects.burst(e.x, 0.7, e.y, ['#c98b4f', '#e9c99a', '#8a5a3b'], 12, 6, 0.6);
        this.effects.burst(e.x, 2.2, e.y, ['#4fae62', '#5cbf6b'], 6, 2, 0.8);
        this.shake = Math.max(this.shake, 0.15);
        break;
      }
      case 'fell': {
        const old = this.trees.get(e.tree);
        const g = makeTree(e.tree);
        if (old) { g.rotation.copy(old.g.rotation); this.scene.remove(old.g); this.trees.delete(e.tree); }
        const pivot = new THREE.Group();
        pivot.position.set(e.x, 0, e.y);
        pivot.add(g);
        this.scene.add(pivot);
        // Fall away from the chopper: rotate about up x direction.
        const axis = new THREE.Vector3(e.dy, 0, -e.dx).normalize();
        this.falling.push({ g: pivot, axis, t: 0, landed: false, x: e.x, z: e.y });
        const stump = makeStump();
        stump.position.set(e.x, 0, e.y);
        this.scene.add(stump);
        this.stumps.push({ g: stump, t: 0, life: s.params.treeRegrowTime + 0.3 });
        this.effects.burst(e.x, 0.6, e.y, ['#c98b4f', '#e9c99a'], 18, 8, 0.7);
        this.effects.text(e.x, 3.4, e.y, 'TIMBER!', '#8a5a3b', 1.1);
        const p = s.players[e.who];
        if (p && s.phase === 'playing') this.effects.text(p.x, 2.6, p.y, '+1 🌲', this.playerColor(s, p), 0.8, 1.0);
        this.punch = Math.max(this.punch, 0.4);
        break;
      }
      case 'flag': { const f = s.flags.find((f) => f.team === e.team); if (f && e.what === 'score') this.effects.burst(f.homeX, 1, f.homeY, [TEAM_COLORS[(e.team) % 4], '#fff'], 40, 9, 1.2); break; }
    }
  }

  render(dt: number): void {
    this.effects.update(this.frozen ? 0 : dt);
    // Trauma-style shake: offset grows with shake^2 and decays over time.
    this.shake = Math.max(0, this.shake - dt * 1.3);
    const k = this.shake * this.shake * 1.4;
    this.camera.position.set(this.camBase.x + (Math.random() - 0.5) * k, this.camBase.y + (Math.random() - 0.5) * k, this.camBase.z + (Math.random() - 0.5) * k);
    // Camera punch-in: narrow the FOV briefly, ease back out.
    this.punch = Math.max(0, this.punch - dt * 5);
    const fov = this.baseFov - 2.2 * this.punch * this.punch;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.flashEl.style.opacity = this.flash.toFixed(3);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void { if (this.levelId) this.fitCamera(); }

  /** Is the given team mode on (for UI). */
  static teamMode(s: GameState): boolean { return isTeamMode(s.cfg.mode); }
}
