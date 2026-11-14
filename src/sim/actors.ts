// Players, hats, cars and combat.

import { DT, HZ, allies, teamOf, isTeamMode } from './const';
import { clamp, dcos, dsin, dist2, frames, len, lerp, PI, rotate } from './dmath';
import { collideCircle, circleOverlapsWalls, type Push } from './collision';
import {
  BTN_ATTACK, BTN_DASH, BTN_INTERACT, BTN_THROW, type PlayerInput,
} from './input';
import {
  HAT_GROUND, HAT_HELD, HAT_OUT, HAT_RECALL, HAT_RETURN,
  type Car, type GameState, type Hat, type Player,
} from './types';
import {
  canBeHit, detach, die, dropHat, emit, heldHats, kill, level, sec,
} from './common';

const tmp: Push = { x: 0, y: 0, hit: false, nx: 0, ny: 0 };

export function canAct(s: GameState): boolean {
  return s.phase !== 'countdown';
}

// ---------------------------------------------------------------------------
// Players

export function updatePlayer(s: GameState, p: Player, inp: PlayerInput): void {
  const P = s.params;
  const pressed = inp.b & ~p.prevB;
  const released = p.prevB & ~inp.b;
  p.prevB = inp.b;

  if (p.invulnT > 0) p.invulnT--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.slashCd > 0) p.slashCd--;
  if (p.speedT > 0) p.speedT--;
  if (p.phaseT > 0) p.phaseT--;
  if (p.stunT > 0) p.stunT--;

  if (p.car >= 0) {
    const car = s.cars.find((c) => c.id === p.car);
    if (!car) { p.car = -1; }
    else {
      driveCar(s, p, car, inp, pressed);
      return;
    }
  }

  let mx = inp.mx / 127, my = inp.my / 127;
  const ml = len(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const ax = inp.ax / 127, ay = inp.ay / 127;
  const al = len(ax, ay);

  // Facing: explicit aim wins, otherwise movement direction.
  if (al > 0.3) { p.fx = ax / al; p.fy = ay / al; }
  else if (ml > 0.2 && !p.charging) { p.fx = mx / ml; p.fy = my / ml; }

  const held = heldHats(s, p);

  // --- Interact: piggyback / car
  if (pressed & BTN_INTERACT) interact(s, p);

  // --- Attack (slash with hat, kick without)
  if ((pressed & BTN_ATTACK) && p.slashCd <= 0 && p.slashT < 0 && p.stunT <= 0) {
    p.slashT = 0;
    p.slashKind = held > 0 ? 0 : 1;
    const cd = sec(s, 'slashCooldown') + sec(s, 'slashWindup') + sec(s, 'slashActive');
    p.slashCd = p.maxHats > 1 && held > 0 ? Math.ceil(cd / 2) : cd;
    emit(s, { e: 'slash', who: p.id, kind: p.slashKind });
  } else if (p.slashT >= 0) {
    p.slashT++;
    if (p.slashT > sec(s, 'slashWindup') + sec(s, 'slashActive')) p.slashT = -1;
  }

  // --- Throw / charge / recall
  if (inp.b & BTN_THROW) {
    if (held > 0 && (p.charging || (pressed & BTN_THROW))) {
      p.charging = true;
      p.charge = Math.min(1, p.charge + DT / Math.max(0.01, P.chargeTime));
    } else if (held === 0 && !p.charging) {
      p.recalling = true;
    }
  } else {
    p.recalling = false;
  }
  if ((released & BTN_THROW) && p.charging) {
    throwHat(s, p);
  }
  if (held === 0 && p.charging) { p.charging = false; p.charge = 0; }

  // --- Riding: position follows the mount; rider can aim and attack freely.
  if (p.riding >= 0) {
    const m = s.players[p.riding];
    if (!m || !m.alive) { detach(s, p); }
    else { p.x = m.x; p.y = m.y; p.vx = m.vx; p.vy = m.vy; return; }
  }

  // --- Dash
  if ((pressed & BTN_DASH) && p.dashCd <= 0 && p.stunT <= 0 && p.dashT <= 0) {
    let dx = mx, dy = my;
    const dl = len(dx, dy);
    if (dl < 0.2) { dx = p.fx; dy = p.fy; } else { dx /= dl; dy /= dl; }
    p.dashDx = dx; p.dashDy = dy;
    p.dashT = sec(s, 'dashTime');
    p.dashCd = sec(s, 'dashCooldown') + p.dashT;
    emit(s, { e: 'dash', who: p.id });
  }

  // --- Movement
  let speed = P.moveSpeed;
  if (p.speedT > 0) speed *= P.speedBoostMult;
  if (p.rider >= 0) speed *= P.piggyMountSpeedMult;
  if (p.charging) speed *= P.aimMoveFactor;
  const control = p.stunT > 0 ? 0 : 1;
  const tx = mx * speed * control, ty = my * speed * control;
  const a = Math.min(1, P.moveAccel * DT);
  p.vx += (tx - p.vx) * a;
  p.vy += (ty - p.vy) * a;

  const phasing = p.phaseT > 0 && p.dashT > 0;
  let vx = p.vx + p.kx, vy = p.vy + p.ky;
  if (p.dashT > 0) {
    vx = p.dashDx * P.dashSpeed; vy = p.dashDy * P.dashSpeed;
    p.dashT--;
    p.vx = p.dashDx * speed; p.vy = p.dashDy * speed;
  }
  const decay = Math.max(0, 1 - P.knockbackDecay * DT);
  p.kx *= decay; p.ky *= decay;

  p.x += vx * DT; p.y += vy * DT;
  const L = level(s);
  if (phasing) {
    // Only the outer border stops a phase dash.
    keepInBounds(s, p);
    // Never end a dash inside a wall: extend it until clear.
    if (p.dashT <= 0 && circleOverlapsWalls(p.x, p.y, P.playerRadius, L.walls, false)) p.dashT = 1;
  } else {
    collideCircle(p.x, p.y, P.playerRadius, L.walls, false, tmp);
    p.x = tmp.x; p.y = tmp.y;
    if (tmp.hit) {
      // Remove velocity into the wall.
      const vn = p.vx * tmp.nx + p.vy * tmp.ny;
      if (vn < 0) { p.vx -= vn * tmp.nx; p.vy -= vn * tmp.ny; }
      const kn = p.kx * tmp.nx + p.ky * tmp.ny;
      if (kn < 0) { p.kx -= 1.6 * kn * tmp.nx; p.ky -= 1.6 * kn * tmp.ny; }
    }
  }
}

