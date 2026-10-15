"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const update = require("../assets/android-update");
const noticeApi = require("../assets/ui-notice");

const repoRoot = path.resolve(__dirname, "..");
const DISMISS_KEY = "gameweb-android-update-dismissed";
const HASH = "ab".repeat(32);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memory() {
  const data = {};
  return {
    data,
    get(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : ""; },
    set(key, value) { data[key] = String(value); }
  };
}

function release(version, extra) {
  return Object.assign({
    tag_name: "v" + version,
    draft: false,
    prerelease: false,
    assets: [{ name: "Gameweb-" + version + ".apk", digest: "sha256:" + HASH }]
  }, extra || {});
}

function catalog() {
  return [
    release("1.0.9"),
    release("1.0.10"),
    release("1.0.18"),
    release("1.0.19", { draft: true }),
    release("1.0.20", { prerelease: true })
  ];
}

function fakePlugin(options) {
  const opts = options || {};
  const calls = { fetch: [], download: 0, resume: 0, removed: 0 };
  let onProgress = null;
  const api = {
    calls,
    emitProgress(event) { if (onProgress) onProgress(event); },
    getInstalled: opts.getInstalled || (async () => ({
      versionName: "1.0.10",
      versionCode: update.versionCodeFromVersion("1.0.10"),
      canRequestPackageInstalls: true
    })),
    fetchReleaseText: opts.fetchReleaseText || (async (args) => {
      calls.fetch.push(args);
      if (args.kind === "manifest") {
        return {
          body: JSON.stringify({
            version: args.version,
            versionCode: update.versionCodeFromVersion(args.version),
            apk: "Gameweb-" + args.version + ".apk",
            sha256: HASH
          })
        };
      }
      return { body: JSON.stringify(opts.releases || catalog()) };
    }),
    downloadAndInstall: opts.downloadAndInstall || (async () => {
      calls.download += 1;
      if (onProgress) onProgress({ received: 5, total: 10 });
      return { installerOpened: true, permissionRequired: false, installed: false, result: "unknown" };
    }),
    resumeInstall: opts.resumeInstall || (async () => {
      calls.resume += 1;
      return { installerOpened: true, permissionRequired: false, installed: false, result: "unknown" };
    }),
    addListener: async (_name, cb) => {
      onProgress = cb;
      return { remove: async () => { calls.removed += 1; } };
    }
  };
  return api;
}

function sessionWith(options) {
  const notes = [];
  const progress = [];
  const store = options.storage || memory();
  const plugin = options.plugin || fakePlugin(options.pluginOptions);
  const session = update.createSession({
    plugin,
    storage: store,
    ask: options.ask || (async () => "interrupted"),
    notify: options.notify || ((message) => { notes.push(message); }),
    onProgress: (event) => { progress.push(event); },
    now: options.now
  });
  return { session, plugin, store, notes, progress };
}

function createDom() {
  function makeNode(tag, document) {
    const node = {
      tagName: String(tag || "").toUpperCase(),
      id: "",
      className: "",
      textContent: "",
      type: "",
      children: [],
      style: {},
      disabled: false,
      readOnly: false,
      isConnected: true,
      listeners: {}
    };
    const classes = new Set();
    node.classList = {
      contains: (name) => classes.has(name),
      add: (name) => { classes.add(name); },
      remove: (name) => { classes.delete(name); },
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      }
    };
    node.setAttribute = (key, value) => { node[key] = value; };
    node.appendChild = (child) => {
      child.parentNode = node;
      node.children.push(child);
      return child;
    };
    node.addEventListener = (type, fn) => {
      node.listeners[type] = node.listeners[type] || [];
      node.listeners[type].push(fn);
    };
    node.contains = (other) => {
      if (other === node) return true;
      return node.children.some((child) => (child.contains ? child.contains(other) : child === other));
    };
    node.getBoundingClientRect = () => ({ width: 12, height: 12, top: 0, left: 0 });
    node.focus = () => { document.activeElement = node; };
    node.click = () => {
      (node.listeners.click || []).forEach((fn) => fn({}));
    };
    return node;
  }
  const document = {
    activeElement: null,
    listeners: {},
    createElement(tag) { return makeNode(tag, document); },
    addEventListener(type, fn) {
      document.listeners[type] = document.listeners[type] || [];
      document.listeners[type].push(fn);
    },
    getElementById(id) {
      function walk(node) {
        if (!node) return null;
        if (node.id === id) return node;
        for (const child of node.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      }
      return walk(document.body);
    }
  };
  document.body = makeNode("body", document);
  document.documentElement = makeNode("html", document);
  const window = {
    focus() {},
    requestAnimationFrame(fn) { fn(); return 1; }
  };
  return { document, window };
}

