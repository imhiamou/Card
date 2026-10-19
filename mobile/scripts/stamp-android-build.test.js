"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stampHtml } = require("./stamp-android-build");

const root = path.resolve(__dirname, "../..");
const sha = "abcdef0123456789abcdef0123456789abcdef01";

describe("Android build identity", () => {
  it("stamps the APK version and exact source commit into the bundled HTML", () => {
    const source = '<!doctype html><html><head><meta name="gameweb-version" content="1.0.0"></head><body>Lobby</body></html>';
    const output = stampHtml(source, "1.0.25", sha);
    assert.match(output, /name="gameweb-version" content="1\.0\.25"/);
    assert.match(output, new RegExp('name="gameweb-build-commit" content="' + sha + '"'));
    assert.match(output, /<body>Lobby<\/body>/);
  });

  it("rejects an invalid version or a shortened commit", () => {
    const source = '<meta name="gameweb-version" content="1.0.0">';
    assert.throws(() => stampHtml(source, "latest", sha), /VERSION_NAME/);
    assert.throws(() => stampHtml(source, "1.0.25", "abcdef0"), /GITHUB_SHA/);
  });

  it("allows Android inspector swipes through the global touch guard", () => {
    const source = fs.readFileSync(path.join(root, "assets/mobile-app.js"), "utf8");
    assert.match(source, /SCROLLERS\s*=\s*"[^"]*#domInspectBody/);
    assert.match(source, /if\s*\(scrollableTouch\)\s*return;/);
  });

  it("renders the APK version and source commit in the Android lobby", () => {
    const source = fs.readFileSync(path.join(root, "assets/mobile-app.js"), "utf8");
    assert.match(source, /className\s*=\s*"appBuildStamp"/);
    assert.match(source, /"APK v"\s*\+\s*version\s*\+\s*" · commit "/);
  });
});
