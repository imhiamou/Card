/*
 * Gate for the Windows production release.
 *
 * Publishing is allowed only when the GitHub Release tag is exactly
 * "v" plus desktop/package.json version, for example v1.0.2 and 1.0.2.
 * A mismatch must fail before electron-builder uploads anything.
 */

"use strict";

function releaseTagMatches(tag, version) {
  if (typeof tag !== "string" || typeof version !== "string") return false;
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  return tag === "v" + version;
}

function explainReleaseTag(tag, version) {
  if (releaseTagMatches(tag, version)) {
    return "Release tag " + tag + " matches desktop version " + version + ".";
  }
  const shown = typeof tag === "string" && tag ? tag : "(missing)";
  const expected = typeof version === "string" && version ? "v" + version : "(missing)";
  return "Release tag " + shown + " does not match desktop version " + expected + ". Refusing to publish.";
}

function main() {
  const tag = process.env.RELEASE_TAG || "";
  const version = require("./package.json").version;
  const message = explainReleaseTag(tag, version);
  if (!releaseTagMatches(tag, version)) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
}

if (require.main === module) main();

module.exports = {
  releaseTagMatches,
  explainReleaseTag
};
