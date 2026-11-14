// In-game HUD: scores, banners, lobby roster/controls, pause menu.

import { BALLS, HATS, HZ, MODES, isSoloMode, isTeamMode } from '../sim/const';
import { arenaChoices, LEVELS } from '../sim/level';
import type { Command, GameState, MatchConfig, ModeId, Player } from '../sim/types';
import { PLAYER_COLORS, TEAM_COLORS, TEAM_NAMES } from '../render/models';
import { escapeHtml } from './settings';
import { SKILL_NAMES } from '../sim/bot';

export interface HudContext {
  peer: number;
  isHost: boolean;
  online: boolean;
  roomCode: string;
  status: string;
  /** Non-empty while the online game is waiting on someone. */
  waiting: string;
  command(c: Command): void;
  /** Remember a typed name as the default for new local players. */
  rememberName(name: string): void;
  openSettings(): void;
  quit(): void;
}

function color(s: GameState, p: Player): string {
  if (isSoloMode(s.cfg.mode)) return PLAYER_COLORS[p.id % PLAYER_COLORS.length];
  if (s.cfg.mode === 'hazard') return p.role === 'overlord' ? '#a77dff' : TEAM_COLORS[0];
  return TEAM_COLORS[p.team % TEAM_COLORS.length];
}

function winnerName(s: GameState, team: number): string {
  if (team < 0) return 'Nobody';
  if (team >= 100) return s.players[team - 100]?.name ?? '???';
  if (s.cfg.mode === 'hazard') return team === 0 ? 'Runners' : 'Overlords';
  return TEAM_NAMES[team] + ' team';
}

export class Hud {
  el: HTMLElement;
  private top: HTMLElement;
  private scores: HTMLElement;
  private banner: HTMLElement;
  private timer: HTMLElement;
  private lobby: HTMLElement;
  private net: HTMLElement;
  private waiting: HTMLElement;
  private pause: HTMLElement;
  private lobbyKey = '';
  private scoreKey = '';
  private lobbyCollapsed = false;
  paused = false;
  get pauseEl(): HTMLElement { return this.pause; }

  constructor(parent: HTMLElement, private ctx: () => HudContext) {
    this.el = document.createElement('div');
    parent.appendChild(this.el);
    this.el.innerHTML = `
      <div class="topbar">
        <button class="iconbtn" data-act="menu" title="Menu (Esc)">☰</button>
        <div class="scores"></div>
        <button class="iconbtn" data-act="settings" title="Settings (\`)">⚙️</button>
      </div>
      <div class="banner"></div>
      <div class="timer"></div>
      <div class="lobby"></div>
      <div class="netstatus"></div>
      <div class="waiting"></div>
      <div class="pause" style="display:none"></div>`;
    this.top = this.el.querySelector('.topbar')!;
    this.scores = this.el.querySelector('.scores')!;
    this.banner = this.el.querySelector('.banner')!;
    this.timer = this.el.querySelector('.timer')!;
    this.lobby = this.el.querySelector('.lobby')!;
    this.net = this.el.querySelector('.netstatus')!;
    this.waiting = this.el.querySelector('.waiting')!;
    this.pause = this.el.querySelector('.pause')!;
    this.el.querySelector('[data-act=menu]')!.addEventListener('click', () => this.togglePause());
    this.el.querySelector('[data-act=settings]')!.addEventListener('click', () => this.ctx().openSettings());
  }

  show(on: boolean): void {
    this.el.style.display = on ? '' : 'none';
    if (!on) { this.paused = false; this.pause.style.display = 'none'; this.lobbyKey = ''; this.scoreKey = ''; }
  }

  togglePause(force?: boolean): void {
    this.paused = force ?? !this.paused;
    this.pause.style.display = this.paused ? '' : 'none';
    if (!this.paused) return;
    const c = this.ctx();
    this.pause.innerHTML = `<div class="menu-card">
      <h2 style="margin:0;text-align:center">Menu</h2>
      <div class="hint" style="text-align:center">The game keeps running${c.online ? ' (online)' : ''}.</div>
      <button class="primary" data-p="resume">Resume</button>
      ${c.isHost ? '<button data-p="lobby">Back to lobby</button>' : ''}
      <button data-p="bot">+ Add bot</button>
      <button data-p="rmbot">− Remove bot</button>
      <button data-p="settings">⚙️ Settings</button>
      <button data-p="quit">Quit to main menu</button>
    </div>`;
    this.pause.querySelector('[data-p=resume]')!.addEventListener('click', () => this.togglePause(false));
    this.pause.querySelector('[data-p=lobby]')?.addEventListener('click', () => { c.command({ t: 'lobby' }); this.togglePause(false); });
    this.pause.querySelector('[data-p=bot]')!.addEventListener('click', () => c.command({ t: 'addBot' }));
    this.pause.querySelector('[data-p=rmbot]')!.addEventListener('click', () => c.command({ t: 'removeBot' }));
    this.pause.querySelector('[data-p=settings]')!.addEventListener('click', () => { c.openSettings(); this.togglePause(false); });
    this.pause.querySelector('[data-p=quit]')!.addEventListener('click', () => { this.togglePause(false); c.quit(); });
  }

