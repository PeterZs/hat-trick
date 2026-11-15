// PeerJS (WebRTC) implementation of NetLink. The host registers a well-known
// peer id derived from a short room code; clients connect to it. If the host
// leaves, a client takes over and reclaims the room code (see rollback.ts).

import Peer, { type DataConnection } from 'peerjs';
import type { Msg, NetLink } from './link';
import { Reassembler, toWire } from './chunks';

const PREFIX = 'hat-trick-v1-';

// STUN finds direct routes; TURN relays traffic when a direct connection is
// blocked (strict NATs, corporate Wi-Fi, browsers that disable non-proxied
// UDP). PeerJS's defaults only offer TURN over UDP 3478, so also offer relays
// on TCP 80/443, which get through almost everything.
const PEER_OPTIONS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      {
        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
        username: 'openrelayproject', credential: 'openrelayproject',
      },
    ],
  },
};

/** Normalize a typed room code: letters/digits only, upper case, max 12. */
export function cleanRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const RECLAIM_MS = 3000;   // a new host retries claiming the room code this often…
const RECLAIM_TRIES = 40;  // …for up to two minutes (an old host's id can linger on the server)
const RECONNECT_MS = 6000;

/** One link class for both roles, since a client can become the host.
 *  Besides the room-code peer id (held by the host), every browser has its own
 *  PeerJS id; the host shares them all (`@dir`) so clients can find whoever
 *  takes over if the host goes away. */
export class PeerRoomLink implements NetLink {
  isHost: boolean;
  host = 0;
  onMessage: (from: number, msg: Msg) => void = () => {};
  onPeerConnect: (peer: number) => void = () => {};
  onPeerDisconnect: (peer: number) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private self = 0;
  private conns = new Map<number, DataConnection>();
  private dir = new Map<number, string>();   // peer number -> PeerJS id
  private nextPeer = 1;
  private roomPeer: Peer | null = null;      // registered under the room code (host)
  private closed = false;
  private pendingReconnect: { id: string; fail: () => void } | null = null;

  constructor(private code: string, private peer: Peer, hostConn: DataConnection | null) {
    this.isHost = !hostConn;
    if (this.isHost) this.roomPeer = peer;
    else this.attach(0, hostConn!);
    this.listen(peer);
    peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
    peer.on('error', (e) => {
      const r = this.pendingReconnect;
      if (r && (e as { type?: string }).type === 'peer-unavailable' && String(e.message).includes(r.id)) r.fail();
    });
  }

  private listen(p: Peer): void {
    p.on('connection', (conn) => conn.on('open', () => this.accept(conn)));
  }

  private accept(conn: DataConnection): void {
    if (this.closed) { conn.close(); return; }
    const rejoin = (conn.metadata as { rejoin?: number } | undefined)?.rejoin;
    // Only the host takes new peers; anyone may be reached by a peer
    // looking for the next host.
    if (rejoin === undefined && !this.isHost) { conn.close(); return; }
    const id = rejoin ?? this.nextPeer++;
    const old = this.conns.get(id);
    this.conns.delete(id);
    old?.close();
    this.attach(id, conn);
    this.dir.set(id, conn.peer);
    if (this.isHost) this.sendDir();
    if (rejoin === undefined) this.onPeerConnect(id);
  }

