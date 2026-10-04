"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { createUpdateController, UPDATE_MESSAGE, UPDATE_NOW, LATER } = require("./updater");
const { releaseTagMatches, versionFromReleaseTag, applyReleaseTag } = require("./release-tag");
const { verifyDist } = require("./verify-dist");
const { missingReleaseAssets, releaseAssetNames } = require("./verify-release-assets");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = false;
  updater.logger = null;
  updater.checks = 0;
  updater.downloads = 0;
  updater.installs = [];
  updater.checkForUpdates = () => {
    updater.checks += 1;
    return Promise.resolve();
  };
  updater.downloadUpdate = () => {
    updater.downloads += 1;
    return Promise.resolve();
  };
  updater.quitAndInstall = (isSilent, isForceRunAfter) => {
    updater.installs.push([isSilent, isForceRunAfter]);
  };
  return updater;
}

function fakeWindow() {
  return {
    destroyed: false,
    progress: null,
    isDestroyed() {
      return this.destroyed;
    },
    setProgressBar(value) {
      this.progress = value;
    }
  };
}

function boxOptions(call) {
  return call.length === 1 ? call[0] : call[1];
}

describe("update prompt", () => {
  it("asks to update and restarts after Update Now", async () => {
    const updater = fakeUpdater();
    const win = fakeWindow();
    const calls = [];
    updater.downloadUpdate = () => {
      updater.downloads += 1;
      updater.emit("download-progress", { percent: 40 });
      updater.emit("update-downloaded", { version: "1.0.1" });
      return Promise.resolve();
    };
    const dialog = {
      showMessageBox(...args) {
        calls.push(args);
        return Promise.resolve({ response: 0 });
      }
    };
    const updates = createUpdateController({
      autoUpdater: updater,
      dialog,
      getWindow: () => win,
      isPackaged: true,
      log: { info() {}, warn() {}, error() {} }
    });
    updates.start();
    updater.emit("update-available", { version: "1.0.1" });
    await flush();
    await flush();

    assert.equal(updater.checks, 1);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.disableWebInstaller, true);
    assert.equal(calls.length, 1);
    const options = boxOptions(calls[0]);
    assert.equal(options.message, UPDATE_MESSAGE);
    assert.deepEqual(options.buttons, [UPDATE_NOW, LATER]);
    assert.equal(options.defaultId, 0);
    assert.match(options.detail, /1\.0\.1/);
    assert.equal(updater.downloads, 1);
    assert.deepEqual(updater.installs, [[true, true]]);
    assert.equal(win.progress, -1);
  });

  it("does not download when the player chooses Later", async () => {
    const updater = fakeUpdater();
    const calls = [];
    const dialog = {
      showMessageBox(...args) {
        calls.push(args);
        return Promise.resolve({ response: 1 });
      }
    };
    createUpdateController({
      autoUpdater: updater,
      dialog,
      getWindow: () => fakeWindow(),
      isPackaged: true
    });
    updater.emit("update-available", { version: "1.0.1" });
    await flush();
    await flush();
    updater.emit("update-available", { version: "1.0.1" });
    await flush();
    await flush();

    assert.equal(updater.downloads, 0);
    assert.equal(updater.installs.length, 0);
    assert.equal(calls.length, 2);
    assert.equal(boxOptions(calls[0]).message, "Update available");
  });

  it("keeps the game open when the download fails", async () => {
    const updater = fakeUpdater();
    const win = fakeWindow();
    const calls = [];
    const errors = [];
    updater.downloadUpdate = () => Promise.reject(new Error("network down"));
    const dialog = {
      showMessageBox(...args) {
        calls.push(args);
        return Promise.resolve({ response: 0 });
      }
    };
    createUpdateController({
      autoUpdater: updater,
      dialog,
      getWindow: () => win,
      isPackaged: true,
      log: { info() {}, warn() {}, error(message) { errors.push(message); } }
    });
    updater.emit("update-available", { version: "1.0.1" });
    await flush();
    await flush();
    await flush();

    assert.equal(calls.length, 2);
    assert.equal(boxOptions(calls[1]).message, "Update failed");
    assert.equal(updater.installs.length, 0);
    assert.equal(win.progress, -1);
    assert.match(errors.join("\n"), /network down/);
  });

  it("does not check for updates from an unpackaged launch", () => {
    const updater = fakeUpdater();
    createUpdateController({
      autoUpdater: updater,
      dialog: { showMessageBox() { throw new Error("dialog should not open"); } },
      getWindow: () => null,
      isPackaged: false
    }).start();
    assert.equal(updater.checks, 0);
  });

  it("logs a failed update check and still returns", async () => {
    const updater = fakeUpdater();
    const errors = [];
    updater.checkForUpdates = () => Promise.reject(new Error("no release"));
    createUpdateController({
      autoUpdater: updater,
      dialog: { showMessageBox() { throw new Error("dialog should not open"); } },
      getWindow: () => null,
      isPackaged: true,
      log: { info() {}, warn() {}, error(message) { errors.push(message); } }
    }).start();
    await flush();
    updater.emit("error", new Error("404"));
    assert.match(errors.join("\n"), /no release/);
    assert.match(errors.join("\n"), /404/);
  });
});

