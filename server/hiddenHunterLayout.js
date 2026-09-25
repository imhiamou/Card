/*
 * Hidden Hunter floor plan. The original props stay where they were.
 * The map is moderately larger (1.3x). New props reuse the same kinds.
 * Major landmarks are fixed. Smaller props are seeded so they stay put
 * between matches. solid:false objects are drawn but do not block movement.
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

const MAP_W = 1820;
const MAP_H = 1170;

// Open routes into the new east strip and south strip. Props may not sit here.
const GATES = [
  { x: 1310, y: 400, w: 170, h: 300 },
  { x: 400, y: 820, w: 620, h: 190 },
  { x: 1360, y: 860, w: 140, h: 160 }
];

const SPAWN_PADS = [
  { x: 240, y: 520, r: 140 },
  { x: 240, y: 280, r: 140 },
  { x: 980, y: 480, r: 170 }
];

const LANDMARKS = [
  prop("eastMachine", "machine", 1472, 48, 200, 160, "EAST MACHINE"),
  prop("eastPillar", "pillar", 1748, 220, 48, 48, "EAST PILLAR"),
  prop("southVehicle", "vehicle", 80, 1024, 210, 90, "SOUTH VEHICLE"),
  prop("southPallet", "pallet", 460, 1040, 140, 96, "SOUTH PALLET"),
  prop("southContainer", "container", 760, 1052, 160, 74, "LOADING CONTAINER"),
  prop("southShelves", "shelves", 1060, 1016, 200, 60, "SOUTH SHELVES"),
  prop("cornerCrates", "crates", 1488, 1024, 140, 100, "CORNER CRATES"),
  prop("cornerPillar", "pillarWood", 1704, 1048, 48, 48, "CORNER PILLAR")
];

const DECOR = [
  ["barrels", 96, 72, 1510, 280],
  ["boxes", 100, 78, 1640, 300],
  ["sandbag", 70, 48, 1708, 80],
  ["barrelsGreen", 96, 72, 1504, 748],
  ["table", 120, 60, 1664, 760],
  ["pillar", 46, 46, 1760, 760],
  ["barrelsBlack", 96, 72, 1288, 1048],
  ["boxes", 100, 78, 1668, 1008],
  ["pillarWood", 46, 46, 1700, 340],
  ["boxes", 100, 78, 1524, 908],
  ["sandbag", 70, 48, 980, 1088]
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.sqrt(dx * dx + dy * dy);
}

function hitsPad(rect, pad) {
  const nx = Math.max(rect.x, Math.min(pad.x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(pad.y, rect.y + rect.h));
  const dx = pad.x - nx;
  const dy = pad.y - ny;
  return dx * dx + dy * dy < pad.r * pad.r;
}

function placementOk(rect, placed, gap) {
  if (rect.x < 20 || rect.y < 20) return false;
  if (rect.x + rect.w > MAP_W - 20 || rect.y + rect.h > MAP_H - 20) return false;
  for (let i = 0; i < GATES.length; i++) {
    if (gapBetween(rect, GATES[i]) < 8) return false;
  }
  for (let i = 0; i < SPAWN_PADS.length; i++) {
    if (hitsPad(rect, SPAWN_PADS[i])) return false;
  }
  for (let i = 0; i < placed.length; i++) {
    const need = rect.solid === false || placed[i].solid === false ? 8 : gap;
    if (gapBetween(rect, placed[i]) < need) return false;
  }
  return true;
}

function seededDecor(placed) {
  const rand = mulberry32(0x48554E54);
  const added = [];
  DECOR.forEach((spec) => {
    let accepted = null;
    for (let n = 0; n < 12; n++) {
      const jx = Math.round((rand() - 0.5) * 36);
      const jy = Math.round((rand() - 0.5) * 36);
      const rect = prop(
        "decor" + added.length,
        spec[0],
        spec[3] + jx,
        spec[4] + jy,
        spec[1],
        spec[2],
        null,
        spec[0] === "sandbag" ? false : undefined
      );
      if (placementOk(rect, placed.concat(added), 64)) {
        accepted = rect;
        break;
      }
    }
    if (accepted) added.push(accepted);
  });
  return added;
}

const PLACED = ORIGINAL.concat(LANDMARKS);
const ADDED = seededDecor(PLACED);

const ALL = ORIGINAL.concat(LANDMARKS, ADDED);
ALL.MAP_W = MAP_W;
ALL.MAP_H = MAP_H;
module.exports = ALL;
