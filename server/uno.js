/*
 * UNO — isolated multiplayer game mode (2–5 players).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Word Chain, Code Breaker, or Dominoes handlers.
 * Uses its own Socket.IO events exclusively.
 *
 * Rules highlight: stacking (+2 on +2, +4 on +4, +4 on +2; never +2 on +4),
 * UNO call / challenge, wild color choice, discard reshuffle.
 *
 * Optional bots: seats flagged isBot are driven by server/bots/unoBot,
 * acting through the SAME socket handlers (and validation) as humans.
 */

const unoBot = require("./bots/unoBot");

const COLORS = ["red", "blue", "green", "yellow"];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const HAND_SIZE = 7;
const ALLOWED_MAX_PLAYERS = [2, 3, 4, 5];
/** Grace window after reaching 1 card before others can challenge a missed UNO call. */
const UNO_CALL_GRACE_MS = process.env.BOT_TEST_FAST === "1" ? 5 : 2000;

let cardSeq = 0;

// Set by registerSocket so bot timers can verify a room still exists.
let roomsRef = null;

/** Bot "thinking" delay (ms). Fast-forwarded in automated tests. */
function botDelayMs() {
  if (process.env.BOT_TEST_FAST) return 5;
  // Deliberate pause so bots feel like they are thinking (~2.4–4.2s).
  return 2400 + Math.floor(Math.random() * 1800);
}

function normalizeMaxPlayers(value) {
  const n = Number(value);
  return ALLOWED_MAX_PLAYERS.includes(n) ? n : 2;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build a standard 108-card UNO deck. */
function buildDeck() {
  const deck = [];
  cardSeq = 0;
  const push = (card) => {
    deck.push(Object.assign({ id: "c" + (++cardSeq) }, card));
  };

  COLORS.forEach((color) => {
    push({ color, kind: "number", value: 0 });
    for (let n = 1; n <= 9; n++) {
      push({ color, kind: "number", value: n });
      push({ color, kind: "number", value: n });
    }
    for (let i = 0; i < 2; i++) {
      push({ color, kind: "skip", value: "skip" });
      push({ color, kind: "reverse", value: "reverse" });
      push({ color, kind: "draw2", value: "draw2" });
    }
  });
  for (let i = 0; i < 4; i++) {
    push({ color: null, kind: "wild", value: "wild" });
    push({ color: null, kind: "wild4", value: "wild4" });
  }
  return deck;
}

function isWild(card) {
  return card && (card.kind === "wild" || card.kind === "wild4");
}

function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    color: card.color,
    kind: card.kind,
    value: card.value,
    chosenColor: card.chosenColor || null
  };
}

function topDiscard(state) {
  return state.discard[state.discard.length - 1] || null;
}

function currentColor(state) {
  const top = topDiscard(state);
  if (!top) return null;
  if (top.chosenColor) return top.chosenColor;
  return top.color;
}

function ensureDrawPile(state) {
  if (state.draw.length > 0) return;
  if (state.discard.length <= 1) return;
  const top = state.discard.pop();
  const rest = state.discard.map((c) => {
    const copy = Object.assign({}, c);
    delete copy.chosenColor;
    if (isWild(copy)) copy.color = null;
    return copy;
  });
  state.draw = shuffle(rest);
  state.discard = [top];
}

function drawFromPile(state, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    ensureDrawPile(state);
    if (state.draw.length === 0) break;
    drawn.push(state.draw.pop());
  }
  return drawn;
}

/**
 * Can `card` be played on the current top discard / color,
 * considering an active penalty stack if present.
 */
