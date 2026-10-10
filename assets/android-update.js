/*
 * Android update check for the Gameweb Capacitor app.
 *
 * The website and the Windows app load this file and do nothing.
 * On Android, launch compares the installed versionCode with
 * android-latest.json on the latest published GitHub Release.
 * The download URL is built from the version. Metadata cannot
 * point the download at an arbitrary host.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GamewebAndroidUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const COMPONENT_LIMIT = 1000;
  const MANIFEST_URL = "https://github.com/imhiamou/Card/releases/latest/download/android-latest.json";
  const DISMISS_KEY = "gameweb-android-update-dismissed";
  let started = false;

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

  function isAndroidApp() {
    return typeof Capacitor !== "undefined" &&
      Capacitor.isNativePlatform &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform &&
      Capacitor.getPlatform() === "android" &&
      Capacitor.registerPlugin;
  }

  function plugin() {
    return Capacitor.registerPlugin("GamewebUpdate");
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
    if (window.AppNotice && typeof window.AppNotice.alert === "function") {
      window.AppNotice.alert(message);
      return;
    }
    console.warn("[gameweb-update] " + message);
  }

  async function fetchManifest() {
    const response = await fetch(MANIFEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      console.warn("[gameweb-update] GitHub rate limit or access denied (" + response.status + ").");
      return null;
    }
    if (!response.ok) {
      console.warn("[gameweb-update] metadata request failed (" + response.status + ").");
      return null;
    }
    if (response.url && !allowedMetadataUrl(response.url)) {
      console.warn("[gameweb-update] metadata redirected to an unexpected host.");
      return null;
    }
    const parsed = parseManifest(await response.text());
    if (!parsed.ok) {
      console.warn("[gameweb-update] " + parsed.error);
      return null;
    }
    return parsed.manifest;
  }

  async function offer(manifest, installed) {
    if (!isNewer(installed.versionCode, manifest.versionCode)) return;
    let dismissed = "";
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) || "";
    } catch (err) {
      dismissed = "";
    }
    if (dismissed === manifest.version) return;
    if (!window.AppNotice || typeof window.AppNotice.confirm !== "function") return;
    const accepted = await window.AppNotice.confirm(
      "Gameweb " + manifest.version + " is available. Download the update and open Android's installer?"
    );
    if (!accepted) {
      try {
        window.localStorage.setItem(DISMISS_KEY, manifest.version);
      } catch (err) { /* the next launch can ask again */ }
      return;
    }
    const view = progressView();
    const handle = await plugin().addListener("progress", (event) => {
      const received = Number(event && event.received) || 0;
      const total = Number(event && event.total) || 0;
      if (total > 0) {
        view.textContent = "Downloading the Gameweb update… " + Math.min(100, Math.floor((received / total) * 100)) + "%";
      } else {
        view.textContent = "Downloading the Gameweb update… " + Math.floor(received / 1000000) + " MB";
      }
    });
    try {
      await plugin().downloadAndInstall({
        version: manifest.version,
        sha256: manifest.sha256
      });
      hideProgress();
      notify("Android is opening the package installer. Confirm the installation there. The first time, Android may ask you to allow Gameweb to install updates.");
    } catch (err) {
      hideProgress();
      const message = err && err.message ? err.message : "The update could not be downloaded.";
      notify(message);
    } finally {
      if (handle && typeof handle.remove === "function") {
        try { await handle.remove(); } catch (err) { /* listener cleanup is optional */ }
      }
    }
  }

  async function start() {
    if (started || !isAndroidApp()) return;
    started = true;
    try {
      const installed = await plugin().getInstalled();
      const manifest = await fetchManifest();
      if (!manifest) return;
      await offer(manifest, installed || {});
    } catch (err) {
      console.warn("[gameweb-update] check skipped");
    }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  return {
    VERSION_RE: VERSION_RE,
    COMPONENT_LIMIT: COMPONENT_LIMIT,
    MANIFEST_URL: MANIFEST_URL,
    versionFromReleaseTag: versionFromReleaseTag,
    versionCodeFromVersion: versionCodeFromVersion,
    apkFileName: apkFileName,
    releaseDownloadUrl: releaseDownloadUrl,
    allowedMetadataUrl: allowedMetadataUrl,
    parseManifest: parseManifest,
    isNewer: isNewer,
    sha256Hex: sha256Hex,
    start: start
  };
});
