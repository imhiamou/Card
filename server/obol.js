/*
 * O.B.O.L. — isolated 1v1 prediction foundation.
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Word Chain, Code Breaker, Dominoes, UNO, or Dodge Ball.
 * Uses its own Socket.IO events and room.obol state.
 *
 * Core loop (modular — items / consequences will change later):
 *   CHOICE → (both locked) → REVEALING → AFTERMATH → next round / OVER
 * Server alone flips the coin and applies results.
 */

const STARTING_HP = 100;
const BASE_DAMAGE = 25;
const BONUS_DAMAGE = 15;
const SUSPENSE_MS = 1600;
const AFTERMATH_MS = 2200;
const SIDES = ["heads", "tails"];

/**
 * Modular item catalog. Effects hook into round resolution; the main
 * loop only looks up by id so items can be swapped later.
 */
const ITEM_DEFS = {
  ward: {
    id: "ward",
    name: "Ward",
    description: "Negate damage if you lose this round.",
    consumed: true,
    onUse(slot) {
      slot.roundEffects.ward = true;
    },
    modifyDamage(amount, slot, role) {
      if (role === "loser" && slot.roundEffects.ward) return 0;
      return amount;
    }
  },
  surge: {
    id: "surge",
    name: "Surge",
    description: "Deal +" + BONUS_DAMAGE + " damage if you win this round.",
    consumed: true,
    onUse(slot) {
      slot.roundEffects.surge = true;
    },
    modifyOutgoing(amount, slot, role) {
      if (role === "winner" && slot.roundEffects.surge) return amount + BONUS_DAMAGE;
      return amount;
    }
  },
  tonic: {
    id: "tonic",
    name: "Tonic",
    description: "Restore 15 HP immediately.",
    consumed: true,
    onUse(slot) {
      slot.hp = Math.min(STARTING_HP, slot.hp + 15);
      slot.roundEffects.tonic = true;
    }
  }
};

const STARTER_ITEMS = ["ward", "surge", "tonic"];

function clearObolTimers(room) {
  if (!room) return;
  if (room.obolRevealTimer) {
    clearTimeout(room.obolRevealTimer);
    room.obolRevealTimer = null;
  }
  if (room.obolNextTimer) {
    clearTimeout(room.obolNextTimer);
    room.obolNextTimer = null;
  }
}

function stopRoom(room) {
  clearObolTimers(room);
}

function itemPublicList() {
  return Object.keys(ITEM_DEFS).map((id) => {
    const d = ITEM_DEFS[id];
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      consumed: !!d.consumed
    };
  });
}

function freshInventory() {
  const inv = {};
  STARTER_ITEMS.forEach((id) => {
    inv[id] = (inv[id] || 0) + 1;
  });
  return inv;
}

function initRoomState(room) {
  clearObolTimers(room);
  const slots = {};
  room.players.forEach((p) => {
    slots[p.id] = {
      hp: STARTING_HP,
      inventory: freshInventory(),
      choice: null,
      locked: false,
      itemUsedThisRound: null,
      roundEffects: {}
    };
  });
  room.obol = {
    round: 1,
    phase: "choice",
    slots,
    coin: null,
    lastResult: null,
    history: [],
    over: false,
    winnerId: null,
    draw: false,
    stakes: { baseDamage: BASE_DAMAGE, startingHp: STARTING_HP }
  };
  room.obolRematch = {};
}

function getSlot(room, playerId) {
  return room.obol && room.obol.slots ? room.obol.slots[playerId] : null;
}

function publicPlayers(room, viewerId) {
  const ob = room.obol;
  const revealChoices = !!(ob && ob.phase !== "choice");
  return room.players.map((p) => {
    const slot = getSlot(room, p.id);
    const isSelf = p.id === viewerId;
    return {
      id: p.id,
      name: p.name,
      hp: slot ? slot.hp : STARTING_HP,
      locked: !!(slot && slot.locked),
      // Own choice is always visible; opponent's stays hidden until reveal.
      choice: slot && (isSelf || revealChoices) ? slot.choice : null,
      itemUsedThisRound: slot ? slot.itemUsedThisRound : null,
      inventory: isSelf && slot ? Object.assign({}, slot.inventory) : undefined
    };
  });
}

function buildStateFor(room, playerId) {
  const ob = room.obol;
  const slot = getSlot(room, playerId);
  const canAct = !!(
    ob &&
    !ob.over &&
    ob.phase === "choice" &&
    slot &&
    !slot.locked
  );
  return {
    room: room._obolRoomCode || null,
    game: "obol",
    round: ob.round,
    phase: ob.phase,
    over: !!ob.over,
    winnerId: ob.winnerId,
    draw: !!ob.draw,
    stakes: ob.stakes,
    coin: ob.phase === "choice" ? null : ob.coin,
    lastResult: ob.lastResult,
    history: (ob.history || []).slice(-12),
    players: publicPlayers(room, playerId),
    itemsCatalog: itemPublicList(),
    yourId: playerId,
    canChoose: canAct,
    canUseItem: canAct,
    yourChoice: slot ? slot.choice : null,
    yourLocked: !!(slot && slot.locked)
  };
}

