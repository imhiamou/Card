/* Coin Flip — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="cfTitleRow">' +
      '<h2>Coin Flip</h2>' +
      '<div class="cfMeta" id="cfMeta">Round 1</div>' +
    '</div>' +
    '<div class="cfPlayerTop" id="cfOppCard">' +
      '<div class="cfPlayerName" id="cfOppName">Opponent</div>' +
      '<div class="cfHearts" id="cfOppHearts"></div>' +
      '<div class="cfStatus" id="cfOppStatus"></div>' +
    '</div>' +
    '<div class="cfCenter">' +
      '<div class="cfPreviewLabel">Next 5 throws</div>' +
      '<div class="cfPreview" id="cfPreview"></div>' +
      '<div class="cfWagerBox">' +
        '<div class="cfWagerLabel">Current wager</div>' +
        '<div class="cfWagerValue" id="cfWagerValue">1 ♥</div>' +
      '</div>' +
      '<div class="cfArena">' +
        '<div class="cfCoin" id="cfCoin" data-face="idle">' +
          '<div class="cfCoinFace heads">H</div>' +
          '<div class="cfCoinFace tails">T</div>' +
        '</div>' +
        '<div class="cfCoinLabel" id="cfCoinLabel">Heads wins the flip</div>' +
      '</div>' +
      '<h2 id="cfTurnIndicator">Your turn</h2>' +
      '<div class="cfControls" id="cfControls">' +
        '<label class="cfWagerPick">Wager' +
          '<input type="range" id="cfWagerRange" min="1" max="1" value="1">' +
          '<span id="cfWagerPickVal">1</span>' +
        '</label>' +
        '<button type="button" id="cfPlayBtn">Flip</button>' +
      '</div>' +
      '<p class="cfHint">Upcoming throws are known. Heads = active player wins; Tails = active player loses. Choose how many hearts to risk (up to this round\'s wager).</p>' +
    '</div>' +
    '<div class="cfPlayerBottom" id="cfMeCard">' +
      '<div class="cfPlayerName" id="cfMyName">You</div>' +
      '<div class="cfHearts" id="cfMyHearts"></div>' +
      '<div class="cfStatus" id="cfMyStatus"></div>' +
    '</div>' +
    '<p id="cfMsg"></p>' +
    '<div class="cfHistoryWrap">' +
      '<h3>History</h3>' +
      '<div class="cfHistory" id="cfHistory"></div>' +
    '</div>' +
    '<div id="cfEndButtons" class="cfEndButtons hidden">' +
      '<button type="button" id="cfPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let state = null;
  let selectedWager = 1;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let unoScreen;
  let dodgeBallScreen;
  let obolScreen;
  let coinFlipScreen;

  let cfMeta;
  let cfOppName;
  let cfOppHearts;
  let cfOppStatus;
  let cfMyName;
  let cfMyHearts;
  let cfMyStatus;
  let cfPreview;
  let cfWagerValue;
  let cfCoin;
  let cfCoinLabel;
  let cfTurnIndicator;
  let cfControls;
  let cfWagerRange;
  let cfWagerPickVal;
  let cfPlayBtn;
  let cfMsg;
  let cfHistory;
  let cfEndButtons;
  let cfPlayAgainBtn;

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
    obolScreen = $("obolScreen");
    coinFlipScreen = $("coinFlipScreen");
    if (!coinFlipScreen) return false;
    if (!coinFlipScreen.dataset.ready) {
      coinFlipScreen.innerHTML = SCREEN_HTML;
      coinFlipScreen.dataset.ready = "1";
    }
    cfMeta = $("cfMeta");
    cfOppName = $("cfOppName");
    cfOppHearts = $("cfOppHearts");
    cfOppStatus = $("cfOppStatus");
    cfMyName = $("cfMyName");
    cfMyHearts = $("cfMyHearts");
    cfMyStatus = $("cfMyStatus");
    cfPreview = $("cfPreview");
    cfWagerValue = $("cfWagerValue");
    cfCoin = $("cfCoin");
    cfCoinLabel = $("cfCoinLabel");
    cfTurnIndicator = $("cfTurnIndicator");
    cfControls = $("cfControls");
    cfWagerRange = $("cfWagerRange");
    cfWagerPickVal = $("cfWagerPickVal");
    cfPlayBtn = $("cfPlayBtn");
    cfMsg = $("cfMsg");
    cfHistory = $("cfHistory");
    cfEndButtons = $("cfEndButtons");
    cfPlayAgainBtn = $("cfPlayAgainBtn");
    return true;
  }

  function showCoinFlipScreen() {
    active = true;
    [
      lobbyScreen,
      placementScreen,
      gameScreen,
      wordChainScreen,
      codeBreakerScreen,
      dominoScreen,
      unoScreen,
      dodgeBallScreen,
      obolScreen
    ].forEach((el) => {
      if (el) el.classList.add("hidden");
    });
    coinFlipScreen.classList.remove("hidden");
  }

  function hideCoinFlipScreen() {
    active = false;
    if (coinFlipScreen) coinFlipScreen.classList.add("hidden");
  }

  function hideEndButtons() {
    if (!cfEndButtons) return;
    cfEndButtons.classList.add("hidden");
    if (cfPlayAgainBtn) {
      cfPlayAgainBtn.disabled = false;
      cfPlayAgainBtn.textContent = "Play Again";
    }
  }

  function showEndButtons() {
    if (!cfEndButtons) return;
    hideEndButtons();
    cfEndButtons.classList.remove("hidden");
  }

  function mePlayer() {
    return state && socket
      ? (state.players || []).find((p) => p.id === socket.id)
      : null;
  }

  function oppPlayer() {
    return state && socket
      ? (state.players || []).find((p) => p.id !== socket.id)
      : null;
  }

  function renderHearts(el, count, max) {
    if (!el) return;
    const n = Math.max(0, count || 0);
    const cap = max || 10;
    let html = "";
    for (let i = 0; i < cap; i++) {
      html += '<span class="cfHeart' + (i < n ? " on" : " off") + '">♥</span>';
    }
    el.innerHTML = html;
  }

  function sideLetter(side) {
    return side === "tails" ? "T" : "H";
  }

  function renderPreview() {
    if (!cfPreview) return;
    cfPreview.innerHTML = "";
    const upcoming = (state && state.upcoming) || [];
    upcoming.forEach((side, i) => {
      const cell = document.createElement("div");
      cell.className = "cfThrow" + (i === 0 ? " current" : " next");
      cell.textContent = sideLetter(side);
      cell.title = i === 0 ? "Current throw" : "Upcoming";
      cfPreview.appendChild(cell);
    });
  }

  function renderHistory() {
    if (!cfHistory) return;
    cfHistory.innerHTML = "";
    const list = ((state && state.history) || []).slice().reverse();
    if (!list.length) {
      cfHistory.textContent = "No flips yet.";
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "cfHistoryRow";
      const who = entry.actorId === socket.id ? "You" : (entry.actorName || "Opp");
      const coin = sideLetter(entry.coin);
      const outcome = entry.actorWins
        ? (entry.actorId === socket.id ? "you won" : "opp won")
        : (entry.actorId === socket.id ? "you lost" : "opp lost");
      row.textContent = "R" + entry.round + " · " + who + " · " + coin +
        " · wager " + entry.wager + " · " + outcome + " (−" + entry.damage + ")";
      cfHistory.appendChild(row);
    });
  }

  function setCoinFace(face, spinning) {
    if (!cfCoin) return;
    cfCoin.classList.toggle("spinning", !!spinning);
    cfCoin.dataset.face = face || "idle";
  }

  function syncWagerControls() {
    if (!cfWagerRange || !state) return;
    const maxW = Math.max(0, state.maxWager || 0);
    const minW = maxW > 0 ? 1 : 0;
    cfWagerRange.min = String(minW);
    cfWagerRange.max = String(Math.max(minW, maxW));
    if (selectedWager > maxW) selectedWager = maxW;
    if (selectedWager < minW) selectedWager = minW;
    if (maxW > 0 && selectedWager < 1) selectedWager = maxW;
    cfWagerRange.value = String(selectedWager || minW);
    if (cfWagerPickVal) cfWagerPickVal.textContent = String(selectedWager || 0);
    const can = !!state.canAct && !gameOver && maxW > 0;
    cfWagerRange.disabled = !can;
    if (cfPlayBtn) cfPlayBtn.disabled = !can;
  }

  function renderState() {
    if (!state) return;
    const me = mePlayer();
    const opp = oppPlayer();
    const maxH = state.startingHearts || 10;

    if (cfMeta) cfMeta.textContent = "Round " + (state.round || 1);
    if (cfOppName) cfOppName.textContent = opp ? opp.name : "Opponent";
    if (cfMyName) cfMyName.textContent = me ? me.name : "You";
    renderHearts(cfOppHearts, opp ? opp.hearts : maxH, maxH);
    renderHearts(cfMyHearts, me ? me.hearts : maxH, maxH);

    if (cfOppStatus) {
      cfOppStatus.textContent = opp && opp.isTurn ? "Their turn" : "";
    }
    if (cfMyStatus) {
      cfMyStatus.textContent = me && me.isTurn ? "Your turn" : "";
    }

    if (cfWagerValue) {
      cfWagerValue.textContent = (state.roundWager || 1) + " ♥";
    }

    renderPreview();
    renderHistory();
    syncWagerControls();

    if (gameOver || state.phase === "over") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Match Over";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.phase === "resolving") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Flipping…";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.phase === "between") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Resolving…";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.yourTurn) {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Your turn";
      if (cfControls) cfControls.classList.remove("hidden");
    } else {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Opponent's turn";
      if (cfControls) cfControls.classList.add("hidden");
    }
  }

  function applyState(data) {
    state = data || state;
    if (data && data.room) currentRoom = data.room;
    if (data && data.over) gameOver = true;
    if (data && data.maxWager > 0 && (!selectedWager || selectedWager > data.maxWager)) {
      selectedWager = data.maxWager;
    }
    renderState();
  }

  function playFlip() {
    if (!currentRoom || !state || !state.canAct || gameOver) return;
    const wager = Number(cfWagerRange ? cfWagerRange.value : selectedWager);
    socket.emit("coinFlipPlay", { roomCode: currentRoom, wager: wager });
  }

  function wireControls() {
    if (!cfPlayBtn || cfPlayBtn.dataset.wired) return;
    cfPlayBtn.dataset.wired = "1";
    cfPlayBtn.onclick = playFlip;
    if (cfWagerRange) {
      cfWagerRange.addEventListener("input", () => {
        selectedWager = Number(cfWagerRange.value) || 1;
        if (cfWagerPickVal) cfWagerPickVal.textContent = String(selectedWager);
      });
    }
    if (cfPlayAgainBtn) {
      cfPlayAgainBtn.onclick = () => {
        if (!currentRoom || !gameOver) return;
        socket.emit("coinFlipPlayAgain", { roomCode: currentRoom });
        cfPlayAgainBtn.disabled = true;
        cfPlayAgainBtn.textContent = "Waiting for opponent...";
      };
    }
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Coin Flip screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    selectedWager = data.maxWager || data.roundWager || 1;
    hideEndButtons();
    applyState(data);
    showCoinFlipScreen();
    setCoinFace("idle", false);
    if (cfCoinLabel) cfCoinLabel.textContent = "Heads wins · Tails loses";
    if (cfMsg) {
      cfMsg.textContent = "Both of you see the next 5 throws. On your turn, set a wager and Flip.";
    }
  }

  function onSuspense() {
    if (!active) return;
    setCoinFace("idle", true);
    if (cfCoinLabel) cfCoinLabel.textContent = "…";
    if (cfTurnIndicator) cfTurnIndicator.textContent = "Flipping…";
  }

  function onReveal(data) {
    if (!active) return;
    const coin = data && data.result ? data.result.coin : null;
    setCoinFace(coin || "idle", false);
    if (cfCoinLabel) cfCoinLabel.textContent = coin ? String(coin).toUpperCase() : "";
    if (data && data.result) {
      const r = data.result;
      const youActed = r.actorId === socket.id;
      if (r.actorWins) {
        cfMsg.textContent = youActed
          ? "Heads — you win! Opponent loses " + r.damage + " ♥"
          : "Heads — opponent wins. You lose " + r.damage + " ♥";
      } else {
        cfMsg.textContent = youActed
          ? "Tails — you lose " + r.damage + " ♥"
          : "Tails — opponent loses " + r.damage + " ♥";
      }
    }
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    if (cfTurnIndicator) cfTurnIndicator.textContent = "Match Over";
    if (data.draw) cfMsg.textContent = data.message || "Draw!";
    else {
      const youWin = data.winnerId === socket.id;
      cfMsg.textContent = (data.message || "Match over!") + (youWin ? " You win!" : "");
    }
    showEndButtons();
    renderState();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    socket.on("coinFlipStarted", onStarted);
    socket.on("coinFlipState", (data) => {
      if (!active) return;
      applyState(data);
    });
    socket.on("coinFlipSuspense", onSuspense);
    socket.on("coinFlipReveal", onReveal);
    socket.on("coinFlipOver", onGameOver);
    socket.on("coinFlipPlayAgainWait", () => {
      if (!active || !cfPlayAgainBtn) return;
      cfPlayAgainBtn.textContent = "Waiting for opponent...";
    });
    socket.on("coinFlipReset", () => {
      if (!active) return;
      gameOver = false;
      hideEndButtons();
      if (cfMsg) cfMsg.textContent = "New match — check the next 5 throws.";
    });
    socket.on("playerLeft", () => {
      if (!active) return;
      hideCoinFlipScreen();
      currentRoom = null;
      gameOver = false;
      state = null;
    });

    if (bindDom()) wireControls();
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !cfMsg) return false;
    cfMsg.textContent = msg;
    return true;
  }

  window.CoinFlip = { init, isActive, showError };
})();
