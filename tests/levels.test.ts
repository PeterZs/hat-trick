import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/level';
import { circleOverlapsWalls } from '../src/sim/collision';
import { createState, step } from '../src/sim/sim';
import { isHazard } from '../src/sim/hazards';
import { propInfo } from '../src/sim/props';
import { TEST_PARAMS } from './params';

describe('level layouts', () => {
  for (const L of Object.values(LEVELS)) {
    it(`${L.id}: spawns, props, tees and portals are clear of walls and hazards`, () => {
      const s = createState({ mode: 'ffa', level: L.id, winScore: 5 }, TEST_PARAMS, 1);
      expect(s.arena).toBe(L.id);
      const clear = (x: number, y: number, r: number, what: string) => {
        expect(circleOverlapsWalls(x, y, r, L.walls, false), `${what} @${x},${y} hits a wall`).toBe(false);
        for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
          expect(isHazard(s, x + dx, y + dy), `${what} @${x},${y} is over a hazard`).toBeNull();
        }
      };
      expect(L.spawns.length).toBeGreaterThanOrEqual(8);
      for (const sp of L.spawns) clear(sp.x, sp.y, 0.6, 'spawn');
      for (const pr of L.props) clear(pr.x, pr.y, propInfo(s, pr.kind).r + 0.1, pr.kind);
      for (const h of L.holes ?? []) { for (const t of h.tees) clear(t[0], t[1], 0.5, 'tee'); clear(h.cup[0], h.cup[1], 0.6, 'cup'); }
      for (const pt of L.portals ?? []) clear(pt.x, pt.y, 1.4, 'portal');
      for (const b of L.bumpers ?? []) for (const sp of L.spawns) expect(Math.hypot(sp.x - b.x, sp.y - b.y), 'spawn near bumper').toBeGreaterThan(b.r + 1.5);
    });
  }

  it('every level survives a 20 s bot match', () => {
    for (const L of Object.values(LEVELS)) {
      const mode = L.holes ? 'golf' : L.goals.length ? 'soccer' : 'ffa';
      const cfg = { mode: mode as 'ffa', level: L.id, winScore: 99 };
      const s = createState(cfg, TEST_PARAMS, 2);
      step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'start', cfg }] }]);
      for (let f = 0; f < 60 * 20; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      expect(s.arena).toBe(L.id);
    }
  });
});

describe('random arena', () => {
  it('picks a compatible arena each round, avoiding repeats', () => {
    for (const mode of ['ffa', 'soccer', 'golf', 'ctf'] as const) {
      const cfg = { mode, level: 'random', winScore: 99 };
      const s = createState(cfg, { ...TEST_PARAMS, countdownTime: 0, roundEndDelay: 0.1 }, 3);
      step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }, { t: 'start', cfg }] }]);
      const seen = new Set<string>();
      let last = s.arena;
      for (let r = 0; r < 6; r++) {
        // End the round by force and let the next one start.
        s.phase = 'roundOver'; s.phaseT = 0; s.scores.fill(0);
        for (let f = 0; f < 20; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
        const L = LEVELS[s.arena];
        expect(L, s.arena).toBeTruthy();
        if (mode === 'soccer') expect(L.goals.length).toBeGreaterThan(0);
        if (mode === 'golf') expect(L.holes?.length ?? 0).toBeGreaterThan(0);
        if (mode === 'ctf') expect(L.open).toBeFalsy();
        if (mode === 'ffa') expect(s.arena).not.toBe(last);
        last = s.arena; seen.add(s.arena);
      }
      if (mode === 'ffa') expect(seen.size).toBeGreaterThan(3);
    }
  });
});

describe('collapsing floors', () => {
  it('Lava Rising starts eating the edge right away and shrinks toward the middle', async () => {
    const cfg = { mode: 'ffa' as const, level: 'lavarising', winScore: 99 };
    const s = createState(cfg, { ...TEST_PARAMS, countdownTime: 0 }, 1);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'a', name: 'A', ball: 0 }, { t: 'start', cfg }] }]);
    s.players[0].invulnT = 1e9;
    const gone = () => s.tiles.filter((t) => t === -1).length;
    for (let f = 0; f < 60 * 3; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
    const early = gone();
    expect(early).toBeGreaterThan(10);
    for (let f = 0; f < 60 * 30; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
    expect(gone()).toBeGreaterThan(early * 2);
    expect(s.tiles.some((t) => t === 0)).toBe(true); // the middle survives
  });
});

describe('determinism with hazards', () => {
  it('snapshot + resimulate matches in the new modes and gadget arenas', async () => {
    const { cloneState, hashState } = await import('../src/sim/sim');
    const cases = [['bumper', 'platform'], ['golf', 'links'], ['lava', 'courtyard'], ['ffa', 'temple'], ['ffa', 'factory'], ['ffa', 'pinball'], ['ffa', 'cliffs'], ['soccer', 'icerink']] as const;
    for (const [mode, level] of cases) {
      const cfg = { mode: mode as 'ffa', level, winScore: 99 };
      const s = createState(cfg, TEST_PARAMS, 9);
      step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'start', cfg }] }]);
      for (let f = 0; f < 300; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      const snap = cloneState(s);
      for (let f = 0; f < 900; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      for (let f = 0; f < 900; f++) step(snap, [{ peer: 0, inputs: {}, cmds: [] }]);
      expect(hashState(snap), `${mode} on ${level}`).toBe(hashState(s));
    }
  });
});
