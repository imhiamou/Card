/* Coin Flip — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="cfHud">' +
      '<div class="cfRotate">PLEASE ROTATE YOUR PHONE TO LANDSCAPE</div>' +
      '<div class="cfTop">' +
        '<div class="cfOpp" id="cfOppCard">' +
          '<span class="cfPlayerName" id="cfOppName">Opponent</span>' +
          '<span class="cfHearts cfHeartsSm" id="cfOppHearts"></span>' +
          '<span class="cfStatus" id="cfOppStatus"></span>' +
        '</div>' +
        '<div class="cfMeta" id="cfMeta">Round 1 · 5 throws</div>' +
      '</div>' +
      '<div class="cfMid">' +
        '<div class="cfCounts">' +
          '<div><strong id="cfHeadsRemaining">0</strong><span>Heads left</span></div>' +
          '<div><strong id="cfFlipsRemaining">5</strong><span>Throws left</span></div>' +
          '<div><strong id="cfTailsRemaining">0</strong><span>Tails left</span></div>' +
        '</div>' +
        '<div class="cfPreview" id="cfPreview"></div>' +
        '<div class="cfArena">' +
          '<div class="cfCoin" id="cfCoin" data-face="idle">' +
            '<div class="cfCoinFace heads">H</div>' +
            '<div class="cfCoinFace tails">T</div>' +
          '</div>' +
          '<div class="cfCoinLabel" id="cfCoinLabel">Awaiting bet</div>' +
          '<div class="cfOutcomeLabel" id="cfOutcomeLabel"></div>' +
        '</div>' +
        '<h2 id="cfTurnIndicator">Your turn</h2>' +
        '<div class="cfBet" id="cfControls">' +
          '<div class="cfWagerRow">' +
            '<span class="cfWagerTitle">Current wager</span>' +
            '<button type="button" class="cfStepBtn" id="cfWagerMinus">−</button>' +
            '<strong id="cfWagerPickVal">1 ♥</strong>' +
            '<button type="button" class="cfStepBtn" id="cfWagerPlus">+</button>' +
          '</div>' +
          '<div class="cfChoiceRow">' +
            '<button type="button" class="cfChoiceBtn" id="cfHeadsBtn">Heads</button>' +
            '<button type="button" class="cfChoiceBtn" id="cfTailsBtn">Tails</button>' +
            '<button type="button" class="cfConfirmBtn" id="cfConfirmBtn">Confirm</button>' +
          '</div>' +
        '</div>' +
        '<p id="cfMsg"></p>' +
      '</div>' +
      '<div class="cfBottom">' +
        '<div class="cfMe" id="cfMeCard">' +
          '<span class="cfPlayerName" id="cfMyName">You</span>' +
          '<span class="cfHearts cfHeartsSm" id="cfMyHearts"></span>' +
          '<span class="cfStatus" id="cfMyStatus"></span>' +
        '</div>' +
        '<div class="cfItemsSection">' +
          '<h3>Your items</h3>' +
          '<div class="cfItems" id="cfItems"></div>' +
        '</div>' +
      '</div>' +
      '<div class="cfRoundEnd hidden" id="cfRoundEnd">' +
        '<h3>ROUND COMPLETE</h3>' +
        '<p id="cfRoundSummary"></p>' +
      '</div>' +
      '<details class="cfHistoryWrap">' +
        '<summary>History</summary>' +
        '<div class="cfHistory" id="cfHistory"></div>' +
      '</details>' +
      '<div id="cfEndButtons" class="cfEndButtons hidden">' +
        '<button type="button" id="cfPlayAgainBtn">Play Again</button>' +
      '</div>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let state = null;
  // Fresh per-throw decisions: a new wager + side every turn until confirm.
  let selectedWager = 1;
  let selectedSide = null;
  let lastTurnKey = null;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let unoScreen;
  let dodgeBallScreen;
  let coinFlipScreen;

  let cfMeta;
  let cfOppName;
  let cfOppHearts;
  let cfOppStatus;
  let cfMyName;
  let cfMyHearts;
  let cfMyStatus;
  let cfPreview;
  let cfHeadsRemaining;
  let cfTailsRemaining;
  let cfFlipsRemaining;
  let cfCoin;
  let cfCoinLabel;
  let cfOutcomeLabel;
  let cfTurnIndicator;
  let cfControls;
  let cfWagerMinus;
  let cfWagerPlus;
  let cfWagerPickVal;
  let cfHeadsBtn;
  let cfTailsBtn;
  let cfConfirmBtn;
  let cfItems;
  let cfRoundEnd;
  let cfRoundSummary;
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
    cfHeadsRemaining = $("cfHeadsRemaining");
    cfTailsRemaining = $("cfTailsRemaining");
    cfFlipsRemaining = $("cfFlipsRemaining");
    cfCoin = $("cfCoin");
    cfCoinLabel = $("cfCoinLabel");
    cfOutcomeLabel = $("cfOutcomeLabel");
    cfTurnIndicator = $("cfTurnIndicator");
    cfControls = $("cfControls");
    cfWagerMinus = $("cfWagerMinus");
    cfWagerPlus = $("cfWagerPlus");
    cfWagerPickVal = $("cfWagerPickVal");
    cfHeadsBtn = $("cfHeadsBtn");
    cfTailsBtn = $("cfTailsBtn");
    cfConfirmBtn = $("cfConfirmBtn");
    cfItems = $("cfItems");
    cfRoundEnd = $("cfRoundEnd");
    cfRoundSummary = $("cfRoundSummary");
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
      dodgeBallScreen
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
    const revealed = (state && state.revealedInGroup) || [];
    const total = (state && state.throwsThisRound) || 5;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      if (i < revealed.length) {
        cell.className = "cfThrow revealed";
        cell.textContent = sideLetter(revealed[i]);
        cell.title = "Revealed";
      } else {
        cell.className = "cfThrow hiddenResult" +
          (i === revealed.length ? " current" : "");
        cell.textContent = "?";
        cell.title = i === revealed.length ? "Current hidden flip" : "Hidden flip";
      }
      cfPreview.appendChild(cell);
    }
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

  function renderItems() {
    if (!cfItems || !state) return;
    cfItems.innerHTML = "";
    const inventory = state.inventory || {};
    const availability = state.itemAvailability || {};
    const catalog = {};
    (state.itemsCatalog || []).forEach((item) => {
      catalog[item.id] = item;
    });
    const ids = Object.keys(inventory).filter((id) => inventory[id] > 0);
    if (!ids.length) {
      cfItems.innerHTML = '<span class="cfNoItems">Complete a round to earn an item.</span>';
      return;
    }
    ids.forEach((id) => {
      const item = catalog[id] || { id, name: id, description: "" };
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cfItemBtn";
      button.disabled = !availability[id];
      button.innerHTML =
        "<strong>" + item.name + " ×" + inventory[id] + "</strong>" +
        "<span>" + item.description + "</span>";
      button.onclick = () => {
        if (!currentRoom || !availability[id]) return;
        socket.emit("coinFlipUseItem", { roomCode: currentRoom, itemId: id });
      };
      cfItems.appendChild(button);
    });
  }

  function maxWagerNow() {
    return Math.max(0, state && state.maxWager ? state.maxWager : 0);
  }

  function clampWager() {
    const max = maxWagerNow();
    if (!Number.isFinite(selectedWager)) selectedWager = 1;
    selectedWager = Math.floor(selectedWager);
    if (selectedWager < 1) selectedWager = 1;
    if (max > 0 && selectedWager > max) selectedWager = max;
  }

  function turnKey() {
    if (!state) return null;
    return state.round + ":" + state.currentTurnId + ":" + state.flipsRemaining;
  }

  function renderRoundEnd() {
    if (!cfRoundEnd || !state) return;
    const atRoundEnd = state.phase === "round-end" && !gameOver;
    cfRoundEnd.classList.toggle("hidden", !atRoundEnd);
    if (!atRoundEnd) return;
    const summary = state.roundSummary || {};
    if (cfRoundSummary) {
      cfRoundSummary.textContent =
        "Round " + (summary.round || state.round) + " · " +
        (summary.throws || state.throwsThisRound) + " throws · +" +
        (summary.itemsPerPlayer || 1) + " item each · next: " +
        (summary.nextThrows || "") + " throws";
    }
  }

  function syncBetControls() {
    if (!state) return;
    const can = !!state.canAct && !gameOver && maxWagerNow() > 0;
    clampWager();
    if (cfWagerPickVal) cfWagerPickVal.textContent = selectedWager + " ♥";
    if (cfWagerMinus) cfWagerMinus.disabled = !can || selectedWager <= 1;
    if (cfWagerPlus) cfWagerPlus.disabled = !can || selectedWager >= maxWagerNow();
    if (cfHeadsBtn) {
      cfHeadsBtn.disabled = !can;
      cfHeadsBtn.classList.toggle("selected", selectedSide === "heads");
    }
    if (cfTailsBtn) {
      cfTailsBtn.disabled = !can;
      cfTailsBtn.classList.toggle("selected", selectedSide === "tails");
    }
    if (cfConfirmBtn) {
      cfConfirmBtn.disabled = !can || !selectedSide;
    }
  }

  function renderState() {
    if (!state) return;
    const me = mePlayer();
    const opp = oppPlayer();
    const maxH = state.startingHearts || 10;

    if (cfMeta) {
      cfMeta.textContent =
        "Round " + (state.round || 1) + " · " +
        (state.throwsThisRound || 5) + " throws";
    }
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

    // New turn = fresh wager + side decisions.
    const key = turnKey();
    if (state.phase === "turn" && key !== lastTurnKey) {
      lastTurnKey = key;
      if (state.yourTurn) {
        selectedSide = null;
        selectedWager = 1;
      }
    }
    if (cfHeadsRemaining) cfHeadsRemaining.textContent = String(state.headsRemaining || 0);
    if (cfTailsRemaining) cfTailsRemaining.textContent = String(state.tailsRemaining || 0);
    if (cfFlipsRemaining) cfFlipsRemaining.textContent = String(state.flipsRemaining || 0);

    renderPreview();
    renderHistory();
    renderItems();
    renderRoundEnd();
    syncBetControls();

    if (gameOver || state.phase === "over") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Match Over";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.phase === "resolving") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Flipping…";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.phase === "between") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Resolving…";
      if (cfControls) cfControls.classList.add("hidden");
    } else if (state.phase === "round-end") {
      if (cfTurnIndicator) cfTurnIndicator.textContent = "Round complete";
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
    renderState();
  }

  function confirmBet() {
    if (!currentRoom || !state || !state.canAct || gameOver) return;
    if (!selectedSide) {
      if (cfMsg) cfMsg.textContent = "Pick Heads or Tails, then Confirm.";
      return;
    }
    clampWager();
    socket.emit("coinFlipPlay", {
      roomCode: currentRoom,
      choice: selectedSide,
      wager: selectedWager
    });
  }

  function wireControls() {
    if (!cfHeadsBtn || cfHeadsBtn.dataset.wired) return;
    cfHeadsBtn.dataset.wired = "1";
    cfHeadsBtn.onclick = () => {
      if (!state || !state.canAct || gameOver) return;
      selectedSide = "heads";
      syncBetControls();
    };
    cfTailsBtn.onclick = () => {
      if (!state || !state.canAct || gameOver) return;
      selectedSide = "tails";
      syncBetControls();
    };
    cfWagerMinus.onclick = () => {
      selectedWager = (Number(selectedWager) || 1) - 1;
      syncBetControls();
    };
    cfWagerPlus.onclick = () => {
      selectedWager = (Number(selectedWager) || 1) + 1;
      syncBetControls();
    };
    cfConfirmBtn.onclick = confirmBet;
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
    selectedWager = 1;
    selectedSide = null;
    lastTurnKey = null;
    hideEndButtons();
    applyState(data);
    showCoinFlipScreen();
    setCoinFace("idle", false);
    if (cfCoinLabel) cfCoinLabel.textContent = "Awaiting bet";
    if (cfOutcomeLabel) cfOutcomeLabel.textContent = "";
    if (cfMsg) {
      cfMsg.textContent = "Both players know the remaining counts, but the five-flip order stays hidden.";
    }
  }

  function onSuspense(data) {
    if (!active) return;
    setCoinFace("idle", true);
    if (cfCoinLabel) {
      const choice = data && data.choice ? String(data.choice).toUpperCase() : "";
      cfCoinLabel.textContent = choice ? "CHOICE LOCKED: " + choice : "CHOICE LOCKED";
    }
    if (cfOutcomeLabel) cfOutcomeLabel.textContent = "";
    if (cfTurnIndicator) cfTurnIndicator.textContent = "Flipping…";
  }

  function onReveal(data) {
    if (!active) return;
    const coin = data && data.result ? data.result.coin : null;
    setCoinFace(coin || "idle", false);
    if (cfCoinLabel) {
      cfCoinLabel.textContent = coin
        ? "COIN RESULT: " + String(coin).toUpperCase()
        : "";
    }
    if (data && data.result) {
      const r = data.result;
      const youActed = r.actorId === socket.id;
      if (cfOutcomeLabel) {
        cfOutcomeLabel.textContent = "WAGER " + (r.actorWins ? "WON" : "LOST");
        cfOutcomeLabel.className = "cfOutcomeLabel " + (r.actorWins ? "won" : "lost");
      }
      if (r.actorWins) {
        const doubleText = r.doubled ? " (Double)" : "";
        cfMsg.textContent = youActed
          ? "Your " + String(r.choice).toUpperCase() + " bet matched" + doubleText +
            ". Opponent loses " + r.damage + " ♥"
          : "Opponent's bet matched" + doubleText + ". You lose " + r.damage + " ♥";
      } else {
        const protectionText = r.protection
          ? " (" + (r.protection === "shield" ? "Shield" : "Safe Bet") + ")"
          : "";
        cfMsg.textContent = youActed
          ? "Your " + String(r.choice).toUpperCase() + " bet missed" + protectionText +
            ". You lose " + r.damage + " ♥"
          : "Opponent's bet missed" + protectionText + ". They lose " + r.damage + " ♥";
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
    socket.on("coinFlipChoiceSwapped", (data) => {
      if (!active) return;
      if (cfCoinLabel) {
        cfCoinLabel.textContent =
          "CHOICE LOCKED: " + String(data.choice || "").toUpperCase();
      }
    });
    socket.on("coinFlipItemInfo", (data) => {
      if (!active || !data || !data.info) return;
      if (cfMsg) {
        cfMsg.textContent =
          "Private Peek: throw " + data.info.position + " will be " +
          String(data.info.result || "").toUpperCase() + ".";
      }
    });
    socket.on("coinFlipItemUsed", (data) => {
      if (!active || !data || data.itemId === "peek") return;
      if (cfMsg) cfMsg.textContent = (data.name || "Item") + " activated.";
    });
    socket.on("coinFlipItemReward", (data) => {
      if (!active || !data) return;
      const names = (data.items || []).map((item) => item.name).join(", ");
      if (cfMsg) cfMsg.textContent = "Round reward: " + names + ".";
    });
    socket.on("coinFlipRoundComplete", (data) => {
      if (!active || !data || !data.summary) return;
      if (cfOutcomeLabel) {
        cfOutcomeLabel.textContent = "ROUND COMPLETE";
        cfOutcomeLabel.className = "cfOutcomeLabel";
      }
    });
    socket.on("coinFlipRoundStarted", (data) => {
      if (!active || !data) return;
      setCoinFace("idle", false);
      if (cfCoinLabel) cfCoinLabel.textContent = "Awaiting bet";
      if (cfOutcomeLabel) {
        cfOutcomeLabel.textContent = "";
        cfOutcomeLabel.className = "cfOutcomeLabel";
      }
      if (cfMsg) {
        cfMsg.textContent =
          "Round " + data.round + ": " + data.throws +
          " hidden flips, wager " + data.roundWager + " ♥.";
      }
    });
    socket.on("coinFlipOver", onGameOver);
    socket.on("coinFlipPlayAgainWait", () => {
      if (!active || !cfPlayAgainBtn) return;
      cfPlayAgainBtn.textContent = "Waiting for opponent...";
    });
    socket.on("coinFlipReset", () => {
      if (!active) return;
      gameOver = false;
      hideEndButtons();
      if (cfOutcomeLabel) {
        cfOutcomeLabel.textContent = "";
        cfOutcomeLabel.className = "cfOutcomeLabel";
      }
      if (cfMsg) cfMsg.textContent = "New match — use the known counts to manage your risk.";
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
