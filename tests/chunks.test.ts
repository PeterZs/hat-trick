import { describe, expect, it } from 'vitest';
import { Reassembler, toWire, CHUNK_CHARS } from '../src/net/chunks';

describe('message chunking', () => {
  it('passes small messages through and round-trips big ones (with non-ASCII text)', () => {
    const small = { t: 'f', x: 1 };
    expect(toWire(small)).toEqual([small]);
    const big = { t: 'w', blob: '🎩é'.repeat(20000), n: [1, 2, 3] };
    const parts = toWire(big);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(16300);
    const rx = new Reassembler();
    let out = null;
    for (const p of parts) out = rx.accept(p) ?? out;
    expect(out).toEqual(big);
    expect(CHUNK_CHARS).toBeGreaterThan(0);
  });
});
