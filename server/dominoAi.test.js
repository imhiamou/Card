"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");
const dominoBot = require("./bots/dominoBot");
const { buildBeliefs } = require("./bots/domino/beliefs");
const { sampleAllocation, allocationIds, mulberry32 } = require("./bots/domino/sample");
const { canPlayProbability, scoreMove } = require("./bots/domino/eval");
const { mergeWeights } = require("./bots/domino/weights");
const { normalize } = require("./bots/domino/ai");
const sim = require("./bots/dominoSim");

const quiet = { limits: { samples: 0, maxMs: 0 } };

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function playEvent(id, a, b, side, left, right) {
  return {
    type: "play",
    playerId: id,
    tile: tile(a, b),
    side: side,
    leftEndBefore: null,
    rightEndBefore: null,
    leftEnd: left,
    rightEnd: right
  };
}

function seats(counts) {
  return [
    { id: "me", handCount: counts[0], team: "A" },
    { id: "opp", handCount: counts[1], team: "B" },
    { id: "mate", handCount: counts[2], team: "A" },
    { id: "far", handCount: counts[3], team: "B" }
  ];
}

function chainExcept(ids) {
  const skip = new Set(ids);
  return domino.buildDoubleSixSet()
    .filter((item) => !skip.has(item.id))
    .map((item) => ({ id: item.id, a: item.a, b: item.b }));
}

function decide(state, options) {
  return dominoBot.getDominoMove(state, Object.assign({ explain: true }, quiet, options || {}));
}

function basePlayers() {
  return {
    selfId: "me",
    players: seats([4, 4, 4, 4]),
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: []
  };
}

test("pass records a hard void and a later draw demotes it", () => {
  const passed = buildBeliefs({
    players: [{ id: "opp", handCount: 4 }],
    log: [{ type: "pass", playerId: "opp", leftEnd: 2, rightEnd: 5 }]
  });
  assert.deepEqual(passed.opp.knownImpossibleNumbers, [2, 5]);
  assert.equal(passed.opp.passHistory[0].invalidated, false);
  assert.equal(passed.opp.suspectedWeakNumbers[2], undefined);
  assert.deepEqual(passed.opp.recent[0], { type: "pass", ends: [2, 5] });

  const drawn = buildBeliefs({
    players: [{ id: "opp", handCount: 5 }],
    log: [
      { type: "pass", playerId: "opp", leftEnd: 2, rightEnd: 5 },
      { type: "draw", playerId: "opp" }
    ]
  });
  assert.deepEqual(drawn.opp.knownImpossibleNumbers, []);
  assert.equal(drawn.opp.passHistory[0].invalidated, true);
  assert.ok(drawn.opp.suspectedWeakNumbers[2] >= 1);
  assert.ok(drawn.opp.suspectedWeakNumbers[5] >= 1);
});

test("one played tile is not a strength and a repeated number is", () => {
  const once = buildBeliefs({
    players: [{ id: "mate", handCount: 5 }],
    log: [playEvent("mate", 4, 5, "right", 6, 4)]
  });
  assert.deepEqual(once.mate.suspectedStrongNumbers, {});
  assert.ok(once.mate.numberSupportScores[4] > 0);
  assert.ok(once.mate.numberSupportScores[4] < 2);

  const twice = buildBeliefs({
    players: [{ id: "mate", handCount: 4 }],
    log: [
      playEvent("mate", 4, 5, "right", 6, 4),
      playEvent("mate", 4, 3, "left", 4, 2)
    ]
  });
  assert.ok(twice.mate.suspectedStrongNumbers[4] > 0);
  assert.equal(twice.mate.suspectedStrongNumbers[5], undefined);
  assert.equal(twice.mate.suspectedStrongNumbers[3], undefined);
  assert.ok(twice.mate.numberSupportConfidence[4] > twice.mate.numberSupportConfidence[5]);
});