describe("release configuration", () => {
  const root = path.resolve(__dirname, "..");
  const desktopPackage = require("./package.json");
  const rootPackage = require("../package.json");

  it("publishes the desktop app to the public Card GitHub Releases", () => {
    assert.match(desktopPackage.version, /^\d+\.\d+\.\d+$/);
    assert.equal(desktopPackage.build.files.includes("release-tag.js"), false);
    assert.equal(desktopPackage.build.files.includes("verify-dist.js"), false);
    assert.equal(desktopPackage.build.files.includes("verify-release-assets.js"), false);
    assert.equal(desktopPackage.dependencies["electron-updater"], "6.6.2");
    assert.equal(desktopPackage.devDependencies["electron-updater"], undefined);
    assert.equal(desktopPackage.scripts.dist, "electron-builder --win --publish never");
    assert.equal(desktopPackage.scripts["dist:publish"], "electron-builder --win --publish always");
    assert.deepEqual(desktopPackage.build.publish, {
      provider: "github",
      owner: "imhiamou",
      repo: "Card",
      releaseType: "release"
    });
    assert.ok(desktopPackage.build.files.includes("updater.js"));
    assert.equal(desktopPackage.build.files.includes("updater.test.js"), false);
    assert.equal(rootPackage.main, "server/server.js");
    assert.equal(rootPackage.scripts.start, "node server/server.js");
  });

  it("keeps the multiplayer server and the Pages workflow unchanged by the updater", () => {
    const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
    const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const preload = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
    const pages = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
    assert.match(index, /const SERVER="https:\/\/cardb-2uys\.onrender\.com"/);
    assert.match(main, /createUpdateController/);
    assert.match(main, /loadURL/);
    assert.equal(main.includes("loadFile"), false);
    assert.match(main, /nodeIntegration: false/);
    assert.match(main, /contextIsolation: true/);
    assert.match(main, /sandbox: true/);
    assert.equal(preload.includes("contextBridge"), false);
    assert.equal(preload.includes("ipcRenderer"), false);
    assert.match(pages, /github-pages/);
  });

  it("builds update metadata when a GitHub Release is published", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/windows-release.yml"), "utf8");
    const installer = fs.readFileSync(path.join(root, ".github/workflows/windows-installer.yml"), "utf8");
    assert.match(workflow, /types: \[published\]/);
    assert.equal(workflow.includes("types: [created]"), false);
    assert.equal(workflow.includes("pull_request:"), false);
    assert.equal(/^\s*push:/m.test(workflow), false);
    assert.match(workflow, /github\.event\.release\.draft == false/);
    assert.match(workflow, /github\.event\.release\.prerelease == false/);
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /node-version: 22/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /node desktop\/release-tag\.js/);
    const syncAt = workflow.indexOf("node desktop/release-tag.js");
    const testAt = workflow.indexOf("npm test");
    assert.ok(syncAt >= 0 && testAt > syncAt);
    assert.match(workflow, /npm run dist:publish/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
    assert.match(workflow, /node desktop\/verify-dist\.js/);
    assert.match(workflow, /node desktop\/verify-release-assets\.js/);
    assert.match(workflow, /github\.event\.release\.tag_name/);
    assert.equal(workflow.includes("DATABASE_URL"), false);
    assert.equal(workflow.includes("ghp_"), false);
    assert.match(installer, /pull_request:/);
    assert.match(installer, /branches: \[main\]/);
    assert.match(installer, /npm test/);
    assert.match(installer, /npm run dist\b/);
    assert.equal(installer.includes("release-tag.js"), false);
    assert.equal(installer.includes("dist:publish"), false);
    assert.equal(installer.includes("GH_TOKEN"), false);
    assert.match(installer, /contents: read/);
    assert.match(installer, /node desktop\/verify-dist\.js/);
    assert.match(installer, /upload-artifact@v4/);
  });
});

