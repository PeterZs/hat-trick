import { describe, expect, it } from 'vitest';
import { createState, step } from '../src/sim/sim';
import { TEST_PARAMS as DEFAULT_PARAMS } from './params';
import { BTN_ATTACK, BTN_INTERACT, BTN_THROW, makeInput, type PlayerInput } from '../src/sim/input';
import { HAT_GROUND, HAT_HELD, HAT_OUT, HAT_RECALL, HAT_RETURN, type GameState, type ModeId } from '../src/sim/types';
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
    // The carrier can't attack or throw while carrying.
    const evm = run(s, 20, (f) => ({ d1: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : f < 5 ? BTN_THROW : 0) }));
    expect(evm).not.toContain('slash');
    expect(evm).not.toContain('throw');
    expect(b.charging).toBe(false);
    // ...but the rider can.
    const evr = run(s, 5, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(evr).toContain('slash');
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
    // Throw at a nearby wall: it bounces and still comes back.
    a.x = 12; a.y = -1;
    run(s, 4, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0) }));
    const evb = run(s, 90, () => ({ d0: makeInput(0, 0, 0, 0, 0) }));
    expect(evb).toContain('bounce');
    expect(evb).toContain('catch');
    expect(s.hats[0].state).toBe(HAT_HELD);
    // Pinned against a wall with the owner straight behind it: it drops.
    a.x = 12; a.y = -3;
    const h = s.hats[0];
    Object.assign(h, { state: HAT_RETURN, x: 7.5, y: -3, vx: 22, vy: 0, speed: 22, t: 0, stuck: 0, lastD: 1e9 });
    const evp = run(s, 40, () => ({ d0: makeInput(0, 0, 0, 0, 0) }));
    expect(evp).toContain('clank');
    expect(h.state).toBe(HAT_GROUND);
    expect(h.x).toBeLessThan(9.1); // dropped on the near side of the wall
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

describe('hit-stop', () => {
  it('freezes the world for hitstopKill frames after a kill', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = 0; a.y = 4; b.x = 1.2; b.y = 4; a.fx = 1; a.fy = 0;
    const windup = Math.round(DEFAULT_PARAMS.slashWindup * 60);
    run(s, windup + 2, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(b.alive).toBe(false);
    expect(s.hitstop).toBeGreaterThan(0);
    // While frozen, movement input has no effect; a press made during the freeze still registers after.
    const x0 = a.x;
    const left = s.hitstop;
    run(s, left, () => ({ d0: makeInput(1, 0, 1, 0, 0) }));
    expect(a.x).toBe(x0);
    expect(s.hitstop).toBe(0);
    run(s, 5, () => ({ d0: makeInput(1, 0, 1, 0, 0) }));
    expect(a.x).toBeGreaterThan(x0);
  });
});

describe('lumberjacks', () => {
  it('slashing a tree treeHp times fells it and scores', () => {
    const s = createState({ mode: 'lumber', level: 'clearing', winScore: 5 }, { ...DEFAULT_PARAMS, powerupMax: 0 }, 3);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'd0', name: 'A', ball: 0 }, { t: 'start', cfg: s.cfg }] }]);
    while (s.phase !== 'playing') step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
    const [a] = s.players;
    const t = s.trees[0];
    a.x = t.x - 1.4; a.y = t.y;
    const ev: string[] = [];
    for (let i = 0; i < DEFAULT_PARAMS.treeHp; i++) {
      ev.push(...run(s, 40, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) })));
    }
    expect(ev.filter((e) => e === 'chop').length).toBe(DEFAULT_PARAMS.treeHp);
    expect(ev).toContain('fell');
    expect(s.scores[a.id]).toBe(1);
    // Regrows somewhere after the regrow time.
    run(s, Math.round(DEFAULT_PARAMS.treeRegrowTime * 60) + 5, () => ({}));
    expect(s.trees.filter((t) => t.hp > 0).length).toBe(DEFAULT_PARAMS.treeCount);
  });

  it('bots play a timed match to the end', () => {
    const s = createState({ mode: 'lumber', level: 'clearing', winScore: 5 }, { ...DEFAULT_PARAMS, lumberTime: 40 }, 9);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'start', cfg: s.cfg }] }]);
    let fells = 0, ended = false;
    for (let f = 0; f < 60 * 45 && !ended; f++) {
      step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      for (const e of s.events) { if (e.e === 'fell') fells++; if (e.e === 'match') ended = true; }
    }
    console.log('lumber fells', fells, 'scores', s.scores.slice(0, 3), 'winner', s.lastWinner);
    expect(fells).toBeGreaterThan(3);
    expect(ended).toBe(true);
  });
});

