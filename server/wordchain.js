/*
 * Word Chain — isolated game mode.
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt handlers or card logic. Uses its own events so it cannot
 * collide with Hidden Hunt's "turnChanged" / "gameStarted" / etc.
 */
const { isValidWord, normalizeWord } = require("./dictionary");

function initRoomState(room) {
  room.wc = {
    usedWords: [],
    lastWord: null,
    currentTurn: null,
    over: false
  };
  room.wcRematch = {};
}

function getRequiredLetter(room) {
  if (!room.wc || !room.wc.lastWord) return null;
  return room.wc.lastWord[room.wc.lastWord.length - 1];
}

function getOpponent(room, playerId) {
  return room.players.find((p) => p.id !== playerId);
}

/*
 * Called when both players have joined a lobby whose gameMode is
 * "word-chain". Never called for Hidden Hunt lobbies.
 */
function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  const starter = room.players[Math.floor(Math.random() * room.players.length)];
  room.wc.currentTurn = starter.id;

  room.players.forEach((player) => {
    io.to(player.id).emit("wordChainStarted", {
      room: roomCode,
      game: "word-chain",
      yourTurn: player.id === room.wc.currentTurn,
      requiredLetter: null,
      chain: [],
      players: room.players.map((p) => ({ id: p.id, name: p.name }))
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
    const nextLetter = word[word.length - 1];

    // Dedicated WC event — never emit Hidden Hunt's "turnChanged".
    room.players.forEach((player) => {
      io.to(player.id).emit("wcTurnChanged", {
        yourTurn: player.id === room.wc.currentTurn,
        requiredLetter: nextLetter,
        chain: room.wc.usedWords.slice()
      });
    });
  });

  socket.on("wordChainPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "word-chain" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }

    if (!room.wcRematch) room.wcRematch = {};
    room.wcRematch[socket.id] = true;

    if (!room.players.every((p) => room.wcRematch[p.id])) {
      socket.emit("wordChainPlayAgainWait");
      return;
    }

    room.wcRematch = {};
    onBothPlayersJoined(room, io, roomCode);
    io.to(roomCode).emit("wordChainReset");
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket
};
