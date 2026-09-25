/*
 * Hidden Hunter floor plan. The original props stay where they were.
 * Everything after them extends the same ground into a larger facility.
 * solid:false objects are drawn but do not block movement.
 */

function prop(id, kind, x, y, w, h, label, solid) {
  const item = { id, kind, x, y, w, h };
  if (label) item.label = label;
  if (solid === false) item.solid = false;
  return item;
}

const ORIGINAL = [
  { id: "shelves", kind: "shelves", label: "SHELVES", x: 70, y: 70, w: 200, h: 64 },
  { id: "container", kind: "container", label: "CONTAINER", x: 360, y: 90, w: 170, h: 78 },
  { id: "door", kind: "door", label: "DOOR", x: 640, y: 18, w: 130, h: 32 },
  { id: "window", kind: "window", label: "WINDOW", x: 18, y: 300, w: 22, h: 140 },
  { id: "pillarA", kind: "pillar", label: "PILLAR", x: 490, y: 210, w: 46, h: 46 },
  { id: "pillarB", kind: "pillar", label: "PILLAR", x: 900, y: 210, w: 46, h: 46 },
  { id: "barrels", kind: "barrels", label: "RED BARRELS", x: 280, y: 390, w: 96, h: 72 },
  { id: "table", kind: "table", label: "TABLE", x: 610, y: 410, w: 150, h: 68 },
  { id: "crates", kind: "crates", label: "CRATES", x: 80, y: 690, w: 168, h: 118 },
  { id: "machine", kind: "machine", label: "LARGE MACHINE", x: 1080, y: 260, w: 230, h: 190 },
  { id: "boxes", kind: "boxes", label: "BOXES", x: 790, y: 640, w: 110, h: 86 },
  { id: "vehicle", kind: "vehicle", label: "VEHICLE", x: 1070, y: 710, w: 230, h: 96 }
];

const ADDED = [
  // East warehouse. Open floor, pillar cover, routes around every column.
  prop("whPillar1", "pillar", 1760, 240, 72, 72, "PILLAR CLUSTER"),
  prop("whPillar2", "pillarWood", 2140, 240, 72, 72),
  prop("whPillar3", "pillar", 2520, 240, 72, 72),
  prop("whPillar4", "pillarWood", 1760, 640, 72, 72),
  prop("whPillar5", "pillar", 2140, 640, 72, 72),
  prop("whPillar6", "pillarWood", 2520, 640, 72, 72),
  prop("whBarrels", "barrels", 1680, 160, 110, 78, "RED BARREL STORAGE"),
  prop("whCrates", "crates", 2860, 200, 168, 118),
  prop("whPallet", "pallet", 2860, 720, 170, 120, "PALLET STACK"),
  prop("whVehicle", "vehicleDark", 1960, 900, 150, 110, "LARGE VEHICLE"),
  prop("whBags1", "sandbag", 1680, 980, 70, 48, null, false),
  prop("whBags2", "sandbag", 1760, 990, 70, 48, null, false),

  // Storage hall. Shelf rows with a walkable aisle between them.
  prop("stShelf1", "shelves", 3180, 200, 240, 64, "LONG SHELF AREA"),
  prop("stShelf2", "shelves", 3500, 200, 240, 64),
  prop("stShelf3", "shelves", 3820, 200, 220, 64),
  prop("stShelf4", "shelves", 3180, 520, 240, 64),
  prop("stShelf5", "shelves", 3500, 520, 240, 64),
  prop("stShelf6", "shelves", 3820, 520, 220, 64),
  prop("stCrates", "crates", 3200, 780, 160, 110),
  prop("stBarrels", "barrelsGreen", 3680, 800, 110, 78),
  prop("stContainer", "container", 3920, 760, 180, 90, "METAL CONTAINER"),

  // South gate from the original room into the loading bay stays open
  // (x 200-900, y 920-1180). Loading bay is the open yard below that.
  prop("bayPillar1", "pillar", 280, 1240, 70, 70),
  prop("bayPillar2", "pillarWood", 980, 1240, 70, 70, "LOADING BAY"),
  prop("bayVehicle", "vehicle", 360, 1480, 210, 110),
  prop("bayPallet", "pallet", 760, 1460, 180, 120, "PALLET STACK"),
  prop("bayCrates", "crates", 1120, 1500, 160, 110),
  prop("bayBarrels", "barrels", 240, 1760, 110, 78),
  prop("bayAbandoned", "vehicleGreen", 860, 1820, 170, 110, "ABANDONED VEHICLE"),
  prop("bayContainer", "container", 1240, 1760, 180, 86),
  prop("bayBags", "sandbag", 560, 1700, 70, 48, null, false),

  // Machinery room, east of the loading bay, with gaps on the west and north.
  prop("mxMachine", "machine", 1860, 1460, 250, 190, "PRODUCTION MACHINE"),
  prop("mxGen", "generator", 2300, 1480, 180, 150, "GENERATOR"),
  prop("mxConvey", "conveyor", 1860, 1860, 560, 58, "CONVEYOR"),
  prop("mxTable", "table", 2520, 1760, 160, 70),
  prop("mxBarrels", "barrelsBlack", 2580, 1500, 100, 74),
  prop("mxPillar", "pillar", 1680, 1680, 68, 68),
  prop("mxCrates", "boxes", 2480, 1960, 120, 86),

  // Maintenance, south of the storage hall.
  prop("mtTable", "table", 3240, 1360, 180, 72, "MAINTENANCE TABLE"),
  prop("mtElec", "generator", 3680, 1320, 200, 150, "ELECTRICAL CABINET"),
  prop("mtBarrels", "barrels", 3280, 1620, 110, 78),
  prop("mtShelf", "shelves", 3640, 1660, 260, 64),
  prop("mtCrates", "crates", 3280, 1840, 150, 110),
  prop("mtPillar", "pillarWood", 3960, 1500, 68, 68),

  // Side room under the loading bay.
  prop("sideTable", "table", 280, 2240, 170, 70, "SIDE ROOM"),
  prop("sideMachine", "machine", 620, 2180, 220, 170),
  prop("sideBarrels", "barrelsGreen", 980, 2240, 110, 78),
  prop("sideCrates", "boxes", 240, 2440, 120, 90),
  prop("sidePillar", "pillar", 1100, 2460, 64, 64),

  // Open yard along the south. Wide gaps, a few landmarks, not a wall.
  prop("yardVehicle", "vehicleDark", 1680, 2320, 160, 110, "YARD VEHICLE"),
  prop("yardBarrels", "barrels", 2140, 2380, 110, 78),
  prop("yardPallet", "pallet", 2460, 2300, 170, 120),
  prop("yardPillar1", "pillarWood", 2920, 2360, 72, 72),
  prop("yardPillar2", "pillar", 3380, 2280, 72, 72),
  prop("yardGen", "generator", 3680, 2320, 170, 140, "YARD GENERATOR"),
  prop("yardBags", "sandbag", 2000, 2520, 70, 48, null, false),
  prop("yardCrates", "crates", 3920, 2140, 150, 110)
];

module.exports = ORIGINAL.concat(ADDED);
