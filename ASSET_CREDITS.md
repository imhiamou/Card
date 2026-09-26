# Asset credits

Only files copied into this repository are used at runtime. Nothing is loaded from a third-party site during play.

## Kenney — Top-down Shooter

- Pack name: Top-down Shooter
- Creator: Kenney Vleugels (www.kenney.nl)
- Source: https://kenney.nl/assets/top-down-shooter
- License: CC0 1.0 (public domain). The pack's `License.txt` states Creative Commons Zero.
- Every environmental prop is a tile from this one pack. Tanks Redux sprites are no longer used.
- Files used:
  - `assets/hidden-hunter/environment/props/barrels/barrel-orange.png` (tile 197)
  - `assets/hidden-hunter/environment/props/barrels/barrel-tan.png` (tile 206)
  - `assets/hidden-hunter/environment/props/barrels/barrel-metal.png` (tile 359)
  - `assets/hidden-hunter/environment/props/crates/crate.png` (tile 171)
  - `assets/hidden-hunter/environment/props/crates/crate-side.png` (tile 224)
  - `assets/hidden-hunter/environment/props/furniture/table.png` (tile 180)
  - `assets/hidden-hunter/environment/props/furniture/shelf.png` (tile 166)
  - `assets/hidden-hunter/environment/props/industrial/machine.png` (tile 342)
  - `assets/hidden-hunter/environment/props/industrial/console.png` (tile 333)
  - `assets/hidden-hunter/environment/props/industrial/container.png` (tile 386)
  - `assets/hidden-hunter/environment/props/industrial/pillar.png` (tile 492)
  - `assets/hidden-hunter/environment/props/industrial/post.png` (tile 224)
  - `assets/hidden-hunter/environment/props/industrial/door.png` (tile 436)
  - `assets/hidden-hunter/environment/props/industrial/window.png` (tile 433)
  - `assets/hidden-hunter/environment/props/industrial/forklift.png` (tile 476)
  - `assets/hidden-hunter/environment/props/industrial/vehicle.png` (tile 474)
  - `assets/hidden-hunter/environment/props/industrial/pallet.png` (tile 456)
  - `assets/hidden-hunter/environment/props/industrial/grate.png` (tile 465)
  - `assets/hidden-hunter/environment/props/industrial/debris.png` (tile 289)

The ground is still the original procedural floor. The default dock layout still uses only the sprites listed above. The map editor can also place sprites from the library below. Those sprites are not added to the default map on their own.

## Map editor library

Sprites in `assets/map-editor/` are stored in the repository. The game and the editor load those files. They are not requested from Kenney, OpenGameArt, or itch.io at runtime. A saved map stores an asset id, position, rotation, scale, layer, and collision flag. It does not embed the image.

### Kenney — Top-down Shooter (editor tiles)