function keepInBounds(s: GameState, p: Player): void {
  const L = level(s), r = s.params.playerRadius;
  p.x = clamp(p.x, -L.w + r, L.w - r);
  p.y = clamp(p.y, -L.h + r, L.h - r);
}

function interact(s: GameState, p: Player): void {
  if (p.riding >= 0) {
    const m = s.players[p.riding];
    emit(s, { e: 'piggy', what: 'off', who: p.id, mount: p.riding });
    detach(s, p);
    if (m) { p.x = m.x - m.fx * 1.2; p.y = m.y - m.fy * 1.2; }
    return;
  }
  // Enter a nearby free car.
  for (const c of s.cars) {
    if (c.dead || c.driver >= 0) continue;
    if (dist2(p.x, p.y, c.x, c.y) < 2.2 * 2.2) {
      detach(s, p);
      c.driver = p.id; p.car = c.id;
      if (c.t <= 0) c.t = sec(s, 'carTime');
      p.charging = false; p.charge = 0;
      emit(s, { e: 'car', what: 'enter', who: p.id, x: c.x, y: c.y });
      return;
    }
  }
  // Hop on a teammate's back.
  if (!isTeamMode(s.cfg.mode) || p.rider >= 0) return;
  let best: Player | null = null, bestD = 1.8 * 1.8;
  for (const o of s.players) {
    if (o === p || !o.active || !o.alive || o.role !== 'fighter') continue;
    if (!allies(s, p, o) || o.riding >= 0 || o.rider >= 0 || o.car >= 0) continue;
    const d = dist2(p.x, p.y, o.x, o.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  if (best) {
    p.riding = best.id; best.rider = p.id;
    p.dashT = 0;
    emit(s, { e: 'piggy', what: 'on', who: p.id, mount: best.id });
  }
}

function throwHat(s: GameState, p: Player): void {
  const P = s.params;
  const h = s.hats.find((h) => h.owner === p.id && h.state === HAT_HELD);
  if (!h) return;
  const c = p.charge;
  // A tiny tap (charge ~ 0) gives the base throw; holding interpolates up.
  const t = clamp((c * P.chargeTime - 0.08) / Math.max(0.01, P.chargeTime - 0.08), 0, 1);
  h.state = HAT_OUT;
  h.speed = lerp(P.hatSpeed, P.chargedHatSpeed, t);
  h.range = lerp(P.hatRange, P.chargedHatRange, t);
  h.vx = p.fx * h.speed; h.vy = p.fy * h.speed;
  h.x = p.x + p.fx * 0.5; h.y = p.y + p.fy * 0.5;
  h.dist = 0; h.t = 0;
  p.charging = false; p.charge = 0;
  emit(s, { e: 'throw', who: p.id, hat: h.id, charge: t });
}

// ---------------------------------------------------------------------------
// Player-vs-player body collisions (soft push apart).

export function separatePlayers(s: GameState): void {
  const r = s.params.playerRadius;
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!a.active || !a.alive || a.role !== 'fighter' || a.riding >= 0 || a.car >= 0) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!b.active || !b.alive || b.role !== 'fighter' || b.riding >= 0 || b.car >= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const m = 2 * r;
      if (d2 >= m * m) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
      const push = (m - d) * 0.5;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

// ---------------------------------------------------------------------------
// Melee resolution. All attacks whose windup ends this frame resolve together
// so that near-simultaneous mutual slashes become clashes.

export function resolveMelee(s: GameState): void {
  const P = s.params;
  const windup = sec(s, 'slashWindup');
  const activeF = sec(s, 'slashActive');
  const clashF = sec(s, 'clashWindow');
  const cosArc = dcos((P.slashArcDeg * PI) / 360);
  const hitting = s.players.filter((p) => p.active && p.alive && p.slashT === windup && p.role === 'fighter');
  if (hitting.length === 0) return;

  const inArc = (a: Player, x: number, y: number, range: number): boolean => {
    const dx = x - a.x, dy = y - a.y;
    const d = len(dx, dy);
    if (d > range) return false;
    if (d < 0.3) return true;
    return (dx * a.fx + dy * a.fy) / d >= cosArc;
  };

  const kills: [Player, Player][] = [];
  const clashed = new Set<number>();
  for (const a of hitting) {
    if (clashed.has(a.id)) continue;
    const range = (a.slashKind === 0 ? P.slashRange : P.kickRange) + P.hitRadius;
    for (const b of s.players) {
      if (b === a || !b.active || !b.alive || b.role !== 'fighter' || allies(s, a, b)) continue;
      if (b.car >= 0) continue;
      if (!inArc(a, b.x, b.y, range)) continue;
      if (a.slashKind === 0) {
        // Clash: b is mid-slash (started within the clash window) and a is in b's reach.
        const bRange = P.slashRange + P.hitRadius;
        const bSlashing = b.slashT >= 0 && b.slashKind === 0 && b.slashT <= windup + Math.max(clashF, activeF);
        if (bSlashing && !clashed.has(b.id) && dist2(a.x, a.y, b.x, b.y) <= bRange * bRange) {
          clashed.add(a.id); clashed.add(b.id);
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(0.01, len(dx, dy));
          const kb = P.clashKnockback;
          a.kx -= (dx / d) * kb; a.ky -= (dy / d) * kb;
          b.kx += (dx / d) * kb; b.ky += (dy / d) * kb;
          a.slashT = -1; b.slashT = -1;
          a.stunT = b.stunT = sec(s, 'stunTime');
          emit(s, { e: 'clash', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          break;
        }
        kills.push([a, b]);
      } else {
        // Kick: knockback, no damage.
        if (b.invulnT > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(0.01, len(dx, dy));
        b.kx += (dx / d) * P.kickKnockback; b.ky += (dy / d) * P.kickKnockback;
        b.stunT = sec(s, 'stunTime');
        if (b.rider >= 0 || b.riding >= 0) detach(s, b);
        emit(s, { e: 'kick', who: a.id, target: b.id });
      }
    }
  }
  for (const [a, b] of kills) {
    if (clashed.has(a.id)) continue;
    kill(s, b, a.id);
  }

  // Slashes knock thrown hats out of the air; slashes and kicks hit the ball.
  for (const a of hitting) {
    if (clashed.has(a.id)) continue;
    const range = (a.slashKind === 0 ? P.slashRange : P.kickRange);
    if (a.slashKind === 0) {
      for (const h of s.hats) {
        if (h.owner === a.id) continue;
        if (h.state !== HAT_OUT && h.state !== HAT_RETURN && h.state !== HAT_RECALL) continue;
        if (!inArc(a, h.x, h.y, range + P.hatRadius)) continue;
        dropHat(s, h);
        emit(s, { e: 'parry', who: a.id, hat: h.id, x: h.x, y: h.y });
      }
    }
    const ball = s.ball;
    if (ball && inArc(a, ball.x, ball.y, range + P.ballRadius)) {
      const imp = P.ballSlashImpulse * (a.slashKind === 0 ? 1 : 0.8);
      ball.vx = a.fx * imp + a.vx * 0.5; ball.vy = a.fy * imp + a.vy * 0.5;
      ball.lastTouch = a.id;
    }
  }
}

// ---------------------------------------------------------------------------
// Hats

export function updateHats(s: GameState): void {
  const P = s.params;
  const L = level(s);
  for (const h of s.hats) {
    h.t++;
    const owner = s.players[h.owner];
    if (!owner || !owner.active) { h.state = HAT_GROUND; continue; }
    if (h.state === HAT_HELD) { h.x = owner.x; h.y = owner.y; continue; }
    if (h.state === HAT_GROUND) {
      if (owner.alive && owner.role === 'fighter' && owner.car < 0 &&
          dist2(owner.x, owner.y, h.x, h.y) < (P.playerRadius + P.hatRadius + 0.2) ** 2) {
        h.state = HAT_HELD; h.t = 0;
        emit(s, { e: 'catch', who: owner.id, hat: h.id });
      } else if (owner.recalling && owner.alive) {
        h.state = HAT_RECALL; h.speed = 0; h.t = 0;
      }
      continue;
    }

    if (h.state === HAT_OUT) {
      if (h.dist >= h.range) { h.state = HAT_RETURN; h.t = 0; }
    }
    if (h.state === HAT_RETURN) {
      if (!owner.alive) { dropHat(s, h); continue; }
      // Home toward the owner: steer velocity, keep speed.
      const dx = owner.x - h.x, dy = owner.y - h.y, d = Math.max(0.001, len(dx, dy));
      h.speed += (P.hatReturnSpeed - h.speed) * Math.min(1, 4 * DT);
      // Turn toward the owner at a limited rate (tightening over time so it
      // always comes back). Turning by an angle, rather than blending
      // vectors, also handles the owner being directly behind the hat.
      const ang = (P.hatHoming / 10) * DT * (1 + h.t / 20);
      const vl = Math.max(0.001, len(h.vx, h.vy));
      let ux = h.vx / vl, uy = h.vy / vl;
      const tx = dx / d, ty = dy / d;
      if (ux * tx + uy * ty >= dcos(ang)) { ux = tx; uy = ty; }
      else {
        let cross = ux * ty - uy * tx;
        // Owner (nearly) straight behind: curve toward the arena center.
        if (Math.abs(cross) < 0.05) cross = ux * -h.y - uy * -h.x;
        [ux, uy] = rotate(ux, uy, cross >= 0 ? ang : -ang);
      }
      h.vx = ux * h.speed; h.vy = uy * h.speed;
    }
    if (h.state === HAT_RECALL) {
      if (!owner.alive) { dropHat(s, h); continue; }
      const dx = owner.x - h.x, dy = owner.y - h.y, d = Math.max(0.001, len(dx, dy));
      if (owner.recalling) {
        h.speed = Math.min(P.recallMaxSpeed, h.speed + P.recallAccel * DT);
        h.vx = (dx / d) * h.speed; h.vy = (dy / d) * h.speed;
      } else {
        h.speed = Math.max(0, h.speed - P.recallAccel * 2 * DT);
        const vl = Math.max(0.001, len(h.vx, h.vy));
        h.vx = (h.vx / vl) * h.speed; h.vy = (h.vy / vl) * h.speed;
        if (h.speed < 0.3) {
          h.state = HAT_GROUND; h.speed = 0; h.vx = h.vy = 0;
          // Don't land inside a wall.
          collideCircle(h.x, h.y, P.hatRadius, L.walls, false, tmp);
          h.x = tmp.x; h.y = tmp.y;
          continue;
        }
      }
    }

    // Integrate in substeps so fast hats don't tunnel.
    const steps = 2;
    for (let k = 0; k < steps; k++) {
      h.x += (h.vx * DT) / steps; h.y += (h.vy * DT) / steps;
      if (h.state === HAT_OUT) h.dist += (h.speed * DT) / steps;
      // Recalled hats lift up and fly over walls.
      if (h.state === HAT_RECALL) continue;
      collideCircle(h.x, h.y, P.hatRadius * 0.6, L.walls, true, tmp);
      if (tmp.hit) {
        h.x = tmp.x; h.y = tmp.y;
        dropHat(s, h);
        break;
      }
    }
    if (h.state === HAT_GROUND) continue;

    // Catch.
    if ((h.state === HAT_RETURN || h.state === HAT_RECALL) && owner.alive && owner.car < 0 &&
        dist2(owner.x, owner.y, h.x, h.y) < P.catchRadius * P.catchRadius) {
      h.state = HAT_HELD; h.t = 0; h.vx = h.vy = 0;
      emit(s, { e: 'catch', who: owner.id, hat: h.id });
    }
  }

  // Hat-vs-hat: two flying hats from different owners knock each other down.
  const flying = s.hats.filter((h) => h.state === HAT_OUT || h.state === HAT_RETURN);
  for (let i = 0; i < flying.length; i++) {
    for (let j = i + 1; j < flying.length; j++) {
      const a = flying[i], b = flying[j];
      if (a.owner === b.owner || a.state === HAT_GROUND || b.state === HAT_GROUND) continue;
      const r = P.hatRadius * 2;
      if (dist2(a.x, a.y, b.x, b.y) < r * r) { dropHat(s, a); dropHat(s, b); }
    }
  }
}

export function isLethal(s: GameState, h: Hat): boolean {
  if (h.state === HAT_OUT || h.state === HAT_RETURN) return true;
  return h.state === HAT_RECALL && h.speed >= s.params.recallLethalSpeed;
}

export function resolveHatHits(s: GameState): void {
  const P = s.params;
  for (const h of s.hats) {
    if (!isLethal(s, h)) continue;
    const owner = s.players[h.owner];
    for (const p of s.players) {
      if (p.id === h.owner || !canBeHit(p) || p.car >= 0) continue;
      if (owner && allies(s, owner, p)) continue;
      const r = P.hatRadius + P.hitRadius;
      if (dist2(p.x, p.y, h.x, h.y) < r * r) kill(s, p, h.owner);
    }
    // Hats wreck cars (and their drivers).
    for (const c of s.cars) {
      if (c.dead || c.driver < 0 || c.driver === h.owner) continue;
      const d = s.players[c.driver];
      if (owner && d && allies(s, owner, d)) continue;
      if (dist2(c.x, c.y, h.x, h.y) < (1.2 + P.hatRadius) ** 2) {
        crashCar(s, c);
        if (d && d.alive) { d.invulnT = 0; die(s, d, h.owner); }
        dropHat(s, h);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cars

function setHeading(c: Car, a: number): void {
  c.heading = a - 2 * PI * Math.round(a / (2 * PI));
  c.hx = dcos(c.heading); c.hy = dsin(c.heading);
}

export function spawnCar(s: GameState, x: number, y: number, heading: number): Car {
  const c: Car = { id: s.nextId++, x, y, hx: 1, hy: 0, heading: 0, speed: 0, driver: -1, t: 0, dead: false };
  setHeading(c, heading);
  s.cars.push(c);
  return c;
}

function driveCar(s: GameState, p: Player, c: Car, inp: PlayerInput, pressed: number): void {
  const P = s.params;
  if (pressed & BTN_INTERACT) {
    exitCar(s, p, c);
    return;
  }
  // Car controls: up/down = throttle/brake, left/right = steer (screen space).
  const throttle = -inp.my / 127 + ((inp.b & BTN_DASH) ? 1 : 0);
  const steer = inp.mx / 127;
  c.speed += clamp(throttle, -1, 1) * P.carAccel * DT;
  c.speed -= c.speed * 0.8 * DT; // drag
  c.speed = clamp(c.speed, -P.carMaxSpeed * 0.4, P.carMaxSpeed);
  const turn = steer * P.carTurnRate * DT * clamp(c.speed / 6, -1, 1);
  setHeading(c, c.heading + turn);
  p.fx = c.hx; p.fy = c.hy;
  p.x = c.x; p.y = c.y; p.vx = c.hx * c.speed; p.vy = c.hy * c.speed;
}

function exitCar(s: GameState, p: Player, c: Car): void {
  c.driver = -1; p.car = -1;
  p.x = c.x - c.hy * 1.6; p.y = c.y + c.hx * 1.6;
  collideCircle(p.x, p.y, s.params.playerRadius, level(s).walls, false, tmp);
  p.x = tmp.x; p.y = tmp.y;
  p.vx = p.vy = 0;
  emit(s, { e: 'car', what: 'exit', who: p.id, x: c.x, y: c.y });
}

export function crashCar(s: GameState, c: Car): void {
  if (c.dead) return;
  c.dead = true;
  emit(s, { e: 'car', what: 'crash', who: c.driver, x: c.x, y: c.y });
  if (c.driver >= 0) {
    const p = s.players[c.driver];
    if (p) { p.car = -1; p.x = c.x; p.y = c.y; }
    c.driver = -1;
  }
}

export function updateCars(s: GameState): void {
  const P = s.params;
  const L = level(s);
  for (const c of s.cars) {
    if (c.dead) continue;
    if (c.driver >= 0) {
      const d = s.players[c.driver];
      if (!d || !d.active || !d.alive || d.car !== c.id) { c.driver = -1; }
      else if (--c.t <= 0) { crashCar(s, c); continue; }
    } else {
      c.speed -= c.speed * 3 * DT;
    }
    c.x += c.hx * c.speed * DT; c.y += c.hy * c.speed * DT;
    collideCircle(c.x, c.y, 1.0, L.walls, false, tmp);
    if (tmp.hit) { c.x = tmp.x; c.y = tmp.y; c.speed *= -0.3; }
    if (c.driver >= 0) {
      const d = s.players[c.driver];
      d.x = c.x; d.y = c.y;
      // Run people over.
      if (Math.abs(c.speed) >= P.carKillSpeed) {
        for (const o of s.players) {
          if (o.id === d.id || !canBeHit(o) || o.car >= 0 || allies(s, d, o)) continue;
          if (dist2(o.x, o.y, c.x + c.hx * 0.5, c.y + c.hy * 0.5) < (1.1 + P.hitRadius) ** 2) kill(s, o, d.id);
        }
      }
      // Bump the ball.
      if (s.ball && dist2(s.ball.x, s.ball.y, c.x, c.y) < (1.2 + P.ballRadius) ** 2) {
        s.ball.vx = c.hx * Math.abs(c.speed) * 1.3; s.ball.vy = c.hy * Math.abs(c.speed) * 1.3;
        s.ball.lastTouch = d.id;
      }
    }
  }
  s.cars = s.cars.filter((c) => !c.dead);
}

export { teamOf, frames, HZ };
