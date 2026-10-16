"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const domino = require("./domino");
const dominoBot = require("./bots/dominoBot");
const { getDominoMove } = require("./bots/domino/ai");
const { placeTile, listValidMoves } = domino;
const client = require("../assets/domino-inspect");

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function seat(id, count, team) {
  return { id: id, handCount: count, team: team };
}

function explain(state, options) {
  return getDominoMove(state, Object.assign({ explain: true, limits: { samples: 0, maxMs: 0 } }, options || {}));
}

function table(extra) {
  return Object.assign({
    selfId: "bot",
    hand: [tile(1, 2), tile(2, 6)],
    validMoves: [
      { tileId: "1-2", side: "left" },
      { tileId: "2-6", side: "right" }
    ],
    leftEnd: 1,
    rightEnd: 6,
    chain: [tile(1, 6)],
    players: [
      seat("bot", 2, "A"),
      seat("opp", 4, "B"),
      seat("mate", 3, "A"),
      seat("opp2", 4, "B")
    ],
    teamMode: true,
    teamA: ["bot", "mate"],
    teamB: ["opp", "opp2"],
    log: [],
    boneyardCount: 0
  }, extra || {});
}

function match() {
  return {
    teams: {
      A: { roundsWon: 0, score: 0 },
      B: { roundsWon: 0, score: 0 }
    },
    players: {}
  };
}

function roomFor(botHand, humanHand, otherHand) {
  return {
    gameMode: "dominoes",
    players: [
      { id: "human", name: "H", isBot: false },
      { id: "botA", name: "A", isBot: true },
      { id: "botB", name: "B", isBot: true },
      { id: "botC", name: "C", isBot: true }
    ],
    dominoMatch: match(),
    domino: {
      hands: {
        human: humanHand,
        botA: botHand,
        botB: otherHand,
        botC: [tile(0, 0)]
      },
      boneyard: [],
      chain: [tile(1, 6)],
      leftEnd: 1,
      rightEnd: 6,
      currentTurn: "botA",
      mustPlayId: null,
      firstRound: false,
      consecutivePasses: 0,
      over: false,
      scores: { human: 0 },
      teamScores: { A: 3, B: 4 },
      teamMode: true,
      teamA: ["human", "botB"],
      teamB: ["botA", "botC"],
      publicLog: [],
      winnerId: null
    }
  };
}

function socket(id) {
  const handlers = {};
  const emitted = [];
  return {
    id: id,
    handlers: handlers,
    emitted: emitted,
    on(name, fn) { handlers[name] = fn; },
    emit(name, data) { emitted.push({ name: name, data: data }); },
    join() {},
    leave() {}
  };
}

function io() {
  return { to() { return { emit() {} }; } };
}

test("room 1111 opens, switches, and closes the inspector without a game action", () => {
  assert.deepEqual(client.inspectClick("1111", { id: "botA", isBot: true }, null), { action: "open", botId: "botA" });
  assert.deepEqual(client.inspectClick(" 1111 ", { id: "botB", isBot: true }, "botA"), { action: "open", botId: "botB" });
  assert.equal(client.inspectClick("1111", { id: "botA", isBot: true }, "botA").action, "close");
  assert.equal(client.inspectClick("1111", { id: "human", isBot: false }, null).action, "none");

  const room = roomFor([tile(1, 2), tile(2, 6)], [tile(3, 4)], [tile(1, 4)]);
  const before = JSON.stringify(room.domino);
  const human = socket("human");
  const rooms = { "1111": room };
  domino.registerSocket(human, io(), rooms);
  human.handlers.dominoInspect({ roomCode: "1111", botId: "botA", requestId: 1 });
  human.handlers.dominoInspect({ roomCode: "1111", botId: "botB", requestId: 2 });
  assert.equal(JSON.stringify(room.domino), before);
  assert.equal(human.emitted.length, 2);
  assert.equal(human.emitted[0].data.ok, true);
  assert.equal(human.emitted[0].data.snapshot.botId, "botA");
  assert.equal(human.emitted[1].data.snapshot.botId, "botB");
  assert.equal(human.emitted[0].data.snapshot.selected.tileId, domino.decideBotMove(room, "1111", "botA").move.tileId);
  assert.notEqual(human.emitted[0].data.snapshot.selected.conditional, true);
  assert.equal(human.emitted[1].data.snapshot.selected.conditional, true);
});

