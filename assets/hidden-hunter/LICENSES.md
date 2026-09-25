# Hidden Hunter assets

Warehouse environment art (floor, walls, barrels, crates, machines, labels)
is original procedural canvas drawing created for this project.

Character and monster sprites are third-party assets copied into this
repo. They are not hotlinked at runtime.

| Asset | Author | Source | License | URL |
| --- | --- | --- | --- | --- |
| Hunter body and feet (`player/hunter/`) | Riley Gombart | Animated Top Down Survivor (`Top_Down_Survivor`, rifle idle/move and feet idle/walk) | CC-BY 3.0 | https://opengameart.org/content/animated-top-down-survivor-player |
| Tracker body (`player/tracker/`) | Riley Gombart | Animated Top Down Survivor (`Top_Down_Survivor`, handgun idle/move/shoot) | CC-BY 3.0 | https://opengameart.org/content/animated-top-down-survivor-player |
| Monster (`monster/zombie_idle_*`, `zombie_move_*`, `zombie_attack_*`) | Riley Gombart (ChessMasterRiley) | Animated Top Down Zombie (`tds_zombie.zip`, files exported as `skeleton-*`) | CC0 1.0 | https://opengameart.org/content/animated-top-down-zombie |
| Muzzle flash, stun bolts, vignette | Project original | `hidden-hunter.js` canvas | Original | n/a |
| Warehouse tiles (`map/industrial.png`) | OpenGameArt, Industrial Tiles | 16×16 top-down industrial sheet | CC0 1.0 | https://opengameart.org/content/industrial-tiles |
| HUD / joysticks / crosshair | Project original | `hidden-hunter.css` | Original | n/a |

No League of Legends, Riot, Dead by Daylight, Resident Evil, or other commercial-game assets are used.

The hunter rifle frame faces right. The barrel is a horizontal tube on the right side of the cell (its axis measures about -0.65 degrees from +X). The torso pivot is the body center, and the same aim angle rotates the body, the feet, and the muzzle. Standing still plays the idle hold. Walking plays the move bob and the feet cycle. Neither clip turns the body toward travel.

The tracker is the same pack's handgun set. The pistol is a horizontal tube on the right of the cell (its axis measures about -0.9 degrees from +X). The torso pivot is the body center, and the existing aim angle rotates the body onto the mouse. Standing still plays the handgun idle. Walking plays the handgun move bob. Firing the taser plays the handgun shoot recoil. None of those clips turn the body toward travel.

The zombie pack is one right-facing pose per animation (the head is on the right of the frame). Idle, move, and attack are the pack's own clips. There is no death clip. The sprite is turned so that right-facing forward follows movement, or the attack target while attacking. It is not spun at random, and it is not the previous red monster.

The warehouse floor, walls, and props are the CC0 top-down Industrial Tiles sheet. Kenney Factory Kit and Conveyor Kit are 3D, and the mine tileset, pixel-platformer expansion, and ACTG warehouse pack are side-view, so those sheets are not mixed into this top-down map.
