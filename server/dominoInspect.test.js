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
  assert.ok(room.dominoAiReview.decisions.length >= 1);
  assert.equal(room.dominoAiReview.decisions.every((row) => row.botId === "botA"), true);
  assert.equal(room.dominoAiReview.decisions.some((row) => row.botId === "botB" && row.action === "pass"), false);
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
  const payload = human.emitted[0].data;
  assert.equal(payload.snapshot.hand, undefined, "the live snapshot does not expose a raw hand array");
  assert.ok(payload.snapshot.fullMatchReview.decisionRecords[0].actualHandsAtDecision.human
    .some((item) => item.id === "3-4"));
  assert.ok(payload.snapshot.fullMatchReview.decisionRecords[0].actualHandsAtDecision.botB
    .some((item) => item.id === "5-5"));
  assert.ok(payload.snapshot.fullMatchReview.decisionRecords[0].actualHandsAtDecision.botC
    .some((item) => item.id === "0-0"));
  assert.ok(payload.snapshot.candidateEvaluations.some((row) => row.tileId === "1-2" || row.tileId === "2-6"),
    "the inspector response must preserve candidate tile identities");

  const model = client.renderModel(null);
  assert.equal(model.sections.length >= 5, true);
  assert.notEqual(model.status, "Evaluating");
  assert.equal(model.sections.some((section) => section.heading === "Why this move"), true);
  const blank = client.renderModel({});
  assert.equal(blank.sections.some((section) => section.lines.join(" ").includes("No move has been selected")), true);
  const broken = client.renderModel({ selected: null, components: null, plan: null, comparison: {} });
  assert.equal(broken.sections.some((section) => section.heading === "Why this move"), true);
  assert.equal(broken.sections.some((section) => section.advanced), true);
  const summary = client.planView(move.diagnostics);
  assert.equal(summary.strategy.label, "Playing for myself");
  assert.match(summary.sections.find((section) => section.heading === "What I am looking for").lines.join(" "), /own finish/);
  assert.match(summary.sections.find((section) => section.heading === "Next move").lines[0], /\[5\|5\]|\[0\|1\]/);
  assert.equal(summary.sections.find((section) => section.heading === "Teammate").lines[0].includes("Helping teammate: No"), true);
  const thinking = client.planView(move.diagnostics, { status: "evaluating" });
  assert.equal(thinking.strategy.label, "Thinking");
  assert.match(thinking.sections.find((section) => section.heading === "Last completed plan").lines[0], /Playing for myself/);
  assert.match(thinking.sections.find((section) => section.heading === "Next move").lines[0], /Next move:/);
  const errored = client.planView(null, { status: "error", error: "search failed" });
  assert.match(errored.sections.find((section) => section.heading === "Next move").lines[0], /search failed/);

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

test("simple strategy labels follow the recorded decision", () => {
  function labeled(label, extra) {
    return client.planView(Object.assign({
      available: true,
      status: "ready",
      mode: { label: label, reason: "recorded" },
      selected: {
        tile: { id: "4-6", a: 4, b: 6 },
        tileId: "4-6",
        side: "right",
        parts: extra && extra.parts || {}
      },
      leftEnd: 1,
      rightEnd: 6,
      plan: { continuation: [] },
      partnership: extra && extra.partnership || { available: true, preserves: [], provenVoids: [] },
      opponents: extra && extra.opponents || { opponents: [] },
      comparison: extra && extra.comparison || { kind: "aligned", text: "aligned" }
    }, extra && extra.snap || {}));
  }
  assert.equal(labeled("Supporting teammate", {
    partnership: { available: true, preserves: [4], provenVoids: [], helpsEmpty: true },
    parts: { mateReply: 3 }
  }).strategy.label, "Helping my teammate");
  const helping = labeled("Supporting teammate", {
    partnership: { available: true, preserves: [4], provenVoids: [{ pip: 2 }, { pip: 5 }], helpsEmpty: true },
    parts: { mateReply: 3 }
  });
  assert.match(helping.sections.find((section) => section.heading === "Teammate").lines[0], /Round commitment: Yes/);
  assert.match(helping.sections.find((section) => section.heading === "What I am looking for").lines.join(" "), /teammate/i);
  const blocking = labeled("Blocking opponents", {
    opponents: { opponents: [{ provenVoids: [{ pip: 4 }], suspectedWeak: [] }], forcesPass: true },
    parts: { forcePass: 2 }
  });
  assert.equal(blocking.strategy.label, "Blocking opponents");
  assert.match(blocking.sections.find((section) => section.heading === "Opponents").lines.join(" "), /Passed on 4/);
  assert.match(blocking.sections.find((section) => section.heading === "What happens next").lines.join(" "), /one move at a time/);
  const missing = client.planView({ status: "ready" });
  assert.equal(missing.sections.some((section) => section.heading === "Advanced details"), true);
  assert.doesNotThrow(() => client.renderModel({ components: null, plan: null, comparison: null, partnership: null }));
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
    assert.ok(row.tileId, "candidate evaluation must preserve tile identity");
    assert.ok(row.tile && row.tile.a != null && row.tile.b != null,
      "candidate evaluation must preserve the acting bot's tile values");
  });
  assert.equal(extra.fullMatchReview.status, "match-in-progress");
  assert.equal(extra.fullMatchReview.decisionRecords.length, 1,
    "match review must contain one shared trace, not a separate trace per bot");
  assert.equal(extra.fullMatchReview.decisionRecords[0].botId, "botA");
  assert.ok(extra.fullMatchReview.decisionRecords[0].actualHandsAtDecision.botA,
    "the match review must retain ground-truth hands for later hindsight analysis");
  assert.ok(extra.fullMatchReview.decisionRecords[0].actualHandsAtDecision.human);
  assert.equal(extra.fullMatchReview.rounds[0].status, "in-progress");
  const exported = client.buildReviewExport(published, "2026-10-21T00:00:00.000Z");
  assert.equal(exported.scope, "one-match-review");
  assert.equal(exported.matchReview.decisionRecords.length, 1);
  assert.equal(exported.trainingData.recordedPositions, 1);
  assert.equal(published.hand, undefined, "the live bot snapshot must not expose a raw hand array");
  assert.equal(
    published.fullMatchReview.decisionRecords[0].actualHandsAtDecision.human[0].id,
    "3-4",
    "the dedicated match review must retain actual hands for hindsight analysis"
  );
  assert.equal(
    published.fullMatchReview.decisionRecords[0].actualHandsAtDecision.botC[0].id,
    "0-0"
  );
  const other = client.panelFromSnapshot("botB", extra.botDiagnostics.botB);
  assert.equal(other.snapshot.playerId, "botB");
  assert.notEqual(other.snapshot.selectedMove && other.snapshot.selectedMove.tileId, published.selectedMove.tileId);
  const again = client.panelFromSnapshot("botA", extra.botDiagnostics.botA);
  assert.equal(again.status, "ready");
  assert.equal(again.snapshot.reasoning.length > 0, true);
});
