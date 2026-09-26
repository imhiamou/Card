/*
 * Original Hidden Hunter dock floor. Moderately larger than 1820×1170.
 * Props are the existing Kenney top-down kinds, placed as a warehouse,
 * a loading dock, storage lanes, machinery, and a maintenance bay.
 * solid:false objects are drawn but do not block movement.
 */

function prop(id, kind, x, y, w, h, label, solid) {
  const item = { id, kind, x, y, w, h };
  if (label) item.label = label;
  if (solid === false) item.solid = false;
  return item;
}

const MAP_W = 2360;
const MAP_H = 1520;

const PROPS = [
  // Main warehouse. The west hall (x under 480) stays open for the spawns.
  prop("whShelf1", "shelves", 500, 36, 210, 58, "SHELF ROW"),
  prop("whShelf2", "shelves", 830, 36, 210, 58),
  prop("whShelf3", "shelves", 1160, 36, 220, 58, "LONG SHELVES"),
  prop("whShelf4", "shelves", 500, 220, 210, 58),
  prop("whShelf5", "shelves", 830, 220, 210, 58),
  prop("whShelf6", "shelves", 1160, 220, 210, 58),
  prop("door", "door", 1620, 24, 140, 36, "DOOR"),
  prop("window", "window", 20, 360, 26, 150, "WINDOW"),

  // Pillars between the warehouse floor and the machinery bay.
  prop("pil1", "pillar", 1472, 56, 48, 48, "PILLAR CLUSTER"),
  prop("pil2", "pillar", 1472, 220, 48, 48),
  prop("pil3", "pillarWood", 1660, 160, 48, 48),

  // Machinery bay along the northeast wall.
  prop("machine", "machine", 1860, 48, 220, 170, "LARGE MACHINE"),
  prop("gen", "generator", 2180, 56, 160, 140, "GENERATOR"),
  prop("pipes", "conveyor", 1860, 340, 400, 48, "PIPES"),

  // Maintenance bay under the pipe run.
  prop("maintMachine", "machine", 1860, 500, 190, 130, "MAINTENANCE MACHINE"),
  prop("workbench", "table", 2160, 520, 180, 64, "MAINTENANCE TABLE"),
  prop("cabinet", "container", 2160, 700, 160, 76, "CABINET"),

  // Open industrial floor. The monster fallback (980, 480) stays clear.
  prop("barrels", "barrels", 620, 400, 110, 78, "RED BARRELS"),
  prop("whPallets", "pallet", 500, 640, 150, 80, "WAREHOUSE PALLETS"),
  prop("pilMid", "pillar", 1280, 560, 48, 48, "CENTER PILLAR"),
  prop("pilMid2", "pillarWood", 1420, 720, 48, 48),

  // West storage lanes, south of the spawn hall.
  prop("crateStack", "crates", 48, 760, 170, 120, "CRATE STACK"),
  prop("barrelStore", "barrels", 48, 980, 110, 78, "BARREL STORAGE"),
  prop("storeShelf", "shelves", 48, 1160, 280, 58, "STORAGE SHELVES"),
  prop("pilWest", "pillar", 560, 900, 48, 48),

  // Loading dock along the south edge, with gaps wide enough to pass.
  prop("forklift", "forklift", 80, 1348, 200, 100, "FORKLIFT"),
  prop("pallets", "pallet", 440, 1360, 160, 90, "PALLET STACK"),
  prop("dockContainer", "container", 760, 1352, 200, 86, "LOADING CONTAINER"),
  prop("dockCrates", "crates", 1100, 1356, 150, 100, "DOCK CRATES"),
  prop("dockBarrels", "barrelsBlack", 1380, 1368, 110, 78),
  prop("dockVehicle", "vehicle", 1640, 1348, 210, 100, "DOCK VEHICLE"),
  prop("yardContainer", "container", 1980, 1352, 180, 86, "YARD CONTAINER"),
  prop("yardPallet", "pallet", 2260, 1364, 80, 86),
  prop("pilDock", "pillarWood", 980, 1120, 48, 48, "DOCK PILLAR"),

  // East storage lanes.
  prop("eastShelf1", "shelves", 1960, 900, 280, 58, "EAST SHELVES"),
  prop("eastShelf2", "shelves", 1960, 1080, 280, 58),
  prop("eastCrates", "crates", 1680, 880, 150, 110),
  prop("eastBarrels", "barrelsGreen", 1680, 1100, 110, 78),

  // Abandoned scatter on the open yard. Debris does not block movement.
  prop("yardBoxes", "boxes", 1400, 980, 120, 86, "BOXES"),
  prop("sand1", "sandbag", 1540, 1200, 64, 44, null, false),
  prop("sand2", "sandbag", 2080, 1180, 64, 44, null, false)
];

const ALL = PROPS;
ALL.MAP_W = MAP_W;
ALL.MAP_H = MAP_H;
module.exports = ALL;
