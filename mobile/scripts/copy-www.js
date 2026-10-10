/*
 * Copy the existing website into Capacitor's web directory.
 * The site entry point stays at the repository root for GitHub Pages
 * and Electron. This script does not move those files.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_FILES = [
  "index.html",
  "index.js",
  "style.css",
  "hidden-hunter.js",
  "hidden-hunter.css",
  "hidden-hunter-editor.js",
  "hidden-hunter-editor.css",
  "domino.js",
  "domino.css",
  "domino.html",
  "uno.js",
  "uno.css",
  "uno.html",
  "game-sfx.js"
];

const FORBIDDEN = [
  "server",
  "desktop",
  ".git",
  ".github",
  "node_modules",
  "android",
  "ios",
  "mobile"
];

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFile(from, to);
  }
}

function copyFrontend(repoRoot, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  ROOT_FILES.forEach((name) => {
    const src = path.join(repoRoot, name);
    if (!fs.existsSync(src)) throw new Error("Missing frontend file " + name);
    copyFile(src, path.join(dest, name));
  });
  const assets = path.join(repoRoot, "assets");
  if (!fs.existsSync(assets)) throw new Error("Missing assets directory");
  copyDir(assets, path.join(dest, "assets"));
  FORBIDDEN.forEach((name) => {
    if (fs.existsSync(path.join(dest, name))) {
      throw new Error("Refusing to package " + name);
    }
  });
  return dest;
}

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const dest = process.env.MOBILE_WWW
    ? path.resolve(process.env.MOBILE_WWW)
    : path.join(__dirname, "..", "www");
  copyFrontend(repoRoot, dest);
  console.log("Copied frontend to " + dest);
}

module.exports = {
  copyFrontend,
  ROOT_FILES,
  FORBIDDEN
};
