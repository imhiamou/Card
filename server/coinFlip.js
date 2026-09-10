/*
 * Coin Flip — isolated 1v1 turn-based wagering game.
 *
 * Lobby gameMode: "coin-flip". Uses room.cf state and its own Socket.IO
 * events. Does not alter Hidden Hunt, Word Chain, Code Breaker, Dominoes,
 * UNO, Dodge Ball, or O.B.O.L.
 *
 * Design (modular foundation — rules may change later):
 * - Server generates fair Heads/Tails sequences (batches of 5).
 * - Both players see the same upcoming 5 throws.
 * - Turns alternate; only the active player may act.
 * - Round wager starts at 1 and increases each full round.
 * - Active player chooses a wager 1..min(roundWager, ownHP, oppHP), then flips.
 * - Heads → active player wins (opponent loses hearts).
 * - Tails → active player loses (self loses hearts).
 * - Animation never decides the result; server already knows it.
 */

const STARTING_HEARTS = 10;
const QUEUE_SIZE = 5;
const SUSPENSE_MS = 1400;
const BETWEEN_TURN_MS = 900;
const SIDES = ["heads", "tails"];

/* ---- 1. Coin sequence generation (server-only) ---- */

function randomSide() {
  return Math.random() < 0.5 ? "heads" : "tails";
}

function generateThrowBatch(count) {
  const n = count || QUEUE_SIZE;
  const batch = [];
  for (let i = 0; i < n; i++) batch.push(randomSide());
  return batch;
}

function ensureQueue(cf) {
  while (cf.queue.length < QUEUE_SIZE) {
    cf.queue.push.apply(cf.queue, generateThrowBatch(QUEUE_SIZE));
  }
}

function peekUpcoming(cf) {
  ensureQueue(cf);
  return cf.queue.slice(0, QUEUE_SIZE);
}

function consumeThrow(cf) {
  ensureQueue(cf);
  return cf.queue.shift();
}

/* ---- 2. Turn / round / wager helpers ---- */

function opponentId(room, playerId) {
  const opp = room.players.find((p) => p.id !== playerId);
  return opp ? opp.id : null;
}

function maxAllowedWager(room, actorId) {
  const cf = room.cf;
  const actorHearts = cf.hearts[actorId] || 0;
  const opp = room.players.find((p) => p.id !== actorId);
  const oppHearts = opp ? (cf.hearts[opp.id] || 0) : 0;
  return Math.max(0, Math.min(cf.roundWager, actorHearts, oppHearts));
}

/* ---- 3. Timers ---- */

function clearCfTimers(room) {
  if (!room) return;
  if (room.cfRevealTimer) {
    clearTimeout(room.cfRevealTimer);
    room.cfRevealTimer = null;
  }
  if (room.cfNextTimer) {
    clearTimeout(room.cfNextTimer);
    room.cfNextTimer = null;
  }
}

function stopRoom(room) {
  clearCfTimers(room);
}

/* ---- 4. State init / public views ---- */

function initRoomState(room) {
  clearCfTimers(room);
  const hearts = {};
  room.players.forEach((p) => {
    hearts[p.id] = STARTING_HEARTS;
  });
  // First player in lobby order starts (creator).
  const firstId = room.players[0].id;
  room.cf = {
    hearts,
    round: 1,
    roundWager: 1,
    turnsInRound: 0,
    currentTurnId: firstId,
    phase: "turn", // turn | resolving | between | over
    queue: generateThrowBatch(QUEUE_SIZE),
    resolved: [],
    lastResult: null,
    pending: null,
    history: [],
    over: false,
    winnerId: null,
    draw: false
  };
  room.cfRematch = {};
}

function publicPlayers(room) {
  const cf = room.cf;
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    hearts: cf.hearts[p.id],
    isTurn: !cf.over && cf.phase === "turn" && cf.currentTurnId === p.id
  }));
}