describe('throw modes', () => {
  const holdF = Math.round(DEFAULT_PARAMS.aimHoldTime * 60);

  it('a short hold keeps moving and gives a quick throw', () => {
    const s = setup('ffa', 1);
    const [a] = s.players;
    a.x = -10; a.y = -2.6;
    const x0 = a.x;
    run(s, holdF - 10, () => ({ d0: makeInput(1, 0, 0, 0, BTN_THROW) }));
    expect(a.charging).toBe(true);
    expect(a.aiming).toBe(false);
    expect(a.x - x0).toBeGreaterThan(DEFAULT_PARAMS.moveSpeed * 0.5); // still running
    run(s, 1, () => ({ d0: makeInput(1, 0, 0, 0, 0) }));
    const h = s.hats[0];
    expect(h.state).toBe(HAT_OUT);
    expect(h.range).toBe(DEFAULT_PARAMS.hatRange);
  });

  it('holding for aimHoldTime enters stationary aim; the stick aims; release throws powered', () => {
    const s = setup('ffa', 1);
    const [a] = s.players;
    a.x = -10; a.y = -2.6;
    run(s, holdF + 2, () => ({ d0: makeInput(0, 0, 0, 0, BTN_THROW) }));
    expect(a.aiming).toBe(true);
    const x0 = a.x, y0 = a.y;
    // Movement stick now aims (down-right) without moving the player.
    run(s, Math.round(DEFAULT_PARAMS.chargeTime * 60) + 5, () => ({ d0: makeInput(0.7, 0.7, 0, 0, BTN_THROW) }));
    expect(Math.hypot(a.x - x0, a.y - y0)).toBeLessThan(0.05);
    expect(a.fx).toBeCloseTo(Math.SQRT1_2, 2);
    expect(a.fy).toBeCloseTo(Math.SQRT1_2, 2);
    expect(a.charge).toBe(1);
    run(s, 1, () => ({ d0: makeInput(0.7, 0.7, 0, 0, 0) }));
    const h = s.hats[0];
    expect(h.state).toBe(HAT_OUT);
    expect(h.range).toBe(DEFAULT_PARAMS.chargedHatRange);
    expect(a.aiming).toBe(false);
  });
});

describe('boomerang path', () => {
  it('goes straight out and straight back when the thrower stands still', () => {
    const s = setup('ffa', 1);
    const [a] = s.players;
    a.x = -12; a.y = -2.6;
    run(s, 3, (f) => ({ d0: makeInput(0, 0, 1, 0.0001, f < 2 ? BTN_THROW : 0) }));
    const h = s.hats[0];
    let maxX = -1e9, maxDev = 0, caught = false;
    for (let f = 0; f < 150 && !caught; f++) {
      const ev = run(s, 1, () => ({}));
      maxX = Math.max(maxX, h.x);
      maxDev = Math.max(maxDev, Math.abs(h.y - a.y));
      caught = ev.includes('catch');
    }
    expect(caught).toBe(true);
    expect(maxDev).toBeLessThan(0.01);
    expect(maxX - a.x).toBeGreaterThan(DEFAULT_PARAMS.hatRange);
    expect(maxX - a.x).toBeLessThan(DEFAULT_PARAMS.hatRange + 3);
  });

  it('bends on the way back to follow a player who moved', () => {
    const s = setup('ffa', 1);
    const [a] = s.players;
    a.x = -12; a.y = -2.6;
    run(s, 3, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0) }));
    const h = s.hats[0];
    let caught = false, maxDev = 0;
    for (let f = 0; f < 200 && !caught; f++) {
      const ev = run(s, 1, () => ({ d0: makeInput(0, f < 30 ? 1 : 0, 0, 0, 0) })); // walk down a bit
      if (h.state === HAT_OUT) expect(Math.abs(h.y + 2.6)).toBeLessThan(0.01); // outbound stays straight
      maxDev = Math.max(maxDev, Math.abs(h.y + 2.6));
      caught = ev.includes('catch');
    }
    expect(caught).toBe(true);
    expect(maxDev).toBeGreaterThan(1);
  });
});