function canPlayCard(state, card) {
  if (!card) return false;
  const top = topDiscard(state);
  if (!top) return true;

  // Active penalty stack: only compatible stack cards are legal.
  if (state.pendingPenalty > 0) {
    if (card.kind === "draw2") {
      return state.pendingKind === "draw2";
    }
    if (card.kind === "wild4") {
      return state.pendingKind === "draw2" || state.pendingKind === "wild4";
    }
    return false;
  }

  if (isWild(card)) return true;
  const color = currentColor(state);
  if (card.color && card.color === color) return true;
  if (card.kind === "number" && top.kind === "number" && card.value === top.value) return true;
  if (card.kind !== "number" && card.kind === top.kind) return true;
  return false;
}

function listPlayable(state, hand) {
  return (hand || []).filter((c) => canPlayCard(state, c)).map((c) => c.id);
}

function playerIndex(room, playerId) {
  return room.players.findIndex((p) => p.id === playerId);
}

function advanceIndex(room, fromIndex, steps) {
  const n = room.players.length;
  const dir = room.uno.direction;
  let idx = fromIndex;
  for (let i = 0; i < steps; i++) {
    idx = (idx + dir + n * 10) % n;
  }
  return idx;
}

function setTurnByIndex(room, idx) {
  room.uno.turnIndex = idx;
  room.uno.currentTurn = room.players[idx].id;
}

function advanceTurn(room, steps) {
  setTurnByIndex(room, advanceIndex(room, room.uno.turnIndex, steps || 1));
}

/** After a play that went to 1 card, mark UNO liability until called.
 * Challenge is only allowed after UNO_CALL_GRACE_MS so the player can yell UNO.
 */
function markUnoLiability(state, playerId, handSize) {
  if (handSize === 1) {
    if (!state.unoCalled[playerId]) {
      if (!state.unoLiable[playerId]) {
        state.unoLiable[playerId] = true;
        if (!state.unoLiableAt) state.unoLiableAt = {};
        state.unoLiableAt[playerId] = Date.now();
      }
    }
  } else {
    state.unoLiable[playerId] = false;
    state.unoCalled[playerId] = false;
    if (state.unoLiableAt) state.unoLiableAt[playerId] = null;
  }
}

function challengeReadyAt(state, playerId) {
  if (!state.unoLiable[playerId] || state.unoCalled[playerId]) return null;
  if ((state.hands[playerId] || []).length !== 1) return null;
  const at = state.unoLiableAt && state.unoLiableAt[playerId];
  if (!at) return Date.now(); // legacy / missing timestamp → allow
  return at + UNO_CALL_GRACE_MS;
}

function canChallengeUno(state, targetId) {
  const readyAt = challengeReadyAt(state, targetId);
  return readyAt != null && Date.now() >= readyAt;
}

function publicPlayers(room) {
  const u = room.uno;
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    handCount: (u.hands[p.id] || []).length,
    unoCalled: !!u.unoCalled[p.id],
    unoLiable: !!u.unoLiable[p.id],
    // When challenge becomes legal (null = not challengeable yet / N/A).
    unoChallengeAt: challengeReadyAt(u, p.id)
  }));
}

function rankings(room) {
  return room.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      cardsLeft: (room.uno.hands[p.id] || []).length
    }))
    .sort((a, b) => a.cardsLeft - b.cardsLeft);
}