describe("release tag gate", () => {
  const os = require("os");

  function fixture(version) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-release-"));
    const pkg = {
      name: "hidden-hunter-desktop",
      version,
      private: true
    };
    const lock = {
      name: "hidden-hunter-desktop",
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "hidden-hunter-desktop",
          version
        },
        "node_modules/left-pad": {
          version: "1.0.2"
        }
      }
    };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    return dir;
  }

  function versions(dir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
    return {
      packageJson: pkg.version,
      lockfile: lock.version,
      packagesRoot: lock.packages[""].version,
      dependency: lock.packages["node_modules/left-pad"].version
    };
  }

  it("accepts only v plus the exact desktop version", () => {
    assert.equal(releaseTagMatches("v1.0.2", "1.0.2"), true);
    assert.equal(releaseTagMatches("v1.0.1", "1.0.2"), false);
    assert.equal(releaseTagMatches("1.0.2", "1.0.2"), false);
    assert.equal(releaseTagMatches("v1.0.2-beta", "1.0.2"), false);
    assert.equal(releaseTagMatches("v1.0.2", "1.0.2-beta"), false);
    assert.equal(releaseTagMatches("", "1.0.2"), false);
  });

  it("derives a strict application version from the release tag", () => {
    assert.equal(versionFromReleaseTag("v1.0.4"), "1.0.4");
    assert.equal(versionFromReleaseTag("v1.2.3"), "1.2.3");
    assert.equal(versionFromReleaseTag("v2.0.0"), "2.0.0");
    assert.equal(versionFromReleaseTag("v10.20.30"), "10.20.30");
    for (const tag of ["", "1.0.4", "v1.0.4-beta", "v1.0", "v1.0.4.1", "v1.0.4 ", "V1.0.4", "vv1.0.4", "v01.0.4"]) {
      assert.equal(versionFromReleaseTag(tag), null, tag);
    }
  });

  it("synchronizes package 1.0.3 to release tag v1.0.4", () => {
    const dir = fixture("1.0.3");
    const result = applyReleaseTag(dir, "v1.0.4");
    const synced = versions(dir);
    assert.equal(result.ok, true);
    assert.equal(result.version, "1.0.4");
    assert.equal(synced.packageJson, "1.0.4");
    assert.equal(synced.lockfile, "1.0.4");
    assert.equal(synced.packagesRoot, "1.0.4");
    assert.equal(synced.dependency, "1.0.2");
    assert.equal(releaseTagMatches("v1.0.4", synced.packageJson), true);
  });

  it("synchronizes package 1.0.4 to the next release tag v1.0.5", () => {
    const dir = fixture("1.0.4");
    const result = applyReleaseTag(dir, "v1.0.5");
    const synced = versions(dir);
    assert.equal(result.ok, true);
    assert.equal(synced.packageJson, "1.0.5");
    assert.equal(synced.lockfile, "1.0.5");
    assert.equal(synced.packagesRoot, "1.0.5");
    assert.equal(releaseTagMatches("v1.0.5", synced.packageJson), true);
  });

  it("accepts a tag that already matches the package version", () => {
    const dir = fixture("1.0.4");
    const result = applyReleaseTag(dir, "v1.0.4");
    assert.equal(result.ok, true);
    assert.equal(versions(dir).packageJson, "1.0.4");
    assert.equal(versions(dir).lockfile, "1.0.4");
  });

  it("rejects malformed tags without changing the package version", () => {
    for (const tag of ["", "1.0.4", "v1.0.4-beta", "v1.0", "v1.0.4.1", "V1.0.4"]) {
      const dir = fixture("1.0.3");
      const result = applyReleaseTag(dir, tag);
      assert.equal(result.ok, false, tag);
      assert.match(result.message, /Refusing to publish/);
      assert.equal(versions(dir).packageJson, "1.0.3");
      assert.equal(versions(dir).lockfile, "1.0.3");
      assert.equal(versions(dir).packagesRoot, "1.0.3");
    }
  });
});

