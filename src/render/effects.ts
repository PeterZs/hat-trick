// Render-only particle effects (never affect the simulation).

import * as THREE from 'three';

interface Particle { m: THREE.Mesh | THREE.Sprite; vx: number; vy: number; vz: number; life: number; max: number; spin: number; grow: number; streak?: boolean; float?: boolean; announce?: boolean }

const chunkGeo = new THREE.TetrahedronGeometry(0.14, 0);
const puffGeo = new THREE.IcosahedronGeometry(0.22, 0);
const ringGeo = new THREE.RingGeometry(0.85, 1, 28);
const sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);

export class Effects {
  private parts: Particle[] = [];
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  constructor(private scene: THREE.Scene) {}

  private material(color: string): THREE.MeshBasicMaterial {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true }); this.mats.set(color, m); }
    return m;
  }

  burst(x: number, y: number, z: number, colors: string[], n: number, speed: number, life = 0.7, geo: THREE.BufferGeometry = chunkGeo): void {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, this.material(colors[i % colors.length]).clone());
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.scene.add(m);
      this.parts.push({ m, vx: Math.cos(a) * sp, vy: up * sp * 1.2 + 1, vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.6), max: life, spin: (Math.random() - 0.5) * 20, grow: 0 });
    }
  }

  /** Fast, stretched sparks that fly outward roughly horizontally. */
  sparks(x: number, y: number, z: number, colors: string[], n: number, speed: number, life = 0.3): void {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sparkGeo, this.material(colors[i % colors.length]).clone());
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, sp = speed * (0.5 + Math.random() * 0.8);
      this.scene.add(m);
      this.parts.push({ m, vx: Math.cos(a) * sp, vy: (Math.random() - 0.3) * sp * 0.4, vz: Math.sin(a) * sp, life: life * (0.5 + Math.random() * 0.7), max: life, spin: 0, grow: 0, streak: true });
    }
  }

  /** Floating text that pops, rises and fades (e.g. "TIMBER!"). */
  text(x: number, y: number, z: number, text: string, color: string, size = 1, life = 1.1): void {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.font = '700 84px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 14; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round';
    ctx.strokeText(text, 256, 68);
    ctx.fillStyle = color; ctx.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    m.renderOrder = 10;
    m.position.set(x, y, z);
    m.scale.set(4 * size, 1 * size, 1);
    m.userData.size = size;
    this.scene.add(m);
    this.parts.push({ m, vx: 0, vy: 1.6, vz: 0, life, max: life, spin: 0, grow: 0, float: true });
  }

  /** Power-up announcement: big icon + name that scales up while fading out. */
  announce(x: number, y: number, z: number, icon: string, name: string, color: string, life = 1.3): void {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 320;
    const ctx = c.getContext('2d')!;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '150px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.fillText(icon, 256, 110);
    ctx.font = '700 72px Fredoka, system-ui, sans-serif';
    ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.strokeStyle = '#ffffff';
    ctx.strokeText(name, 256, 255);
    ctx.fillStyle = color; ctx.fillText(name, 256, 255);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    m.renderOrder = 11;
    m.position.set(x, y, z);
    m.scale.set(0.1, 0.0625, 1);
    this.scene.add(m);
    this.parts.push({ m, vx: 0, vy: 0.9, vz: 0, life, max: life, spin: 0, grow: 0, float: true, announce: true });
  }

  puff(x: number, z: number, color = '#ffffff', n = 6): void {
    this.burst(x, 0.3, z, [color], n, 2, 0.45, puffGeo);
  }

  ring(x: number, z: number, color: string, size = 2, life = 0.4, y = 0.05): void {
    const m = new THREE.Mesh(ringGeo, this.material(color).clone());
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.setScalar(0.2);
    (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.scene.add(m);
    this.parts.push({ m, vx: 0, vy: 0, vz: 0, life, max: life, spin: 0, grow: size / life });
  }

  sphere(x: number, z: number, color: string, size: number, life = 0.35): void {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.material(color).clone());
    m.position.set(x, 0.5, z); m.scale.setScalar(0.3);
    this.scene.add(m);
    this.parts.push({ m, vx: 0, vy: 0, vz: 0, life, max: life, spin: 0, grow: size / life });
  }

  update(dt: number): void {
    this.parts = this.parts.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.m);
        const mm = p.m.material as THREE.Material & { map?: THREE.Texture | null };
        if (p.float) mm.map?.dispose();
        mm.dispose();
        // Sprites share one internal geometry; never dispose it.
        if (!p.float && p.m.geometry !== chunkGeo && p.m.geometry !== puffGeo && p.m.geometry !== ringGeo && p.m.geometry !== sparkGeo) p.m.geometry.dispose();
        return false;
      }
      if (p.announce) {
        // Pop in with overshoot, keep growing slowly, fade out at the end.
        const age = p.max - p.life, k = age / p.max;
        const pop = k < 0.15 ? (k / 0.15) * 1.25 : 1.25 - 0.25 * Math.min(1, (k - 0.15) / 0.1);
        const sz = 3.2 * (pop + k * 0.9);
        p.m.scale.set(sz, sz * 0.625, 1);
        p.m.position.y += p.vy * dt;
        (p.m.material as THREE.SpriteMaterial).opacity = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45);
        return true;
      } else if (p.float) {
        p.m.position.y += p.vy * dt; p.vy *= 0.96;
        const age = p.max - p.life, sz = (p.m.userData.size as number) * (1 + 0.5 * Math.max(0, 1 - age * 8));
        p.m.scale.set(4 * sz, sz, 1);
      } else if (p.streak) {
        p.vx *= 0.9; p.vz *= 0.9; p.vy -= 6 * dt;
        p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        p.m.lookAt(p.m.position.x + p.vx, p.m.position.y + p.vy, p.m.position.z + p.vz);
        p.m.scale.set(1, 1, Math.max(0.2, Math.min(2.5, sp / 6)));
      } else if (p.grow) {
        p.m.scale.setScalar(p.m.scale.x + p.grow * dt);
      } else {
        p.vy -= 14 * dt;
        p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        if (p.m.position.y < 0.08) { p.m.position.y = 0.08; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }
        p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt * 0.7;
      }
      (p.m.material as THREE.MeshBasicMaterial | THREE.SpriteMaterial).opacity = Math.min(1, (p.life / p.max) * 2);
      return true;
    });
  }
}