test("other rooms and a spoofed room code do not return a diagnostic snapshot", () => {
  assert.equal(client.inspectClick("ABCD", { id: "botA", isBot: true }, null).action, "none");
  assert.equal(client.inspectClick("1112", { id: "botA", isBot: true }, null).action, "none");

  const secret = roomFor([tile(1, 2)], [tile(3, 4)], [tile(5, 5)]);
  const ordinary = roomFor([tile(1, 3)], [tile(4, 4)], [tile(2, 2)]);
  ordinary.players[0].id = "outsider";
  ordinary.domino.hands.outsider = ordinary.domino.hands.human;
  delete ordinary.domino.hands.human;
  ordinary.domino.currentTurn = "outsider";
  const outsider = socket("outsider");
  const rooms = { "1111": secret, ABCD: ordinary };
  domino.registerSocket(outsider, io(), rooms);
  outsider.handlers.dominoInspect({ roomCode: "1111", botId: "botA", requestId: 4 });
  outsider.handlers.dominoInspect({ roomCode: "ABCD", botId: "botA", requestId: 5 });
  assert.equal(outsider.emitted[0].data.ok, false);
  assert.equal(outsider.emitted[1].data.ok, false);
  const text = JSON.stringify(outsider.emitted);
  assert.equal(text.includes("1-2"), false);
  assert.equal(text.includes("5-5"), false);
  assert.equal(text.includes("snapshot"), false);
  assert.equal(ordinary.dominoDecisions, undefined);
});

test("the explained move is the move the bot will play, using only its hand", () => {
  const state = table();
  const plain = getDominoMove(state, { seed: 7, limits: { samples: 0, maxMs: 0 } });
  const explained = explain(state, { seed: 7 });
  assert.equal(explained.tileId, plain.tileId);
  assert.equal(explained.side, plain.side);
  assert.equal(explained.diagnostics.selected.tileId, plain.tileId);
  assert.equal(explained.diagnostics.selected.side, plain.side);

  const handIds = new Set(state.hand.map((item) => item.id));
  const snapshot = explained.diagnostics;
  assert.ok(handIds.has(snapshot.plan.selected.tileId));
  let hand = state.hand.map((item) => Object.assign({}, item));
  let left = state.leftEnd;
  let right = state.rightEnd;
  let chain = state.chain.map((item) => Object.assign({}, item));
  const steps = [snapshot.plan.selected].concat(snapshot.plan.continuation || []);
  steps.forEach((step) => {
    assert.equal(handIds.has(step.tileId), true);
    const legal = listValidMoves(hand, left, right, chain.length, null);
    assert.equal(legal.some((move) => move.tileId === step.tileId && move.side === step.side), true);
    const board = { chain: chain, leftEnd: left, rightEnd: right, mustPlayId: null };
    const tile = hand.find((item) => item.id === step.tileId);
    assert.ok(placeTile(board, tile, step.side));
    hand = hand.filter((item) => item.id !== step.tileId);
    left = board.leftEnd;
    right = board.rightEnd;
    chain = board.chain;
  });
  (snapshot.plan.continuation || []).forEach((step) => {
    assert.equal(step.conditional, true);
  });

  const room = roomFor(state.hand.map((item) => Object.assign({}, item)), [tile(3, 4)], [tile(5, 5)]);
  const first = domino.decideBotMove(room, "1111", "botA");
  const original = dominoBot.getDominoMove;
  let calls = 0;
  dominoBot.getDominoMove = () => {
    calls += 1;
    return { tileId: "0-0", side: "left" };
  };
  try {
    const second = domino.decideBotMove(room, "1111", "botA");
    assert.equal(calls, 0);
    assert.deepEqual(second.move, first.move);
    assert.equal(second.snapshot.selected.tileId, first.move.tileId);
  } finally {
    dominoBot.getDominoMove = original;
  }
});

