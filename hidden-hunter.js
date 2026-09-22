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
      if (data.monster || data.taser || data.taserBeams) {
        data = Object.assign({}, data);
        delete data.monster;
        delete data.taser;
        delete data.taserBeams;
      }
    }
    if (state) prev = state;
    state = data;
    state._recvAt = Date.now();
    if (data.room) currentRoom = data.room;
    myRole = data.you ? data.you.role : myRole;
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
    const aim = touchMode ? aimJoy : mouseAim;
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
    const aim = touchMode ? aimJoy : mouseAim;
    if (myRole === "hunter") {
      socket.emit("hiddenHunterShoot", { roomCode: currentRoom, aimX: aim.x, aimY: aim.y });
    } else if (myRole === "tracker") {
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

  function drawObstacle(ctx, o) {
    const p = worldToScreen(ctx, o.x, o.y);
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

  function drawPlayer(ctx, p, isMe) {
    const s = worldToScreen(ctx, p.x, p.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = p.role === "hunter" ? "#4f9cff" : "#74df9b";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    if (p.role === "tracker") {
      ctx.strokeStyle = "#b8ffd4";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -4, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(116,223,155,.45)";
      ctx.beginPath(); ctx.arc(-4, -4, 4, 0, Math.PI * 2); ctx.arc(4, -4, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (p.role === "hunter") {
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(8 + p.aimX * 28, p.aimY * 28);
      ctx.stroke();
    }
    if (p.role === "tracker") {
      const showAim = isMe && myRole === "tracker";
      ctx.strokeStyle = "#7cf0ff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(6, 2);
      if (showAim) ctx.lineTo(6 + p.aimX * 22, 2 + p.aimY * 22);
      else ctx.lineTo(22, 6);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(isMe ? "YOU" : (p.role === "hunter" ? "HUNTER" : "TRACKER"), 0, -26);
    ctx.restore();
  }

  function drawMonster(ctx, m) {
    const s = worldToScreen(ctx, m.x, m.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (m.stunned) {
      ctx.shadowColor = "#ffe066";
      ctx.shadowBlur = 28;
      ctx.strokeStyle = "rgba(255,240,80,.9)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Date.now() / 80;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 18, Math.sin(ang) * 22);
        ctx.lineTo(Math.cos(ang) * 34, Math.sin(ang) * 38);
        ctx.stroke();
      }
    }
    ctx.shadowColor = m.hit ? "#ff6b6b" : (m.stunned ? "#ffe066" : "#7cf0ff");
    ctx.shadowBlur = 22;
    ctx.fillStyle = m.hit ? "rgba(255,80,80,.85)" : (m.stunned ? "rgba(255,230,90,.8)" : "rgba(90,230,255,.75)");
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e9ffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (m.stunned) {
      ctx.fillStyle = "#ffe066";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.shadowBlur = 0;
      ctx.fillText("STUNNED", 0, -40);
    }
    ctx.restore();
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
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const vw = viewW / scale;
    const vh = viewH / scale;
    if (me) {
      cam.x = clamp(me.x - vw / 2, 0, Math.max(0, map.w - vw));
      cam.y = clamp(me.y - vh / 2, 0, Math.max(0, map.h - vh));
    }
    ctx.fillStyle = "#1a1510";
    ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = "#2a2218";
    for (let x = 0; x < map.w; x += 70) {
      for (let y = 0; y < map.h; y += 70) {
        const p = worldToScreen(ctx, x, y);
        ctx.fillRect(p.x, p.y, 68, 68);
      }
    }
    ctx.strokeStyle = "rgba(196,160,60,.18)";
    ctx.lineWidth = 4;
    for (let x = 140; x < map.w; x += 280) {
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
    if (hhTaser && myRole === "tracker" && state.taser) {
      const left = Math.max(0, (state.taser.remainingMs || 0) - (Date.now() - (state._recvAt || Date.now())));
      hhTaser.textContent = left <= 0 ? "TASER READY" : ("TASER " + (left / 1000).toFixed(1) + "s");
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function canvasAim(ev) {
    if (!hhCanvas || !state) return;
    const me = meFrom(state);
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
      if (!active || !hhFlash) return;
      hhFlash.classList.add("show");
      setTimeout(() => { if (hhFlash) hhFlash.classList.remove("show"); }, 180);
    });
    socket.on("hiddenHunterTaserFired", (data) => {
      if (!active || myRole !== "tracker" || !hhTaser || !data) return;
      const left = Math.max(0, data.remainingMs || 0);
      hhTaser.textContent = left <= 0 ? "TASER READY" : ("TASER " + (left / 1000).toFixed(1) + "s");
    });
    socket.on("hiddenHunterPlayAgainWait", () => {
      if (hhPlayAgainBtn) hhPlayAgainBtn.textContent = "Waiting for partner...";
    });
    socket.on("hiddenHunterReset", () => {
      if (hhPlayAgainBtn) {
        hhPlayAgainBtn.disabled = false;
        hhPlayAgainBtn.textContent = "Play Again";
      }
    });
    socket.on("playerLeft", () => {
      partnerDisconnected();
    });
    if (bindDom()) wireControls();
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
