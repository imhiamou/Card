/*
 * Validate a Gameweb Android release tag, hash the signed APK, and
 * upload it to the matching GitHub Release. The tag is the version.
 * This script does not generate a keystore or print secret values.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const update = require("../../assets/android-update");

const SIGNING_SECRETS = [
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD"
];

function invalidTagMessage(tag) {
  const shown = typeof tag === "string" && tag ? tag : "(missing)";
  return "Release tag " + shown + " is not a valid Android version. Expected vMAJOR.MINOR.PATCH, for example v1.0.5, with each number below 1000. Refusing to publish.";
}

function checkEnvironment(env) {
  const tag = env.RELEASE_TAG;
  const version = update.versionFromReleaseTag(tag);
  const versionCode = version ? update.versionCodeFromVersion(version) : null;
  const missing = SIGNING_SECRETS.filter((name) => !String(env[name] || "").trim());
  const errors = [];
  if (!version || !versionCode) errors.push(invalidTagMessage(tag));
  if (missing.length) {
    errors.push(
      "Missing GitHub Actions secrets: " + missing.join(", ") +
      ". A signed Android release was not created. Add the existing release keystore; do not generate a new key for this run."
    );
  }
  return {
    ok: errors.length === 0,
    tag: version ? "v" + version : null,
    version: version,
    versionCode: versionCode,
    missing: missing,
    errors: errors
  };
}

function exportEnvLines(env) {
  const plan = checkEnvironment(Object.assign({}, env, {
    ANDROID_KEYSTORE_BASE64: env.ANDROID_KEYSTORE_BASE64 || "unused",
    ANDROID_KEYSTORE_PASSWORD: env.ANDROID_KEYSTORE_PASSWORD || "unused",
    ANDROID_KEY_ALIAS: env.ANDROID_KEY_ALIAS || "unused",
    ANDROID_KEY_PASSWORD: env.ANDROID_KEY_PASSWORD || "unused"
  }));
  if (!plan.version) {
    throw new Error(plan.errors[0] || invalidTagMessage(env.RELEASE_TAG));
  }
  return [
    "VERSION_NAME=" + plan.version,
    "VERSION_CODE=" + plan.versionCode
  ];
}

function assertSignedApk(apkPath) {
  const listing = spawnSync("unzip", ["-l", apkPath], { encoding: "utf8" });
  if (listing.error) throw listing.error;
  if (listing.status !== 0) {
    throw new Error((listing.stderr || "Could not read the APK.").trim());
  }
  if (!/META-INF\/[^/\s]+\.(RSA|DSA|EC)\b/i.test(listing.stdout)) {
    throw new Error("The APK is not signed. Refusing to publish it.");
  }
}

function writeMetadata(apkPath, destDir, version) {
  const versionCode = update.versionCodeFromVersion(version);
  if (!versionCode) throw new Error(invalidTagMessage("v" + version));
  const bytes = fs.readFileSync(apkPath);
  if (!bytes.length) throw new Error("The APK is empty. Refusing to publish it.");
  assertSignedApk(apkPath);
  const sha256 = update.sha256Hex(bytes);
  const apkName = update.apkFileName(version);
  fs.mkdirSync(destDir, { recursive: true });
  const apkDest = path.join(destDir, apkName);
  fs.writeFileSync(apkDest, bytes);
  fs.writeFileSync(path.join(destDir, apkName + ".sha256"), sha256 + "  " + apkName + "\n");
  const manifest = {
    version: version,
    versionCode: versionCode,
    apk: apkName,
    sha256: sha256
  };
  fs.writeFileSync(path.join(destDir, "android-latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const parsed = update.parseManifest(JSON.stringify(manifest));
  if (!parsed.ok) throw new Error(parsed.error);
  return manifest;
}

function gh(args, env) {
  return spawnSync("gh", args, {
    encoding: "utf8",
    env: env
  });
}

function releaseNotes(version) {
  return [
    "Gameweb " + version,
    "",
    "Android assets:",
    "- " + update.apkFileName(version),
    "- " + update.apkFileName(version) + ".sha256",
    "- android-latest.json",
    "",
    "The Windows installer is published by the existing Windows release workflow on this same tag."
  ].join("\n");
}

function publishDir(dir, env) {
  const version = update.versionFromReleaseTag(env.RELEASE_TAG);
  if (!version) {
    throw new Error(invalidTagMessage(env.RELEASE_TAG));
  }
  const plan = { tag: "v" + version, version: version };
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN) {
    throw new Error("GH_TOKEN is not set. Refusing to publish.");
  }
  const repo = env.GITHUB_REPOSITORY || "imhiamou/Card";
  const names = [
    update.apkFileName(plan.version),
    update.apkFileName(plan.version) + ".sha256",
    "android-latest.json"
  ];
  const files = names.map((name) => path.join(dir, name));
  files.forEach((file) => {
    if (!fs.existsSync(file) || !fs.statSync(file).size) {
      throw new Error("Missing release asset " + path.basename(file));
    }
  });
  const parsed = update.parseManifest(fs.readFileSync(path.join(dir, "android-latest.json"), "utf8"));
  if (!parsed.ok || parsed.manifest.version !== plan.version) {
    throw new Error(parsed.ok ? "Update metadata does not match the tag." : parsed.error);
  }
  const tokenEnv = Object.assign({}, env, {
    GH_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN
  });
  const view = gh(["release", "view", plan.tag, "--repo", repo, "--json", "isDraft,isPrerelease,tagName"], tokenEnv);
  if (view.status === 0) {
    const release = JSON.parse(view.stdout);
    if (release.isDraft || release.isPrerelease) {
      throw new Error("Release " + plan.tag + " is a draft or prerelease. Refusing to publish Android assets to it.");
    }
  } else {
    const created = gh([
      "release", "create", plan.tag,
      "--repo", repo,
      "--verify-tag",
      "--title", plan.tag,
      "--notes", releaseNotes(plan.version)
    ], tokenEnv);
    if (created.status !== 0) {
      const detail = ((created.stderr || "") + (created.stdout || "")).trim();
      throw new Error(detail || "Could not create the GitHub Release.");
    }
  }
  const uploaded = gh(["release", "upload", plan.tag, "--repo", repo, "--clobber"].concat(files), tokenEnv);
  if (uploaded.status !== 0) {
    const detail = ((uploaded.stderr || "") + (uploaded.stdout || "")).trim();
    throw new Error(detail || "Could not upload the Android release assets.");
  }
  return names;
}

function printErrors(errors) {
  errors.forEach((error) => {
    console.error(error);
  });
}

function main(argv, env) {
  const command = argv[2];
  if (command === "check") {
    const plan = checkEnvironment(env);
    if (!plan.ok) {
      printErrors(plan.errors);
      return 1;
    }
    console.log("Android release " + plan.tag + " versionCode " + plan.versionCode + ".");
    return 0;
  }
  if (command === "export-env") {
    const lines = exportEnvLines(env);
    const target = env.GITHUB_ENV;
    if (target) fs.appendFileSync(target, lines.join("\n") + "\n");
    else lines.forEach((line) => console.log(line));
    return 0;
  }
  if (command === "metadata") {
    const apkPath = argv[3];
    const destDir = argv[4];
    const version = update.versionFromReleaseTag(env.RELEASE_TAG);
    if (!apkPath || !destDir || !version) {
      console.error("Usage: android-release.js metadata <apk> <dest-dir> with RELEASE_TAG set.");
      return 1;
    }
    const manifest = writeMetadata(apkPath, destDir, version);
    console.log("Wrote " + manifest.apk + " sha256 " + manifest.sha256);
    return 0;
  }
  if (command === "publish") {
    const dir = argv[3];
    if (!dir) {
      console.error("Usage: android-release.js publish <asset-dir>");
      return 1;
    }
    const names = publishDir(dir, env);
    console.log("Published " + names.join(", "));
    return 0;
  }
  console.error("Usage: android-release.js check|export-env|metadata|publish");
  return 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv, process.env));
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  SIGNING_SECRETS: SIGNING_SECRETS,
  checkEnvironment: checkEnvironment,
  exportEnvLines: exportEnvLines,
  writeMetadata: writeMetadata,
  publishDir: publishDir,
  releaseNotes: releaseNotes,
  main: main
};