describe("android update discovery", () => {
  it("compares version codes numerically, including 1.0.9, 1.0.10, and 1.0.18", () => {
    const older = update.versionCodeFromVersion("1.0.9");
    const middle = update.versionCodeFromVersion("1.0.10");
    const newer = update.versionCodeFromVersion("1.0.18");
    assert.equal(older, 1000009);
    assert.equal(middle, 1000010);
    assert.equal(newer, 1000018);
    assert.ok(middle > older);
    assert.ok(newer > middle);
    assert.equal("1.0.10" < "1.0.9", true);
    assert.equal(update.isNewer(older, middle), true);
    assert.equal(update.isNewer(middle, newer), true);
    assert.equal(update.isNewer(newer, middle), false);
    assert.equal(update.isNewer(newer, newer), false);
  });

  it("selects the newest stable Android release and skips drafts, prereleases, and missing packages", () => {
    const chosen = update.selectAndroidRelease(catalog());
    assert.equal(chosen.version, "1.0.18");
    assert.equal(chosen.versionCode, 1000018);
    assert.equal(chosen.tag, "v1.0.18");
    assert.equal(chosen.sha256, HASH);
    assert.equal(update.apkFileName(chosen.version), "Gameweb-1.0.18.apk");
    assert.equal(update.selectAndroidRelease([
      { tag_name: "v1.0.18", draft: false, prerelease: false, assets: [{ name: "notes.txt" }] }
    ]), null);
    assert.equal(update.selectAndroidRelease([
      {
        tag_name: "v1.0.18",
        draft: false,
        prerelease: false,
        assets: [{ name: "Gameweb-1.0.18.apk", digest: "sha256:nope" }]
      }
    ]), null);
  });

  it("reads the release list through the native plugin and does not call fetch", async () => {
    let fetched = false;
    global.fetch = () => {
      fetched = true;
      throw new Error("WebView fetch must not run");
    };
    try {
      const { session, plugin } = sessionWith({ ask: async () => "interrupted" });
      const outcome = await session.check(true);
      assert.equal(fetched, false);
      assert.equal(plugin.calls.fetch.length, 1);
      assert.deepEqual(plugin.calls.fetch[0], { kind: "releases", version: "", prefix: "v" });
      assert.equal(outcome.diagnostic.pluginReady, true);
      assert.equal(outcome.diagnostic.releaseListOk, true);
      assert.equal(outcome.diagnostic.releaseCount, catalog().length);
      assert.equal(outcome.diagnostic.selectedTag, "v1.0.18");
      assert.equal(outcome.diagnostic.apkName, "Gameweb-1.0.18.apk");
      assert.equal(outcome.diagnostic.newer, true);
      assert.equal(outcome.diagnostic.checksumFound, true);
      assert.equal(outcome.diagnostic.stage, "available");
      assert.equal(plugin.calls.download, 0);
    } finally {
      delete global.fetch;
    }
    const script = fs.readFileSync(path.join(repoRoot, "assets/android-update.js"), "utf8");
    assert.equal(/\bfetch\s*\(/.test(script), false);
  });

  it("reports a plugin that cannot read the installed version", async () => {
    const { session, store, notes } = sessionWith({
      plugin: fakePlugin({
        getInstalled: async () => { throw new Error("The installed Gameweb version could not be read."); }
      })
    });
    const outcome = await session.check(true);
    assert.equal(outcome.diagnostic.pluginReady, false);
    assert.equal(outcome.diagnostic.stage, "failed");
    assert.match(outcome.diagnostic.error, /could not be read/);
    assert.equal(outcome.diagnostic.failureVisible, true);
    assert.equal(update.buttonLabel(outcome.diagnostic), "Check failed");
    assert.equal(store.get(DISMISS_KEY), "");
    assert.equal(notes.length, 1);
  });

  it("keeps an automatic release-list failure visible without dismissing the version", async () => {
    const rate = sessionWith({
      plugin: fakePlugin({
        fetchReleaseText: async () => { throw new Error("GitHub rate limit. Try the update again later."); }
      })
    });
    const limited = await rate.session.check(false);
    assert.equal(limited.diagnostic.releaseListOk, false);
    assert.equal(limited.diagnostic.stage, "failed");
    assert.match(limited.diagnostic.error, /rate limit/);
    assert.equal(limited.diagnostic.failureVisible, true);
    assert.equal(limited.quiet, true);
    assert.equal(rate.notes.length, 0);
    assert.equal(rate.store.get(DISMISS_KEY), "");
    assert.equal(update.buttonLabel(limited.diagnostic), "Check failed");

    const offline = sessionWith({
      plugin: fakePlugin({
        fetchReleaseText: async () => { throw new Error("GitHub could not be reached. Check the connection and try again."); }
      })
    });
    const failed = await offline.session.check(true);
    assert.match(failed.diagnostic.error, /could not be reached/);
    assert.equal(failed.diagnostic.failureVisible, true);
    assert.equal(offline.notes.length, 1);
    assert.equal(offline.store.get(DISMISS_KEY), "");
  });

  it("fails closed when checksum metadata is missing or invalid", async () => {
    const missing = sessionWith({
      plugin: fakePlugin({
        releases: [{ tag_name: "v1.0.18", draft: false, prerelease: false, assets: [{ name: "Gameweb-1.0.18.apk" }] }]
      })
    });
    const none = await missing.session.check(true);
    assert.equal(none.diagnostic.stage, "no-update");
    assert.equal(missing.store.get(DISMISS_KEY), "");
    assert.equal(missing.plugin.calls.download, 0);

    const broken = sessionWith({
      plugin: fakePlugin({
        releases: [{
          tag_name: "v1.0.18",
          draft: false,
          prerelease: false,
          assets: [{ name: "Gameweb-1.0.18.apk" }, { name: "android-latest.json" }]
        }],
        fetchReleaseText: async (args) => {
          broken.plugin.calls.fetch.push(args);
          if (args.kind === "manifest") return { body: "{" };
          return { body: JSON.stringify([{
            tag_name: "v1.0.18",
            draft: false,
            prerelease: false,
            assets: [{ name: "Gameweb-1.0.18.apk" }, { name: "android-latest.json" }]
          }]) };
        }
      })
    });
    const invalid = await broken.session.check(true);
    assert.equal(invalid.diagnostic.stage, "failed");
    assert.match(invalid.diagnostic.error, /not valid JSON|checksum/i);
    assert.equal(invalid.diagnostic.checksumValid, false);
    assert.equal(broken.store.get(DISMISS_KEY), "");
    assert.equal(broken.plugin.calls.fetch.some((args) => args.kind === "manifest"), true);
  });
});

describe("android update prompt", () => {
  it("stores a dismissal only when the user explicitly declines", async () => {
    const declined = sessionWith({ ask: async () => "decline" });
    const no = await declined.session.check(true);
    assert.equal(no.diagnostic.stage, "cancelled");
    assert.equal(no.diagnostic.dismissed, true);
    assert.equal(declined.store.get(DISMISS_KEY), "1.0.18");
    assert.equal(declined.plugin.calls.download, 0);

    const interrupted = sessionWith({ ask: async () => "interrupted" });
    const held = await interrupted.session.check(true);
    assert.equal(held.diagnostic.stage, "available");
    assert.equal(held.diagnostic.dismissed, false);
    assert.equal(interrupted.store.get(DISMISS_KEY), "");
    assert.equal(interrupted.plugin.calls.download, 0);
  });

  it("lets a manual check ask again after an automatic check honored a dismissal", async () => {
    let clock = 1_000_000;
    let asks = 0;
    const { session, plugin, store } = sessionWith({
      now: () => clock,
      ask: async () => {
        asks += 1;
        return "decline";
      }
    });
    await session.check(true);
    assert.equal(store.get(DISMISS_KEY), "1.0.18");
    asks = 0;
    const quiet = await session.check(false);
    assert.equal(asks, 0);
    assert.equal(quiet.diagnostic.dismissed, true);
    assert.equal(quiet.diagnostic.newer, true);
    assert.equal(plugin.calls.download, 0);
    clock += 1_000;
    const manual = await session.check(true);
    assert.equal(asks, 1);
    assert.equal(manual.diagnostic.stage, "cancelled");
    clock += 1_000;
    const cooled = await session.check(false);
    assert.equal(cooled.quiet, true);
    assert.equal(plugin.calls.fetch.length, 3);
  });

  it("shows both versions in the confirmation and in the diagnostic text", async () => {
    let prompt = "";
    const { session } = sessionWith({
      ask: async (message) => {
        prompt = message;
        return "interrupted";
      }
    });
    const outcome = await session.check(true);
    assert.match(prompt, /1\.0\.18/);
    assert.match(prompt, /1\.0\.10/);
    const text = update.formatDiagnostic(outcome.diagnostic);
    assert.match(text, /Installed version: 1\.0\.10 \(1000010\)/);
    assert.match(text, /Updater plugin: ready/);
    assert.match(text, /Release list: received/);
    assert.match(text, /Releases returned: 5/);
    assert.match(text, /Selected release: v1\.0\.18/);
    assert.match(text, /Expected APK: Gameweb-1\.0\.18\.apk/);
    assert.match(text, /Newer than installed: yes/);
    assert.match(text, /Checksum: found in the release/);
    assert.match(text, /Stage: available/);
    assert.equal(text.includes(HASH), false);
    assert.equal(update.buttonLabel(outcome.diagnostic), "Update 1.0.18");
  });
});

describe("android update download and installer handoff", () => {
  it("reports progress, then a checksum mismatch, and cleans the listener without dismissing", async () => {
    const plug = fakePlugin({
      downloadAndInstall: async () => {
        plug.calls.download += 1;
        plug.emitProgress({ received: 40, total: 100 });
        plug.emitProgress({ received: 100, total: 100 });
        throw new Error("The downloaded update did not match the published checksum.");
      }
    });
    const { session, store, progress, notes } = sessionWith({
      plugin: plug,
      ask: async () => "update"
    });
    const outcome = await session.check(true);
    assert.equal(plug.calls.download, 1);
    assert.equal(plug.calls.removed, 1);
    assert.equal(outcome.diagnostic.stage, "failed");
    assert.equal(outcome.diagnostic.checksumValid, "mismatched");
    assert.equal(outcome.diagnostic.failureVisible, true);
    assert.equal(store.get(DISMISS_KEY), "");
    assert.ok(progress.some((event) => event.received === 40 && event.total === 100));
    assert.ok(progress.some((event) => event.stage === "verifying"));
    assert.deepEqual(progress[progress.length - 1], { clear: true });
    assert.equal(notes.length, 1);
    assert.equal(update.buttonLabel(outcome.diagnostic), "Check failed");
  });

  it("rejects the wrong package, an older version code, and a different certificate without dismissing", async () => {
    const messages = [
      "The update is for a different application and was not installed.",
      "The downloaded package is not a newer version of Gameweb.",
      "The update is signed with a different certificate than this installation. Android will not replace Gameweb with it, and this updater will not uninstall the app."
    ];
    for (const message of messages) {
      const plug = fakePlugin({
        downloadAndInstall: async () => {
          plug.calls.download += 1;
          throw new Error(message);
        }
      });
      const { session, store, progress } = sessionWith({
        plugin: plug,
        ask: async () => "update"
      });
      const outcome = await session.check(true);
      assert.equal(outcome.diagnostic.stage, "failed");
      assert.equal(outcome.diagnostic.error, message);
      assert.equal(store.get(DISMISS_KEY), "");
      assert.equal(plug.calls.removed, 1);
      assert.deepEqual(progress[progress.length - 1], { clear: true });
    }
  });

  it("keeps a verified download when Android requires install permission and resumes it later", async () => {
    const plug = fakePlugin({
      downloadAndInstall: async () => {
        plug.calls.download += 1;
        return { installerOpened: false, permissionRequired: true, installed: false, result: "permission" };
      },
      resumeInstall: async () => {
        plug.calls.resume += 1;
        return { installerOpened: true, permissionRequired: false, installed: false, result: "unknown" };
      }
    });
    let prompts = 0;
    const { session, store, notes } = sessionWith({
      plugin: plug,
      ask: async () => {
        prompts += 1;
        return prompts === 1 ? "update" : "update";
      }
    });
    const waiting = await session.check(true);
    assert.equal(waiting.diagnostic.stage, "permission");
    assert.equal(waiting.diagnostic.installResult, "permission");
    assert.equal(waiting.diagnostic.permissionRequired, true);
    assert.equal(store.get(DISMISS_KEY), "");
    assert.match(notes[0], /will not start over/);
    assert.match(update.formatDiagnostic(waiting.diagnostic), /permission to install unknown apps/);

    const opened = await session.resume();
    assert.equal(plug.calls.download, 1);
    assert.equal(plug.calls.resume, 1);
    assert.equal(opened.diagnostic.installResult, "unknown");
    assert.equal(opened.diagnostic.installerOpened, true);
    assert.doesNotMatch(opened.message, /success|now installed|update complete/i);
    assert.match(opened.message, /cannot tell whether the installation finished/);
  });

  it("asks to resume after Settings and recognizes a completed install without downloading again", async () => {
    let canInstall = false;
    const plug = fakePlugin({
      getInstalled: async () => ({
        versionName: "1.0.10",
        versionCode: update.versionCodeFromVersion("1.0.10"),
        canRequestPackageInstalls: canInstall
      }),
      downloadAndInstall: async () => {
        plug.calls.download += 1;
        return { installerOpened: false, permissionRequired: true, installed: false, result: "permission" };
      }
    });
    let prompts = 0;
    const { session } = sessionWith({
      plugin: plug,
      ask: async () => {
        prompts += 1;
        return "update";
      }
    });
    await session.check(true);
    canInstall = true;
    const reminder = await session.remind();
    assert.equal(prompts, 2);
    assert.equal(plug.calls.resume, 1);
    assert.equal(plug.calls.download, 1);
    assert.equal(reminder.diagnostic.installResult, "unknown");

    const donePlugin = fakePlugin({
      getInstalled: async () => ({
        versionName: "1.0.10",
        versionCode: update.versionCodeFromVersion("1.0.10"),
        canRequestPackageInstalls: true
      }),
      downloadAndInstall: async () => {
        donePlugin.calls.download += 1;
        return { installerOpened: false, permissionRequired: true, installed: false, result: "permission" };
      }
    });
    const done = sessionWith({
      plugin: donePlugin,
      ask: async () => "update"
    });
    await done.session.check(true);
    donePlugin.getInstalled = async () => ({
      versionName: "1.0.18",
      versionCode: update.versionCodeFromVersion("1.0.18"),
      canRequestPackageInstalls: true
    });
    const after = await done.session.remind();
    assert.equal(after.diagnostic.installResult, "installed");
    assert.equal(after.diagnostic.stage, "no-update");
    assert.equal(donePlugin.calls.download, 1);
    assert.equal(donePlugin.calls.resume, 0);
  });

  it("does not claim success when the installer opens and the result is unknown", async () => {
    const { session } = sessionWith({ ask: async () => "update" });
    const outcome = await session.check(true);
    assert.equal(outcome.diagnostic.stage, "waiting");
    assert.equal(outcome.diagnostic.installResult, "unknown");
    assert.equal(outcome.diagnostic.installerOpened, true);
    assert.equal(outcome.diagnostic.failureVisible, false);
    assert.match(outcome.message, /cannot tell whether the installation finished/);
    assert.doesNotMatch(outcome.message, /success|now installed|update complete|has been installed/i);
    const text = update.formatDiagnostic(outcome.diagnostic);
    assert.match(text, /Installation result is unknown/);
    assert.equal(text.includes(HASH), false);
  });

  it("blocks a second check during discovery and during download", async () => {
    const gate = deferred();
    let fetches = 0;
    const plug = fakePlugin({
      fetchReleaseText: async (args) => {
        fetches += 1;
        plug.calls.fetch.push(args);
        await gate.promise;
        return { body: JSON.stringify(catalog()) };
      }
    });
    const { session, notes } = sessionWith({ plugin: plug, ask: async () => "interrupted" });
    const first = session.check(true);
    for (let i = 0; i < 10 && fetches === 0; i += 1) await Promise.resolve();
    const second = await session.check(true);
    assert.equal(second.busy, true);
    assert.match(second.message, /already in progress/);
    assert.equal(fetches, 1);
    assert.equal(notes.length, 1);
    gate.resolve();
    await first;

    const downloadGate = deferred();
    const downloading = fakePlugin({
      downloadAndInstall: () => {
        downloading.calls.download += 1;
        return downloadGate.promise;
      }
    });
    const active = sessionWith({ plugin: downloading, ask: async () => "update" });
    const running = active.session.check(true);
    for (let i = 0; i < 12 && downloading.calls.download === 0; i += 1) await Promise.resolve();
    const overlap = await active.session.check(true);
    assert.equal(overlap.busy, true);
    assert.equal(downloading.calls.download, 1);
    downloadGate.resolve({ installerOpened: true, permissionRequired: false, installed: false, result: "unknown" });
    const finished = await running;
    assert.equal(finished.diagnostic.installResult, "unknown");
    assert.equal(downloading.calls.removed, 1);
    assert.deepEqual(active.progress[active.progress.length - 1], { clear: true });
  });

  it("leaves a declined update downloaded only in the sense that no partial work is kept as accepted", async () => {
    const { session, plugin, store, progress } = sessionWith({ ask: async () => "decline" });
    const outcome = await session.check(true);
    assert.equal(outcome.diagnostic.stage, "cancelled");
    assert.equal(plugin.calls.download, 0);
    assert.equal(plugin.calls.removed, 0);
    assert.equal(progress.length, 0);
    assert.equal(store.get(DISMISS_KEY), "1.0.18");
  });
});

describe("update notices", () => {
  it("keeps an open confirmation when another notice arrives, and declines only from Not now", async () => {
    const dom = createDom();
    const notice = noticeApi.createNotice(dom.document, dom.window);
    const first = notice.confirm("Leave this table?");
    notice.alert("The connection dropped.");
    assert.equal(notice.pending(), 2);
    let settled = false;
    first.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(dom.document.getElementById("appNoticeText").textContent, "Leave this table?");
    dom.document.getElementById("appNoticeOk").click();
    assert.equal(await first, true);
    await Promise.resolve();
    assert.equal(dom.document.getElementById("appNoticeText").textContent, "The connection dropped.");
    dom.document.getElementById("appNoticeOk").click();
    await Promise.resolve();

    const choice = notice.choose("Gameweb 1.0.18 is available.", "Update", "Not now");
    notice.alert("Another notice");
    assert.equal(notice.pending(), 2);
    let choiceSettled = false;
    choice.then(() => { choiceSettled = true; });
    await Promise.resolve();
    assert.equal(choiceSettled, false);
    const escape = dom.document.listeners.keydown[0];
    escape({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    await Promise.resolve();
    assert.equal(choiceSettled, false);
    dom.document.getElementById("appNoticeCancel").click();
    assert.equal(await choice, "decline");
  });

  it("treats a dialog that cannot be shown as interrupted, not as a decline", async () => {
    const dom = createDom();
    dom.document.body = null;
    const notice = noticeApi.createNotice(dom.document, dom.window);
    assert.equal(await notice.choose("Update now?", "Update", "Not now"), "interrupted");
    const store = memory();
    const { session } = sessionWith({
      storage: store,
      ask: async () => "interrupted"
    });
    const outcome = await session.check(true);
    assert.equal(outcome.diagnostic.stage, "available");
    assert.equal(store.get(DISMISS_KEY), "");
  });

  it("uses the queued update dialog for an explicit decline and ignores a notice opened over it", async () => {
    const dom = createDom();
    const notice = noticeApi.createNotice(dom.document, dom.window);
    const seen = deferred();
    const { session, store } = sessionWith({
      ask: async (message) => {
        seen.resolve(message);
        const choice = await notice.choose(message, "Update", "Not now");
        if (choice === "update" || choice === "decline") return choice;
        return "interrupted";
      }
    });
    const pending = session.check(true);
    const message = await seen.promise;
    assert.match(message, /1\.0\.18/);
    assert.match(message, /1\.0\.10/);
    notice.alert("Lobby error");
    assert.equal(notice.pending(), 2);
    let finished = false;
    pending.then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(store.get(DISMISS_KEY), "");
    dom.document.getElementById("appNoticeCancel").click();
    const outcome = await pending;
    assert.equal(outcome.diagnostic.stage, "cancelled");
    assert.equal(store.get(DISMISS_KEY), "1.0.18");
  });
});

describe("native updater source contract", () => {
  it("keeps HTTPS redirect checks, partial downloads, permission resume, and log tags", () => {
    const plugin = fs.readFileSync(
      path.join(repoRoot, "mobile/android/app/src/main/java/com/imhiamou/gameweb/GamewebUpdatePlugin.java"),
      "utf8"
    );
    assert.match(plugin, /TAG = "GamewebUpdate"/);
    assert.match(plugin, /https:\/\/api\.github\.com\/repos\/imhiamou\/Card\/releases\?per_page=100/);
    assert.match(plugin, /setInstanceFollowRedirects\(false\)/);
    assert.match(plugin, /objects\.githubusercontent\.com/);
    assert.match(plugin, /release-assets\.githubusercontent\.com/);
    assert.match(plugin, /github-releases\.githubusercontent\.com/);
    assert.match(plugin, /X-RateLimit-Remaining/);
    assert.match(plugin, /GitHub refused the /);
    assert.match(plugin, /GitHub rate limit/);
    assert.match(plugin, /\.apk\.partial/);
    assert.match(plugin, /renameTo/);
    assert.match(plugin, /deleteQuietly\(partial\)/);
    assert.match(plugin, /resumeInstall/);
    assert.match(plugin, /permissionRequired/);
    assert.match(plugin, /result", "unknown"/);
    assert.match(plugin, /FLAG_GRANT_READ_URI_PERMISSION/);
    assert.match(plugin, /PACKAGE_NAME = "com\.imhiamou\.gameweb"/);
    assert.match(plugin, /different application/);
    assert.match(plugin, /not a newer version/);
    assert.match(plugin, /different certificate/);
    assert.equal(plugin.includes("call.getString(\"url\""), false);
    assert.equal(plugin.includes("started"), false);
  });
});
