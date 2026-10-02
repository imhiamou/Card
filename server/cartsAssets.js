/*
 * Lists image files under assets/carts without touching other games.
 * Category is the first folder name. Scripts and styles are ignored.
 */

const fs = require("fs");
const path = require("path");

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

function scan(root) {
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
      const category = rel ? rel.split("/")[0] : "uncategorized";
      assets.push({
        id: relChild,
        name: entry.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
        category: category,
        src: "assets/carts/" + relChild.split(path.sep).join("/")
      });
    });
  }
  walk(base, "");
  assets.sort((a, b) => (a.category + "/" + a.name).localeCompare(b.category + "/" + b.name));
  return { version: 1, assets: assets };
}

module.exports = { scan };
