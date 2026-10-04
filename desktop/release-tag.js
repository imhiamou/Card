/*
 * The GitHub Release tag is the desktop application version.
 *
 * v1.0.4 becomes 1.0.4 in this workspace only. npm updates
 * package.json and package-lock.json and does not create a commit or tag.
 * Publishing continues only after those files match the tag.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseTagMatches(tag, version) {
  if (typeof tag !== "string" || typeof version !== "string") return false;
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  return tag === "v" + version;
}

function versionFromReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  if (!tag.startsWith("v")) return null;
  const version = tag.slice(1);
  return VERSION_RE.test(version) ? version : null;
}

function explainReleaseTag(tag, version) {
  if (releaseTagMatches(tag, version)) {
    return "Release tag " + tag + " matches desktop version " + version + ".";
  }
  const shown = typeof tag === "string" && tag ? tag : "(missing)";
  const expected = typeof version === "string" && version ? "v" + version : "(missing)";
  return "Release tag " + shown + " does not match desktop version " + expected + ". Refusing to publish.";
}

function invalidTagMessage(tag) {
  const shown = typeof tag === "string" && tag ? tag : "(missing)";
  return "Release tag " + shown + " is not a valid release version. Refusing to publish.";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function synchronizedVersions(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const lock = readJson(path.join(dir, "package-lock.json"));
  const rootPackage = lock.packages && lock.packages[""];
  return {
    packageJson: pkg.version,
    lockfile: lock.version,
    packagesRoot: rootPackage && rootPackage.version
  };
}

function synchronizePackageVersion(dir, version) {
  if (!VERSION_RE.test(version)) {
    throw new Error("Refusing to pass an unvalidated version to npm.");
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npm,
    ["version", version, "--no-git-tag-version", "--allow-same-version"],
    {
      cwd: dir,
      encoding: "utf8",
      env: process.env,
      shell: process.platform === "win32"
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = ((result.stderr || "") + (result.stdout || "")).trim();
    throw new Error(detail || "npm version failed.");
  }
}

function applyReleaseTag(dir, tag) {
  const version = versionFromReleaseTag(tag);
  if (!version) {
    return { ok: false, version: null, message: invalidTagMessage(tag) };
  }
  synchronizePackageVersion(dir, version);
  const synced = synchronizedVersions(dir);
  if (synced.packageJson !== version || synced.lockfile !== version || synced.packagesRoot !== version) {
    return {
      ok: false,
      version,
      message: "Release tag " + tag + " did not synchronize the desktop package to " + version + ". Refusing to publish."
    };
  }
  if (!releaseTagMatches(tag, synced.packageJson)) {
    return { ok: false, version, message: explainReleaseTag(tag, synced.packageJson) };
  }
  return {
    ok: true,
    version,
    message: "Release tag " + tag + " set the desktop version to " + version + "."
  };
}

function main() {
  const tag = process.env.RELEASE_TAG || "";
  let result;
  try {
    result = applyReleaseTag(__dirname, tag);
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  }
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (require.main === module) main();

module.exports = {
  releaseTagMatches,
  explainReleaseTag,
  versionFromReleaseTag,
  applyReleaseTag
};
