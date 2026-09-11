/*
 * Coin Flip — isolated 1v1 turn-based wagering and item game.
 *
 * The existing lobby owns rooms and players. This module owns only room.cf
 * and Coin Flip events. Upcoming flip sides are sent only to viewers who
 * are allowed to see them.
 */

const { randomInt } = require("crypto");

const STARTING_HEARTS = 20;
const STARTING_THROWS = 10;
const THROWS_PER_ROUND_INCREMENT = 0;
const ITEMS_PER_ROUND = 3;
const HEAL_ON_WIN = 1;
const MIN_WAGER = 1;
const SHIELD_REDUCTION = 2;
const SAFE_BET_REDUCTION = 1;
const SUSPENSE_MS = 1400;
const BETWEEN_TURN_MS = 900;
const ROUND_END_MS = 3400;
const SIDES = ["heads", "tails"];

/* ---- Round composition and hidden ordering (server-only) ---- */

function throwsForRound() {
  return STARTING_THROWS;
}

function generateComposition(count) {
  const size = Math.max(2, Number(count) || STARTING_THROWS);
  // randomInt's upper bound is exclusive: Heads is always 1..size-1.
  const heads = randomInt(1, size);
  return { heads, tails: size - heads };
}

function shuffleResults(results) {
  const shuffled = results.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}

function generateFlipGroup(count) {
  const composition = generateComposition(count);
  const results = [];
  for (let i = 0; i < composition.heads; i++) results.push("heads");
  for (let i = 0; i < composition.tails; i++) results.push("tails");
  return {
    totalThrows: results.length,
    hiddenOrder: shuffleResults(results),
    headsRemaining: composition.heads,
    tailsRemaining: composition.tails,
    revealed: []
  };
}

function nextHiddenThrow(cf) {
  return cf.group && cf.group.hiddenOrder.length
    ? cf.group.hiddenOrder[0]
    : null;
}

function revealNextThrow(cf) {
  const result = cf.group.hiddenOrder.shift();
  if (result === "heads") cf.group.headsRemaining -= 1;
  else if (result === "tails") cf.group.tailsRemaining -= 1;
  cf.group.revealed.push(result);
  return result;
}

/* ---- Modular item catalog ---- */

const ITEM_DEFS = {
  peek: {
    id: "peek",
    name: "Peek",
    description: "Privately reveal the next upcoming flip, even if the sequence is hidden from you.",
    phase: "turn"
  },
  shield: {
    id: "shield",
    name: "Shield",
    description: "Reduce your next lost wager by up to " + SHIELD_REDUCTION + " hearts.",
    phase: "turn"
  },
  double: {
    id: "double",
    name: "Double",
    description: "Your next won wager deals double damage; a loss stays normal.",
    phase: "turn"
  },
  "safe-bet": {
    id: "safe-bet",
    name: "Safe Bet",
    description: "Reduce your next lost wager by " + SAFE_BET_REDUCTION + " heart.",
    phase: "turn"
  },
  "flip-swap": {
    id: "flip-swap",
    name: "Flip Swap",
    description: "Swap the next two upcoming coin results. Does not change who is betting.",
    phase: "turn",
    needsUpcoming: 2
  },
  reverse: {
    id: "reverse",
    name: "Reverse",
    description: "Reverse the order of remaining upcoming coin results this round.",
    phase: "turn",
    needsUpcoming: 2
  },
  randomize: {
    id: "randomize",
    name: "Randomize",
    description: "Shuffle the remaining upcoming coin results this round. The new order is chosen on the server.",
    phase: "turn",
    needsUpcoming: 2
  },
  "swap-next": {
    id: "swap-next",
    name: "Swap Next",
    description: "Swap the next upcoming result with another remaining result chosen at random.",
    phase: "turn",
    needsUpcoming: 2
  },
  "blind-round": {
    id: "blind-round",
    name: "Blind Round",
    description: "Hide upcoming Heads/Tails from both players for the rest of this round. Revealed throws stay visible.",
    phase: "turn"
  },
  "hide-opponent": {
    id: "hide-opponent",
    name: "Hide Opponent",
    description: "Hide upcoming Heads/Tails from your opponent for the rest of this round. You still see them.",
    phase: "turn"
  },
  "hidden-future": {
    id: "hidden-future",
    name: "Hidden Future",
    description: "Hide upcoming Heads/Tails from yourself for the rest of this round. Already revealed throws stay visible.",
    phase: "turn"
  }
};

