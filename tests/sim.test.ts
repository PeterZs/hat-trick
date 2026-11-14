import { describe, expect, it } from 'vitest';
import { createState, hashState, step, cloneState } from '../src/sim/sim';
import { DEFAULT_PARAMS } from '../src/sim/params';
import type { GameState, ModeId, PeerFrame } from '../src/sim/types';
import { dsin, dcos } from '../src/sim/dmath';
import { makeInput, BTN_ATTACK, BTN_THROW } from '../src/sim/input';

function run(mode: ModeId, level: string, bots: number, frames: number, seed = 1): { s: GameState; kills: number; events: Set<string> } {
  const s = createState({ mode, level, winScore: 3 }, DEFAULT_PARAMS, seed);
  const first: PeerFrame[] = [{ peer: 0, inputs: {}, cmds: [] }];
  for (let i = 0; i < bots; i++) first[0].cmds.push({ t: 'addBot' });
  first[0].cmds.push({ t: 'start', cfg: { mode, level, winScore: 3 } });
  step(s, first);
  let kills = 0;
  const events = new Set<string>();
  for (let f = 0; f < frames; f++) {
    step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
    for (const e of s.events) { events.add(e.e); if (e.e === 'kill') kills++; }
  }
  return { s, kills, events };
}

describe('dmath', () => {
  it('matches Math.sin closely', () => {
    for (let x = -20; x < 20; x += 0.137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-9);
    }
  });
});

describe('sim', () => {
  it('bots fight and the sim is deterministic', () => {
    const a = run('ffa', 'courtyard', 4, 60 * 60);
    const b = run('ffa', 'courtyard', 4, 60 * 60);
    expect(hashState(a.s)).toBe(hashState(b.s));
    expect(a.kills).toBeGreaterThan(0);
    console.log('ffa events', [...a.events].join(','), 'kills', a.kills, 'round', a.s.round, 'scores', a.s.scores.slice(0, 4), a.s.phase);
  });

  it('all modes run', () => {
    for (const [mode, level] of [['teams', 'courtyard'], ['ctf', 'fortress'], ['soccer', 'pitch'], ['hazard', 'courtyard']] as const) {
      const r = run(mode, level, 4, 60 * 90);
      console.log(mode, 'events', [...r.events].join(','), 'kills', r.kills, 'scores', r.s.scores.slice(0, 4), r.s.phase, 'round', r.s.round);
    }
  });

  it('clone + resimulate gives the same result (rollback)', () => {
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 7);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'kb', name: 'P1', ball: 0 }, { t: 'addBot' }, { t: 'addBot' }] }]);
    const inputs = (f: number) => [{ peer: 0, inputs: { kb: makeInput(Math.sin(f / 20), Math.cos(f / 33), 1, 0, (f % 30 < 3 ? BTN_ATTACK : 0) | (f % 90 < 20 ? BTN_THROW : 0)) }, cmds: [] }];
    for (let f = 0; f < 300; f++) step(s, inputs(f));
    const snap = cloneState(s);
    for (let f = 300; f < 900; f++) step(s, inputs(f));
    const h1 = hashState(s);
    for (let f = 300; f < 900; f++) step(snap, inputs(f));
    expect(hashState(snap)).toBe(h1);
  });

  it('mutual slash clashes', () => {
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 7);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'a', name: 'A', ball: 0 }, { t: 'join', device: 'b', name: 'B', ball: 1 }] }]);
    const [A, B] = s.players;
    A.x = -0.8; A.y = 5; B.x = 0.8; B.y = 5; A.invulnT = B.invulnT = 0;
    const clashes: string[] = [];
    for (let f = 0; f < 20; f++) {
      const b = f === 2 ? BTN_ATTACK : 0;
      step(s, [{ peer: 0, inputs: { a: makeInput(0, 0, 1, 0, b), b: makeInput(0, 0, -1, 0, f === 3 ? BTN_ATTACK : 0) }, cmds: [] }]);
      for (const e of s.events) clashes.push(e.e);
    }
    expect(clashes).toContain('clash');
    expect(A.alive && B.alive).toBe(true);
  });
});
