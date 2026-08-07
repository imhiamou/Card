/* Code Breaker — client module (isolated from Hidden Hunt / Word Chain). */
(function () {
  const SCREEN_HTML =
    '<h2>Code Breaker</h2>' +
    '<div class="cbPlayers">' +
      '<div class="cbPlayer" id="cbMyName">You</div>' +
      '<div class="cbVs">VS</div>' +
      '<div class="cbPlayer" id="cbOppName">Opponent</div>' +
    '</div>' +
    '<h2 id="cbTurnIndicator"></h2>' +
    '<p id="cbHint" class="cbHint">Guess the 6-digit secret code. Green = right spot, yellow = wrong spot, red = not in the code.</p>' +
    '<div id="cbHistory" class="cbHistory"></div>' +
    '<div class="cbInputRow">' +
      '<input id="cbGuessInput" placeholder="Enter 6 digits" inputmode="numeric" autocomplete="off" maxlength="6">' +
      '<button type="button" id="cbSubmitBtn">Submit Guess</button>' +
    '</div>' +
    '<p id="cbMsg"></p>' +
    '<div id="cbEndButtons" class="cbEndButtons hidden">' +
      '<button type="button" id="cbPlayAgainBtn">Play Again</button>' +
    '</div>';

  let socket = null;
  let currentRoom = null;
  let myTurn = null;
  let players = [];
  let active = false;
  let gameOver = false;
  let history = [];

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let cbTurnIndicator;
  let cbGuessInput;
  let cbSubmitBtn;
  let cbHistory;
  let cbMsg;
  let cbEndButtons;
  let cbPlayAgainBtn;
  let cbMyName;
  let cbOppName;

  function $(id) {
    return document.getElementById(id);
  }

  function bindDom() {
    lobbyScreen = $("lobbyScreen");
    placementScreen = $("placementScreen");
    gameScreen = $("gameScreen");
    wordChainScreen = $("wordChainScreen");
    codeBreakerScreen = $("codeBreakerScreen");
    if (!codeBreakerScreen) return false;
    if (!codeBreakerScreen.dataset.ready) {
      codeBreakerScreen.innerHTML = SCREEN_HTML;
      codeBreakerScreen.dataset.ready = "1";
    }
    cbTurnIndicator = $("cbTurnIndicator");
    cbGuessInput = $("cbGuessInput");
    cbSubmitBtn = $("cbSubmitBtn");
    cbHistory = $("cbHistory");
    cbMsg = $("cbMsg");
    cbEndButtons = $("cbEndButtons");
    cbPlayAgainBtn = $("cbPlayAgainBtn");
    cbMyName = $("cbMyName");
    cbOppName = $("cbOppName");
    return true;
  }

  function hideEndButtons() {
    if (!cbEndButtons) return;
    cbEndButtons.classList.add("hidden");
    if (cbPlayAgainBtn) {
      cbPlayAgainBtn.disabled = false;
      cbPlayAgainBtn.textContent = "Play Again";
    }
  }

  function showEndButtons() {
    if (!cbEndButtons) return;
    hideEndButtons();
    cbEndButtons.classList.remove("hidden");
  }

  function showCodeBreakerScreen() {
    active = true;
    if (lobbyScreen) lobbyScreen.classList.add("hidden");
    if (placementScreen) placementScreen.classList.add("hidden");
    if (gameScreen) gameScreen.classList.add("hidden");
    if (wordChainScreen) wordChainScreen.classList.add("hidden");
    codeBreakerScreen.classList.remove("hidden");
  }

  function hideCodeBreakerScreen() {
    active = false;
    if (codeBreakerScreen) codeBreakerScreen.classList.add("hidden");
  }

  function colorClass(color) {
    if (color === "green") return "cbDigit green";
    if (color === "yellow") return "cbDigit yellow";
    return "cbDigit red";
  }

  function renderHistory(list) {
    if (!cbHistory) return;
    cbHistory.innerHTML = "";
    // Newest guess on top so the latest attempt stays visible above the input
    // (especially on phones when the keyboard opens).
    const entries = (list || []).slice().reverse();
    entries.forEach((entry) => {
      const block = document.createElement("div");
      block.className = "cbGuessBlock";

      const who = document.createElement("div");
      who.className = "cbGuessWho";
      who.textContent = entry.name || "Player";
      block.appendChild(who);

      const digits = document.createElement("div");
      digits.className = "cbGuessDigits";
      const guess = String(entry.guess || "");
      const colors = entry.colors || [];
      for (let i = 0; i < guess.length; i++) {
        const cell = document.createElement("span");
        cell.className = colorClass(colors[i]);
        cell.textContent = guess[i];
        digits.appendChild(cell);
      }
      block.appendChild(digits);

      cbHistory.appendChild(block);
    });
    cbHistory.scrollTop = 0;
  }

  function renderState() {
    const me = players.find((p) => p.id === socket.id);
    const opp = players.find((p) => p.id !== socket.id);
    if (cbMyName) cbMyName.textContent = me ? me.name : "You";
    if (cbOppName) cbOppName.textContent = opp ? opp.name : "Opponent";

    if (gameOver) {
      cbTurnIndicator.textContent = "Code Cracked!";
    } else {
      cbTurnIndicator.textContent = myTurn ? "Your Turn" : "Opponent's Turn";
    }

    const canPlay = myTurn && !gameOver;
    if (cbGuessInput) cbGuessInput.disabled = !canPlay;
    if (cbSubmitBtn) cbSubmitBtn.disabled = !canPlay;
    renderHistory(history);
  }

  function submitGuess() {
    if (!currentRoom || !myTurn || gameOver) return;
    const guess = cbGuessInput.value.trim();
    if (!/^\d{6}$/.test(guess)) {
      cbMsg.textContent = "Guess must be exactly 6 digits.";
      return;
    }
    // "submitCodeGuess" — Code Breaker only.
    socket.emit("submitCodeGuess", { roomCode: currentRoom, guess });
    cbGuessInput.value = "";
  }

  function wireControls() {
    if (!cbSubmitBtn || cbSubmitBtn.dataset.wired) return;
    cbSubmitBtn.dataset.wired = "1";
    cbSubmitBtn.onclick = submitGuess;
    cbGuessInput.addEventListener("input", () => {
      cbGuessInput.value = cbGuessInput.value.replace(/\D/g, "").slice(0, 6);
    });
    cbGuessInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitGuess();
    });
    cbPlayAgainBtn.onclick = () => {
      if (!currentRoom || !gameOver) return;
      // "codeBreakerPlayAgain" — Code Breaker only.
      socket.emit("codeBreakerPlayAgain", { roomCode: currentRoom });
      cbPlayAgainBtn.disabled = true;
      cbPlayAgainBtn.textContent = "Waiting for opponent...";
    };
  }

  function onStarted(data) {
    if (!bindDom()) {
      console.error("Code Breaker screen missing from the page.");
      return;
    }
    wireControls();
    currentRoom = data.room;
    players = data.players || [];
    myTurn = data.yourTurn;
    history = data.history || [];
    gameOver = false;
    hideEndButtons();
    renderState();
    showCodeBreakerScreen();
    cbMsg.textContent = "Crack the 6-digit code together — take turns guessing!";
    if (cbGuessInput) cbGuessInput.value = "";
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    myTurn = false;
    if (data.history) history = data.history;
    renderState();
    const youWin = data.winnerId === socket.id;
    cbMsg.textContent = (data.message || "Code cracked!") +
      (youWin ? " Nice work!" : "");
    showEndButtons();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "codeBreakerStarted" — Code Breaker only.
    socket.on("codeBreakerStarted", onStarted);

    // "codeBreakerGuess" — Code Breaker only. Shared guess + colors.
    socket.on("codeBreakerGuess", (data) => {
      if (!active) return;
      if (data.history) history = data.history;
      cbMsg.textContent = (data.name || "Player") + " guessed " + String(data.guess);
      renderHistory(history);
    });

    // "cbTurnChanged" — Code Breaker only.
    socket.on("cbTurnChanged", (data) => {
      if (!active) return;
      if (data.over) return;
      gameOver = false;
      myTurn = data.yourTurn;
      if (data.history) history = data.history;
      renderState();
    });

    // "codeBreakerOver" — Code Breaker only.
    socket.on("codeBreakerOver", onGameOver);

    // "codeBreakerPlayAgainWait" — Code Breaker only.
    socket.on("codeBreakerPlayAgainWait", () => {
      if (!active || !cbPlayAgainBtn) return;
      cbPlayAgainBtn.textContent = "Waiting for opponent...";
    });

    // "codeBreakerReset" — Code Breaker only.
    socket.on("codeBreakerReset", () => {
      if (!active) return;
      gameOver = false;
      cbMsg.textContent = "";
      hideEndButtons();
      if (cbGuessInput) cbGuessInput.value = "";
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideCodeBreakerScreen();
      currentRoom = null;
      gameOver = false;
    });

    if (bindDom()) wireControls();
  }

  function isActive() {
    return active;
  }

  function showError(msg) {
    if (!active || !cbMsg) return false;
    cbMsg.textContent = msg;
    return true;
  }

  window.CodeBreaker = { init, isActive, showError };
})();