const ITEM_IDS = Object.keys(ITEM_DEFS);

function itemCatalog() {
  return ITEM_IDS.map((id) => {
    const item = ITEM_DEFS[id];
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      consumed: true
    };
  });
}

function createPlayerState() {
  return {
    inventory: {},
    effects: {
      shield: 0,
      safeBet: 0,
      doubleNext: false,
      hideOpponent: false,
      hiddenFuture: false
    },
    itemUsedThisTurn: false,
    peekInfo: null,
    lastReward: null
  };
}

function pickRoundItems() {
  const pool = ITEM_IDS.slice();
  const picks = [];
  const count = Math.min(ITEMS_PER_ROUND, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = randomInt(pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

function grantRoundItems(room, io) {
  const cf = room.cf;
  room.players.forEach((player) => {
    const slot = cf.playerState[player.id];
    const rewards = pickRoundItems();
    rewards.forEach((itemId) => {
      slot.inventory[itemId] = (slot.inventory[itemId] || 0) + 1;
    });
    slot.lastReward = rewards.slice();
    io.to(player.id).emit("coinFlipItemReward", {
      round: cf.round,
      items: rewards.map((id) => {
        const item = ITEM_DEFS[id];
        return { id: item.id, name: item.name, description: item.description };
      })
    });
  });
}

function resetRoundVisibility(cf) {
  cf.blindRound = false;
  Object.keys(cf.playerState).forEach((id) => {
    const slot = cf.playerState[id];
    slot.effects.hideOpponent = false;
    slot.effects.hiddenFuture = false;
    slot.peekInfo = null;
  });
}

function canSeeUpcoming(room, viewerId) {
  const cf = room.cf;
  if (!cf || cf.blindRound) return false;
  const slot = cf.playerState[viewerId];
  if (slot && slot.effects.hiddenFuture) return false;
  const oppId = opponentId(room, viewerId);
  if (oppId && cf.playerState[oppId] && cf.playerState[oppId].effects.hideOpponent) {
    return false;
  }
  return true;
}

function upcomingCount(cf) {
  return cf && cf.group && cf.group.hiddenOrder ? cf.group.hiddenOrder.length : 0;
}

/* ---- Turn, wager, and timer helpers ---- */

function opponentId(room, playerId) {
  const opponent = room.players.find((p) => p.id !== playerId);
  return opponent ? opponent.id : null;
}

// Every individual throw is a fresh wager decision. Max wager is the round number.
function maxAllowedWager(room) {
  const cf = room.cf;
  return Math.max(0, cf.round || 0);
}

function wagerAtRisk(room) {
  const cf = room.cf;
  return cf.pending ? cf.pending.wager : 0;
}

function parseWager(raw, maxW) {
  const wager = Number(raw);
  if (!Number.isInteger(wager)) return null;
  if (wager < MIN_WAGER || wager > maxW) return null;
  return wager;
}

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

/* ---- State initialization and public/private views ---- */

function initRoomState(room) {
  clearCfTimers(room);
  const hearts = {};
  const playerState = {};
  room.players.forEach((player) => {
    hearts[player.id] = STARTING_HEARTS;
    playerState[player.id] = createPlayerState();
  });
  room.cf = {
    hearts,
    playerState,
    round: 1,
    currentTurnId: room.players[0].id,
    nextRoundStarterId: null,
    phase: "turn", // turn | resolving | between | round-end | over
    group: generateFlipGroup(throwsForRound(1)),
    blindRound: false,
    lastResult: null,
    roundSummary: null,
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
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    hearts: cf.hearts[player.id],
    isTurn: !cf.over && cf.phase === "turn" && cf.currentTurnId === player.id
  }));
}

function itemAvailability(room, playerId) {
  const cf = room.cf;
  const slot = cf.playerState[playerId];
  const availability = {};
  ITEM_IDS.forEach((id) => {
    const owns = !!(slot && slot.inventory[id] > 0);
    if (!owns || slot.itemUsedThisTurn || cf.over) {
      availability[id] = false;
      return;
    }
    const onTurn = cf.phase === "turn" && cf.currentTurnId === playerId;
    if (!onTurn) {
      availability[id] = false;
      return;
    }
    const need = ITEM_DEFS[id].needsUpcoming || 0;
    availability[id] = upcomingCount(cf) >= need;
  });
  return availability;
}

function buildStateFor(room, playerId, roomCode) {
  const cf = room.cf;
  const group = cf.group;
  const slot = cf.playerState[playerId];
  const yourTurn = !!(
    !cf.over &&
    cf.phase === "turn" &&
    cf.currentTurnId === playerId
  );
  const maxWager = maxAllowedWager(room);
  const seeUpcoming = canSeeUpcoming(room, playerId);
  return {
    room: roomCode,
    game: "coin-flip",
    round: cf.round,
    throwsThisRound: group.totalThrows,
    throwsCompleted: group.revealed.length,
    wagerAtRisk: wagerAtRisk(room),
    minWager: MIN_WAGER,
    maxWager,
    phase: cf.phase,
    over: !!cf.over,
    winnerId: cf.winnerId,
    draw: !!cf.draw,
    currentTurnId: cf.currentTurnId,
    yourId: playerId,
    yourTurn,
    canAct: yourTurn && maxWager >= MIN_WAGER,
    upcomingHidden: !seeUpcoming,
    upcomingResults: seeUpcoming ? group.hiddenOrder.slice() : null,
    headsRemaining: seeUpcoming ? group.headsRemaining : null,
    tailsRemaining: seeUpcoming ? group.tailsRemaining : null,
    flipsRemaining: group.hiddenOrder.length,
    lockedChoice: cf.pending ? cf.pending.choice : null,
    lastResult: cf.lastResult,
    roundSummary: cf.roundSummary,
    history: (cf.history || []).slice(-20),
    players: publicPlayers(room),
    startingHearts: STARTING_HEARTS,
    inventory: Object.assign({}, slot.inventory),
    itemAvailability: itemAvailability(room, playerId),
    itemsCatalog: itemCatalog(),
    privateInfo: slot.peekInfo,
    lastReward: slot.lastReward ? slot.lastReward.slice() : [],
    rules: {
      startingThrows: STARTING_THROWS,
      throwsIncrement: THROWS_PER_ROUND_INCREMENT,
      itemsPerRound: ITEMS_PER_ROUND,
      minWager: MIN_WAGER,
      perThrowWager: true
    }
  };
}

function emitStates(room, io, roomCode) {
  room.players.forEach((player) => {
    io.to(player.id).emit("coinFlipState", buildStateFor(room, player.id, roomCode));
  });
}

/* ---- Damage and game end ---- */

function applyDamage(cf, targetId, amount) {
  const damage = Math.max(0, Math.min(amount, cf.hearts[targetId] || 0));
  cf.hearts[targetId] = Math.max(0, (cf.hearts[targetId] || 0) - damage);
  return damage;
}

function applyHeal(cf, targetId, amount) {
  const before = cf.hearts[targetId] || 0;
  cf.hearts[targetId] = Math.min(STARTING_HEARTS, before + Math.max(0, amount));
  return cf.hearts[targetId] - before;
}

function reduceLostWager(slot, amount) {
  let damage = amount;
  let protection = null;
  if (slot.effects.shield > 0) {
    damage = Math.max(0, damage - SHIELD_REDUCTION);
    slot.effects.shield -= 1;
    protection = "shield";
  } else if (slot.effects.safeBet > 0) {
    damage = Math.max(0, damage - SAFE_BET_REDUCTION);
    slot.effects.safeBet -= 1;
    protection = "safe-bet";
  }
  return { damage, protection };
}

function checkGameOver(room, io, roomCode) {
  const cf = room.cf;
  const dead = room.players.filter((player) => cf.hearts[player.id] <= 0);
  if (!dead.length) return false;

  clearCfTimers(room);
  cf.over = true;
  cf.phase = "over";

  if (dead.length >= 2) {
    cf.draw = true;
    cf.winnerId = null;
  } else {
    cf.draw = false;
    const winner = room.players.find((player) => player.id !== dead[0].id);
    cf.winnerId = winner ? winner.id : null;
  }

  const winner = cf.winnerId
    ? room.players.find((player) => player.id === cf.winnerId)
    : null;
  const message = cf.draw
    ? "Draw — both players fell!"
    : winner
      ? winner.name + " wins!"
      : "Match over.";

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

/* ---- Throw resolution and round progression ---- */

function resetTurnItemUse(room, playerId) {
  const slot = room.cf.playerState[playerId];
  if (!slot) return;
  slot.itemUsedThisTurn = false;
  slot.peekInfo = null;
}

function advanceTurn(room, io, roomCode) {
  const cf = room.cf;
  if (!cf || cf.over) return;
  const nextId = opponentId(room, cf.currentTurnId);
  cf.currentTurnId = nextId;
  cf.phase = "turn";
  cf.pending = null;
  resetTurnItemUse(room, nextId);
  emitStates(room, io, roomCode);
}

function completeRound(room, io, roomCode, lastActorId) {
  const cf = room.cf;
  cf.phase = "round-end";
  cf.nextRoundStarterId = opponentId(room, lastActorId);
  cf.roundSummary = {
    round: cf.round,
    throws: cf.group.totalThrows,
    nextThrows: throwsForRound(cf.round + 1),
    itemsPerPlayer: ITEMS_PER_ROUND,
    pauseMs: ROUND_END_MS
  };
  io.to(roomCode).emit("coinFlipRoundComplete", {
    room: roomCode,
    summary: cf.roundSummary,
    players: publicPlayers(room)
  });
  emitStates(room, io, roomCode);

  room.cfNextTimer = setTimeout(() => {
    room.cfNextTimer = null;
    if (!room.cf || room.cf.over || room.cf.phase !== "round-end") return;
    startNextRound(room, io, roomCode);
  }, ROUND_END_MS);
}

function startNextRound(room, io, roomCode) {
  const cf = room.cf;
  cf.round += 1;
  cf.currentTurnId = cf.nextRoundStarterId || opponentId(room, cf.currentTurnId);
  cf.nextRoundStarterId = null;
  cf.phase = "turn";
  resetRoundVisibility(cf);
  cf.group = generateFlipGroup(throwsForRound(cf.round));
  cf.lastResult = null;
  cf.roundSummary = null;
  cf.pending = null;
  room.players.forEach((player) => {
    const slot = cf.playerState[player.id];
    slot.itemUsedThisTurn = false;
    slot.peekInfo = null;
    slot.lastReward = null;
  });
  grantRoundItems(room, io);
  io.to(roomCode).emit("coinFlipRoundStarted", {
    room: roomCode,
    round: cf.round,
    throws: cf.group.totalThrows
  });
  emitStates(room, io, roomCode);
}

function finishResolve(room, io, roomCode) {
  const cf = room.cf;
  if (!cf || !cf.pending || cf.over) return;

  const pending = cf.pending;
  const coin = revealNextThrow(cf);
  const actorId = pending.actorId;
  const wager = pending.wager;
  const choice = pending.choice;
  const actorWins = choice === coin;
  const actorSlot = cf.playerState[actorId];

  let winnerId;
  let loserId;
  let damageAmount = wager;
  let protection = null;
  let doubled = false;
  let healed = 0;
  if (actorWins) {
    winnerId = actorId;
    loserId = opponentId(room, actorId);
    if (actorSlot.effects.doubleNext) {
      damageAmount *= 2;
      doubled = true;
    }
    healed = applyHeal(cf, actorId, HEAL_ON_WIN);
  } else {
    winnerId = opponentId(room, actorId);
    loserId = actorId;
    const reduced = reduceLostWager(actorSlot, damageAmount);
    damageAmount = reduced.damage;
    protection = reduced.protection;
  }
  // Double applies to exactly one wager, whether that wager wins or loses.
  actorSlot.effects.doubleNext = false;

  const dealt = applyDamage(cf, loserId, damageAmount);
  const revealPosition = cf.group.revealed.length;
  room.players.forEach((player) => {
    const slot = cf.playerState[player.id];
    if (slot.peekInfo &&
        slot.peekInfo.round === cf.round &&
        slot.peekInfo.position === revealPosition) {
      slot.peekInfo = null;
    }
  });

  const entry = {
    round: cf.round,
    throwNumber: revealPosition,
    actorId,
    actorName: pending.actorName,
    wager,
    choice,
    coin,
    actorWins,
    winnerId,
    loserId,
    damage: dealt,
    healed,
    protection,
    doubled
  };
  cf.history.push(entry);
  cf.lastResult = entry;
  cf.pending = null;
  cf.phase = "between";

  io.to(roomCode).emit("coinFlipReveal", {
    room: roomCode,
    result: entry,
    flipsRemaining: cf.group.hiddenOrder.length,
    revealedInGroup: cf.group.revealed.slice(),
    players: publicPlayers(room)
  });
  emitStates(room, io, roomCode);

  if (checkGameOver(room, io, roomCode)) return;
  if (cf.group.hiddenOrder.length === 0) {
    completeRound(room, io, roomCode, actorId);
    return;
  }

  room.cfNextTimer = setTimeout(() => {
    room.cfNextTimer = null;
    if (!room.cf || room.cf.over) return;
    advanceTurn(room, io, roomCode);
  }, BETWEEN_TURN_MS);
}

function beginResolve(room, io, roomCode, actorId, choice, wager) {
  const cf = room.cf;
  const player = room.players.find((entry) => entry.id === actorId);
  const coin = nextHiddenThrow(cf);
  if (!coin) return;
  cf.phase = "resolving";
  cf.pending = {
    actorId,
    actorName: player ? player.name : "Player",
    wager,
    choice,
    coin
  };

  io.to(roomCode).emit("coinFlipSuspense", {
    room: roomCode,
    actorId,
    wager,
    choice,
    durationMs: SUSPENSE_MS
  });
  emitStates(room, io, roomCode);

  clearCfTimers(room);
  room.cfRevealTimer = setTimeout(() => {
    room.cfRevealTimer = null;
    finishResolve(room, io, roomCode);
  }, SUSPENSE_MS);
}

/* ---- Item validation and effects ---- */

function consumeItem(slot, itemId) {
  slot.inventory[itemId] -= 1;
  if (slot.inventory[itemId] <= 0) delete slot.inventory[itemId];
  slot.itemUsedThisTurn = true;
}

function applySequenceItem(cf, itemId) {
  const seq = cf.group.hiddenOrder;
  if (itemId === "flip-swap") {
    if (seq.length < 2) return { ok: false, error: "Need two upcoming flips to use Flip Swap." };
    const tmp = seq[0];
    seq[0] = seq[1];
    seq[1] = tmp;
    return { ok: true };
  }
  if (itemId === "reverse") {
    if (seq.length < 2) return { ok: false, error: "Need two upcoming flips to use Reverse." };
    seq.reverse();
    return { ok: true };
  }
  if (itemId === "randomize") {
    if (seq.length < 2) return { ok: false, error: "Need two upcoming flips to use Randomize." };
    cf.group.hiddenOrder = shuffleResults(seq);
    return { ok: true };
  }
  if (itemId === "swap-next") {
    if (seq.length < 2) return { ok: false, error: "Need two upcoming flips to use Swap Next." };
    const other = randomInt(1, seq.length);
    const tmp = seq[0];
    seq[0] = seq[other];
    seq[other] = tmp;
    return { ok: true };
  }
  return { ok: true };
}

function useItem(room, io, roomCode, playerId, itemId) {
  const cf = room.cf;
  const slot = cf.playerState[playerId];
  const def = ITEM_DEFS[itemId];
  const available = itemAvailability(room, playerId);
  if (!def) return { ok: false, error: "Unknown item." };
  if (!slot.inventory[itemId]) return { ok: false, error: "You do not own that item." };
  if (!available[itemId]) {
    if (def.needsUpcoming && upcomingCount(cf) < def.needsUpcoming) {
      return { ok: false, error: def.name + " needs at least two upcoming flips." };
    }
    return { ok: false, error: "That item cannot be used right now." };
  }

  const prepared = applySequenceItem(cf, itemId);
  if (!prepared.ok) return prepared;

  consumeItem(slot, itemId);
  if (itemId === "peek") {
    slot.peekInfo = {
      round: cf.round,
      position: cf.group.revealed.length + 1,
      result: nextHiddenThrow(cf)
    };
    io.to(playerId).emit("coinFlipItemInfo", {
      itemId,
      name: def.name,
      info: slot.peekInfo
    });
  } else if (itemId === "shield") {
    slot.effects.shield += 1;
  } else if (itemId === "double") {
    slot.effects.doubleNext = true;
  } else if (itemId === "safe-bet") {
    slot.effects.safeBet += 1;
  } else if (itemId === "blind-round") {
    cf.blindRound = true;
  } else if (itemId === "hide-opponent") {
    slot.effects.hideOpponent = true;
  } else if (itemId === "hidden-future") {
    slot.effects.hiddenFuture = true;
  }
  io.to(playerId).emit("coinFlipItemUsed", {
    itemId,
    name: def.name
  });
  emitStates(room, io, roomCode);
  return { ok: true };
}

/* ---- Match lifecycle and Socket.IO handlers ---- */

function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  grantRoundItems(room, io);
  room.players.forEach((player) => {
    io.to(player.id).emit("coinFlipStarted", buildStateFor(room, player.id, roomCode));
  });
  emitStates(room, io, roomCode);
}

function roomForPlayer(socket, rooms, data) {
  const roomCode = data && typeof data.roomCode === "string"
    ? data.roomCode.trim().toUpperCase()
    : "";
  const room = rooms[roomCode];
  if (!room || room.gameMode !== "coin-flip") {
    socket.emit("errorMessage", "You are not in a Coin Flip lobby.");
    return null;
  }
  if (!room.players.some((player) => player.id === socket.id)) {
    socket.emit("errorMessage", "You are not in this lobby.");
    return null;
  }
  return { room, roomCode };
}

function registerSocket(socket, io, rooms) {
  socket.on("coinFlipPlay", (data) => {
    const found = roomForPlayer(socket, rooms, data);
    if (!found) return;
    const { room, roomCode } = found;
    const cf = room.cf;
    if (!cf || cf.over || cf.phase !== "turn") {
      socket.emit("errorMessage", "You cannot bet right now.");
      return;
    }
    if (cf.currentTurnId !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    const choice = data && typeof data.choice === "string"
      ? data.choice.trim().toLowerCase()
      : "";
    if (!SIDES.includes(choice)) {
      socket.emit("errorMessage", "Choose Heads or Tails.");
      return;
    }
    const maxW = maxAllowedWager(room);
    if (maxW < MIN_WAGER) {
      socket.emit("errorMessage", "No valid wager remains.");
      return;
    }
    const wager = parseWager(data && data.wager, maxW);
    if (wager === null) {
      socket.emit(
        "errorMessage",
        "Wager must be between " + MIN_WAGER + " and " + maxW + " hearts."
      );
      return;
    }
    beginResolve(room, io, roomCode, socket.id, choice, wager);
  });

  socket.on("coinFlipUseItem", (data) => {
    const found = roomForPlayer(socket, rooms, data);
    if (!found) return;
    const itemId = data && typeof data.itemId === "string"
      ? data.itemId.trim().toLowerCase()
      : "";
    const result = useItem(found.room, io, found.roomCode, socket.id, itemId);
    if (!result.ok) socket.emit("errorMessage", result.error);
  });

  socket.on("coinFlipPlayAgain", (data) => {
    const found = roomForPlayer(socket, rooms, data);
    if (!found) return;
    const { room, roomCode } = found;
    if (!room.cf || !room.cf.over) {
      socket.emit("errorMessage", "The match is still going.");
      return;
    }
    if (!room.cfRematch) room.cfRematch = {};
    room.cfRematch[socket.id] = true;
    if (!room.players.every((player) => room.cfRematch[player.id])) {
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
  generateComposition,
  generateFlipGroup,
  throwsForRound,
  STARTING_HEARTS,
  STARTING_THROWS,
  THROWS_PER_ROUND_INCREMENT,
  ITEMS_PER_ROUND,
  MIN_WAGER,
  ITEM_DEFS,
  SIDES
};
