// Procedural sound effects (WebAudio, no assets).
//
// Signal chain:  voice -> panner -> dry bus ----------------> compressor -> master -> out
//                                  \-> reverb send -> convolver /
// Each sound is layered from a transient (click/noise burst), a body (pitched
// or filtered noise) and a tail, with small random variations so repeated
// sounds don't feel mechanical. Panning follows the event's x position.

import type { GameState, SimEvent } from '../sim/types';

let ctx: BaseAudioContext | null = null;
let tBase = 0;          // schedule offset (used by the sound test / offline render)
let offline = false;
let master: GainNode;
let dry: GainNode;
let verbSend: GainNode;
let noiseBuf: AudioBuffer;
let volume = 0.5;
const lastPlayed = new Map<string, number>();

export function setVolume(v: number): void {
  volume = v;
  if (ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
}

export function unlockAudio(): void {
  if (!ctx) init();
  if (ctx instanceof AudioContext && ctx.state === 'suspended') void ctx.resume();
}

function init(c: BaseAudioContext = new AudioContext()): void {
  ctx = c;
  master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5;
  comp.attack.value = 0.003; comp.release.value = 0.15;
  comp.connect(master).connect(c.destination);
  dry = ctx.createGain();
  dry.connect(comp);
  // Small room reverb from a generated, exponentially decaying stereo impulse.
  const len = Math.floor(ctx.sampleRate * 1.3);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const verbTone = ctx.createBiquadFilter();
  verbTone.type = 'lowpass'; verbTone.frequency.value = 4500;
  verbSend = ctx.createGain();
  verbSend.connect(conv).connect(verbTone).connect(comp);
  // Four seconds of white noise, shared by every noise layer.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
}

// ---------------------------------------------------------------------------
// Building blocks

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const vary = (x: number, amt = 0.06) => x * (1 + rnd(-amt, amt));

/** A voice output: returns a node to connect sources to, panned and with reverb send. */
function voice(pan: number, verb: number, gain = 1): GainNode {
  const c = ctx!;
  const g = c.createGain();
  g.gain.value = gain;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  p.connect(dry);
  if (verb > 0) {
    const s = c.createGain();
    s.gain.value = verb;
    p.connect(s).connect(verbSend);
  }
  return g;
}

/** Attack/decay envelope on a fresh gain node. */
function envGain(t: number, attack: number, peak: number, decay: number, dest: AudioNode): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function osc(type: OscillatorType, t: number, dur: number, f0: number, f1: number | null, dest: AudioNode, curve: 'exp' | 'lin' = 'exp'): OscillatorNode {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== null) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  o.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

function noise(t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.connect(dest);
  s.start(t, Math.random() * Math.max(0, 3.9 - dur), dur + 0.05);
  return s;
}

function filter(type: BiquadFilterType, freq: number, q = 1, dest?: AudioNode): BiquadFilterNode {
  const f = ctx!.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (dest) f.connect(dest);
  return f;
}

/** Filtered noise burst with a frequency sweep. */
function swish(t: number, out: AudioNode, o: { dur: number; f0: number; f1: number; q?: number; peak: number; attack?: number; type?: BiquadFilterType }): void {
  const g = envGain(t, o.attack ?? 0.01, o.peak, o.dur, out);
  const f = filter(o.type ?? 'bandpass', o.f0, o.q ?? 1.2, g);
  f.frequency.setValueAtTime(o.f0, t);
  f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  noise(t, (o.attack ?? 0.01) + o.dur, f);
}

/** Pitched blip: oscillator through an envelope. */
function blip(t: number, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; dur: number; peak: number; attack?: number }): void {
  const g = envGain(t, o.attack ?? 0.004, o.peak, o.dur, out);
  osc(o.type ?? 'sine', t, (o.attack ?? 0.004) + o.dur, o.f0, o.f1 ?? null, g);
}

/** Metallic strike: inharmonic partials (like a struck bar/bell) + noise click. */
function metal(t: number, out: AudioNode, f: number, dur: number, peak: number, partials = [1, 2.76, 5.4, 8.93]): void {
  partials.forEach((m, i) => {
    const g = envGain(t, 0.002, peak / (1 + i * 0.9), dur / (1 + i * 0.6), out);
    osc('sine', t, dur, f * m * rnd(0.995, 1.005), null, g);
  });
  swish(t, out, { dur: 0.04, f0: 6000, f1: 3000, q: 0.7, peak: peak * 0.8, attack: 0.001 });
}

