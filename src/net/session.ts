// A Session owns the authoritative-for-display GameState and advances it one
// frame per tick given this peer's local inputs. LocalSession is offline play;
// RollbackSession (rollback.ts) is networked play.

import type { PlayerInput } from '../sim/input';
import type { Command, GameState, SimEvent } from '../sim/types';
import { createState, step } from '../sim/sim';
import type { Params } from '../sim/params';
import type { MatchConfig } from '../sim/types';

export interface Session {
  readonly peer: number;
  readonly isHost: boolean;
  readonly online: boolean;
  state: GameState;
  /** Advance by (usually) one frame. */
  tick(local: Record<string, PlayerInput>): void;
  /** Queue a command to be applied on our next frame. */
  command(c: Command): void;
  /** Events produced since the last call (render/audio). */
  takeEvents(): { frame: number; ev: SimEvent }[];
  status(): string;
  dispose(): void;
}

export class LocalSession implements Session {
  readonly peer = 0;
  readonly isHost = true;
  readonly online = false;
  state: GameState;
  private cmds: Command[] = [];
  private events: { frame: number; ev: SimEvent }[] = [];

  constructor(cfg: MatchConfig, params: Params, seed = (Date.now() >>> 0)) {
    this.state = createState(cfg, params, seed);
  }

  tick(local: Record<string, PlayerInput>): void {
    const cmds = this.cmds;
    this.cmds = [];
    step(this.state, [{ peer: 0, inputs: local, cmds }]);
    for (const ev of this.state.events) this.events.push({ frame: this.state.frame, ev });
  }

  command(c: Command): void { this.cmds.push(c); }

  takeEvents() { const e = this.events; this.events = []; return e; }

  status(): string { return 'offline'; }

  dispose(): void {}
}
