// Rollback netcode (GGPO-style) over a star-topology NetLink.
//
// Every peer sends one FrameMsg per sim frame containing the inputs of all of
// its local devices plus any Commands (join/leave/start...), scheduled
// `inputDelay` frames in the future. Missing remote inputs are predicted by
// repeating that peer's last known inputs. When a real message arrives that
// differs from what we predicted, we restore the snapshot taken before that
// frame and re-simulate up to the present.
//
// Membership: the host decides at which frame a peer starts/stops being
// required, and announces it inside its own FrameMsg for that frame (`j`/`l`),
// so every peer agrees on membership deterministically.
//
// Late join: the host sends a Welcome with the last confirmed snapshot plus all
// messages it knows since then; the new peer fast-forwards to catch up.

import type { NetLink, Msg } from './link';
import type { Session } from './session';
import { inputsEqual, type PlayerInput } from '../sim/input';
import type { Command, GameState, PeerFrame, SimEvent } from '../sim/types';
import { cloneState, hashState, step } from '../sim/sim';

export type FrameMsg = {
  t: 'f';
  p: number;                           // peer
  f: number;                           // frame this input applies to
  i: Record<string, PlayerInput>;      // inputs by device key
  c: Command[];
  lf: number;                          // sender's current frame (time sync)
  j?: number[];                        // host only: peers joining at f
  l?: number[];                        // host only: peers leaving at f
};

interface Member { start: number; end: number }

const INF = 1e15;

function sameMsg(a: FrameMsg | undefined, b: FrameMsg | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.c.length || b.c.length || a.j || a.l || b.j || b.l) return false;
  const ka = Object.keys(a.i), kb = Object.keys(b.i);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!inputsEqual(a.i[k], b.i[k])) return false;
  return true;
}

export interface RollbackOptions {
  inputDelay?: number;
  maxPredict?: number;
  now?: () => number;          // ms clock (for RTT)
  hashInterval?: number;
}

export class RollbackSession implements Session {
  peer = -1;
  readonly online = true;
  state: GameState;
  started: boolean;
  desyncFrame = -1;
  rttMs = 0;
  rollbacks = 0;
  lastRollbackDepth = 0;
  onHostLost: (reason: string) => void = () => {};
  onStarted: () => void = () => {};

  private inputDelay: number;
  private maxPredict: number;
  private hashInterval: number;
  private now: () => number;
  private states = new Map<number, GameState>();
  private known = new Map<number, Map<number, FrameMsg>>();
  private used = new Map<number, Map<number, FrameMsg>>();
  private lastKnown = new Map<number, FrameMsg>();
  private members = new Map<number, Member>();
  private confirmed = 0;          // all frames < confirmed are final
  private nextSend = 0;
  private pendingCmds: Command[] = [];
  private pendingJoins: number[] = [];
  private pendingLeaves: number[] = [];
  private remoteLf = new Map<number, number>();
  private rollbackTo = INF;
  private events: { frame: number; ev: SimEvent }[] = [];
  private myHashes = new Map<number, number>();
  private theirHashes = new Map<number, Map<number, number>>();
  private pingTimer = 0;
  private stallToggle = false;

  constructor(private link: NetLink, initial: GameState | null, opts: RollbackOptions = {}) {
    this.inputDelay = opts.inputDelay ?? 2;
    this.maxPredict = opts.maxPredict ?? 12;
    this.hashInterval = opts.hashInterval ?? 60;
    this.now = opts.now ?? (() => performance.now());
    this.state = initial ?? (null as unknown as GameState);
    this.started = !!initial;
    if (link.isHost) {
      if (!initial) throw new Error('host needs an initial state');
      this.peer = 0;
      this.members.set(0, { start: 0, end: INF });
      this.confirmed = initial.frame;
      this.nextSend = initial.frame;
    }
    link.onMessage = (from, msg) => this.onMessage(from, msg);
    link.onPeerConnect = (p) => this.onPeerConnect(p);
    link.onPeerDisconnect = (p) => this.onPeerDisconnect(p);
    link.onClose = (reason) => this.onHostLost(reason);
  }

  get isHost(): boolean { return this.link.isHost; }

  command(c: Command): void { this.pendingCmds.push(c); }

  takeEvents() { const e = this.events; this.events = []; return e; }

  status(): string {
    if (!this.started) return 'connecting…';
    const peers = [...this.members.entries()].filter(([, m]) => m.end === INF).length;
    const ahead = this.state.frame - this.confirmed;
    return `peer ${this.peer} · ${peers} peers · rtt ${Math.round(this.rttMs)}ms · predict ${ahead}f` +
      (this.desyncFrame >= 0 ? ` · DESYNC@${this.desyncFrame}` : '');
  }

  dispose(): void { this.link.close(); }

  // -------------------------------------------------------------------------