function buildStateFor(room, playerId, roomCode) {
  const cf = room.cf;
  const yourTurn = !!(
    cf &&
    !cf.over &&
    cf.phase === "turn" &&
    cf.currentTurnId === playerId
  );
  const maxWager = yourTurn ? maxAllowedWager(room, playerId) : 0;
  return {
    room: roomCode,
    game: "coin-flip",
    round: cf.round,
    roundWager: cf.roundWager,
    maxWager,
    minWager: maxWager > 0 ? 1 : 0,
    phase: cf.phase,
    over: !!cf.over,
    winnerId: cf.winnerId,
    draw: !!cf.draw,
    currentTurnId: cf.currentTurnId,
    yourId: playerId,
    yourTurn,
    canAct: yourTurn,
    upcoming: peekUpcoming(cf),
    resolvedRecent: (cf.resolved || []).slice(-5),
    lastResult: cf.lastResult,
    history: (cf.history || []).slice(-12),
    players: publicPlayers(room),
    startingHearts: STARTING_HEARTS,
    rules: {
      headsWinsForActive: true,
      queueSize: QUEUE_SIZE
    }
  };
}

function emitStates(room, io, roomCode) {
  room.players.forEach((p) => {
    io.to(p.id).emit("coinFlipState", buildStateFor(room, p.id, roomCode));
  });
}

/* ---- 5. Resolution / health / game-end ---- */

function applyDamage(cf, targetId, amount) {
  const dmg = Math.max(0, Math.min(amount, cf.hearts[targetId] || 0));
  cf.hearts[targetId] = Math.max(0, (cf.hearts[targetId] || 0) - dmg);
  return dmg;
}

function checkGameOver(room, io, roomCode) {
  const cf = room.cf;
  const dead = room.players.filter((p) => cf.hearts[p.id] <= 0);
  if (!dead.length) return false;

  clearCfTimers(room);
  cf.over = true;
  cf.phase = "over";

  if (dead.length >= 2) {
    cf.draw = true;
    cf.winnerId = null;
  } else {
    cf.draw = false;
    const deadId = dead[0].id;
    const winner = room.players.find((p) => p.id !== deadId);
    cf.winnerId = winner ? winner.id : null;
  }

  const winner = cf.winnerId
    ? room.players.find((p) => p.id === cf.winnerId)
    : null;
  let message;
  if (cf.draw) message = "Draw — both players fell!";
  else if (winner) message = winner.name + " wins!";
  else message = "Match over.";

  io.to(roomCode).emit("coinFlipOver", {
    room: roomCode,
    winnerId: cf.winnerId,
    winnerName: winner ? winner.name : null,
    draw: !!cf.draw,
    message,
    players: publicPlayers(room),
    history: cf.history.slice()
  });
  emitStates(room, io, roomCode);
  return true;
}

function advanceTurn(room, io, roomCode) {
  const cf = room.cf;
  if (!cf || cf.over) return;

  cf.turnsInRound += 1;
  if (cf.turnsInRound >= 2) {
    cf.turnsInRound = 0;
    cf.round += 1;
    cf.roundWager = cf.round;
  }

  const ids = room.players.map((p) => p.id);
  const idx = ids.indexOf(cf.currentTurnId);
  cf.currentTurnId = ids[(idx + 1) % ids.length];
  cf.phase = "turn";
  cf.pending = null;
  emitStates(room, io, roomCode);
}

