const { isValidWord, normalizeWord } = require("../../dictionary");

/*
 * Word Chain — Game Mode 2
 *
 * Rules (server-authoritative):
 * - Player A opens with any valid English word.
 * - Each following word must start with the last letter of the previous word.
 * - Words must exist in the dictionary and not have been used before.
 * - Invalid submissions are rejected; the turn does not pass.
 * - Turns alternate automatically after each valid word.
 */

function initRoomState(room) {
  room.wc = {
    usedWords: [],
    lastWord: null,
    currentTurn: null,
    over: false
  };
}

function getRequiredLetter(room) {
  if (!room.wc.lastWord) return null;
  return room.wc.lastWord[room.wc.lastWord.length - 1];
}

/*
 * Called by the lobby when both players have joined a Word Chain lobby.
 * Picks a random starting player and emits "wordChainStarted" to each
 * client individually with { yourTurn }.
 */
function onBothPlayersJoined(room, io, { getOpponent }) {
  initRoomState(room);
  const starter = room.players[Math.floor(Math.random() * room.players.length)];
  room.wc.currentTurn = starter.id;

  room.players.forEach((player) => {
    io.to(player.id).emit("wordChainStarted", {
      yourTurn: player.id === room.wc.currentTurn,
      requiredLetter: null,
      chain: [],
      players: room.players.map((p) => ({ id: p.id, name: p.name }))
    });
  });
}

function registerSocket(socket, io, { rooms, getOpponent }) {

  /*
   * "submitWord" — active player submits a word for the chain.
   * Payload: { roomCode, word }
   *
   * Validates dictionary membership, uniqueness, and the chain letter
   * rule. On success broadcasts "wordPlayed" to the room and passes the
   * turn. On failure emits "errorMessage" to the submitter only.
   */
  socket.on("submitWord", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "word-chain") {
      socket.emit("errorMessage", "You are not in a Word Chain lobby.");
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

    room.players.forEach((player) => {
      io.to(player.id).emit("turnChanged", {
        yourTurn: player.id === room.wc.currentTurn,
        requiredLetter: nextLetter,
        chain: room.wc.usedWords.slice()
      });
    });
  });

  /*
   * "wordChainPlayAgain" — both players vote to reset the chain in the
   * same lobby without returning to the main menu.
   */
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
    onBothPlayersJoined(room, io, { getOpponent });
    io.to(roomCode).emit("wordChainReset");
  });
}

module.exports = {
  id: "word-chain",
  name: "Word Chain",
  requiresCharacter: false,
  onBothPlayersJoined,
  registerSocket
};
