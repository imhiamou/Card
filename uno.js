/* UNO — client module (isolated from all other games). */
(function () {
  const COLOR_HEX = {
    red: "#e23b3b",
    blue: "#2f6bdc",
    green: "#2f9e44",
    yellow: "#e6c200"
  };

  const SCREEN_HTML =
    '<div class="unoTitleRow">' +
      '<h2>UNO</h2>' +
      '<div class="unoMeta" id="unoMeta"></div>' +
    '</div>' +
    '<div class="unoPlayers" id="unoPlayers"></div>' +
    '<h2 id="unoTurnIndicator"></h2>' +
    '<div class="unoTable">' +
      '<div class="unoPileCol">' +
        '<div id="unoDrawPile" class="unoCard"></div>' +
        '<div class="unoPileLabel" id="unoDrawLabel">Draw</div>' +
      '</div>' +
      '<div class="unoPileCol">' +
        '<div id="unoDiscardPile" class="unoCard"></div>' +
        '<div class="unoPileLabel">Discard</div>' +
      '</div>' +
    '</div>' +
    '<div class="unoColorBar">' +
      '<span>Current color</span>' +
      '<span class="unoColorDot" id="unoColorDot"></span>' +
      '<span id="unoColorText">—</span>' +
      '<span id="unoDirText"></span>' +
      '<span id="unoPenaltyText"></span>' +
    '</div>' +
    '<div class="unoHandSection">' +
      '<h3>Your hand</h3>' +
      '<div class="unoHand" id="unoHand"></div>' +
    '</div>' +
    '<div class="unoColorPicker hidden" id="unoColorPicker">' +
      '<button type="button" class="pickRed" data-color="red">Red</button>' +
      '<button type="button" class="pickBlue" data-color="blue">Blue</button>' +
      '<button type="button" class="pickGreen" data-color="green">Green</button>' +
      '<button type="button" class="pickYellow" data-color="yellow">Yellow</button>' +
    '</div>' +
    '<div class="unoActions">' +
      '<button type="button" id="unoDrawBtn" disabled>Draw</button>' +
      '<button type="button" id="unoCallBtn" class="hidden">UNO!</button>' +
    '</div>' +
    '<p id="unoMsg"></p>' +
    '<div id="unoScoreboard" class="unoScoreboard hidden"></div>' +
    '<div id="unoEndButtons" class="unoEndButtons hidden">' +
      '<button type="button" id="unoPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let myTurn = false;
  let players = [];
  let hand = [];
  let playableIds = [];
  let topCard = null;
  let currentColor = null;
  let direction = 1;
  let pendingPenalty = 0;
  let canDraw = false;
  let canTakePenalty = false;
  let mustPickColor = false;
  let drawnPlayableId = null;
  let pendingWildId = null;
  let svgUid = 0;

  let lobbyScreen, placementScreen, gameScreen, wordChainScreen, codeBreakerScreen, dominoScreen;
  let unoScreen, unoPlayers, unoTurnIndicator, unoDrawPile, unoDiscardPile, unoDrawLabel;
  let unoColorDot, unoColorText, unoDirText, unoPenaltyText, unoHand, unoMsg;
  let unoDrawBtn, unoCallBtn, unoColorPicker, unoScoreboard, unoEndButtons, unoPlayAgainBtn, unoMeta;

  function $(id) { return document.getElementById(id); }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    codeBreakerScreen = $("codeBreakerScreen");
    dominoScreen = $("dominoScreen");
    unoScreen = $("unoScreen");
    if (!unoScreen) return false;
    if (!unoScreen.dataset.ready) {
      unoScreen.innerHTML = SCREEN_HTML;
      unoScreen.dataset.ready = "1";
    }
    unoPlayers = $("unoPlayers");
    unoTurnIndicator = $("unoTurnIndicator");
    unoDrawPile = $("unoDrawPile");
    unoDiscardPile = $("unoDiscardPile");
    unoDrawLabel = $("unoDrawLabel");
    unoColorDot = $("unoColorDot");
    unoColorText = $("unoColorText");
    unoDirText = $("unoDirText");
    unoPenaltyText = $("unoPenaltyText");
    unoHand = $("unoHand");
    unoMsg = $("unoMsg");
    unoDrawBtn = $("unoDrawBtn");
    unoCallBtn = $("unoCallBtn");
    unoColorPicker = $("unoColorPicker");
    unoScoreboard = $("unoScoreboard");
    unoEndButtons = $("unoEndButtons");
    unoPlayAgainBtn = $("unoPlayAgainBtn");
    unoMeta = $("unoMeta");
    return true;
  }

  /* ---- SVG cards ---- */

  function faceLabel(card) {
    if (!card) return "";
    if (card.kind === "number") return String(card.value);
    if (card.kind === "skip") return "⊘";
    if (card.kind === "reverse") return "⇄";
    if (card.kind === "draw2") return "+2";
    if (card.kind === "wild") return "W";
    if (card.kind === "wild4") return "+4";
    return "";
  }

  function cardSvg(card, faceDown) {
    const id = "ug" + (++svgUid);
    const W = 64;
    const H = 96;
    if (faceDown) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
        '" width="' + W + '" height="' + H + '">' +
        '<rect x="1" y="1" width="62" height="94" rx="10" fill="#1b1f2a" stroke="#f2f2f2" stroke-width="2"/>' +
        '<rect x="10" y="18" width="44" height="60" rx="8" fill="#e23b3b"/>' +
        '<text x="32" y="54" text-anchor="middle" font-size="16" font-weight="bold" fill="#fff" ' +
        'font-family="Arial,sans-serif">UNO</text></svg>';
    }
    const isWild = card.kind === "wild" || card.kind === "wild4";
    const fill = isWild ? "#222" : (COLOR_HEX[card.color] || "#444");
    const label = faceLabel(card);
    const fontSize = label.length > 2 ? 18 : (label.length > 1 ? 22 : 28);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
      '" width="' + W + '" height="' + H + '">';
    svg += '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ffffff" stop-opacity=".25"/>' +
      '<stop offset="100%" stop-color="#000000" stop-opacity=".2"/>' +
      "</linearGradient></defs>";
    svg += '<rect x="1" y="1" width="62" height="94" rx="10" fill="' + fill +
      '" stroke="#f7f7f7" stroke-width="2"/>';
    svg += '<ellipse cx="32" cy="48" rx="22" ry="30" fill="#fff" opacity=".92"/>';
    if (isWild && card.kind === "wild") {
      svg += '<path d="M32 28 L44 48 L32 68 L20 48 Z" fill="#e23b3b"/>';
      svg += '<circle cx="24" cy="40" r="5" fill="#2f6bdc"/>';
      svg += '<circle cx="40" cy="40" r="5" fill="#2f9e44"/>';
      svg += '<circle cx="24" cy="56" r="5" fill="#e6c200"/>';
      svg += '<circle cx="40" cy="56" r="5" fill="#e23b3b"/>';
    } else {
      svg += '<text x="32" y="56" text-anchor="middle" font-size="' + fontSize +
        '" font-weight="900" fill="' + (isWild ? "#111" : fill) +
        '" font-family="Arial Black,Arial,sans-serif">' + label + "</text>";
    }
    svg += '<rect x="1" y="1" width="62" height="94" rx="10" fill="url(#' + id + ')"/>';
    // Corner pip
    svg += '<text x="10" y="18" font-size="11" font-weight="bold" fill="#fff" ' +
      'font-family="Arial,sans-serif">' + label + "</text>";
    svg += '<text x="54" y="88" text-anchor="end" font-size="11" font-weight="bold" fill="#fff" ' +
      'font-family="Arial,sans-serif">' + label + "</text>";
    svg += "</svg>";
    return svg;
  }

  function setCardEl(el, card, opts) {
    const options = opts || {};
    el.innerHTML = cardSvg(card, !!options.faceDown);
    el.className = "unoCard" + (options.extra ? " " + options.extra : "");
    if (card && card.id) el.dataset.cardId = card.id;
  }

  /* ---- Screen ---- */

  function showUnoScreen() {
    active = true;
    [lobbyScreen, placementScreen, gameScreen, wordChainScreen, codeBreakerScreen, dominoScreen]
      .forEach((el) => { if (el) el.classList.add("hidden"); });
    unoScreen.classList.remove("hidden");
  }

  function hideUnoScreen() {
    active = false;
    clearScoreboard();
    hideEndButtons();
    if (unoScreen) unoScreen.classList.add("hidden");
  }

  function hideEndButtons() {
    if (unoEndButtons) {
      unoEndButtons.classList.add("hidden");
      if (unoPlayAgainBtn) {
        unoPlayAgainBtn.disabled = false;
        unoPlayAgainBtn.textContent = "Play Again";
      }
    }
  }

  function clearScoreboard() {
    if (unoScoreboard) {
      unoScoreboard.classList.add("hidden");
      unoScoreboard.innerHTML = "";
    }
  }

  /** Clears Play Again controls. Scoreboard stays until the player leaves the lobby. */
  function hideEndUi(clearBoard) {
    hideEndButtons();
    if (clearBoard) clearScoreboard();
  }

  function sfx(name) {
    if (window.GameSfx && typeof window.GameSfx[name] === "function") {
      window.GameSfx[name]();
    }
  }

  function showEndUi(data) {
    if (!unoScoreboard) return;
    let html = "<h3 class=\"unoWinBurst\">Winner: " + (data.winnerName || "Player") + "</h3>";
    html += "<p>Cards played: " + (data.cardsPlayed != null ? data.cardsPlayed : "—") +
      " · Turns: " + (data.turnsPlayed != null ? data.turnsPlayed : "—") + "</p>";
    html += "<h3>Rankings</h3>";
    (data.rankings || []).forEach((row, i) => {
      const win = row.id === data.winnerId;
      html += '<div class="unoScoreRow' + (win ? " winner" : "") + '">' +
        "<span>#" + (i + 1) + " " + (row.name || "Player") + "</span>" +
        "<span>" + row.cardsLeft + " cards</span></div>";
    });
    unoScoreboard.innerHTML = html;
    unoScoreboard.classList.remove("hidden");
    if (unoEndButtons) unoEndButtons.classList.remove("hidden");
  }

  function renderPlayers(currentTurnId) {
    if (!unoPlayers) return;
    unoPlayers.innerHTML = "";
    players.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "unoPlayerChip" + (p.id === currentTurnId && !gameOver ? " turn" : "");
      const me = socket && p.id === socket.id;
      chip.innerHTML = '<div class="unoName">' + (me ? "You" : (p.name || "Player")) +
        (p.isBot ? ' <span class="botTag">BOT</span>' : "") +
        (p.unoCalled ? " · UNO" : "") +
        '</div><div class="unoCount">' + p.handCount + " cards</div>";
      if (!me && !gameOver && p.handCount === 1 && p.unoLiable && !p.unoCalled) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "unoChallengeBtn";
        btn.textContent = "Challenge UNO";
        btn.onclick = () => {
          // "unoChallenge" — UNO only.
          socket.emit("unoChallenge", { roomCode: currentRoom, targetId: p.id });
        };
        chip.appendChild(btn);
      }
      unoPlayers.appendChild(chip);
    });
  }

  function renderTable(animatePlay) {
    if (unoDrawPile) setCardEl(unoDrawPile, null, { faceDown: true });
    if (unoDiscardPile) {
      if (topCard) {
        const shown = Object.assign({}, topCard);
        if (shown.chosenColor && (shown.kind === "wild" || shown.kind === "wild4")) {
          // Tint wild with chosen color for clarity.
          shown.color = shown.chosenColor;
        }
        setCardEl(unoDiscardPile, shown, { extra: animatePlay ? "playAnim" : "" });
      } else {
        unoDiscardPile.innerHTML = "";
        unoDiscardPile.className = "unoCard";
      }
    }
    if (unoDrawLabel) unoDrawLabel.textContent = "Draw (" + (arguments[1] != null ? arguments[1] : "") + ")";
  }

  function renderColor(drawCount) {
    if (unoColorDot) {
      unoColorDot.className = "unoColorDot" + (currentColor ? " " + currentColor : "");
    }
    if (unoColorText) {
      unoColorText.textContent = currentColor ? currentColor.toUpperCase() : "—";
    }
    if (unoDirText) {
      unoDirText.textContent = direction === 1 ? "· Clockwise →" : "· ← Counter-clockwise";
    }
    if (unoPenaltyText) {
      unoPenaltyText.textContent = pendingPenalty > 0 ? ("· Stack +" + pendingPenalty) : "";
    }
    if (unoDrawLabel) unoDrawLabel.textContent = "Draw (" + (drawCount != null ? drawCount : 0) + ")";
    if (unoMeta) {
      unoMeta.textContent = players.length + " players";
    }
  }

  function renderHand(animateId) {
    if (!unoHand) return;
    unoHand.innerHTML = "";
    const playableSet = new Set(playableIds || []);
    hand.forEach((card) => {
      const playable = myTurn && !gameOver && !mustPickColor && playableSet.has(card.id);
      const forcedDrawn = drawnPlayableId && card.id === drawnPlayableId;
      const el = document.createElement("div");
      const extra = [
        "inHand",
        playable || forcedDrawn ? "playable" : "",
        myTurn && !playable && !forcedDrawn ? "disabledCard" : "",
        animateId && card.id === animateId ? "drawAnim" : ""
      ].filter(Boolean).join(" ");
      setCardEl(el, card, { extra });
      el.onclick = () => onHandClick(card);
      unoHand.appendChild(el);
    });
  }

  function renderChrome(data) {
    const current = players.find((p) => p.id === data.currentTurnId);
    if (gameOver) {
      unoTurnIndicator.textContent = "Game Over";
    } else if (mustPickColor) {
      unoTurnIndicator.textContent = "Choose a color";
    } else if (myTurn && pendingPenalty > 0) {
      unoTurnIndicator.textContent = "Stack or take +" + pendingPenalty;
    } else if (myTurn && drawnPlayableId) {
      unoTurnIndicator.textContent = "Play drawn card or pass";
    } else if (myTurn) {
      unoTurnIndicator.textContent = "Your Turn";
    } else {
      unoTurnIndicator.textContent = (current ? current.name : "Opponent") + "'s Turn";
    }

    if (unoDrawBtn) {
      if (drawnPlayableId && myTurn) {
        unoDrawBtn.textContent = "Pass";
        unoDrawBtn.disabled = false;
      } else if (canTakePenalty && myTurn) {
        unoDrawBtn.textContent = "Take +" + pendingPenalty;
        unoDrawBtn.disabled = false;
      } else {
        unoDrawBtn.textContent = "Draw";
        unoDrawBtn.disabled = !canDraw || !myTurn || gameOver;
      }
    }

    const myCount = hand.length;
    if (unoCallBtn) {
      const showCall = !gameOver && myCount === 1;
      unoCallBtn.classList.toggle("hidden", !showCall);
    }

    if (unoColorPicker) {
      unoColorPicker.classList.toggle("hidden", !mustPickColor);
    }
  }

  function applyState(data, opts) {
    const options = opts || {};
    currentRoom = data.room || currentRoom;
    players = data.players || players;
    myTurn = !!data.yourTurn;
    hand = data.hand || [];
    playableIds = data.playableIds || [];
    topCard = data.topCard || topCard;
    currentColor = data.currentColor;
    direction = data.direction || 1;
    pendingPenalty = data.pendingPenalty || 0;
    canDraw = !!data.canDraw;
    canTakePenalty = !!data.canTakePenalty;
    mustPickColor = !!data.mustPickColor;
    drawnPlayableId = data.drawnPlayableId || null;
    gameOver = !!data.over;

    renderPlayers(data.currentTurnId);
    renderTable(options.animatePlay, data.drawCount);
    renderColor(data.drawCount);
    renderHand(options.animateDrawId);
    renderChrome(data);

    if (data.over && data.rankings) {
      showEndUi({
        winnerId: data.winnerId,
        winnerName: (players.find((p) => p.id === data.winnerId) || {}).name,
        cardsPlayed: data.cardsPlayed,
        turnsPlayed: data.turnsPlayed,
        rankings: data.rankings
      });
    }
  }

  function onHandClick(card) {
    if (!myTurn || gameOver || mustPickColor) return;
    if (drawnPlayableId && card.id !== drawnPlayableId) {
      unoMsg.textContent = "You may only play the card you just drew (or Pass).";
      return;
    }
    if (!(playableIds || []).includes(card.id) && card.id !== drawnPlayableId) {
      unoMsg.textContent = "That card is not playable.";
      return;
    }
    if (card.kind === "wild" || card.kind === "wild4") {
      pendingWildId = card.id;
      mustPickColor = true;
      if (unoColorPicker) unoColorPicker.classList.remove("hidden");
      unoMsg.textContent = "Choose a color for your wild card.";
      renderChrome({ currentTurnId: socket.id });
      return;
    }
    // "unoPlayCard" — UNO only.
    socket.emit("unoPlayCard", { roomCode: currentRoom, cardId: card.id });
  }

  function chooseColor(color) {
    if (!currentRoom) return;
    if (pendingWildId) {
      // "unoPlayCard" — UNO only (wild + chosen color).
      socket.emit("unoPlayCard", { roomCode: currentRoom, cardId: pendingWildId, color });
      pendingWildId = null;
    } else {
      // "unoChooseColor" — UNO only (server already staged the wild).
      socket.emit("unoChooseColor", { roomCode: currentRoom, color });
    }
    if (unoColorPicker) unoColorPicker.classList.add("hidden");
  }

  function wireControls() {
    if (!unoDrawBtn || unoDrawBtn.dataset.wired) return;
    unoDrawBtn.dataset.wired = "1";
    unoDrawBtn.onclick = () => {
      if (!currentRoom || gameOver) return;
      // "unoDraw" — UNO only.
      socket.emit("unoDraw", { roomCode: currentRoom });
    };
    unoCallBtn.onclick = () => {
      if (!currentRoom) return;
      // "unoCall" — UNO only.
      socket.emit("unoCall", { roomCode: currentRoom });
      unoMsg.textContent = "UNO!";
    };
    unoColorPicker.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => chooseColor(btn.dataset.color);
    });
    unoPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      // "unoPlayAgain" — UNO only.
      socket.emit("unoPlayAgain", { roomCode: currentRoom });
      unoPlayAgainBtn.disabled = true;
      unoPlayAgainBtn.textContent = "Waiting for others...";
    };
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("UNO screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    pendingWildId = null;
    hideEndUi(false);
    if (unoColorPicker) unoColorPicker.classList.add("hidden");
    applyState(data);
    showUnoScreen();
    unoMsg.textContent = "Game started! Match color, number, or action — wilds play anytime.";
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "unoStarted" — UNO only.
    socket.on("unoStarted", onStarted);

    // "unoState" — UNO only.
    socket.on("unoState", (data) => {
      if (!active && data && data.game === "uno") {
        if (!bindDom()) return;
        wireControls();
        showUnoScreen();
      }
      if (!active) return;
      const prev = new Set(hand.map((c) => c.id));
      applyState(data);
      if (data.hand) {
        const drew = data.hand.find((c) => !prev.has(c.id));
        if (drew) renderHand(drew.id);
      }
      if (data.mustPickColor) {
        mustPickColor = true;
        if (unoColorPicker) unoColorPicker.classList.remove("hidden");
      }
    });

    // "unoPlayed" — UNO only.
    socket.on("unoPlayed", (data) => {
      if (!active) return;
      if (data.card && (data.card.kind === "skip" || data.card.kind === "draw2")) {
        sfx("skipTurn");
      } else {
        sfx("playCard");
      }
      if (data.card) topCard = data.card;
      if (data.currentColor) currentColor = data.currentColor;
      renderTable(true);
      if (unoDiscardPile) unoDiscardPile.classList.add("playAnim");
      unoMsg.textContent = (data.name || "Player") + " played a card.";
    });

    // "unoDrawn" — UNO only.
    socket.on("unoDrawn", (data) => {
      if (!active) return;
      sfx("draw");
      if (unoDrawLabel) unoDrawLabel.textContent = "Draw (" + data.drawCount + ")";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      renderPlayers(null);
      if (data.by !== socket.id) {
        unoMsg.textContent = (data.name || "Player") + " drew a card.";
      }
    });

    // "unoPenaltyDrawn" — UNO only.
    socket.on("unoPenaltyDrawn", (data) => {
      if (!active) return;
      sfx("skipTurn");
      unoMsg.textContent = (data.name || "Player") + " draws +" + data.amount + "!";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      renderPlayers(null);
    });

    // "unoReversed" — UNO only.
    socket.on("unoReversed", (data) => {
      if (!active) return;
      sfx("reverse");
      direction = data.direction;
      renderColor();
      unoMsg.textContent = "Direction reversed!";
      if (unoDiscardPile) unoDiscardPile.classList.add("skipAnim");
    });

    // "unoColorChosen" — UNO only.
    socket.on("unoColorChosen", (data) => {
      if (!active) return;
      currentColor = data.color;
      renderColor();
      unoMsg.textContent = (data.name || "Player") + " chose " + String(data.color).toUpperCase() + ".";
    });

    // "unoCalled" — UNO only.
    socket.on("unoCalled", (data) => {
      if (!active) return;
      sfx("playCard");
      unoMsg.textContent = (data.name || "Player") + " shouts UNO!";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { unoCalled: true, unoLiable: false })
        : p);
      renderPlayers(null);
    });

    // "unoChallenged" — UNO only.
    socket.on("unoChallenged", (data) => {
      if (!active) return;
      if (data.success) {
        sfx("skipTurn");
        unoMsg.textContent = (data.byName || "Player") + " challenged " +
          (data.targetName || "Player") + " — draw " + data.amount + "!";
      }
    });

    // "unoOver" — UNO only.
    socket.on("unoOver", (data) => {
      if (!active) return;
      sfx("gameOver");
      gameOver = true;
      myTurn = false;
      showEndUi(data);
      unoTurnIndicator.textContent = "Game Over";
      if (unoDrawBtn) unoDrawBtn.disabled = true;
      if (unoCallBtn) unoCallBtn.classList.add("hidden");
      unoMsg.textContent = data.message || "Game over.";
    });

    // "unoPlayAgainWait" — UNO only.
    socket.on("unoPlayAgainWait", () => {
      if (!active || !unoPlayAgainBtn) return;
      unoPlayAgainBtn.textContent = "Waiting for others...";
    });

    // "unoReset" — UNO only.
    socket.on("unoReset", () => {
      if (!active) return;
      gameOver = false;
      // Keep scoreboard visible until the player leaves the lobby.
      hideEndButtons();
      pendingWildId = null;
      if (unoScoreboard && !unoScoreboard.classList.contains("hidden")) {
        const heading = unoScoreboard.querySelector("h3.unoWinBurst") ||
          unoScoreboard.querySelector("h3");
        if (heading && heading.classList.contains("unoWinBurst")) {
          heading.textContent = "Last round — " + heading.textContent.replace(/^Winner:\s*/, "Winner: ");
        } else if (heading) {
          heading.textContent = "Last round";
        }
      }
      unoMsg.textContent = "New round!";
    });

    // "unoLobbyUpdate" — UNO only.
    socket.on("unoLobbyUpdate", (data) => {
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
      hideUnoScreen();
      currentRoom = null;
      gameOver = false;
    });

    if (bindDom()) wireControls();
  }

  function isActive() { return active; }

  function showError(msg) {
    if (!active || !unoMsg) return false;
    unoMsg.textContent = msg;
    return true;
  }

  window.Uno = { init, isActive, showError };
})();