function finishResolve(room, io, roomCode) {
  const cf = room.cf;
  if (!cf || !cf.pending || cf.over) return;

  const pending = cf.pending;
  const coin = pending.coin;
  const actorId = pending.actorId;
  const wager = pending.wager;
  const actorWins = coin === "heads"; // Heads → active wins; Tails → active loses

  let loserId;
  let winnerId;
  if (actorWins) {
    winnerId = actorId;
    loserId = opponentId(room, actorId);
  } else {
    winnerId = opponentId(room, actorId);
    loserId = actorId;
  }

  const dealt = applyDamage(cf, loserId, wager);

  const entry = {
    round: pending.round,
    actorId,
    actorName: pending.actorName,
    wager,
    coin,
    actorWins,
    winnerId,
    loserId,
    damage: dealt
  };
  cf.history.push(entry);
  cf.resolved.push(coin);
  if (cf.resolved.length > 20) cf.resolved = cf.resolved.slice(-20);
  cf.lastResult = entry;
  cf.pending = null;
  cf.phase = "between";

  io.to(roomCode).emit("coinFlipReveal", {
    room: roomCode,
    result: entry,
    upcoming: peekUpcoming(cf),
    players: publicPlayers(room)
  });
  emitStates(room, io, roomCode);

  if (checkGameOver(room, io, roomCode)) return;

  room.cfNextTimer = setTimeout(() => {
    room.cfNextTimer = null;
    if (!room.cf || room.cf.over) return;
    advanceTurn(room, io, roomCode);
  }, BETWEEN_TURN_MS);
}

function beginResolve(room, io, roomCode, actorId, wager) {
  const cf = room.cf;
  const me = room.players.find((p) => p.id === actorId);
  const coin = consumeThrow(cf);
  cf.phase = "resolving";
  cf.pending = {
    actorId,
    actorName: me ? me.name : "Player",
    wager,
    coin,
    round: cf.round
  };

  io.to(roomCode).emit("coinFlipSuspense", {
    room: roomCode,
    actorId,
    wager,
    durationMs: SUSPENSE_MS
  });
  emitStates(room, io, roomCode);

  clearCfTimers(room);
  room.cfRevealTimer = setTimeout(() => {
    room.cfRevealTimer = null;
    finishResolve(room, io, roomCode);
  }, SUSPENSE_MS);
}

/* ---- 6. Match lifecycle ---- */

function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  room.players.forEach((p) => {
    io.to(p.id).emit("coinFlipStarted", buildStateFor(room, p.id, roomCode));
  });
  emitStates(room, io, roomCode);
}

function registerSocket(socket, io, rooms) {
  /*
   * "coinFlipPlay" — active player locks a wager and flips the next throw.
   * Payload: { roomCode, wager }
   */
  socket.on("coinFlipPlay", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "coin-flip") {
      socket.emit("errorMessage", "You are not in a Coin Flip lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const cf = room.cf;
    if (!cf || cf.over || cf.phase !== "turn") {
      socket.emit("errorMessage", "You cannot flip right now.");
      return;
    }
    if (cf.currentTurnId !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const maxW = maxAllowedWager(room, socket.id);
    if (maxW < 1) {
      socket.emit("errorMessage", "No valid wager left.");
      return;
    }

    let wager = data && data.wager != null ? Number(data.wager) : maxW;
    if (!Number.isFinite(wager)) wager = maxW;
    wager = Math.floor(wager);
    if (wager < 1 || wager > maxW) {
      socket.emit("errorMessage", "Wager must be between 1 and " + maxW + ".");
      return;
    }

    beginResolve(room, io, roomCode, socket.id, wager);
  });

  /*
   * "coinFlipPlayAgain" — both players vote; then a fresh match starts.
   */
  socket.on("coinFlipPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "coin-flip" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.cf || !room.cf.over) {
      socket.emit("errorMessage", "The match is still going.");
      return;
    }
    if (!room.cfRematch) room.cfRematch = {};
    room.cfRematch[socket.id] = true;
    if (!room.players.every((p) => room.cfRematch[p.id])) {
      socket.emit("coinFlipPlayAgainWait");
      return;
    }
    room.cfRematch = {};
    onBothPlayersJoined(room, io, roomCode);
    io.to(roomCode).emit("coinFlipReset");
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  stopRoom,
  generateThrowBatch,
  STARTING_HEARTS,
  QUEUE_SIZE,
  SIDES
};
