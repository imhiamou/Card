/*
 * GitHub Releases updater for the packaged Windows app.
 *
 * Unpackaged `npm start` does not check for updates. A packaged app checks
 * the GitHub Release feed, shows "Update available", and downloads only after
 * Update Now. The download then restarts Hidden Hunter into the new version.
 * The installed version is desktop/package.json. Ship the next version by
 * bumping that field and publishing a GitHub Release tagged v plus the version.
 */

"use strict";

const UPDATE_MESSAGE = "Update available";
const UPDATE_NOW = "Update Now";
const LATER = "Later";

function liveWindow(getWindow) {
  const win = getWindow();
  if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) return null;
  return win;
}

function progressFraction(progress) {
  const percent = progress && typeof progress.percent === "number" ? progress.percent : 0;
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(1, percent / 100));
}

function updateDetail(info) {
  const version = info && info.version ? String(info.version) : "";
  if (version) {
    return "Version " + version + " is ready to download. Hidden Hunter will restart after the download.";
  }
  return "A new version is ready to download. Hidden Hunter will restart after the download.";
}

function createUpdateController(options) {
  const autoUpdater = options.autoUpdater;
  const dialog = options.dialog;
  const getWindow = options.getWindow;
  const log = options.log || console;
  let promptOpen = false;
  let downloading = false;
  let installing = false;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = log;

  function setProgress(value) {
    const win = liveWindow(getWindow);
    if (!win || typeof win.setProgressBar !== "function") return;
    win.setProgressBar(value);
  }

  function showBox(box) {
    const parent = liveWindow(getWindow);
    if (parent) return dialog.showMessageBox(parent, box);
    return dialog.showMessageBox(box);
  }

  autoUpdater.on("error", (err) => {
    const message = err && err.message ? err.message : String(err);
    log.error("Hidden Hunter update error: " + message);
  });

  autoUpdater.on("download-progress", (progress) => {
    if (!downloading) return;
    setProgress(progressFraction(progress));
  });

  autoUpdater.on("update-downloaded", () => {
    if (installing) return;
    installing = true;
    downloading = false;
    setProgress(-1);
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on("update-available", (info) => {
    if (promptOpen || installing) return;
    promptOpen = true;
    prompt(info).catch((err) => {
      promptOpen = false;
      downloading = false;
      setProgress(-1);
      const message = err && err.message ? err.message : String(err);
      log.error("Hidden Hunter update prompt failed: " + message);
    });
  });

  async function prompt(info) {
    const choice = await showBox({
      type: "info",
      buttons: [UPDATE_NOW, LATER],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Hidden Hunter",
      message: UPDATE_MESSAGE,
      detail: updateDetail(info)
    });
    if (!choice || choice.response !== 0) {
      promptOpen = false;
      return;
    }
    downloading = true;
    setProgress(0);
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      downloading = false;
      promptOpen = false;
      setProgress(-1);
      const message = err && err.message ? err.message : String(err);
      log.error("Hidden Hunter update download failed: " + message);
      await showBox({
        type: "error",
        buttons: ["OK"],
        title: "Hidden Hunter",
        message: "Update failed",
        detail: "The update could not be downloaded. You can keep playing and try again the next time you open Hidden Hunter."
      });
    }
  }

  return {
    start() {
      if (!options.isPackaged) return;
      try {
        const pending = autoUpdater.checkForUpdates();
        if (pending && typeof pending.then === "function") {
          pending.catch((err) => {
            const message = err && err.message ? err.message : String(err);
            log.error("Hidden Hunter update check failed: " + message);
          });
        }
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        log.error("Hidden Hunter update check failed: " + message);
      }
    }
  };
}

module.exports = {
  createUpdateController,
  UPDATE_MESSAGE,
  UPDATE_NOW,
  LATER
};