describe("local Windows dist", () => {
  const os = require("os");

  function fixture(mutate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-dist-"));
    const resources = path.join(dir, "win-unpacked", "resources");
    const frontend = path.join(resources, "frontend");
    fs.mkdirSync(frontend, { recursive: true });
    fs.writeFileSync(path.join(dir, "Hidden-Hunter-Setup-1.0.2.exe"), "exe");
    fs.writeFileSync(path.join(dir, "Hidden-Hunter-Setup-1.0.2.exe.blockmap"), "map");
    fs.writeFileSync(path.join(dir, "latest.yml"), [
      "version: 1.0.2",
      "path: Hidden-Hunter-Setup-1.0.2.exe",
      ""
    ].join("\n"));
    fs.writeFileSync(path.join(resources, "app-update.yml"), [
      "provider: github",
      "owner: imhiamou",
      "repo: Card",
      ""
    ].join("\n"));
    fs.writeFileSync(path.join(frontend, "index.js"), 'const SERVER="https://cardb-2uys.onrender.com";\n');
    if (mutate) mutate(dir);
    return dir;
  }

  it("accepts the installer, blockmap, and GitHub updater metadata", () => {
    assert.deepEqual(verifyDist(fixture(), "1.0.2"), []);
  });

  it("rejects a packaged server directory, a secret, and a missing blockmap", () => {
    const withServer = fixture((dir) => {
      fs.mkdirSync(path.join(dir, "win-unpacked", "resources", "frontend", "server"));
    });
    assert.ok(verifyDist(withServer, "1.0.2").some((error) => error.includes("server/")));

    const withSecret = fixture((dir) => {
      fs.appendFileSync(path.join(dir, "latest.yml"), "token: secret\n");
    });
    assert.ok(verifyDist(withSecret, "1.0.2").some((error) => error.includes("secret")));

    const noMap = fixture((dir) => {
      fs.unlinkSync(path.join(dir, "Hidden-Hunter-Setup-1.0.2.exe.blockmap"));
    });
    assert.ok(verifyDist(noMap, "1.0.2").some((error) => error.includes("blockmap")));
  });
});

describe("published release assets", () => {
  it("requires the installer, blockmap, and latest.yml on a full release", () => {
    assert.deepEqual(releaseAssetNames("1.0.2"), [
      "latest.yml",
      "Hidden-Hunter-Setup-1.0.2.exe",
      "Hidden-Hunter-Setup-1.0.2.exe.blockmap"
    ]);
    const release = {
      draft: false,
      prerelease: false,
      assets: releaseAssetNames("1.0.2").map((name) => ({ name, size: 10 }))
    };
    assert.deepEqual(missingReleaseAssets(release, "1.0.2"), []);
    assert.ok(missingReleaseAssets({ draft: true, assets: [] }, "1.0.2").length > 0);
    assert.ok(missingReleaseAssets({ draft: false, prerelease: true, assets: [] }, "1.0.2").length > 0);
    const empty = {
      draft: false,
      prerelease: false,
      assets: [{ name: "latest.yml", size: 0 }]
    };
    assert.ok(missingReleaseAssets(empty, "1.0.2").some((error) => error.includes("empty") || error.includes("Hidden-Hunter-Setup-1.0.2.exe")));
  });
});