test("a pass, a new end, and a new decision change the snapshot", () => {
  const before = explain(table());
  const passed = explain(table({
    log: [{ type: "pass", playerId: "opp", leftEnd: 1, rightEnd: 6 }]
  }));
  assert.notEqual(before.diagnostics.positionKey, passed.diagnostics.positionKey);
  const opp = passed.diagnostics.opponents.opponents.find((row) => row.playerId === "opp");
  assert.ok(opp.provenVoids.some((note) => note.pip === 1 && note.confidence === "proven"));
  assert.equal(opp.suspectedWeak.length, 0);

  const weakened = explain(table({
    log: [
      { type: "pass", playerId: "opp", leftEnd: 4, rightEnd: 4 },
      { type: "draw", playerId: "opp" }
    ],
    leftEnd: 2,
    rightEnd: 6,
    validMoves: [{ tileId: "2-6", side: "right" }]
  }));
  const weakOpp = weakened.diagnostics.opponents.opponents.find((row) => row.playerId === "opp");
  assert.equal(weakOpp.provenVoids.some((note) => note.pip === 4), false);
  assert.ok(weakOpp.suspectedWeak.some((note) => note.pip === 4 && note.confidence === "probabilistic"));

  const finished = passed.diagnostics;
  let panel = client.panelFromSnapshot("bot", finished);
  assert.equal(panel.status, "ready");
  assert.equal(panel.snapshot.selectedMove.tileId, passed.tileId);
  ["dominoPlayed", "dominoPassed", "dominoDrawn", "dominoState"].forEach((eventName) => {
    panel = client.onTableEvent(panel, eventName);
    assert.equal(panel.status, "evaluating");
    assert.equal(panel.snapshot.selectedMove.tileId, passed.tileId);
  });
  panel = client.completeEvaluation(panel, before.diagnostics);
  assert.equal(panel.status, "ready");
  assert.equal(panel.snapshot.selectedMove.tileId, before.tileId);
  assert.notEqual(client.statusText(panel), "Evaluating");
});

test("own-finish priority is explained from the real scores and hidden hands stay hidden", () => {
  const state = table({
    hand: [tile(0, 1), tile(5, 5)],
    validMoves: [
      { tileId: "0-1", side: "left" },
      { tileId: "5-5", side: "right" }
    ],
    leftEnd: 0,
    rightEnd: 5,
    chain: [tile(0, 5), tile(0, 3)],
    log: [
      { type: "play", playerId: "mate", tile: tile(1, 1), side: "left", leftEnd: 1, rightEnd: 5 },
      { type: "play", playerId: "mate", tile: tile(1, 4), side: "left", leftEnd: 4, rightEnd: 5 }
    ]
  });
  const move = explain(state);
  const comparison = move.diagnostics.comparison;
  assert.equal(comparison.kind, "own-finish");
  assert.match(comparison.text, /Prioritizing my own finish/);
  assert.match(comparison.text, /unavailable/);
  assert.equal(move.diagnostics.samples, 0);
  assert.equal(move.diagnostics.selected.tileId, move.tileId);

  const secret = "9-9";
  const leaked = explain(Object.assign({}, state, { otherHands: [{ id: secret, a: 9, b: 9 }] }));
  const text = JSON.stringify(leaked.diagnostics);
  assert.equal(text.includes(secret), false);
  const room = roomFor([tile(1, 2), tile(2, 6)], [tile(3, 4)], [tile(5, 5)]);
  const human = socket("human");
  domino.registerSocket(human, io(), { "1111": room });
  human.handlers.dominoInspect({ roomCode: "1111", botId: "botA", requestId: 8 });
  const payload = JSON.stringify(human.emitted[0].data);
  assert.equal(payload.includes("3-4"), false);
  assert.equal(payload.includes("5-5"), false);
  assert.equal(payload.includes("0-0"), false);
  assert.equal(payload.includes("1-2") || payload.includes("2-6"), true);

  const model = client.renderModel(null);
  assert.equal(model.sections.length >= 5, true);
  assert.notEqual(model.status, "Evaluating");
  assert.equal(client.renderModel({}).sections[0].lines.some((line) => line.includes("unavailable")), true);
  const broken = client.renderModel({ selected: null, components: null, plan: null, comparison: {} });
  assert.equal(broken.sections.some((section) => section.heading === "Why this move was selected"), true);

  const failed = client.failEvaluation(client.panelFromSnapshot("bot", move.diagnostics), "search failed");
  assert.equal(failed.status, "error");
  assert.match(client.statusText(failed), /search failed/);
  assert.equal(failed.snapshot.selectedMove.tileId, move.tileId);
  const empty = client.failEvaluation({ open: true, botId: "bot", snapshot: null }, "The decision snapshot was not received.");
  assert.equal(empty.status, "error");
  assert.notEqual(empty.status, "evaluating");
  const reopened = client.panelFromSnapshot("bot", move.diagnostics);
  assert.equal(reopened.status, "ready");
  assert.equal(reopened.snapshot.selectedMove.tileId, move.diagnostics.selectedMove.tileId);
});

