# Hidden Hunter assets

Warehouse environment art (floor, walls, barrels, crates, machines, labels)
is original procedural canvas drawing created for this project.

Character and monster sprites are third-party assets copied into this
repo. They are not hotlinked at runtime.

| Asset | Author | Source | License | URL |
| --- | --- | --- | --- | --- |
| Hunter body and feet (`player/hunter/`) | Riley Gombart | Animated Top Down Survivor (`Top_Down_Survivor`, rifle idle/move and feet idle/walk) | CC-BY 3.0 | https://opengameart.org/content/animated-top-down-survivor-player |
| Tracker body (`player/tracker/`) | Bleed | tmim Heroine (`wIdle` and `Walk` strips) | CC-BY 3.0 | https://opengameart.org/content/tmim-heroine-bleeds-game-art |
| Monster (`monster/zombie_idle_*`, `zombie_move_*`, `zombie_attack_*`) | Riley Gombart (ChessMasterRiley) | Animated Top Down Zombie (`tds_zombie.zip`, files exported as `skeleton-*`) | CC0 1.0 | https://opengameart.org/content/animated-top-down-zombie |
| Muzzle flash, stun bolts, vignette | Project original | `hidden-hunter.js` canvas | Original | n/a |
| HUD / joysticks / crosshair | Project original | `hidden-hunter.css` | Original | n/a |

No League of Legends, Riot, Dead by Daylight, Resident Evil, or other commercial-game assets are used.

The hunter rifle frame faces right. The barrel is a horizontal tube on the right side of the cell (its axis measures about -0.65 degrees from +X). The torso pivot is the body center, and the same aim angle rotates the body, the feet, and the muzzle. Standing still plays the idle hold. Walking plays the move bob and the feet cycle. Neither clip turns the body toward travel.

The tracker sheet was normalized so Bleed's published foot origin is the pivot of every cell. Direction comes from the frames themselves: frame 6 faces left, and the index increases with `atan2` (y grows downward). Standing still holds that direction's idle cell. Walking plays that direction's walk cycle. The cell is not given an extra rotation.

The zombie pack is one right-facing pose per animation (the head is on the right of the frame). Idle, move, and attack are the pack's own clips. There is no death clip. The sprite is turned so that right-facing forward follows movement, or the attack target while attacking. It is not spun at random, and it is not the previous red monster.
