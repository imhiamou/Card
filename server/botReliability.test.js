"use strict";

process.env.BOT_TEST_FAST = "1";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const util = require("node:util");
const uno = require("./uno");
const domino = require("./domino");
const unoBot = require("./bots/unoBot");
const dominoBot = require("./bots/dominoBot");
const { createBotSocket } = require("./bots/botSocket");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function card(id, color, kind, value) {
  return { id, color, kind, value: value == null ? kind : value };
}

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function fakeIo() {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(name, data) {
          events.push({ room, name, data });
        }
      };
    }
  };
}

function fakeHuman(id) {
  const handlers = {};
  const emitted = [];
  return {
    id,
    handlers,
    emitted,
    on(name, fn) { handlers[name] = fn; },
    emit(name, data) { emitted.push({ name, data }); },
    join() {},
    leave() {}
  };
}

function blankUno(turnId, turnIndex) {
  return {
    draw: [],
    discard: [card("top", "red", "number", 4)],
    hands: {},
    currentTurn: turnId,
    turnIndex,
    direction: 1,
    pendingPenalty: 0,
    pendingKind: null,
    pendingColorChooser: null,
    pendingWildCardId: null,
    awaitingDrawnPlay: null,
    unoCalled: {},
    unoLiable: {},
    unoLiableAt: {},
    over: false,
    winnerId: null,
    turnsPlayed: 0,
    cardsPlayed: 0
  };
}

function mountUno(code) {
  const io = fakeIo();
  const rooms = {};
  const human = fakeHuman("h1");
  const bot = createBotSocket("b1");
  const room = {
    gameMode: "uno",
    maxPlayers: 2,
    players: [
      { id: "h1", name: "Ava", isBot: false },
      { id: "b1", name: "UNO Bot", isBot: true }
    ],
    botSockets: { b1: bot }
  };
  rooms[code] = room;
  uno.registerSocket(human, io, rooms);
  uno.registerSocket(bot, io, rooms);
  return { io, rooms, room, human, bot };
}

function mountDomino(code) {
  const io = fakeIo();
  const rooms = {};
  const human = fakeHuman("h1");
  const bot = createBotSocket("b1");
  const room = {
    gameMode: "dominoes",
    maxPlayers: 2,
    players: [
      { id: "h1", name: "Ava", isBot: false },
      { id: "b1", name: "Domino Bot", isBot: true }
    ],
    botSockets: { b1: bot },
    dominoMatch: {
      roundsCompleted: 1,
      lastWinnerId: "h1",
      teams: { A: { roundsWon: 0, score: 0 }, B: { roundsWon: 0, score: 0 } },
      players: {}
    }
  };
  rooms[code] = room;
  domino.registerSocket(human, io, rooms);
  domino.registerSocket(bot, io, rooms);
  return { io, rooms, room, human, bot };
}

function blankDomino() {
  return {
    hands: { h1: [], b1: [] },
    boneyard: [],
    chain: [{ id: "1-2", a: 1, b: 2, leftPip: 1, rightPip: 2, isDouble: false }],
    leftEnd: 1,
    rightEnd: 2,
    currentTurn: "h1",
    turnIndex: 0,
    consecutivePasses: 0,
    mustPlayId: null,
    firstRound: false,
    over: false,
    scores: null,
    teamScores: null,
    teamMode: false,
    winnerId: null,
    winnerTeam: null,
    winReason: null,
    roundPoints: null
  };
}

async function withWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...args) => lines.push(util.format(...args));
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.warn = orig;
  }
}

