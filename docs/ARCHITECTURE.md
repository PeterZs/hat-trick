# Boomerang Hat — Architecture

Browser game (TypeScript + Vite + Three.js + PeerJS). The central design rule:
**the game simulation is a deterministic, pure-data state machine that knows
nothing about rendering, input devices, networking, or time.** Everything else
is a layer around it.

```
 devices (kbd/mouse, kb2, gamepads, touch)            src/input/
        │  PlayerInput per device, Commands (join/leave/start…)
        ▼
 Session  ── LocalSession (offline)                   src/net/session.ts
          └─ RollbackSession (online, over NetLink)   src/net/rollback.ts
                 NetLink = PeerJS (WebRTC) | Loopback src/net/link.ts, peerLink.ts
        │  step(state, PeerFrame[]) at fixed 60 Hz
        ▼
 Simulation (pure, deterministic)                     src/sim/
        │  GameState (plain JSON data) + per-step events
        ▼
 Renderer (Three.js) / HUD (DOM) / SFX (WebAudio)     src/render, src/ui, src/audio
```

## Simulation (`src/sim`)

| File | Contents |
|---|---|
| `types.ts` | `GameState` and everything in it; `Command`; `PeerFrame`; `SimEvent` |
| `sim.ts` | `createState`, `step`, command application, `cloneState`, `hashState` |
| `actors.ts` | player movement/dash/slash/throw, hats (boomerangs), melee resolution & clashes, cars, piggyback |
| `modes.ts` | power-ups, soccer ball, flags (CTF), Overlord bombs, round/match flow |
| `bot.ts` | bot AI (runs *inside* the sim, using the sim RNG, so it is deterministic) |
| `level.ts` | static level data (walls, spawns, goals, bases) + bot nav grid |
| `params.ts`, `defaultParams.json` | tunable parameters (metadata + defaults) |
| `input.ts` | quantized `PlayerInput` (int8 sticks + button bits) |
| `dmath.ts`, `rng.ts` | deterministic trig and PRNG |

Rules for code under `src/sim` (required for rollback and a future native port):

- `step(state, inputs)` is a pure function of its arguments: no `Date`,
  `performance.now`, `Math.random`, DOM, or globals with mutable state.
- Only `+ - * /` and `Math.sqrt/round/floor/ceil/abs/min/max/imul` — these are
  bit-exact in IEEE-754 everywhere. Trig goes through `dsin/dcos` in
  `dmath.ts` (polynomial). Never `Math.sin/cos/atan2/pow/exp/hypot`.
- All state is plain data in `GameState` (numbers, strings, booleans, arrays,
  plain objects; no classes, Maps, Sets, or references). Entities refer to each
  other by id/slot. Snapshots are `structuredClone`, hashes are FNV over JSON.
- Durations are stored as integer frame counters (60 Hz); params are in
  seconds and converted with `sec(state, key)`.
- Iteration order is deterministic (arrays; peers sorted by id).
- Gameplay parameters are part of the state (`state.params`), so tuning live
  in the settings panel is itself a deterministic, networked `params` command.

The sim emits `state.events` each step (kills, throws, clashes…) for effects and
audio only; nothing reads them back into the simulation.

### Porting to native

The sim is written in a deliberately plain, data-oriented style (structs of
numbers, free functions, no closures in hot paths, no JS-specific library use)
so it can be transliterated to Rust/C/C++ mechanically. The JSON state format
and `hashState` give a cross-implementation conformance test: replay the same
input log in both and compare hashes every N frames. Alternatively the native
port can be compiled to WASM and swapped in behind the same `step()` API.

## Inputs, players, and commands

A *peer* is one browser. Each peer has local *devices* identified by a key
(`kbm`, `kb2`, `pad0`…, `touch`). A player in the sim is identified by
`(peer, device)`, which is how inputs are routed. Joining/leaving and lobby
changes are `Command`s that travel in the same per-frame stream as inputs, so
every peer applies them at the same frame. This is what lets players join or
leave at any time — including new peers mid-match.

