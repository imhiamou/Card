/*
 * Android update check for the Gameweb Capacitor app.
 *
 * The website and the Windows app load this file and do nothing.
 * On Android, launch asks the native plugin for GitHub's release list.
 * The WebView cannot read release assets: that host sends no CORS header.
 * The plugin downloads android-latest.json and the APK itself.
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
  const DISMISS_KEY = "gameweb-android-update-dismissed";
  let checking = false;

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

  function selectAndroidRelease(releases) {
    if (!Array.isArray(releases)) return null;
    let best = null;
    releases.forEach((release) => {
      if (!release || typeof release !== "object") return;
      if (release.draft || release.prerelease) return;
      const parts = tagParts(release.tag_name);
      if (!parts) return;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const names = assets.map((asset) => asset && asset.name);
      if (names.indexOf(apkFileName(parts.version)) < 0) return;
      if (names.indexOf("android-latest.json") < 0) return;
      if (!best || parts.versionCode > best.versionCode) {
        best = {
          prefix: parts.prefix,
          version: parts.version,
          versionCode: parts.versionCode,
          tag: parts.prefix + parts.version
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

  function errorText(err, fallback) {
    if (err && typeof err.message === "string" && err.message) return err.message;
    return fallback;
  }

  async function discover() {
    const listed = await plugin().fetchReleaseText({ kind: "releases", version: "", prefix: "v" });
    const text = listed && listed.body ? listed.body : "";
    let releases = null;
    try {
      releases = JSON.parse(text);
    } catch (err) {
      return { manifest: null, error: "The update list is not valid JSON." };
    }
    const chosen = selectAndroidRelease(releases);
    if (!chosen) return { manifest: null, error: null };
    const loaded = await plugin().fetchReleaseText({
      kind: "manifest",
      version: chosen.version,
      prefix: chosen.prefix
    });
    const parsed = parseManifest(loaded && loaded.body ? loaded.body : "");
    if (!parsed.ok) return { manifest: null, error: parsed.error };
    if (parsed.manifest.version !== chosen.version || parsed.manifest.versionCode !== chosen.versionCode) {
      return { manifest: null, error: "The update metadata does not match the published release." };
    }
    if (manifestUrlFor(chosen.prefix, chosen.version) == null) {
      return { manifest: null, error: "The update metadata contains an unexpected download location." };
    }
    parsed.manifest.prefix = chosen.prefix;
    return { manifest: parsed.manifest, error: null };
  }

  async function offer(manifest, installed, manual) {
    if (!isNewer(installed.versionCode, manifest.versionCode)) return;
    let dismissed = "";
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) || "";
    } catch (err) {
      dismissed = "";
    }
    if (!manual && dismissed === manifest.version) return;
    if (!window.AppNotice || typeof window.AppNotice.confirm !== "function") {
      notify("Gameweb " + manifest.version + " is available.");
      return;
    }
    const installedName = installed.versionName || String(installed.versionCode || "unknown");
    const accepted = await window.AppNotice.confirm(
      "Gameweb " + manifest.version + " is available. This device has " + installedName +
      ". Download the update and open Android's installer?"
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
        view.textContent = "Downloading Gameweb " + manifest.version + "… " + Math.min(100, Math.floor((received / total) * 100)) + "%";
      } else {
        view.textContent = "Downloading Gameweb " + manifest.version + "… " + Math.floor(received / 1000000) + " MB";
      }
    });
    try {
      await plugin().downloadAndInstall({
        version: manifest.version,
        prefix: manifest.prefix === "V" ? "V" : "v",
        sha256: manifest.sha256
      });
      hideProgress();
      notify("Android is opening the package installer. Confirm the installation there. The first time, Android may ask you to allow Gameweb to install updates.");
    } catch (err) {
      hideProgress();
      notify(errorText(err, "The update could not be downloaded."));
    } finally {
      if (handle && typeof handle.remove === "function") {
        try { await handle.remove(); } catch (err) { /* listener cleanup is optional */ }
      }
    }
  }

  async function check(manual) {
    if (!isAndroidApp()) return;
    if (checking) {
      if (manual) notify("An update check is already in progress.");
      return;
    }
    checking = true;
    try {
      const installed = await plugin().getInstalled();
      const found = await discover();
      if (found.error) {
        if (manual) notify(found.error);
        else console.warn("[gameweb-update] " + found.error);
        return;
      }
      if (!found.manifest) {
        if (manual) notify("No published Android release was found.");
        return;
      }
      const current = installed || {};
      if (!isNewer(current.versionCode, found.manifest.versionCode)) {
        if (manual) {
          notify("Gameweb " + (current.versionName || found.manifest.version) + " is up to date.");
        }
        return;
      }
      await offer(found.manifest, current, !!manual);
    } catch (err) {
      const message = errorText(err, "The update check failed.");
      if (manual) notify(message);
      else console.warn("[gameweb-update] " + message);
    } finally {
      checking = false;
    }
  }

  function installManualCheck() {
    if (!isAndroidApp() || !document.body) return;
    if (document.getElementById("gamewebCheckUpdate")) return;
    const lobby = document.getElementById("lobbyScreen");
    if (!lobby) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "gamewebCheckUpdate";
    button.textContent = "Updates";
    button.addEventListener("click", () => { check(true); });
    const title = lobby.querySelector("h1");
    if (title) title.insertAdjacentElement("afterend", button);
    else lobby.insertBefore(button, lobby.firstChild);
  }

  function start() {
    if (!isAndroidApp()) return;
    installManualCheck();
    check(false);
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  return {
    VERSION_RE: VERSION_RE,
    COMPONENT_LIMIT: COMPONENT_LIMIT,
    versionFromReleaseTag: versionFromReleaseTag,
    versionCodeFromVersion: versionCodeFromVersion,
    apkFileName: apkFileName,
    releaseDownloadUrl: releaseDownloadUrl,
    manifestUrlFor: manifestUrlFor,
    selectAndroidRelease: selectAndroidRelease,
    allowedMetadataUrl: allowedMetadataUrl,
    parseManifest: parseManifest,
    isNewer: isNewer,
    sha256Hex: sha256Hex,
    start: start,
    check: check
  };
});
