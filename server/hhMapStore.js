/*
 * Hidden Hunter saved maps.
 *
 * Storage is isolated behind the functions in this file so it can move to a
 * database later. The current backend has no database. Maps are JSON files.
 *
 * Render's container disk is ephemeral: files written here disappear when the
 * service redeploys or restarts, unless MAP_STORE_DIR points at a mounted
 * persistent disk. The built-in Default Warehouse does not use that disk.
 * A failed save leaves the previous file in place. The previous version is
 * copied aside before the current file is replaced.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const LAYOUT = require("./hiddenHunterLayout");

const EDITOR_NAME = "himou";
const MIN_SIZE = 800;
const MAX_SIZE = 4000;
const MAX_OBJECTS = 500;
const MAX_TEXTS = 80;
const MAX_CUSTOM_MAPS = 40;
const MAX_VERSIONS = 8;
const CELL = 256;
const PLAYER_R = 22;
const MONSTER_R = 26;
const BOUNDS_MARGIN = 18;

const ASSETS = [
  { kind: "door", name: "Door", category: "Structures", w: 140, h: 36, solid: true, layer: 6 },
  { kind: "window", name: "Window", category: "Structures", w: 26, h: 150, solid: true, layer: 6 },
  { kind: "pillar", name: "Pillar", category: "Structures", w: 48, h: 48, solid: true, layer: 6 },
  { kind: "pillarWood", name: "Wood pillar", category: "Structures", w: 48, h: 48, solid: true, layer: 6 },
  { kind: "shelves", name: "Shelves", category: "Storage", w: 210, h: 58, solid: true, layer: 6 },
  { kind: "crates", name: "Crates", category: "Storage", w: 150, h: 110, solid: true, layer: 4 },
  { kind: "boxes", name: "Boxes", category: "Storage", w: 110, h: 86, solid: true, layer: 3 },
  { kind: "pallet", name: "Pallet", category: "Storage", w: 150, h: 90, solid: true, layer: 2 },
  { kind: "container", name: "Container", category: "Storage", w: 190, h: 86, solid: true, layer: 6 },
  { kind: "machine", name: "Machine", category: "Industrial", w: 220, h: 170, solid: true, layer: 6 },
  { kind: "generator", name: "Generator", category: "Industrial", w: 160, h: 140, solid: true, layer: 6 },
  { kind: "conveyor", name: "Pipes", category: "Industrial", w: 280, h: 48, solid: true, layer: 4 },
  { kind: "table", name: "Table", category: "Furniture", w: 160, h: 64, solid: true, layer: 4 },
  { kind: "forklift", name: "Forklift", category: "Vehicles", w: 200, h: 100, solid: true, layer: 6 },
  { kind: "vehicle", name: "Vehicle", category: "Vehicles", w: 210, h: 100, solid: true, layer: 6 },
  { kind: "vehicleDark", name: "Vehicle B", category: "Vehicles", w: 210, h: 100, solid: true, layer: 6 },
  { kind: "vehicleGreen", name: "Vehicle C", category: "Vehicles", w: 180, h: 90, solid: true, layer: 6 },
  { kind: "barrels", name: "Barrels", category: "Decoration", w: 110, h: 78, solid: true, layer: 3 },
  { kind: "barrelsGreen", name: "Tan barrels", category: "Decoration", w: 110, h: 78, solid: true, layer: 3 },
  { kind: "barrelsBlack", name: "Metal barrels", category: "Decoration", w: 110, h: 78, solid: true, layer: 3 },
  { kind: "sandbag", name: "Debris", category: "Decoration", w: 70, h: 48, solid: false, layer: 1 }
];

const ASSET_BY_KIND = new Map(ASSETS.map((asset) => [asset.kind, asset]));

function isEditorAccess(name) {
  if (typeof name !== "string") return false;
  return name.trim().toLowerCase() === EDITOR_NAME;
}

function storeDir() {
  const custom = process.env.MAP_STORE_DIR;
  if (typeof custom === "string" && custom.trim()) return path.resolve(custom.trim());
  return path.join(__dirname, "data", "hh-maps");
}

function safeId(id) {
  return id === "default" || /^m[a-f0-9]{12}$/.test(id);
}

function assetByKind(kind) {
  return ASSET_BY_KIND.get(kind) || null;
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function scaleOf(o) {
  const s = Number(o && o.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function rotationOf(o) {
  const r = Number(o && o.rotation);
  return Number.isFinite(r) ? r : 0;
}

function centerOf(o) {
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
}

function collisionHalf(o) {
  const s = scaleOf(o);
  const w = finite(o.cw) && o.cw > 0 ? o.cw : o.w;
  const h = finite(o.ch) && o.ch > 0 ? o.ch : o.h;
  return { hw: (w * s) / 2, hh: (h * s) / 2 };
}

function obbAabb(cx, cy, hw, hh, deg) {
  const rad = deg * Math.PI / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const aw = hw * c + hh * s;
  const ah = hw * s + hh * c;
  return { x: cx - aw, y: cy - ah, w: aw * 2, h: ah * 2 };
}

function visualAabb(o) {
  const s = scaleOf(o);
  const c = centerOf(o);
  return obbAabb(c.x, c.y, (o.w * s) / 2, (o.h * s) / 2, rotationOf(o));
}

function circleHitsObb(cx, cy, r, o) {
  const half = collisionHalf(o);
  const center = centerOf(o);
  const rad = -rotationOf(o) * Math.PI / 180;
  const dx = cx - center.x;
  const dy = cy - center.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const nx = Math.max(-half.hw, Math.min(half.hw, lx));
  const ny = Math.max(-half.hh, Math.min(half.hh, ly));
  const ex = lx - nx;
  const ey = ly - ny;
  return ex * ex + ey * ey < r * r;
}

function buildNav(map) {
  const grid = new Map();
  const objects = (map.objects || []).filter((o) => o.solid !== false);
  objects.forEach((o) => {
    const half = collisionHalf(o);
    const center = centerOf(o);
    const box = obbAabb(center.x, center.y, half.hw, half.hh, rotationOf(o));
    const x0 = Math.floor(box.x / CELL);
    const y0 = Math.floor(box.y / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = gx + "," + gy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(o);
      }
    }
  });
  return { w: map.width, h: map.height, grid };
}

function pointBlocked(nav, cx, cy, r) {
  if (!nav || !finite(cx) || !finite(cy)) return true;
  if (cx < r + BOUNDS_MARGIN || cy < r + BOUNDS_MARGIN) return true;
  if (cx > nav.w - r - BOUNDS_MARGIN || cy > nav.h - r - BOUNDS_MARGIN) return true;
  const x0 = Math.floor((cx - r) / CELL);
  const y0 = Math.floor((cy - r) / CELL);
  const x1 = Math.floor((cx + r) / CELL);
  const y1 = Math.floor((cy + r) / CELL);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const list = nav.grid.get(gx + "," + gy);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        if (circleHitsObb(cx, cy, r, list[i])) return true;
      }
    }
  }
  return false;
}

function builtinMap() {
  const objects = LAYOUT.map((o) => {
    const spec = assetByKind(o.kind) || { layer: 6, solid: true };
    return {
      id: String(o.id),
      kind: o.kind,
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      rotation: 0,
      scale: 1,
      layer: spec.layer,
      solid: o.solid !== false && spec.solid !== false,
      label: o.label || ""
    };
  });
  return {
    id: "default",
    name: "Default Warehouse",
    version: 1,
    width: LAYOUT.MAP_W,
    height: LAYOUT.MAP_H,
    ground: "procedural",
    spawns: {
      hunter: { x: 240, y: 520 },
      tracker: { x: 240, y: 280 },
      monster: { x: 980, y: 480 }
    },
    objects,
    texts: [],
    builtin: true,
    createdAt: null,
    updatedAt: null
  };
}

function cleanObject(raw, errors) {
  if (!raw || typeof raw !== "object") {
    errors.push("An object on the map is invalid.");
    return null;
  }
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const spec = assetByKind(kind);
  if (!spec) {
    errors.push("Unknown asset.");
    return null;
  }
  const w = Number(raw.w);
  const h = Number(raw.h);
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w < 8 || h < 8 || w > 2400 || h > 2400) {
    errors.push("An object has invalid coordinates or size.");
    return null;
  }
  const scale = Number(raw.scale);
  const rotation = Number(raw.rotation);
  const layer = Math.round(Number(raw.layer));
  if (!finite(scale) || scale < 0.2 || scale > 6) {
    errors.push("An object has an invalid scale.");
    return null;
  }
  if (!finite(rotation) || Math.abs(rotation) > 3600) {
    errors.push("An object has an invalid rotation.");
    return null;
  }
  if (!Number.isFinite(layer) || layer < 0 || layer > 30) {
    errors.push("An object has an invalid layer.");
    return null;
  }
  const item = {
    id: cleanText(String(raw.id || ""), 40) || ("o" + crypto.randomBytes(4).toString("hex")),
    kind,
    x,
    y,
    w,
    h,
    rotation,
    scale,
    layer,
    solid: raw.solid !== false && spec.solid !== false ? true : raw.solid === true,
    label: cleanText(raw.label || "", 32)
  };
  if (spec.solid === false && raw.solid !== true) item.solid = false;
  if (raw.solid === false) item.solid = false;
  if (finite(Number(raw.cw)) && Number(raw.cw) > 0 && Number(raw.cw) <= 2400) item.cw = Number(raw.cw);
  if (finite(Number(raw.ch)) && Number(raw.ch) > 0 && Number(raw.ch) <= 2400) item.ch = Number(raw.ch);
  return item;
}

function cleanTextObject(raw, errors) {
  if (!raw || typeof raw !== "object") {
    errors.push("A text label is invalid.");
    return null;
  }
  const text = cleanText(raw.text || "", 40);
  if (!text) {
    errors.push("A text label is empty.");
    return null;
  }
  const x = Number(raw.x);
  const y = Number(raw.y);
  const size = Number(raw.size);
  const rotation = Number(raw.rotation);
  const opacity = Number(raw.opacity);
  const layer = Math.round(Number(raw.layer));
  if (!finite(x) || !finite(y)) {
    errors.push("A text label has invalid coordinates.");
    return null;
  }
  if (!finite(size) || size < 10 || size > 72) {
    errors.push("A text label has an invalid size.");
    return null;
  }
  if (!finite(rotation) || Math.abs(rotation) > 3600) {
    errors.push("A text label has an invalid rotation.");
    return null;
  }
  if (!finite(opacity) || opacity < 0 || opacity > 1) {
    errors.push("A text label has an invalid opacity.");
    return null;
  }
  if (!Number.isFinite(layer) || layer < 0 || layer > 30) {
    errors.push("A text label has an invalid layer.");
    return null;
  }
  return {
    id: cleanText(String(raw.id || ""), 40) || ("t" + crypto.randomBytes(4).toString("hex")),
    text,
    x,
    y,
    size,
    rotation,
    opacity,
    layer
  };
}

function cleanSpawn(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!finite(x) || !finite(y)) return null;
  return { x, y };
}

function validateMap(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Cannot save map: the map data is invalid." };
  }
  const width = Math.round(Number(raw.width));
  const height = Math.round(Number(raw.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < MIN_SIZE || height < MIN_SIZE || width > MAX_SIZE || height > MAX_SIZE) {
    errors.push("Map width and height must be between " + MIN_SIZE + " and " + MAX_SIZE + ".");
  }
  const name = cleanText(raw.name, 40);
  if (!name) errors.push("The map needs a name.");
  const objectsIn = Array.isArray(raw.objects) ? raw.objects : null;
  const textsIn = Array.isArray(raw.texts) ? raw.texts : [];
  if (!objectsIn) errors.push("Map objects are missing.");
  if (objectsIn && objectsIn.length > MAX_OBJECTS) errors.push("Too many objects.");
  if (textsIn.length > MAX_TEXTS) errors.push("Too many text labels.");
  const spawnsIn = raw.spawns || {};
  const hunter = cleanSpawn(spawnsIn.hunter);
  const tracker = cleanSpawn(spawnsIn.tracker);
  const monster = cleanSpawn(spawnsIn.monster);
  if (!hunter) errors.push("Hunter spawn is missing.");
  if (!tracker) errors.push("Tracker spawn is missing.");
  if (!monster) errors.push("Monster spawn is missing.");
  if (errors.length) return { ok: false, error: "Cannot save map: " + errors[0], errors };

  const objects = [];
  for (let i = 0; i < objectsIn.length; i++) {
    const item = cleanObject(objectsIn[i], errors);
    if (item) objects.push(item);
  }
  const texts = [];
  for (let i = 0; i < textsIn.length; i++) {
    const item = cleanTextObject(textsIn[i], errors);
    if (item) texts.push(item);
  }
  if (errors.length) return { ok: false, error: "Cannot save map: " + errors[0], errors };

  const map = {
    id: safeId(raw.id) ? raw.id : null,
    name,
    version: 1,
    width,
    height,
    ground: "procedural",
    spawns: { hunter, tracker, monster },
    objects,
    texts,
    builtin: false,
    createdAt: null,
    updatedAt: null
  };
  objects.forEach((o) => {
    const c = centerOf(o);
    if (c.x < 0 || c.y < 0 || c.x > width || c.y > height) {
      errors.push("An object is outside the map.");
    }
  });
  texts.forEach((t) => {
    if (t.x < 0 || t.y < 0 || t.x > width || t.y > height) {
      errors.push("A text label is outside the map.");
    }
  });
  const nav = buildNav(map);
  const spawnErrors = [
    ["Hunter", hunter, PLAYER_R],
    ["Tracker", tracker, PLAYER_R],
    ["Monster", monster, MONSTER_R]
  ];
  spawnErrors.forEach((entry) => {
    const label = entry[0];
    const spawn = entry[1];
    const radius = entry[2];
    const inside = spawn.x >= radius + BOUNDS_MARGIN && spawn.y >= radius + BOUNDS_MARGIN
      && spawn.x <= width - radius - BOUNDS_MARGIN && spawn.y <= height - radius - BOUNDS_MARGIN;
    if (!inside) errors.push(label + " spawn is outside the map.");
    else if (pointBlocked(nav, spawn.x, spawn.y, radius)) errors.push(label + " spawn is inside a wall.");
  });
  if (errors.length) return { ok: false, error: "Cannot save map: " + errors[0], errors };
  return { ok: true, map };
}

function mapFile(id) {
  return path.join(storeDir(), id + ".json");
}

function versionFile(id, version) {
  return path.join(storeDir(), "versions", id + "-v" + version + ".json");
}

function ensureDirs() {
  fs.mkdirSync(storeDir(), { recursive: true });
  fs.mkdirSync(path.join(storeDir(), "versions"), { recursive: true });
}

function writeAtomic(file, text) {
  ensureDirs();
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readStored(id) {
  if (!safeId(id)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(mapFile(id), "utf8"));
    const checked = validateMap(parsed);
    if (!checked.ok) return null;
    checked.map.id = id;
    checked.map.version = Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 1;
    checked.map.createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : null;
    checked.map.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    checked.map.builtin = false;
    return checked.map;
  } catch (err) {
    return null;
  }
}

function summary(map) {
  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    version: map.version || 1,
    updatedAt: map.updatedAt || null,
    createdAt: map.createdAt || null,
    builtin: map.id === "default" && !map.updatedAt
  };
}

function listMaps() {
  const maps = [];
  const seen = new Set();
  const def = readStored("default") || builtinMap();
  maps.push(summary(def));
  seen.add("default");
  let names = [];
  try {
    names = fs.readdirSync(storeDir());
  } catch (err) {
    names = [];
  }
  names.forEach((name) => {
    if (!name.endsWith(".json") || name.indexOf(".tmp") !== -1) return;
    const id = name.slice(0, -5);
    if (seen.has(id) || !safeId(id)) return;
    const map = readStored(id);
    if (!map) return;
    maps.push(summary(map));
    seen.add(id);
  });
  return maps;
}

function publicView(map) {
  return {
    id: map.id,
    name: map.name,
    w: map.width,
    h: map.height,
    ground: "procedural",
    obstacles: (map.objects || []).map((o) => {
      const item = {
        id: o.id,
        kind: o.kind,
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        rotation: o.rotation || 0,
        scale: o.scale || 1,
        layer: o.layer,
        solid: o.solid !== false
      };
      if (o.label) item.label = o.label;
      if (finite(o.cw)) item.cw = o.cw;
      if (finite(o.ch)) item.ch = o.ch;
      return item;
    }),
    texts: (map.texts || []).map((t) => ({
      id: t.id,
      text: t.text,
      x: t.x,
      y: t.y,
      size: t.size,
      rotation: t.rotation || 0,
      opacity: t.opacity,
      layer: t.layer
    }))
  };
}

function previewOf(id) {
  if (id !== "default" && !safeId(id)) return null;
  const stored = safeId(id) ? readStored(id) : null;
  const map = stored || (id === "default" || !id ? builtinMap() : null);
  if (!map) return null;
  const view = publicView(map);
  view.version = map.version || 1;
  view.updatedAt = map.updatedAt || null;
  return view;
}

function snapshot(id) {
  const wanted = typeof id === "string" ? id : "default";
  const stored = safeId(wanted) ? readStored(wanted) : null;
  const map = stored || builtinMap();
  return JSON.parse(JSON.stringify(map));
}

function customMapCount() {
  let names = [];
  try {
    names = fs.readdirSync(storeDir());
  } catch (err) {
    return 0;
  }
  return names.filter((name) => /^m[a-f0-9]{12}\.json$/.test(name)).length;
}

function pruneVersions(id) {
  const dir = path.join(storeDir(), "versions");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  const prefix = id + "-v";
  const ranked = names
    .filter((name) => name.indexOf(prefix) === 0 && name.endsWith(".json"))
    .map((name) => {
      const match = /-v(\d+)\.json$/.exec(name);
      return { name, version: match ? Number(match[1]) : 0 };
    })
    .sort((a, b) => a.version - b.version);
  while (ranked.length > MAX_VERSIONS) {
    const old = ranked.shift();
    try {
      fs.unlinkSync(path.join(dir, old.name));
    } catch (err) {
      /* The current map file is already in place. */
    }
  }
}

