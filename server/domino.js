/*
 * Dominoes — isolated multiplayer game mode (2–4 players).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, UNO, or Hidden Hunter handlers. Uses its own
 * Socket.IO events so it cannot collide with existing game traffic.
 *
 * Rules: standard international double-six. Server is authoritative for
 * the boneyard, hands, chain ends, turns, draws, passes, and scoring.
 *
 * Optional bots: seats flagged isBot are driven by server/bots/dominoBot,
 * acting through the SAME socket handlers (and validation) as humans.
 */

const dominoBot = require("./bots/dominoBot");
const dominoInspect = require("./bots/domino/inspect");

const MAX_PIP = 6;
const HAND_SIZE = 7;
const ALLOWED_MAX_PLAYERS = [2, 3, 4];

// Set by registerSocket so bot timers can verify a room still exists.
let roomsRef = null;

/** Bot "thinking" delay (ms). Fast-forwarded in automated tests.
 *  Speed only changes the pause. Move choice is unchanged.
 *  normal: existing 2.4–4.2s. slow: longer. fast: shorter, still readable. */
function botDelayMs(room) {
  if (process.env.BOT_TEST_FAST) return 5;
  const speed = room && room.dominoBotSpeed;
  if (speed === "slow") return 5200 + Math.floor(Math.random() * 1800);
  if (speed === "fast") return 900 + Math.floor(Math.random() * 500);
  return 2400 + Math.floor(Math.random() * 1800);
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

function shuffleDeal(playerIds) {
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
  return { hands, boneyard: deck };
}

function findTileHolder(playerIds, hands, tileId) {
  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i];
    const tile = (hands[id] || []).find((item) => item.id === tileId);
    if (tile) return { playerId: id, tile: tile };
  }
  return null;
}

/** Swap the required tile into a hand so the opening rule can still be played. */
function forceTileIntoHand(playerIds, dealt, tileId) {
  const existing = findTileHolder(playerIds, dealt.hands, tileId);
  if (existing) return existing;
  const yardIndex = dealt.boneyard.findIndex((tile) => tile.id === tileId);
  if (yardIndex < 0) return null;
  const tile = dealt.boneyard.splice(yardIndex, 1)[0];
  const target = playerIds[0];
  const displaced = dealt.hands[target].pop();
  dealt.hands[target].push(tile);
  if (displaced) dealt.boneyard.push(displaced);
  return { playerId: target, tile: tile };
}

/**
 * Deal HAND_SIZE tiles to each player; remainder is the boneyard.
 * When requireTileId is set (the first round's double-six), redeal until
 * someone holds it, then force it into a hand if the shuffles miss.
 */
function dealHands(playerIds, options) {
  const requireTileId = options && options.requireTileId;
  for (let attempt = 0; attempt < 40; attempt++) {
    const dealt = shuffleDeal(playerIds);
    if (!requireTileId) return dealt;
    const starter = findTileHolder(playerIds, dealt.hands, requireTileId);
    if (starter) {
      dealt.starterId = starter.playerId;
      dealt.mustPlayId = requireTileId;
      return dealt;
    }
  }
  const dealt = shuffleDeal(playerIds);
  if (!requireTileId) return dealt;
  const starter = forceTileIntoHand(playerIds, dealt, requireTileId);
  dealt.starterId = starter ? starter.playerId : playerIds[0];
  dealt.mustPlayId = requireTileId;
  return dealt;
}

/**
 * First round: the player holding 6-6 leads and must play it.
 * Later rounds: the previous round's winner leads with any tile they hold.
 * firstRound comes from match.roundsCompleted, never from the chain length.
 */
function planOpening(playerIds, hands, match) {
  const firstRound = !match || !match.roundsCompleted;
  if (firstRound) {
    const holder = findTileHolder(playerIds, hands, "6-6");
    return {
      firstRound: true,
      starterId: holder ? holder.playerId : null,
      mustPlayId: "6-6"
    };
  }
  const winner = match.lastWinnerId;
  const starterId = playerIds.indexOf(winner) >= 0 ? winner : playerIds[0];
  return {
    firstRound: false,
    starterId: starterId,
    mustPlayId: null
  };
}

function openingPlayAllowed(state, playerId, tileId) {
  if (!state || state.chain.length !== 0) {
    return { ok: false, error: "The round has already opened." };
  }
  if (state.currentTurn !== playerId) {
    return { ok: false, error: "It is not your turn." };
  }
  const hand = state.hands[playerId] || [];
  if (!hand.some((tile) => tile.id === tileId)) {
    return { ok: false, error: "That domino is not in your hand." };
  }
  if (state.firstRound && tileId !== "6-6") {
    return { ok: false, error: "The first round must open with the double-six." };
  }
  return { ok: true };
}

function roundSnapshot(state) {
  return {
    firstRound: !!state.firstRound,
    currentTurn: state.currentTurn,
    mustPlayId: state.mustPlayId || null,
    chain: (state.chain || []).map((tile) => ({ id: tile.id })),
    hands: state.hands
  };
}

function restoreRound(snapshot) {
  return {
    firstRound: !!snapshot.firstRound,
    currentTurn: snapshot.currentTurn,
    mustPlayId: snapshot.mustPlayId || null,
    chain: (snapshot.chain || []).map((tile) => ({ id: tile.id })),
    hands: snapshot.hands,
    leftEnd: null,
    rightEnd: null
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

/** Normalize a client team pick to "A" | "B" | null. */
function normalizeTeam(team) {
  if (team === "A" || team === "a") return "A";
  if (team === "B" || team === "b") return "B";
  return null;
}

function isTeamLobby(room) {
  return !!(room && room.gameMode === "dominoes" && (room.maxPlayers || 0) === 4);
}

function countTeam(room, team) {
  return (room.players || []).filter((p) => p.dominoTeam === team).length;
}

/**
 * Assign a player to Team A or B in a 4-player lobby (max 2 per team).
 * Returns { ok, team, error }.
 */
function assignPlayerTeam(room, player, preferredTeam) {
  if (!isTeamLobby(room) || !player) {
    if (player) player.dominoTeam = null;
    return { ok: true, team: null };
  }
  let team = normalizeTeam(preferredTeam);
  const countA = countTeam(room, "A") - (player.dominoTeam === "A" ? 1 : 0);
  const countB = countTeam(room, "B") - (player.dominoTeam === "B" ? 1 : 0);

  if (team === "A" && countA >= 2) team = countB < 2 ? "B" : null;
  else if (team === "B" && countB >= 2) team = countA < 2 ? "A" : null;

  if (!team) {
    // Prefer the side with fewer players; ties → A.
    if (countA < 2 && (countA <= countB || countB >= 2)) team = "A";
    else if (countB < 2) team = "B";
  }
  if (!team) {
    return { ok: false, team: null, error: "Both teams are full." };
  }
  player.dominoTeam = team;
  return { ok: true, team };
}

/**
 * Fill any missing team picks, then seat partners opposite:
 * seats 0+2 = Team A, seats 1+3 = Team B (turn order P1→P2→P3→P4).
 */
function arrangePlayersForTeams(room) {
  if (!isTeamLobby(room) || !room.players || room.players.length !== 4) return;

  room.players.forEach((p) => {
    if (p.dominoTeam !== "A" && p.dominoTeam !== "B") {
      assignPlayerTeam(room, p, null);
    }
  });

  // Cap overflow if somehow >2 claimed one side (bots / race).
  const a = [];
  const b = [];
  const rest = [];
  room.players.forEach((p) => {
    if (p.dominoTeam === "A" && a.length < 2) a.push(p);
    else if (p.dominoTeam === "B" && b.length < 2) b.push(p);
    else rest.push(p);
  });
  rest.forEach((p) => {
    if (a.length < 2) {
      p.dominoTeam = "A";
      a.push(p);
    } else {
      p.dominoTeam = "B";
      b.push(p);
    }
  });
  while (a.length < 2 && b.length > 2) {
    const moved = b.pop();
    moved.dominoTeam = "A";
    a.push(moved);
  }
  while (b.length < 2 && a.length > 2) {
    const moved = a.pop();
    moved.dominoTeam = "B";
    b.push(moved);
  }

  room.players = [a[0], b[0], a[1], b[1]].filter(Boolean);
}

/** Public lobby roster used while waiting for a 4-player Dominoes table. */
function publicLobbyPlayers(room) {
  return (room.players || []).map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    team: isTeamLobby(room) ? (p.dominoTeam || null) : null
  }));
}

