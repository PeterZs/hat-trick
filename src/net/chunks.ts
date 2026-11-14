// Split large messages into pieces small enough for a PeerJS JSON data channel
// (which rejects anything >= 16300 bytes) and reassemble them on arrival.
// Channels are reliable and ordered, so chunks arrive in sequence.

import type { Msg } from './link';

/** Chars per chunk: even at 3 UTF-8 bytes/char this stays far below 16300 bytes. */
export const CHUNK_CHARS = 4000;

export interface ChunkMsg extends Msg { t: '~'; id: number; i: number; n: number; d: string }

let nextId = 1;

/** The message itself if small, otherwise a list of chunk messages. */
export function toWire(msg: Msg): Msg[] {
  const s = JSON.stringify(msg);
  if (s.length <= CHUNK_CHARS) return [msg];
  const id = nextId++;
  const n = Math.ceil(s.length / CHUNK_CHARS);
  const out: Msg[] = [];
  for (let i = 0; i < n; i++) out.push({ t: '~', id, i, n, d: s.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) } as ChunkMsg);
  return out;
}

/** Feeds wire messages in; returns a complete message when one is ready. */
export class Reassembler {
  private parts = new Map<number, string[]>();
  accept(m: Msg): Msg | null {
    if (m.t !== '~') return m;
    const c = m as ChunkMsg;
    let arr = this.parts.get(c.id);
    if (!arr) { arr = []; this.parts.set(c.id, arr); }
    arr[c.i] = c.d;
    if (arr.filter((x) => x !== undefined).length < c.n) return null;
    this.parts.delete(c.id);
    return JSON.parse(arr.join('')) as Msg;
  }
}
