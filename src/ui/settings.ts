// Non-modal settings panel: developer gameplay parameters + local prefs.

import { DEFAULT_PARAMS, PARAM_DEFS, cloneParams, type Params } from '../sim/params';
import { loadParams, savePrefs, saveParams, type Prefs } from './prefs';
import { soundTest } from '../audio/sfx';

export class SettingsPanel {
  el: HTMLElement;
  open = false;
  params: Params = loadParams();
  readOnly = false;
  onParams: (p: Params) => void = () => {};
  onPrefs: (p: Prefs) => void = () => {};

  constructor(parent: HTMLElement, public prefs: Prefs) {
    this.el = document.createElement('div');
    this.el.className = 'settings';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    // Keep game keys from triggering while typing in the panel, but let the game keep running.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.style.display = this.open ? '' : 'none';
    if (this.open) this.render();
  }

  /** Show the params currently in effect (e.g. the host's when we're a client). */
  setLive(params: Params, readOnly: boolean): void {
    const changed = readOnly !== this.readOnly || (readOnly && JSON.stringify(params) !== JSON.stringify(this.params));
    this.readOnly = readOnly;
    if (readOnly) this.params = cloneParams(params);
    if (changed && this.open) this.render();
  }

  private render(): void {
    const groups = new Map<string, typeof PARAM_DEFS>();
    for (const d of PARAM_DEFS) { if (!groups.has(d.group)) groups.set(d.group, []); groups.get(d.group)!.push(d); }
    const pf = this.prefs;
    this.el.innerHTML = `
      <header><b>⚙️ Settings</b><button class="small" data-act="close">✕</button></header>
      <div class="body">
        <details open><summary>Player</summary>
          <div class="prow"><label>Name</label><input data-pref="name" type="text" maxlength="14" value="${escapeHtml(pf.name)}" style="grid-column:1/3"></div>
          <div class="prow"><label>Volume <span>${Math.round(pf.volume * 100)}%</span></label><input data-pref="volume" type="range" min="0" max="1" step="0.05" value="${pf.volume}" style="grid-column:1/3"></div>
          <div class="prow"><button class="small" data-act="soundtest" style="grid-column:1/3">🔊 Sound test (plays every effect)</button></div>
          <div class="prow"><label><span>Show hitboxes</span><input data-pref="showHitboxes" type="checkbox" ${pf.showHitboxes ? 'checked' : ''}></label></div>
          <div class="prow"><label>Online input delay (frames) <span>${pf.inputDelay}</span></label><input data-pref="inputDelay" type="range" min="0" max="6" step="1" value="${pf.inputDelay}" style="grid-column:1/3"></div>
        </details>
        <div class="note">${this.readOnly ? 'Gameplay parameters are controlled by the host.' : 'Gameplay parameters apply immediately and are remembered in this browser. Download to update the defaults (src/sim/defaultParams.json).'}</div>
        <div class="row" style="margin:8px 0">
          <button class="small gold" data-act="download">⬇ Download params</button>
          <button class="small" data-act="reset" ${this.readOnly ? 'disabled' : ''}>Reset all</button>
        </div>
        ${[...groups.entries()].map(([g, defs]) => `
          <details ${g === 'Movement' || g === 'Throw' || g === 'Melee' || g === 'Dash' ? 'open' : ''}><summary>${g}</summary>
            ${defs.map((d) => {
              const v = this.params[d.key];
              const changed = v !== DEFAULT_PARAMS[d.key];
              if (d.bool) return `<div class="prow">
                <label class="${changed ? 'changed' : ''}" title="${d.key}"><span>${d.label}</span>
                  <input type="checkbox" data-bool="${d.key}" ${v ? 'checked' : ''} ${this.readOnly ? 'disabled' : ''}></label>
              </div>`;
              return `<div class="prow">
                <label class="${changed ? 'changed' : ''}" title="${d.key}"><span>${d.label}</span>${changed ? `<a href="#" data-reset="${d.key}" title="Reset to ${DEFAULT_PARAMS[d.key]}">↺</a>` : ''}</label>
                <input type="range" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" ${this.readOnly ? 'disabled' : ''}>
                <input type="number" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" ${this.readOnly ? 'disabled' : ''}>
              </div>`;
            }).join('')}
          </details>`).join('')}
      </div>`;

    this.el.querySelector('[data-act=close]')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelector('[data-act=download]')!.addEventListener('click', () => this.download());
    this.el.querySelector('[data-act=soundtest]')!.addEventListener('click', () => soundTest());
    this.el.querySelector('[data-act=reset]')!.addEventListener('click', () => { this.params = cloneParams(DEFAULT_PARAMS); this.commit(); this.render(); });
    for (const a of this.el.querySelectorAll<HTMLElement>('[data-reset]')) {
      a.addEventListener('click', (e) => { e.preventDefault(); this.params[a.dataset.reset!] = DEFAULT_PARAMS[a.dataset.reset!]; this.commit(); this.render(); });
    }
    for (const inp of this.el.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        this.params[inp.dataset.key!] = v;
        for (const other of this.el.querySelectorAll<HTMLInputElement>(`input[data-key="${inp.dataset.key}"]`)) if (other !== inp) other.value = String(v);
        const label = inp.parentElement!.querySelector('label')!;
        label.classList.toggle('changed', v !== DEFAULT_PARAMS[inp.dataset.key!]);
        this.commit();
      });
      inp.addEventListener('change', () => this.render());
    }
    for (const inp of this.el.querySelectorAll<HTMLInputElement>('input[data-bool]')) {
      inp.addEventListener('change', () => { this.params[inp.dataset.bool!] = inp.checked ? 1 : 0; this.commit(); this.render(); });
    }
    for (const inp of this.el.querySelectorAll<HTMLInputElement>('input[data-pref]')) {
      inp.addEventListener('input', () => {
        const k = inp.dataset.pref as keyof Prefs;
        const val = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? parseFloat(inp.value) : inp.value;
        (this.prefs as unknown as Record<string, unknown>)[k] = val;
        savePrefs(this.prefs);
        this.onPrefs(this.prefs);
        const span = inp.parentElement!.querySelector('label span');
        if (span && k === 'volume') span.textContent = Math.round(this.prefs.volume * 100) + '%';
        if (span && k === 'inputDelay') span.textContent = String(this.prefs.inputDelay);
      });
    }
  }

  private commit(): void {
    if (this.readOnly) return;
    saveParams(this.params);
    this.onParams(cloneParams(this.params));
  }

  private download(): void {
    const blob = new Blob([JSON.stringify(cloneParams(this.params), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'defaultParams.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