function emitFullState(room, io, roomCode, extra) {
  const u = room.uno;
  room.players.forEach((player) => {
    const hand = u.hands[player.id] || [];
    let playable = u.over ? [] : (player.id === u.currentTurn ? listPlayable(u, hand) : []);
    // After drawing, only the drawn card may be played (or pass).
    if (u.awaitingDrawnPlay && player.id === u.currentTurn) {
      playable = playable.filter((id) => id === u.awaitingDrawnPlay.cardId);
    }
    const mustPickColor = u.pendingColorChooser === player.id;
    // "unoState" — UNO only. Private hand + public table for this client.
    io.to(player.id).emit("unoState", Object.assign({
      room: roomCode,
      game: "uno",
      yourTurn: !u.over && player.id === u.currentTurn,
      currentTurnId: u.currentTurn,
      direction: u.direction,
      players: publicPlayers(room),
      topCard: publicCard(topDiscard(u)),
      currentColor: currentColor(u),
      drawCount: u.draw.length,
      discardCount: u.discard.length,
      pendingPenalty: u.pendingPenalty,
      pendingKind: u.pendingKind,
      hand: hand.map(publicCard),
      playableIds: playable,
      canDraw: !u.over &&
        player.id === u.currentTurn &&
        u.pendingPenalty === 0 &&
        !mustPickColor &&
        !u.awaitingDrawnPlay,
      canTakePenalty: !u.over &&
        player.id === u.currentTurn &&
        u.pendingPenalty > 0 &&
        playable.length === 0,
      mustPickColor,
      drawnPlayableId: u.awaitingDrawnPlay && player.id === u.currentTurn
        ? u.awaitingDrawnPlay.cardId
        : null,
      over: u.over,
      winnerId: u.winnerId,
      turnsPlayed: u.turnsPlayed,
      cardsPlayed: u.cardsPlayed,
      rankings: u.over ? rankings(room) : null
    }, extra || {}));
  });
  // Bots never forget: auto-call UNO the moment they reach one card.
  scheduleBotUnoCalls(room, io, roomCode);
  // If the (new) active player is a bot, queue its move.
  scheduleBotTurn(room, io, roomCode);
}

/* ============================================================
   BOT DRIVER (UNO only — see server/bots/unoBot.js)
   ============================================================
   Bots act through room.botSockets[botId].handlers — the exact same
   functions registered for human sockets — so every bot action passes
   the same validation. Bot hands are never emitted to real sockets
   (io.to(botId) targets an empty Socket.IO room).
*/

/** Queue the current bot player's action with a human-like delay. */
function scheduleBotTurn(room, io, roomCode) {
  const u = room.uno;
  if (!u || u.over) return;
  const current = room.players.find((p) => p.id === u.currentTurn);
  if (!current || !current.isBot) return;
  if (room.unoBotTimer) return; // one pending bot action at a time

  const botId = current.id;
  room.unoBotTimer = setTimeout(() => {
    room.unoBotTimer = null;
    runBotTurn(room, io, roomCode, botId);
  }, botDelayMs());
}

/** Execute one bot decision (play a card, or draw / take the penalty). */
function runBotTurn(room, io, roomCode, botId) {
  // Room may have been torn down (player left) while the bot "thought".
  if (roomsRef && roomsRef[roomCode] !== room) return;
  const u = room.uno;
  if (!u || u.over || u.currentTurn !== botId) return;
  const botSocket = room.botSockets && room.botSockets[botId];
  if (!botSocket) return;

  // Defensive: complete a staged wild (bots normally send color up front).
  if (u.pendingColorChooser === botId) {
    botSocket.handlers["unoChooseColor"]({
      roomCode,
      color: unoBot.pickColor(u.hands[botId] || [])
    });
    return;
  }

  const hand = u.hands[botId] || [];
  let playable = listPlayable(u, hand);
  // After drawing, only the drawn card may be played (mirror of emitFullState).
  if (u.awaitingDrawnPlay) {
    playable = playable.filter((id) => id === u.awaitingDrawnPlay.cardId);
  }

  if (playable.length > 0) {
    const nextSeat = room.players[advanceIndex(room, u.turnIndex, 1)];
    const move = unoBot.getUnoMove({
      hand,
      playableIds: playable,
      pendingPenalty: u.pendingPenalty,
      pendingKind: u.pendingKind,
      nextPlayerHandCount: nextSeat ? (u.hands[nextSeat.id] || []).length : 7
    });
    const cardId = move && playable.includes(move.cardId) ? move.cardId : playable[0];
    const card = hand.find((c) => c.id === cardId);
    const payload = { roomCode, cardId };
    if (card && isWild(card)) {
      payload.color = (move && move.color) ||
        unoBot.pickColor(hand.filter((c) => c.id !== cardId));
    }
    // Same handler + validation as a human "unoPlayCard" event.
    botSocket.handlers["unoPlayCard"](payload);
    return;
  }

  // No playable card: "unoDraw" draws one card, accepts a pending
  // penalty stack, or passes after an unplayable drawn card — the same
  // paths a human takes through the same handler.
  botSocket.handlers["unoDraw"]({ roomCode });
}