function emitDominoLobbyUpdate(room, io, roomCode) {
  const max = room.maxPlayers || 2;
  io.to(roomCode).emit("dominoLobbyUpdate", {
    room: roomCode,
    maxPlayers: max,
    teamMode: isTeamLobby(room),
    players: publicLobbyPlayers(room)
  });
}

/**
 * 4-player team mode: seats 0+2 = Team A, seats 1+3 = Team B
 * (partners sit opposite; turn order stays P1→P2→P3→P4).
 * Call arrangePlayersForTeams() before this when players picked teams.
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

function rememberRoundWinner(room) {
  ensureMatch(room);
  const winnerId = room.domino && room.domino.winnerId;
  if (!winnerId) return;
  room.dominoMatch.lastWinnerId = winnerId;
  room.dominoMatch.roundsCompleted = (room.dominoMatch.roundsCompleted || 0) + 1;
}

function clearBotTimer(room) {
  if (!room) return;
  room.dominoBotEpoch = (room.dominoBotEpoch || 0) + 1;
  if (room.dominoBotTimer) {
    clearTimeout(room.dominoBotTimer);
    room.dominoBotTimer = null;
  }
}

function initRound(room) {
  // A fresh deal invalidates any scheduled bot action from the old round.
  clearBotTimer(room);
  const playerIds = room.players.map((p) => p.id);
  ensureMatch(room);
  const firstRound = !room.dominoMatch.roundsCompleted;
  if (room.dominoAiReview) {
    room.dominoAiReview.roundStartIndex = (room.dominoAiReview.decisions || []).length;
    room.dominoAiReview.roundActionStartIndex = (room.dominoAiReview.actionSnapshots || []).length;
  }
  const dealt = dealHands(playerIds, firstRound ? { requireTileId: "6-6" } : null);
  const plan = planOpening(playerIds, dealt.hands, room.dominoMatch);
  const starterId = plan.starterId || playerIds[0];
  const teams = buildTeams(room);
  room.domino = {
    hands: dealt.hands,
    boneyard: dealt.boneyard,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    currentTurn: starterId,
    mustPlayId: plan.mustPlayId,
    firstRound: plan.firstRound,
    consecutivePasses: 0,
    over: false,
    scores: null,
    teamScores: null,
    winnerId: null,
    winnerTeam: null,
    winReason: null,
    roundPoints: null,
    turnIndex: Math.max(0, playerIds.indexOf(starterId)),
    teamMode: teams.teamMode,
    teamA: teams.teamA,
    teamB: teams.teamB,
    publicLog: []
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

/**
 * Match totals persist across Play Again in the same lobby.
 * Team mode: winner of a round scores the opposing team's remaining pips.
 */
function ensureMatch(room) {
  if (!room.dominoMatch) {
    room.dominoMatch = {
      teams: {
        A: { roundsWon: 0, score: 0 },
        B: { roundsWon: 0, score: 0 }
      },
      players: {}
    };
  }
  room.players.forEach((p) => {
    if (!room.dominoMatch.players[p.id]) {
      room.dominoMatch.players[p.id] = { roundsWon: 0, score: 0, name: p.name };
    } else {
      room.dominoMatch.players[p.id].name = p.name;
    }
  });
}

function remainingPointsForTeam(scores, team) {
  return (scores || [])
    .filter((row) => row.team === team)
    .reduce((total, row) => total + row.points, 0);
}

function remainingPointsExcept(scores, winnerId) {
  return (scores || [])
    .filter((row) => row.id !== winnerId)
    .reduce((total, row) => total + row.points, 0);
}

/** Award round points to the winning team (opponent leftovers only). */
function awardTeamRound(room, winnerTeam, scores) {
  ensureMatch(room);
  const loserTeam = winnerTeam === "A" ? "B" : "A";
  const roundPoints = remainingPointsForTeam(scores, loserTeam);
  const slot = room.dominoMatch.teams[winnerTeam];
  slot.roundsWon += 1;
  slot.score += roundPoints;
  return { roundPoints: roundPoints, loserTeam: loserTeam };
}

/** Free-for-all: winner scores everyone else's remaining pips. */
function awardSoloRound(room, winnerId, scores) {
  ensureMatch(room);
  const roundPoints = remainingPointsExcept(scores, winnerId);
  const slot = room.dominoMatch.players[winnerId];
  if (slot) {
    slot.roundsWon += 1;
    slot.score += roundPoints;
  }
  return { roundPoints: roundPoints };
}

function publicMatchScoreboard(room) {
  ensureMatch(room);
  const d = room.domino;
  if (d && d.teamMode) {
    return [
      {
        team: "A",
        roundsWon: room.dominoMatch.teams.A.roundsWon,
        score: room.dominoMatch.teams.A.score
      },
      {
        team: "B",
        roundsWon: room.dominoMatch.teams.B.roundsWon,
        score: room.dominoMatch.teams.B.score
      }
    ];
  }
  return room.players.map((p) => {
    const slot = room.dominoMatch.players[p.id] || { roundsWon: 0, score: 0 };
    return {
      id: p.id,
      name: p.name,
      roundsWon: slot.roundsWon,
      score: slot.score
    };
  });
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
    firstRound: !!d.firstRound,
    over: d.over
  };
}