function emitStates(room, io, roomCode, extraByPlayer) {
  room._obolRoomCode = roomCode;
  room.players.forEach((p) => {
    const payload = Object.assign(buildStateFor(room, p.id), (extraByPlayer && extraByPlayer[p.id]) || {});
    payload.room = roomCode;
    io.to(p.id).emit("obolState", payload);
  });
}

function bothLocked(room) {
  return room.players.every((p) => {
    const s = getSlot(room, p.id);
    return s && s.locked && SIDES.includes(s.choice);
  });
}

function flipCoin() {
  return Math.random() < 0.5 ? "heads" : "tails";
}

function resetRoundEffects(room) {
  room.players.forEach((p) => {
    const s = getSlot(room, p.id);
    if (!s) return;
    s.choice = null;
    s.locked = false;
    s.itemUsedThisRound = null;
    s.roundEffects = {};
  });
}

function startRound(room, io, roomCode) {
  const ob = room.obol;
  if (!ob || ob.over) return;
  clearObolTimers(room);
  resetRoundEffects(room);
  ob.phase = "choice";
  ob.coin = null;
  ob.lastResult = null;
  emitStates(room, io, roomCode);
}

/**
 * Resolve coin + consequences. Server-authoritative.
 */
function resolveRound(room, io, roomCode) {
  const ob = room.obol;
  if (!ob || ob.over || ob.phase !== "revealing") return;

  const coin = flipCoin();
  ob.coin = coin;

  const rows = room.players.map((p) => {
    const slot = getSlot(room, p.id);
    const correct = slot.choice === coin;
    return { id: p.id, name: p.name, slot, correct, choice: slot.choice };
  });

  const correctPlayers = rows.filter((r) => r.correct);
  const wrongPlayers = rows.filter((r) => !r.correct);
  let draw = false;
  let roundWinnerIds = [];
  let roundLoserIds = [];

  if (correctPlayers.length === 1 && wrongPlayers.length === 1) {
    roundWinnerIds = [correctPlayers[0].id];
    roundLoserIds = [wrongPlayers[0].id];
  } else {
    draw = true;
  }

  const damageLog = [];

  if (!draw) {
    const winner = rows.find((r) => r.id === roundWinnerIds[0]);
    const loser = rows.find((r) => r.id === roundLoserIds[0]);
    let amount = BASE_DAMAGE;
    const surgeDef = ITEM_DEFS.surge;
    if (surgeDef && typeof surgeDef.modifyOutgoing === "function") {
      amount = surgeDef.modifyOutgoing(amount, winner.slot, "winner");
    }
    const wardDef = ITEM_DEFS.ward;
    if (wardDef && typeof wardDef.modifyDamage === "function") {
      amount = wardDef.modifyDamage(amount, loser.slot, "loser");
    }
    amount = Math.max(0, amount);
    loser.slot.hp = Math.max(0, loser.slot.hp - amount);
    damageLog.push({
      targetId: loser.id,
      amount,
      blocked: amount === 0 && loser.slot.roundEffects.ward
    });
  }

  const entry = {
    round: ob.round,
    coin,
    choices: rows.map((r) => ({ id: r.id, name: r.name, choice: r.choice, correct: r.correct })),
    draw,
    winnerIds: roundWinnerIds.slice(),
    loserIds: roundLoserIds.slice(),
    damage: damageLog
  };
  ob.history.push(entry);
  ob.lastResult = entry;
  ob.phase = "aftermath";

  io.to(roomCode).emit("obolReveal", {
    room: roomCode,
    round: ob.round,
    coin,
    result: entry,
    players: room.players.map((p) => {
      const s = getSlot(room, p.id);
      return { id: p.id, name: p.name, hp: s.hp, choice: s.choice };
    })
  });
  emitStates(room, io, roomCode);

  const dead = room.players.filter((p) => getSlot(room, p.id).hp <= 0);
  if (dead.length >= 1) {
    finishMatch(room, io, roomCode, dead);
    return;
  }

  room.obolNextTimer = setTimeout(() => {
    room.obolNextTimer = null;
    if (!roomsAlive(room) || !room.obol || room.obol.over) return;
    room.obol.round += 1;
    startRound(room, io, roomCode);
  }, AFTERMATH_MS);
}

function roomsAlive(room) {
  return !!(room && room.obol);
}

