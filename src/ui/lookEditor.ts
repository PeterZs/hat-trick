// Character editor: build a ball + hat from procedural parts, with a live 3D
// preview. Looks are saved per local device (prefs.looks) and sent into the
// game with `setLook`, so everyone in an online game sees them.

import * as THREE from 'three';
import { BALLS, HATS } from '../sim/const';
import {
  BALL_PATTERNS, EYES, HAT_DECOS, HAT_SHAPES, lookFromCode, lookToCode, presetLook, randomLook, sanitizeLook, type Look,
} from '../sim/look';
import { makeBall, makeEyes, makeHat } from '../render/models';
import { escapeHtml } from './settings';

export interface LookEditorOptions {
  look: Look;
  /** Local devices to choose between (whose look this is); the first is selected. */
  devices: { key: string; label: string }[];
  device: string;
  /** Saved look of a device (when switching devices in the editor). */
  lookFor(device: string): Look;
  note?: string;
  onSave(look: Look, device: string): void;
}

const R = 0.55;

export class LookEditor {
  el: HTMLElement;
  private look!: Look;
  private opts: LookEditorOptions | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  private model = new THREE.Group();
  private spin = 0.6;
  private raf = 0;
  private drag: { x: number; spin: number } | null = null;
  private canvas = document.createElement('canvas');

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'look-editor';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    // Typing here must not drive a player or trigger global keys.
    for (const t of ['keydown', 'keyup'] as const) this.el.addEventListener(t, (e) => {
      e.stopPropagation();
      if (t === 'keydown' && (e as KeyboardEvent).key === 'Escape') this.close();
    });
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8899aa', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun, this.model);
    this.camera.position.set(2.9, 1.9, 0);
    this.camera.lookAt(0, 0.9, 0);
    const canvas = this.canvas;
    canvas.className = 'look-preview';
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, spin: this.spin }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.02; });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  get open(): boolean { return this.opts !== null; }

  show(opts: LookEditorOptions): void {
    this.opts = opts;
    this.look = sanitizeLook(opts.look) ?? presetLook(0);
    this.el.style.display = '';
    this.render();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.draw(); };
    cancelAnimationFrame(this.raf);
    loop();
  }

  close(): void {
    this.opts = null;
    this.el.style.display = 'none';
    cancelAnimationFrame(this.raf);
  }

  private render(): void {
    const o = this.opts!, l = this.look;
    const options = (names: string[], sel: number) => names.map((n, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    const colors = (part: 'ball' | 'hat') => l[part].c.map((c, i) => `<input type="color" data-c="${part}.${i}" value="${c}" title="Color ${i + 1}">`).join('');
    this.el.innerHTML = `
      <div class="menu-card look-card">
        <h2>🎨 Customize your ball</h2>
        ${o.note ? `<div class="hint">${escapeHtml(o.note)}</div>` : ''}
        ${o.devices.length > 1 ? `<label class="hint">For <select data-k="device">${o.devices.map((d) => `<option value="${d.key}" ${d.key === o.device ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}</select></label>` : ''}
        <div class="look-grid">
          <div class="look-preview-wrap"><div data-k="canvas"></div>
            <div class="row center"><button class="small" data-k="random">🎲 Surprise me</button></div></div>
          <div class="look-controls">
            <label>Start from <select data-k="preset"><option value="">—</option>${BALLS.map((b, i) => `<option value="${i}">${b} · ${HATS[i]}</option>`).join('')}</select></label>
            <fieldset><legend>Ball</legend>
              <label>Pattern <select data-k="pat">${options(BALL_PATTERNS, l.ball.pat)}</select></label>
              <div class="look-colors">${colors('ball')}</div>
              <label title="Stripe count, dot size… (generic patterns)">Detail <input type="range" data-k="n" min="1" max="8" step="1" value="${l.ball.n}" ${l.ball.pat < BALLS.length ? 'disabled' : ''}></label>
              <label>Eyes <select data-k="eyes">${options(EYES, l.eyes)}</select></label>
            </fieldset>
            <fieldset><legend>Hat</legend>
              <label>Shape <select data-k="shape">${options(HAT_SHAPES, l.hat.shape)}</select></label>
              <div class="look-colors">${colors('hat')}</div>
              <label>Height <input type="range" data-k="h" min="0.5" max="1.8" step="0.05" value="${l.hat.h}"></label>
              <label>Width <input type="range" data-k="w" min="0.7" max="1.4" step="0.05" value="${l.hat.w}"></label>
              <label>On top <select data-k="deco">${options(HAT_DECOS, l.hat.deco)}</select> <input type="color" data-k="dc" value="${l.hat.dc}"></label>
            </fieldset>
            <fieldset><legend>Share</legend>
              <div class="row"><input data-k="code" readonly value="${lookToCode(l)}" style="flex:1;min-width:0;font-size:12px"><button class="small" data-k="copy">Copy</button></div>
              <div class="row"><input data-k="paste" placeholder="Paste a code" style="flex:1;min-width:0;font-size:12px"><button class="small" data-k="load">Load</button></div>
              <div class="err" data-k="err"></div>
            </fieldset>
          </div>
        </div>
        <div class="row center">
          <button data-k="cancel">Cancel</button>
          <button class="primary" data-k="save">Save</button>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(k: string) => this.el.querySelector<T>(`[data-k="${k}"]`)!;
    q('canvas').replaceWith(this.canvas);
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    }
    this.rebuildModel();

    const changed = () => {
      this.look = sanitizeLook(this.look)!;
      q<HTMLInputElement>('code').value = lookToCode(this.look);
      this.rebuildModel();
    };
    const sel = (k: string, set: (v: number) => void) => q<HTMLInputElement>(k).addEventListener('input', (e) => { set(+(e.target as HTMLInputElement).value); changed(); });
    sel('pat', (v) => { this.look.ball.pat = v; q<HTMLInputElement>('n').disabled = v < BALLS.length; });
    sel('n', (v) => { this.look.ball.n = v; });
    sel('eyes', (v) => { this.look.eyes = v; });
    sel('shape', (v) => { this.look.hat.shape = v; });
    sel('h', (v) => { this.look.hat.h = v; });
    sel('w', (v) => { this.look.hat.w = v; });
    sel('deco', (v) => { this.look.hat.deco = v; });
    q<HTMLInputElement>('dc').addEventListener('input', (e) => { this.look.hat.dc = (e.target as HTMLInputElement).value; changed(); });
    for (const el of this.el.querySelectorAll<HTMLInputElement>('[data-c]')) el.addEventListener('input', () => {
      const [part, i] = el.dataset.c!.split('.');
      this.look[part as 'ball' | 'hat'].c[+i] = el.value;
      changed();
    });
    q<HTMLSelectElement>('preset').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v !== '') { this.look = presetLook(+v); this.render(); }
    });
    q('random').addEventListener('click', () => { this.look = randomLook(); this.render(); });
    q('copy').addEventListener('click', () => { void navigator.clipboard?.writeText(lookToCode(this.look)); q<HTMLInputElement>('code').select(); });
    q('load').addEventListener('click', () => {
      const l = lookFromCode(q<HTMLInputElement>('paste').value);
      if (l) { this.look = l; this.render(); } else q('err').textContent = "That doesn't look like a character code.";
    });
    this.el.querySelector<HTMLSelectElement>('[data-k="device"]')?.addEventListener('change', (e) => {
      o.device = (e.target as HTMLSelectElement).value;
      this.look = o.lookFor(o.device);
      this.render();
    });
    q('cancel').addEventListener('click', () => this.close());
    q('save').addEventListener('click', () => { o.onSave(sanitizeLook(this.look)!, o.device); this.close(); });
  }

  private rebuildModel(): void {
    for (const c of [...this.model.children]) {
      this.model.remove(c);
      c.traverse((m) => { if (m instanceof THREE.Mesh && m.userData.preview) m.geometry.dispose(); });
    }
    const ball = makeBall(this.look.ball, R, false);
    ball.userData.preview = true;
    ball.position.y = R;
    const hat = makeHat(this.look.hat);
    hat.scale.setScalar(R * 1.45);
    hat.position.y = R * 1.75;
    this.model.add(ball, makeEyes(R, this.look.eyes, this.look.ball.c[0]), hat);
  }

  private draw(): void {
    if (!this.renderer) return;
    if (!this.drag) this.spin += 0.006;
    this.model.rotation.y = this.spin;
    const c = this.renderer.domElement;
    const w = c.clientWidth || 300, h = c.clientHeight || 300;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio())) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.renderer.render(this.scene, this.camera);
  }
}