- Pack name: Top-down Shooter
- Creator: Kenney Vleugels (www.kenney.nl)
- Website: https://kenney.nl/assets/top-down-shooter
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero.
- Files: `assets/map-editor/kenney/top-down-shooter/` (the pack's environment tiles). Character sheets and weapon icons from the same zip were not imported.

### Kenney — Top-down Tanks Remastered

- Pack name: Top-down Tanks Remastered
- Creator: Kenney Vleugels (www.kenney.nl)
- Website: https://kenney.nl/assets/top-down-tanks-remastered
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero.
- Files: `assets/map-editor/kenney/top-down-tanks/` (vehicles, top-down barrels, barricades, crates, and related props). Bullets, explosions, outlines, and side-view barrel sprites were not imported. Outdoor road tiles are in the library with warehouse style turned off.

### Kenney — Map Pack

- Pack name: Map Pack
- Creator: Kenney Vleugels (www.kenney.nl)
- Website: https://kenney.nl/assets/map-pack
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero.
- Files: `assets/map-editor/kenney/map-pack/`. These are separate terrain pieces. They do not replace the Hidden Hunter ground. Warehouse style leaves them hidden until that filter is turned off.

### Screaming Brain Studios — Tiny Top Down Pack

- Pack name: Tiny Top Down Pack
- Creator: Screaming Brain Studios
- Website: https://screamingbrainstudios.itch.io/tiny-top-down-pack
- License: CC0 1.0. The pack `License.txt` states CC0 / public domain, and the itch.io page says the same.
- Files: `assets/map-editor/screaming-brain/tiny-top-down/` (100 tiles, 32×32, cut from the pack sheet). Different pixel scale from the Kenney warehouse sprites, so warehouse style leaves them hidden until that filter is turned off.

### OpenGameArt — Sci-fi Interior tiles

- Pack name: Sci-fi Interior tiles
- Creator: MDK
- Website: https://opengameart.org/content/sci-fi-interior-tiles
- License: CC0 1.0. The OpenGameArt license field links to Creative Commons Zero.
- Files: `assets/map-editor/opengameart/sci-fi-interior/` (16×16 cells cut from `scifitiles-sheet.png`). Different pixel scale, so warehouse style leaves them hidden until that filter is turned off.

### Reviewed and not imported

These packs were checked and left out so the library does not mix in a different perspective or an unseparated sheet:

- Tiny Platformer Pack, Screaming Brain Studios, https://screamingbrainstudios.itch.io/tiny-platformer-pack, CC0. Side-view platformer tiles.
- Factory tileset, KeyserEX, https://opengameart.org/content/factory-tileset, CC0. Side-view factory tiles.
- Modern city extension, Snabisch, https://opengameart.org/content/modern-city-extension, CC0. One unseparated town sheet in a different style.
- Home Objects, Curt, https://opengameart.org/content/home-objects, CC0. One unseparated object sheet; the pieces did not cut into clean sprites.

## Combat audio

Each clip is stored in the repo as the original `.ogg` plus an `.mp3` encode of that same file so Safari and iOS can play it. Nothing is streamed from a third-party site.

### Gunshot — `assets/hidden-hunter/audio/weapons/gunshot.ogg`

- Sound name: gunshot (`shot_03.ogg` in the source pack)
- Creator: rubberduck
- Source: https://opengameart.org/content/25-cc0-bang-firework-sfx
- License: CC0 1.0. The OpenGameArt page lists the pack as CC0. The author describes the short bangs, including this clip, as usable for gun shots.

### Taser fire — `assets/hidden-hunter/audio/taser/taser-fire.ogg`

- Sound name: taser fire (`Audio/laserSmall_000.ogg`)
- Creator: Kenney Vleugels (www.kenney.nl)
- Source: https://kenney.nl/assets/sci-fi-sounds
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero (Sci-fi Sounds 1.0, 11-10-2020).

### Taser hit — `assets/hidden-hunter/audio/taser/taser-hit.ogg`

- Sound name: monster getting tased (`Audio/laserSmall_002.ogg`)
- Creator: Kenney Vleugels (www.kenney.nl)
- Source: https://kenney.nl/assets/sci-fi-sounds
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero (Sci-fi Sounds 1.0, 11-10-2020).

### Bullet impact — `assets/hidden-hunter/audio/impacts/monster-shot.ogg`

- Sound name: monster getting shot (`Audio/impactMetal_000.ogg`)
- Creator: Kenney Vleugels (www.kenney.nl)
- Source: https://kenney.nl/assets/sci-fi-sounds
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero (Sci-fi Sounds 1.0, 11-10-2020).

### Monster attack — `assets/hidden-hunter/audio/monster/monster-attack.ogg`

- Sound name: monster hitting a player (`Audio/impactPunch_heavy_000.ogg`)
- Creator: Kenney Vleugels (www.kenney.nl)
- Source: https://kenney.nl/assets/impact-sounds
- License: CC0 1.0. The pack `License.txt` states Creative Commons Zero (Impact Sounds 1.0, 19-12-2019).