/** Low thump felt in the chest: fast pitch drop sine. */
function thump(t: number, out: AudioNode, peak: number, f0 = 140, f1 = 45, dur = 0.25): void {
  blip(t, out, { f0, f1, dur, peak, attack: 0.002 });
}

/** Sparse random clicks over a window (debris, leaves, gravel). */
function crackle(t: number, out: AudioNode, dur: number, count: number, freq: number, peak: number): void {
  for (let i = 0; i < count; i++) {
    const at = t + Math.pow(Math.random(), 1.6) * dur;
    swish(at, out, { dur: rnd(0.01, 0.04), f0: vary(freq, 0.4), f1: vary(freq * 0.7, 0.3), q: 2, peak: peak * rnd(0.3, 1), attack: 0.001 });
  }
}

/** Spinning whoosh: noise with tremolo (the hat's rotation) and a sweep. */
function spinWhoosh(t: number, out: AudioNode, dur: number, f0: number, f1: number, rate: number, peak: number): void {
  const g = envGain(t, 0.03, peak, dur, out);
  const trem = ctx!.createGain();
  trem.gain.value = 0.5;
  const lfo = ctx!.createOscillator();
  lfo.frequency.setValueAtTime(rate, t);
  lfo.frequency.linearRampToValueAtTime(rate * 0.7, t + dur);
  const lfoAmt = ctx!.createGain(); lfoAmt.gain.value = 0.5;
  lfo.connect(lfoAmt).connect(trem.gain);
  lfo.start(t); lfo.stop(t + dur + 0.1);
  trem.connect(g);
  const f = filter('bandpass', f0, 2.5, trem);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  noise(t, dur + 0.05, f);
}

function notes(t: number, out: AudioNode, freqs: number[], step: number, o: { type?: OscillatorType; dur: number; peak: number }): void {
  freqs.forEach((f, i) => {
    blip(t + i * step, out, { type: o.type ?? 'triangle', f0: f, dur: o.dur, peak: o.peak, attack: 0.005 });
    // A soft octave-up shimmer makes simple waves sound less "beepy".
    blip(t + i * step, out, { type: 'sine', f0: f * 2.003, dur: o.dur * 0.7, peak: o.peak * 0.25, attack: 0.005 });
  });
}

/** Brassy note: detuned saws through an opening lowpass. */
function brass(t: number, out: AudioNode, f: number, dur: number, peak: number): void {
  const g = envGain(t, 0.03, peak, dur, out);
  const lp = filter('lowpass', 400, 2, g);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur);
  for (const d of [-6, 0, 7]) { const o = osc('sawtooth', t, dur + 0.05, f, null, lp); o.detune.value = d; }
}

// ---------------------------------------------------------------------------

function rateLimited(key: string, ms: number): boolean {
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? -1e9) < ms) return true;
  lastPlayed.set(key, now);
  return false;
}

function eventX(s: GameState | null, e: SimEvent): number | null {
  if ('x' in e && typeof e.x === 'number') return e.x;
  const who = 'who' in e ? e.who : 'victim' in e ? e.victim : -1;
  const p = s && who >= 0 ? s.players[who] : null;
  return p ? p.x : null;
}

