/*
 * Carts map documents. Postgres is the shared database when DATABASE_URL
 * is set. The JSON files are a cache. This store never reads hh_maps.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const CM = require("../assets/carts/carts-map");
const persist = require("./cartsMapPersist");

const MAX_BYTES = 1500000;
const ID_PATTERN = /^c[a-f0-9]{12}$/;

function storeDir() {
  if (process.env.CARTS_MAP_DIR && String(process.env.CARTS_MAP_DIR).trim()) {
    return path.resolve(String(process.env.CARTS_MAP_DIR).trim());
  }
  return path.join(__dirname, "data", "carts-maps");
}

function ensureDir() {
  fs.mkdirSync(storeDir(), { recursive: true });
}

function fileFor(id) {
  return path.join(storeDir(), id + ".json");
}

function createId() {
  return "c" + crypto.randomBytes(6).toString("hex");
}

function writeCache(map) {
  ensureDir();
  const file = fileFor(map.id);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(map));
  fs.renameSync(tmp, file);
}

function readCache() {
  ensureDir();
  const maps = [];
  fs.readdirSync(storeDir()).forEach((name) => {
    if (!name.endsWith(".json")) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(storeDir(), name), "utf8"));
      if (parsed && parsed.type === "carts") maps.push(CM.normalize(parsed));
    } catch (err) { /* skip a broken cache file */ }
  });
  return maps;
}

function summary(map) {
  return { id: map.id, name: map.name, updated: map.updated || 0 };
}

function tooBig(map) {
  return Buffer.byteLength(JSON.stringify(map)) > MAX_BYTES;
}

async function openDatabase() {
  if (!persist.databaseUrl()) return false;
  if (typeof persist.ensure === "function") {
    try {
      await persist.ensure();
    } catch (err) {
      return false;
    }
  }
  return !!persist.enabled();
}

function databaseFailure(action) {
  const reason = typeof persist.failureReason === "function"
    ? persist.failureReason()
    : "database connection is not open";
  console.error("[carts-maps] " + action + " failed");
  console.error(persist.safeMessage(new Error(reason)));
  return "Failed to " + action + " Carts map. The server could not use persistent storage. " + reason;
}

async function ready() {
  ensureDir();
  if (!persist.databaseUrl()) return { ok: true, persisted: "cache", count: readCache().length };
  await persist.connect();
  const rows = await persist.loadAll();
  rows.forEach((row) => {
    if (row.document && row.document.type === "carts" && (!row.document.game || row.document.game === "carts")) writeCache(CM.normalize(row.document));
  });
  return { ok: true, persisted: "postgres", count: rows.length };
}

async function listMaps() {
  await openDatabase();
  if (persist.enabled()) {
    const rows = await persist.loadAll();
    return {
      ok: true,
      persisted: "postgres",
      maps: rows
        .map((row) => row.document)
        .filter((doc) => doc && doc.type === "carts" && (!doc.game || doc.game === "carts"))
        .map((doc) => summary(CM.normalize(doc)))
    };
  }
  return { ok: true, persisted: "cache", maps: readCache().map(summary) };
}

async function loadMap(id) {
  if (!ID_PATTERN.test(id)) return { ok: false, error: "Unknown Carts map" };
  await openDatabase();
  if (persist.enabled()) {
    const rows = await persist.loadAll();
    const found = rows.filter((row) => row.id === id)[0];
    if (!found || !found.document || found.document.type !== "carts" || (found.document.game && found.document.game !== "carts")) {
      return { ok: false, error: "Unknown Carts map" };
    }
    return { ok: true, map: CM.normalize(found.document) };
  }
  const file = fileFor(id);
  if (!fs.existsSync(file)) return { ok: false, error: "Unknown Carts map" };
  return { ok: true, map: CM.normalize(JSON.parse(fs.readFileSync(file, "utf8"))) };
}

async function saveMap(body) {
  if (body && body.type && body.type !== "carts") return { ok: false, error: "Not a Carts map" };
  if (body && body.game && body.game !== "carts") return { ok: false, error: "Not a Carts map" };
  if (body && body.spawns && body.spawns.hunter && !body.skeleton) return { ok: false, error: "Not a Carts map" };
  const map = CM.normalize(body || {});
  if (map.game !== "carts" || map.type !== "carts") return { ok: false, error: "Not a Carts map" };
  if (map.type !== "carts") return { ok: false, error: "Not a Carts map" };
  if (!ID_PATTERN.test(map.id)) map.id = createId();
  map.updated = Date.now();
  if (tooBig(map)) return { ok: false, error: "Carts map is too large" };
  console.log("[carts-maps] save requested");
  console.log("[carts-maps] map id: " + map.id);
  console.log("[carts-maps] map name: " + map.name);
  const open = await openDatabase();
  writeCache(map);
  if (open && persist.enabled()) {
    console.log("[carts-maps] persistence: postgres");
    try {
      await persist.save(map);
    } catch (err) {
      console.error("[carts-maps] database write failed for map id: " + map.id);
      console.error(persist.safeMessage(err));
      throw err;
    }
    console.log("[carts-maps] database write confirmed for map id: " + map.id);
    return { ok: true, map: map, persisted: "postgres" };
  }
  if (persist.databaseUrl()) {
    return { ok: false, error: databaseFailure("save") };
  }
  console.log("[carts-maps] persistence: cache");
  return {
    ok: true,
    map: map,
    persisted: "cache",
    warning: "DATABASE_URL is not set. The map is in the server cache only."
  };
}

async function deleteMap(id) {
  if (!ID_PATTERN.test(id)) return { ok: false, error: "Unknown Carts map" };
  const open = await openDatabase();
  if (persist.databaseUrl() && !open) {
    return { ok: false, error: databaseFailure("delete") };
  }
  const file = fileFor(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  if (persist.enabled()) await persist.remove(id);
  return { ok: true };
}

async function renameMap(id, name) {
  const loaded = await loadMap(id);
  if (!loaded.ok) return loaded;
  loaded.map.name = String(name || "").trim().slice(0, 48) || loaded.map.name;
  return saveMap(loaded.map);
}

function describeError(err) {
  return persist.safeMessage(err);
}

module.exports = {
  ready,
  listMaps,
  loadMap,
  saveMap,
  deleteMap,
  renameMap,
  describeError,
  createId
};