function notePublic(state, entry, room, roomCode) {
  if (!state) return;
  if (!state.publicLog) state.publicLog = [];
  state.publicLog.push(entry);
  // Full ground-truth action snapshots are stored only for the dedicated
  // inspector room, separately from publicLog so bot inference never sees them.
  const code = typeof roomCode === "string" ? roomCode.trim().toUpperCase() : "";
  if (code !== INSPECT_ROOM || !room) return;
  if (!room.dominoAiReview) {
    room.dominoAiReview = {
      startedAt: Date.now(), decisions: [], actionSnapshots: [],
      roundReviews: [], roundStartIndex: 0, roundActionStartIndex: 0
    };
  }
  if (!Array.isArray(room.dominoAiReview.actionSnapshots)) room.dominoAiReview.actionSnapshots = [];
  const actualHandsAtEvent = Object.keys(state.hands || {}).reduce((hands, playerId) => {
    hands[playerId] = (state.hands[playerId] || []).map((tile) => ({
      id: tile.id, a: tile.a, b: tile.b
    }));
    return hands;
  }, {});
  room.dominoAiReview.actionSnapshots.push({
    round: (room.dominoMatch && room.dominoMatch.roundsCompleted || 0) + 1,
    actionIndex: state.publicLog.length - 1,
    type: entry.type || null,
    playerId: entry.playerId || null,
    tile: entry.tile ? { id: entry.tile.id || null, a: entry.tile.a, b: entry.tile.b } : null,
    side: entry.side || null,
    leftEnd: state.leftEnd == null ? null : state.leftEnd,
    rightEnd: state.rightEnd == null ? null : state.rightEnd,
    actualHandsAtEvent: actualHandsAtEvent,
    handSnapshotTiming: entry.type === "draw"
      ? "after-draw"
      : entry.type === "play"
        ? "before-play-removal"
        : "at-action"
  });
}

/**
 * Facts the bot is allowed to use: its own hand plus public table history.
 * Other hands stay on the server and are not copied into this view.
 */
