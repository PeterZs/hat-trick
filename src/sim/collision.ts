import type { Wall } from './level';

export interface Push { x: number; y: number; hit: boolean; nx: number; ny: number }

/**
 * Move a circle from (x0, y0) to (x1, y1), colliding along the way in steps
 * short enough that it can't skip past a wall's middle and get pushed out the
 * far side (fast dashes, landing spots that are a jump away).
 */
export function sweepCircle(x0: number, y0: number, x1: number, y1: number, r: number, walls: Wall[], highOnly: boolean, out: Push): Push {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.5)));
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  let x = x0, y = y0, hit = false, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) {
    collideCircle(x + dx, y + dy, r, walls, highOnly, out);
    x = out.x; y = out.y;
    if (out.hit) { hit = true; nx = out.nx; ny = out.ny; }
  }
  out.x = x; out.y = y; out.hit = hit; out.nx = nx; out.ny = ny;
  return out;
}

/** Push a circle out of all walls (optionally only high walls). */
export function collideCircle(x: number, y: number, r: number, walls: Wall[], highOnly: boolean, out: Push): Push {
  out.hit = false; out.nx = 0; out.ny = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (highOnly && !w.high) continue;
      const dx = x - w.x, dy = y - w.y;
      const ox = w.hw + r - Math.abs(dx), oy = w.hh + r - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      // Closest point on the box to the circle center.
      const cx = Math.max(-w.hw, Math.min(w.hw, dx));
      const cy = Math.max(-w.hh, Math.min(w.hh, dy));
      const ex = dx - cx, ey = dy - cy;
      const d2 = ex * ex + ey * ey;
      if (d2 > 0) {
        if (d2 >= r * r) continue; // corner region, not touching
        const d = Math.sqrt(d2);
        const pen = r - d;
        const nx = ex / d, ny = ey / d;
        x += nx * pen; y += ny * pen;
        out.nx = nx; out.ny = ny;
      } else if (ox < oy) {
        // Center inside the box: push out along the shallowest axis.
        const s = dx >= 0 ? 1 : -1;
        x += s * ox; out.nx = s; out.ny = 0;
      } else {
        const s = dy >= 0 ? 1 : -1;
        y += s * oy; out.nx = 0; out.ny = s;
      }
      out.hit = true;
    }
  }
  out.x = x; out.y = y;
  return out;
}

export function circleOverlapsWalls(x: number, y: number, r: number, walls: Wall[], highOnly: boolean): boolean {
  for (const w of walls) {
    if (highOnly && !w.high) continue;
    const cx = Math.max(w.x - w.hw, Math.min(w.x + w.hw, x));
    const cy = Math.max(w.y - w.hh, Math.min(w.y + w.hh, y));
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Does the segment a->b intersect any wall (slab test)? */
export function segmentBlocked(ax: number, ay: number, bx: number, by: number, walls: Wall[], highOnly: boolean, pad = 0): boolean {
  const dx = bx - ax, dy = by - ay;
  for (const w of walls) {
    if (highOnly && !w.high) continue;
    let t0 = 0, t1 = 1;
    const minx = w.x - w.hw - pad, maxx = w.x + w.hw + pad, miny = w.y - w.hh - pad, maxy = w.y + w.hh + pad;
    if (Math.abs(dx) < 1e-9) { if (ax < minx || ax > maxx) continue; }
    else {
      let ta = (minx - ax) / dx, tb = (maxx - ax) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (ay < miny || ay > maxy) continue; }
    else {
      let ta = (miny - ay) / dy, tb = (maxy - ay) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}
