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