function decisionView(room, botId) {
  const d = room.domino;
  return {
    selfId: botId,
    gameId: room.id || room.roomId || room.code || room.roomCode || null,
    roundNumber: (room.dominoMatch && room.dominoMatch.roundsCompleted || 0) + 1,
    hand: (d.hands[botId] || []).map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    validMoves: validMovesFor(room, botId).map((move) => ({ tileId: move.tileId, side: move.side })),
    leftEnd: d.leftEnd,
    rightEnd: d.rightEnd,
    chain: (d.chain || []).map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    players: room.players.map((player) => ({
      id: player.id,
      handCount: d.hands[player.id] ? d.hands[player.id].length : 0,
      team: teamOfPlayer(d, player.id)
    })),
    teamMode: !!d.teamMode,
    teamA: d.teamA ? d.teamA.slice() : null,
    teamB: d.teamB ? d.teamB.slice() : null,
    log: (d.publicLog || []).map((entry) => {
      const copy = Object.assign({}, entry);
      if (entry.tile) copy.tile = { id: entry.tile.id, a: entry.tile.a, b: entry.tile.b };
      return copy;
    }),
    boneyardCount: d.boneyard ? d.boneyard.length : 0,
    mustPlayId: d.mustPlayId || null,
    firstRound: !!d.firstRound,
    match: publicMatchScoreboard(room)
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
  let inspectExtra = {};
  try {
    inspectExtra = inspectStateExtra(room, roomCode);
  } catch (err) {
    inspectExtra = {};
  }
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
      matchScoreboard: publicMatchScoreboard(room),
      roundPoints: d.roundPoints != null ? d.roundPoints : null,
      winnerId: d.winnerId,
      winnerTeam: d.winnerTeam,
      winReason: d.winReason,
      ...inspectExtra,
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
  const epoch = room.dominoBotEpoch || 0;
  room.dominoBotTimer = setTimeout(() => {
    if ((room.dominoBotEpoch || 0) !== epoch) return;
    if (roomsRef && roomsRef[roomCode] !== room) {
      console.warn("[bot] stale room ignored game=dominoes room=%s bot=%s action=turn", roomCode, botId);
      return;
    }
    room.dominoBotTimer = null;
    runBotTurn(room, io, roomCode, botId);
  }, botDelayMs(room));
}

function settleDominoBot(room, io, roomCode, botId) {
  if (roomsRef && roomsRef[roomCode] !== room) return;
  const d = room.domino;
  if (!d || d.over || d.currentTurn !== botId) return;
  if (room.dominoBotTimer) return;
  const attempt = (room.dominoBotRecoveries || 0) + 1;
  room.dominoBotRecoveries = attempt;
  const action = room.botSockets && room.botSockets[botId] && room.botSockets[botId].botAction;
  if (attempt > 1) {
    console.warn("[bot] stopped retry game=dominoes room=%s bot=%s action=%s", roomCode, botId, action || "unknown");
    return;
  }
  console.warn("[bot] retrying turn game=dominoes room=%s bot=%s action=%s", roomCode, botId, action || "unknown");
  scheduleBotTurn(room, io, roomCode);
}

const INSPECT_ROOM = "1111";

/**
 * The move runBotTurn will play. Room 1111 stores the explain snapshot
 * with that move so the inspector describes the decision that executes.
 * Other rooms keep the normal decision and store nothing.
 */
function rememberDominoReview(room, botId, view, stored) {
  if (!room || !stored || !stored.snapshot) return;
  // Inspector polling computes snapshots for every seated bot, including bots
  // that are not currently allowed to act. Those snapshots are useful for
  // inspection, but they are not decisions and must not enter training/review
  // history as plays or forced passes.
  if (!room.domino || room.domino.currentTurn !== botId || room.domino.over) return;
  if (!room.dominoAiReview) room.dominoAiReview = { startedAt: Date.now(), decisions: [] };
  const snapshot = stored.snapshot;
  const selected = snapshot.selected || snapshot.selectedMove || null;
  const evaluations = snapshot.candidateEvaluations || [];
  const best = evaluations.reduce((current, row) =>
    !current || (typeof row.score === "number" && row.score > current.score) ? row : current, null);
  const selectedScore = selected && typeof selected.score === "number" ? selected.score : null;
  const alternative = evaluations.find((row) => selectedScore == null || row.score !== selectedScore) || null;
  const candidateGap = selectedScore != null && best && typeof best.score === "number"
    ? Math.round((selectedScore - best.score) * 1000) / 1000 : null;
  // The broad move mode (for example DENY_OPPONENT) is not the same as the
  // persistent number-control plan. Preserve the actual plan separately so
  // match review can explain its target, owner, confidence, and evidence.
  const strategyPlan = snapshot.strategy && typeof snapshot.strategy === "object"
    ? snapshot.strategy
    : snapshot.plan && snapshot.plan.committed && typeof snapshot.plan.committed === "object"
      ? snapshot.plan.committed : null;
  const objective = strategyPlan ? {
    mode: strategyPlan.mode || null,
    target: strategyPlan.target == null ? null : strategyPlan.target,
    owner: strategyPlan.owner || null,
    ownerId: strategyPlan.ownerId || null,
    confidence: strategyPlan.confidence == null ? null : strategyPlan.confidence,
    evidence: strategyPlan.evidence || null,
    held: !!strategyPlan.held,
    switched: !!strategyPlan.switched,
    lines: Array.isArray(strategyPlan.lines) ? strategyPlan.lines.slice() : [],
    teammateTarget: strategyPlan.teammateTarget == null ? null : strategyPlan.teammateTarget,
    teammateConfidence: strategyPlan.teammateConfidence == null ? null : strategyPlan.teammateConfidence,
    teammateEvidence: strategyPlan.teammateEvidence || null
  } : null;
  room.dominoAiReview.decisions.push({
    at: Date.now(),
    botId: botId,
    turn: (view.log || []).filter((event) => event && event.playerId === botId &&
      (event.type === "play" || event.type === "pass")).length,
    action: snapshot.passAnalysis ? "pass" : selected ? "play" : "unknown",
    objective: objective,
    strategyPlan: objective,
    mode: snapshot.strategicMode && (snapshot.strategicMode.code || snapshot.strategicMode.label) || null,
    target: objective ? objective.target : null,
    chosenScore: selectedScore != null ? selectedScore : null,
    alternativeScore: alternative && typeof alternative.score === "number" ? alternative.score : null,
    bestCandidateScore: best && typeof best.score === "number" ? best.score : null,
    candidateGap: candidateGap,
    passReason: snapshot.passAnalysis && snapshot.passAnalysis.reason || null,
    ownHandAtDecision: (view.hand || []).map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    // Hindsight-only ground truth for training. This field is only emitted in
    // the dedicated inspector room's review/export, never in public game state.
    actualHandsAtDecision: Object.keys((room.domino && room.domino.hands) || {}).reduce((hands, playerId) => {
      hands[playerId] = ((room.domino.hands[playerId]) || []).map((tile) => ({
        id: tile.id, a: tile.a, b: tile.b
      }));
      return hands;
    }, {}),
    boardAtDecision: {
      leftEnd: view.leftEnd == null ? null : view.leftEnd,
      rightEnd: view.rightEnd == null ? null : view.rightEnd,
      chain: (view.chain || []).map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
      boneyardCount: view.boneyardCount == null ? null : view.boneyardCount
    },
    legalMovesAtDecision: (view.validMoves || []).map((move) => ({ tileId: move.tileId, side: move.side })),
    candidateScores: evaluations.slice(0, 20).map((row) => {
      const tileId = row.tileId || row.move && row.move.tileId || null;
      const ownTile = tileId == null ? null : (view.hand || []).find((tile) => tile.id === tileId) || null;
      return {
        tile: ownTile ? { id: ownTile.id, a: ownTile.a, b: ownTile.b } : null,
        tileId: tileId,
        side: row.side || row.move && row.move.side || null,
        score: typeof row.score === "number" ? row.score : null,
        parts: row.parts || null,
        wins: row.wins == null ? null : row.wins,
        samplesUsed: row.samplesUsed == null ? null : row.samplesUsed,
        prediction: row.prediction || null,
        reason: row.reason || row.explanation || null
      };
    }),
    publicLogLength: (view.log || []).length
  });
  // Keep the in-room history bounded. Full round logs are summarized at match end.
  if (room.dominoAiReview.decisions.length > 2000) {
    room.dominoAiReview.decisions.splice(0, room.dominoAiReview.decisions.length - 2000);
  }
}

function buildDominoMatchReview(room) {
  const review = room && room.dominoAiReview;
  const d = room && room.domino;
  if (!review || !d) return null;
  if (!Array.isArray(review.roundReviews)) review.roundReviews = [];
  if (!d.over) return review.roundReviews.length ? review.roundReviews[review.roundReviews.length - 1] : null;
  const roundNumber = room.dominoMatch && room.dominoMatch.roundsCompleted || 1;
  const existing = review.roundReviews.find((item) => item.round === roundNumber);
  if (existing) return existing;
  const startIndex = review.roundStartIndex || 0;
  const decisions = (review.decisions || []).slice(startIndex);
  const actionSnapshots = (review.actionSnapshots || []).slice(review.roundActionStartIndex || 0);
  const passes = decisions.filter((item) => item.action === "pass");
  const modes = {};
  decisions.forEach((item) => {
    const key = item.mode || "unlabelled";
    modes[key] = (modes[key] || 0) + 1;
  });
  const scored = decisions.filter((item) => typeof item.candidateGap === "number");
  const missedGaps = scored.filter((item) => item.candidateGap < 0);
  const result = {
    schemaVersion: 1,
    status: "round-complete",
    generatedAt: Date.now(),
    note: "Candidate gaps are heuristic score differences, not proof another move would have won. The trace is recorded only in inspector room 1111 and does not infer hidden hands.",
    round: roundNumber,
    winnerId: d.winnerId || null,
    winnerTeam: d.winnerTeam || null,
    winReason: d.winReason || null,
    scoreboard: publicMatchScoreboard(room),
    totals: {
      decisions: decisions.length,
      plays: decisions.filter((item) => item.action === "play").length,
      passes: passes.length,
      decisionsWithAlternatives: scored.length,
      selectedBelowTopCandidate: missedGaps.length
    },
    reviewFindings: {
      passPositionsWithOwnHand: passes.filter((item) => Array.isArray(item.ownHandAtDecision)).length,
      scoreGapInterpretation: "A negative gap means the selected move's score was below the best candidate score recorded by the heuristic. It is a review flag, not proof of a better game outcome.",
      passLearning: "Compare ownHandAtDecision and boardAtDecision to identify unavailable end numbers; after the pass, use only the public pass event to update opponents' void beliefs."
    },
    strategyCounts: modes,
    passEvents: passes.map((item) => ({
      botId: item.botId, turn: item.turn, objective: item.objective, reason: item.passReason,
      ownHandAtDecision: item.ownHandAtDecision || null,
      boardAtDecision: item.boardAtDecision || null
    })),
    decisionRecords: decisions.slice(),
    actionSnapshots: actionSnapshots.slice(),
    publicActions: (d.publicLog || []).map((event, index) => ({
      index: index,
      type: event.type || null,
      playerId: event.playerId || null,
      tile: event.tile ? { id: event.tile.id || null, a: event.tile.a, b: event.tile.b } : null,
      side: event.side || null,
      exposedEnd: event.exposedEnd == null ? null : event.exposedEnd,
      exposedValue: event.exposedValue == null ? null : event.exposedValue,
      legalAlternatives: event.legalAlternatives == null ? null : event.legalAlternatives,
      handSizeBefore: event.handSizeBefore == null ? null : event.handSizeBefore,
      handSizeAfter: event.handSizeAfter == null ? null : event.handSizeAfter,
      boardLeftBefore: event.boardLeftBefore == null ? null : event.boardLeftBefore,
      boardRightBefore: event.boardRightBefore == null ? null : event.boardRightBefore,
      boardLeftAfter: event.boardLeftAfter == null ? null : event.boardLeftAfter,
      boardRightAfter: event.boardRightAfter == null ? null : event.boardRightAfter,
      leftEnd: event.leftEnd == null ? null : event.leftEnd,
      rightEnd: event.rightEnd == null ? null : event.rightEnd
    }))
  };
  review.roundReviews.push(result);
  const matchStrategyCounts = {};
  let matchDecisions = 0, matchPasses = 0, belowTopCandidate = 0;
  review.roundReviews.forEach((round) => {
    const totals = round.totals || {};
    matchDecisions += totals.decisions || 0;
    matchPasses += totals.passes || 0;
    belowTopCandidate += totals.selectedBelowTopCandidate || 0;
    Object.keys(round.strategyCounts || {}).forEach((mode) => {
      matchStrategyCounts[mode] = (matchStrategyCounts[mode] || 0) + round.strategyCounts[mode];
    });
  });
  result.matchSummary = {
    roundsReviewed: review.roundReviews.length,
    decisions: matchDecisions,
    passes: matchPasses,
    selectedBelowTopCandidate: belowTopCandidate,
    strategyCounts: matchStrategyCounts,
    scoreboard: publicMatchScoreboard(room),
    note: "Aggregate covers completed rounds recorded in this inspector room. It is lost when the in-memory room/server is reset unless exported."
  };
  return result;
}

function buildDominoFullMatchReview(room) {
  if (!room || !room.domino) return null;
  const review = room.dominoAiReview;
  if (!review) return null;
  const latestRound = buildDominoMatchReview(room);
  const completedRounds = Array.isArray(review.roundReviews) ? review.roundReviews.slice() : [];
  const completedRoundCount = room.dominoMatch && room.dominoMatch.roundsCompleted || 0;
  const currentRoundNumber = room.domino.over
    ? Math.max(1, completedRoundCount)
    : completedRoundCount + 1;
  const startIndex = review.roundStartIndex || 0;
  const currentDecisions = room.domino.over ? [] : (review.decisions || []).slice(startIndex);
  const currentRound = room.domino.over ? null : {
    round: currentRoundNumber,
    status: "in-progress",
    winnerId: null,
    winnerTeam: null,
    winReason: null,
    scoreboard: publicMatchScoreboard(room),
    totals: {
      decisions: currentDecisions.length,
      plays: currentDecisions.filter((item) => item.action === "play").length,
      passes: currentDecisions.filter((item) => item.action === "pass").length
    },
    strategyCounts: currentDecisions.reduce((counts, item) => {
      const key = item.mode || "unlabelled";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    decisionRecords: currentDecisions.slice(),
    actionSnapshots: (review.actionSnapshots || []).slice(review.roundActionStartIndex || 0),
    publicActions: (room.domino.publicLog || []).map((event, index) => ({
      index: index,
      type: event.type || null,
      playerId: event.playerId || null,
      tile: event.tile ? { id: event.tile.id || null, a: event.tile.a, b: event.tile.b } : null,
      side: event.side || null,
      exposedEnd: event.exposedEnd == null ? null : event.exposedEnd,
      exposedValue: event.exposedValue == null ? null : event.exposedValue,
      legalAlternatives: event.legalAlternatives == null ? null : event.legalAlternatives,
      handSizeBefore: event.handSizeBefore == null ? null : event.handSizeBefore,
      handSizeAfter: event.handSizeAfter == null ? null : event.handSizeAfter,
      boardLeftBefore: event.boardLeftBefore == null ? null : event.boardLeftBefore,
      boardRightBefore: event.boardRightBefore == null ? null : event.boardRightBefore,
      boardLeftAfter: event.boardLeftAfter == null ? null : event.boardLeftAfter,
      boardRightAfter: event.boardRightAfter == null ? null : event.boardRightAfter,
      leftEnd: event.leftEnd == null ? null : event.leftEnd,
      rightEnd: event.rightEnd == null ? null : event.rightEnd
    }))
  };
  const rounds = currentRound ? completedRounds.concat([currentRound]) : completedRounds;
  const decisionRecords = rounds.flatMap((round) => (round.decisionRecords || []).map((item) =>
    Object.assign({ round: round.round }, item)
  ));
  const publicActions = rounds.flatMap((round) => (round.publicActions || []).map((item) =>
    Object.assign({ round: round.round }, item)
  ));
  const actionSnapshots = rounds.flatMap((round) => (round.actionSnapshots || []).map((item) =>
    Object.assign({ round: round.round }, item)
  ));
  const strategyCounts = {};
  rounds.forEach((round) => Object.keys(round.strategyCounts || {}).forEach((mode) => {
    strategyCounts[mode] = (strategyCounts[mode] || 0) + round.strategyCounts[mode];
  }));
  const totals = {
    rounds: rounds.length,
    completedRounds: completedRounds.length,
    decisions: decisionRecords.length,
    plays: decisionRecords.filter((item) => item.action === "play").length,
    passes: decisionRecords.filter((item) => item.action === "pass").length,
    publicActions: publicActions.length,
    selectedBelowTopCandidate: decisionRecords.filter((item) =>
      typeof item.candidateGap === "number" && item.candidateGap < 0
    ).length
  };
  return {
    schemaVersion: 2,
    status: room.domino.over ? "match-review" : "match-in-progress",
    generatedAt: Date.now(),
    roomCode: INSPECT_ROOM,
    scoreboard: publicMatchScoreboard(room),
    winnerId: room.domino.over ? room.domino.winnerId || null : null,
    winnerTeam: room.domino.over ? room.domino.winnerTeam || null : null,
    winReason: room.domino.over ? room.domino.winReason || null : null,
    totals: totals,
    strategyCounts: strategyCounts,
    rounds: rounds,
    decisionRecords: decisionRecords,
    publicActions: publicActions,
    actionSnapshots: actionSnapshots,
    latestRoundReview: latestRound,
    note: "One match-wide trace across all rounds recorded in inspector room 1111. Each decision includes the acting bot's own hand, persistent strategy plan (when available), and candidate evaluations. actualHandsAtDecision and actionSnapshots contain ground-truth hands for hindsight training, not information available to the bot at decision time; they are restricted to the dedicated inspector review. publicActions records the corresponding plays, passes, draws, board transitions, and legal-alternative counts."
  };
}

function decideBotMove(room, roomCode, botId) {
  const view = decisionView(room, botId);
  const code = typeof roomCode === "string" ? roomCode.trim().toUpperCase() : "";
  if (code !== INSPECT_ROOM) {
    return { move: dominoBot.getDominoMove(view), snapshot: null, restricted: true, key: null };
  }
  const key = dominoInspect.positionKey(view);
  if (!room.dominoDecisions) room.dominoDecisions = {};
  const cached = room.dominoDecisions[botId];
  if (cached && cached.key === key) return cached;
  let explained = null;
  try {
    explained = dominoBot.getDominoMove(view, { explain: true });
  } catch (err) {
    const snapshot = dominoInspect.clientSnapshot(
      dominoInspect.unavailableSnapshot(view, err && err.message ? err.message : "The decision failed.")
    );
    let move = null;
    try {
      move = dominoBot.getDominoMove(view);
    } catch (ignored) {
      move = null;
    }
    const stored = { key: key, move: move, snapshot: snapshot, restricted: false };
    room.dominoDecisions[botId] = stored;
    return stored;
  }
  const move = explained && !explained.pass && explained.tileId != null
    ? { tileId: explained.tileId, side: explained.side } : null;
  const snapshot = explained && explained.diagnostics
    ? dominoInspect.clientSnapshot(explained.diagnostics, { includeCandidateIdentities: true })
    : dominoInspect.clientSnapshot(dominoInspect.unavailableSnapshot(view, "No legal move is available."));
  const stored = { key: key, move: move, snapshot: snapshot, restricted: false };
  room.dominoDecisions[botId] = stored;
  rememberDominoReview(room, botId, view, stored);
  return stored;
}

function inspectStateExtra(room, roomCode) {
  const code = typeof roomCode === "string" ? roomCode.trim().toUpperCase() : "";
  if (code !== INSPECT_ROOM || !room || !room.domino) return {};
  const botDiagnostics = {};
  room.players.forEach((player) => {
    if (!player.isBot) return;
    try {
      const decided = decideBotMove(room, code, player.id);
      botDiagnostics[player.id] = decided && decided.snapshot
        ? decided.snapshot
        : dominoInspect.clientSnapshot(dominoInspect.unavailableSnapshot(
          decisionView(room, player.id),
          "No decision was recorded."
        ));
    } catch (err) {
      botDiagnostics[player.id] = dominoInspect.clientSnapshot(
        dominoInspect.unavailableSnapshot(null, err && err.message ? err.message : "The decision failed.")
      );
      botDiagnostics[player.id].playerId = player.id;
      botDiagnostics[player.id].botId = player.id;
    }
  });
  const matchReview = buildDominoMatchReview(room);
  const fullMatchReview = buildDominoFullMatchReview(room);
  Object.keys(botDiagnostics).forEach((id) => {
    botDiagnostics[id] = Object.assign({}, botDiagnostics[id], {
      matchReview: matchReview,
      fullMatchReview: fullMatchReview,
      matchHistory: room.dominoAiReview && room.dominoAiReview.roundReviews
        ? room.dominoAiReview.roundReviews.slice() : [],
      trainingData: {
        schemaVersion: 1,
        roomCode: INSPECT_ROOM,
        note: "Inspector-room decision trace with the bot's own hand and public history; no reconstructed hidden hands.",
        recordedPositions: room.dominoAiReview && room.dominoAiReview.decisions ? room.dominoAiReview.decisions.length : 0,
        decisions: room.dominoAiReview && room.dominoAiReview.decisions ? room.dominoAiReview.decisions.slice() : []
      }
    });
  });
  return { botDiagnostics: botDiagnostics, matchReview: matchReview, fullMatchReview: fullMatchReview };
}

function inspectPayload(stored, room, botId) {
  let snapshot = stored && stored.snapshot
    ? stored.snapshot
    : dominoInspect.unavailableSnapshot(decisionView(room, botId));
  const matchReview = buildDominoMatchReview(room);
  const fullMatchReview = buildDominoFullMatchReview(room);
  snapshot = Object.assign({}, snapshot, {
    matchReview: matchReview,
    fullMatchReview: fullMatchReview,
    matchHistory: room.dominoAiReview && room.dominoAiReview.roundReviews ? room.dominoAiReview.roundReviews.slice() : [],
    trainingData: {
      schemaVersion: 1,
      roomCode: INSPECT_ROOM,
      note: "Exported inspector-room data only. It contains the bot's own hand at decision time and public action history, not reconstructed hidden hands.",
      recordedPositions: room.dominoAiReview && room.dominoAiReview.decisions ? room.dominoAiReview.decisions.length : 0,
      decisions: room.dominoAiReview && room.dominoAiReview.decisions ? room.dominoAiReview.decisions.slice() : []
    }
  });
  if (snapshot && snapshot.selected && room.domino.currentTurn !== botId) {
    const note = "It is not this bot's turn, so this preference can change before the bot plays.";
    const selected = Object.assign({}, snapshot.selected, { conditional: true, assumption: note });
    snapshot = Object.assign({}, snapshot, {
      selected: selected,
      selectedMove: selected,
      plan: snapshot.plan ? Object.assign({}, snapshot.plan, { selected: selected }) : snapshot.plan
    });
  }
  return {
    ok: true,
    room: INSPECT_ROOM,
    botId: botId,
    currentTurnId: room.domino.currentTurn,
    leftEnd: room.domino.leftEnd,
    rightEnd: room.domino.rightEnd,
    snapshot: snapshot
  };
}

/** Execute one bot decision (play one tile, or draw one tile). */
function runBotTurn(room, io, roomCode, botId) {
  // Room may have been torn down (player left) while the bot "thought".
  if (roomsRef && roomsRef[roomCode] !== room) return;
  const d = room.domino;
  if (!d || d.over || d.currentTurn !== botId) {
    if (d && !d.over && d.currentTurn !== botId) {
      console.warn("[bot] stale turn ignored game=dominoes room=%s bot=%s action=turn", roomCode, botId);
    }
    return;
  }
  const botSocket = room.botSockets && room.botSockets[botId];
  if (!botSocket) return;

  const moves = validMovesFor(room, botId);
  // Explain a forced pass before resolving it so the inspector retains the
  // round objective and records why this position had no legal action.
  if (moves.length === 0 && roomCode.trim().toUpperCase() === INSPECT_ROOM) {
    try { decideBotMove(room, roomCode, botId); } catch (ignored) {}
  }
  if (moves.length > 0) {
    let choice = null;
    try {
      choice = decideBotMove(room, roomCode, botId).move;
    } catch (err) {
      console.warn("[bot] decision failed game=dominoes room=%s bot=%s", roomCode, botId);
      try {
        choice = dominoBot.getDominoMove(decisionView(room, botId));
      } catch (ignored) {
        choice = null;
      }
    }
    const move = choice && moves.some((m) => m.tileId === choice.tileId && m.side === choice.side)
      ? choice
      : moves[0];
    // Same handler + validation as a human "dominoPlayTile" event.
    botSocket.handlers["dominoPlayTile"]({ roomCode, tileId: move.tileId, side: move.side });
  } else if (d.boneyard.length > 0 && d.chain.length > 0) {
    // Same handler + validation as a human "dominoDraw" event. If the
    // drawn tile is still unplayable the handler keeps the bot's turn,
    // emits state, and this scheduler queues the next draw.
    botSocket.handlers["dominoDraw"]({ roomCode });
  } else if (!d.over && d.boneyard.length === 0) {
    // No legal tile and an empty boneyard. Pass with the same rules used
    // after a human draw, instead of leaving this callback as a no-op.
    resolveAutoPasses(room, io, roomCode);
    if (!d.over && (!roomsRef || roomsRef[roomCode] === room)) emitFullState(room, io, roomCode);
  }
  settleDominoBot(room, io, roomCode, botId);
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
    }, botDelayMs(room) + i * 200);
  });
}

