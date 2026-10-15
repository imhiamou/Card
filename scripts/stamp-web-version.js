"use strict";

const fs = require("node:fs");
const path = require("node:path");

const sha = process.env.GITHUB_SHA;
if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
  console.error("GITHUB_SHA is missing");
  process.exit(1);
}

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes('name="gameweb-version"')) {
  console.error("gameweb-version meta tag is missing");
  process.exit(1);
}
const next = html.replace(
  /(<meta name="gameweb-version" content=")[^"]*(">)/,
  "$1" + sha + "$2"
);
if (next === html) {
  console.error("gameweb-version meta tag was not updated");
  process.exit(1);
}
fs.writeFileSync(htmlPath, next);
fs.writeFileSync(
  path.join(root, "version.json"),
  JSON.stringify({ version: sha, channel: "web" }, null, 2) + "\n"
);
