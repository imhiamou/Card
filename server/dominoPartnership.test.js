"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");
const dominoBot = require("./bots/dominoBot");
const { buildBeliefs } = require("./bots/domino/beliefs");
const { buildInventory } = require("./bots/domino/inventory");
const { normalize } = require("./bots/domino/ai");
const { canPlayProbability } = require("./bots/domino/eval");
const { reviewTable } = require("./bots/domino/review");
const sim = require("./bots/dominoSim");
const { partnershipJobs } = require("./bots/domino/bench");

const quiet = { limits: { samples: 0, maxMs: 0 } };

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function play(id, a, b, side, beforeL, beforeR, left, right) {
  return {
    type: "play",
    playerId: id,
    tile: tile(a, b),
    side: side,
    leftEndBefore: beforeL,
    rightEndBefore: beforeR,
    leftEnd: left,
    rightEnd: right
  };
}

function seats(counts, order) {
  const ids = order || ["me", "opp", "mate", "far"];
  const teams = { me: "A", mate: "A", opp: "B", far: "B" };
  return ids.map((id, index) => ({ id: id, handCount: counts[index], team: teams[id] }));
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

function base(extra) {
  return Object.assign({
    selfId: "me",
    players: seats([4, 4, 4, 4]),
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    chainLength: 8,
    log: []
  }, extra || {});
}

function keptFours() {
  return [
    play("mate", 4, 4, "left", 4, 0, 4, 0),
    play("mate", 4, 1, "right", 4, 1, 4, 4),
    play("mate", 4, 6, "left", 6, 4, 4, 4)
  ];
}

function row(result, id) {
  return result.diagnostics.candidateEvaluations.find((item) => item.tileId === id);
}

function scoreText(result) {
  return JSON.stringify(result.diagnostics.candidateEvaluations);
}

test("each number is on seven tiles and a full deal has no boneyard", () => {
  const room = {
    gameMode: "dominoes",
    maxPlayers: 4,
    players: [0, 1, 2, 3].map((index) => ({ id: "p" + index, name: "P" + index, isBot: true }))
  };
  domino.initRound(room);
  const view = normalize(domino.decisionView(room, room.domino.currentTurn));
  const inventory = buildInventory(view);
  assert.equal(inventory.allDealt, true);
  assert.equal(inventory.boneyardCount, 0);
  assert.equal(inventory.unseenCount, 21);
  inventory.byPip.forEach((pip) => {
    assert.equal(pip.total, 7);
    assert.equal(pip.inHand + pip.played + pip.unseen, 7);
  });
  const beliefs = buildBeliefs(view);
  assert.equal(beliefs._inventory.allDealt, true);
  beliefs._inventory.byPip.forEach((pip) => {
    const holders = pip.holders || [];
    const expected = holders.reduce((sum, holder) => sum + holder.expected, 0);
    assert.ok(Math.abs(expected - pip.unseen) < 0.02, JSON.stringify(pip));
  });
});

test("a pass stays proven after the board changes", () => {
  const view = normalize(base({
    hand: [tile(3, 3)],
    validMoves: [{ tileId: "3-3", side: "left" }],
    leftEnd: 3,
    rightEnd: 6,
    log: [
      { type: "pass", playerId: "opp", leftEnd: 2, rightEnd: 5 },
      play("mate", 1, 1, "left", 1, 2, 1, 2)
    ],
    players: seats([1, 5, 5, 5])
  }));
  const beliefs = buildBeliefs(view);
  assert.deepEqual(beliefs.opp.knownImpossibleNumbers, [2, 5]);
  assert.equal(beliefs.opp.passHistory[0].invalidated, false);
  assert.equal(beliefs.opp.passHistory[0].handCount, 5);
  assert.equal(canPlayProbability(view, beliefs, view.players[1], 3, 6) > 0, true);
  assert.equal(canPlayProbability(view, beliefs, view.players[1], 2, 5), 0);
});

test("a safe repeated teammate number is preserved", () => {
  const state = base({
    hand: [tile(1, 2), tile(3, 4), tile(5, 5), tile(0, 0)],
    validMoves: [
      { tileId: "1-2", side: "right" },
      { tileId: "3-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 1,
    players: seats([4, 4, 3, 3], ["me", "mate", "opp", "far"]),
    log: keptFours()
  });
  const move = decide(state);
  const shed = decide(state, { ignoreIntent: true });
  assert.equal(move.tileId, "1-2", scoreText(move));
  assert.equal(shed.tileId, "3-4", scoreText(shed));
  assert.ok(move.diagnostics.summary.teammateIntention.preferred === 4);
  assert.ok(move.diagnostics.summary.teammateIntention.confidence >= 0.45);
  assert.ok(row(move, "1-2").parts.intentKeep > row(move, "3-4").parts.intentKeep);
  assert.equal(move.diagnostics.mode.code, "SUPPORT_PARTNER");
});

test("a teammate number is not kept when the next opponent can take the hand", () => {
  const state = base({
    hand: [tile(4, 0), tile(1, 2), tile(3, 3), tile(5, 5)],
    validMoves: [
      { tileId: "1-2", side: "right" },
      { tileId: "0-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 1,
    players: seats([4, 1, 3, 3]),
    log: keptFours().concat([
      { type: "pass", playerId: "opp", leftEnd: 0, rightEnd: 1 }
    ])
  });
  const move = decide(state);
  assert.equal(move.tileId, "0-4", scoreText(move));
  assert.ok(row(move, "1-2").parts.intentKeep > 0);
  assert.ok(row(move, "1-2").parts.oppOut < row(move, "0-4").parts.oppOut);
  assert.ok(move.diagnostics.mode.code === "DEFEND_AGAINST_FINISH" || move.diagnostics.mode.code === "DENY_OPPONENT");
});

test("a forced teammate play is not treated as a chosen number", () => {
  const hand = [tile(0, 6), tile(1, 6), tile(2, 6), tile(3, 6), tile(5, 6)];
  const hidden = ["0-0", "0-1", "1-1"];
  const state = base({
    hand: hand,
    validMoves: [
      { tileId: "0-6", side: "left" },
      { tileId: "5-6", side: "left" }
    ],
    leftEnd: 6,
    rightEnd: 4,
    chain: chainExcept(hand.map((item) => item.id).concat(hidden).concat(["4-6"])),
    players: seats([5, 1, 1, 1]),
    log: [
      play("mate", 4, 6, "right", 6, 6, 6, 4)
    ]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(beliefs.mate.intention.lastMoveForced, true);
  assert.equal(beliefs.mate.intention.preferred, null);
  assert.equal(beliefs.mate.intention.byPip[4].confidence, 0);
  const move = decide(state);
  assert.equal(move.tileId, "5-6", scoreText(move));
  assert.match(move.diagnostics.summary.noticed, /forced/i);
  assert.equal(move.diagnostics.summary.teammateIntention.lastMoveForced, true);
});

test("a teammate pass is not read as a number they want", () => {
  const state = base({
    hand: [tile(2, 2), tile(2, 6), tile(3, 3), tile(4, 4)],
    validMoves: [
      { tileId: "2-2", side: "left" },
      { tileId: "2-6", side: "left" }
    ],
    leftEnd: 2,
    rightEnd: 5,
    log: [{ type: "pass", playerId: "mate", leftEnd: 2, rightEnd: 5 }]
  });
  const move = decide(state);
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(canPlayProbability(view, beliefs, view.players[2], 2, 5), 0);
  assert.equal(move.tileId, "2-6", scoreText(move));
  assert.ok(row(move, "2-2").parts.mateVoidHarm < row(move, "2-6").parts.mateVoidHarm);
  assert.match(move.diagnostics.summary.noticed, /passed on 2 and 5|passed on 5 and 2/);
});

test("an opponent pass is used when it does not give up the hand", () => {
  const state = base({
    hand: [tile(2, 0), tile(2, 1), tile(4, 4), tile(3, 3)],
    validMoves: [
      { tileId: "0-2", side: "right" },
      { tileId: "1-2", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 2,
    log: [{ type: "pass", playerId: "opp", leftEnd: 6, rightEnd: 0 }]
  });
  const move = decide(state);
  assert.equal(move.tileId, "0-2", scoreText(move));
  assert.ok(row(move, "0-2").parts.oppVoidExploit > 0 || row(move, "0-2").parts.forcePass > 0);
});

test("both opponents passing supports a light block and not a heavy one", () => {
  const light = decide(base({
    hand: [tile(0, 0), tile(0, 6), tile(2, 2), tile(3, 3)],
    validMoves: [
      { tileId: "0-0", side: "left" },
      { tileId: "0-6", side: "left" }
    ],
    leftEnd: 0,
    rightEnd: 1,
    players: seats([4, 5, 5, 5]),
    log: [
      { type: "pass", playerId: "opp", leftEnd: 0, rightEnd: 1 },
      { type: "pass", playerId: "far", leftEnd: 0, rightEnd: 1 }
    ]
  }));
  assert.equal(light.tileId, "0-0", scoreText(light));
  assert.ok(row(light, "0-0").parts.blockEquity > 0);
  assert.ok(row(light, "0-0").parts.forcePass > 0);

  const heavyHand = [tile(6, 6), tile(5, 6), tile(5, 5), tile(4, 6), tile(0, 0), tile(0, 3)];
  const unseenIds = ["2-2", "2-3", "2-4", "2-5", "3-3", "3-4", "3-5", "4-4", "4-5"];
  const heavy = decide(base({
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
  assert.equal(heavy.tileId, "0-3", scoreText(heavy));
  assert.ok(row(heavy, "0-0").score < row(heavy, "0-3").score);
});

test("a teammate with one tile gets the end when the opponent cannot answer", () => {
  const hand = [tile(6, 1), tile(3, 3), tile(2, 2), tile(0, 5)];
  const unseen = ["6-6", "6-5", "6-4", "6-2"];
  const state = base({
    hand: hand,
    validMoves: [
      { tileId: "1-6", side: "left" },
      { tileId: "3-3", side: "right" }
    ],
    leftEnd: 6,
    rightEnd: 3,
    chain: chainExcept(hand.map((item) => item.id).concat(unseen)),
    players: seats([4, 2, 1, 1]),
    log: [{ type: "pass", playerId: "opp", leftEnd: 6, rightEnd: 3 }]
  });
  const move = decide(state);
  assert.equal(move.tileId, "3-3", scoreText(move));
  assert.ok(row(move, "3-3").parts.mateFinish > 40, scoreText(move));
  assert.ok(row(move, "3-3").parts.mateFinish > row(move, "1-6").parts.mateFinish);
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(canPlayProbability(view, beliefs, view.players[1], 6, 3), 0);
  assert.ok(canPlayProbability(view, beliefs, view.players[2], 6, 3) > 0.8);
});

test("the bot finishes its own hand instead of chasing a teammate number", () => {
  const state = base({
    hand: [tile(5, 5), tile(5, 4)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "5-5", side: "left" }
    ],
    leftEnd: 5,
    rightEnd: 1,
    log: keptFours().concat([play("mate", 4, 2, "right", 4, 3, 4, 2)])
  });
  const move = decide(state);
  assert.equal(move.tileId, "5-5", scoreText(move));
  assert.ok((row(move, "4-5").parts.intentKeep || 0) >= (row(move, "5-5").parts.intentKeep || 0));
  assert.equal(move.diagnostics.mode.code, "FINISH_OWN_HAND");
});

test("an established opponent number is not left open just to copy the teammate", () => {
  const state = base({
    hand: [tile(3, 4), tile(0, 2), tile(3, 3), tile(5, 5)],
    validMoves: [
      { tileId: "3-4", side: "left" },
      { tileId: "0-2", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 0,
    players: seats([4, 4, 3, 3]),
    log: keptFours().concat([
      play("opp", 4, 5, "left", 4, 1, 4, 1),
      play("opp", 0, 4, "right", 2, 3, 2, 4),
      play("opp", 2, 4, "left", 4, 2, 4, 2),
      { type: "pass", playerId: "opp", leftEnd: 0, rightEnd: 1 }
    ])
  });
  const move = decide(state);
  const keep = row(move, "0-2");
  const drop = row(move, "3-4");
  assert.ok(keep.parts.intentKeep > drop.parts.intentKeep);
  assert.ok(drop.score > keep.score, scoreText(move));
  assert.equal(move.tileId, "3-4", scoreText(move));
});

test("a teammate who switches numbers is not locked to the old one", () => {
  const fours = keptFours();
  const switched = fours.concat([
    play("mate", 2, 4, "left", 4, 1, 2, 1),
    play("mate", 2, 5, "right", 2, 6, 2, 2)
  ]);
  const state = base({
    hand: [tile(0, 4), tile(2, 6), tile(3, 3), tile(1, 1)],
    validMoves: [
      { tileId: "0-4", side: "right" },
      { tileId: "2-6", side: "left" }
    ],
    leftEnd: 2,
    rightEnd: 4,
    players: seats([4, 4, 3, 3], ["me", "mate", "opp", "far"]),
    log: switched
  });
  const beliefs = buildBeliefs(normalize(state));
  assert.ok(beliefs.mate.intention.byPip[4].changedAway > 0);
  assert.ok(beliefs.mate.intention.byPip[2].confidence > beliefs.mate.intention.byPip[4].confidence);
  assert.equal(beliefs.mate.intention.preferred, 2);
  const move = decide(state);
  assert.equal(move.tileId, "0-4", scoreText(move));
  assert.ok(row(move, "0-4").parts.intentKeep > row(move, "2-6").parts.intentKeep);
});

test("the same board is scored differently when the hidden constraints differ", () => {
  const shared = {
    hand: [tile(4, 1), tile(0, 3), tile(2, 2), tile(5, 5)],
    validMoves: [
      { tileId: "1-4", side: "left" },
      { tileId: "0-3", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 0
  };
  const voided = decide(base(Object.assign({}, shared, {
    log: [{ type: "pass", playerId: "opp", leftEnd: 4, rightEnd: 4 }]
  })));
  const favored = decide(base(Object.assign({}, shared, {
    log: [
      play("opp", 4, 4, "left", 4, 1, 4, 1),
      play("opp", 4, 6, "right", 2, 3, 2, 4),
      play("opp", 4, 5, "left", 4, 2, 4, 2)
    ]
  })));
  const leave = (result) => row(result, "0-3").score - row(result, "1-4").score;
  assert.ok(leave(voided) > leave(favored), JSON.stringify({
    voided: voided.diagnostics.candidateEvaluations,
    favored: favored.diagnostics.candidateEvaluations
  }));
});

test("public information can force the next player to pass", () => {
  const state = base({
    hand: [tile(0, 4), tile(1, 4), tile(3, 3), tile(5, 5)],
    validMoves: [
      { tileId: "0-4", side: "left" },
      { tileId: "1-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 0,
    log: [{ type: "pass", playerId: "opp", leftEnd: 4, rightEnd: 0 }]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(canPlayProbability(view, beliefs, view.players[1], 4, 0), 0);
  assert.ok(canPlayProbability(view, beliefs, view.players[1], 1, 0) > 0);
  const move = decide(state);
  assert.equal(move.tileId, "0-4", scoreText(move));
  assert.ok(row(move, "0-4").parts.forcePass > 0);
  assert.equal(row(move, "1-4").parts.forcePass, 0);
});

test("the inspector reports the same decision without another player's tiles", () => {
  const move = decide(base({
    hand: [tile(1, 2), tile(3, 4), tile(5, 5), tile(0, 0)],
    validMoves: [
      { tileId: "1-2", side: "right" },
      { tileId: "3-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 1,
    players: seats([4, 4, 3, 3], ["me", "mate", "opp", "far"]),
    log: keptFours()
  }));
  const snap = move.diagnostics;
  assert.equal(snap.selected.tileId, move.tileId);
  assert.equal(snap.candidateEvaluations[0].tileId, move.tileId);
  assert.ok(snap.summary.noticed);
  assert.ok(snap.summary.expect);
  assert.ok(snap.inventory.byPip.length === 7);
  assert.equal(snap.summary.teammateIntention.preferred, 4);
  const text = JSON.stringify(snap);
  ["6-6", "0-1", "1-1", "2-2"].forEach((id) => assert.equal(text.includes(id), false, id));
  assert.equal(snap.beliefDetail.mate.knownImpossibleNumbers !== undefined, true);
  assert.equal(snap.beliefDetail.me, undefined);
});

test("hindsight review uses the finished deal and does not steer the live move", () => {
  const played = sim.playMatch({
    seats: ["heuristic", "greedy", "heuristic", "greedy"],
    rounds: 1,
    seed: 11
  });
  assert.equal(played.stats.illegal, 0);
  const table = sim.startRound(["a", "b", "c", "d"], sim.freshMatch(["a", "b", "c", "d"]), sim.playMatch ? require("./bots/domino/sample").mulberry32(4) : null, true);
  sim.playTable(table, ["heuristic", "follow", "heuristic", "greedy"], 4, {
    decisions: 0, ms: 0, illegal: 0, missedWins: 0, passes: 0, avoidablePasses: 0, draws: 0
  });
  const review = reviewTable(table);
  assert.equal(review.hindsight, true);
  assert.equal(typeof review.gaveFinish, "number");
  assert.equal(typeof review.preserveAttempts, "number");
  assert.ok(review.hindsightForced >= 0);
  const live = decide(base({
    hand: [tile(1, 1)],
    validMoves: [{ tileId: "1-1", side: "left" }],
    leftEnd: 1,
    rightEnd: 2
  }));
  assert.equal(live.tileId, "1-1");
  assert.equal(JSON.stringify(live.diagnostics).includes("hindsight"), false);
});

test("partnership strategies stay legal over a short match", () => {
  const jobs = partnershipJobs({ matches: 1, rounds: 1, seed: 3, aiLimits: { samples: 0, maxMs: 0 } });
  assert.equal(jobs.length >= 8, true);
  jobs.forEach((job) => {
    assert.equal(job.result.illegal, 0, job.name);
    assert.equal(job.result.avoidablePasses, 0, job.name);
    assert.equal(job.result.matches, 2, job.name);
  });
});