describe('bad power-ups', () => {
  const grab = (s: GameState, kind: 'slow' | 'reverse') => {
    const a = s.players[0];
    s.pickups.push({ id: 999, kind, x: a.x, y: a.y, t: 0 });
    const ev = run(s, 1, () => ({}));
    expect(ev).toContain('pickup');
  };

  it('slowpoke halves running speed', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = -10; a.y = -2.6;
    grab(s, 'slow');
    const x0 = a.x;
    run(s, 60, () => ({ d0: makeInput(1, 0, 0, 0, 0) }));
    const dist = a.x - x0;
    expect(dist).toBeLessThan(DEFAULT_PARAMS.moveSpeed * DEFAULT_PARAMS.slowMult * 1.05);
    expect(dist).toBeGreaterThan(DEFAULT_PARAMS.moveSpeed * DEFAULT_PARAMS.slowMult * 0.8);
  });

  it('reversed controls flip the movement stick until it wears off', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = 0; a.y = -2.6;
    grab(s, 'reverse');
    const x0 = a.x;
    run(s, 30, () => ({ d0: makeInput(1, 0, 0, 0, 0) }));
    expect(a.x).toBeLessThan(x0 - 1);
    run(s, Math.round(DEFAULT_PARAMS.reverseTime * 60), () => ({}));
    const x1 = a.x;
    run(s, 30, () => ({ d0: makeInput(1, 0, 0, 0, 0) }));
    expect(a.x).toBeGreaterThan(x1 + 1);
  });
});

describe('kicks and invisibility', () => {
  it('a kick knocks a player far back without hurting them', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -4; a.y = -2.6; b.x = -2.9; b.y = -2.6;
    s.hats.find((h) => h.owner === a.id)!.state = HAT_GROUND;
    const ev = run(s, 60, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('kick');
    expect(b.alive).toBe(true);
    expect(b.x - -2.9).toBeGreaterThan(3.5);
  });

  it('kicking the soccer ball sends it flying', () => {
    const s = createState({ mode: 'soccer', level: 'pitch', winScore: 5 }, { ...DEFAULT_PARAMS, powerupMax: 0 }, 3);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'd0', name: 'A', ball: 0, team: 0 }] }]);
    const a = s.players[0];
    s.hats.find((h) => h.owner === a.id)!.state = HAT_GROUND;
    a.x = -1.5; a.y = 0.5; s.ball = { x: 0, y: 0.5, vx: 0, vy: 0, lastTouch: -1 };
    const ev = run(s, 4, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('ballkick');
    expect(s.ball!.vx).toBeGreaterThan(DEFAULT_PARAMS.ballKickImpulse * 0.9);
  });

  it('invisibility hides you except while attacking', async () => {
    const { isInvisible } = await import('../src/sim/common');
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = 0; a.y = -2.6;
    s.pickups.push({ id: 999, kind: 'invis', x: a.x, y: a.y, t: 0 });
    run(s, 1, () => ({}));
    expect(isInvisible(a)).toBe(true);
    run(s, 1, () => ({ d0: makeInput(0, 0, 1, 0, BTN_ATTACK) }));
    expect(isInvisible(a)).toBe(false);
    run(s, Math.round((DEFAULT_PARAMS.invisRevealTime + 0.3) * 60), () => ({}));
    expect(isInvisible(a)).toBe(true);
    run(s, Math.round(DEFAULT_PARAMS.invisTime * 60), () => ({}));
    expect(isInvisible(a)).toBe(false);
  });
});