export function playEvent(e: SimEvent, s: GameState | null = null): void {
  if (!ctx || (!offline && ctx.state !== 'running')) return;
  if (!offline && e.e !== 'kill' && rateLimited(e.e, e.e === 'chop' ? 40 : 25)) return;
  const t = ctx.currentTime + tBase + 0.005;
  const x = eventX(s, e);
  const pan = x === null ? 0 : (x / 16) * 0.7;
  const v = (verb: number, gain = 1) => voice(pan, verb, gain);

  switch (e.e) {
    case 'slash': {
      const out = v(0.08, 1.5);
      if (e.kind === 0) {
        // Low, airy whoosh: a wide band of noise sweeping up then down
        // through the low-mids, with a soft rumble underneath.
        const f = vary(270, 0.12);
        swish(t, out, { dur: 0.11, f0: f, f1: f * 2.4, q: 0.7, peak: 0.55, attack: 0.04 });
        swish(t + 0.1, out, { dur: 0.22, f0: f * 2.4, f1: f * 0.85, q: 0.7, peak: 0.4, attack: 0.01 });
        // Rumble: low-passed noise plus a soft sub swell that dips in pitch.
        swish(t, out, { dur: 0.26, f0: 220, f1: 110, type: 'lowpass', q: 1.1, peak: 0.45, attack: 0.05 });
        blip(t + 0.02, out, { type: 'sine', f0: vary(95, 0.08), f1: 60, dur: 0.22, peak: 0.22, attack: 0.05 });
      } else {
        swish(t, out, { dur: 0.08, f0: 700, f1: 1500, q: 1, peak: 0.3, attack: 0.01 });
      }
      break;
    }
    case 'kick': {
      // Big body hit: crack + punchy mid "whump" + heavy sub drop, a little room.
      const out = v(0.25, 1.4);
      swish(t, out, { dur: 0.035, f0: 4500, f1: 2000, type: 'highpass', q: 0.6, peak: 0.8, attack: 0.001 });
      swish(t, out, { dur: 0.16, f0: vary(380, 0.1), f1: 160, q: 1.4, peak: 1.0, attack: 0.002 });
      thump(t, out, 1.0, vary(130, 0.08), 32, 0.4);
      blip(t, out, { type: 'triangle', f0: vary(260, 0.08), f1: 90, dur: 0.12, peak: 0.35, attack: 0.001 });
      swish(t + 0.05, out, { dur: 0.25, f0: 600, f1: 2200, q: 0.8, peak: 0.18, attack: 0.03 }); // victim whooshes away
      break;
    }
    case 'ballkick': {
      // Hollow "thwack" of a ball, then it whistles away.
      const out = v(0.2, 1.3);
      swish(t, out, { dur: 0.03, f0: 5000, f1: 2500, type: 'highpass', q: 0.6, peak: 0.7, attack: 0.001 });
      swish(t, out, { dur: 0.1, f0: vary(900, 0.1), f1: 600, q: 5, peak: 0.9, attack: 0.001 });
      thump(t, out, 0.8, vary(200, 0.08), 70, 0.2);
      swish(t + 0.04, out, { dur: 0.45, f0: 900, f1: 2600, q: 1.2, peak: 0.2, attack: 0.04 });
      break;
    }
    case 'throw': {
      const out = v(0.1, 2.6);
      const c = e.charge;
      spinWhoosh(t, out, 0.38 + c * 0.2, vary(700 + c * 300), vary(1800 + c * 900), 16 + c * 8, 0.4 + c * 0.15);
      if (c > 0.5) blip(t, out, { type: 'triangle', f0: 300, f1: 600, dur: 0.15, peak: 0.08 });
      break;
    }
    case 'catch': {
      const out = v(0.06, 1.8);
      swish(t, out, { dur: 0.06, f0: 900, f1: 400, type: 'lowpass', q: 0.7, peak: 0.35, attack: 0.002 }); // soft fwump
      blip(t + 0.01, out, { type: 'sine', f0: vary(880), f1: vary(1320), dur: 0.07, peak: 0.12 });
      break;
    }
    case 'clank': {
      // Hat hits the ground and settles: two little bounces.
      const out = v(0.06);
      for (const [dt, a] of [[0, 1], [0.09, 0.5], [0.15, 0.25]] as const) {
        thump(t + dt, out, 0.35 * a, vary(240), 90, 0.08);
        swish(t + dt, out, { dur: 0.03, f0: 1800, f1: 900, q: 1, peak: 0.12 * a, attack: 0.001 });
      }
      break;
    }
    case 'bounce': {
      const out = v(0.12);
      metal(t, out, vary(900, 0.1), 0.18, 0.12, [1, 2.4, 4.1]);
      thump(t, out, 0.2, 300, 120, 0.05);
      break;
    }
    case 'kill': {
      // Balloon-like pop: sharp crack, a squeaky descending "pew", sub thump, debris.
      const out = v(0.18, 1.1);
      swish(t, out, { dur: 0.05, f0: 5000, f1: 2500, type: 'highpass', q: 0.7, peak: 0.9, attack: 0.001 });
      blip(t + 0.005, out, { type: 'square', f0: vary(1100, 0.1), f1: 180, dur: 0.18, peak: 0.07 });
      blip(t + 0.005, out, { type: 'sine', f0: vary(800, 0.1), f1: 120, dur: 0.2, peak: 0.25 });
      thump(t, out, 0.9, 120, 38, 0.32);
      crackle(t + 0.03, out, 0.35, 12, 2600, 0.18);
      break;
    }
    case 'shield': {
      // Glass shatter: scattered high partials + bright noise.
      const out = v(0.25);
      swish(t, out, { dur: 0.25, f0: 7000, f1: 3500, type: 'highpass', q: 0.5, peak: 0.4, attack: 0.001 });
      for (let i = 0; i < 9; i++) blip(t + rnd(0, 0.12), out, { f0: rnd(2200, 6000), dur: rnd(0.08, 0.3), peak: 0.06 });
      blip(t, out, { type: 'triangle', f0: 1400, f1: 700, dur: 0.25, peak: 0.1 });
      break;
    }
    case 'clash': {
      // Two weapons meet: big bell-like clang with ring-out and a thump.
      const out = v(0.35, 1.1);
      const f = vary(520, 0.08);
      metal(t, out, f, 0.9, 0.28);
      metal(t + 0.004, out, f * 1.34, 0.6, 0.14);
      thump(t, out, 0.5, 200, 60, 0.15);
      swish(t, out, { dur: 0.25, f0: 3000, f1: 8000, q: 0.8, peak: 0.12, attack: 0.002 });
      break;
    }
    case 'hatclash': {
      const out = v(0.28);
      metal(t, out, vary(700, 0.1), 0.55, 0.22, [1, 2.2, 3.9, 6.1]);
      thump(t, out, 0.25, 260, 90, 0.08);
      break;
    }
    case 'parry': {
      const out = v(0.25);
      metal(t, out, vary(1250, 0.08), 0.35, 0.16, [1, 2.76, 5.4]);
      swish(t, out, { dur: 0.1, f0: 2000, f1: 5000, q: 1.5, peak: 0.15, attack: 0.005 });
      break;
    }
    case 'dash': {
      const out = v(0.05, 1.7);
      swish(t, out, { dur: 0.16, f0: vary(500), f1: vary(1600), q: 0.9, peak: 0.3, attack: 0.015 });
      thump(t, out, 0.12, 90, 60, 0.1);
      break;
    }
    case 'pickup': {
      const out = v(0.2);
      if (e.kind === 'invis') {
        // Shimmering fade-out.
        for (let i = 0; i < 6; i++) blip(t + i * 0.04, out, { f0: 1600 - i * 180, dur: 0.2, peak: 0.07 });
        swish(t, out, { dur: 0.5, f0: 6000, f1: 1500, type: 'highpass', q: 0.5, peak: 0.12, attack: 0.02 });
        break;
      }
      if (e.kind === 'slow' || e.kind === 'reverse') {
        // Sad "wah-wah": descending brass with a droopy pitch bend.
        [311, 294, 277].forEach((fr, i) => brass(t + i * 0.16, out, fr / 2, 0.15, 0.09));
        const g = envGain(t + 0.48, 0.02, 0.1, 0.6, out);
        const lp = filter('lowpass', 900, 2, g);
        const o = osc('sawtooth', t + 0.48, 0.65, 262 / 2, 220 / 2, lp);
        const vib = ctx!.createOscillator(); vib.frequency.value = 6;
        const vg = ctx!.createGain(); vg.gain.value = 4;
        vib.connect(vg).connect(o.frequency); vib.start(t + 0.48); vib.stop(t + 1.2);
        break;
      }
      const base = vary(660, 0.03);
      notes(t, out, [base, base * 1.26, base * 1.5, base * 2], 0.055, { dur: 0.18, peak: 0.14 });
      for (let i = 0; i < 5; i++) blip(t + 0.12 + i * 0.03, out, { f0: rnd(3000, 5000), dur: 0.06, peak: 0.025 });
      break;
    }
    case 'spawn': {
      const out = v(0.15, 1.4);
      blip(t, out, { type: 'sine', f0: 300, f1: 900, dur: 0.18, peak: 0.12, attack: 0.02 });
      swish(t, out, { dur: 0.2, f0: 800, f1: 3000, q: 1, peak: 0.06, attack: 0.03 });
      break;
    }
    case 'boom': {
      const out = v(0.4, 1.2);
      swish(t, out, { dur: 0.06, f0: 3000, f1: 1000, type: 'highpass', q: 0.5, peak: 0.7, attack: 0.001 });
      swish(t, out, { dur: 1.1, f0: 900, f1: 80, type: 'lowpass', q: 0.8, peak: 0.9, attack: 0.005 });
      thump(t, out, 1.0, 90, 28, 0.6);
      crackle(t + 0.05, out, 0.7, 20, 1800, 0.15);
      break;
    }
    case 'goal': {
      const out = v(0.4);
      // Crowd roar: noise with jittery amplitude, plus a brass fanfare.
      const g = envGain(t, 0.15, 0.35, 1.6, out);
      const f = filter('bandpass', 1100, 0.6, g);
      noise(t, 1.8, f);
      [523, 659, 784, 1046].forEach((fr, i) => brass(t + i * 0.11, out, fr / 2, i === 3 ? 0.6 : 0.16, 0.09));
      break;
    }
    case 'round': {
      const out = v(0.3);
      [392, 523, 659].forEach((fr, i) => brass(t + i * 0.12, out, fr, i === 2 ? 0.45 : 0.14, 0.08));
      break;
    }
    case 'match': {
      const out = v(0.4);
      const seq = [523, 523, 523, 659, 784, 659, 784, 1046];
      const dts = [0, 0.12, 0.24, 0.36, 0.6, 0.78, 0.9, 1.1];
      seq.forEach((fr, i) => brass(t + dts[i], out, fr / 2, i === seq.length - 1 ? 0.9 : 0.14, 0.1));
      for (let i = 0; i < 14; i++) blip(t + 1.1 + i * 0.04, out, { f0: rnd(2500, 5000), dur: 0.1, peak: 0.025 });
      break;
    }
    case 'flag': {
      const out = v(0.25);
      if (e.what === 'take') notes(t, out, [523, 784], 0.08, { dur: 0.16, peak: 0.13 });
      else if (e.what === 'drop') notes(t, out, [523, 392, 262], 0.08, { dur: 0.16, peak: 0.12 });
      else if (e.what === 'return') { swish(t, out, { dur: 0.3, f0: 400, f1: 3000, q: 1.5, peak: 0.2 }); notes(t + 0.2, out, [784], 0.1, { dur: 0.2, peak: 0.1 }); }
      else [523, 659, 784, 1046].forEach((fr, i) => brass(t + i * 0.1, out, fr / 2, i === 3 ? 0.5 : 0.14, 0.09));
      break;
    }
    case 'car': {
      const out = v(0.15);
      if (e.what === 'spawn') {
        // Cartoon horn: two quick honks of a detuned square pair through a lowpass.
        for (const [dt, f] of [[0, 392], [0.16, 330]] as const) {
          const g = envGain(t + dt, 0.01, 0.12, 0.12, out);
          const lp = filter('lowpass', 1800, 1.5, g);
          for (const det of [-8, 8]) { const o = osc('square', t + dt, 0.14, f, null, lp); o.detune.value = det; }
        }
        break;
      }
      if (e.what === 'crash') {
        swish(t, out, { dur: 0.6, f0: 2000, f1: 200, type: 'lowpass', q: 0.7, peak: 0.7, attack: 0.002 });
        metal(t, out, 310, 0.5, 0.15, [1, 1.7, 2.9, 4.4]);
        thump(t, out, 0.8, 110, 35, 0.35);
        crackle(t + 0.05, out, 0.5, 14, 3500, 0.15);
      } else if (e.what === 'enter') {
        // Engine rev: detuned saws through a lowpass that follows the revs.
        const g = envGain(t, 0.05, 0.22, 0.75, out);
        const lp = filter('lowpass', 300, 3, g);
        lp.frequency.setValueAtTime(300, t);
        lp.frequency.linearRampToValueAtTime(1400, t + 0.3);
        lp.frequency.linearRampToValueAtTime(500, t + 0.8);
        for (const d of [0, 9]) {
          const o = osc('sawtooth', t, 0.85, 55, null, lp);
          o.frequency.linearRampToValueAtTime(140, t + 0.3);
          o.frequency.linearRampToValueAtTime(80, t + 0.8);
          o.detune.value = d;
        }
      } else {
        swish(t, out, { dur: 0.12, f0: 600, f1: 300, type: 'lowpass', q: 1, peak: 0.25 });
      }
      break;
    }
    case 'piggy': {
      // Boing: sine with a springy pitch bend and vibrato.
      const out = v(0.12);
      const g = envGain(t, 0.005, 0.22, 0.3, out);
      const o = osc('sine', t, 0.32, e.what === 'on' ? 180 : 420, null, g);
      o.frequency.exponentialRampToValueAtTime(e.what === 'on' ? 520 : 160, t + 0.12);
      const vib = ctx!.createOscillator(); vib.frequency.value = 22;
      const vg = ctx!.createGain(); vg.gain.value = 25;
      vib.connect(vg).connect(o.frequency); vib.start(t); vib.stop(t + 0.35);
      break;
    }
    case 'join': {
      const out = v(0.25);
      notes(t, out, [784, 1175], 0.07, { type: 'sine', dur: 0.25, peak: 0.12 });
      break;
    }
    case 'leave': {
      const out = v(0.2);
      notes(t, out, [784, 523], 0.07, { type: 'sine', dur: 0.2, peak: 0.08 });
      break;
    }
    case 'chop': {
      // Axe into wood: hard click, resonant woody body, short low knock.
      const out = v(0.1, 1.3);
      swish(t, out, { dur: 0.02, f0: 3500, f1: 2000, q: 1, peak: 0.5, attack: 0.001 });
      const body = vary(480, 0.12);
      swish(t, out, { dur: 0.12, f0: body, f1: body * 0.85, q: 12, peak: 0.9, attack: 0.001 });
      blip(t, out, { type: 'triangle', f0: vary(210, 0.1), f1: 120, dur: 0.09, peak: 0.35, attack: 0.001 });
      crackle(t + 0.01, out, 0.12, 4, 4000, 0.06); // chips
      break;
    }
    case 'fell': {
      // Creak (bandpassed saw with wobble), then the crash and a leafy rustle.
      const out = v(0.3, 1.1);
      const g = envGain(t, 0.08, 0.12, 0.5, out);
      const bp = filter('bandpass', 900, 6, g);
      const o = osc('sawtooth', t, 0.6, 95, 60, bp);
      const wob = ctx!.createOscillator(); wob.frequency.value = 9;
      const wg = ctx!.createGain(); wg.gain.value = 12;
      wob.connect(wg).connect(o.frequency); wob.start(t); wob.stop(t + 0.6);
      const hit = t + 0.55;
      thump(hit, out, 1.0, 110, 32, 0.45);
      swish(hit, out, { dur: 0.7, f0: 1500, f1: 200, type: 'lowpass', q: 0.7, peak: 0.6, attack: 0.003 });
      crackle(hit, out, 0.6, 18, 2200, 0.16);                                                   // branches
      swish(hit + 0.03, out, { dur: 0.9, f0: 5000, f1: 3000, type: 'highpass', q: 0.4, peak: 0.12, attack: 0.05 }); // leaves
      break;
    }
  }
}

