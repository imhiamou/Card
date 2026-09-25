# Hidden Hunter assets

Warehouse environment art (floor, walls, barrels, crates, machines, labels)
is original procedural canvas drawing created for this project.

Character and monster sprites are third-party CC0 assets copied into this
repo. They are not hotlinked at runtime.

| Asset | Author | Source | License | URL |
| --- | --- | --- | --- | --- |
| Hunter and Tracker body (`player/idle_*`, `player/walk_*`) | ghpaetzold | Hunter full spritesheet (`hunter_allsprites.png`) | CC0 1.0 | https://opengameart.org/content/hunter-full-spritesheet |
| Monster (`monster/zombie_idle_*`, `zombie_move_*`, `zombie_attack_*`) | Riley Gombart (ChessMasterRiley) | Animated Top Down Zombie (`tds_zombie.zip`, files exported as `skeleton-*`) | CC0 1.0 | https://opengameart.org/content/animated-top-down-zombie |
| Muzzle flash, tracker tint, stun bolts, vignette | Project original | `hidden-hunter.js` canvas | Original | n/a |
| HUD / joysticks / crosshair | Project original | `hidden-hunter.css` | Original | n/a |

No League of Legends, Riot, Dead by Daylight, Resident Evil, or other commercial-game assets are used.

The hunter sheet is 192×1680 and divides into 24×30 frames (8 columns). Those frames were inspected before naming:

- Row 0 faces down (face and eyes, feet at the bottom).
- Row 1 faces up (back of the head, no face).
- Row 2 faces left (profile, face toward the left).
- Row 3 faces right (mirror of row 2).
- Rows 4–7 are the walk cycles for down, up, left, and right.

There is no diagonal body in the sheet, so aim snaps to the nearest of those four. Sprites are not rotated. Column 0 of each idle row is the standing frame. Walk uses the eight frames of the matching walk row, and only while the player is actually moving.

The zombie pack is one right-facing pose per animation (the head is on the right of the frame). Idle, move, and attack are the pack's own clips. There is no death clip. The sprite is turned so that right-facing forward follows movement, or the attack target while attacking. It is not spun at random, and it is not the previous red monster.