function advanceTurn(room) {
  const ids = room.players.map((p) => p.id);
  room.domino.turnIndex = (room.domino.turnIndex + 1) % ids.length;
  room.domino.currentTurn = ids[room.domino.turnIndex];
  room.dominoBotRecoveries = 0;
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
    notePublic(d, {
      type: "pass",
      playerId: d.currentTurn,
      legalAlternatives: 0,
      handSizeBefore: hand.length,
      handSizeAfter: hand.length,
      boardLeftBefore: d.leftEnd,
      boardRightBefore: d.rightEnd,
      boardLeftAfter: d.leftEnd,
      boardRightAfter: d.rightEnd,
      leftEnd: d.leftEnd,
      rightEnd: d.rightEnd
    }, room, roomCode);
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
  ensureMatch(room);
  d.over = true;
  d.winnerId = winnerId;
  d.winReason = "emptied";
  d.scores = buildScoreRows(room);
  d.teamScores = buildTeamScores(room, d.scores);
  const winner = room.players.find((p) => p.id === winnerId);

  let winnerTeam = null;
  let winnerName = winner ? winner.name : "Player";
  let message = winnerName + " played their last domino!";
  let roundPoints = 0;

  // 4-player team mode: emptying a hand wins for the partnership.
  // Winner scores ONLY the opposing team's remaining pips.
  if (d.teamMode) {
    winnerTeam = teamOfPlayer(d, winnerId);
    d.winnerTeam = winnerTeam;
    const award = awardTeamRound(room, winnerTeam, d.scores);
    roundPoints = award.roundPoints;
    d.roundPoints = roundPoints;
    const mateIds = teamPlayerIds(d, winnerTeam);
    const names = mateIds.map((id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : "Player";
    }).join(" & ");
    winnerName = "Team " + winnerTeam + " (" + names + ")";
    message = winnerName + " wins the round! +" + roundPoints +
      " (Team " + award.loserTeam + "'s remaining points).";
  } else {
    d.winnerTeam = null;
    const award = awardSoloRound(room, winnerId, d.scores);
    roundPoints = award.roundPoints;
    d.roundPoints = roundPoints;
    message = winnerName + " wins the round! +" + roundPoints +
      " from opponents' remaining points.";
  }
  rememberRoundWinner(room);
  // Persist the AI review at the round-ending transition, not only when a
  // client happens to poll the inspector while d.over is true.
  buildDominoMatchReview(room);

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
    teamScores: d.teamScores,
    matchScoreboard: publicMatchScoreboard(room),
    roundPoints
  });
  emitFullState(room, io, roomCode);
  scheduleBotRematchVotes(room, io, roomCode);
}

