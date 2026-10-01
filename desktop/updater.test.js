"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { createUpdateController, UPDATE_MESSAGE, UPDATE_NOW, LATER } = require("./updater");

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
    assert.equal(desktopPackage.version, "1.0.0");
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
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /npm run dist:publish/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
    assert.match(workflow, /latest\.yml/);
    assert.match(workflow, /Hidden-Hunter-Setup-/);
    assert.equal(workflow.includes("DATABASE_URL"), false);
    assert.match(installer, /npm test/);
    assert.match(installer, /npm run dist/);
    assert.match(installer, /contents: read/);
  });
});
