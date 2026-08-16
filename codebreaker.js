/* Code Breaker — client module (isolated from Hidden Hunt / Word Chain). */
(function () {
  const SCREEN_HTML =
    '<h2>Code Breaker</h2>' +
    '<div class="cbPlayers">' +
      '<div class="cbPlayer" id="cbMyName">You</div>' +
      '<div class="cbVs">VS</div>' +
      '<div class="cbPlayer" id="cbOppName">Opponent</div>' +
    '</div>' +
    '<div id="cbScoreboard" class="cbScoreboard"></div>' +
    '<h2 id="cbTurnIndicator"></h2>' +
    '<p id="cbTimer" class="cbTimer">0.0s</p>' +
    '<p id="cbHint" class="cbHint">Each of you has a private 6-digit code. Guess at the same time — fewest guesses wins; if tied, fastest time wins. Green = right spot, yellow = wrong spot, red = not in the code.</p>' +
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
  let canGuess = false;
  let finished = false;
  let players = [];
  let scores = [];
  let active = false;
  let gameOver = false;
  let history = [];
  let startedAt = null;
  let timerInterval = null;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let codeBreakerScreen;
  let cbTurnIndicator;
  let cbTimer;
  let cbGuessInput;
  let cbSubmitBtn;
  let cbHistory;
  let cbMsg;
  let cbEndButtons;
  let cbPlayAgainBtn;
  let cbMyName;
  let cbOppName;
  let cbScoreboard;

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
    cbTimer = $("cbTimer");
    cbGuessInput = $("cbGuessInput");
    cbSubmitBtn = $("cbSubmitBtn");
    cbHistory = $("cbHistory");
    cbMsg = $("cbMsg");
    cbEndButtons = $("cbEndButtons");
    cbPlayAgainBtn = $("cbPlayAgainBtn");
    cbMyName = $("cbMyName");
    cbOppName = $("cbOppName");
    cbScoreboard = $("cbScoreboard");
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
    stopTimerTick();
    if (codeBreakerScreen) codeBreakerScreen.classList.add("hidden");
  }

  function stopTimerTick() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatElapsed(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    return (ms / 1000).toFixed(1) + "s";
  }

  function renderTimer() {
    if (!cbTimer) return;
    if (gameOver) {
      cbTimer.classList.toggle("urgent", false);
      return;
    }
    if (finished && socket) {
      const mine = scores.find((s) => s.id === socket.id);
      cbTimer.textContent = mine && mine.elapsedMs != null
        ? formatElapsed(mine.elapsedMs)
        : formatElapsed(startedAt ? Date.now() - startedAt : 0);
      cbTimer.classList.toggle("urgent", false);
      return;
    }
    if (!startedAt) {
      cbTimer.textContent = "0.0s";
      return;
    }
    cbTimer.textContent = formatElapsed(Date.now() - startedAt);
  }

  function startTimerTick(at) {
    startedAt = at || null;
    stopTimerTick();
    renderTimer();
    if (!startedAt || gameOver) return;
    timerInterval = setInterval(renderTimer, 100);
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
    const source = list || [];
    const entries = source.slice().reverse();
    entries.forEach((entry) => {
      const block = document.createElement("div");
      block.className = "cbGuessBlock";

      const who = document.createElement("div");
      who.className = "cbGuessWho";
      who.textContent = "Guess " + (source.indexOf(entry) + 1);
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

  function renderScoreboard() {
    if (!cbScoreboard) return;
    const me = socket && scores.find((s) => s.id === socket.id);
    const opp = socket && scores.find((s) => s.id !== socket.id);
    function line(label, row, mine) {
      if (!row) return "<div class=\"cbScoreRow\">" + label + ": —</div>";
      let detail = row.guessCount + " guess" + (row.guessCount === 1 ? "" : "es");
      if (row.finished) {
        detail += " · cracked in " + formatElapsed(row.elapsedMs);
      } else if (!gameOver) {
        detail += " · racing…";
      }
      return "<div class=\"cbScoreRow" + (mine ? " mine" : "") + "\">" +
        "<strong>" + label + "</strong> " + detail + "</div>";
    }
    cbScoreboard.innerHTML =
      line("You", me, true) +
      line((players.find((p) => socket && p.id !== socket.id) || {}).name || "Opponent", opp, false);
  }

  function renderState() {
    const me = players.find((p) => p.id === socket.id);
    const opp = players.find((p) => p.id !== socket.id);
    if (cbMyName) cbMyName.textContent = me ? me.name : "You";
    if (cbOppName) cbOppName.textContent = opp ? opp.name : "Opponent";

    if (gameOver) {
      cbTurnIndicator.textContent = "Race Over";
    } else if (finished) {
      cbTurnIndicator.textContent = "Code cracked — waiting…";
    } else {
      cbTurnIndicator.textContent = "Crack your code!";
    }

    const allow = canGuess && !gameOver && !finished;
    if (cbGuessInput) cbGuessInput.disabled = !allow;
    if (cbSubmitBtn) cbSubmitBtn.disabled = !allow;
    renderHistory(history);
    renderScoreboard();
    renderTimer();
  }

  function submitGuess() {
    if (!currentRoom || !canGuess || finished || gameOver) return;
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
    scores = data.scores || [];
    canGuess = data.canGuess !== false;
    finished = !!data.finished;
    history = data.history || [];
    gameOver = false;
    hideEndButtons();
    startTimerTick(data.startedAt || Date.now());
    renderState();
    showCodeBreakerScreen();
    cbMsg.textContent = "Race on — crack your code with as few guesses as you can!";
    if (cbGuessInput) cbGuessInput.value = "";
  }

  function onGameOver(data) {
    if (!active) return;
    gameOver = true;
    canGuess = false;
    stopTimerTick();
    if (data.scores) scores = data.scores;
    renderState();
    if (data.draw) {
      cbMsg.textContent = data.message || "Draw!";
    } else {
      const youWin = data.winnerId === socket.id;
      cbMsg.textContent = (data.message || "Race over!") +
        (youWin ? " You win!" : "");
    }
    showEndButtons();
  }

  function init(sharedSocket) {
    socket = sharedSocket;

    // "codeBreakerStarted" — Code Breaker only.
    socket.on("codeBreakerStarted", onStarted);

    // "codeBreakerGuess" — private feedback for your own guesses.
    socket.on("codeBreakerGuess", (data) => {
      if (!active) return;
      if (data.history) history = data.history;
      cbMsg.textContent = "Guess recorded.";
      renderHistory(history);
      renderScoreboard();
    });

    // "cbRaceState" — private race sync (history + canGuess).
    socket.on("cbRaceState", (data) => {
      if (!active) return;
      if (data.history) history = data.history;
      if (data.scores) scores = data.scores;
      if (data.finished != null) finished = !!data.finished;
      if (data.canGuess != null) canGuess = !!data.canGuess;
      if (data.over) gameOver = true;
      if (data.startedAt) startedAt = data.startedAt;
      renderState();
    });

    // "codeBreakerScores" — public guess counts / finish times.
    socket.on("codeBreakerScores", (data) => {
      if (!active) return;
      if (data.scores) scores = data.scores;
      renderScoreboard();
    });

    // "codeBreakerCracked" — someone finished their private code.
    socket.on("codeBreakerCracked", (data) => {
      if (!active) return;
      if (data.scores) scores = data.scores;
      const mine = data.by === socket.id;
      if (mine) {
        finished = true;
        canGuess = false;
        cbMsg.textContent = "You cracked it in " + data.guessCount +
          " guess" + (data.guessCount === 1 ? "" : "es") +
          " (" + formatElapsed(data.elapsedMs) + "). Waiting for opponent…";
      } else {
        cbMsg.textContent = (data.name || "Opponent") + " cracked their code!";
      }
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
      finished = false;
      canGuess = true;
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