function saveMap(editorName, raw) {
  if (!isEditorAccess(editorName)) {
    return { ok: false, error: "Editor access denied." };
  }
  let encoded = "";
  try {
    encoded = JSON.stringify(raw);
  } catch (err) {
    return { ok: false, error: "Cannot save map: the map data is invalid." };
  }
  if (encoded.length > 1500000) {
    return { ok: false, error: "Cannot save map: the map is too large." };
  }
  const checked = validateMap(raw);
  if (!checked.ok) return checked;
  const map = checked.map;
  const requestedId = typeof raw.id === "string" ? raw.id : "";
  const isNew = !requestedId || requestedId === "new";
  if (!isNew && !safeId(requestedId)) {
    return { ok: false, error: "Cannot save map: unknown map." };
  }
  const now = new Date().toISOString();
  if (isNew) {
    if (customMapCount() >= MAX_CUSTOM_MAPS) {
      return { ok: false, error: "Cannot save map: the map list is full." };
    }
    map.id = "m" + crypto.randomBytes(6).toString("hex");
    map.version = 1;
    map.createdAt = now;
  } else {
    map.id = requestedId;
    const existing = readStored(map.id);
    const baseVersion = Number(raw.baseVersion);
    if (map.id === "default" && !existing) {
      if (baseVersion !== 1) {
        return { ok: false, error: "This map changed since you opened it. Reload it before saving." };
      }
      map.version = 2;
      map.createdAt = now;
    } else if (!existing) {
      return { ok: false, error: "That map could not be loaded." };
    } else if (baseVersion !== existing.version) {
      return { ok: false, error: "This map changed since you opened it. Reload it before saving." };
    } else {
      map.version = existing.version + 1;
      map.createdAt = existing.createdAt || now;
      try {
        writeAtomic(versionFile(map.id, existing.version), JSON.stringify(existing));
      } catch (err) {
        return { ok: false, error: "Could not archive the previous map version." };
      }
    }
  }
  map.updatedAt = now;
  map.builtin = false;
  try {
    writeAtomic(mapFile(map.id), JSON.stringify(map));
  } catch (err) {
    return { ok: false, error: "Could not save the map." };
  }
  pruneVersions(map.id);
  return { ok: true, map: readStored(map.id) || map };
}

function loadForEditor(editorName, id) {
  if (!isEditorAccess(editorName)) return { ok: false, error: "Editor access denied." };
  const wanted = typeof id === "string" && id ? id : "default";
  if (!safeId(wanted)) return { ok: false, error: "That map could not be loaded." };
  const stored = readStored(wanted);
  if (stored) return { ok: true, map: stored };
  if (wanted === "default") return { ok: true, map: builtinMap() };
  return { ok: false, error: "That map could not be loaded." };
}

module.exports = {
  ASSETS,
  PLAYER_LAYER: 5,
  isEditorAccess,
  assetByKind,
  visualAabb,
  buildNav,
  pointBlocked,
  builtinMap,
  validateMap,
  listMaps,
  publicView,
  previewOf,
  snapshot,
  saveMap,
  loadForEditor,
  summary
};
