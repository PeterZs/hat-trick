// Transport abstraction for netplay. Star topology: the host relays every
// message between clients. Peers are numbered by the first host (0); the
// numbers survive host migration, when a client takes over as host.

export type Msg = Record<string, unknown> & { t: string };

import { Reassembler, toWire } from './chunks';

export interface NetLink {
  readonly isHost: boolean;
  /** Peer number of the current host (clients send to it). */
  readonly host: number;
  /** Host: send to one client. Client: to the host, or to a peer that
   *  connected to us during host migration. */
  send(to: number, msg: Msg): void;
  /** Host only: send to every client except `except`. */
  broadcast(msg: Msg, except?: number): void;
  onMessage: (from: number, msg: Msg) => void;
  /** Host only: a new peer arrived (peers reconnecting after a migration don't count). */
  onPeerConnect: (peer: number) => void;
  onPeerDisconnect: (peer: number) => void;
  /** Client: the host went away. */
  onClose: (reason: string) => void;
  /** Host migration, client side: drop the old host and connect to fellow
   *  peer `host` (which is taking over) as peer `self`. */
  reconnect(host: number, self: number, done: (ok: boolean) => void): void;
  /** Host migration: take over as host. New peers are numbered from `nextPeer`. */
  becomeHost(self: number, nextPeer: number): void;
  close(): void;
}

/** In-memory links with simulated latency, for tests and local debugging. */
export class LoopbackHub {
  links: LoopbackLink[] = [];
  now = 0;
  /** Where new connections go (whoever holds the "room code"). */
  hostId = 0;
  private queue: { at: number; deliver: () => void }[] = [];
  constructor(public latency = 3, public jitter = 0) {}

  host(): LoopbackLink {
    const l = new LoopbackLink(this, 0, true);
    this.links[0] = l;
    return l;
  }

  connect(): LoopbackLink {
    const id = this.links.length;
    const l = new LoopbackLink(this, id, false);
    l.host = this.hostId;
    this.links[id] = l;
    this.join(id, this.hostId);
    this.links[this.hostId].onPeerConnect(id);
    return l;
  }

  join(a: number, b: number): void {
    this.links[a].conns.add(b);
    this.links[b].conns.add(a);
  }

  /** Peer `id` vanishes. Peers in `notify` (default: everyone) see their
   *  connection close; the others only notice the silence. */
  disconnect(id: number, notify?: number[]): void {
    const l = this.links[id];
    if (!l || l.dead) return;
    l.dead = true;
    for (const o of this.links) {
      if (!o || o.dead || !o.conns.has(id)) continue;
      o.conns.delete(id);
      if (!notify || notify.includes(o.id)) o.lost(id);
    }
  }

  private rx = new Map<string, Reassembler>();

  post(from: number, to: number, msg: Msg): void {
    if (!this.links[from]?.conns.has(to)) return;
    for (const part of toWire(msg)) this.postPart(from, to, part);
  }

  private postPart(from: number, to: number, msg: Msg): void {
    const target = this.links[to];
    if (!target || target.dead || this.links[from]?.dead) return;
    const key = from + ':' + to;
    if (!this.rx.has(key)) this.rx.set(key, new Reassembler());
    const rx = this.rx.get(key)!;
    // Like PeerJS's JSON channel: refuse anything too big to send in one piece.
    if (JSON.stringify(msg).length >= 16300) throw new Error('message too big for one data-channel message');
    const raw = JSON.parse(JSON.stringify(msg));
    const j = this.jitter ? Math.floor(Math.random() * this.jitter) : 0;
    // Keep per-link ordering (reliable ordered channel).
    const at = Math.max(this.now + this.latency + j, this.lastAt(from, to));
    this.lastAtMap.set(from + ':' + to, at);
    this.queue.push({ at, deliver: () => { if (target.dead) return; const m = rx.accept(raw); if (m) target.onMessage(from, m); } });
  }

  /** Run `fn` after one link latency (e.g. a connection attempt). */
  later(fn: () => void): void {
    this.queue.push({ at: this.now + this.latency, deliver: fn });
  }

  private lastAtMap = new Map<string, number>();
  private lastAt(from: number, to: number) { return this.lastAtMap.get(from + ':' + to) ?? 0; }

  /** Advance simulated time by one tick and deliver due messages. */
  pump(): void {
    this.now++;
    const due = this.queue.filter((q) => q.at <= this.now);
    this.queue = this.queue.filter((q) => q.at > this.now);
    for (const d of due) d.deliver();
  }
}

export class LoopbackLink implements NetLink {
  dead = false;
  host = 0;
  /** Peers this link can talk to. */
  conns = new Set<number>();
  onMessage: (from: number, msg: Msg) => void = () => {};
  onPeerConnect: (peer: number) => void = () => {};
  onPeerDisconnect: (peer: number) => void = () => {};
  onClose: (reason: string) => void = () => {};
  constructor(private hub: LoopbackHub, readonly id: number, public isHost: boolean) {}
  send(to: number, msg: Msg): void { this.hub.post(this.id, to, msg); }
  broadcast(msg: Msg, except?: number): void {
    for (const p of this.conns) if (p !== except) this.hub.post(this.id, p, msg);
  }
  /** The connection to `p` closed. */
  lost(p: number): void {
    if (this.isHost) this.onPeerDisconnect(p);
    else if (p === this.host) this.onClose('Host disconnected');
  }
  reconnect(host: number, _self: number, done: (ok: boolean) => void): void {
    this.conns.delete(this.host);
    this.hub.links[this.host]?.conns.delete(this.id);
    this.hub.later(() => {
      const t = this.hub.links[host];
      if (this.dead || !t || t.dead) { done(false); return; }
      this.hub.join(this.id, host);
      this.host = host;
      done(true);
    });
  }
  becomeHost(): void {
    this.conns.delete(this.host);
    this.isHost = true;
    this.host = this.id;
    this.hub.hostId = this.id;
  }
  close(): void { this.dead = true; }
}