describe("bot reliability", { concurrency: false }, () => {

test("bot scoring still prefers the same UNO cards and wild colors", () => {
  const red9 = card("r9", "red", "number", 9);
  const red1 = card("r1", "red", "number", 1);
  const blue4 = card("b4", "blue", "number", 4);
  const wild = card("w", null, "wild");
  const wild4 = card("w4", null, "wild4");
  const skip = card("rs", "red", "skip");
  const red2 = card("r2", "red", "number", 2);

  assert.deepEqual(unoBot.getUnoMove({
    hand: [red9, red1, blue4, wild, wild4],
    playableIds: ["r9", "r1", "b4", "w", "w4"],
    pendingPenalty: 0,
    pendingKind: null,
    nextPlayerHandCount: 5
  }), { cardId: "r9" });

  assert.deepEqual(unoBot.getUnoMove({
    hand: [skip, red2, wild, wild4],
    playableIds: ["rs", "r2", "w", "w4"],
    pendingPenalty: 0,
    nextPlayerHandCount: 1
  }), { cardId: "rs" });

  assert.deepEqual(unoBot.getUnoMove({
    hand: [wild4, card("r9b", "red", "number", 9)],
    playableIds: ["w4", "r9b"],
    pendingPenalty: 0,
    nextPlayerHandCount: 1
  }), { cardId: "w4", color: "red" });

  assert.equal(unoBot.pickColor([
    card("g1", "green", "number", 3),
    card("g2", "green", "number", 8),
    card("b1", "blue", "number", 1),
    card("b2", "blue", "number", 4)
  ]), "blue");

  const again = [];
  const state = {
    hand: [red9, red1],
    playableIds: ["r9", "r1"],
    pendingPenalty: 0,
    nextPlayerHandCount: 7
  };
  for (let i = 0; i < 20; i++) again.push(JSON.stringify(unoBot.getUnoMove(state)));
  assert.equal(new Set(again).size, 1);
});

test("legacy Dominoes bot still prefers the original placements", () => {
  const opening = dominoBot.legacyGetDominoMove({
    hand: [tile(6, 5), tile(5, 0), tile(6, 6), tile(1, 2)],
    validMoves: ["5-6", "0-5", "6-6", "1-2"].map((id) => ({ tileId: id, side: "center" })),
    leftEnd: null,
    rightEnd: null,
    chainLength: 0,
    teamMode: false
  });
  assert.deepEqual(opening, { tileId: "6-6", side: "center" });

  const suit = dominoBot.legacyGetDominoMove({
    hand: [tile(6, 0), tile(1, 1), tile(1, 2), tile(1, 3), tile(1, 4)],
    validMoves: [
      { tileId: "0-6", side: "left" },
      { tileId: "1-1", side: "right" },
      { tileId: "1-2", side: "right" },
      { tileId: "1-3", side: "right" },
      { tileId: "1-4", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 1,
    chainLength: 4,
    teamMode: false
  });
  assert.deepEqual(suit, { tileId: "1-1", side: "right" });

  const heavy = dominoBot.legacyGetDominoMove({
    hand: [tile(6, 5), tile(2, 0), tile(0, 1), tile(0, 3), tile(0, 4)],
    validMoves: [
      { tileId: "5-6", side: "left" },
      { tileId: "0-2", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 2,
    chainLength: 5,
    teamMode: true
  });
  assert.deepEqual(heavy, { tileId: "5-6", side: "left" });

  const tie = dominoBot.legacyGetDominoMove({
    hand: [tile(4, 6)],
    validMoves: [
      { tileId: "4-6", side: "left" },
      { tileId: "4-6", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 4,
    chainLength: 2,
    teamMode: false
  });
  assert.deepEqual(tie, { tileId: "4-6", side: "left" });
});

test("an empty UNO draw pile recycles discards under the top card", () => {
  const mounted = mountUno("RECYCLE");
  const { room, human } = mounted;
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("by", "yellow", "number", 8)];
  const buried = card("old", "blue", "number", 2);
  const wild = card("w", null, "wild");
  wild.chosenColor = "blue";
  wild.color = "blue";
  room.uno.discard = [buried, wild, card("top", "red", "number", 4)];
  room.uno.draw = [];

  human.handlers.unoDraw({ roomCode: "RECYCLE" });

  assert.equal(room.uno.discard[room.uno.discard.length - 1].id, "top");
  assert.equal(room.uno.hands.h1.some((c) => c.id === "old" || c.id === "w"), true);
  assert.equal(room.uno.draw.concat(room.uno.hands.h1).some((c) => c.id === "top"), false);
  const drawnWild = room.uno.hands.h1.find((c) => c.id === "w") || room.uno.draw.find((c) => c.id === "w");
  if (drawnWild) {
    assert.equal(drawnWild.color, null);
    assert.equal(drawnWild.chosenColor, undefined);
  }
  assert.notEqual(room.uno.currentTurn, undefined);
  uno.clearBotTimer(room);
});

test("a human with nothing to draw and no legal card passes once", () => {
  const { room, human, io } = mountUno("HEMPTY");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("by", "blue", "number", 8)];
  room.uno.draw = [];
  room.uno.discard = [card("top", "red", "number", 4)];

  human.handlers.unoDraw({ roomCode: "HEMPTY" });

  assert.equal(human.emitted.some((event) => event.name === "errorMessage" && event.data === "No cards left to draw."), true);
  assert.equal(room.uno.currentTurn, "b1");
  assert.equal(room.uno.turnsPlayed, 1);
  assert.equal(room.uno.hands.h1.length, 1);
  assert.equal(io.events.filter((event) => event.name === "unoState").length, 2);
  const before = room.uno.turnsPlayed;
  const states = io.events.length;
  human.handlers.unoDraw({ roomCode: "HEMPTY" });
  assert.equal(room.uno.turnsPlayed, before);
  assert.equal(room.uno.currentTurn, "b1");
  assert.equal(io.events.length, states);
  uno.clearBotTimer(room);
});

test("a human who can still play keeps the turn when nothing can be drawn", () => {
  const { room, human } = mountUno("HKEEP");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("hr", "red", "number", 9)];
  room.uno.hands.b1 = [card("by", "yellow", "number", 8)];
  room.uno.draw = [];
  room.uno.discard = [card("top", "red", "number", 4)];

  human.handlers.unoDraw({ roomCode: "HKEEP" });

  assert.equal(human.emitted.some((event) => event.name === "errorMessage" && event.data === "No cards left to draw."), true);
  assert.equal(room.uno.currentTurn, "h1");
  assert.equal(room.uno.turnsPlayed, 0);
  assert.equal(room.uno.hands.h1.map((c) => c.id).join(","), "hr");
  uno.clearBotTimer(room);
});

test("a bot passes once when the draw pile cannot be recycled", async () => {
  const { room, human } = mountUno("BEMPTY");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("by", "yellow", "number", 8)];
  room.uno.draw = [card("g1", "green", "number", 1)];
  room.uno.discard = [card("top", "red", "number", 4)];

  const { lines } = await withWarn(async () => {
    human.handlers.unoDraw({ roomCode: "BEMPTY" });
    await wait(40);
  });

  assert.equal(room.uno.currentTurn, "h1");
  assert.equal(room.uno.turnsPlayed, 2);
  assert.deepEqual(room.uno.hands.b1.map((c) => c.id), ["by"]);
  assert.equal(room.uno.hands.h1.some((c) => c.id === "g1"), true);
  assert.equal(lines.filter((line) => line.indexOf("No cards left to draw.") !== -1).length, 1);
  const mark = room.uno.turnsPlayed;
  await wait(40);
  assert.equal(room.uno.currentTurn, "h1");
  assert.equal(room.uno.turnsPlayed, mark);
});

test("a rejected bot play is logged and a single retry still finishes the turn", async () => {
  const { room, human, bot, io } = mountUno("RETRY");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("r2", "red", "number", 2), card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("r9", "red", "number", 9), card("by", "yellow", "number", 8)];
  const original = bot.handlers.unoPlayCard;
  let calls = 0;
  bot.handlers.unoPlayCard = (data) => {
    calls += 1;
    if (calls === 1) {
      bot.emit("errorMessage", "injected failure");
      return;
    }
    return original(data);
  };

  const { lines } = await withWarn(async () => {
    human.handlers.unoPlayCard({ roomCode: "RETRY", cardId: "r2" });
    await wait(80);
  });

  assert.equal(calls, 2);
  assert.equal(room.uno.discard[room.uno.discard.length - 1].id, "r9");
  assert.equal(room.uno.currentTurn, "h1");
  assert.equal(room.uno.hands.b1.some((c) => c.id === "r9"), false);
  assert.equal(io.events.filter((event) => event.name === "unoPlayed" && event.data.card.id === "r9").length, 1);
  assert.equal(lines.filter((line) => line.indexOf("stopped retry") !== -1).length, 0);
  assert.ok(lines.some((line) => line.indexOf("retrying turn") !== -1 && line.indexOf("game=uno") !== -1));
});

test("a stale UNO bot turn does not play and is logged", async () => {
  const { room, human, bot } = mountUno("STALE");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("r2", "red", "number", 2), card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("r9", "red", "number", 9), card("by", "yellow", "number", 8)];

  const direct = await withWarn(async () => {
    bot.handlers.unoPlayCard({ roomCode: "STALE", cardId: "r9" });
  });
  assert.equal(room.uno.currentTurn, "h1");
  assert.equal(room.uno.hands.b1.length, 2);
  assert.ok(direct.lines.some((line) =>
    line.indexOf("action rejected") !== -1 &&
    line.indexOf("game=uno") !== -1 &&
    line.indexOf("room=STALE") !== -1 &&
    line.indexOf("bot=b1") !== -1 &&
    line.indexOf("action=unoPlayCard") !== -1 &&
    line.indexOf("It is not your turn.") !== -1 &&
    line.indexOf("hands") === -1
  ));

  const scheduled = await withWarn(async () => {
    human.handlers.unoPlayCard({ roomCode: "STALE", cardId: "r2" });
    room.uno.currentTurn = "h1";
    room.uno.turnIndex = 0;
    const discard = room.uno.discard.length;
    await wait(40);
    assert.equal(room.uno.discard.length, discard);
    assert.equal(room.uno.hands.b1.length, 2);
    assert.equal(room.uno.currentTurn, "h1");
  });
  assert.ok(scheduled.lines.some((line) => line.indexOf("stale turn ignored") !== -1 && line.indexOf("game=uno") !== -1));
});

test("a cleared or deleted UNO room ignores a pending bot timer", async () => {
  const cleared = mountUno("CLEAR");
  cleared.room.uno = blankUno("h1", 0);
  cleared.room.uno.hands.h1 = [card("r2", "red", "number", 2), card("hy", "yellow", "number", 9)];
  cleared.room.uno.hands.b1 = [card("r9", "red", "number", 9), card("by", "yellow", "number", 8)];
  cleared.human.handlers.unoPlayCard({ roomCode: "CLEAR", cardId: "r2" });
  assert.ok(cleared.room.unoBotTimer);
  uno.clearBotTimer(cleared.room);
  cleared.room.uno.over = true;
  await wait(40);
  assert.equal(cleared.room.uno.hands.b1.length, 2);

  const gone = mountUno("GONE");
  gone.room.uno = blankUno("h1", 0);
  gone.room.uno.hands.h1 = [card("r2", "red", "number", 2), card("hy", "yellow", "number", 9)];
  gone.room.uno.hands.b1 = [card("r9", "red", "number", 9), card("by", "yellow", "number", 8)];
  const { lines } = await withWarn(async () => {
    gone.human.handlers.unoPlayCard({ roomCode: "GONE", cardId: "r2" });
    delete gone.rooms.GONE;
    await wait(40);
  });
  assert.equal(gone.room.uno.hands.b1.length, 2);
  assert.equal(gone.room.uno.discard[gone.room.uno.discard.length - 1].id, "r2");
  assert.ok(lines.some((line) => line.indexOf("stale room ignored") !== -1 && line.indexOf("room=GONE") !== -1));
});

test("an ended UNO game does not accept the pending bot play", async () => {
  const { room, human } = mountUno("OVER");
  room.uno = blankUno("h1", 0);
  room.uno.hands.h1 = [card("r2", "red", "number", 2), card("hy", "yellow", "number", 9)];
  room.uno.hands.b1 = [card("r9", "red", "number", 9), card("by", "yellow", "number", 8)];
  human.handlers.unoPlayCard({ roomCode: "OVER", cardId: "r2" });
  room.uno.over = true;
  await wait(40);
  assert.equal(room.uno.hands.b1.length, 2);
  assert.equal(room.uno.discard[room.uno.discard.length - 1].id, "r2");
});

test("a stale Dominoes bot play is logged and does not place a tile", async () => {
  const { room, bot } = mountDomino("DSTALE");
  room.domino = blankDomino();
  room.domino.hands.b1 = [tile(6, 6)];
  room.domino.currentTurn = "h1";
  const { lines } = await withWarn(async () => {
    bot.handlers.dominoPlayTile({ roomCode: "DSTALE", tileId: "6-6", side: "left" });
  });
  assert.equal(room.domino.chain.length, 1);
  assert.equal(room.domino.hands.b1.length, 1);
  assert.ok(lines.some((line) =>
    line.indexOf("action rejected") !== -1 &&
    line.indexOf("game=dominoes") !== -1 &&
    line.indexOf("room=DSTALE") !== -1 &&
    line.indexOf("bot=b1") !== -1 &&
    line.indexOf("action=dominoPlayTile") !== -1 &&
    line.indexOf("It is not your turn.") !== -1
  ));
});

test("a pending Dominoes bot does not play after the timer is cleared or the room is gone", async () => {
  const cleared = mountDomino("DCLEAR");
  cleared.room.domino = blankDomino();
  cleared.room.domino.hands.h1 = [tile(2, 3), tile(0, 0)];
  cleared.room.domino.hands.b1 = [tile(3, 6)];
  cleared.human.handlers.dominoPlayTile({ roomCode: "DCLEAR", tileId: "2-3", side: "right" });
  assert.equal(cleared.room.domino.currentTurn, "b1");
  assert.ok(cleared.room.dominoBotTimer);
  domino.clearBotTimer(cleared.room);
  await wait(40);
  assert.equal(cleared.room.domino.chain.length, 2);
  assert.equal(cleared.room.domino.hands.b1.length, 1);

  const gone = mountDomino("DGONE");
  gone.room.domino = blankDomino();
  gone.room.domino.hands.h1 = [tile(2, 3), tile(0, 0)];
  gone.room.domino.hands.b1 = [tile(3, 6)];
  const { lines } = await withWarn(async () => {
    gone.human.handlers.dominoPlayTile({ roomCode: "DGONE", tileId: "2-3", side: "right" });
    gone.room.domino.over = true;
    delete gone.rooms.DGONE;
    await wait(40);
  });
  assert.equal(gone.room.domino.chain.length, 2);
  assert.equal(gone.room.domino.hands.b1.length, 1);
  assert.ok(lines.some((line) => line.indexOf("stale room ignored") !== -1 && line.indexOf("game=dominoes") !== -1));
});

test("a Dominoes bot plays one tile when its timer runs twice worth of callbacks", async () => {
  const { room, human, bot, io } = mountDomino("DONCE");
  room.domino = blankDomino();
  room.domino.hands.h1 = [tile(2, 3), tile(0, 0)];
  room.domino.hands.b1 = [tile(3, 6)];
  human.handlers.dominoPlayTile({ roomCode: "DONCE", tileId: "2-3", side: "right" });
  await wait(40);
  assert.equal(room.domino.chain.length, 3);
  assert.equal(room.domino.chain[room.domino.chain.length - 1].id, "3-6");
  assert.equal(io.events.filter((event) => event.name === "dominoPlayed" && event.data.tile.id === "3-6").length, 1);

  const { lines } = await withWarn(async () => {
    bot.handlers.dominoPlayTile({ roomCode: "DONCE", tileId: "3-6", side: "right" });
  });
  assert.equal(room.domino.chain.length, 3);
  assert.ok(lines.some((line) => line.indexOf("action rejected") !== -1));
});

test("an empty Dominoes boneyard passes and blocks instead of stalling", () => {
  const { room, bot, io } = mountDomino("DBONE");
  room.domino = blankDomino();
  room.domino.currentTurn = "b1";
  room.domino.turnIndex = 1;
  room.domino.hands.h1 = [tile(0, 0)];
  room.domino.hands.b1 = [tile(5, 5)];
  room.domino.boneyard = [];

  bot.handlers.dominoDraw({ roomCode: "DBONE" });

  assert.equal(room.domino.over, true);
  assert.equal(room.domino.winReason, "blocked");
  assert.equal(room.domino.chain.length, 1);
  assert.equal(room.domino.hands.b1.length, 1);
  assert.ok(io.events.filter((event) => event.name === "dominoPassed").length >= 2);
  const chain = room.domino.chain.length;
  bot.handlers.dominoDraw({ roomCode: "DBONE" });
  assert.equal(room.domino.chain.length, chain);
  assert.equal(room.domino.over, true);
});

});
