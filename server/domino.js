/*
 * Dominoes — isolated multiplayer game mode (2–4 players).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Word Chain, or Code Breaker handlers. Uses its own
 * Socket.IO events so it cannot collide with existing game traffic.
 *
 * Rules: standard international double-six. Server is authoritative for
 * the boneyard, hands, chain ends, turns, draws, passes, and scoring.
 *
 * Optional bots: seats flagged isBot are driven by server/bots/dominoBot,
 * acting through the SAME socket handlers (and validation) as humans.
 */

const dominoBot = require("./bots/dominoBot");

const MAX_PIP = 6;
const HAND_SIZE = 7;
const ALLOWED_MAX_PLAYERS = [2, 3, 4];

// Set by registerSocket so bot timers can verify a room still exists.
let roomsRef = null;

/** Bot "thinking" delay (ms). Fast-forwarded in automated tests. */
function botDelayMs() {
  if (process.env.BOT_TEST_FAST) return 5;
  return 800 + Math.floor(Math.random() * 700);
}

/* ============================================================
   TILE / SET HELPERS
   ============================================================ */

/** Build the 28-tile double-six set programmatically. */
function buildDoubleSixSet() {
  const tiles = [];
  for (let a = 0; a <= MAX_PIP; a++) {
    for (let b = a; b <= MAX_PIP; b++) {
      tiles.push({ id: a + "-" + b, a, b });
    }
  }
  return tiles;
}

/** Fisher–Yates shuffle (copy). */
function shuffle(tiles) {
  const arr = tiles.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tilePoints(tile) {
  return tile.a + tile.b;
}

function isDouble(tile) {
  return tile.a === tile.b;
}

function normalizeMaxPlayers(value) {
  const n = Number(value);
  return ALLOWED_MAX_PLAYERS.includes(n) ? n : 2;
}

/* ============================================================
   DEAL / STARTING PLAYER
   ============================================================ */

/**
 * Deal HAND_SIZE tiles to each player; remainder is the boneyard.
 * Redeals if nobody was dealt a double (first move requires one).
 */
function dealHands(playerIds) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const deck = shuffle(buildDoubleSixSet());
    const hands = {};
    playerIds.forEach((id) => {
      hands[id] = [];
    });
    for (let i = 0; i < HAND_SIZE; i++) {
      playerIds.forEach((id) => {
        hands[id].push(deck.pop());
      });
    }
    const boneyard = deck;
    const starter = findHighestDoubleHolder(playerIds, hands);
    if (starter) {
      return { hands, boneyard, starterId: starter.playerId, mustPlayId: starter.tile.id };
    }
  }
  // Extremely unlikely fallback: force a deal even without doubles.
  const deck = shuffle(buildDoubleSixSet());
  const hands = {};
  playerIds.forEach((id) => {
    hands[id] = [];
  });
  for (let i = 0; i < HAND_SIZE; i++) {
    playerIds.forEach((id) => {
      hands[id].push(deck.pop());
    });
  }
  return {
    hands,
    boneyard: deck,
    starterId: playerIds[0],
    mustPlayId: null
  };
}

/** Highest double in any hand wins the right to start (6|6 > 5|5 > …). */
function findHighestDoubleHolder(playerIds, hands) {
  let best = null;
  playerIds.forEach((id) => {
    (hands[id] || []).forEach((tile) => {
      if (!isDouble(tile)) return;
      if (!best || tile.a > best.tile.a) {
        best = { playerId: id, tile };
      }
    });
  });
  return best;
}

/* ============================================================
   MOVE VALIDATION / CHAIN
   ============================================================ */

/**
 * List every legal placement for a hand given open ends.
 * Returns [{ tileId, side: "left"|"right", connectPip }].
 * On an empty board, only mustPlayId (if set) or any tile is legal as "center".
 */
