/* Android shell. Runs only after Capacitor marks html.gameweb-app.
   The website and Electron never enter this file. */
(function () {
  if (!document.documentElement.classList.contains("gameweb-app")) return;

  const $ = (id) => document.getElementById(id);
  const SCROLLERS = ".domInspect, #domInspectBody, .domInspectNav, .hheLibScroll, .ceLibScroll, .ceGrid, .cePick, .ceCarts, .ceLibPreview, .ceLibCats, .hheProps, .ceRight, .ceDialog, #lobbyPlay, #lobbyUpdates, .lobbySetupCard, input, textarea, select";

  function syncViewport() {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-height", Math.round(height) + "px");
  }

  syncViewport();
  window.addEventListener("resize", syncViewport);
  window.addEventListener("orientationchange", syncViewport);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewport);

  let scrollableTouch = false;
  document.addEventListener("touchstart", (event) => {
    const target = event.target;
    scrollableTouch = !!(target && target.closest && target.closest(SCROLLERS));
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (scrollableTouch) return;
    event.preventDefault();
  }, { passive: false });

  const lobby = $("lobbyScreen");
  if (lobby) buildLobby(lobby);
  installMapPager();
  installHuntChrome();
  installEndToggle();
  installLogPager();
  watchMenus();
  watchPlayState();
  watchEditors();

  function shortName(value, fallback) {
    const names = {
      "hidden-hunt": "Hunt",
      dominoes: "Dominoes",
      uno: "UNO",
      "hidden-hunter": "Hunter",
      carts: "Carts"
    };
    return names[value] || fallback;
  }

  function setTab(name) {
    if (!lobby) return;
    lobby.dataset.appTab = name;
    lobby.querySelectorAll(".appTabBar button").forEach((btn) => {
      const on = btn.dataset.appTab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function syncRoomTeams() {
    if (!lobby) return;
    const teams = $("dominoLobbyTeams");
    lobby.dataset.roomTeams = teams && !teams.classList.contains("hidden") ? "1" : "0";
  }

  function buildLobby(root) {
    const title = root.querySelector("h1");
    if (title) title.textContent = "Gameweb";
    if (title && !root.querySelector(".appBuildStamp")) {
      const versionMeta = document.querySelector('meta[name="gameweb-version"]');
      const commitMeta = document.querySelector('meta[name="gameweb-build-commit"]');
      const version = versionMeta && versionMeta.content ? versionMeta.content : "unknown";
      const commit = commitMeta && commitMeta.content ? commitMeta.content.slice(0, 7) : "unstamped";
      const buildStamp = document.createElement("p");
      buildStamp.className = "appBuildStamp";
      buildStamp.textContent = "APK v" + version + " · commit " + commit;
      buildStamp.setAttribute("aria-label", "Installed Android APK version " + version + ", source commit " + commit);
      title.insertAdjacentElement("afterend", buildStamp);
    }
    root.dataset.appTab = "play";
    const select = $("gameSelect");
    if (select && !root.querySelector(".appGameGrid")) {
      const grid = document.createElement("div");
      grid.className = "appGameGrid";
      grid.setAttribute("role", "listbox");
      grid.setAttribute("aria-label", "Game");
      Array.from(select.options).forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "appGameBtn" + (opt.selected ? " active" : "");
        btn.dataset.value = opt.value;
        btn.textContent = shortName(opt.value, opt.textContent);
        btn.setAttribute("aria-selected", opt.selected ? "true" : "false");
        btn.addEventListener("click", () => {
          select.value = opt.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          grid.querySelectorAll("button").forEach((item) => {
            const on = item === btn;
            item.classList.toggle("active", on);
            item.setAttribute("aria-selected", on ? "true" : "false");
          });
        });
        grid.appendChild(btn);
      });
      select.insertAdjacentElement("afterend", grid);
      select.classList.add("appNativeSelect");
      select.addEventListener("change", () => {
        grid.querySelectorAll("button").forEach((item) => {
          const on = item.dataset.value === select.value;
          item.classList.toggle("active", on);
          item.setAttribute("aria-selected", on ? "true" : "false");
        });
      });
    }

    if (!root.querySelector(".appTabBar")) {
      const nav = document.createElement("nav");
      nav.className = "appTabBar";
      nav.setAttribute("aria-label", "Lobby");
      [["play", "Play"], ["updates", "Updates"]].forEach(([id, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.appTab = id;
        btn.textContent = label;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", id === "play" ? "true" : "false");
        if (id === "play") btn.classList.add("active");
        btn.addEventListener("click", () => setTab(id));
        nav.appendChild(btn);
      });
      root.appendChild(nav);
    }

    const teams = $("dominoLobbyTeams");
    if (teams) new MutationObserver(syncRoomTeams).observe(teams, { attributes: true, attributeFilter: ["class"] });
    syncRoomTeams();
  }

  function installMapPager() {
    const box = $("hhMapChoices");
    if (!box || $("hhMapPager")) return;
    const bar = document.createElement("div");
    bar.id = "hhMapPager";
    bar.className = "appPager";
    bar.hidden = true;
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    const label = document.createElement("span");
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    bar.append(prev, label, next);
    box.insertAdjacentElement("afterend", bar);
    let page = 0;
    const size = 6;
    function apply() {
      const buttons = Array.from(box.children);
      const pages = Math.max(1, Math.ceil(buttons.length / size));
      const selected = buttons.findIndex((btn) => btn.classList.contains("selected"));
      if (selected >= 0 && box.dataset.pinned !== "1") page = Math.floor(selected / size);
      if (page > pages - 1) page = pages - 1;
      if (page < 0) page = 0;
      buttons.forEach((btn, index) => {
        const hide = buttons.length > size && (index < page * size || index >= page * size + size);
        btn.classList.toggle("app-map-off", hide);
      });
      label.textContent = (page + 1) + " / " + pages;
      prev.disabled = page <= 0;
      next.disabled = page >= pages - 1;
      bar.hidden = buttons.length <= size;
    }
    prev.addEventListener("click", () => {
      box.dataset.pinned = "1";
      page -= 1;
      apply();
    });
    next.addEventListener("click", () => {
      box.dataset.pinned = "1";
      page += 1;
      apply();
    });
    new MutationObserver(apply).observe(box, { childList: true, attributes: true, subtree: true, attributeFilter: ["class"] });
    apply();
  }

  function wireMenu(button, screen) {
    if (!button || !screen || button.dataset.appWired) return;
    button.dataset.appWired = "1";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const open = screen.classList.toggle("app-menu-open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function installHuntChrome() {
    const game = $("gameScreen");
    if (game && !$("huntMenuBtn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "huntMenuBtn";
      btn.className = "appOnly appMenuBtn";
      btn.textContent = "Menu";
      const left = game.querySelector(".gameLeft") || game;
      left.insertBefore(btn, left.firstChild);
    }
    wireMenu($("huntMenuBtn"), game);
    wireMenu($("cartsMenuBtn"), $("cartsScreen"));
  }

  function watchMenus() {
    ["dominoScreen", "unoScreen", "hiddenHunterScreen"].forEach((id) => {
      const screen = $(id);
      if (!screen) return;
      const bind = () => {
        const button = screen.querySelector(".domMenuBtn, .unoMenuBtn, .hhMenuBtn");
        wireMenu(button, screen);
      };
      bind();
      new MutationObserver(bind).observe(screen, { childList: true });
    });
  }

  function playing() {
    return ["placementScreen", "gameScreen", "dominoScreen", "unoScreen", "hiddenHunterScreen", "hhEditorScreen", "cartsEditorScreen", "cartsScreen"].some((id) => {
      const el = $(id);
      return el && !el.classList.contains("hidden");
    });
  }

  function watchPlayState() {
    const apply = () => document.documentElement.classList.toggle("app-playing", playing());
    apply();
    ["placementScreen", "gameScreen", "dominoScreen", "unoScreen", "hiddenHunterScreen", "hhEditorScreen", "cartsEditorScreen", "cartsScreen"].forEach((id) => {
      const el = $(id);
      if (el) new MutationObserver(apply).observe(el, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function installEndToggle() {
    const box = $("endgameReveal");
    if (!box || box.dataset.appToggle) return;
    box.dataset.appToggle = "1";
    box.dataset.endView = "mine";
    const bar = document.createElement("div");
    bar.className = "appEndToggle";
    [["mine", "Your map"], ["theirs", "Opponent"]].forEach(([id, text]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.dataset.end = id;
      if (id === "mine") btn.classList.add("active");
      btn.addEventListener("click", () => {
        box.dataset.endView = id;
        bar.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === btn));
      });
      bar.appendChild(btn);
    });
    const heading = box.querySelector("h3");
    if (heading) heading.insertAdjacentElement("afterend", bar);
    else box.insertBefore(bar, box.firstChild);
  }

  function installLogPager() {
    const log = $("gameLog");
    if (!log || log.dataset.paged) return;
    log.dataset.paged = "1";
    const bar = document.createElement("div");
    bar.className = "appPager";
    bar.hidden = true;
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    const label = document.createElement("span");
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    bar.append(prev, label, next);
    log.insertAdjacentElement("afterend", bar);
    let page = 0;
    let stick = true;
    const size = 6;
    function apply() {
      const rows = Array.from(log.children);
      const pages = Math.max(1, Math.ceil(rows.length / size));
      if (stick) page = pages - 1;
      if (page > pages - 1) page = pages - 1;
      if (page < 0) page = 0;
      rows.forEach((row, index) => {
        row.classList.toggle("app-page-off", index < page * size || index >= page * size + size);
      });
      label.textContent = rows.length ? ((page + 1) + " / " + pages) : "1 / 1";
      prev.disabled = page <= 0;
      next.disabled = page >= pages - 1;
      bar.hidden = rows.length <= size;
    }
    prev.addEventListener("click", () => { stick = false; page -= 1; apply(); });
    next.addEventListener("click", () => { stick = page + 1 >= Math.ceil(log.children.length / size) - 1; page += 1; apply(); });
    new MutationObserver(apply).observe(log, { childList: true });
    apply();
  }

  function installHandPager(hand) {
    if (!hand || hand.dataset.paged) return;
    hand.dataset.paged = "1";
    const bar = document.createElement("div");
    bar.className = "appPager";
    bar.hidden = true;
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    const label = document.createElement("span");
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    bar.append(prev, label, next);
    hand.insertAdjacentElement("beforebegin", bar);
    let page = 0;
    function size() {
      const row = hand.closest(".actionRow") || hand;
      const width = row.clientWidth || window.innerWidth;
      const across = window.innerWidth > window.innerHeight ? Math.max(2, Math.floor((row.clientHeight || 160) / 72)) : Math.max(2, Math.floor((width - 72) / 60));
      return across;
    }
    function apply() {
      const cards = Array.from(hand.querySelectorAll(".card"));
      const pageSize = size();
      const pages = Math.max(1, Math.ceil(cards.length / pageSize));
      const selected = cards.findIndex((card) => card.classList.contains("selected"));
      if (selected >= 0 && hand.dataset.pinned !== "1") page = Math.floor(selected / pageSize);
      if (page > pages - 1) page = pages - 1;
      if (page < 0) page = 0;
      cards.forEach((card, index) => {
        card.classList.toggle("app-page-off", cards.length > pageSize && (index < page * pageSize || index >= page * pageSize + pageSize));
      });
      label.textContent = (page + 1) + " / " + pages + " · " + cards.length;
      prev.disabled = page <= 0;
      next.disabled = page >= pages - 1;
      bar.hidden = cards.length <= pageSize;
    }
    prev.addEventListener("click", () => { hand.dataset.pinned = "1"; page -= 1; apply(); });
    next.addEventListener("click", () => { hand.dataset.pinned = "1"; page += 1; apply(); });
    new MutationObserver(apply).observe(hand, { childList: true, attributes: true, subtree: true, attributeFilter: ["class"] });
    window.addEventListener("resize", apply);
    apply();
  }

  function editorTabs(screen, id, tabs) {
    if (!screen || screen.querySelector("#" + id)) return;
    const nav = document.createElement("div");
    nav.id = id;
    nav.className = "appEditorTabs";
    nav.setAttribute("role", "tablist");
    tabs.forEach((tab, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tab[1];
      btn.dataset.editorTab = tab[0];
      if (index === 0) btn.classList.add("active");
      btn.addEventListener("click", () => {
        screen.dataset.editorTab = tab[0];
        nav.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === btn));
      });
      nav.appendChild(btn);
    });
    if (!screen.dataset.editorTab) screen.dataset.editorTab = tabs[0][0];
    screen.appendChild(nav);
  }

  function watchEditors() {
    const hh = $("hhEditorScreen");
    const carts = $("cartsEditorScreen");
    const mount = () => {
      editorTabs(hh, "hhEditorTabs", [["map", "Map"], ["assets", "Assets"], ["props", "Properties"], ["settings", "Map settings"]]);
      editorTabs(carts, "ceEditorTabs", [["map", "Map"], ["tools", "Tools"], ["settings", "Settings"]]);
    };
    mount();
    [hh, carts].forEach((screen) => {
      if (screen) new MutationObserver(mount).observe(screen, { childList: true });
    });
    const hand = $("hand");
    if (hand) installHandPager(hand);
  }
})();
