import { describe, expect, it } from 'vitest';
import { createState, step } from '../src/sim/sim';
import { TEST_PARAMS as DEFAULT_PARAMS } from './params';
import { BTN_ATTACK, BTN_DASH, BTN_THROW, makeInput, type PlayerInput } from '../src/sim/input';
import { HAT_GROUND, HAT_HELD, HAT_OUT, HAT_RECALL, HAT_RETURN, type GameState, type ModeId, type Prop } from '../src/sim/types';
import { propInfo } from '../src/sim/props';
import { spawnCar } from '../src/sim/actors';

function setup(mode: ModeId = 'teams', n = 2): GameState {
  const s = createState({ mode, level: 'courtyard', winScore: 5 }, { ...DEFAULT_PARAMS, powerupMax: 0 }, 3);
  const cmds = [];
  for (let i = 0; i < n; i++) cmds.push({ t: 'join' as const, device: 'd' + i, name: 'P' + i, ball: i, team: mode === 'teams' ? 0 : undefined });
  step(s, [{ peer: 0, inputs: {}, cmds }]);
  for (const p of s.players) { p.invulnT = 0; }
  s.props = []; // mechanics tests run on a clear arena
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
  it('piggyback: slash a teammate to ride; rider follows mount, mount runs faster', () => {
    const s = setup('teams', 2);
    const [a, b] = s.players;
    a.x = 0; a.y = -2.6; b.x = 1; b.y = -2.6;
    const evOn = run(s, 2, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(evOn).not.toContain('slash');
    expect(a.riding).toBe(b.id);
    expect(b.rider).toBe(a.id);
    const x0 = b.x;
    run(s, 30, () => ({ d1: makeInput(-1, 0, 0, 0, 0) }));
    expect(a.x).toBeCloseTo(b.x, 5);
    // The carrier can't throw while carrying.
    const evm = run(s, 20, (f) => ({ d1: makeInput(0, 0, 1, 0, f < 5 ? BTN_THROW : 0) }));
    expect(evm).not.toContain('throw');
    expect(b.charging).toBe(false);
    // ...but the rider can.
    const evr = run(s, 5, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(evr).toContain('slash');
    // 0.5 s at ~2x speed (minus acceleration).
    expect(x0 - b.x).toBeGreaterThan(DEFAULT_PARAMS.moveSpeed * 0.5 * 1.4);
    // Dash hops off.
    run(s, 2, (f) => ({ d0: makeInput(0, 0, 0, 0, f === 0 ? BTN_DASH : 0) }));
    expect(a.riding).toBe(-1);
    expect(b.rider).toBe(-1);
  });

  it('piggyback: the carrier throws the rider off with slash', () => {
    const s = setup('teams', 2);
    const [a, b] = s.players;
    a.x = 0; a.y = -2.6; b.x = 1; b.y = -2.6;
    run(s, 2, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(a.riding).toBe(b.id);
    const ev = run(s, 2, (f) => ({ d1: makeInput(0, 0, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('piggy');
    expect(ev).not.toContain('slash');
    expect(a.riding).toBe(-1);
    expect(b.rider).toBe(-1);
    expect(a.alive && b.alive).toBe(true);
  });

  it('car: enter, drive, run over enemy', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -8; a.y = 2.5; b.x = 8; b.y = 2.5; a.fx = 1; a.fy = 0;
    spawnCar(s, -7, 2.5, 0);
    const ev = run(s, 120, (f) => ({ d0: makeInput(0, -1, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
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
    const t = s.props.find((t) => t.kind === 'tree' && !t.fixed)!;
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
    expect(s.props.filter((t) => t.kind === 'tree' && !t.fixed && t.hp > 0).length).toBe(DEFAULT_PARAMS.treeCount);
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

describe('slash duration and slowpoke dash', () => {
  it('a hat entering the arc late in the swing is still knocked down', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -12; a.y = -2.6; b.x = 0; b.y = -2.6;
    const windup = Math.round(DEFAULT_PARAMS.slashWindup * 60), active = Math.round(DEFAULT_PARAMS.slashActive * 60);
    // Put a's hat in flight toward b so that it reaches b's arc only near the end of b's swing.
    const h = s.hats.find((x) => x.owner === a.id)!;
    const reach = DEFAULT_PARAMS.slashRange + DEFAULT_PARAMS.hatRadius;
    const framesToArc = windup + active - 1;
    Object.assign(h, { state: HAT_OUT, x: b.x - reach - 20 * framesToArc / 60, y: b.y, vx: 20, vy: 0, speed: 20, dist: 0, range: 99, t: 0 });
    const ev = run(s, windup + active + 2, (f) => ({ d1: makeInput(0, 0, -1, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('parry');
    expect(b.alive).toBe(true);
  });

  it('slowpoke also slows the dash', () => {
    const dashDist = (slow: boolean) => {
      const s = setup('ffa', 1);
      const a = s.players[0];
      a.x = -10; a.y = -2.6;
      if (slow) a.slowT = 600;
      const x0 = a.x;
      run(s, Math.round(DEFAULT_PARAMS.dashTime * 60), (f) => ({ d0: makeInput(1, 0, 0, 0, f === 0 ? 1 : 0) }));
      return a.x - x0;
    };
    const normal = dashDist(false), slowed = dashDist(true);
    expect(slowed).toBeLessThan(normal * (DEFAULT_PARAMS.slowMult + 0.1));
  });
});

describe('cars mode', () => {
  it('keeps the chosen number of cars on the field and bots drive them', () => {
    const cfg = { mode: 'cars' as const, level: 'raceway', winScore: 99, cars: 3 };
    const s = createState(cfg, DEFAULT_PARAMS, 5);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'addBot' }, { t: 'start', cfg }] }]);
    expect(s.cars.length).toBe(3);
    let carKills = 0, enters = 0, minCars = 99, rounds = 0, fullFrames = 0, playFrames = 0;
    for (let f = 0; f < 60 * 60; f++) {
      step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      for (const e of s.events) {
        if (e.e === 'car' && e.what === 'enter') enters++;
        if (e.e === 'kill' && s.players[e.killer]?.car !== -1) carKills++;
        if (e.e === 'round') rounds++;
      }
      if (s.phase === 'playing' && s.phaseT > 120) {
        minCars = Math.min(minCars, s.cars.length);
        playFrames++;
        if (s.cars.length === 3) fullFrames++;
      }
    }
    console.log('cars mode: enters', enters, 'car kills', carKills, 'rounds', rounds, 'min cars', minCars);
    expect(enters).toBeGreaterThan(2);
    expect(carKills).toBeGreaterThan(0);
    expect(rounds).toBeGreaterThan(0);
    expect(minCars).toBeGreaterThanOrEqual(1); // never an empty field
    expect(fullFrames / playFrames).toBeGreaterThan(0.6); // wrecks are replaced quickly
  });
});

describe('driving', () => {
  it('slash gets you into a car; you can throw exactly along the stick while driving and catch it back', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = -8; a.y = 2.5;
    spawnCar(s, -7, 2.5, 0);
    const ev = run(s, 2, (f) => ({ d0: makeInput(0, 0, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('car');
    expect(ev).not.toContain('slash');
    expect(a.car).toBeGreaterThan(0);
    // Drive forward while throwing straight "up" with the aim stick.
    const ev2 = run(s, 3, (f) => ({ d0: makeInput(0, -1, 0, -1, f === 0 ? BTN_THROW : 0) }));
    expect(ev2).toContain('throw');
    const h = s.hats[0];
    expect(h.vx).toBeCloseTo(0, 5);
    expect(h.vy).toBeLessThan(0);
    // The hat comes back to the car.
    const ev3 = run(s, 120, () => ({ d0: makeInput(0, 0, 0, 0, 0) }));
    expect(ev3).toContain('catch');
    // Slash again to get out.
    run(s, 2, (f) => ({ d0: makeInput(0, 0, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(a.car).toBe(-1);
  });
});

describe('bot difficulty', () => {
  it('hard bots outfight easy bots', () => {
    let hard = 0, easy = 0;
    for (const seed of [1, 2, 3]) {
      const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 99 };
      const s = createState(cfg, { ...DEFAULT_PARAMS, powerupMax: 0 }, seed);
      step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot', skill: 3 }, { t: 'addBot', skill: 1 }, { t: 'addBot', skill: 3 }, { t: 'addBot', skill: 1 }, { t: 'start', cfg }] }]);
      for (let f = 0; f < 60 * 90; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      for (const p of s.players) { if (p.skill === 3) hard += p.kills; else easy += p.kills; }
    }
    console.log('kills: hard', hard, 'easy', easy);
    expect(hard).toBeGreaterThan(easy * 1.5);
  });
});

describe('lobby commands', () => {
  it('setSkill changes only that bot', () => {
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 1);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot' }, { t: 'addBot' }] }]);
    const [b1, b2] = s.players;
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'setSkill', device: b1.device, skill: 0 }] }]);
    expect(b1.skill).toBe(0);
    expect(b2.skill).toBe(2);
    expect(b2.active).toBe(true);
  });
});

describe('breakables', () => {
  const place = (s: GameState, kind: Prop['kind'], x: number, y: number): Prop => {
    const t: Prop = { id: 777, kind, x, y, hp: propInfo(s, kind).hp, regrowT: 0, grow: 30, fixed: true };
    s.props.push(t);
    return t;
  };
  const slashAt = (s: GameState, times: number) => {
    const ev: string[] = [];
    for (let i = 0; i < times; i++) ev.push(...run(s, 40, (f) => ({ d0: makeInput(0, 0, 1, 0, f === 0 ? BTN_ATTACK : 0) })));
    return ev;
  };

  it('levels place several kinds of breakables', () => {
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 1);
    const kinds = new Set(s.props.map((t) => t.kind));
    expect([...kinds].sort()).toEqual(['barrel', 'bush', 'crate', 'rock', 'tree']);
  });

  it('rocks take 5 hits, crates 2', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = -4; a.y = -2.6;
    const rock = place(s, 'rock', -2.4, -2.6);
    slashAt(s, 4);
    expect(rock.hp).toBe(1);
    expect(slashAt(s, 1)).toContain('fell');
    const crate = place(s, 'crate', -2.4, -2.6); crate.id = 778;
    slashAt(s, 1);
    expect(crate.hp).toBe(1);
  });

  it('an explosive barrel pops everyone nearby, including whoever broke it', () => {
    const s = setup('ffa', 2);
    const [a, b] = s.players;
    a.x = -4; a.y = -2.6; b.x = -1.5; b.y = -1.2;
    place(s, 'barrel', -2.7, -2.6);
    const ev = slashAt(s, 1);
    expect(ev).toContain('boom');
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
  });

  it('hats bounce off crates but pass through bushes', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = -12; a.y = -2.6;
    const bush = place(s, 'bush', -9, -2.6);
    run(s, 3, (f) => ({ d0: makeInput(0, 0, 1, 0, f < 2 ? BTN_THROW : 0) }));
    const ev = run(s, 20, () => ({}));
    expect(ev).toContain('chop');
    expect(ev).not.toContain('bounce');
    expect(bush.hp).toBe(0);
  });

  it('level breakables regrow in place', () => {
    const s = setup('ffa', 1);
    const a = s.players[0];
    a.x = -4; a.y = -2.6;
    const crate = place(s, 'crate', -2.4, -2.6);
    slashAt(s, 2);
    expect(crate.hp).toBe(0);
    a.x = 5; a.y = 5;
    run(s, Math.round(DEFAULT_PARAMS.propRegrowTime * 60) + 2, () => ({}));
    const back = s.props.find((t) => t.kind === 'crate' && t.x === -2.4)!;
    expect(back.hp).toBe(2);
  });
});

describe('level layouts', () => {
  it('placed breakables are clear of walls and spawn points', async () => {
    const { LEVELS } = await import('../src/sim/level');
    const { circleOverlapsWalls } = await import('../src/sim/collision');
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 1);
    for (const L of Object.values(LEVELS)) {
      for (const pr of L.props) {
        const r = propInfo(s, pr.kind).r;
        expect(circleOverlapsWalls(pr.x, pr.y, r + 0.3, L.walls, false), `${L.id} ${pr.kind} @${pr.x},${pr.y} hits a wall`).toBe(false);
        for (const sp of L.spawns) expect(Math.hypot(sp.x - pr.x, sp.y - pr.y), `${L.id} ${pr.kind} near spawn`).toBeGreaterThan(r + 1.2);
      }
    }
  });
});

describe('overlord bomb hats', () => {
  const setupHazard = () => {
    const cfg = { mode: 'hazard' as const, level: 'clearing', winScore: 99 };
    const s = createState(cfg, { ...DEFAULT_PARAMS, powerupMax: 0, bombRadius: 0.5 }, 4);
    step(s, [{ peer: 0, inputs: {}, cmds: [
      { t: 'join', device: 'o', name: 'O', ball: 0 }, { t: 'join', device: 'r', name: 'R', ball: 1 },
      { t: 'setRole', device: 'o', role: 'overlord' }, { t: 'start', cfg },
    ] }]);
    while (s.phase !== 'playing') step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
    s.props = [];
    return s;
  };

  it('a bomb bursts into hats that fly out, come back to the target and vanish', () => {
    const s = setupHazard();
    const [o, r] = s.players;
    r.x = 12; r.y = 8; r.invulnT = 0;
    o.cursorX = 0; o.cursorY = 0;
    const ev = run(s, Math.round(DEFAULT_PARAMS.bombFallTime * 60) + 2, (f) => ({ o: makeInput(0, 0, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
    expect(ev).toContain('boom');
    const hats = s.hats.filter((h) => h.bomb);
    expect(hats.length).toBe(DEFAULT_PARAMS.bombHats);
    const maxOut = Math.max(...Array.from({ length: 60 }, () => { run(s, 1, () => ({})); return Math.max(0, ...s.hats.filter((h) => h.bomb).map((h) => Math.hypot(h.x, h.y))); }));
    expect(maxOut).toBeGreaterThan(DEFAULT_PARAMS.bombHatRange * 0.9);
    run(s, 180, () => ({}));
    expect(s.hats.filter((h) => h.bomb).length).toBe(0);
  });

  it('bomb hats return to the newest bomb target and kill runners in the way', () => {
    const s = setupHazard();
    const [o, r] = s.players;
    o.cursorX = -6; o.cursorY = 0;
    run(s, Math.round(DEFAULT_PARAMS.bombFallTime * 60) + 2, (f) => ({ o: makeInput(0, 0, 0, 0, f === 0 ? BTN_ATTACK : 0) }));
    // Launch a second bomb far away; the first bomb's hats should head there.
    o.bombCd = 0; o.cursorX = 6; o.cursorY = 0;
    run(s, 1, () => ({ o: makeInput(0, 0, 0, 0, BTN_ATTACK) }));
    r.x = 0; r.y = 0; r.invulnT = 0; // standing between the two targets
    const ev = run(s, 120, () => ({}));
    expect(ev).toContain('kill');
    expect(r.alive).toBe(false);
  });
});

describe('names', () => {
  it('setName renames your own player (trimmed, max 16 chars)', () => {
    const s = createState({ mode: 'ffa', level: 'courtyard', winScore: 5 }, DEFAULT_PARAMS, 1);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'join', device: 'kbm', name: 'Player', ball: 0 }] }]);
    step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'setName', device: 'kbm', name: '  Yotam the Magnificent  ' }] }]);
    expect(s.players[0].name).toBe('Yotam the Magnif');
    step(s, [{ peer: 1, inputs: {}, cmds: [{ t: 'setName', device: 'kbm', name: 'Hacker' }] }]); // another peer can't
    expect(s.players[0].name).toBe('Yotam the Magnif');
  });
});

describe('lobby settings', () => {
  it('any peer can change settings and start from the lobby, but not abort a match', () => {
    const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 5 };
    const s = createState(cfg, DEFAULT_PARAMS, 1);
    step(s, [{ peer: 1, inputs: {}, cmds: [{ t: 'lobby', cfg: { mode: 'soccer', level: 'pitch', winScore: 3 } }] }]);
    expect(s.cfg.mode).toBe('soccer');
    expect(s.cfg.level).toBe('pitch');
    step(s, [{ peer: 1, inputs: {}, cmds: [{ t: 'start', cfg: s.cfg }] }]);
    expect(s.phase).not.toBe('lobby'); // anyone can start from the lobby
    step(s, [{ peer: 1, inputs: {}, cmds: [{ t: 'lobby', cfg }] }]);
    expect(s.phase).not.toBe('lobby'); // a client can't abort the match
    expect(s.cfg.mode).toBe('soccer');
  });
});

describe('extra easy bots', () => {
  it('extra easy bots are less dangerous than easy bots', () => {
    let extra = 0, easy = 0;
    for (const seed of [1, 2, 3]) {
      const cfg = { mode: 'ffa' as const, level: 'courtyard', winScore: 99 };
      const s = createState(cfg, { ...DEFAULT_PARAMS, powerupMax: 0 }, seed);
      step(s, [{ peer: 0, inputs: {}, cmds: [{ t: 'addBot', skill: 0 }, { t: 'addBot', skill: 1 }, { t: 'addBot', skill: 0 }, { t: 'addBot', skill: 1 }, { t: 'start', cfg }] }]);
      s.props = [];
      for (let f = 0; f < 60 * 90; f++) step(s, [{ peer: 0, inputs: {}, cmds: [] }]);
      for (const p of s.players) { if (p.skill === 0) extra += p.kills; else easy += p.kills; }
    }
    console.log('kills: extra easy', extra, 'easy', easy);
    expect(extra).toBeLessThan(easy);
  });
});
