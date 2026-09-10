/* O.B.O.L. — client module (isolated from other games). */
(function () {
  const SCREEN_HTML =
    '<div class="obolTitleRow">' +
      '<h2>O.B.O.L.</h2>' +
      '<div class="obolMeta" id="obolMeta">Round 1</div>' +
    '</div>' +
    '<div class="obolPlayers">' +
      '<div class="obolPlayerCard mine" id="obolMeCard">' +
        '<div class="obolPlayerName" id="obolMyName">You</div>' +
        '<div class="obolHpTrack"><div class="obolHpFill" id="obolMyHpFill"></div></div>' +
        '<div class="obolHpText" id="obolMyHp">100 HP</div>' +
        '<div class="obolLockHint" id="obolMyLock"></div>' +
      '</div>' +
      '<div class="obolVs">VS</div>' +
      '<div class="obolPlayerCard" id="obolOppCard">' +
        '<div class="obolPlayerName" id="obolOppName">Opponent</div>' +
        '<div class="obolHpTrack"><div class="obolHpFill" id="obolOppHpFill"></div></div>' +
        '<div class="obolHpText" id="obolOppHp">100 HP</div>' +
        '<div class="obolLockHint" id="obolOppLock"></div>' +
      '</div>' +
    '</div>' +
    '<h2 id="obolTurnIndicator">Your turn</h2>' +
    '<p class="obolStakes" id="obolStakes">Lose a round: −25 HP</p>' +
    '<div class="obolArena" id="obolArena">' +
      '<div class="obolCoin" id="obolCoin" data-face="idle" aria-hidden="true">' +
        '<div class="obolCoinFace heads">H</div>' +
        '<div class="obolCoinFace tails">T</div>' +
      '</div>' +
      '<div class="obolCoinLabel" id="obolCoinLabel">Predict the flip</div>' +
    '</div>' +
    '<div class="obolChoiceRow" id="obolChoiceRow">' +
      '<button type="button" class="obolSideBtn" id="obolHeadsBtn" data-side="heads">Heads</button>' +
      '<button type="button" class="obolSideBtn" id="obolTailsBtn" data-side="tails">Tails</button>' +
    '</div>' +
    '<div class="obolItemsSection">' +
      '<h3>Items</h3>' +
      '<div class="obolItems" id="obolItems"></div>' +
    '</div>' +
    '<p id="obolMsg"></p>' +
    '<div class="obolHistoryWrap">' +
      '<h3>Round history</h3>' +
      '<div class="obolHistory" id="obolHistory"></div>' +
    '</div>' +
    '<div id="obolEndButtons" class="obolEndButtons hidden">' +
      '<button type="button" id="obolPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let active = false;
  let gameOver = false;
  let state = null;
  let startingHp = 100;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let dominoScreen;
  let unoScreen;
  let dodgeBallScreen;
  let obolScreen;
  let obolMeta;
  let obolTurnIndicator;
  let obolStakes;
  let obolCoin;
  let obolCoinLabel;
  let obolHeadsBtn;
  let obolTailsBtn;
  let obolItems;
  let obolMsg;
  let obolHistory;
  let obolEndButtons;
  let obolPlayAgainBtn;
  let obolMyName;
  let obolOppName;
  let obolMyHp;
  let obolOppHp;
  let obolMyHpFill;
  let obolOppHpFill;
  let obolMyLock;
  let obolOppLock;

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
    if (!obolScreen) return false;
    if (!obolScreen.dataset.ready) {
      obolScreen.innerHTML = SCREEN_HTML;
      obolScreen.dataset.ready = "1";
    }
    obolMeta = $("obolMeta");
    obolTurnIndicator = $("obolTurnIndicator");
    obolStakes = $("obolStakes");
    obolCoin = $("obolCoin");
    obolCoinLabel = $("obolCoinLabel");
    obolHeadsBtn = $("obolHeadsBtn");
    obolTailsBtn = $("obolTailsBtn");
    obolItems = $("obolItems");
    obolMsg = $("obolMsg");
    obolHistory = $("obolHistory");
    obolEndButtons = $("obolEndButtons");
    obolPlayAgainBtn = $("obolPlayAgainBtn");
    obolMyName = $("obolMyName");
    obolOppName = $("obolOppName");
    obolMyHp = $("obolMyHp");
    obolOppHp = $("obolOppHp");
    obolMyHpFill = $("obolMyHpFill");
    obolOppHpFill = $("obolOppHpFill");
    obolMyLock = $("obolMyLock");
    obolOppLock = $("obolOppLock");
    return true;
  }

  function showObolScreen() {
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
    obolScreen.classList.remove("hidden");
  }

  function hideObolScreen() {
    active = false;
    if (obolScreen) obolScreen.classList.add("hidden");
  }

  function hideEndButtons() {
    if (!obolEndButtons) return;
    obolEndButtons.classList.add("hidden");
    if (obolPlayAgainBtn) {
      obolPlayAgainBtn.disabled = false;
      obolPlayAgainBtn.textContent = "Play Again";
    }
  }

  function showEndButtons() {
    if (!obolEndButtons) return;
    hideEndButtons();
    obolEndButtons.classList.remove("hidden");
  }

  function mePlayer() {
    if (!state || !socket) return null;
    return (state.players || []).find((p) => p.id === socket.id) || null;
  }

  function oppPlayer() {
    if (!state || !socket) return null;
    return (state.players || []).find((p) => p.id !== socket.id) || null;
  }

  function setHp(fillEl, textEl, hp) {
    const max = startingHp || 100;
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    if (fillEl) fillEl.style.width = pct + "%";
    if (textEl) textEl.textContent = hp + " HP";
    if (fillEl) {
      fillEl.classList.toggle("low", hp <= max * 0.3);
      fillEl.classList.toggle("mid", hp > max * 0.3 && hp <= max * 0.6);
    }
  }

  function catalogMap() {
    const map = {};
    (state && state.itemsCatalog ? state.itemsCatalog : []).forEach((it) => {
      map[it.id] = it;
    });
    return map;
  }

  function renderItems() {
    if (!obolItems) return;
    obolItems.innerHTML = "";
    const me = mePlayer();
    const inv = (me && me.inventory) || {};
    const catalog = catalogMap();
    const ids = Object.keys(inv).filter((id) => inv[id] > 0);
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "obolItemEmpty";
      empty.textContent = "No items left";
      obolItems.appendChild(empty);
      return;
    }
    ids.forEach((id) => {
      const def = catalog[id] || { id: id, name: id, description: "" };
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "obolItemBtn";
      btn.disabled = !state.canUseItem || gameOver;
      btn.innerHTML =
        "<strong>" + def.name + " ×" + inv[id] + "</strong>" +
        "<span>" + (def.description || "") + "</span>";
      btn.onclick = () => {
        if (!currentRoom || !state.canUseItem || gameOver) return;
        socket.emit("obolUseItem", { roomCode: currentRoom, itemId: id });
      };
      obolItems.appendChild(btn);
    });
  }

  function renderHistory() {
    if (!obolHistory) return;
    obolHistory.innerHTML = "";
    const list = (state && state.history ? state.history : []).slice().reverse();
    if (!list.length) {
      obolHistory.textContent = "No rounds yet.";
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "obolHistoryRow";
      const coin = (entry.coin || "?").toUpperCase();
      let summary = "R" + entry.round + " · " + coin;
      if (entry.draw) summary += " · draw";
      else if (entry.winnerIds && entry.winnerIds[0] === socket.id) summary += " · you won";
      else if (entry.loserIds && entry.loserIds[0] === socket.id) summary += " · you lost";
      else summary += " · resolved";
      if (entry.damage && entry.damage.length) {
        summary += " · −" + entry.damage.map((d) => d.amount).join("/") + " HP";
      }
      row.textContent = summary;
      obolHistory.appendChild(row);
    });
  }

  function setCoinFace(face, spinning) {
    if (!obolCoin) return;
    obolCoin.classList.toggle("spinning", !!spinning);
    obolCoin.dataset.face = face || "idle";
  }

  function renderState() {
    if (!state) return;
    const me = mePlayer();
    const opp = oppPlayer();
    startingHp = (state.stakes && state.stakes.startingHp) || startingHp;

    if (obolMeta) obolMeta.textContent = "Round " + (state.round || 1);
    if (obolMyName) obolMyName.textContent = me ? me.name : "You";
    if (obolOppName) obolOppName.textContent = opp ? opp.name : "Opponent";
    setHp(obolMyHpFill, obolMyHp, me ? me.hp : startingHp);
    setHp(obolOppHpFill, obolOppHp, opp ? opp.hp : startingHp);

    if (obolMyLock) {
      obolMyLock.textContent = me && me.locked
        ? "Locked: " + String(me.choice || "").toUpperCase()
        : (state.phase === "choice" ? "Choose…" : "");
    }
    if (obolOppLock) {
      if (state.phase === "choice") {
        obolOppLock.textContent = opp && opp.locked ? "Locked in" : "Deciding…";
      } else if (opp && opp.choice) {
        obolOppLock.textContent = "Chose " + String(opp.choice).toUpperCase();
      } else {
        obolOppLock.textContent = opp && opp.locked ? "Locked in" : "";
      }
    }

    if (obolStakes) {
      const dmg = (state.stakes && state.stakes.baseDamage) || 25;
      obolStakes.textContent = "Lose a round: −" + dmg + " HP";
    }

    const canChoose = !!state.canChoose && !gameOver;
    if (obolHeadsBtn) {
      obolHeadsBtn.disabled = !canChoose;
      obolHeadsBtn.classList.toggle("selected", state.yourChoice === "heads");
    }
    if (obolTailsBtn) {
      obolTailsBtn.disabled = !canChoose;
      obolTailsBtn.classList.toggle("selected", state.yourChoice === "tails");
    }

    if (gameOver || state.phase === "over") {
      obolTurnIndicator.textContent = "Match Over";
    } else if (state.phase === "revealing") {
      obolTurnIndicator.textContent = "Flipping…";
    } else if (state.phase === "aftermath") {
      obolTurnIndicator.textContent = "Round result";
    } else if (state.yourLocked) {
      obolTurnIndicator.textContent = "Waiting for opponent…";
    } else {
      obolTurnIndicator.textContent = "Your turn — predict the flip";
    }

    if (state.phase === "revealing") {
      setCoinFace("idle", true);
      if (obolCoinLabel) obolCoinLabel.textContent = "…";
    } else if (state.phase === "aftermath" && state.coin) {
      setCoinFace(state.coin, false);
      if (obolCoinLabel) obolCoinLabel.textContent = String(state.coin).toUpperCase();
    } else if (state.phase === "over" && state.coin) {
      setCoinFace(state.coin, false);
    } else {
      setCoinFace("idle", false);
      if (obolCoinLabel) obolCoinLabel.textContent = "Predict the flip";
    }

    renderItems();
    renderHistory();
  }

  function applyState(data) {
    state = data || state;
    if (data && data.room) currentRoom = data.room;
    if (data && data.over) gameOver = true;
    renderState();
  }

  function choose(side) {
    if (!currentRoom || !state || !state.canChoose || gameOver) return;
    socket.emit("obolChoose", { roomCode: currentRoom, side: side });
  }

  function wireControls() {
    if (!obolHeadsBtn || obolHeadsBtn.dataset.wired) return;
    obolHeadsBtn.dataset.wired = "1";
    obolHeadsBtn.onclick = () => choose("heads");
    obolTailsBtn.onclick = () => choose("tails");
    obolPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      socket.emit("obolPlayAgain", { roomCode: currentRoom });
      obolPlayAgainBtn.disabled = true;
      obolPlayAgainBtn.textContent = "Waiting for opponent...";
    };
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("O.B.O.L. screen missing from the page.");
      return;
    }
    wireControls();
    gameOver = false;
    hideEndButtons();
    applyState(data);
    showObolScreen();
    if (obolMsg) {
      obolMsg.textContent = "Predict Heads or Tails. Use an item before you lock in.";
    }
  }

  function onReveal(data) {
    if (!active) return;
    setCoinFace(data.coin, false);
    if (obolCoinLabel) obolCoinLabel.textContent = String(data.coin || "").toUpperCase();
    if (data.result) {
      if (data.result.draw) {
        obolMsg.textContent = "Both matched the coin — no damage.";
      } else if (data.result.winnerIds && data.result.winnerIds[0] === socket.id) {
        const dmg = (data.result.damage && data.result.damage[0]) || null;
        obolMsg.textContent = dmg && dmg.amount
          ? "You win the round! Opponent takes " + dmg.amount + " damage."
          : "You win the round!";
      } else if (data.result.loserIds && data.result.loserIds[0] === socket.id) {
        const dmg = (data.result.damage || []).find((d) => d.targetId === socket.id);
        if (dmg && dmg.blocked) obolMsg.textContent = "You missed — Ward blocked the damage!";
        else if (dmg) obolMsg.textContent = "You missed — you take " + dmg.amount + " damage.";
        else obolMsg.textContent = "You missed this round.";
      } else {
        obolMsg.textContent = "Round resolved.";
      }
    }
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    if (obolTurnIndicator) obolTurnIndicator.textContent = "Match Over";
    if (data.draw) {
      obolMsg.textContent = data.message || "Draw!";
    } else {
      const youWin = data.winnerId === socket.id;
      obolMsg.textContent = (data.message || "Match over!") + (youWin ? " You win!" : "");
    }
    showEndButtons();
    renderState();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    socket.on("obolStarted", onStarted);

    socket.on("obolState", (data) => {
      if (!active && data && data.phase) {
        // Late state after start — ignore unless already showing.
      }
      if (!active) return;
      applyState(data);
    });

    socket.on("obolSuspense", () => {
      if (!active) return;
      setCoinFace("idle", true);
      if (obolCoinLabel) obolCoinLabel.textContent = "…";
      if (obolTurnIndicator) obolTurnIndicator.textContent = "Flipping…";
      if (obolMsg) obolMsg.textContent = "Both locked — resolving…";
    });

    socket.on("obolReveal", onReveal);

    socket.on("obolOver", onGameOver);

    socket.on("obolPlayAgainWait", () => {
      if (!active || !obolPlayAgainBtn) return;
      obolPlayAgainBtn.textContent = "Waiting for opponent...";
    });

    socket.on("obolReset", () => {
      if (!active) return;
      gameOver = false;
      hideEndButtons();
      if (obolMsg) obolMsg.textContent = "New match — predict the flip.";
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideObolScreen();
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
    if (!active || !obolMsg) return false;
    obolMsg.textContent = msg;
    return true;
  }

  window.Obol = { init, isActive, showError };
})();