  update(s: GameState): void {
    const c = this.ctx();
    this.net.textContent = c.online ? c.status : '';
    if (this.waiting.textContent !== c.waiting) this.waiting.textContent = c.waiting;
    this.waiting.style.display = c.waiting ? '' : 'none';
    this.updateScores(s);
    this.updateBanner(s);
    this.updateLobby(s, c);
  }

  private updateScores(s: GameState): void {
    const mode = s.cfg.mode;
    let html = '';
    if (s.phase === 'lobby') {
      html = `<div class="chip">${MODES.find((m) => m.id === mode)?.name} · Lobby</div>`;
    } else if (mode === 'golf' && s.golf) {
      const g = s.golf;
      html = `<div class="chip">⛳ Hole ${g.hole + 1}</div>` + g.balls.map((b) =>
        `<div class="chip ${b.sunk ? '' : ''}"><span class="dot" style="background:${TEAM_COLORS[b.team]}"></span>${TEAM_NAMES[b.team]} ${s.scores[b.team]} · ${b.strokes} stroke${b.strokes === 1 ? '' : 's'}${b.sunk ? ' ✅' : ''}</div>`).join('');
    } else if (isSoloMode(mode)) {
      const icon = mode === 'lumber' ? ' 🌲' : '';
      html = s.players.filter((p) => p.active).map((p) =>
        `<div class="chip ${p.alive ? '' : 'dead'}"><span class="dot" style="background:${color(s, p)}"></span>${escapeHtml(p.name)} ${s.scores[p.id]}${icon}</div>`).join('');
    } else if (mode === 'hazard') {
      html = `<div class="chip"><span class="dot" style="background:${TEAM_COLORS[0]}"></span>Runners ${s.scores[0]}</div>
              <div class="chip"><span class="dot" style="background:#a77dff"></span>Overlords ${s.scores[1]}</div>`;
    } else {
      const teams = [...new Set(s.players.filter((p) => p.active).map((p) => (mode === 'ctf' || mode === 'soccer') ? p.team % 2 : p.team))].sort();
      if (teams.length < 2 && (mode === 'ctf' || mode === 'soccer')) teams.splice(0, teams.length, 0, 1);
      html = teams.map((t) => `<div class="chip"><span class="dot" style="background:${TEAM_COLORS[t]}"></span>${TEAM_NAMES[t]} ${s.scores[t]}</div>`).join('');
    }
    if (s.phase !== 'lobby' && mode !== 'lumber') html += `<div class="chip" style="opacity:.7">to ${s.cfg.winScore}</div>`;
    if (s.cfg.level === 'random') html += `<div class="chip" style="opacity:.7">🎲 ${LEVELS[s.arena]?.name ?? ''}</div>`;
    if (html !== this.scoreKey) { this.scoreKey = html; this.scores.innerHTML = html; }
  }

  private updateBanner(s: GameState): void {
    let text = '';
    const t = s.phaseT / HZ;
    switch (s.phase) {
      case 'countdown': {
        const left = Math.ceil(s.params.countdownTime - t);
        text = left > 0 ? String(left) : '';
        if (s.round === 1 && left > 0) text += `<small>${MODES.find((m) => m.id === s.cfg.mode)?.name}</small>`;
        break;
      }
      case 'playing': if (t < 0.7) text = 'GO!'; break;
      case 'roundOver':
        text = s.cfg.mode === 'soccer' ? `GOAL!<small>${winnerName(s, s.lastWinner)}</small>` : s.lastWinner < 0 ? (s.cfg.mode === 'golf' ? 'Tied hole!' : 'Draw!') : `${escapeHtml(winnerName(s, s.lastWinner))}<small>wins the ${s.cfg.mode === 'golf' ? 'hole' : 'round'}</small>`;
        break;
      case 'matchOver':
        text = `${s.lastWinner < 0 ? "🤝 It's a tie!" : `🏆 ${escapeHtml(winnerName(s, s.lastWinner))} wins!`}<small>back to lobby in ${Math.max(0, Math.ceil(8 - t))}</small>`;
        break;
    }
    if (this.banner.innerHTML !== text) this.banner.innerHTML = text;
    const showTimer = (s.cfg.mode === 'hazard' || s.cfg.mode === 'lumber') && (s.phase === 'playing' || s.phase === 'countdown');
    this.timer.textContent = showTimer ? `⏱ ${Math.ceil(s.timer / HZ)}` : '';
  }

