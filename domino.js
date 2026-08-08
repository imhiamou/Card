/* Dominoes — client module (isolated from Hidden Hunt / Word Chain / Code Breaker). */
(function () {
  const PIP_LAYOUTS = {
    0: [],
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]]
  };

  const SCREEN_HTML =
    '<div class="domTitleRow">' +
      '<h2>Dominoes</h2>' +
      '<div class="domMeta" id="domMeta"></div>' +
    '</div>' +
    '<div class="domPlayers" id="domPlayers"></div>' +
    '<h2 id="domTurnIndicator"></h2>' +
    '<div class="domBoardWrap" id="domBoardWrap">' +
      '<div class="domBoardInner" id="domBoardInner"></div>' +
    '</div>' +
    '<div class="domEnds">' +
      '<span id="domLeftEnd">Left: —</span>' +
      '<span id="domBoneyard">Boneyard: 0</span>' +
      '<span id="domRightEnd">Right: —</span>' +
    '</div>' +
    '<div class="domHandSection">' +
      '<h3>Your hand</h3>' +
      '<div class="domHand" id="domHand"></div>' +
    '</div>' +
    '<div class="domSidePicker" id="domSidePicker">' +
      '<button type="button" id="domPlayLeft">Play Left</button>' +
      '<button type="button" id="domPlayRight">Play Right</button>' +
    '</div>' +
    '<div class="domActions">' +
      '<button type="button" id="domDrawBtn" disabled>Draw</button>' +
    '</div>' +
    '<p id="domMsg"></p>' +
    '<div id="domScoreboard" class="domScoreboard hidden"></div>' +
    '<div id="domEndButtons" class="domEndButtons hidden">' +
      '<button type="button" id="domPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let myTurn = false;
  let players = [];
  let hand = [];
  let validMoves = [];
  let board = null;
  let selectedTileId = null;
  let canDraw = false;
  let panX = 0;
  let panY = 0;
  let scale = 1;
  let dragging = false;
  let dragStart = null;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let domPlayers;
  let domTurnIndicator;
  let domBoardWrap;
  let domBoardInner;
  let domLeftEnd;
  let domRightEnd;
  let domBoneyard;
  let domHand;
  let domMsg;
  let domDrawBtn;
  let domSidePicker;
  let domPlayLeft;
  let domPlayRight;
  let domScoreboard;
  let domEndButtons;
  let domPlayAgainBtn;
  let domMeta;

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
    if (!dominoScreen) return false;
    if (!dominoScreen.dataset.ready) {
      dominoScreen.innerHTML = SCREEN_HTML;
      dominoScreen.dataset.ready = "1";
    }
    domPlayers = $("domPlayers");
    domTurnIndicator = $("domTurnIndicator");
    domBoardWrap = $("domBoardWrap");
    domBoardInner = $("domBoardInner");
    domLeftEnd = $("domLeftEnd");
    domRightEnd = $("domRightEnd");
    domBoneyard = $("domBoneyard");
    domHand = $("domHand");
    domMsg = $("domMsg");
    domDrawBtn = $("domDrawBtn");
    domSidePicker = $("domSidePicker");
    domPlayLeft = $("domPlayLeft");
    domPlayRight = $("domPlayRight");
    domScoreboard = $("domScoreboard");
    domEndButtons = $("domEndButtons");
    domPlayAgainBtn = $("domPlayAgainBtn");
    domMeta = $("domMeta");
    return true;
  }

  /* ---- SVG tile rendering (programmatic double-six faces) ---- */

  function pipGroup(value, x, y, w, h) {
    const layout = PIP_LAYOUTS[value] || [];
    const r = Math.min(w, h) * 0.09;
    return layout.map(([px, py]) => {
      const cx = x + px * w;
      const cy = y + py * h;
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1a1a1a"/>';
    }).join("");
  }

  let svgUid = 0;

  /** Build an SVG domino face. vertical=true → tall tile (hand / doubles on board). */
  function tileSvg(leftPip, rightPip, vertical) {
    const W = vertical ? 44 : 88;
    const H = vertical ? 88 : 44;
    const halfW = vertical ? W : W / 2;
    const halfH = vertical ? H / 2 : H;
    const radius = 6;
    const gradId = "domFace" + (++svgUid);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
      '" width="' + W + '" height="' + H + '">';
    svg += '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#f7f3e8"/>' +
      '<stop offset="100%" stop-color="#e4dcc8"/>' +
      "</linearGradient></defs>";
    svg += '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) +
      '" rx="' + radius + '" ry="' + radius +
      '" fill="url(#' + gradId + ')" stroke="#2a2a2a" stroke-width="1.5"/>';
    if (vertical) {
      svg += '<line x1="6" y1="' + (H / 2) + '" x2="' + (W - 6) + '" y2="' + (H / 2) +
        '" stroke="#333" stroke-width="1.5"/>';
      svg += pipGroup(leftPip, 4, 4, W - 8, halfH - 8);
      svg += pipGroup(rightPip, 4, halfH + 4, W - 8, halfH - 8);
    } else {
      svg += '<line x1="' + (W / 2) + '" y1="6" x2="' + (W / 2) + '" y2="' + (H - 6) +
        '" stroke="#333" stroke-width="1.5"/>';
      svg += pipGroup(leftPip, 4, 4, halfW - 8, H - 8);
      svg += pipGroup(rightPip, halfW + 4, 4, halfW - 8, H - 8);
    }
    svg += "</svg>";
    return svg;
  }

  function makeTileEl(leftPip, rightPip, options) {
    const opts = options || {};
    const vertical = !!opts.vertical;
    const el = document.createElement("div");
    el.className = "domTile svgHost" + (vertical ? "" : " horizontal") +
      (opts.extraClass ? " " + opts.extraClass : "");
    el.innerHTML = tileSvg(leftPip, rightPip, vertical);
    if (opts.tileId) el.dataset.tileId = opts.tileId;
    return el;
  }

  /* ---- Screen / pan ---- */

  function showDominoScreen() {
    active = true;
    if (lobbyScreen) lobbyScreen.classList.add("hidden");
    if (placementScreen) placementScreen.classList.add("hidden");
    if (gameScreen) gameScreen.classList.add("hidden");
    if (wordChainScreen) wordChainScreen.classList.add("hidden");
    if (codeBreakerScreen) codeBreakerScreen.classList.add("hidden");
    dominoScreen.classList.remove("hidden");
  }

  function hideDominoScreen() {
    active = false;
    if (dominoScreen) dominoScreen.classList.add("hidden");
  }

  function applyPan() {
    if (!domBoardInner) return;
    domBoardInner.style.transform =
      "translate(" + panX + "px," + panY + "px) scale(" + scale + ")";
  }

  function resetPan() {
    panX = 0;
    panY = 0;
    scale = 1;
    applyPan();
  }

  function centerBoard() {
    if (!domBoardWrap || !domBoardInner) return;
    const wrap = domBoardWrap.getBoundingClientRect();
    const inner = domBoardInner.getBoundingClientRect();
    // Reset scale first for measurement via offset sizes
    const iw = domBoardInner.scrollWidth || inner.width / (scale || 1);
    const ih = domBoardInner.scrollHeight || inner.height / (scale || 1);
    const fit = Math.min(1, (wrap.width - 40) / Math.max(iw, 1), (wrap.height - 40) / Math.max(ih, 1));
    scale = Math.max(0.45, fit);
    panX = -((iw * scale) / 2);
    panY = -((ih * scale) / 2);
    applyPan();
  }

  function wireBoardPan() {
    if (!domBoardWrap || domBoardWrap.dataset.panWired) return;
    domBoardWrap.dataset.panWired = "1";

    const onDown = (clientX, clientY) => {
      dragging = true;
      dragStart = { x: clientX, y: clientY, panX, panY };
      domBoardWrap.classList.add("dragging");
    };
    const onMove = (clientX, clientY) => {
      if (!dragging || !dragStart) return;
      panX = dragStart.panX + (clientX - dragStart.x);
      panY = dragStart.panY + (clientY - dragStart.y);
      applyPan();
    };
    const onUp = () => {
      dragging = false;
      dragStart = null;
      domBoardWrap.classList.remove("dragging");
    };

    domBoardWrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      onDown(e.clientX, e.clientY);
    });
    window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("mouseup", onUp);

    domBoardWrap.addEventListener("touchstart", (e) => {
      if (!e.touches[0]) return;
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    domBoardWrap.addEventListener("touchmove", (e) => {
      if (!e.touches[0]) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    domBoardWrap.addEventListener("touchend", onUp);

    domBoardWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const next = scale + (e.deltaY < 0 ? 0.08 : -0.08);
      scale = Math.min(1.6, Math.max(0.35, next));
      applyPan();
    }, { passive: false });
  }

  /* ---- Render ---- */

  function hideEndUi() {
    if (domScoreboard) {
      domScoreboard.classList.add("hidden");
      domScoreboard.innerHTML = "";
    }
    if (domEndButtons) {
      domEndButtons.classList.add("hidden");
      if (domPlayAgainBtn) {
        domPlayAgainBtn.disabled = false;
        domPlayAgainBtn.textContent = "Play Again";
      }
    }
  }

  function showEndUi(scores, winnerId, message) {
    if (!domScoreboard) return;
    let html = "<h3>Scoreboard</h3>";
    (scores || []).forEach((row) => {
      const win = row.id === winnerId;
      html += '<div class="domScoreRow' + (win ? " winner" : "") + '">' +
        "<span>" + (row.name || "Player") + (win ? " ★" : "") + "</span>" +
        "<span>" + row.points + " points</span></div>";
    });
    const winner = (scores || []).find((r) => r.id === winnerId);
    html += '<div class="domScoreRow winner"><span>Winner</span><span>' +
      (winner ? winner.name : "—") + "</span></div>";
    if (message) html += "<p>" + message + "</p>";
    domScoreboard.innerHTML = html;
    domScoreboard.classList.remove("hidden");
    if (domEndButtons) domEndButtons.classList.remove("hidden");
  }

  function renderPlayers(currentTurnId) {
    if (!domPlayers) return;
    domPlayers.innerHTML = "";
    players.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "domPlayerChip" + (p.id === currentTurnId && !gameOver ? " turn" : "");
      const isMe = socket && p.id === socket.id;
      chip.innerHTML = '<div class="domName">' + (isMe ? "You" : (p.name || "Player")) +
        '</div><div class="domCount">' + p.handCount + " dominoes remaining</div>";
      domPlayers.appendChild(chip);
    });
  }

  function renderBoard(animateId) {
    if (!domBoardInner || !board) return;
    domBoardInner.innerHTML = "";
    (board.chain || []).forEach((tile) => {
      const vertical = !!tile.isDouble;
      const el = makeTileEl(tile.leftPip, tile.rightPip, {
        vertical,
        extraClass: "boardTile" + (animateId && tile.id === animateId ? " playAnim" : ""),
        tileId: tile.id
      });
      domBoardInner.appendChild(el);
    });
    if (domLeftEnd) {
      domLeftEnd.textContent = board.leftEnd == null ? "Left: —" : "Left: " + board.leftEnd;
    }
    if (domRightEnd) {
      domRightEnd.textContent = board.rightEnd == null ? "Right: —" : "Right: " + board.rightEnd;
    }
    if (domBoneyard) {
      domBoneyard.textContent = "Boneyard: " + (board.boneyardCount || 0);
    }
    requestAnimationFrame(centerBoard);
  }

  function movesForTile(tileId) {
    return validMoves.filter((m) => m.tileId === tileId);
  }

  function renderHand(animateDrawId) {
    if (!domHand) return;
    domHand.innerHTML = "";
    hand.forEach((tile) => {
      const moves = movesForTile(tile.id);
      const el = makeTileEl(tile.a, tile.b, {
        vertical: true,
        extraClass: "inHand" +
          (moves.length && myTurn && !gameOver ? " valid" : "") +
          (selectedTileId === tile.id ? " selected" : "") +
          (animateDrawId && tile.id === animateDrawId ? " drawAnim" : ""),
        tileId: tile.id
      });
      el.onclick = () => onHandClick(tile.id);
      domHand.appendChild(el);
    });
  }

  function renderChrome(data) {
    const currentTurnId = data.currentTurnId;
    const current = players.find((p) => p.id === currentTurnId);
    if (gameOver) {
      domTurnIndicator.textContent = "Round Over";
    } else if (myTurn) {
      if (board && board.mustPlayId) {
        domTurnIndicator.textContent = "Your turn — play " + board.mustPlayId.replace("-", "|");
      } else {
        domTurnIndicator.textContent = "Your Turn";
      }
    } else {
      domTurnIndicator.textContent = (current ? current.name : "Opponent") + "'s Turn";
    }
    if (domMeta) {
      domMeta.textContent = players.length + " players · Double-Six";
    }
    if (domDrawBtn) {
      domDrawBtn.disabled = !canDraw || !myTurn || gameOver;
    }
    if (!myTurn || gameOver) hideSidePicker();
  }

  function applyState(data, opts) {
    const options = opts || {};
    currentRoom = data.room || currentRoom;
    players = data.players || players;
    myTurn = !!data.yourTurn;
    hand = data.hand || [];
    validMoves = data.validMoves || [];
    board = data.board || board;
    canDraw = !!data.canDraw;
    gameOver = !!data.over;
    if (gameOver) selectedTileId = null;
    renderPlayers(data.currentTurnId);
    renderBoard(options.animatePlayId);
    renderHand(options.animateDrawId);
    renderChrome(data);
    if (data.over && data.scores) {
      showEndUi(data.scores, data.winnerId, data.message);
    }
  }

  /* ---- Interaction ---- */

  function hideSidePicker() {
    if (domSidePicker) domSidePicker.classList.remove("show");
    selectedTileId = null;
  }

  function showSidePicker() {
    if (domSidePicker) domSidePicker.classList.add("show");
  }

  function onHandClick(tileId) {
    if (!myTurn || gameOver) return;
    const moves = movesForTile(tileId);
    if (!moves.length) {
      domMsg.textContent = "That domino cannot be played right now.";
      return;
    }
    selectedTileId = tileId;
    renderHand();

    if (moves.length === 1 && moves[0].side === "center") {
      // "dominoPlayTile" — Dominoes only.
      socket.emit("dominoPlayTile", { roomCode: currentRoom, tileId, side: "center" });
      hideSidePicker();
      return;
    }

    const sides = new Set(moves.map((m) => m.side));
    if (sides.size === 1) {
      const side = moves[0].side;
      socket.emit("dominoPlayTile", { roomCode: currentRoom, tileId, side });
      hideSidePicker();
      return;
    }

    // Fits both ends — ask which side.
    showSidePicker();
    domMsg.textContent = "This domino fits both ends. Choose a side.";
  }

  function playSelectedSide(side) {
    if (!selectedTileId || !myTurn || gameOver) return;
    socket.emit("dominoPlayTile", {
      roomCode: currentRoom,
      tileId: selectedTileId,
      side
    });
    hideSidePicker();
  }

  function wireControls() {
    if (!domDrawBtn || domDrawBtn.dataset.wired) return;
    domDrawBtn.dataset.wired = "1";
    domDrawBtn.onclick = () => {
      if (!currentRoom || !canDraw || !myTurn || gameOver) return;
      // "dominoDraw" — Dominoes only.
      socket.emit("dominoDraw", { roomCode: currentRoom });
    };
    domPlayLeft.onclick = () => playSelectedSide("left");
    domPlayRight.onclick = () => playSelectedSide("right");
    domPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      // "dominoPlayAgain" — Dominoes only.
      socket.emit("dominoPlayAgain", { roomCode: currentRoom });
      domPlayAgainBtn.disabled = true;
      domPlayAgainBtn.textContent = "Waiting for others...";
    };
    wireBoardPan();
  }

  /* ---- Socket ---- */

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Dominoes screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    selectedTileId = null;
    hideEndUi();
    hideSidePicker();
    resetPan();
    applyState(data);
    showDominoScreen();
    const starter = (data.players || []).find((p) => p.id === data.currentTurnId);
    domMsg.textContent = (starter ? starter.name : "A player") +
      " opens with the highest double.";
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "dominoStarted" — Dominoes only.
    socket.on("dominoStarted", onStarted);

    // "dominoState" — Dominoes only.
    socket.on("dominoState", (data) => {
      if (!active && data && data.game === "dominoes") {
        // Late sync if started event was missed.
        if (!bindDom()) return;
        wireControls();
        showDominoScreen();
      }
      if (!active) return;
      const prevHandIds = new Set(hand.map((t) => t.id));
      applyState(data);
      if (data.hand) {
        const drawn = data.hand.find((t) => !prevHandIds.has(t.id));
        if (drawn) renderHand(drawn.id);
      }
      if (data.over && data.scores) {
        showEndUi(data.scores, data.winnerId, null);
      }
    });

    // "dominoPlayed" — Dominoes only.
    socket.on("dominoPlayed", (data) => {
      if (!active) return;
      if (data.board) board = data.board;
      renderBoard(data.tile && data.tile.id);
      domMsg.textContent = (data.name || "Player") + " played " +
        (data.tile ? data.tile.a + "|" + data.tile.b : "a domino") + ".";
    });

    // "dominoDrawn" — Dominoes only.
    socket.on("dominoDrawn", (data) => {
      if (!active) return;
      if (board) board.boneyardCount = data.boneyardCount;
      if (domBoneyard) domBoneyard.textContent = "Boneyard: " + data.boneyardCount;
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      renderPlayers(null);
      if (data.by !== socket.id) {
        domMsg.textContent = (data.name || "Player") + " drew from the boneyard.";
      } else {
        domMsg.textContent = "You drew a domino.";
      }
    });

    // "dominoPassed" — Dominoes only.
    socket.on("dominoPassed", (data) => {
      if (!active) return;
      domMsg.textContent = (data.name || "Player") + " passes.";
    });

    // "dominoOver" — Dominoes only.
    socket.on("dominoOver", (data) => {
      if (!active) return;
      gameOver = true;
      myTurn = false;
      selectedTileId = null;
      hideSidePicker();
      showEndUi(data.scores, data.winnerId, data.message);
      domTurnIndicator.textContent = "Round Over";
      if (domDrawBtn) domDrawBtn.disabled = true;
      domMsg.textContent = data.message || "Round over.";
    });

    // "dominoPlayAgainWait" — Dominoes only.
    socket.on("dominoPlayAgainWait", () => {
      if (!active || !domPlayAgainBtn) return;
      domPlayAgainBtn.textContent = "Waiting for others...";
    });

    // "dominoReset" — Dominoes only.
    socket.on("dominoReset", () => {
      if (!active) return;
      gameOver = false;
      hideEndUi();
      hideSidePicker();
      domMsg.textContent = "New round!";
    });

    // "dominoLobbyUpdate" — Dominoes only. Waiting for the lobby to fill.
    socket.on("dominoLobbyUpdate", (data) => {
      const statusEl = $("status");
      const codeEl = $("code");
      if (data && data.room && codeEl) codeEl.textContent = "Lobby Code: " + data.room;
      if (statusEl && data) {
        statusEl.textContent = "Waiting for players (" +
          data.players.length + "/" + data.maxPlayers + ")...";
      }
      if (data && data.room) currentRoom = data.room;
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideDominoScreen();
      currentRoom = null;
      gameOver = false;
    });

    if (bindDom()) wireControls();
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !domMsg) return false;
    domMsg.textContent = msg;
    return true;
  }

  window.Dominoes = { init, isActive, showError };
})();
