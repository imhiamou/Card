/*
 * Code Breaker — isolated cooperative race against a server-generated code.
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt or Word Chain handlers. Uses its own Socket.IO events
 * so it cannot collide with existing game traffic.
 *
 * Secret: exactly 6 digits, generated once per match, never sent to clients.
 * Turns: Player 1 (lobby creator) then Player 2, alternating.
 * Feedback: Wordle-style green / yellow / red per digit.
 */

const CODE_LENGTH = 6;
const GUESS_PATTERN = /^\d{6}$/;

function generateSecretCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

/*
 * Wordle-style digit evaluation.
 * First pass marks exact matches (green) and consumes those secret slots.
 * Second pass marks yellow when the digit exists elsewhere unused, else red.
 */
function evaluateGuess(secret, guess) {
  const colors = new Array(CODE_LENGTH);
  const secretChars = secret.split("");
  const guessChars = guess.split("");
  const used = new Array(CODE_LENGTH).fill(false);

  for (let i = 0; i < CODE_LENGTH; i++) {
    if (guessChars[i] === secretChars[i]) {
      colors[i] = "green";
      used[i] = true;
    }
  }

  for (let i = 0; i < CODE_LENGTH; i++) {
    if (colors[i] === "green") continue;
    let found = -1;
    for (let j = 0; j < CODE_LENGTH; j++) {
      if (!used[j] && secretChars[j] === guessChars[i]) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      colors[i] = "yellow";
      used[found] = true;
    } else {
      colors[i] = "red";
    }
  }

  return colors;
}

function isWinningColors(colors) {
  return colors.length === CODE_LENGTH && colors.every((c) => c === "green");
}

function getOpponent(room, playerId) {
  return room.players.find((p) => p.id !== playerId) || null;
}

function initRoomState(room) {
  room.cb = {
    secret: generateSecretCode(),
    history: [],
    currentTurn: null,
    over: false
  };
  room.cbRematch = {};
}

function publicHistory(room) {
  return room.cb.history.map((entry) => ({
    by: entry.by,
    name: entry.name,
    guess: entry.guess,
    colors: entry.colors.slice()
  }));
}

function emitTurnState(room, io) {
  room.players.forEach((player) => {
    // "cbTurnChanged" — Code Breaker only. Tells each client if it is their turn
    // and includes the shared guess history (never the secret).
    io.to(player.id).emit("cbTurnChanged", {
      yourTurn: player.id === room.cb.currentTurn,
      history: publicHistory(room),
      over: room.cb.over
    });
  });
}

/*
 * Called when both players have joined a lobby whose gameMode is
 * "code-breaker". Never called for Hidden Hunt or Word Chain lobbies.
 */
function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  // Player 1 (lobby creator) always guesses first.
  room.cb.currentTurn = room.players[0].id;

  room.players.forEach((player) => {
    // "codeBreakerStarted" — Code Breaker only. Launches the CB UI on both clients.
    io.to(player.id).emit("codeBreakerStarted", {
      room: roomCode,
      game: "code-breaker",
      yourTurn: player.id === room.cb.currentTurn,
      history: [],
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      codeLength: CODE_LENGTH
    });
  });
}

function registerSocket(socket, io, rooms) {
  /*
   * "submitCodeGuess" — Code Breaker only.
   * Payload: { roomCode, guess } where guess is exactly six digits.
   * Server validates turn, evaluates colors, broadcasts history, ends on all-green.
   */
  socket.on("submitCodeGuess", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "code-breaker") {
      socket.emit("errorMessage", "You are not in a Code Breaker lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.cb || room.cb.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (room.cb.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const raw = data && typeof data.guess === "string" ? data.guess.trim() : "";
    if (!GUESS_PATTERN.test(raw)) {
      socket.emit("errorMessage", "Guess must be exactly 6 digits (0-9 only).");
      return;
    }

    const colors = evaluateGuess(room.cb.secret, raw);
    const me = room.players.find((p) => p.id === socket.id);
    const entry = {
      by: socket.id,
      name: me.name,
      guess: raw,
      colors
    };
    room.cb.history.push(entry);

    // "codeBreakerGuess" — Code Breaker only. Shared board update for both players.
    io.to(roomCode).emit("codeBreakerGuess", {
      by: socket.id,
      name: me.name,
      guess: raw,
      colors: colors.slice(),
      history: publicHistory(room)
    });

    if (isWinningColors(colors)) {
      room.cb.over = true;
      // "codeBreakerOver" — Code Breaker only. Winner cracked the full code.
      io.to(roomCode).emit("codeBreakerOver", {
        winnerId: socket.id,
        winnerName: me.name,
        message: me.name + " cracked the code!",
        history: publicHistory(room)
        // secret intentionally omitted — clients never receive it
      });
      return;
    }

    const next = getOpponent(room, socket.id);
    if (!next) return;
    room.cb.currentTurn = next.id;
    emitTurnState(room, io);
  });

  /*
   * "codeBreakerPlayAgain" — Code Breaker only.
   * Both players must vote; then a fresh secret and history start.
   */
  socket.on("codeBreakerPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "code-breaker" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.cb || !room.cb.over) {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }

    if (!room.cbRematch) room.cbRematch = {};
    room.cbRematch[socket.id] = true;

    if (!room.players.every((p) => room.cbRematch[p.id])) {
      // "codeBreakerPlayAgainWait" — Code Breaker only.
      socket.emit("codeBreakerPlayAgainWait");
      return;
    }

    room.cbRematch = {};
    onBothPlayersJoined(room, io, roomCode);
    // "codeBreakerReset" — Code Breaker only. Fresh match in the same lobby.
    io.to(roomCode).emit("codeBreakerReset");
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  evaluateGuess,
  generateSecretCode,
  CODE_LENGTH
};
