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
//
// Host migration: when the host goes away (connection closed, or silent),
// every peer walks the same list of remaining members in id order and connects
// to the first one it can reach; the one that finds itself first becomes the
// host. It collects every survivor's confirmed frame (`hi`), asks for all the
// frame messages they hold from the oldest of those (`need`/`have`), merges
// them, ends the old host's membership after the last frame anyone got from it,
// and sends everyone the merged log and membership (`resync`). Inputs never
// change once sent, so the union is consistent, and nobody can have confirmed
// a frame past that leave frame. The new host then sends a `host` command to
// take over sim authority, plus `peerLeft` for everyone who didn't make it.

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
/** Frames of messages kept past confirmation, so a new host can fill in
 *  whatever a lagging survivor is missing. */
const KEEP_MSGS = 300;

type Migration = {
  old: number;                       // the host that went away
  candidates: number[];              // remaining members, in takeover order
  next: number;                      // index of the next candidate to try
  role: 'seek' | 'client' | 'host';
  deadline: number;                  // ms; give up on the current step after this
  // New host only:
  phase: 'hi' | 'have';
  expected: Set<number>;             // survivors we're waiting for
  confs: Map<number, number>;        // peer -> its confirmed frame (from `hi`)
  haves: Set<number>;                // peers whose messages we've merged
  gone: Set<number>;
};

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
  /** Host drops a peer whose inputs haven't arrived for this long. */
  kickAfterMs?: number;
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
  /** The game carried on under a new host (possibly us). */
  onHostChanged: () => void = () => {};
  hostChanges = 0;

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
  private lastHeard = new Map<number, number>();   // peer -> ms of last frame message
  private leaving = new Set<number>();
  private stallSince = -1;                          // ms when we last could not advance
  private kickAfterMs: number;
  private rollbackTo = INF;
  private events: { frame: number; ev: SimEvent }[] = [];
  private myHashes = new Map<number, number>();
  private theirHashes = new Map<number, Map<number, number>>();
  private pingTimer = 0;
  private stallToggle = false;
  private migration: Migration | null = null;
  private pendingHi = new Map<number, { conf: number; at: number }>(); // peers that came to us to be the next host
  private deferred: { f: number; cmds: Command[] } | null = null;     // new host: authority commands, once the old host is gone
  private joinsAfterMigration: number[] = [];
  private lastTickAt = -1;
  private dead = false;

  constructor(private link: NetLink, initial: GameState | null, opts: RollbackOptions = {}) {
    this.inputDelay = opts.inputDelay ?? 2;
    this.maxPredict = opts.maxPredict ?? 20;
    this.kickAfterMs = opts.kickAfterMs ?? 4000;
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
    link.onClose = (reason) => this.onLinkClosed(reason);
  }

  get isHost(): boolean { return this.link.isHost; }
  /** Peer number of the current host. */
  get host(): number { return this.link.host; }
  /** True while switching to a new host (the game is frozen). */
  get migrating(): boolean { return !!this.migration; }

  command(c: Command): void { this.pendingCmds.push(c); }

  takeEvents() { const e = this.events; this.events = []; return e; }

  status(): string {
    if (!this.started) return 'connecting…';
    if (this.migration) return `peer ${this.peer} · switching host…`;
    const peers = [...this.members.entries()].filter(([, m]) => m.end === INF).length;
    const ahead = this.state.frame - this.confirmed;
    return `peer ${this.peer} · ${peers} peers · rtt ${Math.round(this.rttMs)}ms · predict ${ahead}f` +
      (this.desyncFrame >= 0 ? ` · DESYNC@${this.desyncFrame}` : '');
  }

  dispose(): void { this.link.close(); }

  // -------------------------------------------------------------------------

  tick(local: Record<string, PlayerInput>): void {
    if (!this.started || this.dead) return;
    const now = this.now();
    const asleep = this.lastTickAt >= 0 && now - this.lastTickAt > 1000; // our tab was in the background
    this.lastTickAt = now;
    if (this.migration) { this.tickMigration(now); return; }
    this.expirePendingHi(now);

    if (!this.isHost) {
      // A host that goes quiet (it replies to pings even while stalled) is gone.
      const heard = this.lastHeard.get(this.host);
      if (asleep || heard === undefined) this.lastHeard.set(this.host, now);
      else if (now - heard > this.kickAfterMs) { this.startMigration(); return; }
      // Ping the host for RTT once a second.
      if (++this.pingTimer % 60 === 1) this.link.send(this.host, { t: 'ping', ts: now });
    }

    this.sendOwn(local);
    this.doRollback();

    let n = 1;
    if (!this.isHost) {
      const hostLf = this.remoteLf.get(this.host);
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
    // Track how long we've been unable to advance (for the 'waiting for…' banner).
    if (this.state.frame - this.confirmed >= this.maxPredict - 1) { if (this.stallSince < 0) this.stallSince = now; }
    else this.stallSince = -1;
    if (this.isHost) this.kickSilentPeers(now);
  }

  /** Milliseconds the game has been waiting on someone (0 = running). */
  stalledMs(): number {
    return this.stallSince < 0 ? 0 : this.now() - this.stallSince;
  }

  /** Peers whose inputs we're waiting for at the oldest unconfirmed frame. */
  waitingOn(): number[] {
    const known = this.known.get(this.confirmed);
    return this.requiredPeers(this.confirmed).filter((p) => !known?.has(p));
  }

  /** Host: a peer that stops sending (backgrounded tab, locked phone, dead
   *  connection) would freeze everyone. Drop it so the game goes on. */
  private kickSilentPeers(now: number): void {
    for (const [p, m] of this.members) {
      if (p === this.peer || m.end !== INF || this.leaving.has(p)) continue;
      const heard = this.lastHeard.get(p) ?? now;
      if (!this.lastHeard.has(p)) this.lastHeard.set(p, now);
      if (now - heard < this.kickAfterMs) continue;
      console.warn('dropping unresponsive peer', p);
      this.link.send(p, { t: 'kick', reason: 'You were disconnected because your game stopped responding (was it in the background?). Join again to keep playing.' });
      this.removePeer(p);
    }
  }

  /** Host: stop requiring a peer's inputs. The leave takes effect at the
   *  first frame we never got from them (nobody can have more of their inputs
   *  than the host, which relays everything), and is announced immediately with
   *  its own message — a stalled host isn't producing frame messages to carry it. */
  private removePeer(p: number): void {
    if (this.leaving.has(p)) return;
    this.leaving.add(p);
    const m = this.members.get(p);
    if (!m) return;
    const last = this.lastKnown.get(p);
    const leaveAt = Math.max(m.start, last ? last.f + 1 : m.start);
    this.applyLeave(p, leaveAt);
    this.link.broadcast({ t: 'leave', p, f: leaveAt }, p);
    // Their players are removed by a normal (synced) command.
    this.pendingCmds.push({ t: 'peerLeft', peer: p });
  }

  private applyLeave(p: number, f: number): void {
    const m = this.members.get(p);
    if (!m || m.end <= f) return;
    m.end = f;
    for (const [frame, msgs] of this.known) if (frame >= f) msgs.delete(p);
    if (f < this.state.frame) this.rollbackTo = Math.min(this.rollbackTo, f);
  }

  private sendOwn(local: Record<string, PlayerInput>): void {
    const me = this.members.get(this.peer);
    if (!me) return;
    if (this.nextSend < me.start) this.nextSend = me.start;
    let target = this.state.frame + this.inputDelay;
    // Without local players (e.g. just joined, still fast-forwarding through the
    // snapshot) our inputs are known to be empty: send them ahead right away so
    // nobody has to wait for us to catch up.
    if (!this.isHost && Object.keys(local).length === 0 && this.pendingCmds.length === 0 &&
        !this.state.players.some((q) => q.active && q.peer === this.peer && !q.isBot)) {
      target = Math.max(target, (this.remoteLf.get(this.host) ?? 0) + this.inputDelay);
    }
    while (this.nextSend <= target) {
      const f = this.nextSend++;
      const msg: FrameMsg = { t: 'f', p: this.peer, f, i: { ...local }, c: this.pendingCmds, lf: this.state.frame };
      this.pendingCmds = [];
      if (this.deferred && f >= this.deferred.f) { msg.c = [...this.deferred.cmds, ...msg.c]; this.deferred = null; }
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
        this.link.send(this.host, msg);
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
      this.link.send(this.host, { t: 'h', f, h });
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
    for (const k of this.known.keys()) if (k < this.confirmed - KEEP_MSGS) this.known.delete(k);
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
        } else if (from !== this.host) return; // stragglers from a host we've left behind
        this.remoteLf.set(m.p, Math.max(this.remoteLf.get(m.p) ?? 0, m.lf));
        this.lastHeard.set(from, this.now());
        if (!this.started || this.migration) return;
        this.ingest([m]);
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
        this.lastHeard.set(from, this.now());
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
        this.lastHeard.set(from, this.now());
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
      case 'leave':
        if (!this.isHost && this.started) this.applyLeave(msg.p as number, msg.f as number);
        return;
      case 'kick':
        this.fail(String(msg.reason ?? 'Disconnected by the host.'));
        return;
      case 'hi': return this.onHi(from, msg.conf as number);
      case 'need': return this.onNeed(from, msg.from as number);
      case 'have': return this.onHave(from, msg.msgs as FrameMsg[], msg.members as [number, number, number][]);
      case 'resync': return this.onResync(from, msg as unknown as { msgs: FrameMsg[]; members: [number, number, number][]; lf: number });
      case 'd':
        this.flagDesync(msg.f as number);
        return;
    }
  }

  private onPeerConnect(p: number): void {
    if (this.migration) { this.joinsAfterMigration.push(p); return; }
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
    this.link.send(p, { t: 'w', you: p, join, base, state: snap, log, members: this.memberList(), delay: this.inputDelay } as unknown as Msg);
  }

  private onPeerDisconnect(p: number): void {
    if (this.migration) { this.migration.gone.add(p); return; }
    this.removePeer(p);
  }

  private memberList(): [number, number, number][] {
    return [...this.members.entries()].map(([q, m]) => [q, m.start, m.end === INF ? -1 : m.end]);
  }

  /** Store frame messages, applying the membership changes they announce. */
  private ingest(msgs: FrameMsg[]): void {
    for (const m of msgs) {
      if (m.f < this.confirmed) continue;
      if (m.j) for (const p of m.j) {
        const mm = this.members.get(p);
        if (mm) mm.start = m.f; else this.members.set(p, { start: m.f, end: INF });
      }
      if (m.l) for (const p of m.l) { const mm = this.members.get(p); if (mm) mm.end = Math.min(mm.end, m.f); }
      if ((m.j || m.l) && m.f < this.state.frame) this.rollbackTo = Math.min(this.rollbackTo, m.f);
      this.store(m);
    }
  }

  /** Combine another peer's view of membership with ours: leaves win (only
   *  the old host could announce them, and some of us may have missed it). */
  private mergeMembers(list: [number, number, number][]): void {
    for (const [p, s, e0] of list) {
      const e = e0 < 0 ? INF : e0;
      const m = this.members.get(p);
      if (!m) {
        this.members.set(p, { start: s, end: e });
        if (s < this.state.frame) this.rollbackTo = Math.min(this.rollbackTo, s);
        continue;
      }
      if (s < m.start) { m.start = s; if (s < this.state.frame) this.rollbackTo = Math.min(this.rollbackTo, s); }
      if (e < m.end) this.applyLeave(p, e);
    }
  }

  private fail(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.migration = null;
    this.onHostLost(reason);
  }

  // -------------------------------------------------------------------------
  // Host migration

  private onLinkClosed(reason: string): void {
    if (this.dead) return;
    if (!this.started) { this.fail(reason); return; }
    const mg = this.migration;
    if (!mg) { this.startMigration(); return; }
    // The peer we were handing over to went away too: try the next one.
    if (mg.role === 'client') this.nextCandidate();
  }

  private startMigration(): void {
    const old = this.host;
    const candidates = [...this.members.entries()]
      .filter(([p, m]) => p !== old && m.end === INF).map(([p]) => p).sort((a, b) => a - b);
    console.warn('host', old, 'is gone; candidates', candidates);
    this.migration = {
      old, candidates, next: 0, role: 'seek', deadline: INF,
      phase: 'hi', expected: new Set(), confs: new Map(), haves: new Set(), gone: new Set(),
    };
    this.nextCandidate();
  }

  private nextCandidate(): void {
    const mg = this.migration!;
    const c = mg.candidates[mg.next++];
    if (c === undefined) { this.fail('The host left, and nobody else could take over.'); return; }
    if (c === this.peer) { this.takeOver(); return; }
    mg.role = 'seek';
    mg.deadline = INF;
    this.link.reconnect(c, this.peer, (ok) => {
      if (this.migration !== mg || this.dead) return;
      if (!ok) { this.nextCandidate(); return; }
      mg.role = 'client';
      mg.deadline = this.now() + this.handshakeMs();
      this.link.send(c, { t: 'hi', conf: this.confirmed });
    });
  }

  private handshakeMs(): number { return 2 * this.kickAfterMs + 4000; }

  /** We're first in line: become the host and gather the survivors. */
  private takeOver(): void {
    const mg = this.migration!;
    mg.role = 'host';
    let next = this.peer + 1;
    for (const p of this.members.keys()) next = Math.max(next, p + 1);
    for (const p of this.lastKnown.keys()) next = Math.max(next, p + 1);
    this.link.becomeHost(this.peer, next);
    // Everyone after us in line should come; anyone before us was unreachable.
    for (const p of mg.candidates.slice(mg.next)) mg.expected.add(p);
    for (const [p, h] of this.pendingHi) { mg.confs.set(p, h.conf); mg.expected.add(p); }
    this.pendingHi.clear();
    // Others may notice the old host is gone only when it times out for them.
    mg.deadline = this.now() + this.kickAfterMs + 3000;
    this.tickMigration(this.now());
  }

  private tickMigration(now: number): void {
    const mg = this.migration!;
    if (mg.role === 'client' && now > mg.deadline) { this.nextCandidate(); return; }
    if (mg.role !== 'host') return;
    const settled = (p: number, set: { has(p: number): boolean }) => set.has(p) || mg.gone.has(p);
    if (mg.phase === 'hi' && ([...mg.expected].every((p) => settled(p, mg.confs)) || now > mg.deadline)) {
      let floor = this.confirmed;
      for (const [p, c] of mg.confs) if (!mg.gone.has(p)) floor = Math.min(floor, c);
      for (const p of mg.confs.keys()) this.link.send(p, { t: 'need', from: floor });
      mg.phase = 'have';
      mg.deadline = now + this.handshakeMs();
    }
    if (mg.phase === 'have' && ([...mg.confs.keys()].every((p) => settled(p, mg.haves)) || now > mg.deadline)) {
      this.finishTakeover(now);
    }
  }

  private finishTakeover(now: number): void {
    const mg = this.migration!;
    const survivors = [...mg.haves].filter((p) => !mg.gone.has(p));
    // Everyone else still a member is out: the old host and anyone who didn't
    // make it. Each leaves after the last frame of theirs that anyone got.
    const left: number[] = [];
    let after = 0;
    for (const [p, m] of this.members) {
      if (p === this.peer || m.end !== INF || survivors.includes(p)) continue;
      const last = this.lastKnown.get(p);
      const at = Math.max(m.start, last ? last.f + 1 : m.start);
      this.applyLeave(p, at);
      left.push(p);
      after = Math.max(after, at);
    }
    if (!left.includes(mg.old)) { left.push(mg.old); after = Math.max(after, this.members.get(mg.old)?.end ?? 0); }
    // Sim authority passes to us once the old host no longer sends frames.
    this.deferred = { f: after, cmds: [{ t: 'host' }, ...left.map((p): Command => ({ t: 'peerLeft', peer: p }))] };
    const members = this.memberList();
    for (const p of survivors) {
      const from = mg.confs.get(p) ?? 0;
      const msgs: FrameMsg[] = [];
      for (const [f, fm] of this.known) if (f >= from) for (const m of fm.values()) msgs.push(m);
      this.link.send(p, { t: 'resync', msgs, members, lf: this.state.frame } as unknown as Msg);
      this.lastHeard.set(p, now);
    }
    for (const p of mg.confs.keys()) {
      if (!survivors.includes(p)) this.link.send(p, { t: 'kick', reason: 'Lost the connection while the host was changing. Join again to keep playing.' });
    }
    console.warn('took over as host; survivors', survivors, 'left', left, 'at', after);
    this.migration = null;
    this.hostChanges++;
    for (const p of this.joinsAfterMigration) this.onPeerConnect(p);
    this.joinsAfterMigration = [];
    this.onHostChanged();
  }

  /** A peer wants us to be the next host. */
  private onHi(from: number, conf: number): void {
    const mg = this.migration;
    if (mg?.role === 'host' && mg.phase === 'hi') { mg.confs.set(from, conf); mg.expected.add(from); return; }
    if (this.isHost) {
      this.link.send(from, { t: 'kick', reason: 'Lost the connection while the host was changing. Join again to keep playing.' });
      return;
    }
    this.pendingHi.set(from, { conf, at: this.now() });
    // If the host has gone quiet for us too, don't wait for our own timeout.
    if (!mg && this.started && this.now() - (this.lastHeard.get(this.host) ?? 0) > 1000) this.startMigration();
  }

  /** We're not the host, and the host is still there: turn away peers that
   *  wrongly thought it was gone. */
  private expirePendingHi(now: number): void {
    for (const [p, h] of this.pendingHi) {
      if (now - h.at < this.kickAfterMs + 3000) continue;
      this.pendingHi.delete(p);
      this.link.send(p, { t: 'kick', reason: 'Lost the connection to the host. Join again to keep playing.' });
    }
  }

  private onNeed(from: number, floor: number): void {
    const mg = this.migration;
    if (!mg || mg.role !== 'client' || from !== this.host) return;
    const msgs: FrameMsg[] = [];
    for (const [f, fm] of this.known) if (f >= floor) for (const m of fm.values()) msgs.push(m);
    this.link.send(from, { t: 'have', msgs, members: this.memberList() } as unknown as Msg);
    mg.deadline = this.now() + this.handshakeMs();
  }

  private onHave(from: number, msgs: FrameMsg[], members: [number, number, number][]): void {
    const mg = this.migration;
    if (!mg || mg.role !== 'host' || mg.phase !== 'have' || !mg.confs.has(from)) return;
    this.ingest(msgs);
    this.mergeMembers(members);
    mg.haves.add(from);
    this.tickMigration(this.now());
  }

  private onResync(from: number, r: { msgs: FrameMsg[]; members: [number, number, number][]; lf: number }): void {
    const mg = this.migration;
    if (!mg || mg.role !== 'client' || from !== this.host) return;
    this.ingest(r.msgs);
    this.mergeMembers(r.members);
    this.remoteLf.set(from, r.lf);
    this.lastHeard.set(from, this.now());
    this.migration = null;
    this.hostChanges++;
    this.onHostChanged();
  }
}