Per frame, each peer contributes a `PeerFrame { peer, inputs: {device: PlayerInput}, cmds }`.
Bots have no device; their input is computed by `botInput` inside `step`.

## Networking (`src/net`)

`RollbackSession` implements GGPO-style rollback over a star topology
(peer 0 = host relays all messages; PeerJS handles WebRTC signaling).

- **Input delay + prediction.** Local input for frame `f` is sent at `f - inputDelay`.
  Missing remote inputs are predicted by repeating that peer's last inputs.
- **Rollback.** A snapshot is stored before each simulated frame. When a real
  message differs from the prediction used, restore that snapshot and
  re-simulate to the present. Prediction depth is capped (`maxPredict`); the
  game stalls rather than predicting further.
- **Confirmation.** Frame `f` is confirmed once messages from every member peer
  for `f` are known. Old snapshots are garbage-collected below the confirmed frame.
- **Membership** is decided by the host and announced in its own frame
  message (`j`/`l` fields) for the frame where it takes effect, so all peers
  agree deterministically on whose input is required when.
- **Late join.** The host sends a `welcome` with the last confirmed snapshot and
  all known messages since; the newcomer fast-forwards to catch up.
- **Disconnect.** The host schedules the leave and a `peerLeft` command
  (removes that peer's players; bots are kept).
- **Time sync.** Clients compare their frame with the host's (adjusted by RTT/2)
  and occasionally stall or double-step.
- **Desync detection.** Every 60 confirmed frames clients send a state hash to
  the host, which compares and flags `DESYNC` in the status bar.

`LoopbackHub` provides an in-memory transport with latency/jitter for tests
(`tests/net.test.ts`).

## Presentation

- `render/renderer.ts` — builds the level, keeps a view object per entity
  (keyed by id), and syncs it from the state each animation frame. Balls roll
  by integrating their displacement; the "head" (eyes + hat stack) does not
  roll. Renderer state never feeds back into the sim. Effects are de-duplicated
  by (frame, event) because rollback can replay events.
- `render/models.ts` — procedural low-poly models: 8 sports balls (patterns via
  per-face colors), 8 hats, car, flags, pick-ups.
- `ui/` — DOM UI: main menu, lobby (it is a sim phase, so it works online),
  HUD, pause menu, and the non-modal settings panel (params persisted in
  `localStorage`, downloadable as `defaultParams.json`).
- `input/` — device abstraction; keyboard taps are latched so presses shorter
  than one frame still register. Touch controls are a DOM overlay.
- `main.ts` — the fixed-timestep loop (60 Hz sim, render every rAF).

## Game flow

`phase`: `lobby` (free play, respawns) → `countdown` → `playing` → `roundOver`
→ … → `matchOver` → back to `lobby`. FFA/Teams/Overlord are round-based
elimination; CTF and Soccer respawn players and score objectives.

## Adding things

- **Power-up:** add to `PickupKind`/`PICKUP_KINDS` (types.ts), apply in
  `applyPickup` (modes.ts), add a color/icon in `models.ts`.
- **Level:** add to `LEVELS` in `level.ts` (walls are AABBs; `high` walls stop hats).
- **Juice:** hit-stop is sim state (`state.hitstop`, params `hitstopKill`/`hitstopClash` in frames) so it stays deterministic online; flash, camera punch, shake and sparks are render-only (`renderer.onEvent`).
- **Param:** add to `PARAM_DEFS` and `defaultParams.json`; read via `s.params.key`.
- **Mode:** add to `ModeId` and `MODES`, then hook into `updateRules` / `modes.ts`.

## Testing

`npm test` runs: determinism (two runs → equal hash), snapshot/resimulate
equivalence, mechanics (clash, parry, kick, throw/return/recall, piggyback,
car), every mode with bots, and netcode sync under latency/jitter with late
join and disconnect.
