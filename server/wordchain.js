/*
 * Word Chain — isolated game mode.
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt handlers or card logic. Uses its own events so it cannot
 * collide with Hidden Hunt's "turnChanged" / "gameStarted" / etc.
 *
 * Each turn has a 20-second timer. Timing out ends the game (opponent wins).
 * Words must be at least 3 letters (no 2-letter words).
 */
const { isValidWord, normalizeWord, MIN_WORD_LENGTH } = require("./dictionary");

const TURN_SECONDS = 20;

function initRoomState(room) {
  clearTurnTimer(room);
  room.wc = {
    usedWords: [],
    lastWord: null,
    currentTurn: null,
    over: false,
    timer: null,
    turnEndsAt: null
  };
  room.wcRematch = {};
  room.wcKeepGoing = {};
}

function getRequiredLetter(room) {
  if (!room.wc || !room.wc.lastWord) return null;
  return room.wc.lastWord[room.wc.lastWord.length - 1];
}

function getOpponent(room, playerId) {
  return room.players.find((p) => p.id !== playerId);
}

function clearTurnTimer(room) {
  if (room.wc && room.wc.timer) {
    clearTimeout(room.wc.timer);
    room.wc.timer = null;
  }
  if (room.wc) room.wc.turnEndsAt = null;
}

function emitTurnState(room, io) {
  const requiredLetter = getRequiredLetter(room);
  room.players.forEach((player) => {
    io.to(player.id).emit("wcTurnChanged", {
      yourTurn: player.id === room.wc.currentTurn,
      requiredLetter,
      chain: room.wc.usedWords.slice(),
      turnEndsAt: room.wc.turnEndsAt,
      turnSeconds: TURN_SECONDS
    });
  });
}

function endGameOnTimeout(room, io, roomCode, timedPlayerId) {
  if (!room.wc || room.wc.over) return;
  if (room.wc.currentTurn !== timedPlayerId) return;

  clearTurnTimer(room);
  room.wc.over = true;

  const loser = room.players.find((p) => p.id === timedPlayerId);
  const winner = getOpponent(room, timedPlayerId);
  if (!winner || !loser) return;

  io.to(roomCode).emit("wordChainOver", {
    reason: "timeout",
    winnerId: winner.id,
    winnerName: winner.name,
    loserId: loser.id,
    loserName: loser.name,
    message: loser.name + " ran out of time. " + winner.name + " wins!"
  });
}

function startTurnTimer(room, io, roomCode) {
  clearTurnTimer(room);
  if (!room.wc || room.wc.over) return;

  const timedPlayerId = room.wc.currentTurn;
  room.wc.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  room.wc.timer = setTimeout(() => {
    endGameOnTimeout(room, io, roomCode, timedPlayerId);
  }, TURN_SECONDS * 1000);
}

/*
 * Called when both players have joined a lobby whose gameMode is
 * "word-chain". Never called for Hidden Hunt lobbies.
 */
function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  const starter = room.players[Math.floor(Math.random() * room.players.length)];
  room.wc.currentTurn = starter.id;
  startTurnTimer(room, io, roomCode);

  room.players.forEach((player) => {
    io.to(player.id).emit("wordChainStarted", {
      room: roomCode,
      game: "word-chain",
      yourTurn: player.id === room.wc.currentTurn,
      requiredLetter: null,
      chain: [],
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      turnEndsAt: room.wc.turnEndsAt,
      turnSeconds: TURN_SECONDS,
      minWordLength: MIN_WORD_LENGTH
    });
  });
}

function registerSocket(socket, io, rooms) {
  socket.on("submitWord", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "word-chain") {
      socket.emit("errorMessage", "You are not in a Word Chain lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.wc || room.wc.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (room.wc.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const raw = data && typeof data.word === "string" ? data.word.trim() : "";
    if (!raw) {
      socket.emit("errorMessage", "Enter a word.");
      return;
    }

    const word = normalizeWord(raw);
    if (!/^[a-z]+$/.test(word)) {
      socket.emit("errorMessage", "Words may only contain letters.");
      return;
    }
    if (word.length < MIN_WORD_LENGTH) {
      socket.emit("errorMessage", "Words must be at least " + MIN_WORD_LENGTH + " letters.");
      return;
    }
    if (!isValidWord(word)) {
      socket.emit("errorMessage", "\"" + raw + "\" is not in the dictionary.");
      return;
    }
    if (room.wc.usedWords.includes(word)) {
      socket.emit("errorMessage", "That word was already used.");
      return;
    }

    const required = getRequiredLetter(room);
    if (required !== null && word[0] !== required) {
      socket.emit("errorMessage", "Word must begin with \"" + required.toUpperCase() + "\".");
      return;
    }

    room.wc.usedWords.push(word);
    room.wc.lastWord = word;

    const me = room.players.find((p) => p.id === socket.id);
    io.to(roomCode).emit("wordPlayed", {
      by: socket.id,
      name: me.name,
      word
    });

    const next = getOpponent(room, socket.id);
    room.wc.currentTurn = next.id;
    startTurnTimer(room, io, roomCode);
    emitTurnState(room, io);
  });

  socket.on("wordChainPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "word-chain" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.wc || !room.wc.over) {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }

    if (!room.wcRematch) room.wcRematch = {};
    room.wcRematch[socket.id] = true;
    // Choosing a full reset cancels a pending Keep Going vote.
    if (room.wcKeepGoing) delete room.wcKeepGoing[socket.id];

    if (!room.players.every((p) => room.wcRematch[p.id])) {
      socket.emit("wordChainPlayAgainWait");
      return;
    }

    room.wcRematch = {};
    room.wcKeepGoing = {};
    onBothPlayersJoined(room, io, roomCode);
    io.to(roomCode).emit("wordChainReset");
  });

  /*
   * "wordChainKeepGoing" — after a timeout loss, both players can vote
   * to resume the SAME chain (words stay). The timed-out player gets
   * another turn with a fresh 20s timer.
   */
  socket.on("wordChainKeepGoing", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "word-chain" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.wc || !room.wc.over) {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }

    if (!room.wcKeepGoing) room.wcKeepGoing = {};
    room.wcKeepGoing[socket.id] = true;
    // Choosing Keep Going cancels a pending Play Again vote.
    if (room.wcRematch) delete room.wcRematch[socket.id];

    if (!room.players.every((p) => room.wcKeepGoing[p.id])) {
      socket.emit("wordChainKeepGoingWait");
      return;
    }

    room.wcKeepGoing = {};
    room.wcRematch = {};
    room.wc.over = false;
    // Resume the timed-out player's turn; chain / required letter unchanged.
    startTurnTimer(room, io, roomCode);
    emitTurnState(room, io);
    io.to(roomCode).emit("wordChainContinued", {
      message: "Keep going! Same chain, fresh timer.",
      chain: room.wc.usedWords.slice(),
      requiredLetter: getRequiredLetter(room),
      turnEndsAt: room.wc.turnEndsAt
    });
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  TURN_SECONDS,
  MIN_WORD_LENGTH
};
