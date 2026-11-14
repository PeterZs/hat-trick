// PeerJS (WebRTC) implementation of NetLink. The host registers a well-known
// peer id derived from a short room code; clients connect to it.

import Peer, { type DataConnection } from 'peerjs';
import type { Msg, NetLink } from './link';

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

class BaseLink {
  onMessage: (from: number, msg: Msg) => void = () => {};
  onPeerConnect: (peer: number) => void = () => {};
  onPeerDisconnect: (peer: number) => void = () => {};
  onClose: (reason: string) => void = () => {};
}

export class PeerHostLink extends BaseLink implements NetLink {
  readonly isHost = true;
  private conns = new Map<number, DataConnection>();
  private nextPeer = 1;
  constructor(private peer: Peer) {
    super();
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const id = this.nextPeer++;
        this.conns.set(id, conn);
        conn.on('data', (d) => this.onMessage(id, d as Msg));
        const gone = () => {
          if (!this.conns.has(id)) return;
          this.conns.delete(id);
          this.onPeerDisconnect(id);
        };
        conn.on('close', gone);
        conn.on('error', gone);
        this.onPeerConnect(id);
      });
    });
  }
  send(to: number, msg: Msg): void { this.conns.get(to)?.send(msg); }
  broadcast(msg: Msg, except?: number): void {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }
  get clientCount(): number { return this.conns.size; }
  close(): void { for (const c of this.conns.values()) c.close(); this.peer.destroy(); }
}

export class PeerClientLink extends BaseLink implements NetLink {
  readonly isHost = false;
  constructor(private peer: Peer, private conn: DataConnection) {
    super();
    conn.on('data', (d) => this.onMessage(0, d as Msg));
    conn.on('close', () => this.onClose('Host disconnected'));
    conn.on('error', (e) => this.onClose('Connection error: ' + e));
  }
  send(_to: number, msg: Msg): void { if (this.conn.open) this.conn.send(msg); }
  broadcast(): void {}
  close(): void { this.conn.close(); this.peer.destroy(); }
}

export function hostRoom(code: string): Promise<PeerHostLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, PEER_OPTIONS);
    peer.on('open', () => resolve(new PeerHostLink(peer)));
    peer.on('error', (e) => reject(e));
  });
}

export function joinRoom(code: string): Promise<PeerClientLink> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_OPTIONS);
    peer.on('error', (e) => reject(e));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => reject(new Error(`couldn't reach room ${code}. The room may not exist, or a network/browser setting is blocking WebRTC peer-to-peer connections (on either side).`)), 15000);
      conn.on('open', () => { clearTimeout(timer); resolve(new PeerClientLink(peer, conn)); });
      conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  });
}