  tick(local: Record<string, PlayerInput>): void {
    if (!this.started) return;

    // Ping the host for RTT once a second.
    if (!this.isHost && ++this.pingTimer % 60 === 1) this.link.send(0, { t: 'ping', ts: this.now() });

    this.sendOwn(local);
    this.doRollback();

    let n = 1;
    if (!this.isHost) {
      const hostLf = this.remoteLf.get(0);
      if (hostLf !== undefined) {
        const rttFrames = (this.rttMs / 1000) * 60;
        const diff = this.state.frame - (hostLf + rttFrames / 2);
        if (diff < -6) n = Math.min(12, Math.ceil(-diff));
        else if (diff < -1.5) n = 2;
        else if (diff > 1.5) { this.stallToggle = !this.stallToggle; n = this.stallToggle ? 0 : 1; }
      }
    }
    for (let k = 0; k < n; k++) {
      if (this.state.frame - this.confirmed >= this.maxPredict) break;
      // Our own input for this frame must exist before we simulate it.
      if (this.members.get(this.peer)?.start! <= this.state.frame && !this.known.get(this.state.frame)?.has(this.peer)) {
        this.sendOwn(local);
        if (!this.known.get(this.state.frame)?.has(this.peer)) break;
      }
      this.simulate();
    }
    this.advanceConfirmed();
    this.gc();
  }

  private sendOwn(local: Record<string, PlayerInput>): void {
    const me = this.members.get(this.peer);
    if (!me) return;
    if (this.nextSend < me.start) this.nextSend = me.start;
    const target = this.state.frame + this.inputDelay;
    while (this.nextSend <= target) {
      const f = this.nextSend++;
      const msg: FrameMsg = { t: 'f', p: this.peer, f, i: { ...local }, c: this.pendingCmds, lf: this.state.frame };
      this.pendingCmds = [];
      if (this.isHost) {
        if (this.pendingJoins.length) {
          msg.j = this.pendingJoins; this.pendingJoins = [];
          for (const p of msg.j) this.members.set(p, { start: f, end: INF });
        }
        if (this.pendingLeaves.length) {
          msg.l = this.pendingLeaves; this.pendingLeaves = [];
          for (const p of msg.l) { const m = this.members.get(p); if (m) m.end = f; }
        }
        this.link.broadcast(msg);
      } else {
        this.link.send(0, msg);
      }
      this.store(msg);
    }
  }

  private store(m: FrameMsg): void {
    if (m.f < this.confirmed) return;
    let fm = this.known.get(m.f);
    if (!fm) { fm = new Map(); this.known.set(m.f, fm); }
    fm.set(m.p, m);
    const last = this.lastKnown.get(m.p);
    if (!last || m.f > last.f) this.lastKnown.set(m.p, m);
    if (m.f < this.state.frame) {
      const u = this.used.get(m.f)?.get(m.p);
      if (!sameMsg(u, m)) this.rollbackTo = Math.min(this.rollbackTo, m.f);
    }
  }

  private requiredPeers(f: number): number[] {
    const out: number[] = [];
    for (const [p, m] of this.members) if (m.start <= f && f < m.end) out.push(p);
    return out.sort((a, b) => a - b);
  }

  private predict(p: number, f: number): FrameMsg {
    const last = this.lastKnown.get(p);
    return { t: 'f', p, f, i: last ? last.i : {}, c: [], lf: 0 };
  }

  private simulate(): void {
    const f = this.state.frame;
    const req = this.requiredPeers(f);
    const known = this.known.get(f);
    const usedMap = new Map<number, FrameMsg>();
    const frame: PeerFrame[] = [];
    for (const p of req) {
      const m = known?.get(p) ?? this.predict(p, f);
      usedMap.set(p, m);
      frame.push({ peer: p, inputs: m.i, cmds: m.c });
    }
    this.used.set(f, usedMap);
    this.states.set(f, cloneState(this.state));
    step(this.state, frame);
    for (const ev of this.state.events) this.events.push({ frame: this.state.frame, ev });
  }

  private doRollback(): void {
    if (this.rollbackTo >= this.state.frame) { this.rollbackTo = INF; return; }
    const to = this.rollbackTo;
    this.rollbackTo = INF;
    const snap = this.states.get(to);
    if (!snap) { console.warn('rollback: missing snapshot', to); return; }
    const end = this.state.frame;
    this.state = cloneState(snap);
    this.rollbacks++;
    this.lastRollbackDepth = end - to;
    while (this.state.frame < end) this.simulate();
  }

  private advanceConfirmed(): void {
    while (this.confirmed < this.state.frame) {
      const f = this.confirmed;
      const known = this.known.get(f);
      const req = this.requiredPeers(f);
      if (!req.every((p) => known?.has(p))) break;
      // Every message for f is known and was used (rollback already applied).
      this.confirmed++;
      if (this.confirmed % this.hashInterval === 0) {
        const s = this.confirmed === this.state.frame ? this.state : this.states.get(this.confirmed);
        if (s) this.recordHash(this.confirmed, hashState(s));
      }
    }
  }

