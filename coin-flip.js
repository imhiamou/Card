/* Coin Flip — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="cfRotate" id="cfRotate">' +
      '<div class="cfRotateIcon">⟳</div>' +
      '<div class="cfRotateText">PLEASE ROTATE YOUR PHONE TO LANDSCAPE</div>' +
    '</div>' +
    '<div class="cfHud" id="cfHud">' +
      '<div class="cfTop">' +
        '<div class="cfPlayerCard cfOppCard" id="cfOppCard">' +
          '<div class="cfPlayerName" id="cfOppName">Opponent</div>' +
          '<div class="cfHearts" id="cfOppHearts"></div>' +
          '<div class="cfStatus" id="cfOppStatus"></div>' +
        '</div>' +
        '<div class="cfTitleBlock">' +
          '<h2>COIN FLIP</h2>' +
          '<div class="cfMeta" id="cfMeta">Round 1 · 5 throws</div>' +
        '</div>' +
        '<div class="cfCounts">' +
          '<div><strong id="cfHeadsRemaining">0</strong><span>Heads left</span></div>' +
          '<div><strong id="cfTailsRemaining">0</strong><span>Tails left</span></div>' +
          '<div><strong id="cfFlipsRemaining">5</strong><span>Throws left</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="cfPreview" id="cfPreview"></div>' +
      '<div class="cfMid">' +
        '<div class="cfArena">' +
          '<div class="cfCoin" id="cfCoin" data-face="idle">' +
            '<div class="cfCoinFace heads">H</div>' +
            '<div class="cfCoinFace tails">T</div>' +
          '</div>' +
          '<div class="cfCoinLabel" id="cfCoinLabel">Awaiting bet</div>' +
          '<div class="cfOutcomeLabel" id="cfOutcomeLabel"></div>' +
        '</div>' +
        '<div class="cfAction">' +
          '<div class="cfTurnIndicator" id="cfTurnIndicator">Your turn</div>' +
          '<div class="cfBet" id="cfControls">' +
            '<div class="cfWagerRow">' +
              '<button type="button" class="cfStepBtn" id="cfWagerMinus" aria-label="Decrease wager">−</button>' +
              '<div class="cfWagerPick"><span id="cfWagerPickVal">1</span> HEARTS</div>' +
              '<button type="button" class="cfStepBtn" id="cfWagerPlus" aria-label="Increase wager">+</button>' +
            '</div>' +
            '<div class="cfChoiceRow">' +
              '<button type="button" class="cfChoiceBtn" id="cfHeadsBtn">HEADS</button>' +
              '<button type="button" class="cfChoiceBtn" id="cfTailsBtn">TAILS</button>' +
            '</div>' +
            '<button type="button" class="cfConfirmBtn" id="cfConfirmBtn">CONFIRM BET</button>' +
          '</div>' +
          '<div class="cfWaitBox" id="cfWaitBox"></div>' +
          '<p class="cfMsg" id="cfMsg"></p>' +
        '</div>' +
      '</div>' +
      '<div class="cfBottom">' +
        '<div class="cfPlayerCard cfMeCard" id="cfMeCard">' +
          '<div class="cfPlayerName" id="cfMyName">You</div>' +
          '<div class="cfHearts" id="cfMyHearts"></div>' +
          '<div class="cfStatus" id="cfMyStatus"></div>' +
        '</div>' +
        '<div class="cfItemsSection">' +
          '<div class="cfItemsHead">ITEMS</div>' +
          '<div class="cfItems" id="cfItems"></div>' +
        '</div>' +
        '<details class="cfHistoryWrap">' +
          '<summary>History</summary>' +
          '<div class="cfHistory" id="cfHistory"></div>' +
        '</details>' +
      '</div>' +
      '<div class="cfRoundEnd hidden" id="cfRoundEnd">' +
        '<h3>ROUND COMPLETE</h3>' +
        '<p id="cfRoundSummary"></p>' +
        '<p id="cfRoundNext"></p>' +
      '</div>' +
      '<div id="cfEndButtons" class="cfEndButtons hidden">' +
        '<button type="button" id="cfPlayAgainBtn">Play Again</button>' +
      '</div>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let state = null;

  // Per-throw bet draft. Reset every time a new own turn begins so the
  // previous wager is never carried over automatically.
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
  let cfWaitBox;
  let cfItems;
  let cfRoundEnd;
  let cfRoundSummary;
  let cfRoundNext;
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
    cfWaitBox = $("cfWaitBox");
    cfItems = $("cfItems");
    cfRoundEnd = $("cfRoundEnd");
    cfRoundSummary = $("cfRoundSummary");
    cfRoundNext = $("cfRoundNext");
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
    el.innerHTML = html + '<span class="cfHeartNum">' + n + "/" + cap + "</span>";
  }

  function sideLetter(side) {
    return side === "tails" ? "T" : "H";
  }

  function renderPreview() {
    if (!cfPreview) return;
    cfPreview.innerHTML = "";
    const revealed = (state && state.revealedInGroup) || [];
    const total = (state && state.throwsThisRound) || 5;
    cfPreview.dataset.count = String(total);
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      if (i < revealed.length) {
        cell.className = "cfThrow revealed " + revealed[i];
        cell.textContent = sideLetter(revealed[i]);
        cell.title = "Revealed: " + revealed[i];
      } else {
        cell.className = "cfThrow hiddenResult" +
          (i === revealed.length ? " current" : "");
        cell.textContent = "?";
        cell.title = i === revealed.length ? "Current hidden throw" : "Hidden throw";
      }
      cfPreview.appendChild(cell);
    }
  }

  function renderHistory() {
    if (!cfHistory) return;
    cfHistory.innerHTML = "";
    const list = ((state && state.history) || []).slice().reverse();
    if (!list.length) {
      cfHistory.textContent = "No throws yet.";
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "cfHistoryRow";
      const who = entry.actorId === socket.id ? "You" : (entry.actorName || "Opp");
      const outcome = entry.actorWins ? "won" : "lost";
      row.textContent = "R" + entry.round + " T" + entry.throwNumber + " · " + who +
        " bet " + entry.wager + "♥ on " + sideLetter(entry.choice) +
        " · coin " + sideLetter(entry.coin) + " · " + outcome + " (−" + entry.damage + ")";
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
      cfItems.innerHTML = '<span class="cfNoItems">Finish a round to earn an item.</span>';
      return;
    }
    ids.forEach((id) => {
      const item = catalog[id] || { id, name: id, description: "" };
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cfItemBtn";
      button.disabled = !availability[id];
      button.title = item.description || item.name;
      button.innerHTML =
        "<strong>" + item.name + "</strong>" +
        '<span class="cfItemCount">×' + inventory[id] + "</span>";
      button.onclick = () => {
        if (!currentRoom || !availability[id]) return;
        socket.emit("coinFlipUseItem", { roomCode: currentRoom, itemId: id });
      };
      cfItems.appendChild(button);
    });
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
        (summary.throws || state.throwsThisRound) + " throws resolved · +" +
        (summary.itemsPerPlayer || 1) + " item each";
    }
    if (cfRoundNext) {
      cfRoundNext.textContent = summary.nextThrows
        ? "Next round: " + summary.nextThrows + " throws"
        : "";
    }
  }

  function turnKey() {
    if (!state) return null;
    return state.round + ":" + state.currentTurnId + ":" + state.flipsRemaining;
  }

  function clampWager() {
    const min = (state && state.minWager) || 1;
    const max = Math.max(min, (state && state.maxWager) || min);
    if (selectedWager < min) selectedWager = min;
    if (selectedWager > max) selectedWager = max;
  }

  function syncBetControls() {
    if (!state) return;
    const can = !!state.canAct && !gameOver;
    const min = state.minWager || 1;
    const max = Math.max(min, state.maxWager || min);
    clampWager();
    if (cfWagerPickVal) cfWagerPickVal.textContent = String(selectedWager);
    if (cfWagerMinus) cfWagerMinus.disabled = !can || selectedWager <= min;
    if (cfWagerPlus) cfWagerPlus.disabled = !can || selectedWager >= max;
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
      cfConfirmBtn.textContent = selectedSide
        ? "CONFIRM BET · " + selectedWager + "♥ ON " + selectedSide.toUpperCase()
        : "CONFIRM BET";
    }
  }

  function renderState() {
    if (!state) return;
    const me = mePlayer();
    const opp = oppPlayer();
    const maxH = state.startingHearts || 10;

    const key = turnKey();
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      selectedWager = state.minWager || 1;
      selectedSide = null;
    }

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
      cfOppStatus.textContent = opp && opp.isTurn ? "Betting…" : "";
    }
    if (cfMyStatus) {
      cfMyStatus.textContent = me && me.isTurn ? "Your bet" : "";
    }

    if (cfHeadsRemaining) cfHeadsRemaining.textContent = String(state.headsRemaining || 0);
    if (cfTailsRemaining) cfTailsRemaining.textContent = String(state.tailsRemaining || 0);
    if (cfFlipsRemaining) cfFlipsRemaining.textContent = String(state.flipsRemaining || 0);

    renderPreview();
    renderHistory();
    renderItems();
    renderRoundEnd();
    syncBetControls();

    const showControls = !gameOver && state.phase === "turn" && state.yourTurn;
    if (cfControls) cfControls.classList.toggle("hidden", !showControls);
    if (cfWaitBox) cfWaitBox.classList.toggle("hidden", showControls);

    let indicator = "";
    let wait = "";
    if (gameOver || state.phase === "over") {
      indicator = "MATCH OVER";
    } else if (state.phase === "resolving") {
      indicator = "FLIPPING…";
      wait = (state.wagerAtRisk || 0) + " ♥ at stake";
    } else if (state.phase === "between") {
      indicator = "RESOLVED";
      wait = "Next throw coming up…";
    } else if (state.phase === "round-end") {
      indicator = "ROUND COMPLETE";
      wait = "Next round starting…";
    } else if (state.yourTurn) {
      indicator = "YOUR THROW — SET WAGER & SIDE";
    } else {
      indicator = "OPPONENT'S THROW";
      wait = "Waiting for " + (opp ? opp.name : "opponent") + " to bet…";
    }
    if (cfTurnIndicator) cfTurnIndicator.textContent = indicator;
    if (cfWaitBox) cfWaitBox.textContent = wait;
  }

  function applyState(data) {
    state = data || state;
    if (data && data.room) currentRoom = data.room;
    if (data && data.over) gameOver = true;
    renderState();
  }

  function stepWager(delta) {
    if (!state || !state.canAct || gameOver) return;
    selectedWager += delta;
    clampWager();
    syncBetControls();
  }

  function pickSide(side) {
    if (!state || !state.canAct || gameOver) return;
    selectedSide = side;
    syncBetControls();
  }

  function confirmBet() {
    if (!currentRoom || !state || !state.canAct || gameOver || !selectedSide) return;
    clampWager();
    socket.emit("coinFlipPlay", {
      roomCode: currentRoom,
      choice: selectedSide,
      wager: selectedWager
    });
    if (cfConfirmBtn) cfConfirmBtn.disabled = true;
  }

  function wireControls() {
    if (!cfHeadsBtn || cfHeadsBtn.dataset.wired) return;
    cfHeadsBtn.dataset.wired = "1";
    cfWagerMinus.onclick = () => stepWager(-1);
    cfWagerPlus.onclick = () => stepWager(1);
    cfHeadsBtn.onclick = () => pickSide("heads");
    cfTailsBtn.onclick = () => pickSide("tails");
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

  function resetArena(label) {
    setCoinFace("idle", false);
    if (cfCoinLabel) cfCoinLabel.textContent = label || "Awaiting bet";
    if (cfOutcomeLabel) {
      cfOutcomeLabel.textContent = "";
      cfOutcomeLabel.className = "cfOutcomeLabel";
    }
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Coin Flip screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    lastTurnKey = null;
    selectedWager = 1;
    selectedSide = null;
    hideEndButtons();
    applyState(data);
    showCoinFlipScreen();
    resetArena("Awaiting bet");
    if (cfMsg) {
      cfMsg.textContent = "Counts are public, order is hidden. Pick a wager before every throw.";
    }
  }

  function onSuspense(data) {
    if (!active) return;
    setCoinFace("idle", true);
    if (cfCoinLabel) {
      const choice = data && data.choice ? String(data.choice).toUpperCase() : "";
      cfCoinLabel.textContent = choice ? "CHOICE LOCKED: " + choice : "CHOICE LOCKED";
    }
    if (cfOutcomeLabel) {
      cfOutcomeLabel.textContent = "";
      cfOutcomeLabel.className = "cfOutcomeLabel";
    }
    if (cfTurnIndicator) cfTurnIndicator.textContent = "FLIPPING…";
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
      if (!cfMsg) return;
      if (r.actorWins) {
        const doubleText = r.doubled ? " (Double)" : "";
        cfMsg.textContent = youActed
          ? "Your " + r.wager + "♥ bet on " + String(r.choice).toUpperCase() +
            " hit" + doubleText + ". Opponent loses " + r.damage + " ♥."
          : "Opponent's " + r.wager + "♥ bet hit" + doubleText +
            ". You lose " + r.damage + " ♥.";
      } else {
        const protectionText = r.protection
          ? " (" + (r.protection === "shield" ? "Shield" : "Safe Bet") + ")"
          : "";
        cfMsg.textContent = youActed
          ? "Your " + r.wager + "♥ bet on " + String(r.choice).toUpperCase() +
            " missed" + protectionText + ". You lose " + r.damage + " ♥."
          : "Opponent's " + r.wager + "♥ bet missed" + protectionText +
            ". They lose " + r.damage + " ♥.";
      }
    }
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    if (cfTurnIndicator) cfTurnIndicator.textContent = "MATCH OVER";
    if (cfMsg) {
      if (data.draw) cfMsg.textContent = data.message || "Draw!";
      else {
        const youWin = data.winnerId === socket.id;
        cfMsg.textContent = (data.message || "Match over!") + (youWin ? " You win!" : "");
      }
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
      resetArena("Awaiting bet");
      if (cfMsg) {
        cfMsg.textContent =
          "Round " + data.round + ": " + data.throws + " hidden throws.";
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
      lastTurnKey = null;
      selectedWager = 1;
      selectedSide = null;
      hideEndButtons();
      resetArena("Awaiting bet");
      if (cfMsg) cfMsg.textContent = "New match — wager before every throw.";
    });
    socket.on("playerLeft", () => {
      if (!active) return;
      hideCoinFlipScreen();
      currentRoom = null;
      gameOver = false;
      state = null;
      lastTurnKey = null;
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
