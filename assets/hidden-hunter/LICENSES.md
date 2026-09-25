# Hidden Hunter assets

Warehouse environment art (floor, walls, barrels, crates, machines, labels)
is original procedural canvas drawing created for this project.

Character and monster sprites are third-party CC0 assets copied into this
repo. They are not hotlinked at runtime.

| Asset | Author | Source | License | URL |
| --- | --- | --- | --- | --- |
| Hunter (Soldier 1 stand/hold/gun/machine/reload/silencer) | Kenney | Top-down Shooter pack | CC0 1.0 | https://kenney.nl/assets/top-down-shooter · https://opengameart.org/content/topdown-shooter |
| Tracker (Survivor 1 stand/hold/gun/machine/reload/silencer) | Kenney | Top-down Shooter pack | CC0 1.0 | https://kenney.nl/assets/top-down-shooter · https://opengameart.org/content/topdown-shooter |
| Weapon gun / silencer overlays | Kenney | Top-down Shooter pack | CC0 1.0 | https://kenney.nl/assets/top-down-shooter |
| Monster (8-direction idle, jump used as walk/attack, death FX). Left-facing frames are horizontal mirrors of the pack's right-facing frames. | Raphael Gonçalves (RGS Dev) | Hand-Drawn Square Characters Animated 8 Directions Top Down | CC0 1.0 | https://opengameart.org/content/hand-drawn-square-characters-animated-8-directions-top-down-free-cc0 · https://rgsdev.itch.io/hand-drawn-square-characters-animated-8-directions-top-down-free-cc0 |
| Tracker goggles glow, muzzle flash, stun bolts, vignette | Project original | `hidden-hunter.js` canvas | Original | n/a |
| HUD / joysticks / crosshair | Project original | `hidden-hunter.css` | Original | n/a |

No League of Legends, Riot, Dead by Daylight, Resident Evil, or other commercial-game assets are used.

The monster frames were checked visually before naming directions. `idle_down` faces down, `idle_up` faces up, `idle_right` faces right, `idle_down_right` faces down-right, and `idle_up_right` faces up-right. The pack has no separate walk sheet, so movement uses the directional jump cycle. Death uses the pack's death effect and is not rotated.

Kenney hunter and tracker poses are single-direction art, not an 8-direction sheet. Each pose's head-to-feet angle was measured. The gun poses lean about 20 degrees off vertical, so facing subtracts that measured angle and then uses the live aim angle. The sprite is not snapped to 8 directions.
