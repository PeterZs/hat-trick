// Transport abstraction for netplay. Star topology: peer 0 is the host and
// relays every message between clients.

export type Msg = Record<string, unknown> & { t: string };

import { Reassembler, toWire } from './chunks';

export interface NetLink {
  readonly isHost: boolean;
  /** Host: send to one client. Client: `to` must be 0 (host). */
  send(to: number, msg: Msg): void;
  /** Host only: send to every client except `except`. */
  broadcast(msg: Msg, except?: number): void;
  onMessage: (from: number, msg: Msg) => void;
  /** Host only. */
  onPeerConnect: (peer: number) => void;
  onPeerDisconnect: (peer: number) => void;
  /** Client: the host went away. */
  onClose: (reason: string) => void;
  close(): void;
}

/** In-memory links with simulated latency, for tests and local debugging. */
export class LoopbackHub {
  links: LoopbackLink[] = [];
  now = 0;
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
    this.links[id] = l;
    this.links[0].onPeerConnect(id);
    return l;
  }

  disconnect(id: number): void {
    const l = this.links[id];
    if (!l) return;
    l.dead = true;
    this.links[0].onPeerDisconnect(id);
  }

  private rx = new Map<string, Reassembler>();

  post(from: number, to: number, msg: Msg): void {
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
  onMessage: (from: number, msg: Msg) => void = () => {};
  onPeerConnect: (peer: number) => void = () => {};
  onPeerDisconnect: (peer: number) => void = () => {};
  onClose: (reason: string) => void = () => {};
  constructor(private hub: LoopbackHub, readonly id: number, readonly isHost: boolean) {}
  send(to: number, msg: Msg): void { this.hub.post(this.id, to, msg); }
  broadcast(msg: Msg, except?: number): void {
    for (let i = 1; i < this.hub.links.length; i++) if (i !== except) this.hub.post(this.id, i, msg);
  }
  close(): void { this.dead = true; }
}
