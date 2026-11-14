# Hat Trick — Rules

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
| **Recall** | With no hat in hand and your hat on the ground, hold throw: the hat lifts and accelerates toward you, skimming over low walls and sliding along high ones. It is lethal while moving fast. Release to let it slow down and drop. |
| **Kick** | Attacking without a hat kicks: a big shove that sends enemies flying ~5 units and stuns them for 0.5 s, but does no damage. Knocks riders off. |
| **Parry** | A slash knocks an enemy's flying hat out of the air if the hat enters the arc at any point during the swing (windup + active). |
| **Clash** | If two players slash each other nearly simultaneously, nobody dies: both are knocked back. Two flying hats from different players that collide both drop. |
| **Hit-stop** | Kills, clashes, parries, hat collisions and felled trees freeze the game for 2 frames. |
| **Bot difficulty** | Each bot has Extra easy / Easy / Normal / Hard in the lobby: harder bots attack, throw and dodge more often and aim more precisely; easier bots also move slower. Extra easy bots amble about, rarely attack and never dodge. |
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
| 🕶️ | Invisible | For 10 s nobody can see you (online, your own screen shows a faint ghost). You flash visible while slashing, kicking or aiming, and for 0.6 s after attacking, throwing, dashing, bumping into something or getting hit. Bots lose track of you unless you're very close. |
| 🫧 | Bubble Shield | Survive one hit (brief invulnerability after it pops). |
| 🎩 | Double hat | Two hats: throw twice, or slash while one hat is out. Slash cooldown halves. |
| 👻 | Phase dash | For 12 s, dashes pass through walls (never ending inside one). |
| 🐌 | Slowpoke *(bad)* | Half running and dash speed for 6 s. Cancels Speed (and Speed cancels it). |
| 😵‍💫 | Reversed *(bad)* | Your movement stick is reversed for 6 s. |
| 🚗 | Car | Occasionally a car is parked instead. **Slash** next to it to get in, and slash again to get out. Car controls: up/down = gas/brake, left/right = steer. You can still **throw your hat** while driving: a quick throw exactly along your aim stick/mouse (or the movement stick, or straight ahead), and holding throw recalls it to the car. Running into enemies at speed kills them. A hat hitting the car wrecks it and kills the driver. The car lasts 15 s. Not in Soccer or Lumberjacks. |

### Breakables

Every arena except the Pitch has breakables. They block bodies (bushes let hats
through); slashes and thrown hats damage them (a hat that hits one bounces back
to you); a car at speed smashes straight through. They regrow in place after
20 s (faster on Rooftops; never on top of someone). The regrow times are in settings → Breakables.

| Breakable | Hits | When it breaks |
|---|---|---|
| 🌲 Tree | 3 | Topples over (TIMBER!) and leaves a stump. Scores in Lumberjacks. |
| 📦 Crate | 2 | Splinters; 50% chance to drop a power-up (good or bad). |
| 🛢️ Barrel | 1 | **Explodes**: pops everyone within 2.4 units, *including whoever broke it*, knocks hats down and sets off nearby barrels. |
| 🪨 Rock | 5 | Crumbles. |
| 🌿 Bush | 1 | Bursts into leaves. Hats fly straight through bushes (chopping them). |
| 🌾 Tall grass | 1 | Doesn't block anything, but **hides whoever is in it** (watch for rustling). A slash mows it; it regrows after 6 s. Thrown hats don't cut it. |

### Arena features

| Feature | Arenas | What it does |
|---|---|---|
| Pits / open edges | Pit Arena, Windy Cliffs, Sniper Canyon, Crumbling Platform, Islands (water, with railed bridges), Links (water) | Roll in and you're out. A dash skims over a small gap. Whoever shoved you in (kick, clash, dash bump) in the last 3 s gets the credit. Hats that land in one pop back to their owner. |
| Lava / collapsing floor | Lava Rising, Crumbling Platform, Floor is Lava | Tiles flash red, then fall away (or turn to lava). |
| Ice | Ice Rink | Very slippery: you speed up and stop slowly, kicks send you sliding far, and the ball glides (settings → Ice). |
| Conveyors | Conveyor Factory | Carry players, grounded hats and balls. |
| Bumpers | Pinball | Fling players, hats, balls and cars away. |
| Portals | Teleporter Temple | Step (or throw a hat) in one ring, come out of its partner with your momentum. |
| Wind | Windy Cliffs | Strongly bends flying hats; barely nudges players (both adjustable in settings → Wind). |
| Night | Night Market | Periodically the lights go out (16 s day, 12 s night, 2 s dusk/dawn by default); only a small circle around each player is lit. Day/night lengths, darkness and light radius are in settings (Night). |
| Low walls | everywhere, especially Downtown windows and the Bowling Alley gutters | Block bodies but not hats. Sniper Canyon's pens can't be left at all: it's all hat throwing. |