  private recordHash(f: number, h: number): void {
    this.myHashes.set(f, h);
    if (this.isHost) {
      const theirs = this.theirHashes.get(f);
      if (theirs) for (const [, th] of theirs) if (th !== h) this.flagDesync(f);
    } else {
      this.link.send(0, { t: 'h', f, h });
    }
  }

  private flagDesync(f: number): void {
    if (this.desyncFrame < 0) {
      this.desyncFrame = f;
      console.error('DESYNC detected at frame', f);
      if (this.isHost) this.link.broadcast({ t: 'd', f });
    }
  }

  private gc(): void {
    const keep = this.confirmed - 2;
    for (const k of this.states.keys()) if (k < keep) this.states.delete(k);
    for (const k of this.known.keys()) if (k < keep) this.known.delete(k);
    for (const k of this.used.keys()) if (k < keep) this.used.delete(k);
    for (const k of this.myHashes.keys()) if (k < keep - 600) this.myHashes.delete(k);
    for (const k of this.theirHashes.keys()) if (k < keep - 600) this.theirHashes.delete(k);
  }

  // -------------------------------------------------------------------------

  private onMessage(from: number, msg: Msg): void {
    switch (msg.t) {
      case 'f': {
        const m = msg as unknown as FrameMsg;
        if (this.isHost) {
          if (m.p !== from) return;
          const mem = this.members.get(from);
          if (!mem || m.f < mem.start || m.f >= mem.end) return;
          this.link.broadcast(msg, from);
        }
        this.remoteLf.set(m.p, Math.max(this.remoteLf.get(m.p) ?? 0, m.lf));
        if (!this.started) return;
        if (m.j) for (const p of m.j) this.members.set(p, { start: m.f, end: INF });
        if (m.l) for (const p of m.l) { const mm = this.members.get(p); if (mm) mm.end = m.f; }
        if ((m.j || m.l) && m.f < this.state.frame) this.rollbackTo = Math.min(this.rollbackTo, m.f);
        this.store(m);
        return;
      }
      case 'w': {
        if (this.isHost || this.started) return;
        const w = msg as unknown as { you: number; join: number; base: number; state: GameState; log: FrameMsg[]; members: [number, number, number][]; delay: number };
        this.peer = w.you;
        this.inputDelay = w.delay;
        this.state = w.state;
        this.confirmed = w.base;
        this.nextSend = w.join;
        for (const [p, s, e] of w.members) this.members.set(p, { start: s, end: e < 0 ? INF : e });
        this.started = true;
        for (const m of w.log) {
          this.remoteLf.set(m.p, Math.max(this.remoteLf.get(m.p) ?? 0, m.lf));
          this.store(m);
        }
        this.onStarted();
        return;
      }
      case 'ping':
        this.link.send(from, { t: 'pong', ts: msg.ts as number });
        return;
      case 'pong':
        this.rttMs = this.rttMs === 0 ? this.now() - (msg.ts as number) : this.rttMs * 0.8 + 0.2 * (this.now() - (msg.ts as number));
        return;
      case 'h': {
        if (!this.isHost) return;
        const f = msg.f as number, h = msg.h as number;
        let m = this.theirHashes.get(f);
        if (!m) { m = new Map(); this.theirHashes.set(f, m); }
        m.set(from, h);
        const mine = this.myHashes.get(f);
        if (mine !== undefined && mine !== h) this.flagDesync(f);
        return;
      }
      case 'd':
        this.flagDesync(msg.f as number);
        return;
    }
  }

  private onPeerConnect(p: number): void {
    // Snapshot the last confirmed state and every message since.
    const base = this.confirmed;
    const snap = base === this.state.frame ? this.state : this.states.get(base);
    if (!snap) { console.warn('no snapshot for welcome'); return; }
    const join = this.nextSend;
    this.pendingJoins.push(p);
    // Register now: the new peer may answer before our next tick, and its
    // messages must not be dropped. Frame `join` hasn't been simulated yet.
    this.members.set(p, { start: join, end: INF });
    const log: FrameMsg[] = [];
    const frames = [...this.known.keys()].filter((f) => f >= base).sort((a, b) => a - b);
    for (const f of frames) for (const m of this.known.get(f)!.values()) log.push(m);
    const members: [number, number, number][] = [...this.members.entries()].map(([q, m]) => [q, m.start, m.end === INF ? -1 : m.end]);
    this.link.send(p, { t: 'w', you: p, join, base, state: snap, log, members, delay: this.inputDelay } as unknown as Msg);
  }

  private onPeerDisconnect(p: number): void {
    this.pendingLeaves.push(p);
    this.pendingCmds.push({ t: 'peerLeft', peer: p });
  }
}
