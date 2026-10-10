"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { copyFrontend } = require("./scripts/copy-www");

const repoRoot = path.resolve(__dirname, "..");

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

describe("mobile frontend copy", () => {
  it("packages the website without the server, desktop shell, or secrets", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gameweb-www-"));
    copyFrontend(repoRoot, dest);
    const index = fs.readFileSync(path.join(dest, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(dest, "index.js"), "utf8");
    const editor = fs.readFileSync(path.join(dest, "assets/carts/carts-editor.js"), "utf8");
    assert.match(index, /assets\/socket\.io\/socket\.io\.min\.js/);
    assert.equal(index.includes("http://"), false);
    assert.equal(index.includes("cdn."), false);
    assert.match(app, /const SERVER="https:\/\/cardb-2uys\.onrender\.com"/);
    assert.match(app, /const socket=io\(SERVER\)/);
    assert.match(editor, /const CARTS_API_BASE="https:\/\/cardb-2uys\.onrender\.com"/);
    assert.match(editor, /fetch\(cartsApi\("\/api\/carts-assets"\)\)/);
    assert.equal(editor.includes('fetch("/api/carts-maps'), false);
    assert.equal(editor.includes('fetch("/api/carts-assets"'), false);
    assert.equal(fs.existsSync(path.join(dest, "assets/socket.io/socket.io.min.js")), true);
    ["server", "desktop", ".git", "node_modules", "android"].forEach((name) => {
      assert.equal(fs.existsSync(path.join(dest, name)), false, name);
    });
    const blob = walk(dest, [])
      .filter((file) => /\.(html|js|css|json|md|txt)$/i.test(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.equal(blob.includes("ghp_"), false);
    assert.equal(blob.includes("BEGIN PRIVATE KEY"), false);
    assert.equal(blob.includes("DATABASE_URL="), false);
  });
});

describe("capacitor config", () => {
  it("names the app Gameweb and does not point at a development server", () => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "capacitor.config.json"), "utf8"));
    assert.equal(config.appId, "com.imhiamou.gameweb");
    assert.equal(config.appName, "Gameweb");
    assert.equal(config.webDir, "www");
    assert.equal(config.android.allowMixedContent, false);
    assert.equal(Object.prototype.hasOwnProperty.call(config.server, "url"), false);
    assert.equal(config.server.androidScheme, "https");
  });

  it("keeps the Android workflow separate from the Windows installer", () => {
    const android = fs.readFileSync(path.join(repoRoot, ".github/workflows/android.yml"), "utf8");
    const windows = fs.readFileSync(path.join(repoRoot, ".github/workflows/windows-release.yml"), "utf8");
    const pages = fs.readFileSync(path.join(repoRoot, ".github/workflows/pages.yml"), "utf8");
    assert.match(android, /assembleDebug/);
    assert.equal(android.includes("dist:publish"), false);
    assert.equal(android.includes("keystorePassword"), false);
    assert.equal(android.includes("ghp_"), false);
    assert.match(windows, /npm run dist:publish/);
    assert.match(pages, /github-pages/);
    const root = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    assert.equal(root.main, "server/server.js");
    assert.equal(root.scripts.start, "node server/server.js");
  });
});