/** Bots automatically call UNO when they reach exactly one card. */
function scheduleBotUnoCalls(room, io, roomCode) {
  const u = room.uno;
  if (!u || u.over) return;
  room.players.forEach((p) => {
    if (!p.isBot) return;
    if ((u.hands[p.id] || []).length !== 1) return;
    if (!u.unoLiable[p.id] || u.unoCalled[p.id]) return;
    const botSocket = room.botSockets && room.botSockets[p.id];
    if (!botSocket || !botSocket.handlers["unoCall"]) return;
    setTimeout(() => {
      if (roomsRef && roomsRef[roomCode] !== room) return;
      if (!room.uno || room.uno.over) return;
      if ((room.uno.hands[p.id] || []).length !== 1) return;
      if (room.uno.unoCalled[p.id]) return;
      botSocket.handlers["unoCall"]({ roomCode });
    }, Math.min(botDelayMs(), 600));
  });
}

/** After a game ends, bots vote Play Again so humans can rematch. */
function scheduleBotRematchVotes(room, io, roomCode) {
  room.players.filter((p) => p.isBot).forEach((bot, i) => {
    setTimeout(() => {
      if (roomsRef && roomsRef[roomCode] !== room) return;
      if (!room.uno || !room.uno.over) return;
      const botSocket = room.botSockets && room.botSockets[bot.id];
      if (!botSocket || !botSocket.handlers["unoPlayAgain"]) return;
      botSocket.handlers["unoPlayAgain"]({ roomCode });
    }, botDelayMs() + i * 200);
  });
}

/**
 * If the active player faces a penalty and cannot stack, auto-draw it.
 */
function resolveForcedPenalty(room, io, roomCode) {
  const u = room.uno;
  if (!u || u.over || u.pendingPenalty <= 0) return false;
  const hand = u.hands[u.currentTurn] || [];
  if (listPlayable(u, hand).length > 0) return false;

  const amount = u.pendingPenalty;
  const drawn = drawFromPile(u, amount);
  u.hands[u.currentTurn].push(...drawn);
  u.pendingPenalty = 0;
  u.pendingKind = null;
  const me = room.players.find((p) => p.id === u.currentTurn);
  // "unoPenaltyDrawn" — UNO only. Public notice of stack resolution.
  io.to(roomCode).emit("unoPenaltyDrawn", {
    by: u.currentTurn,
    name: me ? me.name : "Player",
    amount,
    handCount: u.hands[u.currentTurn].length
  });
  markUnoLiability(u, u.currentTurn, u.hands[u.currentTurn].length);
  advanceTurn(room, 1);
  return true;
}

function endGame(room, io, roomCode, winnerId) {
  const u = room.uno;
  u.over = true;
  u.winnerId = winnerId;
  u.pendingPenalty = 0;
  u.pendingKind = null;
  u.awaitingDrawnPlay = null;
  u.pendingColorChooser = null;
  const winner = room.players.find((p) => p.id === winnerId);
  // "unoOver" — UNO only.
  io.to(roomCode).emit("unoOver", {
    winnerId,
    winnerName: winner ? winner.name : "Player",
    message: (winner ? winner.name : "Player") + " wins!",
    turnsPlayed: u.turnsPlayed,
    cardsPlayed: u.cardsPlayed,
    rankings: rankings(room)
  });
  emitFullState(room, io, roomCode);
  scheduleBotRematchVotes(room, io, roomCode);
}

/**
 * Apply a successfully played card's effects and advance the turn.
 * Wild color must already be set on the card when kind is wild/wild4.
 */
