/* Dodge Ball — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="dbTitleRow">' +
      "<h2>Dodge Ball</h2>" +
      '<button type="button" id="dbFullscreenBtn" class="dbFullscreenBtn">FULLSCREEN</button>' +
    "</div>" +
    '<div class="dbHud">' +
      '<div class="dbPlayerHud p1" id="dbHudP1"></div>' +
      '<div class="dbCooldown ready" id="dbCooldown">READY</div>' +
      '<div class="dbPlayerHud p2" id="dbHudP2"></div>' +
    "</div>" +
    '<div class="dbArenaWrap">' +
      '<div class="dbArena" id="dbArena">' +
        '<div class="dbCenterLine"></div>' +
        '<div class="dbMoveTarget" id="dbMoveTarget"></div>' +
        '<div class="dbCountdown" id="dbCountdown"></div>' +
        '<div class="dbWinner" id="dbWinner"></div>' +
      "</div>" +
    "</div>" +
    '<div class="dbMobileControls" id="dbMobileControls">' +
      '<div class="dbJoystick dbJoyMove" id="dbJoyMove" aria-label="Move">' +
        '<div class="dbJoystickKnob" id="dbJoyMoveKnob"></div>' +
        '<span class="dbJoyLabel">MOVE</span>' +
      "</div>" +
      '<div class="dbJoystick dbJoyAim" id="dbJoyAim" aria-label="Aim and throw">' +
        '<div class="dbJoystickKnob" id="dbJoyAimKnob"></div>' +
        '<span class="dbJoyLabel">AIM</span>' +
      "</div>" +
    "</div>" +
    '<p class="dbDesktopHint" id="dbDesktopHint">Click/hold to move · mouse aims · Space throws</p>' +
    '<p id="dbMsg"></p>' +
    '<div id="dbEndButtons" class="dbEndButtons hidden">' +
      '<button type="button" id="dbPlayAgainBtn">Play Again</button>' +
    "</div>" +
    '<div class="dbRotateGate" id="dbRotateGate" aria-live="polite">' +
      "<p>Please rotate your phone to landscape.</p>" +
    "</div>";

  const ASSET = {
    p1: {
      idle: [1, 2, 3, 4].map((i) => "assets/dodge-ball/p1/idle_" + i + ".png"),
      move: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => "assets/dodge-ball/p1/move_" + i + ".png")
    },
    p2: {
      idle: [1, 2, 3, 4].map((i) => "assets/dodge-ball/p2/idle_" + i + ".png"),
      move: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => "assets/dodge-ball/p2/move_" + i + ".png")
    },
    hit: [1, 2, 3, 4, 5, 6, 7].map((i) => "assets/dodge-ball/fx/hit_" + i + ".png")
  };

  const AIM_DEADZONE = 0.22;
  const ARRIVE_DIST = 10;
  const PLAYER_R = 28;

  let socket = null;
  let currentRoom = null;
  let myId = null;
  let myIndex = 1;
  let mySide = "left";
  let active = false;
  let gameOver = false;
  let arena = { w: 800, h: 450, centerX: 400 };
  let players = [];
  let projectiles = [];
  let cooldownMs = 3000;
  let maxHp = 100;
  let serverNowOffset = 0;
  let phase = "countdown";
  let touchMode = false;

  let aimVec = { x: 1, y: 0 };
  let moveJoy = { x: 0, y: 0 };
  let moveTarget = null; // PC click-to-move destination in arena coords
  let mouseHeld = false;
  let spaceHeld = false;
  let inputTimer = null;
  let animTimer = null;
  let animFrame = 0;
  let controlsWired = false;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let unoScreen;
  let dodgeBallScreen;
  let dbArena;
  let dbCountdown;
  let dbWinner;
  let dbCooldown;
  let dbHudP1;
  let dbHudP2;
  let dbMsg;
  let dbEndButtons;
  let dbPlayAgainBtn;
  let dbJoyMove;
  let dbJoyMoveKnob;
  let dbJoyAim;
  let dbJoyAimKnob;
  let dbFullscreenBtn;
  let dbMoveTarget;
  let dbRotateGate;

  const charEls = Object.create(null);
  const ballEls = Object.create(null);

  function $(id) {
    return document.getElementById(id);
  }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    codeBreakerScreen = $("codeBreakerScreen");
    dominoScreen = $("dominoScreen");
    unoScreen = $("unoScreen");
    dodgeBallScreen = $("dodgeBallScreen");
    if (!dodgeBallScreen) return false;
    if (!dodgeBallScreen.dataset.ready) {
      dodgeBallScreen.innerHTML = SCREEN_HTML;
      dodgeBallScreen.dataset.ready = "1";
    }
    dbArena = $("dbArena");
    dbCountdown = $("dbCountdown");
    dbWinner = $("dbWinner");
    dbCooldown = $("dbCooldown");
    dbHudP1 = $("dbHudP1");
    dbHudP2 = $("dbHudP2");
    dbMsg = $("dbMsg");
    dbEndButtons = $("dbEndButtons");
    dbPlayAgainBtn = $("dbPlayAgainBtn");
    dbJoyMove = $("dbJoyMove");
    dbJoyMoveKnob = $("dbJoyMoveKnob");
    dbJoyAim = $("dbJoyAim");
    dbJoyAimKnob = $("dbJoyAimKnob");
    dbFullscreenBtn = $("dbFullscreenBtn");
    dbMoveTarget = $("dbMoveTarget");
    dbRotateGate = $("dbRotateGate");
    return true;
  }

  function now() {
    return Date.now() + serverNowOffset;
  }

  /**
   * Touch-first phones/tablets → mobile dual-stick UI.
   * Fine pointer (mouse) available → desktop click-to-move (even on touchscreen laptops).
   */
  function preferTouchControls() {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const canHover = window.matchMedia("(hover: hover)").matches;
    const touchPoints = navigator.maxTouchPoints || 0;

    if (fine && canHover) return false;
    if (coarse && !fine) return true;
    if (touchPoints > 0 && !canHover) return true;
    if (touchPoints > 0 && !fine && window.matchMedia("(max-width: 1024px)").matches) {
      return true;
    }
    return false;
  }

  function isPortrait() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  function updateModeClasses() {
    if (!dodgeBallScreen) return;
    touchMode = preferTouchControls();
    dodgeBallScreen.classList.toggle("db-touch", touchMode);
    dodgeBallScreen.classList.toggle("db-desktop", !touchMode);
    dodgeBallScreen.classList.toggle("db-portrait", touchMode && isPortrait());
    dodgeBallScreen.classList.toggle("db-landscape", touchMode && !isPortrait());
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    dodgeBallScreen.classList.toggle("db-fs", fs && document.fullscreenElement === dodgeBallScreen);
    if (dbFullscreenBtn) {
      dbFullscreenBtn.textContent = fs ? "EXIT FULLSCREEN" : "FULLSCREEN";
    }
  }

  function setPlayingScrollLock(on) {
    document.body.classList.toggle("db-playing", !!on);
  }

  function hideEndButtons() {
    if (!dbEndButtons) return;
    dbEndButtons.classList.add("hidden");
    if (dbPlayAgainBtn) {
      dbPlayAgainBtn.disabled = false;
      dbPlayAgainBtn.textContent = "Play Again";
    }
  }

  function showEndButtons() {
    if (!dbEndButtons) return;
    hideEndButtons();
    dbEndButtons.classList.remove("hidden");
  }

  function showDodgeBallScreen() {
    active = true;
    [
      lobbyScreen,
      placementScreen,
      gameScreen,
      wordChainScreen,
      codeBreakerScreen,
      dominoScreen,
      unoScreen
    ].forEach((el) => {
      if (el) el.classList.add("hidden");
    });
    dodgeBallScreen.classList.remove("hidden");
    setPlayingScrollLock(true);
    updateModeClasses();
  }

  function hideDodgeBallScreen() {
    active = false;
    stopLoops();
    setPlayingScrollLock(false);
    moveTarget = null;
    mouseHeld = false;
    moveJoy = { x: 0, y: 0 };
    if (dodgeBallScreen) {
      dodgeBallScreen.classList.add("hidden");
      dodgeBallScreen.classList.remove("db-touch", "db-desktop", "db-portrait", "db-landscape", "db-fs");
    }
    exitFullscreenQuiet();
  }

  function stopLoops() {
    if (inputTimer) {
      clearInterval(inputTimer);
      inputTimer = null;
    }
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  function arenaRect() {
    return dbArena.getBoundingClientRect();
  }

  function clientToArena(clientX, clientY) {
    const r = arenaRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * arena.w;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * arena.h;
    return { x: x, y: y };
  }

  function clampToMyHalf(pt) {
    const centerX = arena.centerX || arena.w / 2;
    let x = pt.x;
    let y = pt.y;
    y = Math.max(PLAYER_R, Math.min(arena.h - PLAYER_R, y));
    if (mySide === "left") {
      x = Math.max(PLAYER_R, Math.min(centerX - PLAYER_R, x));
    } else {
      x = Math.max(centerX + PLAYER_R, Math.min(arena.w - PLAYER_R, x));
    }
    return { x: x, y: y };
  }

  function setAimFromClient(clientX, clientY) {
    const me = players.find((p) => p.id === myId);
    if (!me) return;
    const pt = clientToArena(clientX, clientY);
    let dx = pt.x - me.x;
    let dy = pt.y - me.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    aimVec = { x: dx / d, y: dy / d };
  }

  function setMoveTargetFromClient(clientX, clientY) {
    moveTarget = clampToMyHalf(clientToArena(clientX, clientY));
  }

  function desktopMoveVec() {
    if (!moveTarget) return { x: 0, y: 0 };
    const me = players.find((p) => p.id === myId);
    if (!me) return { x: 0, y: 0 };
    const dx = moveTarget.x - me.x;
    const dy = moveTarget.y - me.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= ARRIVE_DIST) {
      moveTarget = null;
      return { x: 0, y: 0 };
    }
    return { x: dx / d, y: dy / d };
  }

  function currentMove() {
    if (touchMode) return moveJoy;
    return desktopMoveVec();
  }

  function sendInput() {
    if (!active || !socket || !currentRoom || gameOver) return;
    if (touchMode && isPortrait()) {
      // Still send zero movement while blocked in portrait.
      socket.emit("dodgeBallInput", {
        roomCode: currentRoom,
        mx: 0,
        my: 0,
        aimX: aimVec.x,
        aimY: aimVec.y
      });
      return;
    }
    const m = currentMove();
    socket.emit("dodgeBallInput", {
      roomCode: currentRoom,
      mx: m.x,
      my: m.y,
      aimX: aimVec.x,
      aimY: aimVec.y
    });
  }

  function throwBall() {
    if (!active || !socket || !currentRoom || gameOver || phase !== "playing") return;
    if (touchMode && isPortrait()) return;
    socket.emit("dodgeBallThrow", {
      roomCode: currentRoom,
      aimX: aimVec.x,
      aimY: aimVec.y
    });
  }

  function pct(x, axis) {
    if (axis === "x") return (x / arena.w) * 100;
    return (x / arena.h) * 100;
  }

  function ensureChar(p) {
    let wrap = charEls[p.id];
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "dbEntity";
      wrap.dataset.id = p.id;
      const hp = document.createElement("div");
      hp.className = "dbCharHp";
      hp.innerHTML = "<span></span>";
      const sprite = document.createElement("div");
      sprite.className = "dbChar " + (p.index === 1 ? "p1" : "p2");
      const aim = document.createElement("div");
      aim.className = "dbAim";
      wrap.appendChild(hp);
      wrap.appendChild(aim);
      wrap.appendChild(sprite);
      dbArena.appendChild(wrap);
      charEls[p.id] = wrap;
    }
    return wrap;
  }

  function ensureBall(b) {
    let el = ballEls[b.id];
    if (!el) {
      el = document.createElement("div");
      el.className = "dbEntity dbBall";
      el.dataset.bid = String(b.id);
      dbArena.appendChild(el);
      ballEls[b.id] = el;
    }
    return el;
  }

  function pruneBalls(ids) {
    Object.keys(ballEls).forEach((id) => {
      if (!ids[id]) {
        ballEls[id].remove();
        delete ballEls[id];
      }
    });
  }

  function spawnTrail(x, y) {
    const t = document.createElement("div");
    t.className = "dbTrail";
    t.style.left = pct(x, "x") + "%";
    t.style.top = pct(y, "y") + "%";
    dbArena.appendChild(t);
    setTimeout(() => t.remove(), 400);
  }

  function spawnHitFx(x, y) {
    const fx = document.createElement("div");
    fx.className = "dbHitFx";
    fx.style.left = pct(x, "x") + "%";
    fx.style.top = pct(y, "y") + "%";
    let frame = 0;
    const tick = () => {
      fx.style.backgroundImage = "url('" + ASSET.hit[frame] + "')";
      frame += 1;
      if (frame >= ASSET.hit.length) {
        fx.remove();
        return;
      }
      setTimeout(tick, 55);
    };
    tick();
    dbArena.appendChild(fx);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHud() {
    const p1 = players.find((p) => p.index === 1);
    const p2 = players.find((p) => p.index === 2);
    if (p1 && dbHudP1) {
      const you = p1.id === myId ? " (You)" : "";
      dbHudP1.innerHTML =
        "<strong>P1 · " +
        escapeHtml(p1.name) +
        you +
        "</strong><div class=\"dbHpBar\"><div class=\"dbHpFill\" style=\"transform:scaleX(" +
        p1.hp / maxHp +
        ")\"></div></div>" +
        p1.hp +
        " HP";
    }
    if (p2 && dbHudP2) {
      const you = p2.id === myId ? " (You)" : "";
      dbHudP2.innerHTML =
        "<strong>P2 · " +
        escapeHtml(p2.name) +
        you +
        "</strong><div class=\"dbHpBar\"><div class=\"dbHpFill\" style=\"transform:scaleX(" +
        p2.hp / maxHp +
        ")\"></div></div>" +
        p2.hp +
        " HP";
    }
  }

  function renderCooldown() {
    if (!dbCooldown) return;
    const me = players.find((p) => p.id === myId);
    if (!me) return;
    const left = me.cooldownUntil - now();
    if (left <= 0 || phase !== "playing") {
      dbCooldown.textContent = phase === "playing" ? "READY" : "—";
      dbCooldown.classList.toggle("ready", phase === "playing");
      dbCooldown.classList.toggle("wait", phase !== "playing");
      return;
    }
    dbCooldown.textContent = (left / 1000).toFixed(1) + "s";
    dbCooldown.classList.remove("ready");
    dbCooldown.classList.add("wait");
  }

  function spriteFor(p) {
    // Static portrait — no walk/jump cycle (smoother on mobile + desktop).
    const pack = p.index === 1 ? ASSET.p1 : ASSET.p2;
    return pack.idle[0];
  }

  function renderMoveTarget() {
    if (!dbMoveTarget) return;
    if (!touchMode && moveTarget) {
      dbMoveTarget.style.left = pct(moveTarget.x, "x") + "%";
      dbMoveTarget.style.top = pct(moveTarget.y, "y") + "%";
      dbMoveTarget.classList.add("show");
    } else {
      dbMoveTarget.classList.remove("show");
    }
  }

  function renderEntities() {
    if (!dbArena) return;
    players.forEach((p) => {
      const wrap = ensureChar(p);
      wrap.style.left = pct(p.x, "x") + "%";
      wrap.style.top = pct(p.y, "y") + "%";
      const sprite = wrap.querySelector(".dbChar");
      const hpFill = wrap.querySelector(".dbCharHp > span");
      const aim = wrap.querySelector(".dbAim");
      if (sprite) {
        sprite.style.backgroundImage = "url('" + spriteFor(p) + "')";
        if (p.hitFlashUntil && p.hitFlashUntil > now()) sprite.classList.add("flash");
        else sprite.classList.remove("flash");
      }
      if (hpFill) hpFill.style.transform = "scaleX(" + p.hp / maxHp + ")";
      if (aim) {
        // Local player: show live client aim; others: server aim.
        const ax = p.id === myId ? aimVec.x : p.aimX;
        const ay = p.id === myId ? aimVec.y : p.aimY;
        const ang = (Math.atan2(ay, ax) * 180) / Math.PI + 90;
        const dist = 42;
        aim.style.left = "50%";
        aim.style.top = "50%";
        aim.style.transform =
          "translate(-50%, -100%) translate(" +
          Math.cos(((ang - 90) * Math.PI) / 180) * dist +
          "px," +
          Math.sin(((ang - 90) * Math.PI) / 180) * dist +
          "px) rotate(" +
          ang +
          "deg)";
        aim.style.borderBottomColor =
          p.index === 1 ? "rgba(80,170,255,0.9)" : "rgba(255,120,90,0.9)";
      }
    });

    const live = Object.create(null);
    projectiles.forEach((b) => {
      live[b.id] = true;
      const el = ensureBall(b);
      el.style.left = pct(b.x, "x") + "%";
      el.style.top = pct(b.y, "y") + "%";
      if (Math.random() < 0.45) spawnTrail(b.x, b.y);
    });
    pruneBalls(live);
    renderHud();
    renderCooldown();
    renderMoveTarget();
  }

  function applyState(data) {
    if (!data) return;
    if (data.arena) arena = data.arena;
    if (typeof data.now === "number") serverNowOffset = data.now - Date.now();
    if (data.players) players = data.players;
    if (data.projectiles) projectiles = data.projectiles;
    if (typeof data.phase === "string") phase = data.phase;
    if (typeof data.maxHp === "number") maxHp = data.maxHp;
    if (typeof data.cooldownMs === "number") cooldownMs = data.cooldownMs;
    renderEntities();
  }

  function showCountdownLabel(label) {
    if (!dbCountdown) return;
    dbWinner.classList.remove("show");
    dbWinner.textContent = "";
    dbCountdown.textContent = label;
    dbCountdown.classList.remove("show");
    void dbCountdown.offsetWidth;
    dbCountdown.classList.add("show");
    if (label === "GO!") {
      setTimeout(() => {
        if (dbCountdown) dbCountdown.classList.remove("show");
      }, 550);
    }
  }

  function onStarted(data) {
    if (!bindDom()) return;
    currentRoom = data.room;
    myId = data.you && data.you.id;
    myIndex = (data.you && data.you.index) || 1;
    mySide = (data.you && data.you.side) || (myIndex === 1 ? "left" : "right");
    aimVec = myIndex === 1 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    moveTarget = null;
    mouseHeld = false;
    moveJoy = { x: 0, y: 0 };
    spaceHeld = false;
    gameOver = false;
    phase = "countdown";
    players = data.players || [];
    projectiles = [];
    if (data.arena) arena = data.arena;
    if (typeof data.maxHp === "number") maxHp = data.maxHp;
    if (typeof data.cooldownMs === "number") cooldownMs = data.cooldownMs;
    Object.keys(charEls).forEach((id) => {
      charEls[id].remove();
      delete charEls[id];
    });
    Object.keys(ballEls).forEach((id) => {
      ballEls[id].remove();
      delete ballEls[id];
    });
    hideEndButtons();
    if (dbMsg) dbMsg.textContent = "";
    if (dbWinner) {
      dbWinner.classList.remove("show");
      dbWinner.textContent = "";
    }
    showDodgeBallScreen();
    renderEntities();
    stopLoops();
    inputTimer = setInterval(sendInput, 50);
    animTimer = setInterval(() => {
      animFrame += 1;
      renderEntities();
    }, 100);
    if (dbMsg) {
      dbMsg.textContent = touchMode
        ? "Left stick move · right stick aim · release to throw"
        : "Click/hold to move · mouse aims · Space throws";
    }
  }

  function onGameOver(data) {
    gameOver = true;
    phase = "over";
    moveTarget = null;
    if (data && data.players) players = data.players;
    renderEntities();
    if (dbCountdown) dbCountdown.classList.remove("show");
    if (dbWinner) {
      dbWinner.innerHTML =
        "<div>" +
        escapeHtml((data && data.message) || "PLAYER WINS") +
        "</div>";
      dbWinner.classList.add("show");
    }
    if (dbMsg) {
      dbMsg.textContent =
        (data && data.winnerName ? data.winnerName + " wins!" : "Match over.") +
        " Play Again when ready.";
    }
    showEndButtons();
  }

  function setKnob(el, nx, ny, baseEl) {
    if (!el) return;
    const size = baseEl ? baseEl.getBoundingClientRect().width : 72;
    const max = Math.max(16, size * 0.28);
    el.style.transform = "translate(" + nx * max + "px," + ny * max + "px)";
  }

  function readStick(baseEl, clientX, clientY) {
    const r = baseEl.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const max = r.width * 0.42;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = Math.min(1, d / max);
    return { x: (dx / d) * scale, y: (dy / d) * scale, mag: scale };
  }

  function bindStick(baseEl, knobEl, onMove, onEnd) {
    if (!baseEl) return;
    let touchId = null;

    baseEl.addEventListener(
      "touchstart",
      (e) => {
        if (!active || !touchMode) return;
        const t = e.changedTouches[0];
        touchId = t.identifier;
        const v = readStick(baseEl, t.clientX, t.clientY);
        setKnob(knobEl, v.x, v.y);
        onMove(v, true);
        e.preventDefault();
      },
      { passive: false }
    );
    baseEl.addEventListener(
      "touchmove",
      (e) => {
        if (touchId == null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === touchId) {
            const v = readStick(baseEl, t.clientX, t.clientY);
            setKnob(knobEl, v.x, v.y);
            onMove(v, false);
            e.preventDefault();
            break;
          }
        }
      },
      { passive: false }
    );
    const end = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          touchId = null;
          setKnob(knobEl, 0, 0);
          onEnd();
          e.preventDefault();
          break;
        }
      }
    };
    baseEl.addEventListener("touchend", end, { passive: false });
    baseEl.addEventListener("touchcancel", end, { passive: false });
  }

  async function requestLandscapeLock() {
    try {
      if (screen.orientation && typeof screen.orientation.lock === "function") {
        await screen.orientation.lock("landscape");
      }
    } catch (_) {
      // Not supported / denied — ignore.
    }
  }

  function exitFullscreenQuiet() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      try {
        exit.call(document);
      } catch (_) {}
    }
  }

  async function toggleFullscreen() {
    if (!dodgeBallScreen) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!fs) {
        const req =
          dodgeBallScreen.requestFullscreen ||
          dodgeBallScreen.webkitRequestFullscreen;
        if (req) {
          await req.call(dodgeBallScreen);
          await requestLandscapeLock();
        }
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch (_) {
      if (dbMsg) dbMsg.textContent = "Fullscreen is not available on this browser.";
    }
    updateModeClasses();
  }

  function wireControls() {
    if (controlsWired) return;
    controlsWired = true;

    window.addEventListener("resize", () => {
      if (active) updateModeClasses();
    });
    window.addEventListener("orientationchange", () => {
      if (active) setTimeout(updateModeClasses, 50);
    });
    document.addEventListener("fullscreenchange", () => {
      if (active) updateModeClasses();
    });
    document.addEventListener("webkitfullscreenchange", () => {
      if (active) updateModeClasses();
    });

    // Block page scroll while playing (touch).
    document.addEventListener(
      "touchmove",
      (e) => {
        if (!active) return;
        // Allow joysticks / buttons to handle their own touches; block page scroll.
        const t = e.target;
        if (t && t.closest && t.closest(".dbJoystick, .dbFullscreenBtn, .dbEndButtons, button")) {
          return;
        }
        e.preventDefault();
      },
      { passive: false }
    );

    // ——— Desktop: Space = throw; left mouse = move; mouse pos = aim ———
    window.addEventListener("keydown", (e) => {
      if (!active || touchMode) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceHeld) {
          spaceHeld = true;
          throwBall();
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") spaceHeld = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (!active || touchMode || !dbArena) return;
      setAimFromClient(e.clientX, e.clientY);
      if (mouseHeld) setMoveTargetFromClient(e.clientX, e.clientY);
    });

    document.addEventListener("mousedown", (e) => {
      if (!active || touchMode || gameOver) return;
      if (e.button !== 0) return;
      if (!dbArena || !dbArena.contains(e.target)) return;
      // Ignore clicks on overlay UI inside arena (winner / countdown are pointer-events managed).
      mouseHeld = true;
      setAimFromClient(e.clientX, e.clientY);
      setMoveTargetFromClient(e.clientX, e.clientY);
      e.preventDefault();
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      mouseHeld = false;
    });

    // ——— Mobile: independent left (move) + right (aim / release=throw) ———
    let aimActive = false;
    let aimHadDirection = false;

    bindStick(
      dbJoyMove,
      dbJoyMoveKnob,
      (v) => {
        moveJoy = { x: v.x, y: v.y };
      },
      () => {
        moveJoy = { x: 0, y: 0 };
      }
    );

    bindStick(
      dbJoyAim,
      dbJoyAimKnob,
      (v) => {
        aimActive = true;
        if (v.mag >= AIM_DEADZONE) {
          const d = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
          aimVec = { x: v.x / d, y: v.y / d };
          aimHadDirection = true;
        }
      },
      () => {
        const shouldThrow = aimActive && aimHadDirection;
        aimActive = false;
        aimHadDirection = false;
        setKnob(dbJoyAimKnob, 0, 0);
        if (shouldThrow) throwBall();
      }
    );

    if (dbFullscreenBtn) {
      dbFullscreenBtn.onclick = () => {
        toggleFullscreen();
      };
    }

    if (dbPlayAgainBtn) {
      dbPlayAgainBtn.onclick = () => {
        if (!socket || !currentRoom) return;
        dbPlayAgainBtn.disabled = true;
        dbPlayAgainBtn.textContent = "Waiting...";
        socket.emit("dodgeBallPlayAgain", { roomCode: currentRoom });
      };
    }
  }

  function init(sock) {
    socket = sock;
    if (!bindDom()) return;
    wireControls();

    socket.on("dodgeBallStarted", onStarted);

    socket.on("dodgeBallState", (data) => {
      if (!active && data && data.game === "dodge-ball") {
        if (!dodgeBallScreen || dodgeBallScreen.classList.contains("hidden")) return;
      }
      if (!active) return;
      applyState(data);
    });

    socket.on("dodgeBallCountdown", (data) => {
      if (!active) return;
      showCountdownLabel((data && data.label) || String(data && data.value));
      if (data && data.value === 0) phase = "playing";
      if (dbMsg && data) {
        dbMsg.textContent = data.label === "GO!" ? "Fight!" : "Get ready!";
      }
    });

    socket.on("dodgeBallThrowAck", (data) => {
      if (!active || !data) return;
      if (data.projectile) {
        const exists = projectiles.some((b) => b.id === data.projectile.id);
        if (!exists) projectiles.push(data.projectile);
      }
      if (data.ownerId && typeof data.cooldownUntil === "number") {
        const p = players.find((x) => x.id === data.ownerId);
        if (p) p.cooldownUntil = data.cooldownUntil;
      }
      renderEntities();
    });

    socket.on("dodgeBallHit", (data) => {
      if (!active || !data) return;
      if (typeof data.x === "number" && typeof data.y === "number") {
        spawnHitFx(data.x, data.y);
      }
      const t = players.find((p) => p.id === data.targetId);
      if (t) {
        t.hp = data.hp;
        t.hitFlashUntil = now() + 280;
      }
      projectiles = projectiles.filter((b) => b.id !== data.projectileId);
      renderEntities();
    });

    socket.on("dodgeBallOver", onGameOver);

    socket.on("dodgeBallPlayAgainWait", () => {
      if (dbMsg) dbMsg.textContent = "Waiting for opponent to Play Again...";
      if (dbPlayAgainBtn) {
        dbPlayAgainBtn.disabled = true;
        dbPlayAgainBtn.textContent = "Waiting...";
      }
    });

    socket.on("dodgeBallReset", () => {
      gameOver = false;
      moveTarget = null;
      hideEndButtons();
      if (dbWinner) {
        dbWinner.classList.remove("show");
        dbWinner.textContent = "";
      }
      if (dbMsg) dbMsg.textContent = "New round!";
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideDodgeBallScreen();
      stopLoops();
      if (lobbyScreen) lobbyScreen.classList.remove("hidden");
    });
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !dbMsg) return false;
    dbMsg.textContent = msg;
    return true;
  }

  window.DodgeBall = { init, isActive, showError };
})();