function endBlocked(room, io, roomCode) {
  const d = room.domino;
  ensureMatch(room);
  d.over = true;
  d.winReason = "blocked";
  d.scores = buildScoreRows(room);
  d.teamScores = buildTeamScores(room, d.scores);

  let winnerTeam = null;
  let winnerName = "";
  let message = "";
  let roundPoints = 0;

  if (d.teamMode) {
    // Lowest combined team pip total wins the round.
    const scoreA = d.teamScores.find((t) => t.team === "A").points;
    const scoreB = d.teamScores.find((t) => t.team === "B").points;
    winnerTeam = scoreA <= scoreB ? "A" : "B";
    d.winnerTeam = winnerTeam;
    const mateIds = teamPlayerIds(d, winnerTeam);
    d.winnerId = mateIds[0];
    const award = awardTeamRound(room, winnerTeam, d.scores);
    roundPoints = award.roundPoints;
    d.roundPoints = roundPoints;
    const names = mateIds.map((id) => {
      const p = room.players.find((x) => x.id === id);
      return p ? p.name : "Player";
    }).join(" & ");
    winnerName = "Team " + winnerTeam + " (" + names + ")";
    message = "Game blocked! " + winnerName + " wins the round! +" +
      roundPoints + " (Team " + award.loserTeam + "'s remaining points).";
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
    const award = awardSoloRound(room, d.winnerId, d.scores);
    roundPoints = award.roundPoints;
    d.roundPoints = roundPoints;
    message = "Game blocked! " + winnerName + " wins the round! +" +
      roundPoints + " from opponents' remaining points.";
  }
  rememberRoundWinner(room);
  // Persist the AI review at the round-ending transition, not only when a
  // client happens to poll the inspector while d.over is true.
  buildDominoMatchReview(room);

  // "dominoOver" — Dominoes only. Table blocked; match scoreboard included.
  io.to(roomCode).emit("dominoOver", {
    winnerId: d.winnerId,
    winnerName,
    winnerTeam,
    teamMode: !!d.teamMode,
    teams: publicTeams(room),
    winReason: "blocked",
    message,
    scores: d.scores,
    teamScores: d.teamScores,
    matchScoreboard: publicMatchScoreboard(room),
    roundPoints
  });
  emitFullState(room, io, roomCode);
  scheduleBotRematchVotes(room, io, roomCode);
}