function listValidMoves(hand, leftEnd, rightEnd, chainLength, mustPlayId) {
  const moves = [];
  if (chainLength === 0) {
    hand.forEach((tile) => {
      if (mustPlayId && tile.id !== mustPlayId) return;
      moves.push({ tileId: tile.id, side: "center", connectPip: null });
    });
    return moves;
  }

  hand.forEach((tile) => {
    const fitsLeft = tile.a === leftEnd || tile.b === leftEnd;
    const fitsRight = tile.a === rightEnd || tile.b === rightEnd;
    if (fitsLeft) moves.push({ tileId: tile.id, side: "left", connectPip: leftEnd });
    if (fitsRight) moves.push({ tileId: tile.id, side: "right", connectPip: rightEnd });
  });
  return moves;
}

function playerHasAnyMove(hand, state) {
  return listValidMoves(
    hand,
    state.leftEnd,
    state.rightEnd,
    state.chain.length,
    state.mustPlayId
  ).length > 0;
}

/**
 * Place a tile on the chain. Returns the placed chain entry or null if illegal.
 * Chain entries store leftPip/rightPip along the table axis for rendering.
 */
function placeTile(state, tile, side) {
  if (state.chain.length === 0) {
    if (state.mustPlayId && tile.id !== state.mustPlayId) return null;
    const leftPip = tile.a;
    const rightPip = tile.b;
    const entry = {
      id: tile.id,
      a: tile.a,
      b: tile.b,
      leftPip,
      rightPip,
      isDouble: isDouble(tile)
    };
    state.chain.push(entry);
    state.leftEnd = leftPip;
    state.rightEnd = rightPip;
    state.mustPlayId = null;
    return entry;
  }

  if (side === "left") {
    const end = state.leftEnd;
    if (tile.a !== end && tile.b !== end) return null;
    // Connecting face sits against the old left end (to the right of the new tile).
    let leftPip;
    let rightPip;
    if (tile.a === end && tile.b === end) {
      leftPip = end;
      rightPip = end;
    } else if (tile.a === end) {
      rightPip = tile.a;
      leftPip = tile.b;
    } else {
      rightPip = tile.b;
      leftPip = tile.a;
    }
    const entry = {
      id: tile.id,
      a: tile.a,
      b: tile.b,
      leftPip,
      rightPip,
      isDouble: isDouble(tile)
    };
    state.chain.unshift(entry);
    state.leftEnd = leftPip;
    return entry;
  }

  if (side === "right") {
    const end = state.rightEnd;
    if (tile.a !== end && tile.b !== end) return null;
    let leftPip;
    let rightPip;
    if (tile.a === end && tile.b === end) {
      leftPip = end;
      rightPip = end;
    } else if (tile.a === end) {
      leftPip = tile.a;
      rightPip = tile.b;
    } else {
      leftPip = tile.b;
      rightPip = tile.a;
    }
    const entry = {
      id: tile.id,
      a: tile.a,
      b: tile.b,
      leftPip,
      rightPip,
      isDouble: isDouble(tile)
    };
    state.chain.push(entry);
    state.rightEnd = rightPip;
    return entry;
  }

  return null;
}

function handScore(hand) {
  return hand.reduce((sum, t) => sum + tilePoints(t), 0);
}

/* ============================================================
   ROOM STATE / PUBLIC SNAPSHOTS
   ============================================================ */

/**
 * 4-player team mode: seats 0+2 = Team A, seats 1+3 = Team B
 * (partners sit opposite; turn order stays P1→P2→P3→P4).
 */
function buildTeams(room) {
  if (!room.players || room.players.length !== 4) {
    return { teamMode: false, teamA: null, teamB: null };
  }
  return {
    teamMode: true,
    teamA: [room.players[0].id, room.players[2].id],
    teamB: [room.players[1].id, room.players[3].id]
  };
}

function teamOfPlayer(state, playerId) {
  if (!state || !state.teamMode) return null;
  if (state.teamA && state.teamA.includes(playerId)) return "A";
  if (state.teamB && state.teamB.includes(playerId)) return "B";
  return null;
}