test("room 1111 state carries the finished decision and other rooms do not", () => {
  const room = roomFor([tile(1, 2), tile(2, 6)], [tile(3, 4)], [tile(1, 4)]);
  assert.deepEqual(domino.inspectStateExtra(room, "ABCD"), {});
  const extra = domino.inspectStateExtra(room, "1111");
  const decided = domino.decideBotMove(room, "1111", "botA");
  const published = extra.botDiagnostics.botA;
  assert.equal(published.status, "ready");
  assert.equal(published.selectedMove.tileId, decided.move.tileId);
  assert.equal(published.selectedMove.side, decided.move.side);
  assert.ok(published.legalMoves.length >= 1);
  published.candidateEvaluations.forEach((row) => {
    assert.equal(published.legalMoves.some((move) => move.tileId === row.tileId && move.side === row.side), true);
  });
  const text = JSON.stringify(published);
  assert.equal(text.includes("3-4"), false);
  assert.equal(text.includes("0-0"), false);
  const other = client.panelFromSnapshot("botB", extra.botDiagnostics.botB);
  assert.equal(other.snapshot.playerId, "botB");
  assert.notEqual(other.snapshot.selectedMove && other.snapshot.selectedMove.tileId, published.selectedMove.tileId);
  const again = client.panelFromSnapshot("botA", extra.botDiagnostics.botA);
  assert.equal(again.status, "ready");
  assert.equal(again.snapshot.reasoning.length > 0, true);
});


test("room 1111 lobby update test returns the current roster without mutating the game", () => {
  const room = roomFor([tile(1, 2)], [tile(3, 4)], [tile(1, 4)]);
  room.maxPlayers = 4;
  const before = JSON.stringify(room.domino);
  const human = socket("human");
  const rooms = { "1111": room };
  domino.registerSocket(human, io(), rooms);

  human.handlers.dominoLobbyUpdateTest({ roomCode: "1111", requestId: 71 });
  const update = human.emitted.find((item) => item.name === "dominoLobbyUpdate");
  const result = human.emitted.find((item) => item.name === "dominoLobbyUpdateTestResult");
  assert.ok(update);
  assert.equal(update.data.room, "1111");
  assert.equal(update.data.maxPlayers, 4);
  assert.equal(update.data.players.length, 4);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.requestId, 71);
  assert.equal(JSON.stringify(room.domino), before);

  human.handlers.dominoLobbyUpdateTest({ roomCode: "ABCD", requestId: 72 });
  const rejected = human.emitted.filter((item) => item.name === "dominoLobbyUpdateTestResult").at(-1);
  assert.equal(rejected.data.ok, false);
  assert.equal(rejected.data.requestId, 72);
});