function afterPlayEffects(room, io, roomCode, card, playerId) {
  const u = room.uno;
  const n = room.players.length;
  let skipSteps = 1;

  if (card.kind === "draw2") {
    u.pendingPenalty += 2;
    u.pendingKind = "draw2";
  } else if (card.kind === "wild4") {
    u.pendingPenalty += 4;
    u.pendingKind = "wild4";
  } else if (card.kind === "skip") {
    skipSteps = 2;
  } else if (card.kind === "reverse") {
    if (n === 2) {
      skipSteps = 2; // reverse acts as skip in heads-up
    } else {
      u.direction *= -1;
      // "unoReversed" — UNO only.
      io.to(roomCode).emit("unoReversed", { direction: u.direction });
    }
  }

  const handSize = (u.hands[playerId] || []).length;
  if (handSize === 0) {
    endGame(room, io, roomCode, playerId);
    return;
  }
  markUnoLiability(u, playerId, handSize);

  // Move to next player (possibly skipped), then resolve forced penalties.
  advanceTurn(room, skipSteps);
  // Keep resolving if several players in a row cannot stack (unlikely but safe).
  let guard = 0;
  while (guard++ < n + 1 && resolveForcedPenalty(room, io, roomCode)) {
    /* continue */
  }
}

function initRound(room) {
  // A fresh deal invalidates any scheduled bot action from the old round.
  if (room.unoBotTimer) {
    clearTimeout(room.unoBotTimer);
    room.unoBotTimer = null;
  }
  const playerIds = room.players.map((p) => p.id);
  let draw = shuffle(buildDeck());
  const hands = {};
  playerIds.forEach((id) => {
    hands[id] = [];
  });
  for (let i = 0; i < HAND_SIZE; i++) {
    playerIds.forEach((id) => {
      hands[id].push(draw.pop());
    });
  }

  // Flip starter discard; wilds go back into the deck.
  let starter = null;
  const wildPark = [];
  while (draw.length) {
    const card = draw.pop();
    if (isWild(card)) {
      wildPark.push(card);
      continue;
    }
    starter = card;
    break;
  }
  draw = shuffle(draw.concat(wildPark));
  if (!starter) {
    // Degenerate fallback — should never happen with a real deck.
    starter = { id: "c0", color: "red", kind: "number", value: 0 };
  }

  const startIdx = Math.floor(Math.random() * playerIds.length);
  room.uno = {
    draw,
    discard: [starter],
    hands,
    currentTurn: playerIds[startIdx],
    turnIndex: startIdx,
    direction: 1,
    pendingPenalty: 0,
    pendingKind: null,
    pendingColorChooser: null,
    awaitingDrawnPlay: null,
    unoCalled: {},
    unoLiable: {},
    unoLiableAt: {},
    over: false,
    winnerId: null,
    turnsPlayed: 0,
    cardsPlayed: 0
  };
  room.unoRematch = {};

  // Opening action-card rules target the randomly chosen first player.
  const top = starter;
  if (top.kind === "skip") {
    advanceTurn(room, 1);
  } else if (top.kind === "reverse") {
    if (playerIds.length === 2) {
      advanceTurn(room, 1);
    } else {
      room.uno.direction = -1;
    }
  } else if (top.kind === "draw2") {
    const victim = room.uno.currentTurn;
    const drawn = drawFromPile(room.uno, 2);
    room.uno.hands[victim].push(...drawn);
    advanceTurn(room, 1);
  }
}

