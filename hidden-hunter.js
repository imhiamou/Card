/* Hidden Hunter — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="hhRotate" id="hhRotate">PLEASE ROTATE YOUR PHONE TO LANDSCAPE</div>' +
    '<div class="hhHud" id="hhHud">' +
      '<div class="hhTop">' +
        '<div class="hhRole" id="hhRole">HIDDEN HUNTER</div>' +
        '<div class="hhPartner" id="hhPartner"></div>' +
        '<div class="hhTimer" id="hhTimer">05:00</div>' +
        '<button type="button" class="hhFsBtn" id="hhFsBtn">FULLSCREEN</button>' +
      '</div>' +
      '<div class="hhStage" id="hhStage">' +
        '<canvas id="hhCanvas"></canvas>' +
        '<div class="hhCrosshair" id="hhCrosshair"></div>' +
        '<div class="hhOverlay" id="hhBanner"></div>' +
        '<div class="hhFlash" id="hhFlash"></div>' +
      '</div>' +
      '<div class="hhBottom">' +
        '<div class="hhHealthWrap"><div class="hhHealthLabel" id="hhHealthLabel">HP 100</div><div class="hhHealthBar"><div class="hhHealthFill" id="hhHealthFill"></div></div></div>' +
        '<div class="hhAmmo" id="hhAmmo"></div>' +
        '<div class="hhTaser hidden" id="hhTaser">TASER READY</div>' +
        '<p class="hhMsg" id="hhMsg">Talk outside the game — there is no chat.</p>' +
      '</div>' +
      '<div class="hhMobile" id="hhMobile">' +
        '<div class="hhJoy" id="hhJoyMove"><div class="hhKnob" id="hhJoyMoveKnob"></div><span>MOVE</span></div>' +
        '<button type="button" class="hhShootBtn hidden" id="hhShootBtn">SHOOT</button>' +
        '<button type="button" class="hhTaserBtn hidden" id="hhTaserBtn">TASER</button>' +
        '<div class="hhJoy hidden" id="hhJoyAim"><div class="hhKnob" id="hhJoyAimKnob"></div><span>AIM</span></div>' +
      '</div>' +
      '<div id="hhEndButtons" class="hhEnd hidden">' +
        '<button type="button" id="hhPlayAgainBtn">Play Again</button>' +
        '<button type="button" id="hhLobbyBtn">Return to Lobby</button>' +
      '</div>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let state = null;
  let myRole = null;
  let touchMode = false;
  let moveJoy = { x: 0, y: 0 };
  let aimJoy = { x: 1, y: 0 };
  let mouseAim = { x: 1, y: 0 };
  let keys = Object.create(null);
  let inputTimer = null;
  let raf = null;
  let prev = null;
  let cam = { x: 0, y: 0 };
  let lastShot = 0;
  const IMG = Object.create(null);
  const MOVEMENT_THRESHOLD = 0.12;
  function numbered(prefix, count) {
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(prefix + i + ".png");
    return frames;
  }
  // Riley Gombart rifle survivor. The barrel is a horizontal tube on the right
  // of the cell (axis measured at -0.65 degrees, treated as +X). Feet are a
  // separate sheet in that same pose. Rotation is atan2(aim), not an extra offset.
  // Pivot and muzzle are fractions of the rifle frame (torso, then barrel tip).
  const HUNTER_DRAW = {
    idle: numbered("assets/hidden-hunter/player/hunter/idle_", 5),
    move: numbered("assets/hidden-hunter/player/hunter/move_", 5),
    feetIdle: "assets/hidden-hunter/player/hunter/feet_idle.png",
    feetWalk: numbered("assets/hidden-hunter/player/hunter/feet_", 6),
    pivotX: 110.44 / 313,
    pivotY: 116.48 / 207,
    muzzleX: (271.63 - 110.44) / 313,
    muzzleY: (152.33 - 116.48) / 207
  };
  // Riley Gombart handgun survivor. Every cell faces right: the pistol is a
  // horizontal tube (axis about -0.9 degrees, treated as +X). The same aim
  // angle used by the hunter turns that tube onto the mouse. No extra offset.
  // Idle 0,4,8,12,16 of 20; move the same; shoot is the three-frame recoil.
  const TRACKER_DRAW = {
    idle: numbered("assets/hidden-hunter/player/tracker/idle_", 5),
    move: numbered("assets/hidden-hunter/player/tracker/move_", 5),
    shoot: numbered("assets/hidden-hunter/player/tracker/shoot_", 3),
    pivotX: 92 / 225,
    pivotY: 87 / 170
  };
  // Opaque height matches the hunter body (about 60px) without stretching.
  const TRACKER_DRAW_H = 67;
  function zombieRow(kind, count) {
    const frames = [];
    for (let i = 0; i < count; i++) frames.push("assets/hidden-hunter/monster/zombie_" + kind + "_" + i + ".png");
    return frames;
  }
  // Kenney CC0 top-down sprites. Drawn inside the existing obstacle boxes.
  const PROP_SRC = {
    barrelRed: "assets/hidden-hunter/environment/props/barrels/barrel-red-top.png",
    barrelRust: "assets/hidden-hunter/environment/props/barrels/barrel-rust-top.png",
    crateWood: "assets/hidden-hunter/environment/props/crates/crate-wood.png",
    crateMetal: "assets/hidden-hunter/environment/props/crates/crate-metal.png",
    tableTop: "assets/hidden-hunter/environment/props/furniture/table-top.png",
    shelf: "assets/hidden-hunter/environment/props/furniture/shelf-panel.png",
    machine: "assets/hidden-hunter/environment/props/industrial/machine-panel.png",
    pillar: "assets/hidden-hunter/environment/props/industrial/barricade-metal.png",
    tank: "assets/hidden-hunter/environment/props/industrial/tank-sand.png",
    tankDark: "assets/hidden-hunter/environment/props/industrial/tank-dark.png",
    tankGreen: "assets/hidden-hunter/environment/props/industrial/tank-green.png",
    barrelGreen: "assets/hidden-hunter/environment/props/barrels/barrel-green-top.png",
    barrelBlack: "assets/hidden-hunter/environment/props/barrels/barrel-black-top.png",
    pillarWood: "assets/hidden-hunter/environment/props/industrial/barricade-wood.png",
    sandbag: "assets/hidden-hunter/environment/props/industrial/sandbag.png",
    door: "assets/hidden-hunter/environment/props/industrial/door-slab.png",
    window: "assets/hidden-hunter/environment/props/industrial/window-frame.png"
  };
  // x, y, w, h are fractions of the obstacle. Each sprite keeps its own aspect.
  const PROP_LAYOUT = {
    barrels: [
      ["barrelRed", 0, 0.06, 0.58, 0.88],
      ["barrelRust", 0.42, 0.06, 0.58, 0.88]
    ],
    crates: [
      ["crateWood", 0, 0, 0.36, 0.52],
      ["crateMetal", 0.32, 0, 0.36, 0.52],
      ["crateWood", 0.64, 0, 0.36, 0.52],
      ["crateMetal", 0, 0.48, 0.36, 0.52],
      ["crateWood", 0.32, 0.48, 0.36, 0.52],
      ["crateMetal", 0.64, 0.48, 0.36, 0.52]
    ],
    boxes: [
      ["crateWood", 0, 0, 0.58, 0.72],
      ["crateMetal", 0.4, 0.28, 0.58, 0.72]
    ],
    table: [
      ["tableTop", 0, 0, 0.52, 1],
      ["tableTop", 0.48, 0, 0.52, 1]
    ],
    shelves: [
      ["shelf", 0, 0, 0.36, 1],
      ["shelf", 0.32, 0, 0.36, 1],
      ["shelf", 0.64, 0, 0.36, 1]
    ],
    machine: [
      ["machine", 0, 0, 0.52, 0.55],
      ["machine", 0.48, 0, 0.52, 0.55],
      ["machine", 0, 0.48, 0.52, 0.52],
      ["crateWood", 0.5, 0.42, 0.28, 0.36],
      ["barrelRed", 0.72, 0.5, 0.26, 0.42]
    ],
    container: [
      ["crateMetal", 0, 0.08, 0.36, 0.84],
      ["crateMetal", 0.32, 0.08, 0.36, 0.84],
      ["crateMetal", 0.64, 0.08, 0.36, 0.84]
    ],
    door: [["door", 0, 0, 1, 1]],
    window: [
      ["window", 0, 0, 1, 0.52],
      ["window", 0, 0.48, 1, 0.52]
    ],
    pillar: [["pillar", 0, 0, 1, 1]],
    vehicle: [
      ["crateWood", 0, 0.12, 0.24, 0.76],
      ["tank", 0.22, 0.02, 0.4, 0.96],
      ["crateMetal", 0.6, 0.12, 0.22, 0.76],
      ["barrelRust", 0.8, 0.16, 0.2, 0.7]
    ],
    vehicleDark: [
      ["tankDark", 0.02, 0.04, 0.62, 0.92],
      ["crateMetal", 0.62, 0.16, 0.36, 0.7]
    ],
    vehicleGreen: [
      ["tankGreen", 0.04, 0.04, 0.7, 0.92],
      ["barrelGreen", 0.68, 0.2, 0.3, 0.62]
    ],
    pillarWood: [["pillarWood", 0, 0, 1, 1]],
    barrelsGreen: [
      ["barrelGreen", 0, 0.06, 0.58, 0.88],
      ["barrelGreen", 0.42, 0.06, 0.58, 0.88]
    ],
    barrelsBlack: [
      ["barrelBlack", 0, 0.06, 0.58, 0.88],
      ["barrelRust", 0.42, 0.06, 0.58, 0.88]
    ],
    pallet: [
      ["crateWood", 0, 0, 0.52, 0.52],
      ["crateMetal", 0.48, 0, 0.52, 0.52],
      ["crateWood", 0.08, 0.46, 0.52, 0.52],
      ["crateMetal", 0.46, 0.46, 0.52, 0.52]
    ],
    generator: [
      ["machine", 0, 0, 0.52, 0.62],
      ["machine", 0.48, 0, 0.52, 0.62],
      ["barrelRed", 0.62, 0.55, 0.34, 0.42]
    ],
    conveyor: [
      ["shelf", 0, 0, 0.22, 1],
      ["shelf", 0.2, 0, 0.22, 1],
      ["shelf", 0.4, 0, 0.22, 1],
      ["shelf", 0.6, 0, 0.22, 1],
      ["shelf", 0.78, 0, 0.22, 1]
    ],
    sandbag: [["sandbag", 0, 0, 1, 1]]
  };

  const SPRITE = {
    player: { hunter: HUNTER_DRAW, tracker: TRACKER_DRAW },
    // Riley Gombart CC0 zombie. One right-facing pose per animation (head on the right).
    // Idle 0,3,6,9,12,15 of 17; move the same; attack frames 0-8.
    monster: {
      idle: zombieRow("idle", 6),
      move: zombieRow("move", 6),
      attack: zombieRow("attack", 9)
    },
    props: PROP_SRC
  };
  const vis = {
    shootUntil: 0,
    taserUntil: 0,
    muzzleUntil: 0,
    monsterAttackUntil: 0,
    monsterDeathAt: 0,
    scareUntil: 0,
    telegraphUntil: 0,
    monsterFace: { x: 1, y: 0 },
    face: Object.create(null),
    lastHp: Object.create(null),
    lastMonster: null
  };

  function loadImg(src) {
    if (IMG[src]) return IMG[src];
    const im = new Image();
    im.src = src;
    IMG[src] = im;
    return im;
  }

  function eachSrc(node, fn) {
    if (!node) return;
    if (typeof node === "string") fn(node);
    else if (Array.isArray(node)) node.forEach((n) => eachSrc(n, fn));
    else Object.keys(node).forEach((k) => eachSrc(node[k], fn));
  }

  function preloadSprites() {
    eachSrc(SPRITE, loadImg);
  }

  function frameOf(list, fps, onceSince) {
    if (!list || !list.length) return null;
    let i = 0;
    if (list.length > 1) {
      if (onceSince) i = Math.min(list.length - 1, Math.floor((Date.now() - onceSince) / (1000 / fps)));
      else i = Math.floor(Date.now() / (1000 / fps)) % list.length;
    }
    return loadImg(list[i]);
  }

  // Canvas y grows downward. 0 is right, +PI/2 is down, -PI/2 is up.
  function aimAngle(x, y) {
    if (Math.abs(x) + Math.abs(y) < 1e-6) return Math.PI / 2;
    return Math.atan2(y, x);
  }

  function liveAimVector() {
    const a = touchMode ? aimJoy : mouseAim;
    const d = Math.hypot(a.x, a.y);
    if (d < 1e-4) return { x: 1, y: 0 };
    return { x: a.x / d, y: a.y / d };
  }

  function aimVector(p, isMe) {
    if (isMe) return liveAimVector();
    const x = p && p.aimX;
    const y = p && p.aimY;
    if (typeof x === "number" && typeof y === "number") {
      const d = Math.hypot(x, y);
      if (d > 0.05) {
        vis.face[p.id] = { x: x / d, y: y / d };
        return vis.face[p.id];
      }
    }
    // Tracker aim is omitted for the Hunter. Do not rebuild it from velocity.
    if (p && p.role === "tracker") return { x: 0, y: 1 };
    return (p && vis.face[p.id]) || { x: 0, y: 1 };
  }

  function spriteReady(im) {
    return im && im.complete && im.naturalWidth > 0;
  }

  let lobbyScreen, placementScreen, gameScreen, wordChainScreen, codeBreakerScreen;
  let dominoScreen, unoScreen, dodgeBallScreen, coinFlipScreen, hiddenHunterScreen;
  let hhCanvas, hhRole, hhPartner, hhTimer, hhAmmo, hhMsg, hhBanner, hhCrosshair;
  let hhShootBtn, hhTaserBtn, hhTaser, hhHealthFill, hhHealthLabel, hhFlash;
  let hhJoyAim, hhEndButtons, hhPlayAgainBtn, hhLobbyBtn, hhFsBtn, hhStage;

  function $(id) { return document.getElementById(id); }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    codeBreakerScreen = $("codeBreakerScreen");
    dominoScreen = $("dominoScreen");
    unoScreen = $("unoScreen");
    dodgeBallScreen = $("dodgeBallScreen");
    coinFlipScreen = $("coinFlipScreen");
    hiddenHunterScreen = $("hiddenHunterScreen");
    if (!hiddenHunterScreen) return false;
    if (!hiddenHunterScreen.dataset.ready) {
      hiddenHunterScreen.innerHTML = SCREEN_HTML;
      hiddenHunterScreen.dataset.ready = "1";
    }
    hhCanvas = $("hhCanvas");
    hhRole = $("hhRole");
    hhPartner = $("hhPartner");
    hhTimer = $("hhTimer");
    hhAmmo = $("hhAmmo");
    hhMsg = $("hhMsg");
    hhBanner = $("hhBanner");
    hhCrosshair = $("hhCrosshair");
    hhShootBtn = $("hhShootBtn");
    hhTaserBtn = $("hhTaserBtn");
    hhTaser = $("hhTaser");
    hhHealthFill = $("hhHealthFill");
    hhHealthLabel = $("hhHealthLabel");
    hhFlash = $("hhFlash");
    hhJoyAim = $("hhJoyAim");
    hhEndButtons = $("hhEndButtons");
    hhPlayAgainBtn = $("hhPlayAgainBtn");
    hhLobbyBtn = $("hhLobbyBtn");
    hhFsBtn = $("hhFsBtn");
    hhStage = $("hhStage");
    return true;
  }

  function otherScreens() {
    return [lobbyScreen, placementScreen, gameScreen, wordChainScreen, codeBreakerScreen, dominoScreen, unoScreen, dodgeBallScreen, coinFlipScreen];
  }

  function preferTouch() {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const hover = window.matchMedia("(hover: hover)").matches;
    if (fine && hover) return false;
    if (coarse && !fine) return true;
    return (navigator.maxTouchPoints || 0) > 0 && !hover;
  }

  function showScreen() {
    active = true;
    otherScreens().forEach((el) => { if (el) el.classList.add("hidden"); });
    hiddenHunterScreen.classList.remove("hidden");
    touchMode = preferTouch();
    hiddenHunterScreen.classList.toggle("hh-touch", touchMode);
    sizeCanvas();
    startLoops();
  }

  function hideScreen() {
    active = false;
    stopLoops();
    if (hiddenHunterScreen) hiddenHunterScreen.classList.add("hidden");
    if (document.fullscreenElement === hiddenHunterScreen) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) ex.call(document).catch(() => {});
    }
  }

  function startLoops() {
    stopLoops();
    inputTimer = setInterval(sendInput, 50);
    const loop = () => {
      if (!active) return;
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function stopLoops() {
    if (inputTimer) { clearInterval(inputTimer); inputTimer = null; }
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function sizeCanvas() {
    if (!hhCanvas || !hhStage) return;
    const r = hhStage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    hhCanvas.width = Math.max(320, Math.floor(r.width * dpr));
    hhCanvas.height = Math.max(180, Math.floor(r.height * dpr));
    hhCanvas.style.width = r.width + "px";
    hhCanvas.style.height = r.height + "px";
  }

  function meFrom(st) {
    return (st.players || []).find((p) => p.id === socket.id) || null;
  }

  function partnerFrom(st) {
    return (st.players || []).find((p) => p.id !== socket.id) || null;
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }

  function applyState(data) {
    if (!data) return;
    // Defense in depth: Hunter client must never keep monster or taser-aim state.
    if (!data.you || data.you.role !== "tracker") {
      data = Object.assign({}, data);
      delete data.monster;
      delete data.taser;
      delete data.taserBeams;
      if (data.players) {
        data.players = data.players.map((p) => {
          if (p.role !== "tracker") return p;
          const copy = Object.assign({}, p);
          copy.aimX = null;
          copy.aimY = null;
          return copy;
        });
      }
    }
    if (state) prev = state;
    state = data;
    state._recvAt = Date.now();
    if (data.room) currentRoom = data.room;
    myRole = data.you ? data.you.role : myRole;
    (data.players || []).forEach((p) => {
      const prevHp = vis.lastHp[p.id];
      if (prevHp != null && p.hp < prevHp) vis.monsterAttackUntil = Date.now() + 380;
      vis.lastHp[p.id] = p.hp;
    });
    if (data.monster && data.monster.hp <= 0 && !vis.monsterDeathAt) vis.monsterDeathAt = Date.now();
    if (data.monster && data.monster.hp > 0) vis.monsterDeathAt = 0;
    renderHud();
  }

  function renderHud() {
    if (!state) return;
    const hunter = myRole === "hunter";
    if (hhRole) hhRole.textContent = hunter ? "YOU ARE THE HUNTER" : "YOU ARE THE TRACKER";
    if (hhPartner) {
      hhPartner.textContent = "PARTNER: " + (state.partnerRole || "").toUpperCase();
    }
    if (hhTimer) hhTimer.textContent = formatTime(state.remainingMs || 0);
    if (hhCrosshair) hhCrosshair.classList.toggle("hidden", state.phase === "over");
    if (hhShootBtn) hhShootBtn.classList.toggle("hidden", !hunter || !touchMode);
    if (hhTaserBtn) hhTaserBtn.classList.toggle("hidden", hunter || !touchMode);
    if (hhJoyAim) hhJoyAim.classList.toggle("hidden", !touchMode);
    const me = meFrom(state);
    if (hhHealthFill && me) {
      const maxHp = me.maxHp || 100;
      const hp = me.hp == null ? maxHp : me.hp;
      hhHealthFill.style.width = Math.max(0, Math.min(100, (hp / maxHp) * 100)) + "%";
    }
    if (hhHealthLabel && me) {
      hhHealthLabel.textContent = "HP " + (me.hp == null ? 100 : me.hp);
    }
    if (hhAmmo) {
      if (!hunter || !me) hhAmmo.textContent = "";
      else if (me.reloadingUntil && Date.now() < me.reloadingUntil) hhAmmo.textContent = "RELOADING…";
      else hhAmmo.textContent = "AMMO " + (me.ammo == null ? 0 : me.ammo) + " / " + (me.magazine || 6);
    }
    if (hhTaser) {
      hhTaser.classList.toggle("hidden", hunter);
      if (!hunter && state.taser) {
        const left = Math.max(0, (state.taser.remainingMs || 0) - (Date.now() - (state._recvAt || Date.now())));
        hhTaser.textContent = left <= 0 ? "TASER READY" : ("TASER " + (left / 1000).toFixed(1) + "s");
      }
    }
    if (hhBanner) {
      if (state.disconnected) hhBanner.textContent = "YOUR PARTNER DISCONNECTED";
      else if (state.phase === "countdown") hhBanner.textContent = "PLAYER FOUND · " + state.countdown;
      else if (state.phase === "over" && state.result === "win") hhBanner.textContent = "TEAM VICTORY — MONSTER ELIMINATED";
      else if (state.phase === "over" && state.result === "caught") hhBanner.textContent = "TEAM DEFEAT — YOU WERE CAUGHT";
      else if (state.phase === "over") hhBanner.textContent = "TIME'S UP — THE MONSTER ESCAPED";
      else hhBanner.textContent = "";
    }
    if (hhEndButtons) hhEndButtons.classList.toggle("hidden", state.phase !== "over");
    if (hhPlayAgainBtn) hhPlayAgainBtn.classList.toggle("hidden", state.phase !== "over" || !!state.disconnected);
  }

  function keyVec() {
    let x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    return { x, y };
  }

  function sendInput() {
    if (!active || !currentRoom || !state || state.phase === "over") return;
    const move = touchMode ? moveJoy : keyVec();
    const aim = liveAimVector();
    socket.emit("hiddenHunterInput", {
      roomCode: currentRoom,
      mx: move.x,
      my: move.y,
      aimX: aim.x,
      aimY: aim.y
    });
  }

  function fireWeapon() {
    if (!currentRoom || !state || state.phase !== "playing") return;
    const now = Date.now();
    if (now - lastShot < 120) return;
    lastShot = now;
    const aim = liveAimVector();
    if (myRole === "hunter") {
      vis.shootUntil = Date.now() + 220;
      vis.muzzleUntil = Date.now() + 90;
      socket.emit("hiddenHunterShoot", { roomCode: currentRoom, aimX: aim.x, aimY: aim.y });
    } else if (myRole === "tracker") {
      vis.taserUntil = Date.now() + 260;
      socket.emit("hiddenHunterTaser", { roomCode: currentRoom, aimX: aim.x, aimY: aim.y });
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function interpPos(oldEnt, newEnt, t) {
    if (!oldEnt || !newEnt) return newEnt;
    return Object.assign({}, newEnt, {
      x: lerp(oldEnt.x, newEnt.x, t),
      y: lerp(oldEnt.y, newEnt.y, t)
    });
  }

  function interpT() {
    if (!state || !state._recvAt) return 1;
    return Math.max(0, Math.min(1, (Date.now() - state._recvAt) / 50));
  }

  function worldToScreen(ctx, x, y) {
    return { x: x - cam.x, y: y - cam.y };
  }

  function drawPropSprite(ctx, key, x, y, w, h) {
    const im = loadImg(PROP_SRC[key]);
    if (!spriteReady(im)) return false;
    const scale = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * scale;
    const dh = im.naturalHeight * scale;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.imageSmoothingEnabled = prev;
    return true;
  }

  function drawPropLayout(ctx, o) {
    const layout = PROP_LAYOUT[o.kind];
    if (!layout) return false;
    for (let i = 0; i < layout.length; i++) {
      if (!spriteReady(loadImg(PROP_SRC[layout[i][0]]))) return false;
    }
    const p = worldToScreen(ctx, o.x, o.y);
    for (let i = 0; i < layout.length; i++) {
      const cell = layout[i];
      drawPropSprite(ctx, cell[0], p.x + cell[1] * o.w, p.y + cell[2] * o.h, cell[3] * o.w, cell[4] * o.h);
    }
    return true;
  }

  function drawObstacle(ctx, o) {
    if (o.x + o.w < cam.x - 40 || o.y + o.h < cam.y - 40) return;
    if (o.x > cam.x + cam.viewW + 40 || o.y > cam.y + cam.viewH + 40) return;
    const p = worldToScreen(ctx, o.x, o.y);
    if (drawPropLayout(ctx, o)) {
      if (o.label) {
        ctx.fillStyle = "rgba(255,240,210,.88)";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(o.label, p.x + o.w / 2, p.y - 6);
      }
      return;
    }
    if (o.kind === "barrels") {
      ctx.fillStyle = "#9a2b2b";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "#c43c3c";
      ctx.beginPath(); ctx.arc(p.x + 24, p.y + 36, 20, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x + 70, p.y + 36, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(p.x + 10, p.y + 28, 28, 4);
      ctx.fillRect(p.x + 56, p.y + 28, 28, 4);
    } else if (o.kind === "crates") {
      ctx.fillStyle = "#8a6232";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.strokeStyle = "#5c3d18";
      ctx.strokeRect(p.x + 6, p.y + 6, o.w / 2 - 10, o.h / 2 - 10);
      ctx.strokeRect(p.x + o.w / 2, p.y + o.h / 2, o.w / 2 - 8, o.h / 2 - 8);
    } else if (o.kind === "machine") {
      ctx.fillStyle = "#3a4658";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "#6ad0ff";
      ctx.fillRect(p.x + 20, p.y + 24, 50, 18);
      ctx.fillStyle = "#222";
      ctx.fillRect(p.x + 90, p.y + 50, 110, 80);
    } else if (o.kind === "pillar") {
      ctx.fillStyle = "#6b7280";
      ctx.fillRect(p.x, p.y, o.w, o.h);
    } else if (o.kind === "door") {
      ctx.fillStyle = "#4a3020";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(p.x + o.w - 22, p.y + 10, 8, 8);
    } else if (o.kind === "vehicle") {
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(p.x, p.y + 20, o.w, o.h - 28);
      ctx.fillStyle = "#222";
      ctx.beginPath(); ctx.arc(p.x + 40, p.y + o.h - 8, 16, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x + o.w - 40, p.y + o.h - 8, 16, 0, Math.PI * 2); ctx.fill();
    } else if (o.kind === "shelves") {
      ctx.fillStyle = "#5a4630";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "#2b2116";
      ctx.fillRect(p.x + 8, p.y + 12, o.w - 16, 8);
      ctx.fillRect(p.x + 8, p.y + 36, o.w - 16, 8);
    } else if (o.kind === "table") {
      ctx.fillStyle = "#6e4b2a";
      ctx.fillRect(p.x, p.y, o.w, o.h);
    } else if (o.kind === "container") {
      ctx.fillStyle = "#2f6b4f";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.strokeStyle = "#1c4030";
      ctx.strokeRect(p.x + 8, p.y + 8, o.w - 16, o.h - 16);
    } else if (o.kind === "window") {
      ctx.fillStyle = "#2a3344";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "rgba(140,190,220,.35)";
      ctx.fillRect(p.x + 4, p.y + 10, o.w - 8, 36);
      ctx.fillRect(p.x + 4, p.y + 54, o.w - 8, 36);
      ctx.fillRect(p.x + 4, p.y + 98, o.w - 8, 30);
    } else if (o.kind === "boxes") {
      ctx.fillStyle = "#7a5a2e";
      ctx.fillRect(p.x, p.y, o.w, o.h);
      ctx.fillStyle = "#c4a36a";
      ctx.fillRect(p.x + 8, p.y + 8, o.w - 16, 18);
    } else {
      ctx.fillStyle = "#445";
      ctx.fillRect(p.x, p.y, o.w, o.h);
    }
    if (o.label) {
      ctx.fillStyle = "rgba(255,240,210,.88)";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(o.label, p.x + o.w / 2, p.y - 6);
    }
  }

  function playerMoving(p, isMe) {
    if (!p || p.dead) return false;
    if (isMe) {
      const move = touchMode ? moveJoy : keyVec();
      const mag = Math.sqrt(move.x * move.x + move.y * move.y);
      return mag > MOVEMENT_THRESHOLD;
    }
    return p.moving === true;
  }

  function frameIndex(list, fps, onceSince) {
    if (!list || list.length < 2) return 0;
    if (onceSince) return Math.min(list.length - 1, Math.floor((Date.now() - onceSince) / (1000 / fps)));
    return Math.floor(Date.now() / (1000 / fps)) % list.length;
  }

  function drawSprite(ctx, im, w) {
    if (!spriteReady(im)) return false;
    const h = w * (im.naturalHeight / im.naturalWidth);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    return true;
  }

  function drawAnchored(ctx, im, height, pivotX, pivotY, color) {
    if (!spriteReady(im)) return false;
    const sheet = color ? tintSprite(im, color) : im;
    const w = height * (im.naturalWidth / im.naturalHeight);
    ctx.drawImage(sheet, -pivotX * w, -pivotY * height, w, height);
    return true;
  }

  function drawPlayer(ctx, p, isMe) {
    const s = worldToScreen(ctx, p.x, p.y);
    const now = Date.now();
    const role = p.role === "hunter" ? "hunter" : "tracker";
    const dead = !!p.dead || (state && state.phase === "over" && state.result === "caught");
    const moving = playerMoving(p, isMe);
    const aim = aimVector(p, isMe);
    const ang = aimAngle(aim.x, aim.y);
    const color = dead ? "rgba(18, 14, 16, 0.5)" : null;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.imageSmoothingEnabled = true;
    if (role === "hunter") {
      // One angle for the body, the gun, and the muzzle. Movement does not rotate this.
      ctx.rotate(ang);
      const bodyFrames = (!dead && moving) ? HUNTER_DRAW.move : HUNTER_DRAW.idle;
      const feetList = (!dead && moving) ? HUNTER_DRAW.feetWalk : [HUNTER_DRAW.feetIdle];
      const bodyIm = loadImg(bodyFrames[frameIndex(bodyFrames, moving ? 8 : 6)]);
      const feetIm = loadImg(feetList[frameIndex(feetList, moving ? 10 : 1)]);
      const bodyH = 82;
      if (spriteReady(bodyIm)) {
        const scale = bodyH / bodyIm.naturalHeight;
        if (spriteReady(feetIm)) {
          drawAnchored(ctx, feetIm, feetIm.naturalHeight * scale, 0.5, 0.5, color);
        }
        drawAnchored(ctx, bodyIm, bodyH, HUNTER_DRAW.pivotX, HUNTER_DRAW.pivotY, color);
      } else {
        ctx.fillStyle = "#d7c4a3";
        ctx.fillRect(-12, -16, 24, 32);
      }
    } else {
      // Native pose faces right. ang is the existing aim angle, not a new offset.
      ctx.rotate(ang);
      const shooting = isMe && !dead && now < vis.taserUntil;
      const bodyFrames = shooting
        ? TRACKER_DRAW.shoot
        : ((!dead && moving) ? TRACKER_DRAW.move : TRACKER_DRAW.idle);
      const im = loadImg(bodyFrames[frameIndex(
        bodyFrames,
        shooting ? 12 : (moving ? 8 : 6),
        shooting ? vis.taserUntil - 260 : 0
      )]);
      if (!drawAnchored(ctx, im, TRACKER_DRAW_H, TRACKER_DRAW.pivotX, TRACKER_DRAW.pivotY, color)) {
        ctx.fillStyle = "#7ec8c4";
        ctx.fillRect(-12, -16, 24, 32);
      }
    }
    ctx.restore();
    if (role === "hunter" && !dead && now < vis.muzzleUntil) {
      const bodyH = 82;
      const mx = HUNTER_DRAW.muzzleX * bodyH * (313 / 207);
      const my = HUNTER_DRAW.muzzleY * bodyH;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      ctx.save();
      ctx.translate(s.x + mx * cs - my * sn, s.y + mx * sn + my * cs);
      ctx.rotate(ang);
      ctx.fillStyle = "rgba(255,220,90,.92)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(16, -5);
      ctx.lineTo(16, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(isMe ? "YOU" : (p.role === "hunter" ? "HUNTER" : "TRACKER"), s.x, s.y - 48);
    ctx.restore();
  }

  function tintSprite(im, color) {
    const key = im.src + "|" + color;
    if (IMG[key]) return IMG[key];
    const c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    IMG[key] = c;
    return c;
  }

  function nearestPlayerVec(m) {
    let best = null;
    let bestD = Infinity;
    (state.players || []).forEach((p) => {
      if (p.dead) return;
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { x: dx, y: dy }; }
    });
    return best;
  }

  function drawMonster(ctx, m) {
    const s = worldToScreen(ctx, m.x, m.y);
    const now = Date.now();
    const auth = (state && state.monster) || m;
    const dead = auth.hp <= 0 || !!vis.monsterDeathAt;
    const stunned = !!auth.stunned && !dead;
    const moving = !dead && !stunned && auth.moving === true;
    const attacking = !dead && !stunned && (auth.windup || now < vis.monsterAttackUntil);
    if ((auth.windup || auth.rushing) && typeof auth.faceX === "number") {
      vis.monsterFace = { x: auth.faceX, y: auth.faceY };
    }
    const old = prev && prev.monster;
    if (attacking) {
      const toward = nearestPlayerVec(auth);
      if (toward && Math.hypot(toward.x, toward.y) > 1) vis.monsterFace = toward;
    } else if (moving && old) {
      const dx = auth.x - old.x;
      const dy = auth.y - old.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) vis.monsterFace = { x: dx, y: dy };
    }
    const face = vis.monsterFace || { x: 1, y: 0 };
    let frames = SPRITE.monster.idle;
    let fps = 6;
    if (dead || stunned) { frames = [SPRITE.monster.idle[0]]; fps = 1; }
    else if (attacking) { frames = SPRITE.monster.attack; fps = 12; }
    else if (moving) { frames = SPRITE.monster.move; fps = 10; }
    else { frames = SPRITE.monster.idle; fps = 6; }
    const im = frameOf(frames, fps, 0);
    const deathAge = vis.monsterDeathAt ? now - vis.monsterDeathAt : 0;
    ctx.save();
    ctx.translate(s.x, s.y);
    if (stunned) ctx.translate(Math.sin(now / 28) * 2.2, 0);
    // The sheet faces right. Rotate that forward axis onto movement or the attack target.
    ctx.rotate(Math.atan2(face.y, face.x));
    ctx.imageSmoothingEnabled = true;
    const fade = dead ? Math.max(0.15, 1 - Math.max(0, deathAge - 720) / 800) : 1;
    ctx.globalAlpha = fade;
    if (!drawSprite(ctx, im, 108)) {
      ctx.fillStyle = "rgba(90, 40, 36, .8)";
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 18, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (stunned) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = "rgba(255,240,80,.9)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + now / 80;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
        ctx.lineTo(Math.cos(a) * 32, Math.sin(a) * 32);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffe066";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("STUNNED", 0, -62);
      ctx.restore();
    }
  }

  function draw() {
    if (!hhCanvas || !state) return;
    const ctx = hhCanvas.getContext("2d");
    const map = state.map || { w: 1400, h: 900, obstacles: [] };
    const t = interpT();
    const livePlayers = (state.players || []).map((p) => {
      const old = prev && (prev.players || []).find((o) => o.id === p.id);
      return interpPos(old, p, t);
    });
    const me = livePlayers.find((p) => p.id === socket.id) || meFrom(state);
    const viewW = hhCanvas.width;
    const viewH = hhCanvas.height;
    const scale = Math.min(viewW / 900, viewH / 520);
    const scareK = vis.scareUntil > Date.now() ? (vis.scareUntil - Date.now()) / 420 : 0;
    const shakeX = scareK ? (Math.random() - 0.5) * 16 * scareK : 0;
    const shakeY = scareK ? (Math.random() - 0.5) * 12 * scareK : 0;
    ctx.setTransform(scale, 0, 0, scale, shakeX, shakeY);
    const vw = viewW / scale;
    const vh = viewH / scale;
    cam.viewW = vw;
    cam.viewH = vh;
    if (me) {
      cam.x = clamp(me.x - vw / 2, 0, Math.max(0, map.w - vw));
      cam.y = clamp(me.y - vh / 2, 0, Math.max(0, map.h - vh));
    }
    ctx.fillStyle = "#1a1510";
    ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = "#2a2218";
    const tileX0 = Math.max(0, Math.floor(cam.x / 70) * 70);
    const tileY0 = Math.max(0, Math.floor(cam.y / 70) * 70);
    const tileX1 = Math.min(map.w, cam.x + vw + 70);
    const tileY1 = Math.min(map.h, cam.y + vh + 70);
    for (let x = tileX0; x < tileX1; x += 70) {
      for (let y = tileY0; y < tileY1; y += 70) {
        const p = worldToScreen(ctx, x, y);
        ctx.fillRect(p.x, p.y, 68, 68);
      }
    }
    ctx.strokeStyle = "rgba(196,160,60,.18)";
    ctx.lineWidth = 4;
    for (let x = 140; x < map.w; x += 280) {
      if (x < cam.x - 20 || x > cam.x + vw + 20) continue;
      const a = worldToScreen(ctx, x, 40);
      ctx.strokeRect(a.x, a.y, 8, map.h - 80);
    }
    ctx.strokeStyle = "#3d2f22";
    ctx.lineWidth = 16;
    const origin = worldToScreen(ctx, 8, 8);
    ctx.strokeRect(origin.x, origin.y, map.w - 16, map.h - 16);
    (map.obstacles || []).forEach((o) => drawObstacle(ctx, o));
    (state.impacts || []).forEach((i) => {
      const p = worldToScreen(ctx, i.x, i.y);
      ctx.fillStyle = i.kind === "hit" ? "rgba(255,200,80,.7)" : "rgba(200,200,200,.45)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
    });
    (state.projectiles || []).forEach((b) => {
      const old = prev && (prev.projectiles || []).find((o) => o.id === b.id);
      const ib = interpPos(old, b, t) || b;
      const p = worldToScreen(ctx, ib.x, ib.y);
      ctx.fillStyle = "#ffd866";
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    });
    if (myRole === "tracker") {
      (state.taserBeams || []).forEach((b) => {
        const a = worldToScreen(ctx, b.x0, b.y0);
        const c = worldToScreen(ctx, b.x1, b.y1);
        ctx.strokeStyle = b.hit ? "rgba(255,240,80,.95)" : "rgba(120,230,255,.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      });
    }
    if (myRole === "tracker" && state.monster) {
      const oldM = prev && prev.monster;
      drawMonster(ctx, interpPos(oldM, state.monster, t) || state.monster);
    }
    livePlayers.forEach((p) => drawPlayer(ctx, p, p.id === socket.id));
    const fog = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.28, vw / 2, vh / 2, vw * 0.78);
    fog.addColorStop(0, "rgba(0,0,0,0)");
    fog.addColorStop(1, "rgba(8,4,6,.42)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, vw, vh);
    if (myRole === "tracker") {
      const g = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.2, vw / 2, vh / 2, vw * 0.72);
      g.addColorStop(0, "rgba(80,210,230,0)");
      g.addColorStop(1, "rgba(20,70,90,.28)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
      if (state.monster) {
        ctx.fillStyle = "#9ee7ff";
        ctx.font = "12px Arial";
        ctx.textAlign = "left";
        ctx.fillText("MONSTER HP " + state.monster.hp + "/" + state.monster.maxHp, 16, 22);
      }
    }
    if (vis.telegraphUntil > Date.now()) {
      const pulse = (vis.telegraphUntil - Date.now()) / 650;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const edge = ctx.createRadialGradient(viewW / 2, viewH / 2, viewW * 0.28, viewW / 2, viewH / 2, viewW * 0.62);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(1, "rgba(160, 40, 20, " + (0.45 * pulse) + ")");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
    if (scareK > 0) {
      const face = loadImg(SPRITE.monster.idle[0]);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(80, 0, 6, " + (0.5 * scareK) + ")";
      ctx.fillRect(0, 0, viewW, viewH);
      if (spriteReady(face)) {
        const size = viewH * (0.34 + 0.16 * scareK);
        ctx.globalAlpha = Math.min(1, scareK * 1.25);
        ctx.drawImage(face, (viewW - size) / 2, (viewH - size) * 0.42, size, size * (face.naturalHeight / face.naturalWidth));
      }
      ctx.restore();
    }
    if (hhTaser && myRole === "tracker" && state.taser) {
      const left = Math.max(0, (state.taser.remainingMs || 0) - (Date.now() - (state._recvAt || Date.now())));
      hhTaser.textContent = left <= 0 ? "TASER READY" : ("TASER " + (left / 1000).toFixed(1) + "s");
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function shownPlayer(p) {
    if (!p) return null;
    const old = prev && (prev.players || []).find((o) => o.id === p.id);
    return interpPos(old, p, interpT()) || p;
  }

  function canvasAim(ev) {
    if (!hhCanvas || !state) return;
    const me = shownPlayer(meFrom(state));
    if (!me) return;
    const rect = hhCanvas.getBoundingClientRect();
    const scaleX = hhCanvas.width / rect.width;
    const scaleY = hhCanvas.height / rect.height;
    const ctxScale = Math.min(hhCanvas.width / 900, hhCanvas.height / 520);
    const mx = ((ev.clientX - rect.left) * scaleX) / ctxScale + cam.x;
    const my = ((ev.clientY - rect.top) * scaleY) / ctxScale + cam.y;
    const n = { x: mx - me.x, y: my - me.y };
    const d = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
    mouseAim = { x: n.x / d, y: n.y / d };
  }

  function bindJoystick(el, knob, onVec) {
    if (!el || el.dataset.wired) return;
    el.dataset.wired = "1";
    let pid = null;
    function setFrom(t) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let x = (t.clientX - cx) / (r.width * 0.42);
      let y = (t.clientY - cy) / (r.height * 0.42);
      const d = Math.sqrt(x * x + y * y) || 1;
      if (d > 1) { x /= d; y /= d; }
      if (knob) {
        knob.style.transform = "translate(" + (x * 18) + "px," + (y * 18) + "px)";
      }
      onVec(x, y);
    }
    el.addEventListener("pointerdown", (e) => {
      pid = e.pointerId;
      el.setPointerCapture(pid);
      setFrom(e);
    });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === pid) setFrom(e); });
    function end(e) {
      if (e.pointerId !== pid) return;
      pid = null;
      if (knob) knob.style.transform = "";
      onVec(0, 0);
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function wireControls() {
    if (!hhCanvas || hhCanvas.dataset.wired) return;
    hhCanvas.dataset.wired = "1";
    window.addEventListener("keydown", (e) => {
      if (!active) return;
      keys[e.code] = true;
      if (e.code === "KeyR" && myRole === "hunter") {
        socket.emit("hiddenHunterReload", { roomCode: currentRoom });
      }
    });
    window.addEventListener("keyup", (e) => { keys[e.code] = false; });
    hhCanvas.addEventListener("mousemove", canvasAim);
    hhCanvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) { canvasAim(e); fireWeapon(); }
    });
    bindJoystick($("hhJoyMove"), $("hhJoyMoveKnob"), (x, y) => { moveJoy = { x, y }; });
    bindJoystick($("hhJoyAim"), $("hhJoyAimKnob"), (x, y) => {
      if (Math.abs(x) + Math.abs(y) > 0.2) aimJoy = { x, y };
    });
    if (hhShootBtn) hhShootBtn.onclick = fireWeapon;
    if (hhTaserBtn) hhTaserBtn.onclick = fireWeapon;
    if (hhPlayAgainBtn) {
      hhPlayAgainBtn.onclick = () => {
        socket.emit("hiddenHunterPlayAgain", { roomCode: currentRoom });
        hhPlayAgainBtn.disabled = true;
        hhPlayAgainBtn.textContent = "Waiting for partner...";
      };
    }
    if (hhLobbyBtn) hhLobbyBtn.onclick = returnToLobby;
    if (hhFsBtn) {
      hhFsBtn.onclick = () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else if (hiddenHunterScreen.requestFullscreen) {
          hiddenHunterScreen.requestFullscreen().catch(() => {});
        } else if (hiddenHunterScreen.webkitRequestFullscreen) {
          hiddenHunterScreen.webkitRequestFullscreen();
        }
      };
    }
    window.addEventListener("resize", () => { if (active) sizeCanvas(); });
  }

  function init(sharedSocket) {
    socket = sharedSocket;
    socket.on("hiddenHunterStarted", (data) => {
      if (!bindDom()) return;
      wireControls();
      applyState(data);
      if (hhPlayAgainBtn) {
        hhPlayAgainBtn.disabled = false;
        hhPlayAgainBtn.textContent = "Play Again";
        hhPlayAgainBtn.classList.remove("hidden");
      }
      if (hhMsg) hhMsg.textContent = "Talk outside the game — there is no chat.";
      vis.shootUntil = vis.taserUntil = vis.muzzleUntil = vis.monsterAttackUntil = vis.monsterDeathAt = 0;
      vis.scareUntil = vis.telegraphUntil = 0;
      vis.monsterFace = { x: 0, y: 1 };
      vis.face = Object.create(null);
      vis.lastHp = Object.create(null);
      vis.lastMonster = null;
      preloadSprites();
      showScreen();
    });
    socket.on("hiddenHunterState", (data) => {
      if (!active) return;
      applyState(data);
    });
    socket.on("hiddenHunterOver", (data) => {
      if (!active) return;
      if (hhMsg) hhMsg.textContent = data.message || "Match over.";
    });
    socket.on("hiddenHunterHurt", () => {
      if (!active) return;
      vis.scareUntil = Date.now() + 420;
      vis.monsterAttackUntil = Date.now() + 380;
      if (hhFlash) {
        hhFlash.classList.add("show");
        setTimeout(() => { if (hhFlash) hhFlash.classList.remove("show"); }, 280);
      }
    });
    socket.on("hiddenHunterRushTelegraph", () => {
      if (!active) return;
      vis.telegraphUntil = Date.now() + 650;
    });
    socket.on("hiddenHunterShot", () => {
      if (!active) return;
      vis.shootUntil = Date.now() + 220;
      vis.muzzleUntil = Date.now() + 90;
    });
    socket.on("hiddenHunterTaserFired", (data) => {
      if (!active || myRole !== "tracker") return;
      vis.taserUntil = Date.now() + 260;
      if (hhTaser && data) {
        const left = Math.max(0, data.remainingMs || 0);
        hhTaser.textContent = left <= 0 ? "TASER READY" : ("TASER " + (left / 1000).toFixed(1) + "s");
      }
    });
    socket.on("hiddenHunterPlayAgainWait", () => {
      if (hhPlayAgainBtn) hhPlayAgainBtn.textContent = "Waiting for partner...";
    });
    socket.on("hiddenHunterReset", () => {
      vis.shootUntil = vis.taserUntil = vis.muzzleUntil = vis.monsterAttackUntil = vis.monsterDeathAt = 0;
      vis.scareUntil = vis.telegraphUntil = 0;
      vis.monsterFace = { x: 0, y: 1 };
      vis.face = Object.create(null);
      vis.lastHp = Object.create(null);
      vis.lastMonster = null;
      if (hhPlayAgainBtn) {
        hhPlayAgainBtn.disabled = false;
        hhPlayAgainBtn.textContent = "Play Again";
      }
    });
    socket.on("playerLeft", () => {
      partnerDisconnected();
    });
    if (bindDom()) { preloadSprites(); wireControls(); }
  }

  function returnToLobby() {
    hideScreen();
    currentRoom = null;
    state = null;
    prev = null;
    myRole = null;
    if (lobbyScreen) lobbyScreen.classList.remove("hidden");
  }

  function partnerDisconnected() {
    if (!active) return false;
    if (hhBanner) hhBanner.textContent = "YOUR PARTNER DISCONNECTED";
    if (hhMsg) hhMsg.textContent = "The match has stopped.";
    if (hhEndButtons) hhEndButtons.classList.remove("hidden");
    if (hhPlayAgainBtn) hhPlayAgainBtn.classList.add("hidden");
    if (hhLobbyBtn) hhLobbyBtn.classList.remove("hidden");
    if (state) state = Object.assign({}, state, { phase: "over", disconnected: true });
    return true;
  }

  function isActive() { return active; }
  function showError(msg) {
    if (!active || !hhMsg) return false;
    hhMsg.textContent = msg;
    return true;
  }

  window.HiddenHunter = { init, isActive, showError, partnerDisconnected };
})();
