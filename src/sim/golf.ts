// Golf mode: each team has a ball. Hit your own ball with a thrown hat, a
// slash or a kick (that's a stroke); sink it in the cup in as few strokes as
// possible. Hitting the other team's ball is free sabotage. Fewest strokes
// wins the hole; holes are rounds.

import { DT } from './const';
import { dist2, len } from './dmath';
import { collideCircle, type Push } from './collision';
import { HAT_OUT, HAT_RETURN, type GameState, type GolfBall, type Player } from './types';
import { emit, level, sec } from './common';
import { bounceHat } from './actors';
import { collideProps } from './props';
import { isHazard } from './hazards';
import { endRound } from './modes';

const tmp: Push = { x: 0, y: 0, hit: false, nx: 0, ny: 0 };

export const GOLF_BALL_R = 0.35;
const CUP_R = 0.55;

export function resetGolf(s: GameState): void {
  const holes = level(s).holes;
  if (s.cfg.mode !== 'golf' || !holes?.length) { s.golf = null; return; }
  const hole = Math.max(0, s.round - 1) % holes.length;
  const h = holes[hole];
  const balls: GolfBall[] = [0, 1].map((team) => {
    const [x, y] = h.tees[team % h.tees.length];
    return { team, x, y, vx: 0, vy: 0, strokes: 0, sunk: false, restX: x, restY: y, hitCd: 0, portalCd: 0 };
  });
  s.golf = { hole, cupX: h.cup[0], cupY: h.cup[1], balls, t: 0 };
}

/** A stroke on a ball: counts only when your team hits your own ball. */
function strike(s: GameState, b: GolfBall, who: Player | undefined, vx: number, vy: number): void {
  b.vx = vx; b.vy = vy; b.hitCd = 12;
  if (who && who.team % 2 === b.team && s.phase === 'playing') {
    b.strokes++;
    emit(s, { e: 'stroke', team: b.team, x: b.x, y: b.y });
  }
}

/** Slashes and kicks (called from melee resolution with the attack's reach test). */
export function golfMelee(s: GameState, a: Player, kick: boolean, inArc: (x: number, y: number, r: number) => boolean): void {
  if (!s.golf) return;
  const P = s.params;
  for (const b of s.golf.balls) {
    if (b.sunk || b.hitCd > 0) continue;
    if (!inArc(b.x, b.y, (kick ? P.kickRange : P.slashRange) + GOLF_BALL_R)) continue;
    let imp = kick ? P.golfKick : P.golfSwing;
    // Putting: a swing aimed at the cup is softened to roll just past it
    // (a ball stops after about speed/friction units).
    const g = s.golf, dx = g.cupX - b.x, dy = g.cupY - b.y, dc = len(dx, dy);
    if (dc > 0.01 && (dx * a.fx + dy * a.fy) / dc > 0.9) imp = Math.min(imp, P.golfFriction * (dc + 1.2));
    strike(s, b, a, a.fx * imp, a.fy * imp);
  }
}

