// Tiny WebAudio synth for sound effects (no assets needed).

import type { SimEvent } from '../sim/types';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}

export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.2, slide = 0, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol = 0.2, filter = 2000, q = 1, sweep = 1): void {
  if (!ctx || !master) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(filter, t);
  f.frequency.exponentialRampToValueAtTime(filter * sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur);
}

export function playEvent(e: SimEvent): void {
  if (!ctx) return;
  switch (e.e) {
    case 'slash': if (e.kind === 0) noise(0.12, 0.25, 3000, 2, 0.4); else noise(0.08, 0.2, 800, 1, 0.6); break;
    case 'throw': noise(0.25, 0.18, 1200, 3, 2.5); break;
    case 'catch': tone(880, 0.06, 'triangle', 0.15); tone(1320, 0.08, 'triangle', 0.12, 0, 0.05); break;
    case 'clank': tone(180, 0.12, 'triangle', 0.2, 0.6); break;
    case 'kill': tone(520, 0.25, 'square', 0.18, 0.25); noise(0.3, 0.25, 600, 1, 0.3); break;
    case 'shield': tone(1200, 0.2, 'sine', 0.2, 0.5); break;
    case 'clash': tone(1800, 0.25, 'square', 0.1, 0.9); tone(2400, 0.2, 'sine', 0.12, 0.95); break;
    case 'parry': tone(1500, 0.1, 'square', 0.1, 0.7); break;
    case 'dash': noise(0.12, 0.12, 900, 1, 2); break;
    case 'kick': tone(140, 0.1, 'sine', 0.3, 0.5); break;
    case 'pickup': [660, 880, 1100].forEach((f, i) => tone(f, 0.1, 'triangle', 0.15, 0, i * 0.06)); break;
    case 'spawn': tone(440, 0.1, 'sine', 0.1, 2); break;
    case 'boom': noise(0.6, 0.4, 300, 0.7, 0.3); tone(80, 0.4, 'sine', 0.35, 0.4); break;
    case 'goal': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.12, 0, i * 0.1)); break;
    case 'round': [784, 659, 784].forEach((f, i) => tone(f, 0.15, 'triangle', 0.15, 0, i * 0.12)); break;
    case 'match': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'square', 0.12, 0, i * 0.12)); break;
    case 'flag': tone(e.what === 'score' ? 1046 : 660, 0.2, 'triangle', 0.18, e.what === 'drop' ? 0.5 : 1.5); break;
    case 'car': if (e.what === 'crash') noise(0.5, 0.35, 500, 0.8, 0.4); else tone(200, 0.3, 'sawtooth', 0.1, 1.8); break;
    case 'piggy': tone(e.what === 'on' ? 500 : 400, 0.12, 'triangle', 0.15, e.what === 'on' ? 1.5 : 0.7); break;
    case 'join': tone(660, 0.12, 'triangle', 0.15, 1.5); break;
  }
}
