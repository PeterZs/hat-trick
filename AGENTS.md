## Core Gameplay

We want to make a game with core gameplay inspired by Boomerang Fu. That is, a not-quite overhead fixed 3D camera. Each player controls one character with the following core abilities:
* Can walk around the world.
* Can dash.
* Can melee slash with a weapon.
* Can throw the weapon, which shoots out in a straight line (with a spinning animation) and then returns homing towards the player who threw it (like a boomerang), unless it bumps into a wall and falls to the ground.
* A melee slash into a thrown weapon causes the thrown weapon to immediately fall to the ground.
* Two players who melee slash each other nearly simultaneously do not damage each other. They are kicked back.
* When the weapon is not held by the player, they cannot melee slash. Instead, they can kick or bounce another player away, but it doesn't do damage.
* The player can hold the throw button to stand and aim and get a better throw (longer or faster, to be tuned).
* If the boomerang is on the ground, players hold the throw button which slowly accelerates the boomerang to home back towards the player. While the boomerang is homing, it can slice others.
* One hit kills (unless players have a power up).

## Art style

The boomerangs are hats. The character choices are balls from different sports. The balls roll, so no feet animation is needed.

Stay with a cute art style with simple, relatively low-polygon assets with flat colors.

## Levels

Start with a basic level that is a rectangular arena with some boxes and walls. You can't walk through walls. Some low walls you can throw over.

More levels to come later.

## Game Modes

A main menu allows choosing the game mode.

The basic game mode is a free-for-all battle royal where you must kill everyone. Support team play.

Power ups appear randomly:
* Faster movement speed.
* A shield so you can take one hit.
* Two weapons, so you can attack twice as fast and melee while throwing or throw twice.
* Dash through walls.
* More to come later.
* A car, where a player can get in it and drive fast, but has to use car controls.

Two players on the same team can join piggyback, where one rides the other and can aim in any direction. The player below can run twice as fast as usual.

Capture the Flag

Soccer. Each team has a net. There is one ball.

Asymmetric gameplay where some players control the environment rather than characters.

## Architecture

Document the software architecture. Commit often. Use git-bug for issue tracking.

Players can join or leave the game at any time (and pair new controllers).

A non-modal settings menu with, among other things, developer parameters like running speed, dash cooldown, slash cooldown, boomerang speed, boomerang distance, hold-throw speed, hold-throw distance, attack radius, hit radius, etc. Parameters are remembered across refreshes and downloadable for updating the defaults.

Make it browser-based. Use virtual touchpad controls for iOS, WASD plus mouse aiming on desktop, and virtual controller support.

Be disciplined about game state so we can implement rollback netcode with PeerJS network player support.

The core gameplay should be able to someday compile to native code for other platforms, so think about architecture/language choice.
