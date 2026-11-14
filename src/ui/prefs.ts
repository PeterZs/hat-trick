// Persistent local preferences (localStorage). Never part of the sim state.

import { cloneParams, DEFAULT_PARAMS, type Params } from '../sim/params';

const K_PARAMS = 'hat-trick.params';
const K_PREFS = 'hat-trick.prefs';

// The game used to be called Boomerang Hat: carry saved settings over once.
try {
  for (const [oldKey, newKey] of [['boomerang-hat.params', K_PARAMS], ['boomerang-hat.prefs', K_PREFS]]) {
    const v = localStorage.getItem(oldKey);
    if (v !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
} catch { /* storage unavailable */ }

export interface Prefs {
  name: string;
  volume: number;
  showHitboxes: boolean;
  inputDelay: number;
  lastMode: string;
  winScore: number;
}

const DEFAULT_PREFS: Prefs = { name: 'Player', volume: 0.5, showHitboxes: false, inputDelay: 2, lastMode: 'ffa', winScore: 5 };

function read<T>(key: string): Partial<T> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>; } catch { return {}; }
}

export function loadParams(): Params {
  return cloneParams({ ...DEFAULT_PARAMS, ...read<Params>(K_PARAMS) } as Params);
}

export function saveParams(p: Params): void {
  // Only store values that differ from the defaults so new defaults propagate.
  const diff: Params = {};
  for (const k of Object.keys(p)) if (p[k] !== DEFAULT_PARAMS[k]) diff[k] = p[k];
  try { localStorage.setItem(K_PARAMS, JSON.stringify(diff)); } catch { /* ignore */ }
}

export function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...read<Prefs>(K_PREFS) };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(K_PREFS, JSON.stringify(p)); } catch { /* ignore */ }
}
