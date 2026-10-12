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
      '<button type="button" id="unoMenuBtn" class="unoMenuBtn" aria-expanded="false">Menu</button>' +
      '<div class="unoMeta" id="unoMeta"></div>' +
      '<div class="unoTopTools">' +
        '<div class="unoBotSpeed" id="unoBotSpeed" role="group" aria-label="Bot speed">' +
          '<span class="unoBotSpeedLabel">Bot speed</span>' +
          '<button type="button" data-speed="slow">Slow</button>' +
          '<button type="button" data-speed="normal">Normal</button>' +
          '<button type="button" data-speed="fast">Fast</button>' +
        '</div>' +
        '<div class="unoVolume" role="group" aria-label="Song volume">' +
          '<button type="button" id="unoVolumeDown">Volume −</button>' +
          '<span id="unoVolumeReadout">40%</span>' +
          '<button type="button" id="unoVolumeUp">Volume +</button>' +
        '</div>' +
        '<button type="button" id="unoMuteBtn" aria-pressed="false">Mute</button>' +
        '<button type="button" id="unoLobbyBtn" class="unoLobbyBtn">Return to Lobby</button>' +
        '<button type="button" id="unoLeaveBtn" class="unoLeaveBtn">Leave Room</button>' +
        '<button type="button" id="unoScoreToggle" class="unoScoreToggle hidden">Score</button>' +
      '</div>' +
    '</div>' +
    '<div class="unoTableArena" id="unoTableArena" data-count="2">' +
      '<div class="unoSeat seat-top" data-seat="top"></div>' +
      '<div class="unoSeat seat-tl" data-seat="tl"></div>' +
      '<div class="unoSeat seat-tr" data-seat="tr"></div>' +
      '<div class="unoSeat seat-left" data-seat="left"></div>' +
      '<div class="unoSeat seat-right" data-seat="right"></div>' +
      '<div class="unoSeat seat-bl" data-seat="bl"></div>' +
      '<div class="unoSeat seat-br" data-seat="br"></div>' +
      '<div class="unoTableCenter">' +
        '<h2 id="unoTurnIndicator"></h2>' +
        '<div class="unoTable">' +
          '<div class="unoDirFx" id="unoDirFx" aria-hidden="true"></div>' +
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
      '</div>' +
      '<div class="unoSeat seat-bottom" data-seat="bottom"></div>' +
    '</div>' +
    '<div class="unoHandSection">' +
      '<div class="unoHandLabel" id="unoHandLabel">Your hand</div>' +
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
  let leftTable = false;
  let blockedRoom = null;
  let unoResizeWired = false;
  let bgm = null;
  let bgmStarted = false;
  let bgmTracks = [];
  let bgmIndex = 0;
  let bgmToken = 0;
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
  let lastTurnId = null;
  let challengeRefreshTimer = null;

  let lobbyScreen, placementScreen, gameScreen, dominoScreen;
  let unoScreen, unoTableArena, unoTurnIndicator, unoDrawPile, unoDiscardPile, unoDrawLabel;
  let unoColorDot, unoColorText, unoDirText, unoPenaltyText, unoHand, unoMsg;
  let unoDrawBtn, unoCallBtn, unoColorPicker, unoScoreboard, unoEndButtons, unoPlayAgainBtn, unoMeta;
  let unoDirFx;

  function $(id) { return document.getElementById(id); }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    dominoScreen = $("dominoScreen");
    unoScreen = $("unoScreen");
    if (!unoScreen) return false;
    if (!unoScreen.dataset.ready) {
      unoScreen.innerHTML = SCREEN_HTML;
      unoScreen.dataset.ready = "1";
    }
    unoTableArena = $("unoTableArena");
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
    unoDirFx = $("unoDirFx");
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
    const isWild4 = card.kind === "wild4";
    const fill = isWild ? "#161616" : (COLOR_HEX[card.color] || "#444");
    const ink = card.color === "yellow" ? "#3a2a00" : (isWild ? "#111" : fill);
    const label = isWild4 ? "+4" : (card.kind === "wild" ? "W" : faceLabel(card));
    const fontSize = label.length > 2 ? 22 : (label.length > 1 ? 26 : 32);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
      '" width="' + W + '" height="' + H + '">';
    svg += '<rect x="1.5" y="1.5" width="61" height="93" rx="10" fill="' + fill +
      '" stroke="#f4f4f4" stroke-width="3"/>';
    svg += '<ellipse cx="32" cy="50" rx="20" ry="28" fill="#fff"/>';
    if (card.kind === "wild") {
      svg += '<path d="M32 30 L46 50 L32 70 L18 50 Z" fill="#e23b3b"/>';
      svg += '<path d="M32 30 L46 50 L32 50 Z" fill="#2f6bdc"/>';
      svg += '<path d="M32 50 L46 50 L32 70 Z" fill="#2f9e44"/>';
      svg += '<path d="M18 50 L32 50 L32 70 Z" fill="#e6c200"/>';
      svg += '<rect x="12" y="44" width="40" height="14" rx="3" fill="#fff"/>';
      svg += '<text x="32" y="55" text-anchor="middle" font-size="11" font-weight="900" fill="#111" font-family="Arial,sans-serif">WILD</text>';
    } else if (isWild4) {
      svg += '<text x="32" y="58" text-anchor="middle" font-size="28" font-weight="900" fill="#111" font-family="Arial Black,Arial,sans-serif">+4</text>';
      svg += '<circle cx="20" cy="34" r="4" fill="#e23b3b"/>';
      svg += '<circle cx="44" cy="34" r="4" fill="#2f6bdc"/>';
      svg += '<circle cx="20" cy="66" r="4" fill="#2f9e44"/>';
      svg += '<circle cx="44" cy="66" r="4" fill="#e6c200"/>';
    } else {
      svg += '<text x="32" y="60" text-anchor="middle" font-size="' + fontSize +
        '" font-weight="900" fill="' + ink +
        '" font-family="Arial Black,Arial,sans-serif">' + label + "</text>";
    }
    svg += '<rect x="4" y="4" width="22" height="16" rx="3" fill="#111"/>';
    svg += '<rect x="38" y="76" width="22" height="16" rx="3" fill="#111"/>';
    svg += '<text x="15" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Arial,sans-serif">' + label + "</text>";
    svg += '<text x="49" y="88" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Arial,sans-serif">' + label + "</text>";
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
    leftTable = false;
    [lobbyScreen, placementScreen, gameScreen, dominoScreen]
      .forEach((el) => { if (el) el.classList.add("hidden"); });
    unoScreen.classList.remove("hidden");
    requestAnimationFrame(() => renderHand());
  }

  function hideUnoScreen() {
    active = false;
    if (challengeRefreshTimer) {
      clearTimeout(challengeRefreshTimer);
      challengeRefreshTimer = null;
    }
    pauseUnoBgm();
    if (unoScreen) {
      unoScreen.classList.remove("app-menu-open");
      const menuBtn = $("unoMenuBtn");
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    }
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
    const scoreBtn = $("unoScoreToggle");
    if (scoreBtn) scoreBtn.classList.remove("hidden");
    if (unoEndButtons) unoEndButtons.classList.remove("hidden");
  }

  function seatNamesForCount(n) {
    if (n <= 2) return ["bottom", "top"];
    if (n === 3) return ["bottom", "left", "right"];
    if (n === 4) return ["bottom", "left", "top", "right"];
    return ["bottom", "bl", "tl", "tr", "br"].slice(0, Math.max(n, 5));
  }

  function playersFromMe() {
    if (!socket || !players.length) return players.slice();
    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return players.slice();
    return players.slice(idx).concat(players.slice(0, idx));
  }

  function nextPlayerId(fromId, dir, steps) {
    if (!players.length) return null;
    let i = players.findIndex((p) => p.id === fromId);
    if (i < 0) return null;
    const n = players.length;
    const step = dir >= 0 ? 1 : -1;
    for (let s = 0; s < (steps || 1); s++) {
      i = (i + step + n) % n;
    }
    return players[i].id;
  }

  function clearSeats() {
    if (!unoTableArena) return;
    unoTableArena.querySelectorAll(".unoSeat").forEach((seat) => {
      seat.innerHTML = "";
      seat.classList.add("empty");
    });
  }

  function flashSeatToast(playerId, text) {
    if (!unoTableArena || !playerId) return;
    const chip = unoTableArena.querySelector('.unoPlayerChip[data-pid="' + playerId + '"]');
    if (!chip) return;
    const old = chip.querySelector(".seatToast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.className = "seatToast";
    toast.textContent = text;
    chip.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 350);
    }, 1600);
  }

  function showReverseFx() {
    if (!unoDirFx) return;
    unoDirFx.textContent = direction === 1 ? "↻" : "↺";
    unoDirFx.classList.remove("show");
    void unoDirFx.offsetWidth;
    unoDirFx.classList.add("show");
    setTimeout(() => unoDirFx.classList.remove("show"), 1200);
  }

  function renderPlayers(currentTurnId) {
    if (!unoTableArena) return;
    if (currentTurnId) lastTurnId = currentTurnId;
    const turnId = currentTurnId || lastTurnId;
    const ordered = playersFromMe();
    const seats = seatNamesForCount(ordered.length);
    clearSeats();
    unoTableArena.setAttribute("data-count", String(ordered.length));

    if (challengeRefreshTimer) {
      clearTimeout(challengeRefreshTimer);
      challengeRefreshTimer = null;
    }
    let soonestChallengeMs = null;
    const now = Date.now();

    ordered.forEach((p, i) => {
      const seatName = seats[i];
      if (!seatName) return;
      const seat = unoTableArena.querySelector('.unoSeat[data-seat="' + seatName + '"]');
      if (!seat) return;
      seat.classList.remove("empty");

      const me = socket && p.id === socket.id;
      const turn = p.id === turnId && !gameOver && !p.away;
      const chip = document.createElement("div");
      chip.className = "unoPlayerChip" + (turn ? " turn" : "") + (me ? " me" : "") + (p.away ? " away" : "");
      chip.dataset.pid = p.id;
      chip.innerHTML =
        (turn ? '<div class="unoTurnBadge">' + (me ? "YOUR TURN" : "TURN") + "</div>" : "") +
        '<div class="unoName">' + (me ? "YOU" : (p.name || "Player")) +
        (p.isBot ? ' <span class="botTag">BOT</span>' : "") +
        (p.away ? " · Lobby" : "") +
        (p.unoCalled ? " · UNO" : "") +
        '</div><div class="unoCount">' + p.handCount + " cards</div>";

      // Challenge only after the 2s grace window to yell UNO.
      const challengeAt = typeof p.unoChallengeAt === "number" ? p.unoChallengeAt : null;
      const canChallenge =
        !me &&
        !gameOver &&
        p.handCount === 1 &&
        p.unoLiable &&
        !p.unoCalled &&
        challengeAt != null &&
        now >= challengeAt;
      if (canChallenge) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "unoChallengeBtn";
        btn.textContent = "Challenge UNO";
        btn.onclick = () => {
          socket.emit("unoChallenge", { roomCode: currentRoom, targetId: p.id });
        };
        chip.appendChild(btn);
      } else if (
        !me &&
        !gameOver &&
        p.handCount === 1 &&
        p.unoLiable &&
        !p.unoCalled &&
        challengeAt != null &&
        challengeAt > now
      ) {
        const wait = challengeAt - now;
        if (soonestChallengeMs == null || wait < soonestChallengeMs) {
          soonestChallengeMs = wait;
        }
      }
      seat.appendChild(chip);
    });

    if (soonestChallengeMs != null) {
      challengeRefreshTimer = setTimeout(() => {
        challengeRefreshTimer = null;
        renderPlayers(lastTurnId);
      }, soonestChallengeMs + 30);
    }
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

  function appShell() {
    return document.documentElement.classList.contains("gameweb-app");
  }

  function fitHandTiles() {
    const fit = window.UnoHandFit;
    if (!unoHand || !fit) return;
    const box = fit.fit(hand.length, unoHand.clientWidth, unoHand.clientHeight || 150);
    unoHand.style.setProperty("--hand-cols", String(box.cols));
    unoHand.style.setProperty("--hand-rows", String(box.rows));
    unoHand.style.setProperty("--hand-tile-w", box.width + "px");
    unoHand.style.setProperty("--hand-tile-h", box.height + "px");
    unoHand.style.setProperty("--hand-gap", box.gap + "px");
  }

  function renderHand(animateId) {
    if (!unoHand) return;
    fitHandTiles();
    unoHand.innerHTML = "";
    const playableSet = new Set(playableIds || []);
    hand.forEach((card) => {
      const playable = myTurn && !gameOver && !mustPickColor && playableSet.has(card.id);
      const forcedDrawn = drawnPlayableId && card.id === drawnPlayableId;
      const el = document.createElement("div");
      const extra = [
        "inHand",
        playable || forcedDrawn ? "playable" : "",
        pendingWildId === card.id ? "selected" : "",
        myTurn && !playable && !forcedDrawn && !gameOver ? "disabledCard" : "",
        animateId && card.id === animateId ? "drawAnim" : ""
      ].filter(Boolean).join(" ");
      setCardEl(el, card, { extra });
      el.onclick = () => onHandClick(card);
      unoHand.appendChild(el);
    });
    const label = $("unoHandLabel");
    if (label) {
      const me = players.find((p) => socket && p.id === socket.id);
      label.textContent = (me && me.name ? me.name : "You") + " · " + hand.length +
        (hand.length === 1 ? " card" : " cards");
    }
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
    if (unoTurnIndicator) {
      unoTurnIndicator.classList.toggle("unoYourTurn", myTurn && !gameOver);
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
      renderHand();
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

  const BGM_VOLUME_DEFAULT = 0.4;

  function isBgmMuted() {
    try { return localStorage.getItem("unoBgmMuted") === "1"; } catch (err) { return false; }
  }

  function currentBgmVolume() {
    try {
      const saved = localStorage.getItem("unoBgmVolume");
      if (saved == null || saved === "") return BGM_VOLUME_DEFAULT;
      const n = Number(saved);
      if (!Number.isFinite(n)) return BGM_VOLUME_DEFAULT;
      return Math.min(1, Math.max(0, n));
    } catch (err) {
      return BGM_VOLUME_DEFAULT;
    }
  }

  function ensureBgm() {
    if (bgm && bgm.isConnected) return bgm;
    const existing = document.getElementById("unoBgm");
    if (existing) {
      bgm = existing;
      return bgm;
    }
    bgm = document.createElement("audio");
    bgm.id = "unoBgm";
    bgm.preload = "auto";
    bgm.loop = false;
    bgm.setAttribute("playsinline", "");
    bgm.setAttribute("aria-hidden", "true");
    bgm.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none";
    bgm.addEventListener("ended", () => {
      bgmStarted = false;
      if (!active || isBgmMuted() || !bgmTracks.length) return;
      bgmIndex = (bgmIndex + 1) % bgmTracks.length;
      playUnoBgm();
    });
    document.body.appendChild(bgm);
    return bgm;
  }

  function updateMuteButton() {
    const btn = $("unoMuteBtn");
    const muted = isBgmMuted();
    if (!btn) return;
    btn.textContent = muted ? "Unmute" : "Mute";
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  function applyBgmVolume(value, persist) {
    const level = Math.min(1, Math.max(0, Number(value)));
    const next = Number.isFinite(level) ? level : BGM_VOLUME_DEFAULT;
    if (persist) {
      try { localStorage.setItem("unoBgmVolume", String(next)); } catch (err) { /* ignore */ }
    }
    const el = ensureBgm();
    el.volume = next;
    const readout = $("unoVolumeReadout");
    if (readout) readout.textContent = Math.round(next * 100) + "%";
    const down = $("unoVolumeDown");
    const up = $("unoVolumeUp");
    if (down) down.disabled = next <= 0.001;
    if (up) up.disabled = next >= 0.999;
  }

  function stepBgmVolume(direction) {
    const current = Math.round(currentBgmVolume() * 100);
    let next;
    if (current < 10 || (current === 10 && direction < 0)) next = current + direction;
    else if (direction > 0) next = Math.floor(current / 10) * 10 + 10;
    else next = Math.ceil(current / 10) * 10 - 10;
    applyBgmVolume(Math.min(100, Math.max(0, next)) / 100, true);
  }

  function loadBgmTracks() {
    if (bgmTracks.length) return Promise.resolve(bgmTracks);
    const url = new URL("assets/dominoes/playlist.json", document.baseURI).href;
    return fetch(url, { cache: "no-store" })
      .then((res) => res.ok ? res.json() : [])
      .then((list) => {
        bgmTracks = (Array.isArray(list) ? list : []).filter((name) => {
          return typeof name === "string" && name.length > 0 &&
            name.indexOf("/") === -1 && name.indexOf("\\") === -1 && name.indexOf("..") === -1;
        });
        return bgmTracks;
      })
      .catch(() => {
        bgmTracks = [];
        return bgmTracks;
      });
  }

  function playUnoBgm() {
    if (!active || isBgmMuted() || leftTable || blockedRoom) return;
    const token = ++bgmToken;
    loadBgmTracks().then((tracks) => {
      if (token !== bgmToken || !active || isBgmMuted() || !tracks.length) return;
      const name = tracks[bgmIndex % tracks.length];
      const el = ensureBgm();
      const src = new URL("assets/dominoes/" + encodeURIComponent(name), document.baseURI).href;
      if (el.dataset.trackName !== name) {
        el.dataset.trackName = name;
        el.src = src;
      }
      el.volume = currentBgmVolume();
      const played = el.play();
      bgmStarted = true;
      if (played && typeof played.catch === "function") {
        played.catch(() => { bgmStarted = false; });
      }
      updateMuteButton();
    });
  }

  function pauseUnoBgm() {
    bgmToken += 1;
    bgmStarted = false;
    if (bgm) {
      try { bgm.pause(); } catch (err) { /* already stopped */ }
    }
    updateMuteButton();
  }

  function setBgmMuted(muted) {
    try { localStorage.setItem("unoBgmMuted", muted ? "1" : "0"); } catch (err) { /* ignore */ }
    updateMuteButton();
    if (muted) pauseUnoBgm();
    else if (active && !leftTable) playUnoBgm();
  }

  function currentBotSpeed() {
    try {
      const saved = localStorage.getItem("unoBotSpeed");
      if (saved === "slow" || saved === "fast" || saved === "normal") return saved;
    } catch (err) { /* ignore */ }
    return "normal";
  }

  function applyBotSpeed(speed, emit) {
    const next = speed === "slow" || speed === "fast" ? speed : "normal";
    try { localStorage.setItem("unoBotSpeed", next); } catch (err) { /* ignore */ }
    const box = $("unoBotSpeed");
    if (box) {
      box.querySelectorAll("button").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.speed === next);
      });
    }
    if (emit && socket && currentRoom) {
      socket.emit("unoSetBotSpeed", { roomCode: currentRoom, speed: next });
    }
  }

  function showLobby(message) {
    hideUnoScreen();
    if (lobbyScreen) lobbyScreen.classList.remove("hidden");
    const codeEl = $("code");
    const statusEl = $("status");
    if (codeEl) codeEl.textContent = currentRoom ? ("Lobby Code: " + currentRoom) : "";
    if (statusEl && message) statusEl.textContent = message;
  }

  function returnToLobby() {
    if (!currentRoom) return;
    const go = () => {
      leftTable = true;
      pendingWildId = null;
      if (socket) socket.emit("unoLeaveTable", { roomCode: currentRoom });
      showLobby("In the lobby for " + currentRoom + ". This room is still open.");
    };
    if (active && !gameOver && window.AppNotice && typeof window.AppNotice.confirm === "function") {
      window.AppNotice.confirm(
        "Return to the lobby? You stay in this room. This device leaves the UNO table until the next round."
      ).then((ok) => { if (ok) go(); });
      return;
    }
    go();
  }

  function leaveRoom() {
    if (!currentRoom && !active) return;
    const go = () => {
      const room = currentRoom;
      blockedRoom = room;
      leftTable = false;
      pendingWildId = null;
      if (socket && room) socket.emit("unoLeaveRoom", { roomCode: room });
      currentRoom = null;
      try { window.dispatchEvent(new Event("gameweb-left-room")); } catch (err) { /* ignore */ }
      showLobby("You left the room.");
    };
    if (active && window.AppNotice && typeof window.AppNotice.confirm === "function") {
      window.AppNotice.confirm(
        "Leave this room? You will be removed from the match."
      ).then((ok) => { if (ok) go(); });
      return;
    }
    go();
  }

  function wireControls() {
    if (!unoResizeWired) {
      unoResizeWired = true;
      window.addEventListener("resize", () => {
        if (unoHand && (active || (unoScreen && !unoScreen.classList.contains("hidden")))) renderHand();
      });
    }
    const lobbyBtn = $("unoLobbyBtn");
    if (lobbyBtn && !lobbyBtn.dataset.wired) {
      lobbyBtn.dataset.wired = "1";
      lobbyBtn.onclick = () => returnToLobby();
    }
    const leaveBtn = $("unoLeaveBtn");
    if (leaveBtn && !leaveBtn.dataset.wired) {
      leaveBtn.dataset.wired = "1";
      leaveBtn.onclick = () => leaveRoom();
    }
    const volumeDown = $("unoVolumeDown");
    const volumeUp = $("unoVolumeUp");
    if (volumeDown && !volumeDown.dataset.wired) {
      volumeDown.dataset.wired = "1";
      volumeDown.onclick = () => stepBgmVolume(-1);
    }
    if (volumeUp && !volumeUp.dataset.wired) {
      volumeUp.dataset.wired = "1";
      volumeUp.onclick = () => stepBgmVolume(1);
    }
    if (volumeDown || volumeUp) applyBgmVolume(currentBgmVolume(), false);
    const muteBtn = $("unoMuteBtn");
    if (muteBtn && !muteBtn.dataset.wired) {
      muteBtn.dataset.wired = "1";
      muteBtn.onclick = () => setBgmMuted(!isBgmMuted());
    }
    updateMuteButton();
    const speedBox = $("unoBotSpeed");
    if (speedBox && !speedBox.dataset.wired) {
      speedBox.dataset.wired = "1";
      speedBox.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => applyBotSpeed(btn.dataset.speed, true);
      });
    }
    applyBotSpeed(currentBotSpeed(), false);
    const scoreBtn = $("unoScoreToggle");
    if (scoreBtn && !scoreBtn.dataset.wired) {
      scoreBtn.dataset.wired = "1";
      scoreBtn.onclick = () => {
        if (!unoScoreboard) return;
        unoScoreboard.classList.toggle("hidden");
      };
    }
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
    applyBotSpeed(currentBotSpeed(), true);
    updateMuteButton();
    playUnoBgm();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "unoStarted" — UNO only.
    socket.on("unoStarted", (data) => {
      if (blockedRoom && data && data.room === blockedRoom) return;
      blockedRoom = null;
      onStarted(data);
    });

    // "unoState" — UNO only.
    socket.on("unoState", (data) => {
      if (blockedRoom && data && data.room === blockedRoom) return;
      if (leftTable) return;
      if (!active && data && data.game === "uno") {
        if (!bindDom()) return;
        wireControls();
        showUnoScreen();
      }
      if (!active || leftTable) return;
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
      if (leftTable || blockedRoom || !active) return;
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

      // Skip / 2-player reverse: toast on the seat that loses the turn.
      if (data.card && data.by) {
        const kind = data.card.kind;
        if (kind === "skip" || (kind === "reverse" && players.length === 2)) {
          const skipped = nextPlayerId(data.by, direction, 1);
          if (skipped) flashSeatToast(skipped, "SKIPPED");
        }
      }
    });

    // "unoDrawn" — UNO only.
    socket.on("unoDrawn", (data) => {
      if (!active || leftTable) return;
      sfx("draw");
      if (unoDrawLabel) unoDrawLabel.textContent = "Draw (" + data.drawCount + ")";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      renderPlayers(lastTurnId);
      flashSeatToast(data.by, "DREW 1 CARD");
      if (data.by !== socket.id) {
        unoMsg.textContent = (data.name || "Player") + " drew a card.";
      }
    });

    // "unoPenaltyDrawn" — UNO only.
    socket.on("unoPenaltyDrawn", (data) => {
      if (!active || leftTable) return;
      sfx("skipTurn");
      unoMsg.textContent = (data.name || "Player") + " draws +" + data.amount + "!";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { handCount: data.handCount })
        : p);
      renderPlayers(lastTurnId);
      const amt = data.amount || 0;
      flashSeatToast(data.by, amt === 2 ? "+2 CARDS" : amt === 4 ? "+4 CARDS" : ("+" + amt + " CARDS"));
    });

    // "unoReversed" — UNO only.
    socket.on("unoReversed", (data) => {
      if (!active || leftTable) return;
      sfx("reverse");
      direction = data.direction;
      renderColor();
      showReverseFx();
      unoMsg.textContent = "Direction reversed!";
      if (unoDiscardPile) unoDiscardPile.classList.add("skipAnim");
    });

    // "unoColorChosen" — UNO only.
    socket.on("unoColorChosen", (data) => {
      if (!active || leftTable) return;
      currentColor = data.color;
      renderColor();
      unoMsg.textContent = (data.name || "Player") + " chose " + String(data.color).toUpperCase() + ".";
    });

    // "unoCalled" — UNO only.
    socket.on("unoCalled", (data) => {
      if (!active || leftTable) return;
      sfx("playCard");
      unoMsg.textContent = (data.name || "Player") + " shouts UNO!";
      players = players.map((p) => p.id === data.by
        ? Object.assign({}, p, { unoCalled: true, unoLiable: false, unoChallengeAt: null })
        : p);
      renderPlayers(lastTurnId);
    });

    // "unoChallenged" — UNO only.
    socket.on("unoChallenged", (data) => {
      if (!active || leftTable) return;
      if (data.success) {
        sfx("skipTurn");
        unoMsg.textContent = (data.byName || "Player") + " challenged " +
          (data.targetName || "Player") + " — draw " + data.amount + "!";
        if (data.targetId) flashSeatToast(data.targetId, "+" + (data.amount || 2) + " CARDS");
      }
    });

    // "unoOver" — UNO only.
    socket.on("unoOver", (data) => {
      if (!active || leftTable) return;
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
      if (!active || leftTable) return;
      gameOver = false;
      // Keep scoreboard visible until the player leaves the lobby.
      hideEndButtons();
      pendingWildId = null;
      if (unoScoreboard && !unoScoreboard.classList.contains("hidden")) {
        const heading = unoScoreboard.querySelector("h3");
        if (heading && heading.textContent.indexOf("Last round") !== 0) {
          heading.textContent = "Last round — " + heading.textContent;
        }
      }
      unoMsg.textContent = "New round!";
    });

    // "unoLobbyUpdate" — UNO only.
    socket.on("unoLobbyUpdate", (data) => {
      if (blockedRoom && data && data.room === blockedRoom) return;
      const statusEl = $("status");
      const codeEl = $("code");
      if (data && data.room && codeEl) codeEl.textContent = "Lobby Code: " + data.room;
      if (statusEl && data) {
        statusEl.textContent = "Waiting for players (" +
          data.players.length + "/" + data.maxPlayers + ")...";
      }
      if (data && data.room) currentRoom = data.room;
    });

    socket.on("unoSeatVacated", (data) => {
      if (!active || leftTable) return;
      if (data && data.name && unoMsg) {
        unoMsg.textContent = data.table
          ? (data.name + " returned to the lobby.")
          : (data.name + " left the room.");
      }
    });

    socket.on("unoLeftRoom", () => {
      blockedRoom = blockedRoom || currentRoom;
      currentRoom = null;
      leftTable = false;
    });

    socket.on("playerLeft", () => {
      if (!active && !leftTable) return;
      blockedRoom = currentRoom || blockedRoom;
      currentRoom = null;
      leftTable = false;
      hideUnoScreen();
      if (lobbyScreen) lobbyScreen.classList.remove("hidden");
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