export function updateGolf(s: GameState): void {
  const g = s.golf;
  if (!g) return;
  const P = s.params;
  const L = level(s);
  if (s.phase === 'playing') g.t++;

  for (const b of g.balls) {
    if (b.sunk) continue;
    if (b.hitCd > 0) b.hitCd--;
    // Thrown hats smack the ball and bounce back toward their owner.
    for (const h of s.hats) {
      if ((h.state !== HAT_OUT && h.state !== HAT_RETURN) || h.bomb || b.hitCd > 0) continue;
      if (dist2(h.x, h.y, b.x, b.y) > (P.hatRadius + GOLF_BALL_R) ** 2) continue;
      const hl = Math.max(0.01, len(h.vx, h.vy));
      const power = P.golfHat * Math.min(1.5, hl / P.hatSpeed);
      strike(s, b, s.players[h.owner], (h.vx / hl) * power, (h.vy / hl) * power);
      const dx = h.x - b.x, dy = h.y - b.y, d = Math.max(1e-6, len(dx, dy));
      bounceHat(s, h, dx / d, dy / d);
    }
    // Bodies can't dribble it: players just bump off the ball.
    for (const p of s.players) {
      if (!p.active || !p.alive || p.role !== 'fighter' || p.riding >= 0) continue;
      const r = P.playerRadius + GOLF_BALL_R;
      const dx = p.x - b.x, dy = p.y - b.y, d = len(dx, dy);
      if (d >= r || d < 1e-6) continue;
      p.x = b.x + (dx / d) * r; p.y = b.y + (dy / d) * r;
    }
    // Roll.
    const f = Math.max(0, 1 - P.golfFriction * DT);
    b.vx *= f; b.vy *= f;
    const sp = len(b.vx, b.vy);
    if (sp < 0.15) { b.vx = 0; b.vy = 0; }
    for (let k = 0; k < 2; k++) {
      b.x += (b.vx * DT) / 2; b.y += (b.vy * DT) / 2;
      collideCircle(b.x, b.y, GOLF_BALL_R, L.walls, false, tmp);
      if (tmp.hit) {
        b.x = tmp.x; b.y = tmp.y;
        const vn = b.vx * tmp.nx + b.vy * tmp.ny;
        if (vn < 0) { b.vx -= 1.6 * vn * tmp.nx; b.vy -= 1.6 * vn * tmp.ny; }
      }
      const t = collideProps(s, b, GOLF_BALL_R);
      if (t) {
        const dx = b.x - t.x, dy = b.y - t.y, d = Math.max(1e-6, len(dx, dy));
        const vn = (b.vx * dx + b.vy * dy) / d;
        if (vn < 0) { b.vx -= (1.6 * vn * dx) / d; b.vy -= (1.6 * vn * dy) / d; }
      }
    }
    // Water: back to where it last rested, plus a penalty stroke.
    if (isHazard(s, b.x, b.y)) {
      emit(s, { e: 'splash', x: b.x, y: b.y });
      b.x = b.restX; b.y = b.restY; b.vx = 0; b.vy = 0;
      if (s.phase === 'playing') b.strokes++;
      continue;
    }
    if (b.vx === 0 && b.vy === 0) { b.restX = b.x; b.restY = b.y; }
    // The cup: slow enough drops in, too fast lips out.
    const dc = len(b.x - g.cupX, b.y - g.cupY);
    if (dc < CUP_R) {
      if (len(b.vx, b.vy) < P.golfSinkSpeed && s.phase === 'playing') {
        b.sunk = true; b.x = g.cupX; b.y = g.cupY; b.vx = b.vy = 0;
        emit(s, { e: 'sunk', team: b.team, strokes: b.strokes, x: g.cupX, y: g.cupY });
      } else {
        // Pulled toward the cup a little as it rolls over.
        b.vx += ((g.cupX - b.x) / Math.max(0.05, dc)) * 6 * DT;
        b.vy += ((g.cupY - b.y) / Math.max(0.05, dc)) * 6 * DT;
      }
    }
  }

  // Hole over: everyone sunk, or time's up (unsunk balls take a penalty).
  if (s.phase !== 'playing') return;
  const teams = new Set(s.players.filter((p) => p.active && p.role === 'fighter').map((p) => p.team % 2));
  const inPlay = g.balls.filter((b) => teams.has(b.team));
  if (!inPlay.length) return;
  const timeUp = g.t >= sec(s, 'golfHoleTime');
  if (!timeUp && !inPlay.every((b) => b.sunk)) return;
  const score = (b: GolfBall) => b.strokes + (b.sunk ? 0 : P.golfPenalty);
  const best = Math.min(...inPlay.map(score));
  const winners = inPlay.filter((b) => score(b) === best);
  if (winners.length === 1) { s.scores[winners[0].team]++; endRound(s, winners[0].team); }
  else endRound(s, -1);
}

/** Bot helper: the ball this player should be playing, and the cup. */
export function golfTarget(s: GameState, p: Player): { ball: GolfBall; cupX: number; cupY: number } | null {
  const g = s.golf;
  if (!g) return null;
  const ball = g.balls.find((b) => b.team === p.team % 2 && !b.sunk);
  return ball ? { ball, cupX: g.cupX, cupY: g.cupY } : null;
}
