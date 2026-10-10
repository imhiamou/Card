"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const update = require("../assets/android-update");
const release = require("./scripts/android-release");

const repoRoot = path.resolve(__dirname, "..");

function signedApk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameweb-apk-"));
  fs.mkdirSync(path.join(dir, "META-INF"));
  fs.writeFileSync(path.join(dir, "META-INF", "CERT.RSA"), Buffer.from("signature-bytes"));
  fs.writeFileSync(path.join(dir, "AndroidManifest.xml"), "<manifest package=\"com.imhiamou.gameweb\"/>");
  const packed = spawnSync("zip", ["-q", "-r", "app-release.apk", "META-INF", "AndroidManifest.xml"], { cwd: dir });
  assert.equal(packed.status, 0);
  return path.join(dir, "app-release.apk");
}

describe("android version metadata", () => {
  it("derives a monotonic versionCode from the release tag", () => {
    assert.equal(update.versionFromReleaseTag("v1.0.5"), "1.0.5");
    assert.equal(update.versionCodeFromVersion("1.0.5"), 1000005);
    assert.equal(update.versionCodeFromVersion("1.0.9"), 1000009);
    assert.equal(update.versionCodeFromVersion("1.1.0"), 1001000);
    assert.ok(update.versionCodeFromVersion("1.1.0") > update.versionCodeFromVersion("1.0.9"));
    assert.equal(update.apkFileName("1.0.5"), "Gameweb-1.0.5.apk");
    assert.equal(
      update.releaseDownloadUrl("1.0.5"),
      "https://github.com/imhiamou/Card/releases/download/v1.0.5/Gameweb-1.0.5.apk"
    );
    ["v1.0", "1.0.5", "v1.0.5-beta", "v01.0.5", "v1.0.1000", "v0.0.0", ""].forEach((tag) => {
      assert.equal(update.versionFromReleaseTag(tag), null, tag);
    });
  });

  it("accepts only the published manifest shape", () => {
    const good = {
      version: "1.0.5",
      versionCode: 1000005,
      apk: "Gameweb-1.0.5.apk",
      sha256: "a".repeat(64)
    };
    const parsed = update.parseManifest(JSON.stringify(good));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.manifest.url, update.releaseDownloadUrl("1.0.5"));
    assert.equal(update.isNewer(1, parsed.manifest.versionCode), true);
    assert.equal(update.isNewer(1000005, 1000005), false);
    assert.equal(update.isNewer(1000006, 1000005), false);

    const withUrl = Object.assign({}, good, { url: "https://evil.example/Gameweb.apk" });
    assert.equal(update.parseManifest(JSON.stringify(withUrl)).ok, false);
    const wrongCode = Object.assign({}, good, { versionCode: 2 });
    assert.equal(update.parseManifest(JSON.stringify(wrongCode)).ok, false);
    const wrongName = Object.assign({}, good, { apk: "other.apk" });
    assert.equal(update.parseManifest(JSON.stringify(wrongName)).ok, false);
    const badHash = Object.assign({}, good, { sha256: "abc" });
    assert.equal(update.parseManifest(JSON.stringify(badHash)).ok, false);
    assert.equal(update.parseManifest("{").ok, false);
  });

  it("checks a sha256 checksum and ignores unexpected metadata hosts", () => {
    const bytes = Buffer.from("gameweb-update");
    assert.equal(update.sha256Hex(bytes), update.sha256Hex(Buffer.from("gameweb-update")));
    assert.notEqual(update.sha256Hex(bytes), update.sha256Hex(Buffer.from("gameweb-update-x")));
    assert.equal(update.allowedMetadataUrl("https://github.com/imhiamou/Card/releases/download/v1.0.5/android-latest.json"), true);
    assert.equal(update.allowedMetadataUrl("https://release-assets.githubusercontent.com/asset"), true);
    assert.equal(update.allowedMetadataUrl("http://github.com/app.apk"), false);
    assert.equal(update.allowedMetadataUrl("https://evil.example/app.apk"), false);
    assert.equal(update.releaseDownloadUrl("1.0.5/../../other"), null);
  });

  it("accepts an APK Signature Scheme v2 report and rejects an unsigned APK", () => {
    const v2 = [
      "Verifies",
      "Verified using v1 scheme (JAR signing): false",
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Verified using v3 scheme (APK Signature Scheme v3): false",
      "Signer #1 certificate SHA-256 digest: 874942775d56224cb04f657e5972a671a918b0ec6040e3643a771d02a1a970bc"
    ].join("\n");
    const signed = release.assessApksignerReport(v2);
    assert.equal(signed.ok, true);
    const keystore = release.assessKeytoolList("Certificate fingerprint (SHA-256): 87:49:42:77:5D:56:22:4C:B0:4F:65:7E:59:72:A6:71:A9:18:B0:EC:60:40:E3:64:3A:77:1D:02:A1:A9:70:BC");
    assert.equal(keystore.ok, true);
    assert.equal(signed.sha256, keystore.sha256);
    const unsigned = v2.replace("v2 scheme (APK Signature Scheme v2): true", "v2 scheme (APK Signature Scheme v2): false");
    assert.equal(release.assessApksignerReport(unsigned).ok, false);
    assert.equal(release.assessBadging("package: name='com.imhiamou.gameweb' versionCode='1000005'").ok, true);
    assert.equal(release.assessBadging("package: name='com.example.other'").ok, false);
  });

  it("writes signed release metadata and refuses to publish without secrets", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gameweb-meta-"));
    const manifest = release.writeMetadata(signedApk(), dest, "1.0.5", {
      verify() {}
    });
    assert.equal(manifest.versionCode, 1000005);
    assert.equal(manifest.sha256.length, 64);
    const apk = fs.readFileSync(path.join(dest, "Gameweb-1.0.5.apk"));
    assert.equal(update.sha256Hex(apk), manifest.sha256);
    const shaFile = fs.readFileSync(path.join(dest, "Gameweb-1.0.5.apk.sha256"), "utf8");
    assert.match(shaFile, new RegExp("^" + manifest.sha256 + "  Gameweb-1.0.5.apk\\n$"));
    const roundTrip = update.parseManifest(fs.readFileSync(path.join(dest, "android-latest.json"), "utf8"));
    assert.equal(roundTrip.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(dest, "android-latest.json"), "utf8")), "url"), false);

    const missing = release.checkEnvironment({ RELEASE_TAG: "v1.0.5", ANDROID_KEYSTORE_PASSWORD: "super-secret-value" });
    assert.equal(missing.ok, false);
    const text = missing.errors.join("\n");
    assert.match(text, /ANDROID_KEYSTORE_BASE64/);
    assert.match(text, /ANDROID_KEY_ALIAS/);
    assert.match(text, /ANDROID_KEY_PASSWORD/);
    assert.equal(text.includes("super-secret-value"), false);
    assert.match(release.checkEnvironment({ RELEASE_TAG: "v1.0.5-beta", ANDROID_KEYSTORE_BASE64: "x", ANDROID_KEYSTORE_PASSWORD: "y", ANDROID_KEY_ALIAS: "z", ANDROID_KEY_PASSWORD: "w" }).errors.join("\n"), /not a valid Android version/);
    assert.deepEqual(release.exportEnvLines({ RELEASE_TAG: "v1.0.5" }), ["VERSION_NAME=1.0.5", "VERSION_CODE=1000005"]);
    assert.equal(release.main(["node", "android-release.js", "check"], { RELEASE_TAG: "nope" }), 1);
  });

  it("keeps the Android release workflow on version tags and leaves Windows publishing intact", () => {
    const android = fs.readFileSync(path.join(repoRoot, ".github/workflows/android.yml"), "utf8");
    const windows = fs.readFileSync(path.join(repoRoot, ".github/workflows/windows-release.yml"), "utf8");
    assert.match(android, /assembleDebug/);
    assert.match(android, /assembleRelease/);
    assert.match(android, /tags:/);
    assert.match(android, /android-release\.js check/);
    const verifyAt = android.indexOf("android-release.js verify");
    const metadataAt = android.indexOf("android-release.js metadata");
    assert.ok(verifyAt > 0 && metadataAt > verifyAt);
    assert.match(android, /android-latest\.json/);
    assert.match(android, /--clobber/);
    release.SIGNING_SECRETS.forEach((name) => assert.match(android, new RegExp(name)));
    assert.equal(android.includes("keystorePassword"), false);
    assert.equal(android.includes("dist:publish"), false);
    assert.equal(android.includes("ghp_"), false);
    assert.match(windows, /npm run dist:publish/);
    assert.equal(/^\s*push:/m.test(windows), false);
  });
});
