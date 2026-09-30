# Hidden Hunter assets

The ground and border are the original procedural canvas drawing, tiled across the larger map.
Prop sprites are all from Kenney's Top-down Shooter pack (CC0). See `ASSET_CREDITS.md`.

Character and monster sprites are third-party assets copied into this
repo. They are not hotlinked at runtime.

| Asset | Author | Source | License | URL |
| --- | --- | --- | --- | --- |
| Hunter body and feet (`player/hunter/`) | Riley Gombart | Animated Top Down Survivor (`Top_Down_Survivor`, rifle idle/move and feet idle/walk) | CC-BY 3.0 | https://opengameart.org/content/animated-top-down-survivor-player |
| Tracker (`lux/idle-1`, `run-1`, `spell-final-spark`) | Unofficial fan artist (creator not named in the pack) | Dreadknight Lux 1.0, uploaded as `Dreadknight_Lux_1.zip` | Free community asset, non-commercial only. Unofficial fan art inspired by League of Legends. Not affiliated with or endorsed by Riot Games. | Included in this repo |
| Monster (`rotmaws/idle-1`, `run-1`, `run-2`, `attack-1`, `spell-lunge`, `death`) | Unofficial fan artist (creator not named in the pack) | Dreadknight Rotmaws 1.0, uploaded as `Dreadknight_Rotmaws_1.0.zip` | Free community asset, non-commercial only. Unofficial fan art inspired by League of Legends. Not affiliated with or endorsed by Riot Games. | Included in this repo |
| Shelves, tables, crates, barrels, machines, pillars, containers, forklift, vehicle, pallet, door, window (`environment/props/`) | Kenney Vleugels | Top-down Shooter (tiles 166, 171, 180, 197, 206, 224, 289, 333, 342, 359, 386, 433, 436, 456, 465, 474, 476, 492) | CC0 1.0 | https://kenney.nl/assets/top-down-shooter |
| Gunshot (`audio/weapons/gunshot`) | rubberduck | 25 CC0 bang / firework SFX (`shot_03.ogg`) | CC0 1.0 | https://opengameart.org/content/25-cc0-bang-firework-sfx |
| Taser fire (`audio/taser/taser-fire`) | Kenney Vleugels | Sci-fi Sounds (`laserSmall_000.ogg`) | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds |
| Taser hit (`audio/taser/taser-hit`) | Kenney Vleugels | Sci-fi Sounds (`laserSmall_002.ogg`) | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds |
| Bullet impact (`audio/impacts/monster-shot`) | Kenney Vleugels | Sci-fi Sounds (`impactMetal_000.ogg`) | CC0 1.0 | https://kenney.nl/assets/sci-fi-sounds |
| Monster attack (`audio/monster/monster-attack`) | Kenney Vleugels | Impact Sounds (`impactPunch_heavy_000.ogg`) | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| Muzzle flash, stun bolts, vignette | Project original | `hidden-hunter.js` canvas | Original | n/a |
| HUD / joysticks / crosshair | Project original | `hidden-hunter.css` | Original | n/a |

No Dead by Daylight, Resident Evil, or other commercial-game assets are used. The exceptions are two unofficial non-commercial fan pictures inspired by League of Legends: Dreadknight Rotmaws (the monster) and Dreadknight Lux (the tracker). They are not Riot Games assets and are not endorsed by Riot. The older CC0 zombie PNGs remain in `monster/`, and the older tracker PNGs remain in `player/tracker/`. Neither of those older sets is drawn.

The hunter rifle frame faces right. The barrel is a horizontal tube on the right side of the cell (its axis measures about -0.65 degrees from +X). The torso pivot is the body center, and the same aim angle rotates the body, the feet, and the muzzle. Standing still plays the idle hold. Walking plays the move bob and the feet cycle. Neither clip turns the body toward travel.

Lux frames are 256×256. The standing figure is about 53px tall and centered near (129, 128), with the head at the top and the feet at the bottom. She faces left. The renderer scales that body to about 76px, a little under the hunter’s 82px, pins (129, 128) on the tracker’s position, and mirrors the picture when the existing aim points right so the head stays up. Her collision radius matches the hunter. Idle 1, Run 1, and Spell Final Spark are the clips in use. Spell Final Spark plays once when a taser shot is accepted, then she returns to Idle 1 or Run 1. Idle 2, Attack 1, Attack 2, Crit 1, Dance, Taunt, and the other spell clips are not used. The aim angle itself is unchanged.

Rotmaws frames are 256×256. The standing figure is about 36px tall and sits below the canvas center, near (128, 143). The head is at the top of the frame and the body faces left. The renderer scales that body to about 68px, pins (128, 143) on the monster's position, and mirrors the picture when the monster's facing points right so the head stays up. Idle 1, Run 1, Run 2, Attack 1, Spell Lunge, and Death are the clips in use. Crit 1, Attack 2, and Spawn 1 are not used. Taking damage still uses the impact spark; Crit 1 is not a hit reaction.
