// Deterministic math helpers.
//
// IEEE-754 guarantees bit-identical results for + - * / and sqrt on every
// platform, but NOT for Math.sin/cos/atan2/pow/exp. The simulation must only
// use the functions in this file (or plain arithmetic) so that every peer, and
// any future native port, computes identical states for rollback netcode.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;

/** Deterministic sine: range reduction + odd polynomial (error < 1e-9). */
export function dsin(x: number): number {
  x = x - TAU * Math.round(x / TAU); // [-PI, PI]
  // Fold into [-PI/2, PI/2] using sin(PI - x) = sin(x).
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  // Taylor series to x^15; plenty for |x| <= PI/2.
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 +
    x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

export function dcos(x: number): number {
  return dsin(x + PI / 2);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

/** Rotate (x, y) by angle a (radians). */
export function rotate(x: number, y: number, a: number): [number, number] {
  const c = dcos(a), s = dsin(a);
  return [x * c - y * s, x * s + y * c];
}

/** Convert seconds to an integer number of sim frames. */
export function frames(seconds: number, hz: number): number {
  return Math.max(0, Math.round(seconds * hz));
}
