"use strict";

const fs = require("fs");
const path = require("path");

const VERSION_RE = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/;
const SHA_RE = /^[a-f0-9]{40}$/i;

function stampHtml(html, version, commit) {
  if (typeof version !== "string" || !VERSION_RE.test(version)) {
    throw new Error("VERSION_NAME must be a semantic version such as 1.0.25.");
  }
  if (typeof commit !== "string" || !SHA_RE.test(commit)) {
    throw new Error("GITHUB_SHA must be the full 40-character source commit SHA.");
  }
  const versionTag = /<meta\\s+name=["']gameweb-version["']\\s+content=["'][^"']*["']\\s*\\/?\\s*>/i;
  if (!versionTag.test(html)) throw new Error("The bundled index.html has no gameweb-version meta tag.");
  let result = html.replace(versionTag, '<meta name="gameweb-version" content="' + version + '">');
  const commitTag = /<meta\\s+name=["']gameweb-build-commit["']\\s+content=["'][^"']*["']\\s*\\/?\\s*>/i;
  const replacement = '<meta name="gameweb-build-commit" content="' + commit.toLowerCase() + '">';
  if (commitTag.test(result)) result = result.replace(commitTag, replacement);
  else result = result.replace(/(<meta\\s+name=["']gameweb-version["'][^>]*>)/i, "$1\\n" + replacement);
  if (!result.includes('name="gameweb-version" content="' + version + '"') ||
      !result.includes('name="gameweb-build-commit" content="' + commit.toLowerCase() + '"')) {
    throw new Error("The Android build identity could not be verified after stamping.");
  }
  return result;
}

function main(env) {
  const target = path.resolve(__dirname, "..", "www", "index.html");
  if (!fs.existsSync(target)) throw new Error("Capacitor web bundle is missing: " + target);
  const html = fs.readFileSync(target, "utf8");
  const stamped = stampHtml(html, env.VERSION_NAME, env.GITHUB_SHA);
  fs.writeFileSync(target, stamped, "utf8");
  console.log("Stamped Android lobby: v" + env.VERSION_NAME + " · commit " + env.GITHUB_SHA.slice(0, 7));
  return target;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { stampHtml, main };
