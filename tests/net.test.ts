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

describe('stalls', () => {
  it('the host drops a peer that stops responding, and the game keeps going', () => {
    const hub = new LoopbackHub(2, 0);
    const clock = () => hub.now * (1000 / 60);
    const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 99 };
    const host = new RollbackSession(hub.host(), createState(cfg, DEFAULT_PARAMS, 3), { now: clock });
    host.command({ t: 'join', device: 'kb', name: 'H', ball: 0 });
    const c = new RollbackSession(hub.connect(), null, { now: clock });
    let lost = '';
    c.onHostLost = (r) => { lost = r; };
    for (let i = 0; i < 60; i++) { host.tick({}); c.tick({}); hub.pump(); }
    c.command({ t: 'join', device: 'pad', name: 'C', ball: 1 });
    for (let i = 0; i < 60; i++) { host.tick({}); c.tick({ pad: randomInput(i) }); hub.pump(); }
    expect(host.state.players.some((p) => p.active && p.name === 'C')).toBe(true);
    // The client goes silent (backgrounded tab): the host stalls, then drops it.
    const f0 = host.state.frame;
    for (let i = 0; i < 400; i++) { host.tick({}); hub.pump(); }
    expect(host.state.frame - f0).toBeGreaterThan(100);
    expect(host.state.players.some((p) => p.active && p.name === 'C')).toBe(false);
    expect(host.stalledMs()).toBe(0);
    for (let i = 0; i < 10; i++) { c.tick({}); hub.pump(); }
    expect(lost).toMatch(/stopped responding/);
  });

  it('a joining peer with no players yet never makes the host wait', () => {
    const hub = new LoopbackHub(3, 0);
    const clock = () => hub.now * (1000 / 60);
    const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 99 };
    const host = new RollbackSession(hub.host(), createState(cfg, DEFAULT_PARAMS, 3), { now: clock });
    for (let i = 0; i < 300; i++) { host.tick({}); hub.pump(); }
    const c = new RollbackSession(hub.connect(), null, { now: clock });
    let maxGap = 0;
    // The client only gets one tick for every 3 host ticks (a slow phone catching up).
    for (let i = 0; i < 300; i++) {
      host.tick({}); if (i % 3 === 0) c.tick({}); hub.pump();
      maxGap = Math.max(maxGap, host.state.frame - (host as any).confirmed);
    }
    expect(c.started).toBe(true);
    expect(maxGap).toBeLessThan(15); // never pinned at the prediction limit
  });
});

describe('host migration', () => {
  function setup(nClients: number, latency = 3, jitter = 2) {
    const hub = new LoopbackHub(latency, jitter);
    const clock = () => hub.now * (1000 / 60);
    const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 99 };
    const host = new RollbackSession(hub.host(), createState(cfg, DEFAULT_PARAMS, 7), { now: clock, hashInterval: 30 });
    host.command({ t: 'join', device: 'pad', name: 'P0', ball: 0 });
    host.command({ t: 'addBot' });
    const all: RollbackSession[] = [host];
    const live = new Set<RollbackSession>([host]);
    const lost: string[] = [];
    let t = 0;
    const tick = (n: number) => {
      for (let k = 0; k < n; k++) {
        t++;
        for (const s of live) s.tick(s.started ? { pad: randomInput(Math.floor(t / 7) + all.indexOf(s) * 1000) } : {});
        hub.pump();
      }
    };
    const add = () => {
      const c = new RollbackSession(hub.connect(), null, { now: clock, hashInterval: 30 });
      const i = all.length;
      c.onHostLost = (r) => lost.push(`${i}: ${r}`);
      all.push(c); live.add(c);
      tick(30);
      c.command({ t: 'join', device: 'pad', name: 'P' + i, ball: i });
      return c;
    };
    for (let i = 0; i < nClients; i++) add();
    host.command({ t: 'start', cfg });
    tick(120);
    const kill = (i: number, notify?: number[]) => { hub.disconnect(i, notify); live.delete(all[i]); };
    const names = (s: RollbackSession) => s.state.players.filter((p) => p.active && !p.isBot).map((p) => p.name).sort();
    const sameHashes = (a: RollbackSession, b: RollbackSession) => {
      const ha = (a as any).myHashes as Map<number, number>, hb = (b as any).myHashes as Map<number, number>;
      let n = 0;
      for (const [f, h] of hb) if (ha.has(f)) { expect(ha.get(f), `hash at ${f}`).toBe(h); n++; }
      return n;
    };
    return { hub, all, live, lost, tick, add, kill, names, sameHashes };
  }

  it('a client takes over when the host drops, and the match goes on', () => {
    const { all, lost, tick, add, kill, names, sameHashes } = setup(3);
    const [, c1, c2, c3] = all;
    // Client 3 isn't told the connection closed; it only notices the silence.
    kill(0, [1, 2]);
    tick(600);
    expect(lost).toEqual([]);
    for (const c of [c1, c2, c3]) {
      expect(c.hostChanges).toBe(1);
      expect(c.host).toBe(1);
      expect(c.desyncFrame).toBe(-1);
      expect(names(c)).toEqual(['P1', 'P2', 'P3']);
      expect(c.state.host).toBe(1);
      expect(c.state.players.some((p) => p.active && p.isBot)).toBe(true);
    }
    expect(c1.isHost).toBe(true);
    const f = c2.state.frame;
    tick(200);
    expect(c2.state.frame - f).toBeGreaterThan(150);
    // The new host takes new players, and its authority commands count.
    const c4 = add();
    c1.command({ t: 'lobby' });
    tick(300);
    expect(c4.started).toBe(true);
    expect(names(c3)).toEqual(['P1', 'P2', 'P3', 'P4']);
    for (const c of [c2, c3, c4]) expect(c.state.phase).toBe('lobby');
    for (const c of [c2, c3, c4]) { expect(c.desyncFrame).toBe(-1); expect(sameHashes(c1, c)).toBeGreaterThan(3); }
  });

  it('skips a successor that dropped at the same time', () => {
    const { all, lost, tick, kill, names, sameHashes } = setup(3, 2, 0);
    const [, , c2, c3] = all;
    kill(0);
    kill(1);
    tick(800);
    expect(lost).toEqual([]);
    expect(c2.isHost).toBe(true);
    expect(c3.host).toBe(2);
    expect(names(c3)).toEqual(['P2', 'P3']);
    expect(names(c2)).toEqual(['P2', 'P3']);
    tick(200);
    expect(c3.desyncFrame).toBe(-1);
    expect(sameHashes(c2, c3)).toBeGreaterThan(3);
  });

  it('the last one left carries on alone', () => {
    const { all, lost, tick, kill, names } = setup(1);
    kill(0);
    tick(300);
    expect(lost).toEqual([]);
    expect(all[1].isHost).toBe(true);
    expect(names(all[1])).toEqual(['P1']);
  });
});
