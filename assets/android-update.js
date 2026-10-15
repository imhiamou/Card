/*
 * Android update check for the Gameweb Capacitor app.
 *
 * The website and the Windows app load this file and do nothing.
 * On Android, release discovery and the APK download go through the
 * native GamewebUpdate plugin. The WebView does not fetch GitHub.
 * The download URL is built from the version. Metadata cannot point
 * the download at an arbitrary host.
 *
 * Dismissal is stored only when the user presses Not now. A dialog
 * that is interrupted, a failed download, or a plugin error does not
 * count as a decline.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GamewebAndroidUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const COMPONENT_LIMIT = 1000;
  const DISMISS_KEY = "gameweb-android-update-dismissed";
  const AUTO_COOLDOWN_MS = 120000;
  let session = null;
  let booted = false;
  let foregroundTimer = null;
  let diagnosticsReady = false;

  function versionFromReleaseTag(tag) {
    if (typeof tag !== "string" || !tag.startsWith("v")) return null;
    const version = tag.slice(1);
    return versionCodeFromVersion(version) ? version : null;
  }

  function versionCodeFromVersion(version) {
    if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
    const parts = version.split(".").map(Number);
    if (parts.some((part) => part >= COMPONENT_LIMIT)) return null;
    const code = parts[0] * 1000000 + parts[1] * 1000 + parts[2];
    if (code < 1 || code > 2100000000) return null;
    return code;
  }

  function apkFileName(version) {
    return "Gameweb-" + version + ".apk";
  }

  function releaseDownloadUrl(version) {
    if (!versionCodeFromVersion(version)) return null;
    return "https://github.com/imhiamou/Card/releases/download/v" + version + "/" + apkFileName(version);
  }

  function tagParts(tag) {
    if (typeof tag !== "string" || tag.length < 2) return null;
    const prefix = tag.charAt(0);
    if (prefix !== "v" && prefix !== "V") return null;
    const version = tag.slice(1);
    const versionCode = versionCodeFromVersion(version);
    if (!versionCode) return null;
    return { prefix: prefix, version: version, versionCode: versionCode };
  }

  function manifestUrlFor(prefix, version) {
    if (prefix !== "v" && prefix !== "V") return null;
    if (!versionCodeFromVersion(version)) return null;
    return "https://github.com/imhiamou/Card/releases/download/" + prefix + version + "/android-latest.json";
  }

  function sha256FromDigest(value) {
    if (typeof value !== "string") return null;
    const match = /^sha256:([a-f0-9]{64})$/i.exec(value.trim());
    return match ? match[1].toLowerCase() : null;
  }

  function selectAndroidRelease(releases) {
    if (!Array.isArray(releases)) return null;
    let best = null;
    releases.forEach((release) => {
      if (!release || typeof release !== "object") return;
      if (release.draft || release.prerelease) return;
      const parts = tagParts(release.tag_name);
      if (!parts) return;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const apk = assets.find((asset) => asset && asset.name === apkFileName(parts.version));
      if (!apk) return;
      const sha256 = sha256FromDigest(apk.digest);
      const hasManifest = assets.some((asset) => asset && asset.name === "android-latest.json");
      if (!sha256 && !hasManifest) return;
      if (!best || parts.versionCode > best.versionCode) {
        best = {
          prefix: parts.prefix,
          version: parts.version,
          versionCode: parts.versionCode,
          tag: parts.prefix + parts.version,
          sha256: sha256
        };
      }
    });
    return best;
  }

  function allowedMetadataUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return false;
      const host = url.hostname.toLowerCase();
      return host === "github.com" ||
        host === "objects.githubusercontent.com" ||
        host === "release-assets.githubusercontent.com" ||
        host === "github-releases.githubusercontent.com";
    } catch (err) {
      return false;
    }
  }

  function parseManifest(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: "The update metadata is not valid JSON." };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "The update metadata is not a document." };
    }
    const version = data.version;
    const versionCode = versionCodeFromVersion(version);
    if (!versionCode) {
      return { ok: false, error: "The update metadata version is invalid." };
    }
    if (data.versionCode !== versionCode) {
      return { ok: false, error: "The update metadata version code does not match the version." };
    }
    if (data.apk !== apkFileName(version)) {
      return { ok: false, error: "The update metadata names an unexpected package." };
    }
    if (typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256)) {
      return { ok: false, error: "The update metadata checksum is invalid." };
    }
    const url = releaseDownloadUrl(version);
    if (data.url != null && data.url !== url) {
      return { ok: false, error: "The update metadata contains an unexpected download location." };
    }
    return {
      ok: true,
      manifest: {
        version: version,
        versionCode: versionCode,
        apk: data.apk,
        sha256: data.sha256,
        url: url
      }
    };
  }

  function isNewer(installedCode, availableCode) {
    const installed = Number(installedCode);
    const available = Number(availableCode);
    if (!Number.isInteger(installed) || !Number.isInteger(available)) return false;
    if (installed < 1 || available < 1) return false;
    return available > installed;
  }

  function sha256Hex(buffer) {
    return require("crypto").createHash("sha256").update(buffer).digest("hex");
  }

  function errorText(err, fallback) {
    if (err && typeof err.message === "string" && err.message) return err.message;
    if (typeof err === "string" && err) return err;
    return fallback;
  }

  function manifestFromChoice(chosen, sha256) {
    if (!sha256 || manifestUrlFor(chosen.prefix, chosen.version) == null) return null;
    return {
      version: chosen.version,
      versionCode: chosen.versionCode,
      apk: apkFileName(chosen.version),
      sha256: sha256,
      url: releaseDownloadUrl(chosen.version),
      prefix: chosen.prefix
    };
  }

  function emptyDiagnostic() {
    return {
      installedVersionName: "",
      installedVersionCode: null,
      pluginReady: false,
      releaseListOk: false,
      releaseCount: null,
      selectedTag: "",
      selectedVersion: "",
      selectedVersionCode: null,
      apkName: "",
      newer: false,
      checksumFound: false,
      checksumValid: false,
      stage: "idle",
      error: "",
      installerOpened: false,
      permissionRequired: false,
      installResult: "not-started",
      dismissed: false,
      failureVisible: false,
      deferred: false
    };
  }

  function statusMessage(diagnostic) {
    const d = diagnostic || emptyDiagnostic();
    if (d.stage === "checking") return "The check is in progress.";
    if (d.failureVisible || d.stage === "failed") {
      return "The server or version endpoint could not be reached.";
    }
    if (d.newer && d.selectedVersion) {
      const installed = d.installedVersionName ||
        (d.installedVersionCode != null ? String(d.installedVersionCode) : "unknown");
      let text = "A newer version exists, and the user should refresh or update the application. Current version: " +
        installed + ". Available version: " + d.selectedVersion + ".";
      if (d.deferred) text += " The installer will wait until you return to the lobby.";
      return text;
    }
    if (d.stage === "no-update" && d.selectedVersion && !d.newer) {
      const installed = d.installedVersionName || d.selectedVersion;
      return "The current version is the latest available. Current version: " + installed + ".";
    }
    if (d.stage === "no-update") {
      return "The server or version endpoint could not be reached.";
    }
    if (d.stage === "permission") return "Allow Gameweb to install unknown apps, then tap Check for updates.";
    if (d.installResult === "unknown") return "Android's installer was opened. The installation result is not known yet.";
    return "";
  }

  function matchIsActive() {
    if (typeof document === "undefined") return false;
    const ids = ["gameScreen", "placementScreen", "dominoScreen", "unoScreen", "hiddenHunterScreen", "cartsScreen"];
    return ids.some((id) => {
      const el = document.getElementById(id);
      return !!(el && el.classList && !el.classList.contains("hidden"));
    });
  }

  function formatDiagnostic(diagnostic) {
    const d = diagnostic || emptyDiagnostic();
    const installedCode = d.installedVersionCode == null ? "unknown" : String(d.installedVersionCode);
    const selectedCode = d.selectedVersionCode == null ? "none" : String(d.selectedVersionCode);
    let checksum = "not checked";
    if (d.checksumValid === "matched") checksum = "matched the downloaded APK";
    else if (d.checksumValid === "mismatched") checksum = "did not match the downloaded APK";
    else if (d.checksumFound) checksum = "found in the release";
    else if (d.releaseListOk) checksum = "missing";
    const install = d.installResult === "unknown"
      ? "Installer opened. Installation result is unknown until Gameweb restarts."
      : d.installResult === "permission"
        ? "Android is waiting for permission to install unknown apps."
        : d.installResult === "installed"
          ? "The installed version is the selected release or newer."
          : "Installer has not been opened.";
    return [
      "Installed version: " + (d.installedVersionName || "unknown") + " (" + installedCode + ")",
      "Updater plugin: " + (d.pluginReady ? "ready" : "not ready"),
      "Release list: " + (d.releaseListOk ? "received" : "not received"),
      "Releases returned: " + (d.releaseCount == null ? "unknown" : String(d.releaseCount)),
      "Selected release: " + (d.selectedTag || "none"),
      "Selected version: " + (d.selectedVersion || "none") + " (" + selectedCode + ")",
      "Expected APK: " + (d.apkName || "none"),
      "Newer than installed: " + (d.newer ? "yes" : "no"),
      "Checksum: " + checksum,
      "Stage: " + (d.stage || "idle"),
      "Error: " + (d.error || "none"),
      install
    ].join("\n");
  }

  function cloneDiagnostic(diagnostic) {
    const copy = emptyDiagnostic();
    Object.keys(copy).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(diagnostic, key)) copy[key] = diagnostic[key];
    });
    return copy;
  }

  function memoryStorage() {
    const data = {};
    return {
      get: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : ""; },
      set: function (key, value) { data[key] = String(value); }
    };
  }

  function createSession(options) {
    const plugin = options && options.plugin;
    const storage = options && options.storage ? options.storage : memoryStorage();
    const ask = options && options.ask ? options.ask : async function () { return "interrupted"; };
    const notify = options && options.notify ? options.notify : function () {};
    const onDiagnostic = options && options.onDiagnostic ? options.onDiagnostic : function () {};
    const onProgress = options && options.onProgress ? options.onProgress : function () {};
    const now = options && options.now ? options.now : function () { return Date.now(); };
    const matchActive = options && typeof options.matchActive === "function" ? options.matchActive : matchIsActive;
    const diagnostic = emptyDiagnostic();
    let busy = false;
    let lastAuto = 0;
    let prepared = null;

    function publish() {
      onDiagnostic(cloneDiagnostic(diagnostic));
    }

    function result(message, extra) {
      return Object.assign({
        diagnostic: cloneDiagnostic(diagnostic),
        message: message || "",
        busy: false,
        quiet: !message
      }, extra || {});
    }

    function fail(message, manual) {
      diagnostic.stage = "failed";
      diagnostic.error = message;
      diagnostic.failureVisible = true;
      diagnostic.installerOpened = false;
      publish();
      if (manual) notify(message);
      return result(manual ? message : "", { quiet: !manual });
    }

    async function readReleases() {
      const loaded = await plugin.fetchReleaseText({ kind: "releases", version: "", prefix: "v" });
      const text = loaded && loaded.body ? loaded.body : "";
      let releases = null;
      try {
        releases = JSON.parse(text);
      } catch (err) {
        throw new Error("The update list is not valid JSON.");
      }
      if (!Array.isArray(releases)) throw new Error("The update list is not valid JSON.");
      return releases;
    }

    async function checksumFor(chosen) {
      if (chosen.sha256) return chosen.sha256;
      const loaded = await plugin.fetchReleaseText({
        kind: "manifest",
        version: chosen.version,
        prefix: chosen.prefix
      });
      const parsed = parseManifest(loaded && loaded.body ? loaded.body : "");
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.manifest.version !== chosen.version || parsed.manifest.versionCode !== chosen.versionCode) {
        throw new Error("The update metadata does not match the published release.");
      }
      return parsed.manifest.sha256;
    }

    async function download(manifest) {
      diagnostic.stage = "downloading";
      diagnostic.error = "";
      diagnostic.installerOpened = false;
      diagnostic.installResult = "not-started";
      publish();
      let handle = null;
      try {
        if (plugin.addListener) {
          handle = await plugin.addListener("progress", (event) => {
            const received = Number(event && event.received) || 0;
            const total = Number(event && event.total) || 0;
            if (total > 0 && received >= total) diagnostic.stage = "verifying";
            else diagnostic.stage = "downloading";
            onProgress({ version: manifest.version, received: received, total: total, stage: diagnostic.stage });
            publish();
          });
        }
        const outcome = await plugin.downloadAndInstall({
          version: manifest.version,
          prefix: manifest.prefix === "V" ? "V" : "v",
          sha256: manifest.sha256
        });
        prepared = {
          version: manifest.version,
          prefix: manifest.prefix === "V" ? "V" : "v",
          sha256: manifest.sha256
        };
        diagnostic.checksumValid = "matched";
        return applyInstallOutcome(outcome, manifest);
      } catch (err) {
        const message = errorText(err, "The update could not be downloaded.");
        if (/checksum/i.test(message)) diagnostic.checksumValid = "mismatched";
        diagnostic.stage = "failed";
        diagnostic.error = message;
        diagnostic.failureVisible = true;
        diagnostic.installResult = "not-started";
        prepared = null;
        publish();
        notify(message);
        return result(message);
      } finally {
        if (handle && typeof handle.remove === "function") {
          try { await handle.remove(); } catch (err) { /* listener cleanup is optional */ }
        }
        onProgress({ clear: true });
      }
    }

    function applyInstallOutcome(outcome, manifest) {
      const permission = !!(outcome && outcome.permissionRequired);
      const opened = !!(outcome && outcome.installerOpened);
      diagnostic.permissionRequired = permission;
      diagnostic.installerOpened = opened;
      if (permission) {
        diagnostic.stage = "permission";
        diagnostic.installResult = "permission";
        diagnostic.failureVisible = false;
        diagnostic.error = "";
        const message = "Android needs permission to install unknown apps before Gameweb can hand over " +
          manifest.version + ". Allow Gameweb in Settings, then return here and tap Updates. The download will not start over.";
        publish();
        notify(message);
        return result(message);
      }
      if (opened) {
        diagnostic.stage = "waiting";
        diagnostic.installResult = "unknown";
        diagnostic.error = "";
        const message = "Android's installer is open for Gameweb " + manifest.version +
          ". This screen cannot tell whether the installation finished. Reopen Gameweb afterward to confirm the version. Nothing is removed if you cancel there.";
        publish();
        notify(message);
        return result(message);
      }
      diagnostic.stage = "failed";
      diagnostic.error = "Android did not open the package installer.";
      diagnostic.failureVisible = true;
      diagnostic.installResult = "not-started";
      publish();
      notify(diagnostic.error);
      return result(diagnostic.error);
    }

    async function presentPrepared() {
      if (!prepared) {
        diagnostic.stage = "failed";
        diagnostic.error = "The downloaded update is no longer on this device. Start the download again.";
        diagnostic.failureVisible = true;
        publish();
        notify(diagnostic.error);
        return result(diagnostic.error);
      }
      diagnostic.stage = "verifying";
      publish();
      try {
        const outcome = await plugin.resumeInstall({
          version: prepared.version,
          prefix: prepared.prefix,
          sha256: prepared.sha256
        });
        return applyInstallOutcome(outcome, { version: prepared.version });
      } catch (err) {
        const message = errorText(err, "The update could not be opened.");
        if (/no longer on this device|checksum/i.test(message)) prepared = null;
        diagnostic.stage = "failed";
        diagnostic.error = message;
        diagnostic.failureVisible = true;
        publish();
        notify(message);
        return result(message);
      }
    }

    async function resume() {
      if (busy) return result("An update check is already in progress.", { busy: true });
      busy = true;
      try {
        return await presentPrepared();
      } finally {
        busy = false;
        publish();
      }
    }

    async function remind() {
      if (busy) return result("", { busy: true });
      if (diagnostic.stage === "waiting" || diagnostic.stage === "permission") {
        try {
          const installed = await plugin.getInstalled();
          const code = Number(installed && installed.versionCode);
          diagnostic.pluginReady = true;
          if (installed) {
            diagnostic.installedVersionName = installed.versionName || diagnostic.installedVersionName;
            if (Number.isInteger(code)) diagnostic.installedVersionCode = code;
            if (installed.canRequestPackageInstalls === false) diagnostic.permissionRequired = true;
            if (installed.canRequestPackageInstalls === true) diagnostic.permissionRequired = false;
          }
          if (diagnostic.selectedVersionCode && Number.isInteger(code) && code >= diagnostic.selectedVersionCode) {
            diagnostic.stage = "no-update";
            diagnostic.newer = false;
            diagnostic.installResult = "installed";
            diagnostic.failureVisible = false;
            diagnostic.error = "";
            prepared = null;
            publish();
            return result("");
          }
        } catch (err) {
          diagnostic.error = errorText(err, "The installed Gameweb version could not be read.");
        }
        publish();
      }
      if (diagnostic.stage === "permission" && prepared) {
        busy = true;
        try {
          const choice = await ask(
            "Gameweb " + prepared.version + " is downloaded. Open Android's installer? If Settings is still asking, allow Gameweb to install unknown apps first."
          );
          if (choice === "decline") {
            storage.set(DISMISS_KEY, prepared.version);
            diagnostic.dismissed = true;
            diagnostic.stage = "cancelled";
            publish();
            return result("");
          }
          if (choice !== "update") {
            publish();
            return result("");
          }
          return await presentPrepared();
        } finally {
          busy = false;
          publish();
        }
      }
      return result("");
    }

    async function check(manual) {
      if (busy) {
        const message = "An update check is already in progress.";
        if (manual) notify(message);
        return result(manual ? message : "", { busy: true, quiet: !manual });
      }
      if (!manual && lastAuto && now() - lastAuto < AUTO_COOLDOWN_MS) {
        return result("", { quiet: true });
      }
      busy = true;
      if (!manual) lastAuto = now();
      diagnostic.stage = "checking";
      diagnostic.error = "";
      diagnostic.failureVisible = false;
      diagnostic.deferred = false;
      publish();
      try {
        let installed = null;
        try {
          installed = await plugin.getInstalled();
          diagnostic.pluginReady = true;
          diagnostic.installedVersionName = installed && installed.versionName ? installed.versionName : "";
          const code = Number(installed && installed.versionCode);
          diagnostic.installedVersionCode = Number.isInteger(code) ? code : null;
          diagnostic.permissionRequired = !!(installed && installed.canRequestPackageInstalls === false);
        } catch (err) {
          diagnostic.pluginReady = false;
          return fail(errorText(err, "The installed Gameweb version could not be read."), manual);
        }
        let releases = null;
        try {
          releases = await readReleases();
          diagnostic.releaseListOk = true;
          diagnostic.releaseCount = releases.length;
        } catch (err) {
          diagnostic.releaseListOk = false;
          diagnostic.releaseCount = null;
          return fail(errorText(err, "GitHub could not be reached. Check the connection and try again."), manual);
        }
        const chosen = selectAndroidRelease(releases);
        if (!chosen) {
          diagnostic.stage = "no-update";
          diagnostic.newer = false;
          diagnostic.selectedTag = "";
          diagnostic.selectedVersion = "";
          diagnostic.selectedVersionCode = null;
          diagnostic.apkName = "";
          diagnostic.checksumFound = false;
          diagnostic.checksumValid = false;
          const message = "The server or version endpoint could not be reached.";
          publish();
          if (manual) notify(message);
          return result(manual ? message : "");
        }
        diagnostic.selectedTag = chosen.tag;
        diagnostic.selectedVersion = chosen.version;
        diagnostic.selectedVersionCode = chosen.versionCode;
        diagnostic.apkName = apkFileName(chosen.version);
        diagnostic.checksumFound = !!chosen.sha256;
        let sha = null;
        try {
          sha = await checksumFor(chosen);
        } catch (err) {
          diagnostic.checksumValid = false;
          return fail(errorText(err, "The update checksum could not be read."), manual);
        }
        if (typeof sha !== "string" || !/^[a-f0-9]{64}$/.test(sha)) {
          diagnostic.checksumFound = false;
          diagnostic.checksumValid = false;
          return fail("The update checksum is invalid.", manual);
        }
        diagnostic.checksumFound = true;
        diagnostic.checksumValid = true;
        const manifest = manifestFromChoice(chosen, sha);
        if (!manifest) return fail("The update metadata contains an unexpected download location.", manual);
        diagnostic.newer = isNewer(diagnostic.installedVersionCode, manifest.versionCode);
        if (!diagnostic.newer) {
          diagnostic.stage = "no-update";
          prepared = null;
          const message = "The current version is the latest available.";
          publish();
          if (manual) notify(message);
          return result(manual ? message : "");
        }
        diagnostic.stage = "available";
        if (matchActive()) {
          diagnostic.deferred = true;
          publish();
          return result("An update is available. The installer will wait until you return to the lobby.");
        }
        diagnostic.deferred = false;
        const dismissed = storage.get(DISMISS_KEY) || "";
        diagnostic.dismissed = dismissed === manifest.version;
        publish();
        if (!manual && diagnostic.dismissed) return result("");
        if (prepared && prepared.version === manifest.version && prepared.sha256 === sha) {
          diagnostic.stage = "confirming";
          publish();
          const choice = await ask(
            "Gameweb " + manifest.version + " is already downloaded. This device has " +
            (diagnostic.installedVersionName || diagnostic.installedVersionCode) +
            ". Open Android's installer?"
          );
          if (choice === "decline") {
            storage.set(DISMISS_KEY, manifest.version);
            diagnostic.dismissed = true;
            diagnostic.stage = "cancelled";
            publish();
            return result("");
          }
          if (choice !== "update") {
            diagnostic.stage = "available";
            publish();
            return result("");
          }
          return await presentPrepared();
        }
        diagnostic.stage = "confirming";
        publish();
        const installedName = diagnostic.installedVersionName || String(diagnostic.installedVersionCode || "unknown");
        const choice = await ask(
          "Gameweb " + manifest.version + " is available. This device has " + installedName +
          ". Download the update and open Android's installer?"
        );
        if (choice === "decline") {
          storage.set(DISMISS_KEY, manifest.version);
          diagnostic.dismissed = true;
          diagnostic.stage = "cancelled";
          publish();
          return result("");
        }
        if (choice !== "update") {
          diagnostic.stage = "available";
          publish();
          return result("");
        }
        return await download(manifest);
      } finally {
        busy = false;
        publish();
      }
    }

    return {
      check: check,
      resume: resume,
      remind: remind,
      getDiagnostic: function () { return cloneDiagnostic(diagnostic); }
    };
  }

  function isAndroidApp() {
    return typeof Capacitor !== "undefined" &&
      Capacitor.isNativePlatform &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform &&
      Capacitor.getPlatform() === "android" &&
      Capacitor.registerPlugin;
  }

  function nativePlugin() {
    return Capacitor.registerPlugin("GamewebUpdate");
  }

  function browserStorage() {
    return {
      get: function (key) {
        try { return window.localStorage.getItem(key) || ""; } catch (err) { return ""; }
      },
      set: function (key, value) {
        try { window.localStorage.setItem(key, value); } catch (err) { /* the next launch can ask again */ }
      }
    };
  }

  function progressView() {
    let node = document.getElementById("gamewebUpdateProgress");
    if (node) return node;
    node = document.createElement("div");
    node.id = "gamewebUpdateProgress";
    node.setAttribute("role", "status");
    node.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:80;padding:14px 16px;border-radius:12px;background:#181c24;color:#f4f1ea;font:16px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    node.textContent = "Downloading the Gameweb update…";
    document.body.appendChild(node);
    return node;
  }

  function hideProgress() {
    const node = document.getElementById("gamewebUpdateProgress");
    if (node) node.remove();
  }

  function notify(message) {
    if (!message) return;
    if (window.AppNotice && typeof window.AppNotice.alert === "function") {
      window.AppNotice.alert(message);
      return;
    }
    console.warn("[GamewebUpdate] " + message);
  }

  async function ask(message) {
    if (window.AppNotice && typeof window.AppNotice.choose === "function") {
      const choice = await window.AppNotice.choose(message, "Update", "Not now");
      if (choice === "update" || choice === "decline") return choice;
      return "interrupted";
    }
    notify(message);
    return "interrupted";
  }

  function ensureDetails(node) {
    if (!node || !isAndroidApp() || document.getElementById("gamewebUpdateDetails")) return;
    const details = document.createElement("button");
    details.type = "button";
    details.id = "gamewebUpdateDetails";
    details.textContent = "Details";
    details.addEventListener("click", () => {
      const current = session ? session.getDiagnostic() : emptyDiagnostic();
      notify(formatDiagnostic(current));
    });
    node.appendChild(details);
  }

  function ensureStatus() {
    let node = document.getElementById("gamewebUpdateStatus");
    if (!node) {
      node = document.createElement("p");
      node.id = "gamewebUpdateStatus";
      node.hidden = true;
      const lobby = document.getElementById("lobbyScreen");
      const title = lobby && lobby.querySelector("h1");
      if (title) title.insertAdjacentElement("afterend", node);
      else if (lobby) lobby.insertBefore(node, lobby.firstChild);
    }
    ensureDetails(node);
    return node;
  }

  function buttonLabel(diagnostic) {
    const stage = diagnostic && diagnostic.stage;
    if (stage === "checking") return "Checking…";
    if (stage === "downloading" || stage === "verifying") return "Downloading…";
    if (diagnostic && diagnostic.failureVisible) return "Check failed";
    if (diagnostic && diagnostic.newer && diagnostic.selectedVersion) return "Update " + diagnostic.selectedVersion;
    return "Check for updates";
  }

  function render(diagnostic) {
    const button = document.getElementById("gamewebCheckUpdate");
    if (button) {
      const busy = diagnostic.stage === "checking" || diagnostic.stage === "downloading" || diagnostic.stage === "verifying";
      button.textContent = buttonLabel(diagnostic);
      button.disabled = !!busy;
      button.setAttribute("aria-busy", busy ? "true" : "false");
    }
    if (!document.getElementById("gamewebUpdateStatus") && !document.getElementById("lobbyScreen")) return;
    const status = ensureStatus();
    const details = document.getElementById("gamewebUpdateDetails");
    const text = statusMessage(diagnostic);
    showDeferredNote(diagnostic.deferred ? text : "");
    const showDetails = diagnosticsReady || diagnostic.failureVisible || diagnostic.newer ||
      diagnostic.stage === "permission" || diagnostic.stage === "waiting" ||
      diagnostic.installResult === "unknown" || diagnostic.installResult === "permission";
    status.hidden = !text && !showDetails;
    const label = status.querySelector("span");
    const span = label || document.createElement("span");
    span.textContent = text ? text + " " : "";
    if (!label) status.insertBefore(span, status.firstChild);
    if (details) details.hidden = !showDetails;
  }

  function ensureSession() {
    if (session) return session;
    session = createSession({
      plugin: nativePlugin(),
      storage: browserStorage(),
      ask: ask,
      notify: notify,
      onDiagnostic: render,
      onProgress: (event) => {
        if (!event || event.clear) {
          hideProgress();
          return;
        }
        const view = progressView();
        const total = Number(event.total) || 0;
        const received = Number(event.received) || 0;
        if (event.stage === "verifying") {
          view.textContent = "Checking Gameweb " + event.version + "…";
          return;
        }
        if (total > 0) {
          view.textContent = "Downloading Gameweb " + event.version + "… " +
            Math.min(100, Math.floor((received / total) * 100)) + "%";
        } else {
          view.textContent = "Downloading Gameweb " + event.version + "… " + Math.floor(received / 1000000) + " MB";
        }
      }
    });
    return session;
  }

  async function check(manual) {
    if (!isAndroidApp()) return;
    const current = ensureSession();
    await current.check(!!manual);
  }

  function bindUpdateButton(button) {
    if (!button || button.dataset.updateBound === "1") return;
    button.dataset.updateBound = "1";
    button.setAttribute("aria-label", "Check for updates");
    button.addEventListener("click", () => {
      diagnosticsReady = true;
      if (session) render(session.getDiagnostic());
      check(true);
    });
  }

  function showDeferredNote(text) {
    if (typeof document === "undefined") return;
    let node = document.getElementById("gamewebUpdateDeferred");
    if (!text) {
      if (node) node.hidden = true;
      return;
    }
    if (!node) {
      node = document.createElement("p");
      node.id = "gamewebUpdateDeferred";
      node.setAttribute("role", "status");
      node.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:70;margin:0;padding:12px 14px;border-radius:12px;background:#181c24;color:#f4f1ea;font:15px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
      document.body.appendChild(node);
    }
    node.hidden = false;
    node.textContent = text;
  }

  function watchLobbyReturn() {
    const lobby = document.getElementById("lobbyScreen");
    if (!lobby || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (lobby.classList.contains("hidden") || matchIsActive()) return;
      if (!session) return;
      const diagnostic = session.getDiagnostic();
      if (!diagnostic.deferred || !diagnostic.newer) return;
      check(true);
    });
    observer.observe(lobby, { attributes: true, attributeFilter: ["class"] });
  }

  function installManualCheck() {
    if (!isAndroidApp() || !document.body) return;
    const webRefresh = document.getElementById("lobbyUpdateAction");
    if (webRefresh) webRefresh.remove();
    const existing = document.getElementById("gamewebCheckUpdate");
    if (existing) {
      bindUpdateButton(existing);
      ensureStatus();
      return;
    }
    const lobby = document.getElementById("lobbyScreen");
    if (!lobby) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "gamewebCheckUpdate";
    button.textContent = "Check for updates";
    bindUpdateButton(button);
    const title = lobby.querySelector("h1");
    if (title) title.insertAdjacentElement("afterend", button);
    else lobby.insertBefore(button, lobby.firstChild);
    ensureStatus();
  }

  function watchForeground() {
    const schedule = () => {
      if (foregroundTimer) clearTimeout(foregroundTimer);
      foregroundTimer = setTimeout(async () => {
        foregroundTimer = null;
        if (!session) {
          check(false);
          return;
        }
        const diagnostic = session.getDiagnostic();
        if (diagnostic.stage === "permission" || diagnostic.stage === "waiting") {
          await session.remind();
          return;
        }
        if (diagnostic.stage === "checking" || diagnostic.stage === "confirming" ||
          diagnostic.stage === "downloading" || diagnostic.stage === "verifying") return;
        check(false);
      }, 400);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") schedule();
    });
    try {
      const app = Capacitor.registerPlugin("App");
      if (app && typeof app.addListener === "function") {
        app.addListener("appStateChange", (state) => {
          if (state && state.isActive) schedule();
        });
      }
    } catch (err) { /* the visibility listener still runs */ }
  }

  function start() {
    if (booted || !isAndroidApp()) return;
    booted = true;
    installManualCheck();
    watchLobbyReturn();
    watchForeground();
    check(false);
  }

  function boot() {
    if (isAndroidApp()) {
      start();
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (isAndroidApp()) {
        clearInterval(timer);
        start();
      } else if (tries >= 20) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  return {
    VERSION_RE: VERSION_RE,
    COMPONENT_LIMIT: COMPONENT_LIMIT,
    versionFromReleaseTag: versionFromReleaseTag,
    versionCodeFromVersion: versionCodeFromVersion,
    apkFileName: apkFileName,
    releaseDownloadUrl: releaseDownloadUrl,
    manifestUrlFor: manifestUrlFor,
    sha256FromDigest: sha256FromDigest,
    selectAndroidRelease: selectAndroidRelease,
    allowedMetadataUrl: allowedMetadataUrl,
    parseManifest: parseManifest,
    isNewer: isNewer,
    sha256Hex: sha256Hex,
    formatDiagnostic: formatDiagnostic,
    buttonLabel: buttonLabel,
    statusMessage: statusMessage,
    createSession: createSession,
    start: start,
    check: check
  };
});