function finishMatch(room, io, roomCode, deadPlayers) {
  const ob = room.obol;
  clearObolTimers(room);
  ob.over = true;
  ob.phase = "over";

  if (deadPlayers.length >= 2) {
    ob.draw = true;
    ob.winnerId = null;
  } else {
    ob.draw = false;
    const deadId = deadPlayers[0].id;
    const winner = room.players.find((p) => p.id !== deadId);
    ob.winnerId = winner ? winner.id : null;
  }

  const winner = ob.winnerId
    ? room.players.find((p) => p.id === ob.winnerId)
    : null;
  let message;
  if (ob.draw) {
    message = "Draw — both players fell!";
  } else if (winner) {
    message = winner.name + " wins!";
  } else {
    message = "Match over.";
  }

  io.to(roomCode).emit("obolOver", {
    room: roomCode,
    winnerId: ob.winnerId,
    winnerName: winner ? winner.name : null,
    draw: !!ob.draw,
    message,
    players: room.players.map((p) => {
      const s = getSlot(room, p.id);
      return { id: p.id, name: p.name, hp: s.hp };
    }),
    history: ob.history.slice()
  });
  emitStates(room, io, roomCode);
}

function beginReveal(room, io, roomCode) {
  const ob = room.obol;
  if (!ob || ob.over) return;
  ob.phase = "revealing";
  emitStates(room, io, roomCode);
  io.to(roomCode).emit("obolSuspense", {
    room: roomCode,
    round: ob.round,
    durationMs: SUSPENSE_MS
  });
  clearObolTimers(room);
  room.obolRevealTimer = setTimeout(() => {
    room.obolRevealTimer = null;
    resolveRound(room, io, roomCode);
  }, SUSPENSE_MS);
}

function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  room._obolRoomCode = roomCode;
  room.players.forEach((player) => {
    const payload = buildStateFor(room, player.id);
    payload.room = roomCode;
    payload.players = publicPlayers(room, player.id);
    io.to(player.id).emit("obolStarted", Object.assign({}, payload, {
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        hp: STARTING_HP
      }))
    }));
  });
  emitStates(room, io, roomCode);
}

function registerSocket(socket, io, rooms) {
  /*
   * "obolChoose" — lock Heads or Tails for this round.
   * Payload: { roomCode, side: "heads"|"tails" }
   */
  socket.on("obolChoose", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "obol") {
      socket.emit("errorMessage", "You are not in an O.B.O.L. lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.obol || room.obol.over || room.obol.phase !== "choice") {
      socket.emit("errorMessage", "You cannot choose right now.");
      return;
    }
    const slot = getSlot(room, socket.id);
    if (!slot || slot.locked) {
      socket.emit("errorMessage", "Your choice is already locked.");
      return;
    }
    const side = data && typeof data.side === "string" ? data.side.trim().toLowerCase() : "";
    if (!SIDES.includes(side)) {
      socket.emit("errorMessage", "Choose Heads or Tails.");
      return;
    }
    slot.choice = side;
    slot.locked = true;
    emitStates(room, io, roomCode);
    if (bothLocked(room)) {
      beginReveal(room, io, roomCode);
    }
  });

  /*
   * "obolUseItem" — use a modular inventory item during CHOICE.
   * Payload: { roomCode, itemId }
   */
  socket.on("obolUseItem", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "obol") {
      socket.emit("errorMessage", "You are not in an O.B.O.L. lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.obol || room.obol.over || room.obol.phase !== "choice") {
      socket.emit("errorMessage", "You cannot use an item right now.");
      return;
    }
    const slot = getSlot(room, socket.id);
    if (!slot || slot.locked) {
      socket.emit("errorMessage", "Choices are locked — items are closed.");
      return;
    }
    if (slot.itemUsedThisRound) {
      socket.emit("errorMessage", "You already used an item this round.");
      return;
    }
    const itemId = data && typeof data.itemId === "string" ? data.itemId.trim() : "";
    const def = ITEM_DEFS[itemId];
    if (!def) {
      socket.emit("errorMessage", "Unknown item.");
      return;
    }
    if (!slot.inventory[itemId] || slot.inventory[itemId] < 1) {
      socket.emit("errorMessage", "You do not have that item.");
      return;
    }
    if (def.consumed) {
      slot.inventory[itemId] -= 1;
      if (slot.inventory[itemId] <= 0) delete slot.inventory[itemId];
    }
    slot.itemUsedThisRound = itemId;
    if (typeof def.onUse === "function") def.onUse(slot);
    emitStates(room, io, roomCode);
  });

  /*
   * "obolPlayAgain" — both players must vote; then a fresh match starts.
   */
  socket.on("obolPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "obol" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.obol || !room.obol.over) {
      socket.emit("errorMessage", "The match is still going.");
      return;
    }
    if (!room.obolRematch) room.obolRematch = {};
    room.obolRematch[socket.id] = true;
    if (!room.players.every((p) => room.obolRematch[p.id])) {
      socket.emit("obolPlayAgainWait");
      return;
    }
    room.obolRematch = {};
    onBothPlayersJoined(room, io, roomCode);
    io.to(roomCode).emit("obolReset");
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  stopRoom,
  ITEM_DEFS,
  STARTING_HP,
  BASE_DAMAGE,
  SIDES
};