function teamPlayerIds(state, team) {
  if (team === "A") return state.teamA || [];
  if (team === "B") return state.teamB || [];
  return [];
}

function initRound(room) {
  // A fresh deal invalidates any scheduled bot action from the old round.
  if (room.dominoBotTimer) {
    clearTimeout(room.dominoBotTimer);
    room.dominoBotTimer = null;
  }
  const playerIds = room.players.map((p) => p.id);
  const dealt = dealHands(playerIds);
  const teams = buildTeams(room);
  room.domino = {
    hands: dealt.hands,
    boneyard: dealt.boneyard,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    currentTurn: dealt.starterId,
    mustPlayId: dealt.mustPlayId,
    consecutivePasses: 0,
    over: false,
    scores: null,
    teamScores: null,
    winnerId: null,
    winnerTeam: null,
    winReason: null,
    turnIndex: playerIds.indexOf(dealt.starterId),
    teamMode: teams.teamMode,
    teamA: teams.teamA,
    teamB: teams.teamB
  };
  room.dominoRematch = {};
}

function publicPlayerView(room) {
  const d = room.domino;
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    handCount: d && d.hands[p.id] ? d.hands[p.id].length : 0,
    team: d ? teamOfPlayer(d, p.id) : null
  }));
}

/** Public team snapshot for 4-player matches (null otherwise). */
function publicTeams(room) {
  const d = room.domino;
  if (!d || !d.teamMode) return null;
  const pack = (ids, label) => ({
    id: label,
    players: ids.map((id) => {
      const p = room.players.find((x) => x.id === id);
      return {
        id,
        name: p ? p.name : "Player",
        isBot: !!(p && p.isBot),
        handCount: d.hands[id] ? d.hands[id].length : 0
      };
    })
  });
  return {
    teamA: pack(d.teamA, "A"),
    teamB: pack(d.teamB, "B")
  };
}

function buildScoreRows(room) {
  const d = room.domino;
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    points: handScore(d.hands[p.id] || []),
    team: teamOfPlayer(d, p.id),
    hand: (d.hands[p.id] || []).map((t) => ({ id: t.id, a: t.a, b: t.b }))
  }));
}

function buildTeamScores(room, scores) {
  const d = room.domino;
  if (!d.teamMode) return null;
  const sum = (team) => scores
    .filter((row) => row.team === team)
    .reduce((total, row) => total + row.points, 0);
  return [
    { team: "A", points: sum("A") },
    { team: "B", points: sum("B") }
  ];
}

function publicBoard(room) {
  const d = room.domino;
  return {
    chain: d.chain.map((t) => ({
      id: t.id,
      a: t.a,
      b: t.b,
      leftPip: t.leftPip,
      rightPip: t.rightPip,
      isDouble: t.isDouble
    })),
    leftEnd: d.leftEnd,
    rightEnd: d.rightEnd,
    boneyardCount: d.boneyard.length,
    mustPlayId: d.mustPlayId,
    over: d.over
  };
}

function validMovesFor(room, playerId) {
  const d = room.domino;
  return listValidMoves(
    d.hands[playerId] || [],
    d.leftEnd,
    d.rightEnd,
    d.chain.length,
    d.mustPlayId
  );
}

