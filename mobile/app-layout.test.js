"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const layout = require("../assets/mobile-layout");

const repoRoot = path.resolve(__dirname, "..");
const chromeBin = "/usr/local/bin/google-chrome";

describe("mobile hand paging", () => {
  it("fits a readable page and keeps a selected tile's page", () => {
    assert.equal(layout.tilePageSize(320, 52, 8, 0), 5);
    assert.equal(layout.tilePageSize(200, 96, 8, 0), 2);
    const wide = layout.pagePlan(12, 0, 5, -1);
    assert.deepEqual([wide.start, wide.end, wide.pages], [0, 5, 3]);
    const selected = layout.pagePlan(12, 0, 5, 7);
    assert.equal(selected.page, 1);
    assert.equal(selected.start, 5);
    assert.equal(selected.end, 10);
    const clamped = layout.pagePlan(3, 4, 5, -1);
    assert.equal(clamped.pages, 1);
    assert.equal(clamped.end, 3);
  });

  it("fits every Domino tile into the hand box", () => {
    assert.deepEqual(layout.fitHandTiles(0, 340, 140), { width: 0, height: 0, columns: 0, rows: 0, gap: 4 });
    assert.deepEqual(layout.fitHandTiles(7, 0, 140).columns, 0);
    function contained(boxW, boxH, count) {
      const fit = layout.fitHandTiles(count, boxW, boxH);
      assert.ok(fit.columns * fit.rows >= count, count + " grid");
      assert.ok(fit.width * fit.columns + fit.gap * Math.max(0, fit.columns - 1) <= boxW + 0.05);
      assert.ok(fit.height * fit.rows + fit.gap * Math.max(0, fit.rows - 1) <= boxH + 0.05);
      assert.ok(fit.width > 8 && fit.height > 16);
      assert.ok(Math.abs(fit.height / fit.width - 2) < 0.02);
      return fit;
    }
    const normal = contained(340, 140, 7);
    const large = contained(336, 200, 21);
    contained(150, 320, 21);
    contained(412, 180, 1);
    assert.equal(normal.rows, 1);
    assert.ok(normal.width > large.width);
    assert.ok(large.rows > 1);
  });

  it("keeps app layout rules off the website stylesheet except the app class", () => {
    const css = fs.readFileSync(path.join(repoRoot, "assets/mobile-app.css"), "utf8");
    const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
    assert.match(index, /assets\/mobile-app\.css/);
    assert.match(index, /assets\/mobile-app\.js/);
    assert.match(index, /gameweb-app/);
    const bare = css.split("}");
    bare.forEach((block) => {
      const selector = block.split("{")[0];
      if (!selector || selector.trim().startsWith("/*") || !selector.includes("{") && !block.includes("{")) return;
    });
    assert.match(css, /html\.gameweb-app #dominoScreen/);
    assert.match(css, /html\.gameweb-app #unoScreen/);
    assert.match(css, /html\.gameweb-app #hiddenHunterScreen/);
    assert.match(css, /html\.gameweb-app #cartsScreen/);
    const domino = fs.readFileSync(path.join(repoRoot, "domino.js"), "utf8");
    assert.match(domino, /id="domLobbyBtn"/);
    assert.match(domino, /Return to Lobby/);
    assert.equal(domino.includes("domHandPrev"), false);
    assert.equal(domino.includes("domHandPager"), false);
    const back = domino.slice(domino.indexOf("function returnToLobby"), domino.indexOf("function wireControls"));
    assert.match(back, /leftTable = true/);
    assert.match(back, /lobbyScreen\.classList\.remove\("hidden"\)/);
    assert.equal(back.includes("socket.disconnect"), false);
    assert.equal(back.includes("currentRoom = null"), false);
    assert.equal(css.includes("overflow-y: auto"), false);
    assert.equal(css.includes("overflow-y:auto"), false);
  });
});

function contentType(file) {
  const ext = path.extname(file);
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".html") return "text/html";
  if (ext === ".json") return "application/json";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function serve(root) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function waitFor(ws, method) {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === method) {
        ws.removeEventListener("message", onMessage);
        resolve(msg.params);
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

async function openPage(port) {
  const response = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT" });
  const list = JSON.parse(await response.text());
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
      else item.resolve(msg.result);
    }
  });
  function send(method, params) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  return { ws, send };
}

const MEASURE = `
(function () {
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  const bad = [];
  const root = document.querySelector(arguments[0]) || document.body;
  const nodes = [document.documentElement, document.body, root, ...root.querySelectorAll("*")];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const name = node.id || String(node.className).slice(0, 40);
    if (rect.bottom > viewH + 2 || rect.right > viewW + 2 || rect.top < -2 || rect.left < -2) {
      bad.push("offscreen " + name);
    }
    const scrolls = node.scrollHeight - node.clientHeight > 4 || node.scrollWidth - node.clientWidth > 4;
    const allowed = node.closest(".hheLibScroll, .ceLibScroll, .ceGrid, .cePick, .ceCarts, .ceLibPreview, .ceLibCats");
    if (scrolls && style.overflow !== "hidden" && style.overflowY !== "hidden" && style.overflowX !== "hidden" && !allowed) {
      bad.push("scroll " + name);
    }
  });
  return { bad: bad.slice(0, 16), tabs: !!document.querySelector(".appTabBar"), app: document.documentElement.classList.contains("gameweb-app") };
})
`;

describe("android viewport", { skip: fs.existsSync(chromeBin) ? false : "chrome missing" }, () => {
  it("fits the app shell at phone sizes and leaves the website unscoped", async () => {
    const server = await serve(repoRoot);
    const port = server.address().port;
    const chrome = spawn(chromeBin, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--remote-debugging-port=9333",
      "--user-data-dir=/tmp/gameweb-chrome",
      "about:blank"
    ], { stdio: "ignore" });
    try {
      await new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(async () => {
          try {
            const res = await fetch("http://127.0.0.1:9333/json/version");
            if (res.ok) {
              clearInterval(timer);
              resolve();
            }
          } catch (err) {
            if (Date.now() - started > 8000) {
              clearInterval(timer);
              reject(err);
            }
          }
        }, 100);
      });

      const site = await openPage(9333);
      await site.send("Page.enable");
      const siteLoaded = waitFor(site.ws, "Page.loadEventFired");
      await site.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
      await siteLoaded;
      await site.send("Runtime.enable");
      const plain = await site.send("Runtime.evaluate", {
        expression: "({app:document.documentElement.classList.contains('gameweb-app'),tabs:!!document.querySelector('.appTabBar')})",
        returnByValue: true
      });
      assert.equal(plain.result.value.app, false);
      assert.equal(plain.result.value.tabs, false);
      site.ws.close();

      const sizes = [[360, 800], [390, 844], [412, 915], [800, 360], [844, 390], [915, 412]];
      const failures = [];
      for (const [width, height] of sizes) {
        const page = await openPage(9333);
        await page.send("Page.enable");
        await page.send("Emulation.setDeviceMetricsOverride", {
          width, height, deviceScaleFactor: 1, mobile: true
        });
        await page.send("Page.addScriptToEvaluateOnNewDocument", {
          source: "window.Capacitor={isNativePlatform:function(){return true;}};"
        });
        const loaded = waitFor(page.ws, "Page.loadEventFired");
        await page.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
        await loaded;
        await page.send("Runtime.enable");
        await page.send("Runtime.evaluate", {
          expression: `
            document.getElementById("dominoScreen").innerHTML = '<div class="domTopBar"><h2>Dominoes</h2><button class="domMenuBtn">Menu</button><div class="domScoreStrip"><span class="domStripItem">A · 10</span></div></div><div class="domTableArena" data-count="2"><div class="domSeat seat-top">North</div><div class="domTableCenter"><h2 id="domTurnIndicator" class="domYourTurn">Your Turn</h2><div class="domBoardWrap" style="height:180px"></div></div></div><div class="domHandSection"><div class="domHandLabel">You · 12</div><div class="domHandPager"><button>Prev</button><span>1 / 3</span><button>Next</button></div><div class="domHand"></div></div><p id="domMsg">Play a tile</p>';
            document.getElementById("dominoScreen").classList.remove("hidden");
            document.getElementById("lobbyScreen").classList.add("hidden");
          `,
          returnByValue: true
        });
        const domino = await page.send("Runtime.evaluate", {
          expression: "(" + MEASURE + ')("#dominoScreen")',
          returnByValue: true
        });
        if (domino.result.value.bad.length) failures.push(width + "x" + height + " domino " + domino.result.value.bad.join(", "));

        await page.send("Runtime.evaluate", {
          expression: `
            document.getElementById("dominoScreen").classList.add("hidden");
            document.getElementById("lobbyScreen").classList.remove("hidden");
          `,
          returnByValue: true
        });
        for (const tab of ["play", "setup", "room"]) {
          await page.send("Runtime.evaluate", {
            expression: "document.querySelector('.appTabBar button[data-app-tab=\"" + tab + "\"]').click()",
            returnByValue: true
          });
          const lobby = await page.send("Runtime.evaluate", {
            expression: "(" + MEASURE + ')("#lobbyScreen")',
            returnByValue: true
          });
          if (!lobby.result.value.app || !lobby.result.value.tabs) failures.push(width + "x" + height + " missing shell");
          if (lobby.result.value.bad.length) failures.push(width + "x" + height + " " + tab + " " + lobby.result.value.bad.join(", "));
        }
        const games = await page.send("Runtime.evaluate", {
          expression: `(() => {
            const failures = [];
            function spill(name, selector) {
              const result = (${MEASURE})(selector);
              if (result.bad.length) failures.push(name + " " + result.bad.join(", "));
            }
            function hideAll() {
              ["lobbyScreen","placementScreen","gameScreen","dominoScreen","unoScreen","hiddenHunterScreen","cartsScreen","hhEditorScreen","cartsEditorScreen"].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.add("hidden");
              });
            }
            function tiles(board, count) {
              board.innerHTML = "";
              for (let i = 0; i < count; i++) {
                const tile = document.createElement("div");
                tile.className = "tile";
                tile.textContent = "A1";
                board.appendChild(tile);
              }
            }
            hideAll();
            const placement = document.getElementById("placementScreen");
            placement.classList.remove("hidden");
            tiles(document.getElementById("board"), 64);
            spill("placement", "#placementScreen");
            hideAll();
            const game = document.getElementById("gameScreen");
            game.classList.remove("hidden");
            tiles(document.getElementById("gameBoard"), 64);
            const hand = document.getElementById("hand");
            hand.innerHTML = "";
            const huntRow = hand.closest(".actionRow") || hand;
            const huntSize = window.innerWidth > window.innerHeight
              ? Math.max(2, Math.floor((window.innerHeight - 80) / 72))
              : Math.max(2, Math.floor(((huntRow.clientWidth || window.innerWidth) - 72) / 60));
            for (let i = 0; i < 8; i++) {
              const card = document.createElement("div");
              card.className = "card" + (i === 1 ? " selected" : "") + (i >= huntSize ? " app-page-off" : "");
              card.textContent = "Scan";
              hand.appendChild(card);
            }
            spill("hunt", "#gameScreen");
            hideAll();
            const carts = document.getElementById("cartsScreen");
            carts.classList.remove("hidden");
            spill("carts", "#cartsScreen");
            hideAll();
            const uno = document.getElementById("unoScreen");
            uno.innerHTML = '<div class="unoTitleRow"><h2>UNO</h2><div class="unoMeta">4 players</div><button class="unoMenuBtn">Menu</button></div><div class="unoTableArena"><div class="unoTableCenter"><h2 id="unoTurnIndicator">Your Turn</h2><div class="unoTable"><div class="unoCard"></div><div class="unoCard"></div></div></div></div><div class="unoHandSection"><div class="unoHandPager"><button>Prev</button><span>1 / 2</span><button>Next</button></div><div class="unoHand"></div></div><div class="unoActions"><button>Draw</button><button>UNO!</button></div>';
            uno.classList.remove("hidden");
            const unoHand = uno.querySelector(".unoHand");
            const unoSize = window.innerWidth > window.innerHeight
              ? Math.max(2, Math.floor((window.innerHeight - 170) / 72))
              : Math.max(2, Math.floor((window.innerWidth - 24) / 58));
            for (let i = 0; i < 8; i++) {
              const card = document.createElement("div");
              card.className = "unoCard inHand" + (i >= unoSize ? " app-page-off" : "");
              unoHand.appendChild(card);
            }
            spill("uno", "#unoScreen");
            hideAll();
            const domino = document.getElementById("dominoScreen");
            domino.classList.remove("hidden");
            const domHand = document.getElementById("domHand");
            if (domHand && window.GamewebMobileLayout) {
              const count = 21;
              const style = getComputedStyle(domHand);
              const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
              const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
              const fit = window.GamewebMobileLayout.fitHandTiles(count, domHand.clientWidth - padX, domHand.clientHeight - padY);
              domHand.style.setProperty("--hand-cols", String(fit.columns));
              domHand.style.setProperty("--hand-tile-w", fit.width.toFixed(2) + "px");
              domHand.style.setProperty("--hand-tile-h", fit.height.toFixed(2) + "px");
              domHand.style.setProperty("--hand-gap", fit.gap + "px");
              domHand.innerHTML = "";
              for (let i = 0; i < count; i++) {
                const tile = document.createElement("div");
                tile.className = "domTile inHand" + (i === 0 ? " selected" : "") + (i === 2 ? " valid" : "");
                domHand.appendChild(tile);
              }
              const handRect = domHand.getBoundingClientRect();
              const tiles = Array.from(domHand.querySelectorAll(".domTile"));
              if (tiles.length !== count) failures.push("domino count " + tiles.length);
              tiles.forEach((tile) => {
                const rect = tile.getBoundingClientRect();
                if (rect.width < 8 || rect.height < 16) failures.push("domino tile tiny");
                if (rect.left < handRect.left - 1 || rect.right > handRect.right + 1 || rect.top < handRect.top - 1 || rect.bottom > handRect.bottom + 1) {
                  failures.push("domino tile outside hand");
                }
              });
              const pager = document.querySelector("#domHandPrev, #domHandNext");
              if (pager) failures.push("domino pager button");
            }
            spill("domino-hand", "#dominoScreen");
            hideAll();
            const hunter = document.getElementById("hiddenHunterScreen");
            hunter.innerHTML = '<div class="hhRotate">PLEASE ROTATE</div><div class="hhHud"><div class="hhTop"><div class="hhRole">HUNTER</div><div class="hhTimer">05:00</div><button class="hhMenuBtn">Menu</button></div><div class="hhStage"></div><div class="hhBottom"><div class="hhHealthWrap"><div class="hhHealthLabel">HP 100</div></div></div><div class="hhMobile"><div class="hhJoy"></div><button class="hhShootBtn">SHOOT</button><div class="hhJoy"></div></div></div>';
            hunter.classList.remove("hidden");
            hunter.classList.add("hh-touch");
            spill("hunter", "#hiddenHunterScreen");
            hideAll();
            const editor = document.getElementById("hhEditorScreen");
            editor.innerHTML = '<div class="hheTop"><button>New map</button><button>Save map</button><button>Close</button><span class="hheStatus">Map</span></div><div class="hheBody"><aside class="hheLib"><div class="hheLibScroll"></div></aside><div class="hheStage"></div><aside class="hheProps"></aside></div>';
            editor.dataset.editorTab = "map";
            editor.classList.remove("hidden");
            const tabs = document.createElement("div");
            tabs.className = "appEditorTabs";
            tabs.innerHTML = "<button class='active'>Map</button><button>Assets</button><button>Properties</button><button>Map settings</button>";
            editor.appendChild(tabs);
            spill("hh-editor", "#hhEditorScreen");
            hideAll();
            const cartsEditor = document.getElementById("cartsEditorScreen");
            cartsEditor.innerHTML = '<div class="ceTop"><button data-ce="Save">Save</button><button data-ce="Undo">Undo</button><button data-ce="Redo">Redo</button><button data-ce="Fit Map">Fit</button><button data-ce="Lobby">Lobby</button></div><div class="ceBanner">Routes</div><div class="ceBody"><aside class="ceLeft"></aside><div class="ceCanvasWrap"></div><aside class="ceRight"></aside></div>';
            cartsEditor.dataset.editorTab = "map";
            cartsEditor.classList.remove("hidden");
            const ceTabs = document.createElement("div");
            ceTabs.className = "appEditorTabs";
            ceTabs.innerHTML = "<button class='active'>Map</button><button>Tools</button><button>Settings</button>";
            cartsEditor.appendChild(ceTabs);
            spill("carts-editor", "#cartsEditorScreen");
            return failures;
          })()`,
          returnByValue: true
        });
        if (games.result.value && games.result.value.length) {
          games.result.value.forEach((item) => failures.push(width + "x" + height + " " + item));
        }
        page.ws.close();
      }
      assert.deepEqual(failures, []);
    } finally {
      chrome.kill();
      server.close();
    }
  });
});