test("a new round log drops the previous deal's voids", () => {
  const previous = buildBeliefs({
    players: [{ id: "opp", handCount: 3 }],
    log: [{ type: "pass", playerId: "opp", leftEnd: 4, rightEnd: 4 }]
  });
  assert.deepEqual(previous.opp.knownImpossibleNumbers, [4]);
  const next = buildBeliefs({
    players: [{ id: "opp", handCount: 7 }],
    log: []
  });
  assert.deepEqual(next.opp.knownImpossibleNumbers, []);
  assert.equal(next.opp.remainingTileCount, 7);
});

test("sampler deals a partition that respects passes and refuses a bad count", () => {
  const hand = [tile(1, 1), tile(1, 4)];
  const unseenIds = ["1-2", "1-3", "6-6", "0-0", "2-2", "3-3"];
  const state = Object.assign(basePlayers(), {
    hand: hand,
    validMoves: [
      { tileId: "1-1", side: "left" },
      { tileId: "1-4", side: "left" }
    ],
    leftEnd: 1,
    rightEnd: 2,
    chain: chainExcept(hand.map((item) => item.id).concat(unseenIds)),
    players: seats([2, 2, 2, 2]),
    log: [{ type: "pass", playerId: "opp", leftEnd: 1, rightEnd: 6 }]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  const rng = mulberry32(11);
  for (let i = 0; i < 12; i++) {
    const dealt = sampleAllocation(view, beliefs, rng);
    assert.ok(dealt.allocation, dealt.conflict);
    const ids = allocationIds(dealt.allocation);
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, 6);
    hand.forEach((item) => assert.equal(ids.indexOf(item.id), -1));
    assert.equal(dealt.allocation.opp.length, 2);
    dealt.allocation.opp.forEach((item) => {
      assert.notEqual(item.a, 1);
      assert.notEqual(item.b, 1);
      assert.notEqual(item.a, 6);
      assert.notEqual(item.b, 6);
    });
  }

  const broken = normalize(Object.assign({}, state, {
    players: seats([2, 9, 2, 2])
  }));
  const failed = sampleAllocation(broken, buildBeliefs(broken), mulberry32(1));
  assert.equal(failed.allocation, null);
  assert.match(failed.conflict, /counts|only|no deal/);
  const fallback = decide(Object.assign({}, state, { players: seats([2, 9, 2, 2]) }), {
    limits: { samples: 3, maxMs: 0, maxNodes: 200 }
  });
  assert.ok(fallback.diagnostics.samples === 0 || fallback.diagnostics.conflicts > 0);
  assert.ok(state.validMoves.some((move) => move.tileId === fallback.tileId && move.side === fallback.side));
});

test("decision inputs ignore hidden hands and stay deterministic", () => {
  const state = Object.assign(basePlayers(), {
    hand: [tile(6, 5), tile(2, 0), tile(0, 1), tile(0, 3), tile(0, 4)],
    validMoves: [
      { tileId: "5-6", side: "left" },
      { tileId: "0-2", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 2,
    chainLength: 5
  });
  const plain = dominoBot.getDominoMove(state, quiet);
  const leaked = dominoBot.getDominoMove(Object.assign({}, state, {
    hands: { opp: [tile(6, 6)], mate: [tile(2, 2)] },
    opponentHands: [tile(4, 4)],
    partnerMemory: { strong: [6] }
  }), quiet);
  assert.deepEqual(plain, leaked);
  assert.deepEqual(dominoBot.getDominoMove(state, quiet), plain);

  const explained = decide(state);
  const blob = JSON.stringify(explained);
  assert.equal(blob.includes("6-6"), false);
  assert.equal(blob.includes("partnerMemory"), false);
  assert.ok(explained.diagnostics.scores.length >= 1);
});

test("immediate win is taken and an equal last-tile tie keeps the earlier side", () => {
  const only = decide(Object.assign(basePlayers(), {
    hand: [tile(3, 4)],
    validMoves: [{ tileId: "3-4", side: "left" }],
    leftEnd: 3,
    rightEnd: 0,
    chainLength: 8
  }));
  assert.deepEqual({ tileId: only.tileId, side: only.side }, { tileId: "3-4", side: "left" });
  assert.ok(only.diagnostics.scores[0].score >= 100);

  const either = decide({
    hand: [tile(4, 6)],
    validMoves: [
      { tileId: "4-6", side: "left" },
      { tileId: "4-6", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 4,
    chainLength: 2
  });
  assert.deepEqual({ tileId: either.tileId, side: either.side }, { tileId: "4-6", side: "left" });
});

test("the bot blocks a one-tile opponent instead of feeding them", () => {
  const hand = [tile(0, 0), tile(3, 5)];
  const unseen = ["0-1", "0-2", "5-5"];
  const move = decide(Object.assign(basePlayers(), {
    hand: hand,
    validMoves: [
      { tileId: "0-0", side: "left" },
      { tileId: "3-5", side: "right" }
    ],
    leftEnd: 0,
    rightEnd: 3,
    chain: chainExcept(hand.map((item) => item.id).concat(unseen)),
    players: seats([2, 1, 1, 1]),
    log: [
      playEvent("mate", 5, 4, "left", 5, 1),
      playEvent("mate", 5, 2, "left", 5, 0),
      playEvent("mate", 5, 1, "right", 3, 5)
    ]
  }));
  assert.equal(move.tileId, "0-0", JSON.stringify(move.diagnostics.scores));
});

test("a repeated teammate suit is kept when the rest of the position is tied", () => {
  const shared = Object.assign(basePlayers(), {
    hand: [tile(4, 5), tile(6, 5), tile(2, 2)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "5-6", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 6,
    chainLength: 6,
    players: seats([3, 0, 0, 0])
  });
  const cold = decide(shared);
  const warm = decide(Object.assign({}, shared, {
    log: [
      playEvent("mate", 4, 4, "left", 4, 2),
      playEvent("mate", 4, 3, "left", 4, 1),
      playEvent("mate", 4, 2, "right", 6, 4)
    ]
  }));
  const gap = (result) => {
    const rows = result.diagnostics.scores;
    const keep = rows.find((row) => row.tileId === "5-6").score;
    const drop = rows.find((row) => row.tileId === "4-5").score;
    return keep - drop;
  };
  assert.equal(warm.tileId, "5-6", JSON.stringify(warm.diagnostics.scores));
  assert.ok(gap(warm) > gap(cold));
});

test("a teammate who passed on both ends is not treated as able to play them", () => {
  const state = Object.assign(basePlayers(), {
    hand: [tile(2, 2), tile(2, 6)],
    validMoves: [
      { tileId: "2-2", side: "left" },
      { tileId: "2-6", side: "left" }
    ],
    leftEnd: 2,
    rightEnd: 5,
    chainLength: 8,
    log: [{ type: "pass", playerId: "mate", leftEnd: 2, rightEnd: 5 }]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.deepEqual(beliefs.mate.knownImpossibleNumbers, [2, 5]);
  const mate = view.players[2];
  assert.equal(canPlayProbability(view, beliefs, mate, 2, 5), 0);
  assert.ok(canPlayProbability(view, beliefs, mate, 6, 5) > 0);
  const weights = mergeWeights();
  const open = { tileId: "2-6", side: "left" };
  const keep = { tileId: "2-2", side: "left" };
  const teamGap = scoreMove(view, beliefs, open, weights, {}) - scoreMove(view, beliefs, keep, weights, {});
  const soloGap = scoreMove(view, beliefs, open, weights, { ignoreTeam: true }) -
    scoreMove(view, beliefs, keep, weights, { ignoreTeam: true });
  assert.ok(teamGap > soloGap);
});

test("a proven opponent void beats shedding a heavier tile", () => {
  const state = Object.assign(basePlayers(), {
    hand: [tile(2, 0), tile(2, 1), tile(4, 4)],
    validMoves: [
      { tileId: "0-2", side: "right" },
      { tileId: "1-2", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 2,
    chainLength: 7,
    log: [
      { type: "pass", playerId: "opp", leftEnd: 6, rightEnd: 0 },
      playEvent("mate", 5, 5, "left", 5, 1),
      playEvent("mate", 5, 4, "left", 5, 3),
      playEvent("mate", 5, 3, "right", 2, 5)
    ]
  });
  const move = decide(state);
  assert.equal(move.tileId, "0-2", JSON.stringify(move.diagnostics.scores));
  const legacy = dominoBot.legacyGetDominoMove(state);
  assert.equal(legacy.tileId, "1-2");
});

test("a favorable lock is kept and a losing lock is not chased blindly", () => {
  const light = decide(Object.assign(basePlayers(), {
    hand: [tile(0, 0), tile(0, 6), tile(2, 2)],
    validMoves: [
      { tileId: "0-0", side: "left" },
      { tileId: "0-6", side: "left" }
    ],
    leftEnd: 0,
    rightEnd: 1,
    chainLength: 10,
    players: seats([3, 5, 5, 5]),
    log: [
      { type: "pass", playerId: "opp", leftEnd: 0, rightEnd: 1 },
      { type: "pass", playerId: "far", leftEnd: 0, rightEnd: 1 }
    ]
  }));
  assert.equal(light.tileId, "0-0", JSON.stringify(light.diagnostics.scores));

  const heavyHand = [tile(6, 6), tile(5, 6), tile(5, 5), tile(4, 6), tile(0, 0), tile(0, 3)];
  const unseenIds = ["2-2", "2-3", "2-4", "2-5", "3-3", "3-4", "3-5", "4-4", "4-5"];
  const heavy = decide(Object.assign(basePlayers(), {
    hand: heavyHand,
    validMoves: [
      { tileId: "0-0", side: "left" },
      { tileId: "0-3", side: "left" }
    ],
    leftEnd: 0,
    rightEnd: 1,
    chain: chainExcept(heavyHand.map((item) => item.id).concat(unseenIds)),
    players: seats([6, 3, 3, 3]),
    log: [
      { type: "pass", playerId: "opp", leftEnd: 0, rightEnd: 1 },
      { type: "pass", playerId: "far", leftEnd: 0, rightEnd: 1 }
    ]
  }));
  assert.equal(heavy.tileId, "0-3", JSON.stringify(heavy.diagnostics.scores));
});

test("the bot keeps its own winning line ahead of a teammate's number", () => {
  const move = decide(Object.assign(basePlayers(), {
    hand: [tile(5, 5), tile(5, 4)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "5-5", side: "left" }
    ],
    leftEnd: 5,
    rightEnd: 1,
    chainLength: 9,
    log: [
      playEvent("mate", 4, 4, "left", 4, 0),
      playEvent("mate", 4, 3, "left", 4, 2),
      playEvent("mate", 4, 2, "right", 1, 4),
      playEvent("mate", 4, 1, "left", 4, 6)
    ]
  }));
  assert.equal(move.tileId, "5-5", JSON.stringify(move.diagnostics.scores));
});

test("a connector that keeps a heavy double live is preferred to sticking it", () => {
  const state = Object.assign(basePlayers(), {
    hand: [tile(6, 6), tile(6, 1), tile(2, 3)],
    validMoves: [
      { tileId: "1-6", side: "left" },
      { tileId: "2-3", side: "right" }
    ],
    leftEnd: 1,
    rightEnd: 2,
    chainLength: 6
  });
  const move = decide(state);
  assert.equal(move.tileId, "1-6", JSON.stringify(move.diagnostics.scores));
  assert.equal(dominoBot.legacyGetDominoMove(state).tileId, "1-6");
});

test("near the end of the set, pass constraints remove tiles from sampled hands", () => {
  const hand = [tile(1, 1), tile(2, 6)];
  const unseen = ["1-2", "1-3", "6-6", "0-0", "2-2", "3-3"];
  const state = Object.assign(basePlayers(), {
    hand: hand,
    validMoves: [
      { tileId: "1-1", side: "left" },
      { tileId: "2-6", side: "right" }
    ],
    leftEnd: 1,
    rightEnd: 2,
    chain: chainExcept(hand.map((item) => item.id).concat(unseen)),
    players: seats([2, 2, 2, 2]),
    log: [{ type: "pass", playerId: "opp", leftEnd: 1, rightEnd: 6 }]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(canPlayProbability(view, beliefs, view.players[1], 1, 6), 0);
  assert.ok(canPlayProbability(view, beliefs, view.players[1], 1, 2) > 0);
  const move = decide(state);
  assert.equal(move.tileId, "2-6", JSON.stringify(move.diagnostics.scores));
  const searched = decide(state, {
    seed: 5,
    deterministic: true,
    limits: { samples: 2, maxMs: 0, maxPlies: 8, maxNodes: 400 }
  });
  const again = decide(state, {
    seed: 5,
    limits: { samples: 2, maxMs: 0, maxPlies: 8, maxNodes: 400 }
  });
  assert.deepEqual(
    { tileId: searched.tileId, side: searched.side },
    { tileId: again.tileId, side: again.side }
  );
  assert.equal(searched.diagnostics.samples, 2);
  const text = JSON.stringify(searched.diagnostics);
  unseen.forEach((id) => assert.equal(text.includes(id), false));
});

test("live decision view hides other hands and the opening rule still holds", () => {
  const room = {
    gameMode: "dominoes",
    maxPlayers: 4,
    players: [0, 1, 2, 3].map((index) => ({ id: "p" + index, name: "P" + index, isBot: index > 0 }))
  };
  domino.initRound(room);
  assert.equal(room.domino.boneyard.length, 0);
  assert.equal(room.domino.mustPlayId, "6-6");
  assert.equal(room.domino.publicLog.length, 0);
  room.players.forEach((player) => assert.equal(room.domino.hands[player.id].length, 7));
  assert.equal(room.domino.teamA.join(","), "p0,p2");
  assert.equal(room.domino.teamB.join(","), "p1,p3");

  const view = domino.decisionView(room, room.domino.currentTurn);
  assert.equal(view.hand.length, 7);
  assert.ok(view.validMoves.every((move) => move.tileId === "6-6"));
  assert.equal(view.boneyardCount, 0);
  const other = room.players.find((player) => player.id !== view.selfId);
  const secret = room.domino.hands[other.id].find((item) => item.id !== "6-6");
  assert.equal(JSON.stringify(view).includes('"' + secret.id + '"'), false);
  const opening = dominoBot.getDominoMove(view, quiet);
  assert.equal(opening.tileId, "6-6");

  room.domino.winnerId = "p1";
  room.domino.winReason = "emptied";
  domino.rememberRoundWinner(room);
  domino.initRound(room);
  assert.equal(room.domino.firstRound, false);
  assert.equal(room.domino.mustPlayId, null);
  assert.equal(room.domino.currentTurn, "p1");
  assert.equal(room.domino.publicLog.length, 0);
  assert.equal(room.domino.boneyard.length, 0);
});

test("draws happen before a pass, and a block uses the engine's team totals", () => {
  const draw = sim.makeTable({
    order: ["a", "b"],
    starter: "a",
    hands: {
      a: [tile(6, 6), tile(0, 0)],
      b: [tile(1, 1), tile(2, 2)]
    },
    boneyard: [tile(3, 3), tile(6, 1)],
    teamMode: false
  });
  sim.playTable(draw, ["first", "first"], 1, simPlayStats());
  assert.ok(draw.log.some((entry) => entry.type === "draw" && entry.playerId === "b"));
  assert.ok(draw.log.some((entry) => entry.type === "play" && entry.tile && entry.tile.id === "1-6"));
  assert.ok(draw.over);

  const blocked = sim.makeTable({
    order: ["a", "b"],
    starter: "a",
    hands: {
      a: [tile(6, 6), tile(0, 0)],
      b: [tile(1, 1), tile(2, 2)]
    },
    boneyard: [],
    teamMode: false
  });
  const blockedStats = simPlayStats();
  sim.playTable(blocked, ["first", "first"], 2, blockedStats);
  const match = sim.freshMatch(["a", "b"]);
  sim.scoreStanding(blocked, match);
  assert.equal(blocked.winReason, "blocked");
  assert.equal(blocked.winnerId, "a");
  assert.equal(blocked.roundPoints, 6);
  assert.equal(blockedStats.avoidablePasses, 0);

  const tied = sim.makeTable({
    order: ["a", "b", "c", "d"],
    teamMode: true,
    teamA: ["a", "c"],
    teamB: ["b", "d"],
    hands: {
      a: [tile(1, 1)],
      c: [tile(1, 1)],
      b: [tile(0, 2)],
      d: [tile(1, 1)]
    },
    winReason: "blocked"
  });
  sim.scoreStanding(tied, null);
  assert.equal(tied.winnerTeam, "A");
  assert.equal(tied.roundPoints, 4);

  const behind = sim.makeTable({
    order: ["a", "b", "c", "d"],
    teamMode: true,
    teamA: ["a", "c"],
    teamB: ["b", "d"],
    hands: {
      a: [tile(6, 6)],
      c: [tile(5, 5)],
      b: [tile(0, 1)],
      d: []
    },
    winReason: "blocked"
  });
  sim.scoreStanding(behind, null);
  assert.equal(behind.winnerTeam, "B");
  assert.equal(behind.roundPoints, 22);

  const emptied = sim.makeTable({
    order: ["a", "b", "c", "d"],
    teamMode: true,
    teamA: ["a", "c"],
    teamB: ["b", "d"],
    hands: {
      a: [],
      c: [tile(6, 6)],
      b: [tile(0, 1)],
      d: [tile(2, 2)]
    },
    winnerId: "a",
    winReason: "emptied"
  });
  sim.scoreStanding(emptied, null);
  assert.equal(emptied.winnerTeam, "A");
  assert.equal(emptied.roundPoints, 5);
});

test("a full partnership match stays legal and an illegal choice is replaced", () => {
  const played = sim.playMatch({
    seats: ["heuristic", "legacy", "human", "greedy"],
    rounds: 2,
    seed: 17
  });
  assert.equal(played.stats.illegal, 0);
  assert.equal(played.stats.missedWins, 0);
  assert.equal(played.stats.avoidablePasses, 0);
  played.rounds.forEach((round) => {
    assert.equal(round.accounted.count, 28);
    assert.equal(round.accounted.unique, 28);
    assert.ok(round.winReason === "emptied" || round.winReason === "blocked");
    assert.ok(round.roundPoints >= 0);
  });
  assert.ok(played.match.roundsCompleted === 2);

  const rude = sim.playMatch({
    seats: ["illegal", "first", "illegal", "first"],
    rounds: 1,
    seed: 3
  });
  assert.ok(rude.stats.illegal > 0);
  assert.equal(rude.rounds[0].accounted.unique, 28);
  assert.ok(rude.rounds[0].winReason === "emptied" || rude.rounds[0].winReason === "blocked");
});

test("heuristic decisions on a dealt table finish quickly and agree", () => {
  const match = sim.freshMatch(["p0", "p1", "p2", "p3"]);
  const table = sim.startRound(["p0", "p1", "p2", "p3"], match, mulberry32(99), true);
  const view = sim.publicView(table, table.order[table.turn]);
  const started = Date.now();
  const move = dominoBot.getDominoMove(view, { seed: 4, limits: { samples: 2, maxMs: 0, maxPlies: 12, maxNodes: 800 } });
  const again = dominoBot.getDominoMove(view, { seed: 4, limits: { samples: 2, maxMs: 0, maxPlies: 12, maxNodes: 800 } });
  assert.ok(Date.now() - started < 1500);
  assert.deepEqual(move, again);
  assert.ok(view.validMoves.some((item) => item.tileId === move.tileId && item.side === move.side));
  const fast = Date.now();
  dominoBot.getDominoMove(view);
  assert.ok(Date.now() - fast < 1000);
});

function simPlayStats() {
  return {
    decisions: 0,
    ms: 0,
    illegal: 0,
    missedWins: 0,
    passes: 0,
    avoidablePasses: 0,
    draws: 0
  };
}