  private attach(id0: number, conn: DataConnection): void {
    let id = id0;
    this.conns.set(id, conn);
    const rx = new Reassembler();
    conn.on('data', (d) => {
      const m = rx.accept(d as Msg);
      if (!m) return;
      if (m.t === '@dir') {
        this.dir = new Map(m.d as [number, string][]);
        // A newcomer reaches the host by room code before knowing its number.
        const h = m.h as number;
        if (!this.isHost && id === this.host && h !== id && this.conns.get(id) === conn) {
          this.conns.delete(id);
          id = this.host = h;
          this.conns.set(id, conn);
        }
        return;
      }
      this.onMessage(id, m);
    });
    const gone = () => {
      if (this.conns.get(id) !== conn) return; // replaced or dropped on purpose
      this.conns.delete(id);
      if (this.isHost) { this.dir.delete(id); this.sendDir(); this.onPeerDisconnect(id); }
      else if (id === this.host) this.onClose('Host disconnected');
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  private sendDir(): void {
    const d: [number, string][] = [[this.self, this.peer.id], ...[...this.dir].filter(([p]) => p !== this.self)];
    this.broadcast({ t: '@dir', d, h: this.self });
  }

  send(to: number, msg: Msg): void {
    const c = this.conns.get(to);
    if (c?.open) for (const part of toWire(msg)) c.send(part);
  }
  broadcast(msg: Msg, except?: number): void {
    const parts = toWire(msg);
    for (const [id, c] of this.conns) if (id !== except && c.open) for (const part of parts) c.send(part);
  }

  reconnect(host: number, self: number, done: (ok: boolean) => void): void {
    this.self = self;
    const old = this.conns.get(this.host);
    this.conns.delete(this.host);
    old?.close();
    const id = this.dir.get(host);
    if (!id || this.closed) { setTimeout(() => done(false)); return; }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pendingReconnect = null;
      if (ok) { this.host = host; this.attach(host, conn); } else conn.close();
      done(ok);
    };
    const conn = this.peer.connect(id, { reliable: true, serialization: 'json', metadata: { rejoin: self } });
    const timer = setTimeout(() => finish(false), RECONNECT_MS);
    this.pendingReconnect = { id, fail: () => finish(false) };
    conn.on('open', () => finish(true));
    conn.on('error', () => finish(false));
  }

  becomeHost(self: number, nextPeer: number): void {
    const old = this.conns.get(this.host);
    this.conns.delete(this.host);
    old?.close();
    this.isHost = true;
    this.self = self;
    this.host = self;
    this.nextPeer = Math.max(this.nextPeer, nextPeer);
    this.dir.set(self, this.peer.id);
    this.sendDir();
    this.claimRoom(RECLAIM_TRIES);
  }

  /** Take over the room code so new players can find the game again. */
  private claimRoom(tries: number): void {
    if (this.closed || this.roomPeer || tries <= 0) return;
    const p = new Peer(PREFIX + this.code, PEER_OPTIONS);
    p.on('open', () => { if (this.closed) { p.destroy(); return; } this.roomPeer = p; this.listen(p); });
    p.on('error', (e) => {
      if (this.roomPeer === p) return;
      p.destroy();
      if ((e as { type?: string }).type === 'unavailable-id') setTimeout(() => this.claimRoom(tries - 1), RECLAIM_MS);
    });
  }

  close(): void {
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.peer.destroy();
    if (this.roomPeer !== this.peer) this.roomPeer?.destroy();
  }
}

export function hostRoom(code: string): Promise<PeerRoomLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, PEER_OPTIONS);
    peer.on('open', () => resolve(new PeerRoomLink(code, peer, null)));
    peer.on('error', (e) => { peer.destroy(); reject(e); });
  });
}

/** Rejects with `type: 'peer-unavailable'` when nobody is hosting `code`. */
export function joinRoom(code: string): Promise<PeerRoomLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_OPTIONS);
    let opened = false;
    const fail = (e: unknown) => { if (opened) return; clearTimeout(timer); peer.destroy(); reject(e); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    peer.on('error', fail);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      timer = setTimeout(() => fail(new Error(`couldn't reach room ${code}. A network/browser setting may be blocking WebRTC peer-to-peer connections (on either side).`)), 15000);
      conn.on('open', () => {
        opened = true;
        clearTimeout(timer);
        peer.off('error', fail);
        resolve(new PeerRoomLink(code, peer, conn));
      });
      conn.on('error', fail);
    });
  });
}
