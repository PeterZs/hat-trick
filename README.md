# Hat Trick 🎩⚽

**▶ Play: https://yig.github.io/hat-trick/**

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

Every push to `main` runs the tests, builds, and deploys to GitHub Pages
(`.github/workflows/pages.yml`).

**Modes:** Free-for-all, Teams, Capture the Flag, Soccer, Overlord (asymmetric:
overlords drop bombs on runners), Lumberjacks (timed race to chop the most trees). **Power-ups:** speed, shield, double hat,
phase dash (through walls), and cars. Teammates can ride piggyback.

**Controls** — Keyboard+mouse: WASD, mouse aim, Z or left click slash, X or right
click throw (hold 1 s to aim; also recalls your hat from the ground), C or Space dash. Slash a teammate to ride piggyback, slash next to a car to drive.
Second keyboard player: arrows, `.` slash, `/` throw, `,` dash.
Gamepad: sticks, X/RB slash, RT/B throw, A/LB dash, Start = Play (main menu) / start match (lobby) / pause (in game); menus are navigable with D-pad/stick, A to select, B to go back. Touch: on-screen
stick and buttons. `` ` `` opens settings (all gameplay params, live), Esc the menu.

**Online:** "Host online" gives a room code/link; others "Join online".

Full rules for every mode: [docs/RULES.md](docs/RULES.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Issues** are tracked in-repo with [git-bug](https://github.com/git-bug/git-bug):
`git bug bug` lists them, `git bug termui` browses, `git bug push`/`pull` syncs
with the remote.
