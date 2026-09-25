/*
 * Hidden Hunter warehouse layout.
 * Collision rectangles are in world pixels. Visuals are the CC0 industrial
 * tilesheet; this file only describes where those tiles sit.
 */

const TILE = 32;
const COLS = 126;
const ROWS = 84;
const MAP_W = COLS * TILE;
const MAP_H = ROWS * TILE;
const INSET = TILE;

const SPAWNS = {
  hunter: { x: 44 * TILE + TILE / 2, y: 36 * TILE + TILE / 2 },
  tracker: { x: 62 * TILE + TILE / 2, y: 16 * TILE + TILE / 2 },
  monster: { x: 52 * TILE + TILE / 2, y: 70 * TILE + TILE / 2 }
};

function rect(id, kind, label, tx, ty, tw, th, solid) {
  return {
    id,
    kind,
    label: label || "",
    x: tx * TILE,
    y: ty * TILE,
    w: tw * TILE,
    h: th * TILE,
    solid: solid !== false
  };
}

const OBSTACLES = [
  // West machinery bay, open into the main hall through a wide gap.
  rect("wallWestA", "wall", "", 30, 1, 1, 16),
  rect("wallWestB", "wall", "", 30, 36, 1, 22),
  rect("machine", "machine", "LARGE MACHINE", 3, 3, 10, 5),
  rect("conveyor", "conveyor", "CONVEYOR", 3, 12, 18, 2),
  rect("generator", "generator", "GENERATOR", 4, 18, 5, 4),
  rect("panelWest", "panel", "ELECTRICAL PANEL", 14, 18, 4, 3),
  rect("barrelsWest", "barrels", "RED BARRELS", 6, 26, 3, 2),
  rect("cratesWest", "crate", "", 16, 26, 3, 3),

  // Main warehouse pillars and landmarks.
  rect("pillarA", "pillar", "", 38, 8, 2, 2),
  rect("pillarB", "pillar", "", 38, 20, 2, 2),
  rect("pillarC", "pillar", "", 38, 32, 2, 2),
  rect("pillarD", "pillar", "", 54, 8, 2, 2),
  rect("pillarE", "pillar", "", 54, 20, 2, 2),
  rect("pillarF", "pillar", "", 54, 32, 2, 2),
  rect("pillarG", "pillar", "", 70, 8, 2, 2),
  rect("pillarH", "pillar", "", 70, 20, 2, 2),
  rect("pillarI", "pillar", "", 70, 32, 2, 2),
  rect("barrelsMain", "barrels", "RED BARRELS", 46, 24, 3, 2),
  rect("crateStacks", "crate", "CRATE STACKS", 62, 30, 4, 3),
  rect("hazardMain", "hazard", "", 48, 14, 2, 2, false),

  // Storage rows. Aisles stay several tiles wide.
  rect("wallStoreA", "wall", "", 80, 1, 1, 14),
  rect("wallStoreB", "wall", "", 80, 28, 1, 12),
  rect("cratesA1", "crate", "", 86, 3, 2, 8),
  rect("cratesA2", "crate", "", 86, 16, 2, 8),
  rect("cratesB1", "crate", "", 96, 3, 2, 8),
  rect("cratesB2", "crate", "", 96, 16, 2, 8),
  rect("cratesC1", "crate", "", 106, 3, 2, 10),
  rect("cratesC2", "crate", "", 106, 18, 2, 6),
  rect("container", "container", "BLUE CONTAINER", 116, 4, 6, 4),
  rect("palletsStore", "pallet", "PALLETS", 116, 14, 5, 3),

  // Maintenance rooms east of the hall.
  rect("wallMaintA", "wall", "", 80, 44, 12, 1),
  rect("wallMaintB", "wall", "", 98, 44, 26, 1),
  rect("wallRoom", "wall", "", 104, 46, 1, 6),
  rect("wallRoomB", "wall", "", 104, 58, 1, 4),
  rect("panelMaint", "panel", "ELECTRICAL PANEL", 86, 48, 4, 3),
  rect("cratesMaint", "crate", "", 92, 54, 3, 3),
  rect("barrelsMaint", "barrels", "", 110, 50, 3, 2),

  // Loading bay across the south, with two wide gates from the hall.
  rect("wallLoadA", "wall", "", 2, 58, 22, 1),
  rect("wallLoadB", "wall", "", 36, 58, 16, 1),
  rect("wallLoadC", "wall", "", 64, 58, 16, 1),
  rect("palletsLoad", "pallet", "PALLETS", 6, 64, 6, 3),
  rect("barrelsLoad", "barrels", "RED BARRELS", 28, 66, 3, 2),
  rect("cratesLoad", "crate", "", 44, 64, 4, 3),
  rect("doorA", "door", "LOADING DOOR", 8, 80, 8, 2, false),
  rect("doorB", "door", "LOADING DOOR", 40, 80, 8, 2, false),
  rect("doorC", "door", "LOADING DOOR", 78, 80, 8, 2, false),

  // Abandoned south-east. Shade is lighting only.
  rect("shadeAbandoned", "shade", "", 96, 64, 28, 18, false),
  rect("debrisA", "debris", "", 100, 68, 2, 2),
  rect("debrisB", "crate", "", 112, 70, 3, 2),
  rect("debrisC", "barrels", "RED BARRELS", 118, 76, 3, 2),
  rect("brokenWall", "wall", "", 108, 74, 1, 3)
];

module.exports = {
  TILE,
  COLS,
  ROWS,
  MAP_W,
  MAP_H,
  INSET,
  SPAWNS,
  OBSTACLES
};
