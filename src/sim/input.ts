// Player input for one sim frame. Quantized to small integers so it is
// compact on the wire and bit-identical on every peer.

export const BTN_DASH = 1;
export const BTN_ATTACK = 2;   // slash (with hat) / kick (without)
export const BTN_THROW = 4;    // hold to aim/charge, release to throw; hold to recall
export const BTN_INTERACT = 8; // piggyback / enter-exit car

export interface PlayerInput {
  mx: number; // movement, -127..127, +x right
  my: number; // movement, -127..127, +y toward camera (down on screen)
  ax: number; // aim direction, -127..127 (0,0 = no aim, use movement)
  ay: number;
  b: number;  // button bitmask
}

export const NEUTRAL: Readonly<PlayerInput> = Object.freeze({ mx: 0, my: 0, ax: 0, ay: 0, b: 0 });

function q(v: number): number {
  return Math.max(-127, Math.min(127, Math.round(v * 127)));
}

/** Build a quantized input from float vectors (each component in [-1, 1]). */
export function makeInput(mx: number, my: number, ax: number, ay: number, b: number): PlayerInput {
  // Clamp movement to the unit disc before quantizing.
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const al = Math.sqrt(ax * ax + ay * ay);
  if (al > 1e-6) { ax /= al; ay /= al; }
  return { mx: q(mx), my: q(my), ax: q(ax), ay: q(ay), b: b | 0 };
}

export function inputsEqual(a: PlayerInput | undefined, b: PlayerInput | undefined): boolean {
  if (!a || !b) return a === b;
  return a.mx === b.mx && a.my === b.my && a.ax === b.ax && a.ay === b.ay && a.b === b.b;
}
