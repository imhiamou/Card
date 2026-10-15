"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const lobby = require("../assets/lobby-update");

test("equal versions are up to date and a different published version is an update", () => {
  const same = lobby.interpretCheck("1.0.0", JSON.stringify({ version: "1.0.0", channel: "web" }));
  assert.equal(same.outcome, "current");
  assert.match(same.message, /The current version is the latest available/);
  assert.match(same.message, /1\.0\.0/);

  const newer = lobby.compareVersions("1.0.0", "9f1c0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a");
  assert.equal(newer.outcome, "available");
  const message = lobby.interpretCheck("1.0.0", { version: newer.latest });
  assert.match(message.message, /A newer version exists, and the user should refresh or update the application/);
  assert.match(message.message, /Current version: 1\.0\.0/);
  assert.match(message.message, /Available version: 9f1c/);
});

test("failed, malformed, and missing version responses are not described as up to date", async () => {
  const failed = lobby.interpretCheck("1.0.0", null, new Error("offline"));
  assert.equal(failed.outcome, "unable");
  assert.match(failed.message, /The server or version endpoint could not be reached/);
  assert.doesNotMatch(failed.message, /latest available/);

  const malformed = lobby.interpretCheck("1.0.0", "{");
  assert.equal(malformed.outcome, "unable");
  assert.doesNotMatch(malformed.message, /latest available/);

  const missing = lobby.interpretCheck("1.0.0", { channel: "web" });
  assert.equal(missing.outcome, "unable");

  const blank = lobby.compareVersions("", "1.0.0");
  assert.equal(blank.outcome, "unable");

  const checker = lobby.createChecker({
    timeoutMs: 30,
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })
  });
  const timed = await checker.request("1.0.0");
  assert.equal(timed.outcome, "unable");
  assert.doesNotMatch(timed.message, /latest available/);

  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shared = lobby.createChecker({
    fetch: async () => {
      calls += 1;
      await gate;
      return { ok: true, text: async () => JSON.stringify({ version: "1.0.0" }) };
    }
  });
  const first = shared.request("1.0.0");
  const second = shared.request("1.0.0");
  release();
  const both = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(both[0].outcome, "current");
  assert.equal(both[1].outcome, "current");
});

test("a refresh is deferred while a match screen is visible", () => {
  const hidden = { classList: { contains: () => true } };
  const open = { classList: { contains: () => false } };
  const doc = {
    getElementById(id) {
      return id === "dominoScreen" ? open : hidden;
    }
  };
  assert.equal(lobby.matchIsActive(doc), true);
  const deferred = lobby.applyUpdate(doc);
  assert.equal(deferred.applied, false);
  assert.match(deferred.message, /return to the lobby/);

  const idle = {
    getElementById() { return hidden; }
  };
  assert.equal(lobby.matchIsActive(idle), false);
});

test("the lobby button, running meta, and deploy stamp are wired", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const pages = fs.readFileSync(path.join(__dirname, "../.github/workflows/pages.yml"), "utf8");
  const published = JSON.parse(fs.readFileSync(path.join(__dirname, "../version.json"), "utf8"));
  assert.match(html, /id="gamewebCheckUpdate"/);
  assert.match(html, /Check for updates/);
  assert.match(html, /name="gameweb-version" content="1\.0\.0"/);
  assert.equal(published.version, "1.0.0");
  assert.match(pages, /stamp-web-version\.js/);
  assert.equal(lobby.readCurrent({
    querySelector() {
      return { getAttribute: () => "1.0.0" };
    }
  }), "1.0.0");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-version-"));
  fs.writeFileSync(path.join(dir, "index.html"), '<meta name="gameweb-version" content="1.0.0">\n');
  const sha = "a".repeat(40);
  const run = spawnSync(process.execPath, [path.join(__dirname, "../scripts/stamp-web-version.js"), dir], {
    env: Object.assign({}, process.env, { GITHUB_SHA: sha })
  });
  assert.equal(run.status, 0, run.stderr && run.stderr.toString());
  const stamped = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8"));
  assert.match(stamped, new RegExp(sha));
  assert.equal(manifest.version, sha);
  assert.equal(lobby.interpretCheck("1.0.0", manifest).outcome, "available");
  assert.equal(lobby.interpretCheck(sha, manifest).outcome, "current");
});
