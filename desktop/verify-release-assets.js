/*
 * After electron-builder publishes, confirm the GitHub Release itself
 * holds the installer, blockmap, and latest.yml. Actions artifacts are
 * not an update source.
 */

"use strict";

const https = require("https");

function releaseAssetNames(version) {
  return [
    "latest.yml",
    "Hidden-Hunter-Setup-" + version + ".exe",
    "Hidden-Hunter-Setup-" + version + ".exe.blockmap"
  ];
}

function missingReleaseAssets(release, version) {
  if (!release || release.draft) return ["release is not a published release"];
  if (release.prerelease) return ["release is a pre-release"];
  const have = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  const missing = [];
  releaseAssetNames(version).forEach((name) => {
    const asset = have.get(name);
    if (!asset) missing.push(name);
    else if (!asset.size) missing.push(name + " is empty");
  });
  return missing;
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        headers: {
          "User-Agent": "hidden-hunter-release-check",
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error("Release lookup failed with status " + res.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const token = process.env.GH_TOKEN || "";
  const tag = process.env.RELEASE_TAG || "";
  const version = require("./package.json").version;
  if (!token) {
    console.error("GH_TOKEN is not set. Refusing to treat the release as published.");
    process.exit(1);
  }
  if (!tag) {
    console.error("RELEASE_TAG is not set.");
    process.exit(1);
  }
  const release = await fetchJson(
    "https://api.github.com/repos/imhiamou/Card/releases/tags/" + encodeURIComponent(tag),
    token
  );
  const missing = missingReleaseAssets(release, version);
  if (missing.length) {
    console.error("Release " + tag + " is missing: " + missing.join(", "));
    process.exit(1);
  }
  console.log("Published " + releaseAssetNames(version).join(", "));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  releaseAssetNames,
  missingReleaseAssets
};