function onLobbyFull(room, io, roomCode) {
  initRound(room);
  room.players.forEach((player) => {
    const u = room.uno;
    const hand = u.hands[player.id] || [];
    // "unoStarted" — UNO only. Launches the UNO UI with private hands.
    io.to(player.id).emit("unoStarted", {
      room: roomCode,
      game: "uno",
      yourTurn: player.id === u.currentTurn,
      currentTurnId: u.currentTurn,
      direction: u.direction,
      players: publicPlayers(room),
      topCard: publicCard(topDiscard(u)),
      currentColor: currentColor(u),
      drawCount: u.draw.length,
      discardCount: u.discard.length,
      pendingPenalty: 0,
      pendingKind: null,
      hand: hand.map(publicCard),
      playableIds: player.id === u.currentTurn ? listPlayable(u, hand) : [],
      canDraw: player.id === u.currentTurn,
      canTakePenalty: false,
      mustPickColor: false,
      drawnPlayableId: null,
      maxPlayers: room.maxPlayers || room.players.length,
      over: false
    });
  });
  // Opening +2 may leave the new current player facing nothing special; sync.
  let guard = 0;
  while (guard++ < room.players.length + 1 && resolveForcedPenalty(room, io, roomCode)) {
    /* continue */
  }
  emitFullState(room, io, roomCode);
}

