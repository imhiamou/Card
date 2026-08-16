/*
 * Code Breaker — isolated competitive race.
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt or Word Chain handlers. Uses its own Socket.IO events
 * so it cannot collide with existing game traffic.
 *
 * Each player gets a private 6-digit secret and guesses simultaneously.
 * Feedback: Wordle-style green / yellow / red per digit.
 * Winner: fewest guesses; if tied, fastest crack time. Equal both → draw.
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

function playerSlot(room, playerId) {
  return room.cb && room.cb.slots ? room.cb.slots[playerId] : null;
}

function publicHistoryFor(slot) {
  return (slot.history || []).map((entry) => ({
    by: entry.by,
    name: entry.name,
    guess: entry.guess,
    colors: entry.colors.slice()
  }));
}

/** Public race progress (never includes secrets or opponent digit colors). */
function publicScores(room) {
  return room.players.map((p) => {
    const slot = playerSlot(room, p.id);
    return {
      id: p.id,
      name: p.name,
      guessCount: slot ? slot.guessCount : 0,
      finished: !!(slot && slot.finished),
      elapsedMs: slot && slot.finished ? slot.elapsedMs : null
    };
  });
}

function initRoomState(room) {
  const startedAt = Date.now();
  const slots = {};
  room.players.forEach((p) => {
    slots[p.id] = {
      secret: generateSecretCode(),
      history: [],
      guessCount: 0,
      finished: false,
      finishedAt: null,
      elapsedMs: null
    };
  });
  room.cb = {
    startedAt,
    over: false,
    slots,
    winnerId: null,
    draw: false
  };
  room.cbRematch = {};
}

function emitPrivateState(room, io, playerId, extra) {
  const slot = playerSlot(room, playerId);
  if (!slot) return;
  io.to(playerId).emit("cbRaceState", Object.assign({
    history: publicHistoryFor(slot),
    scores: publicScores(room),
    finished: !!slot.finished,
    over: room.cb.over,
    startedAt: room.cb.startedAt,
    canGuess: !room.cb.over && !slot.finished
  }, extra || {}));
}

function emitScores(room, io, roomCode) {
  io.to(roomCode).emit("codeBreakerScores", {
    scores: publicScores(room),
    over: room.cb.over,
    startedAt: room.cb.startedAt
  });
}

/**
 * Compare finished slots: fewer guesses wins; same guesses → lower elapsedMs.
 * Returns { winnerId, draw }.
 */
function decideWinner(room) {
  const rows = room.players.map((p) => {
    const slot = playerSlot(room, p.id);
    return {
      id: p.id,
      name: p.name,
      guessCount: slot.guessCount,
      elapsedMs: slot.elapsedMs
    };
  });
  if (rows.length < 2) {
    return { winnerId: rows[0] ? rows[0].id : null, draw: false };
  }
  const a = rows[0];
  const b = rows[1];
  if (a.guessCount !== b.guessCount) {
    return {
      winnerId: a.guessCount < b.guessCount ? a.id : b.id,
      draw: false
    };
  }
  if (a.elapsedMs !== b.elapsedMs) {
    return {
      winnerId: a.elapsedMs < b.elapsedMs ? a.id : b.id,
      draw: false
    };
  }
  return { winnerId: null, draw: true };
}

function tryFinishMatch(room, io, roomCode) {
  if (!room.cb || room.cb.over) return;
  const allDone = room.players.every((p) => {
    const slot = playerSlot(room, p.id);
    return slot && slot.finished;
  });
  if (!allDone) return;

  room.cb.over = true;
  const result = decideWinner(room);
  room.cb.winnerId = result.winnerId;
  room.cb.draw = !!result.draw;

  const winner = result.winnerId
    ? room.players.find((p) => p.id === result.winnerId)
    : null;
  let message;
  if (result.draw) {
    message = "Draw — same guesses and time!";
  } else if (winner) {
    const slot = playerSlot(room, winner.id);
    message = winner.name + " wins with " + slot.guessCount +
      " guess" + (slot.guessCount === 1 ? "" : "es") +
      " in " + (slot.elapsedMs / 1000).toFixed(1) + "s!";
  } else {
    message = "Match over.";
  }

  // "codeBreakerOver" — Code Breaker only.
  io.to(roomCode).emit("codeBreakerOver", {
    winnerId: result.winnerId,
    winnerName: winner ? winner.name : null,
    draw: !!result.draw,
    message,
    scores: publicScores(room),
    startedAt: room.cb.startedAt
  });

  room.players.forEach((p) => emitPrivateState(room, io, p.id, { canGuess: false }));
}

/*
 * Called when both players have joined a lobby whose gameMode is
 * "code-breaker". Never called for Hidden Hunt or Word Chain lobbies.
 */
function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);

  room.players.forEach((player) => {
    const slot = playerSlot(room, player.id);
    // "codeBreakerStarted" — Code Breaker only. Launches the CB UI on both clients.
    io.to(player.id).emit("codeBreakerStarted", {
      room: roomCode,
      game: "code-breaker",
      raceMode: true,
      yourTurn: true,
      canGuess: true,
      finished: false,
      history: [],
      scores: publicScores(room),
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      codeLength: CODE_LENGTH,
      startedAt: room.cb.startedAt
    });
    // Keep slot reference so secrets are never mixed up.
    void slot;
  });
}

function registerSocket(socket, io, rooms) {
  /*
   * "submitCodeGuess" — Code Breaker only.
   * Payload: { roomCode, guess } where guess is exactly six digits.
   * Each player guesses against their own secret, simultaneously.
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

    const slot = playerSlot(room, socket.id);
    if (!slot) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (slot.finished) {
      socket.emit("errorMessage", "You already cracked your code — wait for your opponent.");
      return;
    }

    const raw = data && typeof data.guess === "string" ? data.guess.trim() : "";
    if (!GUESS_PATTERN.test(raw)) {
      socket.emit("errorMessage", "Guess must be exactly 6 digits (0-9 only).");
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    const colors = evaluateGuess(slot.secret, raw);
    const entry = {
      by: socket.id,
      name: me.name,
      guess: raw,
      colors
    };
    slot.history.push(entry);
    slot.guessCount += 1;

    // Private board update for the guesser only (opponent has a different secret).
    io.to(socket.id).emit("codeBreakerGuess", {
      by: socket.id,
      name: me.name,
      guess: raw,
      colors: colors.slice(),
      history: publicHistoryFor(slot),
      private: true
    });

    if (isWinningColors(colors)) {
      slot.finished = true;
      slot.finishedAt = Date.now();
      slot.elapsedMs = Math.max(0, slot.finishedAt - room.cb.startedAt);
      // "codeBreakerCracked" — Code Breaker only. One player finished their code.
      io.to(roomCode).emit("codeBreakerCracked", {
        by: socket.id,
        name: me.name,
        guessCount: slot.guessCount,
        elapsedMs: slot.elapsedMs,
        scores: publicScores(room)
      });
      emitScores(room, io, roomCode);
      emitPrivateState(room, io, socket.id, { finished: true, canGuess: false });
      tryFinishMatch(room, io, roomCode);
      return;
    }

    emitScores(room, io, roomCode);
    emitPrivateState(room, io, socket.id);
  });

  /*
   * "codeBreakerPlayAgain" — Code Breaker only.
   * Both players must vote; then fresh secrets and a new race start.
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
  decideWinner,
  CODE_LENGTH
};
