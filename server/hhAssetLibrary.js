/*
 * Local map-editor sprite catalog.
 * Asset files live under assets/map-editor and are never loaded from the web.
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "assets", "map-editor", "catalog.json");

let byId = new Map();

function load() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const assets = Array.isArray(data.assets) ? data.assets : [];
  byId = new Map();
  assets.forEach((asset) => {
    if (!asset || typeof asset.id !== "string") return;
    if (!/^[a-z0-9_]{1,80}$/.test(asset.id)) return;
    if (typeof asset.file !== "string" || asset.file.indexOf("assets/map-editor/") !== 0 || asset.file.indexOf("..") !== -1) return;
    byId.set(asset.id, asset);
  });
}

function get(id) {
  return byId.get(id) || null;
}

load();

module.exports = { get, reload: load };
