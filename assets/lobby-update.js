/*
 * Lobby update check for the website and the desktop shell.
 *
 * The running version is the gameweb-version meta tag in the document
 * that actually loaded. The published version is version.json, fetched
 * with cache: "no-store". GitHub Pages stamps both with the deployed
 * commit before upload. A cached page therefore disagrees with a fresh
 * manifest when a newer deploy exists.
 *
 * Android does not use this file. The native updater keeps checksum
 * verification and downloadAndInstall. The desktop preload exposes no
 * IPC, so a packaged Windows app still uses electron-updater at startup.
 * This button reloads the page only when no match screen is open.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GamewebLobbyUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS = {
    checking: "The check is in progress.",
    current: "The current version is the latest available.",
    available: "A newer version exists, and the user should refresh or update the application.",
    unable: "The server or version endpoint could not be reached."
  };

  const MATCH_SCREENS = [
    "gameScreen",
    "placementScreen",
    "dominoScreen",
    "unoScreen",
    "hiddenHunterScreen",
    "cartsScreen"
  ];

  function clean(value) {
    if (typeof value !== "string") return "";
    return value.trim();
  }

  function compareVersions(current, latest) {
    const running = clean(current);
    const published = clean(latest);
    if (!running || !published) return { outcome: "unable" };
    if (running === published) return { outcome: "current", current: running, latest: published };
    return { outcome: "available", current: running, latest: published };
  }

  function interpretCheck(current, body, error) {
    const running = clean(current);
    if (error) {
      return { outcome: "unable", current: running, latest: "", message: STATUS.unable };
    }
    let data = body;
    if (typeof body === "string") {
      try {
        data = JSON.parse(body);
      } catch (err) {
        return { outcome: "unable", current: running, latest: "", message: STATUS.unable };
      }
    }
    if (!data || typeof data !== "object" || typeof data.version !== "string") {
      return { outcome: "unable", current: running, latest: "", message: STATUS.unable };
    }
    const compared = compareVersions(running, data.version);
    if (compared.outcome === "current") {
      return {
        outcome: "current",
        current: compared.current,
        latest: compared.latest,
        message: STATUS.current + " Current version: " + compared.current + "."
      };
    }
    if (compared.outcome === "available") {
      return {
        outcome: "available",
        current: compared.current,
        latest: compared.latest,
        message: STATUS.available + " Current version: " + compared.current + ". Available version: " + compared.latest + "."
      };
    }
    return { outcome: "unable", current: running, latest: clean(data.version), message: STATUS.unable };
  }

  function matchIsActive(doc) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef || typeof documentRef.getElementById !== "function") return false;
    return MATCH_SCREENS.some((id) => {
      const el = documentRef.getElementById(id);
      return !!(el && el.classList && !el.classList.contains("hidden"));
    });
  }

  function isAndroidApp() {
    return typeof Capacitor !== "undefined" &&
      Capacitor.isNativePlatform &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform &&
      Capacitor.getPlatform() === "android";
  }

  function createChecker(options) {
    const fetchImpl = options && options.fetch;
    const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 8000;
    const url = options && options.url ? options.url : "version.json";
    let pending = null;

    async function request(current) {
      if (pending) return pending;
      const run = (async () => {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const joiner = url.indexOf("?") >= 0 ? "&" : "?";
          const response = await fetchImpl(url + joiner + "t=" + Date.now(), {
            cache: "no-store",
            headers: { "cache-control": "no-cache" },
            signal: controller ? controller.signal : undefined
          });
          if (!response || !response.ok) {
            return interpretCheck(current, null, new Error("status"));
          }
          const text = await response.text();
          return interpretCheck(current, text, null);
        } catch (err) {
          return interpretCheck(current, null, err || new Error("network"));
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      pending = run;
      try {
        return await run;
      } finally {
        if (pending === run) pending = null;
      }
    }

    return { request: request };
  }

  function readCurrent(doc) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef || typeof documentRef.querySelector !== "function") return "";
    const meta = documentRef.querySelector('meta[name="gameweb-version"]');
    return meta ? clean(meta.getAttribute("content")) : "";
  }

  function applyUpdate(doc) {
    if (matchIsActive(doc)) {
      return {
        applied: false,
        message: "An update is available. Refresh after you return to the lobby so the match is not interrupted."
      };
    }
    if (typeof location !== "undefined" && location && typeof location.reload === "function") {
      location.reload();
    }
    return { applied: true, message: STATUS.available };
  }

  function setStatus(text) {
    const status = document.getElementById("gamewebUpdateStatus");
    if (!status) return;
    let span = status.querySelector("[data-update-text]");
    if (!span) {
      span = document.createElement("span");
      span.setAttribute("data-update-text", "1");
      status.insertBefore(span, status.firstChild);
    }
    span.textContent = text || "";
    status.hidden = !text;
  }

  function nativeShell() {
    if (isAndroidApp()) return true;
    return typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.classList.contains("gameweb-app");
  }

  function boot() {
    if (nativeShell() || typeof document === "undefined") return;
    const button = document.getElementById("gamewebCheckUpdate");
    if (!button || button.dataset.webUpdateBound === "1") return;
    button.dataset.webUpdateBound = "1";
    const action = document.getElementById("lobbyUpdateAction");
    const checker = createChecker({ fetch: typeof fetch === "function" ? fetch.bind(globalThis) : null, url: "version.json" });
    let last = null;

    async function run() {
      const current = readCurrent(document);
      setStatus(STATUS.checking);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (action) action.classList.add("hidden");
      try {
        if (!checker) {
          setStatus(STATUS.unable);
          return;
        }
        last = await checker.request(current);
        setStatus(last.message);
        if (action) action.classList.toggle("hidden", !last || last.outcome !== "available");
      } finally {
        button.disabled = false;
        button.setAttribute("aria-busy", "false");
      }
    }

    button.addEventListener("click", () => {
      run();
    });
    if (action) {
      action.addEventListener("click", () => {
        const result = applyUpdate(document);
        if (!result.applied) setStatus(result.message);
      });
    }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  return {
    STATUS: STATUS,
    compareVersions: compareVersions,
    interpretCheck: interpretCheck,
    matchIsActive: matchIsActive,
    createChecker: createChecker,
    readCurrent: readCurrent,
    applyUpdate: applyUpdate
  };
});