/* ============================================================
   LOBBY / SOCKET WIRING
   ============================================================ */

/**
 * Called when a Dominoes lobby reaches its chosen player count.
 * Never called for Hidden Hunt, UNO, or Hidden Hunter.
 */
function onLobbyFull(room, io, roomCode) {
  // Honor lobby team picks: partners sit opposite before dealing.
  arrangePlayersForTeams(room);
  ensureMatch(room);
  initRound(room);
  const teams = publicTeams(room);
  let openingInspect = {};
  try {
    openingInspect = inspectStateExtra(room, roomCode);
  } catch (err) {
    openingInspect = {};
  }
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
      maxPlayers: room.maxPlayers || room.players.length,
      matchScoreboard: publicMatchScoreboard(room),
      ...openingInspect
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
  /*
   * "dominoSetBotSpeed" — Dominoes only.
   * Local preference for how long bots wait before acting.
   * Does not change legality, turn order, or which tile a bot chooses.
   * Payload: { roomCode, speed: "slow"|"normal"|"fast" }
   */
  /*
   * "dominoInspect" — development inspector for room 1111 only.
   * The server checks the room registry. A client that only rewrites
   * its local room code is refused. The reply goes to the requesting
   * socket and is never broadcast. Anyone who can join room 1111 can
   * read that room's bot snapshots; there is no separate dev login.
   */
  socket.on("dominoInspect", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const requestId = data && data.requestId;
    if (roomCode !== INSPECT_ROOM) {
      socket.emit("dominoInspectResult", { ok: false, error: "unavailable", requestId: requestId });
      return;
    }
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes" || !room.domino) {
      socket.emit("dominoInspectResult", { ok: false, error: "unavailable", requestId: requestId });
      return;
    }
    if (!room.players.some((player) => player.id === socket.id)) {
      socket.emit("dominoInspectResult", { ok: false, error: "unavailable", requestId: requestId });
      return;
    }
    const botId = data && typeof data.botId === "string" ? data.botId : "";
    const bot = room.players.find((player) => player.id === botId && player.isBot);
    if (!bot) {
      socket.emit("dominoInspectResult", { ok: false, error: "unavailable", requestId: requestId });
      return;
    }
    let payload = null;
    try {
      payload = inspectPayload(decideBotMove(room, roomCode, botId), room, botId);
    } catch (err) {
      payload = {
        ok: true,
        room: INSPECT_ROOM,
        botId: botId,
        currentTurnId: room.domino.currentTurn,
        snapshot: dominoInspect.unavailableSnapshot(null, "The diagnostic snapshot could not be built.")
      };
    }
    payload.requestId = requestId;
    socket.emit("dominoInspectResult", payload);
  });

  socket.on("dominoSetBotSpeed", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes") return;
    if (!room.players.some((p) => p.id === socket.id)) return;
    const speed = data && data.speed;
    if (speed !== "slow" && speed !== "normal" && speed !== "fast") return;
    room.dominoBotSpeed = speed;
    if (room.dominoBotTimer) {
      clearBotTimer(room);
      scheduleBotTurn(room, io, roomCode);
    }
  });

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
      const gate = openingPlayAllowed(d, socket.id, tile.id);
      if (!gate.ok) {
        socket.emit("errorMessage", gate.error);
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

    const legalMovesBefore = validMovesFor(room, socket.id);
    const legalAlternatives = Math.max(0, legalMovesBefore.length - 1);
    const handSizeBefore = hand.length;
    const leftBefore = d.leftEnd;
    const rightBefore = d.rightEnd;
    const placed = placeTile(d, tile, side === "center" ? "center" : side);
    if (!placed) {
      socket.emit("errorMessage", "Illegal placement.");
      return;
    }
    notePublic(d, {
      type: "play",
      playerId: socket.id,
      tile: { id: tile.id, a: tile.a, b: tile.b },
      tileValues: [tile.a, tile.b],
      side: side === "center" ? "center" : side,
      matchedEnd: side === "left" || side === "right" ? side : null,
      matchedValue: side === "left" ? leftBefore : side === "right" ? rightBefore : null,
      exposedEnd: side === "left" || side === "right" ? side : null,
      exposedValue: side === "left" ? d.leftEnd : side === "right" ? d.rightEnd : null,
      legalAlternatives: legalAlternatives,
      handSizeBefore: handSizeBefore,
      handSizeAfter: handSizeBefore - 1,
      boardLeftBefore: leftBefore,
      boardRightBefore: rightBefore,
      boardLeftAfter: d.leftEnd,
      boardRightAfter: d.rightEnd,
      leftEndBefore: leftBefore,
      rightEndBefore: rightBefore,
      leftEnd: d.leftEnd,
      rightEnd: d.rightEnd
    }, room, roomCode);

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
      socket.emit("errorMessage", "Play the opening tile first.");
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
    notePublic(d, { type: "draw", playerId: socket.id }, room, roomCode);
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
      notePublic(d, {
        type: "pass",
        playerId: socket.id,
        legalAlternatives: 0,
        handSizeBefore: d.hands[socket.id].length,
        handSizeAfter: d.hands[socket.id].length,
        boardLeftBefore: d.leftEnd,
        boardRightBefore: d.rightEnd,
        boardLeftAfter: d.leftEnd,
        boardRightAfter: d.rightEnd,
        leftEnd: d.leftEnd,
        rightEnd: d.rightEnd
      }, room, roomCode);
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
   * "dominoPickTeam" — Dominoes only (4-player lobbies, before the deal).
   * Payload: { roomCode, team: "A"|"B" }
   */
  socket.on("dominoPickTeam", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dominoes") {
      socket.emit("errorMessage", "You are not in a Dominoes lobby.");
      return;
    }
    if (room.domino) {
      socket.emit("errorMessage", "Teams are locked once the game starts.");
      return;
    }
    if (!isTeamLobby(room)) {
      socket.emit("errorMessage", "Team picks are only for 4-player Dominoes.");
      return;
    }
    const me = room.players.find((p) => p.id === socket.id);
    if (!me) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const wanted = normalizeTeam(data && data.team);
    if (!wanted) {
      socket.emit("errorMessage", "Pick Team A or Team B.");
      return;
    }
    const othersOnTeam = room.players.filter(
      (p) => p.id !== socket.id && p.dominoTeam === wanted
    ).length;
    if (othersOnTeam >= 2) {
      socket.emit("errorMessage", "Team " + wanted + " is full.");
      return;
    }
    me.dominoTeam = wanted;
    emitDominoLobbyUpdate(room, io, roomCode);
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
  findTileHolder,
  planOpening,
  openingPlayAllowed,
  initRound,
  rememberRoundWinner,
  roundSnapshot,
  restoreRound,
  listValidMoves,
  placeTile,
  handScore,
  buildTeams,
  teamOfPlayer,
  normalizeMaxPlayers,
  normalizeTeam,
  isTeamLobby,
  assignPlayerTeam,
  arrangePlayersForTeams,
  publicLobbyPlayers,
  emitDominoLobbyUpdate,
  ALLOWED_MAX_PLAYERS,
  HAND_SIZE,
  MAX_PIP,
  botDelayMs,
  clearBotTimer,
  decisionView,
  decideBotMove,
  inspectStateExtra,
  INSPECT_ROOM
};
