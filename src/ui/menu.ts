// Main menu (mode selection, local / host / join).

import { MODES } from '../sim/const';
import { LEVELS } from '../sim/level';
import type { MatchConfig, ModeId } from '../sim/types';
import type { Prefs } from './prefs';
import { escapeHtml } from './settings';

export interface MenuActions {
  playLocal(cfg: MatchConfig): void;
  host(cfg: MatchConfig): void;
  join(code: string): void;
  openSettings(): void;
}

export class Menu {
  el: HTMLElement;
  private mode: ModeId;
  private level: string;
  constructor(parent: HTMLElement, private prefs: Prefs, private actions: MenuActions) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    parent.appendChild(this.el);
    this.mode = (MODES.find((m) => m.id === prefs.lastMode)?.id ?? 'ffa') as ModeId;
    this.level = MODES.find((m) => m.id === this.mode)!.level;
    this.render();
  }

  show(on: boolean, error = ''): void {
    this.el.style.display = on ? '' : 'none';
    if (on) this.render(error);
  }

  private cfg(): MatchConfig {
    return { mode: this.mode, level: this.level, winScore: this.prefs.winScore };
  }

  private render(error = ''): void {
    const joinCode = new URLSearchParams(location.search).get('join') ?? '';
    this.el.innerHTML = `
      <div class="menu-card">
        <h1 class="title">Boomerang <span>Hat</span></h1>
        <div class="subtitle">Throw your hat. It comes back. Usually.</div>
        <div class="section-title">Game mode</div>
        <div class="modes">
          ${MODES.map((m) => `<button class="mode ${m.id === this.mode ? 'sel' : ''}" data-mode="${m.id}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}
        </div>
        <div class="row">
          <label>Arena <select data-level>${Object.values(LEVELS).map((l) => `<option value="${l.id}" ${l.id === this.level ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>
          <label>First to <input data-win type="number" min="1" max="50" value="${this.prefs.winScore}" style="width:64px"></label>
        </div>
        <div class="row center">
          <button class="primary" data-act="local" style="font-size:20px;padding:14px 26px">▶ Play</button>
          <button class="blue" data-act="host">🌐 Host online</button>
        </div>
        <div class="row center">
          <input data-code placeholder="ROOM CODE" maxlength="5" value="${escapeHtml(joinCode)}" style="width:130px;text-transform:uppercase;letter-spacing:2px;text-align:center">
          <button data-act="join">Join online</button>
          <button data-act="settings">⚙️ Settings</button>
        </div>
        <div class="err">${escapeHtml(error)}</div>
        <div class="section-title">How to play</div>
        <div class="help">
          Join with any device in the lobby; add bots to practice. One hit pops a ball!<br>
          <b>Keyboard + mouse:</b> <kbd>WASD</kbd> roll · <kbd>mouse</kbd> aim · <kbd>Left click</kbd> slash · <kbd>Right click</kbd> (hold) aim &amp; throw hat / recall it ·
          <kbd>Space</kbd> dash · <kbd>E</kbd> ride teammate / enter car · <kbd>Q</kbd>/<kbd>R</kbd> change ball · <kbd>T</kbd> team<br>
          <b>Keyboard 2:</b> arrows · <kbd>.</kbd> slash · <kbd>/</kbd> throw · <kbd>,</kbd> dash · <kbd>M</kbd> ride · <kbd>[</kbd><kbd>]</kbd> ball<br>
          <b>Gamepad:</b> left stick move · right stick aim · <kbd>X</kbd>/<kbd>RB</kbd> slash · <kbd>RT</kbd>/<kbd>B</kbd> throw · <kbd>A</kbd>/<kbd>LB</kbd> dash · <kbd>Y</kbd> ride · d-pad changes ball/team<br>
          <b>Touch:</b> left side to move · drag the THROW button to aim · SLASH, DASH, RIDE buttons.<br>
          Without your hat you can only kick. Slash a flying hat to knock it down. Slash at the same time as someone to clash.
          Hold throw while your hat is on the ground to call it back — it hurts on the way!
        </div>
      </div>`;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.addEventListener('click', () => {
        this.mode = b.dataset.mode as ModeId;
        this.level = MODES.find((m) => m.id === this.mode)!.level;
        this.prefs.lastMode = this.mode;
        this.render();
      });
    }
    this.el.querySelector<HTMLSelectElement>('[data-level]')!.addEventListener('change', (e) => { this.level = (e.target as HTMLSelectElement).value; });
    this.el.querySelector<HTMLInputElement>('[data-win]')!.addEventListener('change', (e) => {
      this.prefs.winScore = Math.max(1, Math.min(50, parseInt((e.target as HTMLInputElement).value) || 5));
    });
    this.el.querySelector('[data-act=local]')!.addEventListener('click', () => this.actions.playLocal(this.cfg()));
    this.el.querySelector('[data-act=host]')!.addEventListener('click', () => this.actions.host(this.cfg()));
    this.el.querySelector('[data-act=settings]')!.addEventListener('click', () => this.actions.openSettings());
    const code = this.el.querySelector<HTMLInputElement>('[data-code]')!;
    this.el.querySelector('[data-act=join]')!.addEventListener('click', () => {
      const c = code.value.trim().toUpperCase();
      if (c.length >= 4) this.actions.join(c);
    });
  }
}