**Dash bump:** dashing into an enemy shoves them away (no damage).

**Arena choice:** the lobby lists arenas that suit the selected mode, plus 🎲 **Random**, which picks a new arena every round.

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

**Online:** Host online gives you a room code (type your own code first to pick
it). Others type the code and press Join or Enter. Hosting a code that's already
taken just joins that room. You can join a match in progress.

Set your name on the main menu (or in settings). In the lobby, your players'
names are editable right on their cards; press Enter to apply.

---

## Game modes

Every game starts in the **lobby**: free play with respawns, no score. Any
player can pick the mode, arena and target score, and anyone can press Start. After a match ends, everyone returns
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
- Some players are **Overlords** (chosen in the lobby; if nobody chooses, one is picked at random). Overlords have no body: they move a crosshair and press attack to drop a bomb (1 s fall, 0.6 s between bombs). The landing spot flashes red before impact.
- Each bomb blasts where it lands and bursts into a **ring of hats** (2 by default) that fly outward, bounce off walls, and boomerang back to the bomb spot — or to the overlord's *newest* bomb target if another bomb has been launched since — then vanish. They pop any runner they touch. Runners can slash them out of the air or knock them down with their own hats.
- Hats per bomb, delay between bombs, hat speed and distance, fall time and blast radius are in the settings panel (Overlord section).
- Everyone else is a **Runner** on one team. Runners can't hurt each other.
- Runners win the round if anyone survives the 45 s clock; Overlords win if all runners are popped.
- First side to the target score wins.

### Lumberjacks
- Free-for-all on the Clearing arena with 10 trees (plus a few rocks, bushes and explosive barrels — careful).
- Trees block bodies and hats. A slash chops every tree in its arc; a thrown hat chops the tree it hits and bounces back toward you. Kicks and recalled hats don't chop.
- A tree takes 3 chops. Whoever lands the last chop fells it and scores 1. A new tree grows elsewhere 4 s later. Only trees score.
- Combat stays on: popped players respawn after 2.5 s.
- **Timed:** after 90 s, the most trees wins (a tie is a draw). The target score is not used.

### Cars
- Free-for-all elimination rounds (like Free-for-all) on the Raceway arena.
- There are always cars on the field: the host picks how many in the lobby (default 2, up to 8). A wrecked or expired car is replaced after 1.5 s, and if the last one goes, a new one honks its way in immediately.
- Get in, run people over (anything at speed is lethal), and watch out for hats: a hat hitting your car wrecks it and pops you.
- Car power-ups from pickups are off in this mode (cars are always available).

### Bumper Balls
- No hats: only kicks and dash bumps. Shove rivals off the edge of a round platform over the water, whose edge crumbles inward during the round.
- Last ball on the platform wins the round. No power-ups.

### Golf
- Two teams; each has its own ball at a tee. Hit **your** ball with a thrown hat, a slash or a kick: each hit is a stroke. Hitting the other team's ball is free sabotage. Bodies can't push the balls.
- Swinging toward the cup putts (a gentler hit that rolls just past it). A ball moving too fast lips out of the cup.
- Water costs a stroke and puts the ball back where it last rested.
- When every ball is in (or after 90 s, with +2 for unsunk balls) the fewest strokes wins the hole. Holes are rounds; first to the target number of holes wins.

### Floor is Lava
- Free-for-all elimination. Random floor tiles flash and turn to lava, faster and faster. Don't be standing on one.

### Ghost Brawl
- Free-for-all elimination where **everyone is invisible** while standing or walking — even on your own screen; watch for the faint dust you kick up.
- You flash visible for 0.3 s whenever you attack, throw, dash, bump into a wall, crate, bumper or another player, or get hit or kicked (and briefly when you spawn). Aiming keeps you visible.
- Last ball standing wins the round.
