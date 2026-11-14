import { describe, expect, it } from 'vitest';
import { createState, step } from '../src/sim/sim';
import { DEFAULT_PARAMS } from '../src/sim/params';
import { BTN_ATTACK, BTN_INTERACT, BTN_THROW, makeInput, type PlayerInput } from '../src/sim/input';
import { HAT_GROUND, HAT_HELD, HAT_OUT, HAT_RECALL, type GameState, type ModeId } from '../src/sim/types';
import { spawnCar } from '../src/sim/actors';

function setup(mode: ModeId = 'teams', n = 2): GameState {
  const s = createState({ mode, level: 'courtyard', winScore: 5 }, { ...DEFAULT_PARAMS, powerupMax: 0 }, 3);
  const cmds = [];
  for (let i = 0; i < n; i++) cmds.push({ t: 'join' as const, device: 'd' + i, name: 'P' + i, ball: i, team: mode === 'teams' ? 0 : undefined });
  step(s, [{ peer: 0, inputs: {}, cmds }]);
  for (const p of s.players) { p.invulnT = 0; }
  return s;
}

function run(s: GameState, frames: number, inputs: (f: number) => Record<string, PlayerInput>): string[] {
  const ev: string[] = [];
  for (let f = 0; f < frames; f++) {
    step(s, [{ peer: 0, inputs: inputs(f), cmds: [] }]);
    for (const e of s.events) ev.push(e.e);
  }
  return ev;
}

describe('features', () => {
  it('piggyback: rider follows mount, mount runs faster', () => {
    const s = setup('teams', 2);
    const [a, b] = s.players;
    a.x = 0; a.y = -2.6; b.x = 1; b.y = -2.6;
    run(s, 2, (f) => ({ d0: makeInput(0, 0, 0, 0, f === 0 ? BTN_INTERACT : 0) }));
    expect(a.riding).toBe(b.id);
    expect(b.rider).toBe(a.id);
    const x0 = b.x;
    run(s, 30, () => ({ d1: makeInput(-1, 0, 0, 0, 0) }));
    expect(a.x).toBeCloseTo(b.x, 5);
    // 0.5 s at ~2x speed (minus acceleration).
    expect(x0 - b.x).toBeGreaterThan(DEFAULT_PARAMS.moveSpeed * 0.5 * 1.4);
    run(s, 2, (f) => ({ d0: makeInput(0, 0, 0, 0, f === 0 ? BTN_INTERACT : 0) }));
    expect(a.riding).toBe(-1);
  });

  it('car: enter, drive, run over enemy', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -8; a.y = 2.5; b.x = 8; b.y = 2.5;
    spawnCar(s, -7, 2.5, 0);
    const ev = run(s, 120, (f) => ({ d0: makeInput(0, -1, 0, 0, f === 0 ? BTN_INTERACT : 0) }));
    expect(ev).toContain('car');
    expect(a.car).toBeGreaterThan(0);
    expect(b.alive).toBe(false);
  });

  it('throw out and back, then recall from the ground', () => {
    const s = setup('ffa', 1);
    const [a] = s.players;
    a.x = -12; a.y = 8.5;
    const ev = run(s, 4, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0) }));
    expect(ev).toContain('throw');
    expect(s.hats[0].state).toBe(HAT_OUT);
    const ev2 = run(s, 120, () => ({ d0: makeInput(0, 0, 1, 0, 0) }));
    expect(ev2).toContain('catch');
    expect(s.hats[0].state).toBe(HAT_HELD);
    // Throw at a wall: it should drop.
    a.x = 12; a.y = -1;
    run(s, 4, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0) }));
    run(s, 30, () => ({ d0: makeInput(0, 0, 0, 0, 0) }));
    expect(s.hats[0].state).toBe(HAT_GROUND);
    a.x = 4; a.y = -1;
    run(s, 10, () => ({ d0: makeInput(0, 0, 0, 0, BTN_THROW) }));
    expect(s.hats[0].state).toBe(HAT_RECALL);
    const ev3 = run(s, 120, () => ({ d0: makeInput(0, 0, 0, 0, BTN_THROW) }));
    expect(ev3).toContain('catch');
  });

  it('slash knocks a flying hat down', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -6; a.y = 8.5; b.x = 0; b.y = 8.5;
    run(s, 3, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0), d1: makeInput(0, 0, -1, 0, 0) }));
    let parried = false;
    for (let f = 0; f < 30 && !parried; f++) {
      const hat = s.hats.find((h) => h.owner === a.id)!;
      const ev = run(s, 1, () => ({ d1: makeInput(0, 0, -1, 0, Math.abs(hat.x - b.x) < 3.5 ? BTN_ATTACK : 0) }));
      parried = ev.includes('parry');
    }
    expect(parried).toBe(true);
    expect(b.alive).toBe(true);
  });

  it('kick without hat pushes but does not kill', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = 0; a.y = 8.5; b.x = 1.2; b.y = 8.5;
    s.hats.find((h) => h.owner === a.id)!.state = HAT_GROUND;
    const ev = run(s, 10, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('kick');
    expect(b.alive).toBe(true);
    expect(b.x).toBeGreaterThan(2);
  });
});