/** Emit private hand + public table state to every seated player. */
function emitFullState(room, io, roomCode, extra) {
  const d = room.domino;
  const teams = publicTeams(room);
  room.players.forEach((player) => {
    const moves = d.over ? [] : (player.id === d.currentTurn ? validMovesFor(room, player.id) : []);
    const myTeam = teamOfPlayer(d, player.id);
    const mateId = myTeam
      ? teamPlayerIds(d, myTeam).find((id) => id !== player.id)
      : null;
    const mate = mateId ? room.players.find((p) => p.id === mateId) : null;
    // "dominoState" — Dominoes only. Public table + private hand for this client.
    io.to(player.id).emit("dominoState", {
      room: roomCode,
      game: "dominoes",
      yourTurn: !d.over && player.id === d.currentTurn,
      currentTurnId: d.currentTurn,
      players: publicPlayerView(room),
      teamMode: !!d.teamMode,
      teams,
      myTeam,
      teammate: mate ? { id: mate.id, name: mate.name } : null,
      board: publicBoard(room),
      hand: (d.hands[player.id] || []).map((t) => ({ id: t.id, a: t.a, b: t.b })),
      validMoves: moves,
      canDraw: !d.over &&
        player.id === d.currentTurn &&
        d.boneyard.length > 0 &&
        moves.length === 0 &&
        d.chain.length > 0,
      over: d.over,
      scores: d.scores,
      teamScores: d.teamScores,
      winnerId: d.winnerId,
      winnerTeam: d.winnerTeam,
      winReason: d.winReason,
      ...(extra || {})
    });
  });
  // If the (new) active player is a bot, queue its move after a short
  // human-like delay. No-op in bot-free lobbies.
  scheduleBotTurn(room, io, roomCode);
}

/* ============================================================
   BOT DRIVER (Dominoes only — see server/bots/dominoBot.js)
   ============================================================
   Bots act through room.botSockets[botId].handlers — the exact same
   functions registered for human sockets — so every bot action passes
   the same validation. Bot hands are never emitted to real sockets
   (io.to(botId) targets an empty Socket.IO room).
*/

/** Queue the current bot player's action with a human-like delay. */
function scheduleBotTurn(room, io, roomCode) {
  const d = room.domino;
  if (!d || d.over) return;
  const current = room.players.find((p) => p.id === d.currentTurn);
  if (!current || !current.isBot) return;
  if (room.dominoBotTimer) return; // one pending bot action at a time

  const botId = current.id;
  room.dominoBotTimer = setTimeout(() => {
    room.dominoBotTimer = null;
    runBotTurn(room, io, roomCode, botId);
  }, botDelayMs());
}

/** Execute one bot decision (play one tile, or draw one tile). */
function runBotTurn(room, io, roomCode, botId) {
  // Room may have been torn down (player left) while the bot "thought".
  if (roomsRef && roomsRef[roomCode] !== room) return;
  const d = room.domino;
  if (!d || d.over || d.currentTurn !== botId) return;
  const botSocket = room.botSockets && room.botSockets[botId];
  if (!botSocket) return;

  const moves = validMovesFor(room, botId);
  if (moves.length > 0) {
    const choice = dominoBot.getDominoMove({
      hand: d.hands[botId] || [],
      validMoves: moves,
      leftEnd: d.leftEnd,
      rightEnd: d.rightEnd,
      chainLength: d.chain.length,
      teamMode: !!d.teamMode
    });
    const move = choice && moves.some((m) => m.tileId === choice.tileId && m.side === choice.side)
      ? choice
      : moves[0];
    // Same handler + validation as a human "dominoPlayTile" event.
    botSocket.handlers["dominoPlayTile"]({ roomCode, tileId: move.tileId, side: move.side });
    return;
  }

  if (d.boneyard.length > 0 && d.chain.length > 0) {
    // Same handler + validation as a human "dominoDraw" event. If the
    // drawn tile is still unplayable the handler keeps the bot's turn,
    // emits state, and this scheduler queues the next draw.
    botSocket.handlers["dominoDraw"]({ roomCode });
  }
  // No moves + empty boneyard: resolveAutoPasses already advanced the turn.
}

/** After a round ends, bots vote Play Again so humans can rematch. */
function scheduleBotRematchVotes(room, io, roomCode) {
  room.players.filter((p) => p.isBot).forEach((bot, i) => {
    setTimeout(() => {
      if (roomsRef && roomsRef[roomCode] !== room) return;
      if (!room.domino || !room.domino.over) return;
      const botSocket = room.botSockets && room.botSockets[bot.id];
      if (!botSocket || !botSocket.handlers["dominoPlayAgain"]) return;
      botSocket.handlers["dominoPlayAgain"]({ roomCode });
    }, botDelayMs() + i * 200);
  });
}

