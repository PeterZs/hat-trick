# Boomerang Hat 🎩⚽

A party brawler in the spirit of Boomerang Fu: you are a sports ball, your
weapon is your hat. Throw it, it comes back. Browser-based, local multiplayer
with any mix of keyboard/mouse, gamepads, and touch, plus online play with
rollback netcode.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # sim, mechanics, and netcode tests
npm run build
```

**Modes:** Free-for-all, Teams, Capture the Flag, Soccer, Overlord (asymmetric:
overlords drop bombs on runners), Lumberjacks (timed race to chop the most trees). **Power-ups:** speed, shield, double hat,
phase dash (through walls), and cars. Teammates can ride piggyback.

**Controls** — Keyboard+mouse: WASD, mouse aim, left click slash, right click
hold-to-aim/throw (or recall your hat from the ground), Space dash, E ride/car.
Second keyboard player: arrows, `.` slash, `/` throw, `,` dash, `M` ride.
Gamepad: sticks, X/RB slash, RT/B throw, A/LB dash, Y ride, Start = start match (lobby) / pause; menus are navigable with D-pad/stick, A to select, B to go back. Touch: on-screen
stick and buttons. `` ` `` opens settings (all gameplay params, live), Esc the menu.

**Online:** "Host online" gives a room code/link; others "Join online".

Full rules for every mode: [docs/RULES.md](docs/RULES.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Issues** are tracked in-repo with [git-bug](https://github.com/git-bug/git-bug):
`git bug bug` lists them, `git bug termui` browses, `git bug push`/`pull` syncs
with the remote.
