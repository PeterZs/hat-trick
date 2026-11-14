import { describe, expect, it } from 'vitest';
import { LoopbackHub } from '../src/net/link';
import { RollbackSession } from '../src/net/rollback';
import { createState } from '../src/sim/sim';
import { TEST_PARAMS as DEFAULT_PARAMS } from './params';
import { makeInput, BTN_ATTACK, BTN_THROW, BTN_DASH } from '../src/sim/input';

function randomInput(seed: number) {
  const r = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  const b = (r(1) < 0.1 ? BTN_ATTACK : 0) | (r(2) < 0.3 ? BTN_THROW : 0) | (r(3) < 0.05 ? BTN_DASH : 0);
  return makeInput(r(4) * 2 - 1, r(5) * 2 - 1, r(6) * 2 - 1, r(7) * 2 - 1, b);
}

describe('rollback netcode', () => {
  for (const [latency, jitter, reverse] of [[4, 3, false], [1, 0, true], [0, 2, true]] as const)
  it(`peers stay in sync (latency ${latency}, jitter ${jitter}, ${reverse ? 'clients tick first' : 'host ticks first'})`, () => {
    const hub = new LoopbackHub(latency, jitter);
    const clock = () => hub.now * (1000 / 60);
    const s0 = createState({ mode: 'ffa', level: 'courtyard', winScore: 99 }, DEFAULT_PARAMS, 42);
    const host = new RollbackSession(hub.host(), s0, { now: clock, hashInterval: 30 });
    const sessions: RollbackSession[] = [host];
    host.command({ t: 'join', device: 'kb', name: 'H', ball: 0 });
    host.command({ t: 'addBot' });

    const seedOf = new Map<RollbackSession, number>();
    let t = 0;
    const tickAll = () => {
      t++;
      for (const s of reverse ? [...sessions].reverse() : sessions) {
        // Change inputs only every few ticks (like real players) so prediction is sometimes right.
        const base = Math.floor(t / 7) + (seedOf.get(s) ?? 0) * 1000;
        s.tick(s.started ? { pad: randomInput(base) } : {});
      }
      hub.pump();
    };

    for (let i = 0; i < 60; i++) tickAll();
    const c1 = new RollbackSession(hub.connect(), null, { now: clock, hashInterval: 30 });
    seedOf.set(c1, 1); sessions.push(c1);
    for (let i = 0; i < 30; i++) tickAll();
    c1.command({ t: 'join', device: 'pad', name: 'C1', ball: 2 });
    host.command({ t: 'start', cfg: { mode: 'ffa', level: 'courtyard', winScore: 99 } });
    for (let i = 0; i < 200; i++) tickAll();
    const c2 = new RollbackSession(hub.connect(), null, { now: clock, hashInterval: 30 });
    seedOf.set(c2, 2); sessions.push(c2);
    for (let i = 0; i < 20; i++) tickAll();
    c2.command({ t: 'join', device: 'pad', name: 'C2', ball: 3 });
    for (let i = 0; i < 300; i++) tickAll();
    hub.disconnect(1);
    sessions.splice(sessions.indexOf(c1), 1);
    for (let i = 0; i < 300; i++) tickAll();

    expect(c2.started).toBe(true);
    expect(host.desyncFrame).toBe(-1);
    expect(c2.desyncFrame).toBe(-1);
    // Compare hashes at frames both confirmed.
    const hh = (host as any).myHashes as Map<number, number>;
    const ch = (c2 as any).myHashes as Map<number, number>;
    let compared = 0;
    for (const [f, h] of ch) if (hh.has(f)) { expect(hh.get(f)).toBe(h); compared++; }
    console.log('compared hashes', compared, 'host frame', host.state.frame, 'c2 frame', c2.state.frame,
      'players', host.state.players.filter((p) => p.active).map((p) => p.name).join(','), 'rollbacks', host.rollbacks, c2.rollbacks);
    expect(compared).toBeGreaterThan(3);
    expect(host.state.players.filter((p) => p.active).map((p) => p.name).sort()).toEqual(['Bot 1', 'C2', 'H']);
    expect(Math.abs(host.state.frame - c2.state.frame)).toBeLessThan(10);
  });
});

describe('late join race', () => {
  it("host accepts a new client's inputs that arrive before its next tick", () => {
    const hub = new LoopbackHub(0, 0);
    const s0 = createState({ mode: 'ffa', level: 'courtyard', winScore: 99 }, DEFAULT_PARAMS, 1);
    const host = new RollbackSession(hub.host(), s0, { now: () => hub.now * 16 });
    for (let i = 0; i < 10; i++) { host.tick({}); hub.pump(); }
    const c = new RollbackSession(hub.connect(), null, { now: () => hub.now * 16 });
    hub.pump();            // welcome arrives
    c.tick({});            // client answers immediately
    c.tick({});
    hub.pump();            // ...and its inputs reach the host before the host ticks
    for (let i = 0; i < 60; i++) { host.tick({}); c.tick({}); hub.pump(); }
    expect(host.state.frame).toBeGreaterThan(50);
    expect(c.state.frame).toBeGreaterThan(50);
  });
});

describe('big games', () => {
  it('a late joiner gets the welcome snapshot of a 15-player match (chunked)', () => {
    const hub = new LoopbackHub(2, 1);
    const clock = () => hub.now * 16;
    const cfg = { mode: 'lumber' as const, level: 'clearing', winScore: 99 };
    const host = new RollbackSession(hub.host(), createState(cfg, { ...DEFAULT_PARAMS, treeCount: 20 }, 3), { now: clock, hashInterval: 30 });
    for (let i = 0; i < 4; i++) host.command({ t: 'join', device: 'd' + i, name: 'Spieler 🎩 ' + i, ball: i });
    for (let i = 0; i < 11; i++) host.command({ t: 'addBot' });
    host.command({ t: 'start', cfg });
    for (let i = 0; i < 120; i++) { host.tick({}); hub.pump(); }
    // Record the biggest message the host sends (the welcome snapshot).
    let biggest = 0;
    const post = hub.post.bind(hub);
    hub.post = (from, to, msg) => { biggest = Math.max(biggest, JSON.stringify(msg).length); post(from, to, msg); };
    const c = new RollbackSession(hub.connect(), null, { now: clock, hashInterval: 30 });
    for (let i = 0; i < 200; i++) { host.tick({}); c.tick({}); hub.pump(); }
    expect(biggest).toBeGreaterThan(16300); // would be rejected by a PeerJS JSON channel unless chunked
    expect(c.started).toBe(true);
    expect(c.state.players.filter((p) => p.active).length).toBe(15);
    expect(c.desyncFrame).toBe(-1);
    expect(host.desyncFrame).toBe(-1);
  });
});