function advanceTurn(room) {
  const ids = room.players.map((p) => p.id);
  room.domino.turnIndex = (room.domino.turnIndex + 1) % ids.length;
  room.domino.currentTurn = ids[room.domino.turnIndex];
}

/**
 * If the active player cannot move and the boneyard is empty, auto-pass.
 * Repeats until someone can act or the table is blocked.
 */
function resolveAutoPasses(room, io, roomCode) {
  const d = room.domino;
  if (!d || d.over) return;

  let guard = 0;
  while (guard++ < room.players.length + 1) {
    if (d.over) return;
    const hand = d.hands[d.currentTurn] || [];
    const canPlay = playerHasAnyMove(hand, d);
    if (canPlay) return;
    if (d.boneyard.length > 0) return; // they must draw

    // Auto-pass — no ask.
    d.consecutivePasses += 1;
    const passer = room.players.find((p) => p.id === d.currentTurn);
    // "dominoPassed" — Dominoes only. Announces an automatic pass.
    io.to(roomCode).emit("dominoPassed", {
      by: d.currentTurn,
      name: passer ? passer.name : "Player",
      consecutivePasses: d.consecutivePasses
    });

    if (d.consecutivePasses >= room.players.length) {
      endBlocked(room, io, roomCode);
      return;
    }
    advanceTurn(room);
  }
}

function endEmptyHand(room, io, roomCode, winnerId) {
  const d = room.domino;
  d.over = true;
  d.winnerId = winnerId;
  d.winReason = "emptied";
  d.scores = buildScoreRows(room);
  d.teamScores = buildTeamScores(room, d.scores);
  const winner = room.players.find((p) => p.id === winnerId);

  let winnerTeam = null;
  let winnerName = winner ? winner.name : "Player";
  let message = winnerName + " played their last domino!";

  // 4-player team mode: emptying a hand wins for the whole partnership.
  if (d.teamMode) {
    winnerTeam = teamOfPlayer(d, winnerId);
    d.winnerTeam = winnerTeam;
    const mateIds = teamPlayerIds(d, winnerTeam);
    const names = mateIds.map((id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : "Player";
    }).join(" & ");
    winnerName = "Team " + winnerTeam + " (" + names + ")";
    message = winnerName + " wins! " +
      (winner ? winner.name : "A player") + " played their last domino.";
  } else {
    d.winnerTeam = null;
  }

  // "dominoOver" — Dominoes only. Hand emptied; scoreboard included.
  io.to(roomCode).emit("dominoOver", {
    winnerId,
    winnerName,
    winnerTeam,
    teamMode: !!d.teamMode,
    teams: publicTeams(room),
    winReason: "emptied",
    message,
    scores: d.scores,
    teamScores: d.teamScores
  });
  emitFullState(room, io, roomCode);
  scheduleBotRematchVotes(room, io, roomCode);
}

function endBlocked(room, io, roomCode) {
  const d = room.domino;
  d.over = true;
  d.winReason = "blocked";
  d.scores = buildScoreRows(room);
  d.teamScores = buildTeamScores(room, d.scores);

  let winnerTeam = null;
  let winnerName = "";
  let message = "";

  if (d.teamMode) {
    // Lowest combined team pip total wins.
    const scoreA = d.teamScores.find((t) => t.team === "A").points;
    const scoreB = d.teamScores.find((t) => t.team === "B").points;
    winnerTeam = scoreA <= scoreB ? "A" : "B";
    d.winnerTeam = winnerTeam;
    const mateIds = teamPlayerIds(d, winnerTeam);
    d.winnerId = mateIds[0];
    const names = mateIds.map((id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : "Player";
    }).join(" & ");
    winnerName = "Team " + winnerTeam + " (" + names + ")";
    message = "Game blocked! " + winnerName + " wins with the lowest combined score " +
      "(" + (winnerTeam === "A" ? scoreA : scoreB) + " vs " +
      (winnerTeam === "A" ? scoreB : scoreA) + ").";
  } else {
    d.winnerTeam = null;
    let best = null;
    d.scores.forEach((row) => {
      if (!best || row.points < best.points) best = row;
    });
    // Ties: first lowest in seat order wins (deterministic).
    const tied = d.scores.filter((row) => row.points === best.points);
    d.winnerId = tied[0].id;
    winnerName = tied[0].name;
    message = "Game blocked! Lowest remaining points wins.";
  }

  // "dominoOver" — Dominoes only. Table blocked; lowest pips / team total wins.
  io.to(roomCode).emit("dominoOver", {
    winnerId: d.winnerId,
    winnerName,
    winnerTeam,
    teamMode: !!d.teamMode,
    teams: publicTeams(room),
    winReason: "blocked",
    message,
    scores: d.scores,
    teamScores: d.teamScores
  });
  emitFullState(room, io, roomCode);
  scheduleBotRematchVotes(room, io, roomCode);
}

