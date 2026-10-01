/*
 * Checks a local electron-builder Windows output before it can be treated
 * as a production update. The installed app reads latest.yml from GitHub
 * Releases; these files must exist and must not contain secrets.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SECRET_PATTERN = /DATABASE_URL|ghp_|PRIVATE KEY|token:/i;

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function verifyDist(distDir, version) {
  const errors = [];
  const root = path.resolve(distDir);
  const exeName = "Hidden-Hunter-Setup-" + version + ".exe";
  const exe = path.join(root, exeName);
  const blockmap = path.join(root, exeName + ".blockmap");
  const latest = path.join(root, "latest.yml");
  const appUpdate = path.join(root, "win-unpacked", "resources", "app-update.yml");
  const frontend = path.join(root, "win-unpacked", "resources", "frontend");
  const serverDir = path.join(frontend, "server");

  function requireFile(file) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size < 1) {
      errors.push("missing " + path.relative(root, file));
      return null;
    }
    return file;
  }

  requireFile(exe);
  requireFile(blockmap);
  if (requireFile(latest)) {
    const text = readText(latest);
    if (!new RegExp("^version: " + version.replace(/\./g, "\\.") + "\\s*$", "m").test(text)) {
      errors.push("latest.yml version is not " + version);
    }
    if (!text.includes(exeName)) errors.push("latest.yml does not name " + exeName);
    if (SECRET_PATTERN.test(text)) errors.push("latest.yml contains a secret");
  }
  if (requireFile(appUpdate)) {
    const text = readText(appUpdate);
    if (!/^provider: github\s*$/m.test(text)) errors.push("app-update.yml provider is not github");
    if (!/^owner: imhiamou\s*$/m.test(text)) errors.push("app-update.yml owner is not imhiamou");
    if (!/^repo: Card\s*$/m.test(text)) errors.push("app-update.yml repo is not Card");
    if (SECRET_PATTERN.test(text)) errors.push("app-update.yml contains a secret");
  }
  if (fs.existsSync(serverDir)) errors.push("server/ was packaged into the desktop app");
  const indexPath = path.join(frontend, "index.js");
  if (fs.existsSync(indexPath)) {
    const index = readText(indexPath);
    if (!index.includes('const SERVER="https://cardb-2uys.onrender.com"')) {
      errors.push("packaged index.js does not point at the Render server");
    }
    if (SECRET_PATTERN.test(index)) errors.push("packaged index.js contains a secret");
  }
  return errors;
}

function main() {
  const version = require("./package.json").version;
  const distDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "dist");
  const errors = verifyDist(distDir, version);
  if (errors.length) {
    errors.forEach((error) => console.error(error));
    process.exit(1);
  }
  console.log("Windows dist for " + version + " has the installer, blockmap, and GitHub updater metadata.");
}

if (require.main === module) main();

module.exports = {
  verifyDist
};
