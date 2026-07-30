/* Word Chain — client module (isolated from Hidden Hunt gameplay). */
(function () {
  const SCREEN_HTML =
    '<h2>Word Chain</h2>' +
    '<div class="wcPlayers">' +
      '<div class="wcPlayer" id="wcMyName">You</div>' +
      '<div class="wcVs">VS</div>' +
      '<div class="wcPlayer" id="wcOppName">Opponent</div>' +
    '</div>' +
    '<h2 id="wcTurnIndicator"></h2>' +
    '<p id="wcTimer" class="wcTimer">20</p>' +
    '<p id="wcRequiredLetter"></p>' +
    '<div class="wcInputRow">' +
      '<input id="wcWordInput" placeholder="Enter a word (3+ letters)" autocomplete="off" maxlength="40">' +
      '<button type="button" id="wcSubmitBtn">Submit</button>' +
    '</div>' +
    '<p id="wcMsg"></p>' +
    '<div id="wcChainList"></div>' +
    '<div id="wcEndButtons" class="wcEndButtons hidden">' +
      '<button type="button" id="wcKeepGoingBtn">Keep Going</button>' +
      '<button type="button" id="wcPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let myTurn = null;
  let requiredLetter = null;
  let players = [];
  let active = false;
  let gameOver = false;
  let turnEndsAt = null;
  let timerInterval = null;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let wcTurnIndicator;
  let wcTimer;
  let wcRequiredLetter;
  let wcWordInput;
  let wcSubmitBtn;
  let wcChainList;
  let wcMsg;
  let wcEndButtons;
  let wcKeepGoingBtn;
  let wcPlayAgainBtn;
  let wcMyName;
  let wcOppName;

  function $(id) {
    return document.getElementById(id);
  }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    if (!wordChainScreen) return false;
    if (!wordChainScreen.dataset.ready) {
      wordChainScreen.innerHTML = SCREEN_HTML;
      wordChainScreen.dataset.ready = "1";
    }
    wcTurnIndicator = $("wcTurnIndicator");
    wcTimer = $("wcTimer");
    wcRequiredLetter = $("wcRequiredLetter");
    wcWordInput = $("wcWordInput");
    wcSubmitBtn = $("wcSubmitBtn");
    wcChainList = $("wcChainList");
    wcMsg = $("wcMsg");
    wcEndButtons = $("wcEndButtons");
    wcKeepGoingBtn = $("wcKeepGoingBtn");
    wcPlayAgainBtn = $("wcPlayAgainBtn");
    wcMyName = $("wcMyName");
    wcOppName = $("wcOppName");
    return true;
  }

  function hideEndButtons() {
    if (!wcEndButtons) return;
    wcEndButtons.classList.add("hidden");
    if (wcKeepGoingBtn) {
      wcKeepGoingBtn.disabled = false;
      wcKeepGoingBtn.textContent = "Keep Going";
    }
    if (wcPlayAgainBtn) {
      wcPlayAgainBtn.disabled = false;
      wcPlayAgainBtn.textContent = "Play Again";
    }
  }

  function showEndButtons() {
    if (!wcEndButtons) return;
    hideEndButtons();
    wcEndButtons.classList.remove("hidden");
  }

  function showWordChainScreen() {
    active = true;
    if (lobbyScreen) lobbyScreen.classList.add("hidden");
    if (placementScreen) placementScreen.classList.add("hidden");
    if (gameScreen) gameScreen.classList.add("hidden");
    wordChainScreen.classList.remove("hidden");
  }

  function hideWordChainScreen() {
    active = false;
    stopTimerTick();
    if (wordChainScreen) wordChainScreen.classList.add("hidden");
  }

  function stopTimerTick() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function renderTimer() {
    if (!wcTimer) return;
    if (!turnEndsAt || gameOver) {
      wcTimer.textContent = gameOver ? "0" : "—";
      wcTimer.classList.toggle("urgent", false);
      return;
    }
    const left = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000));
    wcTimer.textContent = String(left);
    wcTimer.classList.toggle("urgent", left <= 5);
  }

  function startTimerTick(endsAt) {
    turnEndsAt = endsAt || null;
    stopTimerTick();
    renderTimer();
    if (!turnEndsAt || gameOver) return;
    timerInterval = setInterval(renderTimer, 200);
  }

  function renderChain(chain) {
    wcChainList.innerHTML = "";
    (chain || []).forEach((word, i) => {
      const row = document.createElement("div");
      row.className = "wcChainItem";
      row.textContent = (i + 1) + ". " + String(word).toUpperCase();
      wcChainList.appendChild(row);
    });
    wcChainList.scrollTop = wcChainList.scrollHeight;
  }

  function renderState() {
    const me = players.find((p) => p.id === socket.id);
    const opp = players.find((p) => p.id !== socket.id);
    wcMyName.textContent = me ? me.name : "You";
    wcOppName.textContent = opp ? opp.name : "Opponent";
    if (gameOver) {
      wcTurnIndicator.textContent = "Game Over";
    } else {
      wcTurnIndicator.textContent = myTurn ? "Your Turn" : "Opponent's Turn";
    }
    if (requiredLetter === null || requiredLetter === undefined) {
      wcRequiredLetter.textContent = "Play any valid English word (3+ letters) to start the chain.";
    } else {
      wcRequiredLetter.textContent = "Next word must begin with: " + String(requiredLetter).toUpperCase();
    }
    const canPlay = myTurn && !gameOver;
    wcWordInput.disabled = !canPlay;
    wcSubmitBtn.disabled = !canPlay;
    renderTimer();
  }

  function submitWord() {
    if (!currentRoom || !myTurn || gameOver) return;
    const word = wcWordInput.value.trim();
    if (!word) {
      wcMsg.textContent = "Enter a word.";
      return;
    }
    if (word.length < 3) {
      wcMsg.textContent = "Words must be at least 3 letters.";
      return;
    }
    socket.emit("submitWord", { roomCode: currentRoom, word });
    wcWordInput.value = "";
  }

  function wireControls() {
    if (!wcSubmitBtn || wcSubmitBtn.dataset.wired) return;
    wcSubmitBtn.dataset.wired = "1";
    wcSubmitBtn.onclick = submitWord;
    wcWordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitWord();
    });
    wcKeepGoingBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      socket.emit("wordChainKeepGoing", { roomCode: currentRoom });
      wcKeepGoingBtn.disabled = true;
      wcKeepGoingBtn.textContent = "Waiting for opponent...";
      if (wcPlayAgainBtn) wcPlayAgainBtn.disabled = true;
    };
    wcPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      socket.emit("wordChainPlayAgain", { roomCode: currentRoom });
      wcPlayAgainBtn.disabled = true;
      wcPlayAgainBtn.textContent = "Waiting for opponent...";
      if (wcKeepGoingBtn) wcKeepGoingBtn.disabled = true;
    };
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Word Chain screen missing from the page.");
      return;
    }
    wireControls();
    currentRoom = data.room;
    players = data.players || [];
    myTurn = data.yourTurn;
    requiredLetter = data.requiredLetter;
    gameOver = false;
    renderChain(data.chain || []);
    startTimerTick(data.turnEndsAt);
    renderState();
    showWordChainScreen();
    wcMsg.textContent = "Game started! You have 20 seconds per turn.";
    hideEndButtons();
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    myTurn = false;
    stopTimerTick();
    turnEndsAt = null;
    renderState();
    const youWin = data.winnerId === socket.id;
    wcMsg.textContent = (data.message || "Time's up!") +
      (youWin ? " You win!" : " You lose.") +
      " Keep Going to continue this chain, or Play Again for a fresh start.";
    showEndButtons();
  }

  function onContinued(data) {
    if (!active) return;
    gameOver = false;
    hideEndButtons();
    if (data.chain) renderChain(data.chain);
    if (data.requiredLetter !== undefined) requiredLetter = data.requiredLetter;
    startTimerTick(data.turnEndsAt);
    // Turn ownership comes from the following (or concurrent) wcTurnChanged.
    wcMsg.textContent = data.message || "Keep going! Same chain, fresh timer.";
    renderState();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // Register listeners immediately — do not depend on DOM bind succeeding
    // first, or a merge/DOM miss would leave players stuck on "Waiting...".
    socket.on("wordChainStarted", onStarted);

    socket.on("wordPlayed", (data) => {
      if (!active) return;
      wcMsg.textContent = (data.name || "Player") + " played: " + String(data.word).toUpperCase();
    });

    socket.on("wcTurnChanged", (data) => {
      if (!active) return;
      // After Keep Going, over is cleared server-side and turns resume.
      if (gameOver && !data.turnEndsAt) return;
      if (gameOver) hideEndButtons();
      gameOver = false;
      myTurn = data.yourTurn;
      requiredLetter = data.requiredLetter;
      if (data.chain) renderChain(data.chain);
      startTimerTick(data.turnEndsAt);
      renderState();
    });

    socket.on("wordChainOver", onGameOver);

    socket.on("wordChainKeepGoingWait", () => {
      if (!active || !wcKeepGoingBtn) return;
      wcKeepGoingBtn.textContent = "Waiting for opponent...";
    });

    socket.on("wordChainContinued", onContinued);

    socket.on("wordChainPlayAgainWait", () => {
      if (!active || !wcPlayAgainBtn) return;
      wcPlayAgainBtn.textContent = "Waiting for opponent...";
    });

    socket.on("wordChainReset", () => {
      if (!active) return;
      gameOver = false;
      wcMsg.textContent = "";
      hideEndButtons();
      wcWordInput.value = "";
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideWordChainScreen();
      currentRoom = null;
      gameOver = false;
    });

    if (bindDom()) wireControls();
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !wcMsg) return false;
    wcMsg.textContent = msg;
    return true;
  }

  window.WordChain = { init, isActive, showError };
})();