/* ============================================================
   LOBBY / SOCKET WIRING
   ============================================================ */

/**
 * Called when a Dominoes lobby reaches its chosen player count.
 * Never called for Hidden Hunt / Word Chain / Code Breaker.
 */
function onLobbyFull(room, io, roomCode) {
  initRound(room);
  const teams = publicTeams(room);
  room.players.forEach((player) => {
    const d = room.domino;
    const moves = player.id === d.currentTurn ? validMovesFor(room, player.id) : [];
    const myTeam = teamOfPlayer(d, player.id);
    const mateId = myTeam
      ? teamPlayerIds(d, myTeam).find((id) => id !== player.id)
      : null;
    const mate = mateId ? room.players.find((p) => p.id === mateId) : null;
    // "dominoStarted" — Dominoes only. Launches the Dominoes UI with private hands.
    io.to(player.id).emit("dominoStarted", {
      room: roomCode,
      game: "dominoes",
      yourTurn: player.id === d.currentTurn,
      currentTurnId: d.currentTurn,
      players: publicPlayerView(room),
      teamMode: !!d.teamMode,
      teams,
      myTeam,
      teammate: mate ? { id: mate.id, name: mate.name } : null,
      board: publicBoard(room),
      hand: (d.hands[player.id] || []).map((t) => ({ id: t.id, a: t.a, b: t.b })),
      validMoves: moves,
      canDraw: false,
      maxPlayers: room.maxPlayers || room.players.length
    });
  });
  // Opening turn may need auto-pass only if somehow no moves and empty yard (shouldn't).
  resolveAutoPasses(room, io, roomCode);
  if (!room.domino.over) emitFullState(room, io, roomCode);
}

