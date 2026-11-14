// Deterministic PRNG (mulberry32). The state is a single uint32 stored in the
// game state so it is snapshotted/rolled back with everything else.

export interface RngHolder { rng: number }

export function nextU32(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) >>> 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float in [0, 1). */
export function rand(h: RngHolder): number {
  return nextU32(h) / 4294967296;
}

export function randRange(h: RngHolder, lo: number, hi: number): number {
  return lo + (hi - lo) * rand(h);
}

export function randInt(h: RngHolder, n: number): number {
  return nextU32(h) % n;
}