function registerSocket(socket, io, rooms) {
  // Remember the live room registry so bot timers can detect torn-down rooms.
  roomsRef = rooms;

  /*
   * "unoPlayCard" — UNO only.
   * Payload: { roomCode, cardId, color? } — color required for wilds.
   */
  socket.on("unoPlayCard", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno") {
      socket.emit("errorMessage", "You are not in a UNO lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const u = room.uno;
    if (!u || u.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (u.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    if (u.pendingColorChooser) {
      socket.emit("errorMessage", "Choose a color for your wild card.");
      return;
    }

    const cardId = data && typeof data.cardId === "string" ? data.cardId : "";
    const hand = u.hands[socket.id] || [];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) {
      socket.emit("errorMessage", "That card is not in your hand.");
      return;
    }
    const card = hand[idx];

    // If we just drew, only that drawn card may be played (or pass already handled).
    if (u.awaitingDrawnPlay) {
      if (u.awaitingDrawnPlay.cardId !== cardId) {
        socket.emit("errorMessage", "You may only play the card you just drew.");
        return;
      }
    }

    if (!canPlayCard(u, card)) {
      if (card.kind === "draw2" && u.pendingKind === "wild4") {
        socket.emit("errorMessage", "A +2 cannot be played on a +4.");
      } else {
        socket.emit("errorMessage", "That card cannot be played now.");
      }
      return;
    }

    let chosenColor = null;
    if (isWild(card)) {
      chosenColor = data && typeof data.color === "string" ? data.color.toLowerCase() : "";
      if (!COLORS.includes(chosenColor)) {
        // Ask client to pick — keep card, set chooser flag.
        u.pendingColorChooser = socket.id;
        u.pendingWildCardId = card.id;
        emitFullState(room, io, roomCode);
        return;
      }
    }

    // Commit the play.
    hand.splice(idx, 1);
    const played = Object.assign({}, card);
    if (chosenColor) played.chosenColor = chosenColor;
    u.discard.push(played);
    u.cardsPlayed += 1;
    u.turnsPlayed += 1;
    u.awaitingDrawnPlay = null;
    u.pendingColorChooser = null;
    u.pendingWildCardId = null;

    const me = room.players.find((p) => p.id === socket.id);
    // "unoPlayed" — UNO only.
    io.to(roomCode).emit("unoPlayed", {
      by: socket.id,
      name: me ? me.name : "Player",
      card: publicCard(played),
      currentColor: currentColor(u),
      pendingPenalty: u.pendingPenalty +
        (played.kind === "draw2" ? 2 : played.kind === "wild4" ? 4 : 0),
      handCount: hand.length
    });

    afterPlayEffects(room, io, roomCode, played, socket.id);
    if (!u.over) emitFullState(room, io, roomCode);
  });

  /*
   * "unoChooseColor" — UNO only. Completes a wild play after color pick.
   * Payload: { roomCode, color }
   */
  socket.on("unoChooseColor", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno") return;
    const u = room.uno;
    if (!u || u.over || u.pendingColorChooser !== socket.id) {
      socket.emit("errorMessage", "No wild color to choose.");
      return;
    }
    const color = data && typeof data.color === "string" ? data.color.toLowerCase() : "";
    if (!COLORS.includes(color)) {
      socket.emit("errorMessage", "Choose red, blue, green, or yellow.");
      return;
    }
    const hand = u.hands[socket.id] || [];
    const idx = hand.findIndex((c) => c.id === u.pendingWildCardId);
    if (idx < 0) {
      u.pendingColorChooser = null;
      u.pendingWildCardId = null;
      socket.emit("errorMessage", "Wild card missing from hand.");
      emitFullState(room, io, roomCode);
      return;
    }
    if (!canPlayCard(u, hand[idx])) {
      socket.emit("errorMessage", "That wild cannot be played now.");
      return;
    }

    const card = hand.splice(idx, 1)[0];
    const played = Object.assign({}, card, { chosenColor: color });
    u.discard.push(played);
    u.cardsPlayed += 1;
    u.turnsPlayed += 1;
    u.awaitingDrawnPlay = null;
    u.pendingColorChooser = null;
    u.pendingWildCardId = null;

    const me = room.players.find((p) => p.id === socket.id);
    io.to(roomCode).emit("unoPlayed", {
      by: socket.id,
      name: me ? me.name : "Player",
      card: publicCard(played),
      currentColor: color,
      pendingPenalty: u.pendingPenalty + (played.kind === "wild4" ? 4 : 0),
      handCount: hand.length
    });
    // "unoColorChosen" — UNO only.
    io.to(roomCode).emit("unoColorChosen", { color, by: socket.id, name: me ? me.name : "Player" });

    afterPlayEffects(room, io, roomCode, played, socket.id);
    if (!u.over) emitFullState(room, io, roomCode);
  });

  /*
   * "unoDraw" — UNO only. Draw one card, or accept a pending penalty stack.
   */
  socket.on("unoDraw", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno") {
      socket.emit("errorMessage", "You are not in a UNO lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const u = room.uno;
    if (!u || u.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (u.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    if (u.pendingColorChooser) {
      socket.emit("errorMessage", "Choose a color first.");
      return;
    }
    if (u.awaitingDrawnPlay) {
      // Decline playing the drawn card → pass.
      u.awaitingDrawnPlay = null;
      u.turnsPlayed += 1;
      advanceTurn(room, 1);
      resolveForcedPenalty(room, io, roomCode);
      emitFullState(room, io, roomCode);
      return;
    }

    // Accept penalty stack voluntarily (or when they press Draw under penalty).
    if (u.pendingPenalty > 0) {
      const amount = u.pendingPenalty;
      const drawn = drawFromPile(u, amount);
      u.hands[socket.id].push(...drawn);
      u.pendingPenalty = 0;
      u.pendingKind = null;
      const me = room.players.find((p) => p.id === socket.id);
      io.to(roomCode).emit("unoPenaltyDrawn", {
        by: socket.id,
        name: me ? me.name : "Player",
        amount,
        handCount: u.hands[socket.id].length
      });
      markUnoLiability(u, socket.id, u.hands[socket.id].length);
      u.turnsPlayed += 1;
      advanceTurn(room, 1);
      resolveForcedPenalty(room, io, roomCode);
      emitFullState(room, io, roomCode);
      return;
    }

    const drawn = drawFromPile(u, 1);
    if (!drawn.length) {
      socket.emit("errorMessage", "No cards left to draw.");
      return;
    }
    const card = drawn[0];
    u.hands[socket.id].push(card);
    const me = room.players.find((p) => p.id === socket.id);
    // "unoDrawn" — UNO only. Public draw notice (card hidden).
    io.to(roomCode).emit("unoDrawn", {
      by: socket.id,
      name: me ? me.name : "Player",
      handCount: u.hands[socket.id].length,
      drawCount: u.draw.length
    });

    if (canPlayCard(u, card)) {
      u.awaitingDrawnPlay = { cardId: card.id };
      emitFullState(room, io, roomCode);
      return;
    }

    // Unplayable — automatic pass.
    u.turnsPlayed += 1;
    advanceTurn(room, 1);
    resolveForcedPenalty(room, io, roomCode);
    emitFullState(room, io, roomCode);
  });

  /*
   * "unoCall" — UNO only. Player with exactly 1 card presses UNO.
   */
  socket.on("unoCall", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno") return;
    const u = room.uno;
    if (!u || u.over) return;
    if (!room.players.some((p) => p.id === socket.id)) return;
    const count = (u.hands[socket.id] || []).length;
    if (count !== 1) {
      socket.emit("errorMessage", "You can only call UNO with exactly one card.");
      return;
    }
    u.unoCalled[socket.id] = true;
    u.unoLiable[socket.id] = false;
    if (u.unoLiableAt) u.unoLiableAt[socket.id] = null;
    const me = room.players.find((p) => p.id === socket.id);
    // "unoCalled" — UNO only.
    io.to(roomCode).emit("unoCalled", {
      by: socket.id,
      name: me ? me.name : "Player"
    });
    emitFullState(room, io, roomCode);
  });

  /*
   * "unoChallenge" — UNO only. Challenge a player who forgot to call UNO.
   * Payload: { roomCode, targetId }
   */
  socket.on("unoChallenge", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno") return;
    const u = room.uno;
    if (!u || u.over) return;
    if (!room.players.some((p) => p.id === socket.id)) return;

    const targetId = data && typeof data.targetId === "string" ? data.targetId : "";
    if (targetId === socket.id) {
      socket.emit("errorMessage", "You cannot challenge yourself.");
      return;
    }
    const target = room.players.find((p) => p.id === targetId);
    if (!target) {
      socket.emit("errorMessage", "Player not found.");
      return;
    }
    const count = (u.hands[targetId] || []).length;
    if (count !== 1 || !u.unoLiable[targetId] || u.unoCalled[targetId]) {
      socket.emit("errorMessage", "Challenge failed — they called UNO (or do not have one card).");
      return;
    }
    if (!canChallengeUno(u, targetId)) {
      socket.emit("errorMessage", "Wait — they still have time to call UNO.");
      return;
    }

    const drawn = drawFromPile(u, 2);
    u.hands[targetId].push(...drawn);
    u.unoLiable[targetId] = false;
    if (u.unoLiableAt) u.unoLiableAt[targetId] = null;
    const me = room.players.find((p) => p.id === socket.id);
    // "unoChallenged" — UNO only.
    io.to(roomCode).emit("unoChallenged", {
      by: socket.id,
      byName: me ? me.name : "Player",
      targetId,
      targetName: target.name,
      amount: 2,
      handCount: u.hands[targetId].length,
      success: true
    });
    emitFullState(room, io, roomCode);
  });

  /*
   * "unoPlayAgain" — UNO only. All seated players must vote to redeal.
   */
  socket.on("unoPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "uno" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.uno || !room.uno.over) {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }
    if (!room.unoRematch) room.unoRematch = {};
    room.unoRematch[socket.id] = true;
    if (!room.players.every((p) => room.unoRematch[p.id])) {
      // "unoPlayAgainWait" — UNO only.
      socket.emit("unoPlayAgainWait");
      return;
    }
    room.unoRematch = {};
    onLobbyFull(room, io, roomCode);
    // "unoReset" — UNO only.
    io.to(roomCode).emit("unoReset");
  });
}

module.exports = {
  onLobbyFull,
  registerSocket,
  buildDeck,
  shuffle,
  canPlayCard,
  listPlayable,
  normalizeMaxPlayers,
  COLORS,
  HAND_SIZE,
  ALLOWED_MAX_PLAYERS
};