function registerSocket(socket, io, rooms) {
  // Remember the live room registry so bot timers can detect torn-down rooms.
  roomsRef = rooms;

  /*
   * "dominoPlayTile" — Dominoes only.
   * Payload: { roomCode, tileId, side: "left"|"right"|"center" }
   */
  socket.on("dominoPlayTile", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes") {
      socket.emit("errorMessage", "You are not in a Dominoes lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const d = room.domino;
    if (!d || d.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (d.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const tileId = data && typeof data.tileId === "string" ? data.tileId : "";
    let side = data && typeof data.side === "string" ? data.side : "";
    const hand = d.hands[socket.id] || [];
    const idx = hand.findIndex((t) => t.id === tileId);
    if (idx < 0) {
      socket.emit("errorMessage", "That domino is not in your hand.");
      return;
    }
    const tile = hand[idx];

    if (d.chain.length === 0) {
      side = "center";
      if (d.mustPlayId && tile.id !== d.mustPlayId) {
        socket.emit("errorMessage", "You must play the highest double to open.");
        return;
      }
    } else if (side !== "left" && side !== "right") {
      socket.emit("errorMessage", "Choose which end to play on.");
      return;
    }

    const legal = validMovesFor(room, socket.id).some(
      (m) => m.tileId === tileId && (d.chain.length === 0 ? m.side === "center" : m.side === side)
    );
    if (!legal) {
      socket.emit("errorMessage", "That move is not legal.");
      return;
    }

    const placed = placeTile(d, tile, side === "center" ? "center" : side);
    if (!placed) {
      socket.emit("errorMessage", "Illegal placement.");
      return;
    }

    hand.splice(idx, 1);
    d.consecutivePasses = 0;

    const me = room.players.find((p) => p.id === socket.id);
    // "dominoPlayed" — Dominoes only. Public placement for animations.
    io.to(roomCode).emit("dominoPlayed", {
      by: socket.id,
      name: me ? me.name : "Player",
      tile: placed,
      side: side === "center" ? "center" : side,
      board: publicBoard(room)
    });

    if (hand.length === 0) {
      endEmptyHand(room, io, roomCode, socket.id);
      return;
    }

    advanceTurn(room);
    resolveAutoPasses(room, io, roomCode);
    if (!d.over) emitFullState(room, io, roomCode);
  });

  /*
   * "dominoDraw" — Dominoes only.
   * Draws one tile from the boneyard when the active player has no move.
   */
  socket.on("dominoDraw", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes") {
      socket.emit("errorMessage", "You are not in a Dominoes lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const d = room.domino;
    if (!d || d.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (d.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    if (d.chain.length === 0) {
      socket.emit("errorMessage", "Play the opening double first.");
      return;
    }
    if (playerHasAnyMove(d.hands[socket.id], d)) {
      socket.emit("errorMessage", "You already have a legal play.");
      return;
    }
    if (d.boneyard.length === 0) {
      // Should have been auto-passed; resolve now.
      resolveAutoPasses(room, io, roomCode);
      if (!d.over) emitFullState(room, io, roomCode);
      return;
    }

    const drawn = d.boneyard.pop();
    d.hands[socket.id].push(drawn);
    const me = room.players.find((p) => p.id === socket.id);

    // "dominoDrawn" — Dominoes only. Public draw notice (tile hidden).
    io.to(roomCode).emit("dominoDrawn", {
      by: socket.id,
      name: me ? me.name : "Player",
      boneyardCount: d.boneyard.length,
      handCount: d.hands[socket.id].length
    });

    // After drawing: if still no move and yard empty → auto-pass; else stay on turn.
    if (!playerHasAnyMove(d.hands[socket.id], d) && d.boneyard.length === 0) {
      d.consecutivePasses += 1;
      io.to(roomCode).emit("dominoPassed", {
        by: socket.id,
        name: me ? me.name : "Player",
        consecutivePasses: d.consecutivePasses
      });
      if (d.consecutivePasses >= room.players.length) {
        endBlocked(room, io, roomCode);
        return;
      }
      advanceTurn(room);
      resolveAutoPasses(room, io, roomCode);
    }

    if (!d.over) emitFullState(room, io, roomCode);
  });

  /*
   * "dominoPlayAgain" — Dominoes only.
   * All seated players must vote; then a fresh shuffle/deal begins.
   */
  socket.on("dominoPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.domino || !room.domino.over) {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }

    if (!room.dominoRematch) room.dominoRematch = {};
    room.dominoRematch[socket.id] = true;

    if (!room.players.every((p) => room.dominoRematch[p.id])) {
      // "dominoPlayAgainWait" — Dominoes only.
      socket.emit("dominoPlayAgainWait");
      return;
    }

    room.dominoRematch = {};
    onLobbyFull(room, io, roomCode);
    // "dominoReset" — Dominoes only. Fresh deal in the same lobby.
    io.to(roomCode).emit("dominoReset");
  });
}

module.exports = {
  onLobbyFull,
  registerSocket,
  buildDoubleSixSet,
  shuffle,
  dealHands,
  findHighestDoubleHolder,
  listValidMoves,
  placeTile,
  handScore,
  buildTeams,
  teamOfPlayer,
  normalizeMaxPlayers,
  ALLOWED_MAX_PLAYERS,
  HAND_SIZE,
  MAX_PIP
};