/** UI cues that don't come from sim events. */
export function playCue(cue: 'tick' | 'go'): void {
  if (!ctx || (!offline && ctx.state !== 'running')) return;
  const t = ctx.currentTime + tBase + 0.005;
  const out = voice(0, 0.2, 1.5);
  if (cue === 'tick') notes(t, out, [587], 0, { type: 'triangle', dur: 0.18, peak: 0.16 });
  else { notes(t, out, [1175], 0, { type: 'triangle', dur: 0.4, peak: 0.18 }); brass(t, out, 587, 0.35, 0.07); }
}

// ---------------------------------------------------------------------------
// Sound test: every effect in sequence (settings panel), or rendered offline.

export const SOUND_TEST: { name: string; ev: SimEvent | 'tick' | 'go' }[] = [
  { name: 'tick', ev: 'tick' }, { name: 'go', ev: 'go' },
  { name: 'slash', ev: { e: 'slash', who: -1, kind: 0 } },
  { name: 'kick', ev: { e: 'kick', who: -1, target: -1, x: 0, y: 0 } },
  { name: 'ball kick', ev: { e: 'ballkick', who: -1, x: 0, y: 0 } },
  { name: 'dash', ev: { e: 'dash', who: -1 } },
  { name: 'throw', ev: { e: 'throw', who: -1, hat: 0, charge: 0 } },
  { name: 'throw (charged)', ev: { e: 'throw', who: -1, hat: 0, charge: 1 } },
  { name: 'bounce', ev: { e: 'bounce', hat: 0, x: -8, y: 0 } },
  { name: 'catch', ev: { e: 'catch', who: -1, hat: 0 } },
  { name: 'clank', ev: { e: 'clank', hat: 0, x: 8, y: 0 } },
  { name: 'parry', ev: { e: 'parry', who: -1, hat: 0, x: 0, y: 0 } },
  { name: 'hat clash', ev: { e: 'hatclash', a: 0, b: 1, x: 0, y: 0 } },
  { name: 'clash', ev: { e: 'clash', a: 0, b: 1, x: 0, y: 0 } },
  { name: 'kill', ev: { e: 'kill', victim: -1, killer: -1, x: 0, y: 0 } },
  { name: 'shield', ev: { e: 'shield', who: -1, x: 0, y: 0 } },
  { name: 'spawn', ev: { e: 'spawn', who: -1 } },
  { name: 'pickup', ev: { e: 'pickup', who: -1, kind: 'speed', x: 0, y: 0 } },
  { name: 'bad pickup', ev: { e: 'pickup', who: -1, kind: 'slow', x: 0, y: 0 } },
  { name: 'piggy on', ev: { e: 'piggy', what: 'on', who: -1, mount: -1 } },
  { name: 'car', ev: { e: 'car', what: 'enter', who: -1, x: 0, y: 0 } },
  { name: 'car crash', ev: { e: 'car', what: 'crash', who: -1, x: 0, y: 0 } },
  { name: 'car arrives', ev: { e: 'car', what: 'spawn', who: -1, x: 0, y: 0 } },
  { name: 'chop', ev: { e: 'chop', tree: 0, who: -1, x: 0, y: 0 } },
  { name: 'fell', ev: { e: 'fell', tree: 0, who: -1, x: 0, y: 0, dx: 1, dy: 0 } },
  { name: 'bomb', ev: { e: 'boom', x: 0, y: 0 } },
  { name: 'flag take', ev: { e: 'flag', what: 'take', team: 0, who: -1 } },
  { name: 'flag score', ev: { e: 'flag', what: 'score', team: 0, who: -1 } },
  { name: 'goal', ev: { e: 'goal', team: 0 } },
  { name: 'join', ev: { e: 'join', who: -1 } },
  { name: 'round', ev: { e: 'round', winner: 0 } },
  { name: 'match', ev: { e: 'match', winner: 0 } },
];
export const SOUND_TEST_SPACING = 1.3;

function scheduleTest(): void {
  SOUND_TEST.forEach(({ ev }, i) => {
    tBase = 0.1 + i * SOUND_TEST_SPACING;
    if (typeof ev === 'string') playCue(ev); else playEvent(ev, null);
  });
  tBase = 0;
}

export function soundTest(): void {
  unlockAudio();
  scheduleTest();
}

/** Render the sound test offline (for automated checks). */
export async function renderSoundTest(sampleRate = 44100): Promise<AudioBuffer> {
  const live = ctx, liveParts = { master, dry, verbSend, noiseBuf };
  const off = new OfflineAudioContext(2, Math.ceil(sampleRate * (SOUND_TEST.length * SOUND_TEST_SPACING + 2)), sampleRate);
  init(off);
  offline = true;
  try { scheduleTest(); } finally { offline = false; }
  const buf = await off.startRendering();
  ctx = live; ({ master, dry, verbSend, noiseBuf } = liveParts);
  return buf;
}
