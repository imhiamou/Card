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
    '<p id="wcRequiredLetter"></p>' +
    '<div class="wcInputRow">' +
      '<input id="wcWordInput" placeholder="Enter a word" autocomplete="off" maxlength="40">' +
      '<button type="button" id="wcSubmitBtn">Submit</button>' +
    '</div>' +
    '<p id="wcMsg"></p>' +
    '<div id="wcChainList"></div>' +
    '<button type="button" id="wcPlayAgainBtn" class="hidden">Play Again</button>';

  let socket = null;
  let currentRoom = null;
  let myTurn = null;
  let requiredLetter = null;
  let players = [];
  let active = false;

  let lobbyScreen;
  let placementScreen;
  let gameScreen;
  let wordChainScreen;
  let wcTurnIndicator;
  let wcRequiredLetter;
  let wcWordInput;
  let wcSubmitBtn;
  let wcChainList;
  let wcMsg;
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
    wcRequiredLetter = $("wcRequiredLetter");
    wcWordInput = $("wcWordInput");
    wcSubmitBtn = $("wcSubmitBtn");
    wcChainList = $("wcChainList");
    wcMsg = $("wcMsg");
    wcPlayAgainBtn = $("wcPlayAgainBtn");
    wcMyName = $("wcMyName");
    wcOppName = $("wcOppName");
    return true;
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
    if (wordChainScreen) wordChainScreen.classList.add("hidden");
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
    wcTurnIndicator.textContent = myTurn ? "Your Turn" : "Opponent's Turn";
    if (requiredLetter === null || requiredLetter === undefined) {
      wcRequiredLetter.textContent = "Play any valid English word to start the chain.";
    } else {
      wcRequiredLetter.textContent = "Next word must begin with: " + String(requiredLetter).toUpperCase();
    }
    wcWordInput.disabled = !myTurn;
    wcSubmitBtn.disabled = !myTurn;
  }

  function submitWord() {
    if (!currentRoom || !myTurn) return;
    const word = wcWordInput.value.trim();
    if (!word) {
      wcMsg.textContent = "Enter a word.";
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
    wcPlayAgainBtn.onclick = () => {
      if (!currentRoom) return;
      socket.emit("wordChainPlayAgain", { roomCode: currentRoom });
      wcPlayAgainBtn.disabled = true;
      wcPlayAgainBtn.textContent = "Waiting for opponent...";
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
    renderChain(data.chain || []);
    renderState();
    showWordChainScreen();
    wcMsg.textContent = "Game started!";
    wcPlayAgainBtn.classList.add("hidden");
    wcPlayAgainBtn.disabled = false;
    wcPlayAgainBtn.textContent = "Play Again";
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
      myTurn = data.yourTurn;
      requiredLetter = data.requiredLetter;
      if (data.chain) renderChain(data.chain);
      renderState();
    });

    socket.on("wordChainPlayAgainWait", () => {
      if (!active) return;
      wcPlayAgainBtn.textContent = "Waiting for opponent...";
    });

    socket.on("wordChainReset", () => {
      if (!active) return;
      wcMsg.textContent = "";
      wcPlayAgainBtn.classList.add("hidden");
      wcPlayAgainBtn.disabled = false;
      wcPlayAgainBtn.textContent = "Play Again";
      wcWordInput.value = "";
    });

    socket.on("playerLeft", () => {
      if (!active) return;
      hideWordChainScreen();
      currentRoom = null;
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
