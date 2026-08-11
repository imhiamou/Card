/* Dodge Ball — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    "<h2>Dodge Ball</h2>" +
    '<div class="dbHud">' +
      '<div class="dbPlayerHud p1" id="dbHudP1"></div>' +
      '<div class="dbCooldown ready" id="dbCooldown">READY</div>' +
      '<div class="dbPlayerHud p2" id="dbHudP2"></div>' +
    "</div>" +
    '<div class="dbArenaWrap">' +
      '<div class="dbArena" id="dbArena">' +
        '<div class="dbCenterLine"></div>' +
        '<div class="dbCountdown" id="dbCountdown"></div>' +
        '<div class="dbWinner" id="dbWinner"></div>' +
      "</div>" +
    "</div>" +
    '<div class="dbMobileControls" id="dbMobileControls">' +
      '<div class="dbJoystick" id="dbJoystick">' +
        '<div class="dbJoystickKnob" id="dbJoystickKnob"></div>' +
      "</div>" +
      '<p class="dbMobileHint">Drag arena to aim · release to throw</p>' +
    "</div>" +
    '<p id="dbMsg"></p>' +
    '<div id="dbEndButtons" class="dbEndButtons hidden">' +
      '<button type="button" id="dbPlayAgainBtn">Play Again</button>' +
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

  let socket = null;
  let currentRoom = null;
  let myId = null;
  let myIndex = 1;
  let active = false;
  let gameOver = false;
  let arena = { w: 800, h: 450, centerX: 400 };
  let players = [];
  let projectiles = [];
  let cooldownMs = 2000;
  let maxHp = 100;
  let serverNowOffset = 0;
  let phase = "countdown";

  let keys = Object.create(null);
  let moveVec = { x: 0, y: 0 };
  let aimVec = { x: 1, y: 0 };
  let mouseAim = { x: 1, y: 0 };
  let joyVec = { x: 0, y: 0 };
  let aimingTouch = false;
  let inputTimer = null;
  let animTimer = null;
  let animFrame = 0;
  let lastStateAt = 0;

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
  let dbJoystick;
  let dbJoystickKnob;

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
    dbJoystick = $("dbJoystick");
    dbJoystickKnob = $("dbJoystickKnob");
    return true;
  }

  function now() {
    return Date.now() + serverNowOffset;
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
  }

  function hideDodgeBallScreen() {
    active = false;
    stopLoops();
    if (dodgeBallScreen) dodgeBallScreen.classList.add("hidden");
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

  function isMobileUi() {
    return window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  }

  function arenaRect() {
    return dbArena.getBoundingClientRect();
  }

  function clientToArena(clientX, clientY) {
    const r = arenaRect();
    const x = ((clientX - r.left) / r.width) * arena.w;
    const y = ((clientY - r.top) / r.height) * arena.h;
    return { x: x, y: y };
  }

  function setAimFromClient(clientX, clientY) {
    const me = players.find((p) => p.id === myId);
    if (!me) return;
    const pt = clientToArena(clientX, clientY);
    let dx = pt.x - me.x;
    let dy = pt.y - me.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    mouseAim = { x: dx / d, y: dy / d };
    aimVec = mouseAim;
  }

  function keyboardMove() {
    let x = 0;
    let y = 0;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    const d = Math.sqrt(x * x + y * y) || 1;
    if (x || y) return { x: x / d, y: y / d };
    return { x: 0, y: 0 };
  }

  function currentMove() {
    if (isMobileUi()) return joyVec;
    const k = keyboardMove();
    if (k.x || k.y) return k;
    return moveVec;
  }

  function sendInput() {
    if (!active || !socket || !currentRoom || gameOver) return;
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const pack = p.index === 1 ? ASSET.p1 : ASSET.p2;
    const frames = p.moving ? pack.move : pack.idle;
    const idx = animFrame % frames.length;
    return frames[idx];
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
        const ang = (Math.atan2(p.aimY, p.aimX) * 180) / Math.PI + 90;
        // Place aim marker just outside the sprite toward aim direction.
        const dist = 42;
        aim.style.left = "50%";
        aim.style.top = "50%";
        aim.style.transform =
          "translate(-50%, -100%) translate(" +
          Math.cos((ang - 90) * Math.PI / 180) * dist +
          "px," +
          Math.sin((ang - 90) * Math.PI / 180) * dist +
          "px) rotate(" +
          ang +
          "deg)";
        aim.style.borderBottomColor = p.index === 1 ? "rgba(80,170,255,0.9)" : "rgba(255,120,90,0.9)";
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
    lastStateAt = Date.now();
    renderEntities();
  }

  function showCountdownLabel(label) {
    if (!dbCountdown) return;
    dbWinner.classList.remove("show");
    dbWinner.textContent = "";
    dbCountdown.textContent = label;
    dbCountdown.classList.remove("show");
    // reflow for animation restart
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
    aimVec = myIndex === 1 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    mouseAim = aimVec;
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
    if (dbMsg) dbMsg.textContent = "Get ready!";
  }

  function onGameOver(data) {
    gameOver = true;
    phase = "over";
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

  function wireControls() {
    window.addEventListener("keydown", (e) => {
      if (!active) return;
      keys[e.code] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (!active) return;
      keys[e.code] = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (!active || !dbArena || isMobileUi()) return;
      setAimFromClient(e.clientX, e.clientY);
    });
    document.addEventListener("mousedown", (e) => {
      if (!active || gameOver || isMobileUi()) return;
      if (!dbArena || !dbArena.contains(e.target)) return;
      if (e.button !== 0) return;
      setAimFromClient(e.clientX, e.clientY);
      throwBall();
    });

    // Touch aim on arena: drag to aim, release to throw.
    let touchId = null;
    dbArena.addEventListener(
      "touchstart",
      (e) => {
        if (!active || gameOver) return;
        const t = e.changedTouches[0];
        touchId = t.identifier;
        aimingTouch = true;
        setAimFromClient(t.clientX, t.clientY);
        e.preventDefault();
      },
      { passive: false }
    );
    dbArena.addEventListener(
      "touchmove",
      (e) => {
        if (!active || touchId == null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === touchId) {
            setAimFromClient(t.clientX, t.clientY);
            e.preventDefault();
            break;
          }
        }
      },
      { passive: false }
    );
    const endAimTouch = (e) => {
      if (!active || touchId == null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === touchId) {
          setAimFromClient(t.clientX, t.clientY);
          if (aimingTouch) throwBall();
          aimingTouch = false;
          touchId = null;
          e.preventDefault();
          break;
        }
      }
    };
    dbArena.addEventListener("touchend", endAimTouch, { passive: false });
    dbArena.addEventListener("touchcancel", endAimTouch, { passive: false });

    // Virtual joystick
    let joyTouch = null;
    const setKnob = (nx, ny) => {
      if (!dbJoystickKnob) return;
      const max = 32;
      dbJoystickKnob.style.transform =
        "translate(" + nx * max + "px," + ny * max + "px)";
    };
    const joyFromEvent = (clientX, clientY) => {
      const r = dbJoystick.getBoundingClientRect();
      let dx = clientX - (r.left + r.width / 2);
      let dy = clientY - (r.top + r.height / 2);
      const max = r.width * 0.42;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const scale = Math.min(1, d / max);
      const nx = (dx / d) * scale;
      const ny = (dy / d) * scale;
      joyVec = { x: nx, y: ny };
      setKnob(nx, ny);
    };
    const resetJoy = () => {
      joyVec = { x: 0, y: 0 };
      joyTouch = null;
      setKnob(0, 0);
    };
    if (dbJoystick) {
      dbJoystick.addEventListener(
        "touchstart",
        (e) => {
          if (!active) return;
          const t = e.changedTouches[0];
          joyTouch = t.identifier;
          joyFromEvent(t.clientX, t.clientY);
          e.preventDefault();
        },
        { passive: false }
      );
      dbJoystick.addEventListener(
        "touchmove",
        (e) => {
          if (joyTouch == null) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === joyTouch) {
              joyFromEvent(t.clientX, t.clientY);
              e.preventDefault();
              break;
            }
          }
        },
        { passive: false }
      );
      const joyEnd = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === joyTouch) {
            resetJoy();
            e.preventDefault();
            break;
          }
        }
      };
      dbJoystick.addEventListener("touchend", joyEnd, { passive: false });
      dbJoystick.addEventListener("touchcancel", joyEnd, { passive: false });
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
        // Late bind if started event somehow missed after remount.
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