  private updateLobby(s: GameState, c: HudContext): void {
    const show = s.phase === 'lobby';
    this.lobby.style.display = show ? '' : 'none';
    if (!show) { this.lobbyKey = ''; return; }
    const roster = s.players.filter((p) => p.active);
    const key = JSON.stringify([s.cfg, s.arena, roster.map((p) => [p.id, p.name, p.ball, p.team, p.role, p.peer, p.device, p.skill]), c.isHost, c.roomCode, c.peer, this.lobbyCollapsed]);
    if (key === this.lobbyKey) return;
    // Don't rebuild under someone who is typing a name; refresh after they finish.
    if (this.lobby.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'text') return;
    this.lobbyKey = key;
    const mode = s.cfg.mode;
    const teamMode = isTeamMode(mode) && mode !== 'hazard';
    const nTeams = mode === 'teams' ? 4 : 2;
    const mine = (p: Player) => p.peer === c.peer && !p.isBot;
    const canEdit = (p: Player) => mine(p) || p.isBot;
    const link = c.roomCode ? `${location.origin}${location.pathname}?join=${c.roomCode}` : '';

    if (this.lobbyCollapsed) {
      this.lobby.innerHTML = `<h3>Lobby · ${roster.length} player${roster.length === 1 ? "" : "s"} <span class="grow"></span>
        <button class="primary small" data-l="start">Start ▶</button>
        <button class="small" data-l="expand">▲</button></h3>`;
    } else {
      this.lobby.innerHTML = `
        <h3>Lobby
          ${c.roomCode ? `<span class="hint">room</span><span class="code">${c.roomCode}</span><button class="small" data-l="copy">Copy link</button>` : ''}
          <span class="grow"></span>
          <button class="small" data-l="collapse" title="Collapse">▼</button>
        </h3>
        <div class="row" style="margin-top:4px">
            <select data-l="mode">${MODES.map((m) => `<option value="${m.id}" ${m.id === mode ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
            <select data-l="level"><option value="random" ${s.cfg.level === 'random' ? 'selected' : ''}>🎲 Random</option>${arenaChoices(mode, MODES.find((m) => m.id === mode)?.level).map((l) => `<option value="${l.id}" ${l.id === s.cfg.level ? 'selected' : ''}>${l.name}</option>`).join('')}</select>${s.cfg.level === 'random' ? `<span class="hint">now: ${LEVELS[s.arena]?.name ?? s.arena}</span>` : ''}
            ${mode === 'lumber' ? '' : `<label class="hint">to <input data-l="win" type="number" min="1" max="50" value="${s.cfg.winScore}" style="width:56px"></label>`}
            ${mode === 'cars' ? `<label class="hint">🚗 cars <input data-l="cars" type="number" min="1" max="8" value="${s.cfg.cars ?? 2}" style="width:52px"></label>` : ''}
          <span class="grow"></span>
          <button class="small" data-l="bot">+ Bot</button>
          <button class="small" data-l="rmbot">− Bot</button>
          <button class="primary" data-l="start" ${roster.length === 0 ? 'disabled' : ''}>Start ▶</button>
        </div>
        <div class="pcards">
          ${roster.map((p) => `
            <div class="pcard" style="border-color:${color(s, p)}">
              <span class="dot" style="width:12px;height:12px;border-radius:50%;background:${color(s, p)}"></span>
              ${mine(p) ? `<input class="nm-input" data-name="${p.id}" type="text" maxlength="16" value="${escapeHtml(p.name)}" title="Your name" size="8">`
                : `<span class="nm">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${p.peer !== c.peer && !p.isBot ? ' 🌐' : ''}</span>`}
              ${canEdit(p) ? `<select data-ball="${p.id}">${BALLS.map((b, i) => `<option value="${i}" ${i === p.ball ? 'selected' : ''}>${b} · ${HATS[i]}</option>`).join('')}</select>`
                : `<span class="hint">${BALLS[p.ball]}</span>`}
              ${teamMode ? (canEdit(p) ? `<select data-team="${p.id}">${TEAM_NAMES.slice(0, nTeams).map((t, i) => `<option value="${i}" ${i === p.team % nTeams ? 'selected' : ''}>${t}</option>`).join('')}</select>` : `<span class="hint">${TEAM_NAMES[p.team % nTeams]}</span>`) : ''}
              ${p.isBot ? `<select data-skill="${p.id}" title="Bot difficulty">${SKILL_NAMES.map((n, i) => `<option value="${i}" ${i === p.skill ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
              ${mode === 'hazard' ? (canEdit(p) ? `<select data-role="${p.id}"><option value="fighter" ${p.role === 'fighter' ? 'selected' : ''}>Runner</option><option value="overlord" ${p.role === 'overlord' ? 'selected' : ''}>Overlord</option></select>` : `<span class="hint">${p.role === 'overlord' ? 'Overlord' : 'Runner'}</span>`) : ''}
              ${canEdit(p) ? `<button class="small" data-leave="${p.id}" title="Leave">✕</button>` : ''}
            </div>`).join('') || '<span class="hint">No players yet.</span>'}
        </div>
        <div class="joinhints">
          <span><b>Join:</b></span>
          <span>⌨️🖱 Enter / click</span><span>⌨️ arrows: press <b>.</b></span><span>🎮 press A (Start = start match / menu)</span><span>📱 tap JOIN</span>
          <span>· leave: Backspace / Del / Select</span>
        </div>`;
    }

    const q = <T extends HTMLElement>(sel: string) => this.lobby.querySelector<T>(sel);
    q('[data-l=collapse]')?.addEventListener('click', () => { this.lobbyCollapsed = true; this.lobbyKey = ''; });
    q('[data-l=expand]')?.addEventListener('click', () => { this.lobbyCollapsed = false; this.lobbyKey = ''; });
    q('[data-l=copy]')?.addEventListener('click', () => { void navigator.clipboard?.writeText(link); });
    const cfgFrom = (): MatchConfig => ({
      mode: (q<HTMLSelectElement>('[data-l=mode]')?.value ?? mode) as ModeId,
      level: q<HTMLSelectElement>('[data-l=level]')?.value ?? s.cfg.level,
      winScore: Math.max(1, parseInt(q<HTMLInputElement>('[data-l=win]')?.value ?? '') || s.cfg.winScore),
      cars: Math.max(1, Math.min(8, parseInt(q<HTMLInputElement>('[data-l=cars]')?.value ?? '') || s.cfg.cars || 2)),
    });
    q('[data-l=mode]')?.addEventListener('change', () => {
      const cfg = cfgFrom();
      cfg.level = MODES.find((m) => m.id === cfg.mode)!.level;
      c.command({ t: 'lobby', cfg });
    });
    q('[data-l=level]')?.addEventListener('change', () => c.command({ t: 'lobby', cfg: cfgFrom() }));
    q('[data-l=win]')?.addEventListener('change', () => c.command({ t: 'lobby', cfg: cfgFrom() }));
    q('[data-l=cars]')?.addEventListener('change', () => c.command({ t: 'lobby', cfg: cfgFrom() }));
    for (const b of this.lobby.querySelectorAll('[data-l=start]')) b.addEventListener('click', () => c.command({ t: 'start', cfg: s.cfg }));
    q('[data-l=bot]')?.addEventListener('click', () => c.command({ t: 'addBot' }));
    q('[data-l=rmbot]')?.addEventListener('click', () => c.command({ t: 'removeBot' }));

    const byId = (id: string) => s.players[parseInt(id)];
    // Bots are controlled through commands from the host; they are addressed by device key on peer 0.
    for (const el of this.lobby.querySelectorAll<HTMLSelectElement>('[data-ball]')) el.addEventListener('change', () => {
      const p = byId(el.dataset.ball!); c.command({ t: 'setBall', device: p.device, ball: parseInt(el.value) });
    });
    for (const el of this.lobby.querySelectorAll<HTMLSelectElement>('[data-team]')) el.addEventListener('change', () => {
      const p = byId(el.dataset.team!); c.command({ t: 'setTeam', device: p.device, team: parseInt(el.value) });
    });
    for (const el of this.lobby.querySelectorAll<HTMLInputElement>('[data-name]')) {
      const commit = () => {
        const p = byId(el.dataset.name!);
        const name = el.value.trim().slice(0, 16);
        if (p && name && name !== p.name) { c.command({ t: 'setName', device: p.device, name }); c.rememberName(name); }
        this.lobbyKey = '';
      };
      el.addEventListener('change', commit);
      el.addEventListener('blur', () => { this.lobbyKey = ''; });
      el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
    }
    for (const el of this.lobby.querySelectorAll<HTMLSelectElement>('[data-skill]')) el.addEventListener('change', () => {
      const p = byId(el.dataset.skill!); c.command({ t: 'setSkill', device: p.device, skill: parseInt(el.value) });
    });
    for (const el of this.lobby.querySelectorAll<HTMLSelectElement>('[data-role]')) el.addEventListener('change', () => {
      const p = byId(el.dataset.role!); c.command({ t: 'setRole', device: p.device, role: el.value as 'fighter' | 'overlord' });
    });
    for (const el of this.lobby.querySelectorAll<HTMLElement>('[data-leave]')) el.addEventListener('click', () => {
      const p = byId(el.dataset.leave!); c.command({ t: 'leave', device: p.device });
    });
  }
}
