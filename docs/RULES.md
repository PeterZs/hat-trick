# Boomerang Hat — Rules

Numbers below are the current defaults from `src/sim/defaultParams.json`. All
of them can be changed live in the settings panel (`` ` ``).

## Core rules (all modes)

**You are a ball; your hat is your weapon.** One hit pops you (unless you have
a shield).

| Action | How it works |
|---|---|
| **Roll** | Move freely. Walls and crates block you; low walls block you but not hats. |
| **Dash** | Short burst in your movement direction (or facing direction if standing). 0.6 s cooldown. |
| **Slash** | Requires a hat. A 160° swipe in front of you after a brief windup. Kills enemies in range. 0.35 s cooldown. |
| **Quick throw** | Tap throw (or release before 1 s). Your hat flies 9 units straight ahead at speed 20, slows, and comes straight back along the same line (bending only to follow you if you've moved). You keep moving normally while holding. |
| **Aimed throw** | Hold throw for **1 second** to enter *stationary aim mode*: you stand still, a ring fills while you wind up, then a dashed line shows the throw. In aim mode the movement stick (or aim stick / mouse) only aims. Power builds over 0.7 s up to distance 18 at speed 30. Release to throw. |
| **Catch** | A returning hat is caught automatically when it reaches you. |
| **Hats always come back** | An outbound hat that hits a wall, tree or ball bounces off and heads home early. A returning hat slides along walls to get around them. It only drops to the ground if it is **pinned** against a wall without getting closer to you for 0.25 s, collides with another flying hat, is slashed out of the air, is caught in a bomb blast, or its owner dies. Walk over a dropped hat to pick it up. |
| **Recall** | With no hat in hand and your hat on the ground, hold throw: the hat lifts, flies over walls and accelerates toward you. It is lethal while moving fast. Release to let it slow down and drop. |
| **Kick** | Attacking without a hat kicks: a big shove that sends enemies flying ~5 units and stuns them for 0.5 s, but does no damage. Knocks riders off. |
| **Parry** | A slash knocks an enemy's flying hat out of the air if the hat enters the arc at any point during the swing (windup + active). |
| **Clash** | If two players slash each other nearly simultaneously, nobody dies: both are knocked back. Two flying hats from different players that collide both drop. |
| **Hit-stop** | Kills, clashes, parries, hat collisions and felled trees freeze the game for 2 frames. |
| **Bot difficulty** | Each bot has Easy / Normal / Hard in the lobby: harder bots attack, throw and dodge more often and aim more precisely; easy bots also move slower. |
| **Spawn protection** | 1.2 s of invulnerability (blinking) after spawning. |

Friendly fire is off in team modes. Your own hat never hurts you.

### Power-ups

A random power-up appears every 7 s (max 3 on the field). Walk over it to take it.
About 30% of them are **bad** — they look like dark, spiky lumps instead of shiny gems,
so you can dodge them (or knock a rival into one). When you pick something up, its
icon and name pop up over you; active effects show as icons next to your name.
All are lost when you die. With **Hide power-up identity** (settings) on, every
power-up is an identical ❓ box until someone picks it up — good or bad is a gamble.

| Icon | Power-up | Effect |
|---|---|---|
| ⚡ | Speed | 1.5× running speed for 10 s. |
| 🕶️ | Invisible | For 10 s nobody can see you (your own screen shows a faint ghost). You flash visible while slashing, kicking or aiming, and for 0.6 s after attacking or throwing. Bots lose track of you unless you're very close. |
| 🛡️ | Shield | Survive one hit (brief invulnerability after it pops). |
| 🎩 | Double hat | Two hats: throw twice, or slash while one hat is out. Slash cooldown halves. |
| 👻 | Phase dash | For 12 s, dashes pass through walls (never ending inside one). |
| 🐌 | Slowpoke *(bad)* | Half running and dash speed for 6 s. Cancels Speed (and Speed cancels it). |
| 😵‍💫 | Reversed *(bad)* | Your movement stick is reversed for 6 s. |
| 🚗 | Car | Occasionally a car is parked instead. **Slash** next to it to get in, and slash again to get out. Car controls: up/down = gas/brake, left/right = steer. You can still **throw your hat** while driving: a quick throw exactly along your aim stick/mouse (or the movement stick, or straight ahead), and holding throw recalls it to the car. Running into enemies at speed kills them. A hat hitting the car wrecks it and kills the driver. The car lasts 15 s. Not in Soccer or Lumberjacks. |

### Piggyback (team modes)

**Slash a teammate** (in front of you, within reach) to hop on their back instead
of swinging. The rider can't move but aims, slashes and throws freely in any
direction; the carrier runs at 2× speed and can dash, but can't attack or throw.
The **carrier presses slash** to throw the rider off; the **rider dashes** to hop
off. A kick or the carrier's death also splits you up. There is no separate
interact button: slash does it all (riding, cars).

### Joining and leaving

Players can join (any device's join button) or leave at any time, including
mid-match and online. A new player spawns immediately.

---

## Game modes

Every game starts in the **lobby**: free play with respawns, no score. The host
picks the mode and arena and presses Start. After a match ends, everyone returns
to the lobby after 8 s.

### Free-for-all
- Everyone for themselves. Rounds: when one player is left, they score a point.
- No respawns during a round (except when fewer than 2 players are present).
- First to the target score (default 5) wins.

### Teams
- Up to 4 teams (Red, Blue, Yellow, Green), chosen in the lobby.
- Last team with anyone standing wins the round. First team to the target score wins.
- Piggyback is available.

### Capture the Flag
- Two teams, each with a flag at its base (Fortress arena).
- Touch the enemy flag to pick it up; bring it to your own base **while your own flag is at home** to score.
- If the carrier dies, the flag drops. Touching your own dropped flag returns it home; otherwise it returns by itself after 10 s.
- Players respawn after 2.5 s. First team to the target score wins.

### Soccer
- Two teams, one ball, a net at each end (Pitch arena).
- Push the ball by rolling into it; slashes and thrown hats smack it harder (hats bounce off it and come back), and a **kick** (attack without your hat) really sends it flying.
- A goal scores for the attacking team and resets positions.
- Players can still pop each other and respawn after 2.5 s. First to the target score wins.

### Overlord (asymmetric)
- Some players are **Overlords** (chosen in the lobby; if nobody chooses, one is picked at random). Overlords have no body: they move a crosshair and press attack to drop a bomb (1 s fall, 1 s cooldown). The landing spot flashes red before impact.
- Everyone else is a **Runner** on one team. Runners can't hurt each other.
- Runners win the round if anyone survives the 45 s clock; Overlords win if all runners are popped.
- First side to the target score wins.

### Lumberjacks
- Free-for-all on the Clearing arena with 10 trees.
- Trees block bodies and hats. A slash chops every tree in its arc; a thrown hat chops the tree it hits and bounces back toward you. Kicks and recalled hats don't chop.
- A tree takes 3 chops. Whoever lands the last chop fells it and scores 1. A new tree grows elsewhere 4 s later.
- Combat stays on: popped players respawn after 2.5 s.
- **Timed:** after 90 s, the most trees wins (a tie is a draw). The target score is not used.

### Cars
- Free-for-all elimination rounds (like Free-for-all) on the Raceway arena.
- There are always cars on the field: the host picks how many in the lobby (default 2, up to 8). A wrecked or expired car is replaced after 1.5 s, and if the last one goes, a new one honks its way in immediately.
- Get in, run people over (anything at speed is lethal), and watch out for hats: a hat hitting your car wrecks it and pops you.
- Car power-ups from pickups are off in this mode (cars are always available).
