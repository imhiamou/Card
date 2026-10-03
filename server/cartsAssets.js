/*
 * Lists image files under assets/carts without touching other games.
 * Category is the folder under assets/carts. Scripts and styles are ignored.
 */

const fs = require("fs");
const path = require("path");

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

function scan(root) {
  const catalog = path.join(root, "assets", "carts", "catalog.json");
  if (fs.existsSync(catalog)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(catalog, "utf8"));
      if (parsed && Array.isArray(parsed.assets) && parsed.assets.length) return parsed;
    } catch (err) { /* fall through to a folder scan */ }
  }
  const base = path.join(root, "assets", "carts");
  const assets = [];
  function walk(abs, rel) {
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.charAt(0) === ".") return;
      const child = path.join(abs, entry.name);
      const relChild = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        walk(child, relChild);
        return;
      }
      if (!IMAGE.test(entry.name)) return;
      const webPath = relChild.split(path.sep).join("/");
      const folder = rel ? path.posix.dirname(webPath) : "";
      const category = !folder || folder === "." ? "uncategorized" : folder;
      assets.push({
        id: webPath,
        name: entry.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
        category: category,
        src: "assets/carts/" + webPath
      });
    });
  }
  walk(base, "");
  assets.sort((a, b) => (a.category + "/" + a.name).localeCompare(b.category + "/" + b.name));
  return { version: 1, assets: assets };
}

module.exports = { scan };
