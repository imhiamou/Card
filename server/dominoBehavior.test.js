"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalize } = require("./bots/domino/ai");
const { buildBeliefs } = require("./bots/domino/beliefs");
const { predictNextMove } = require("./bots/domino/intent");

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function play(playerId, a, b, side, leftEndBefore, rightEndBefore, leftEnd, rightEnd) {
  return {
    type: "play",
    playerId,
    tile: tile(a, b),
    side,
    leftEndBefore,
    rightEndBefore,
    leftEnd,
    rightEnd
  };
}

function state(log, ends) {
  return {
    selfId: "me",
    hand: [tile(0, 0), tile(2, 2), tile(5, 6)],
    validMoves: [{ tileId: "2-2", side: "left" }],
    leftEnd: ends ? ends.left : 2,
    rightEnd: ends ? ends.right : 3,
    chain: [tile(1, 3), tile(3, 4)],
    players: [
      { id: "me", handCount: 3, team: "A" },
      { id: "opp", handCount: 4, team: "B" },
      { id: "mate", handCount: 3, team: "A" },
      { id: "far", handCount: 4, team: "B" }
    ],
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: log || []
  };
}

test("behavior-aware inference exposes a cautious per-player profile", () => {
  const view = normalize(state([
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ]));
  const beliefs = buildBeliefs(view);
  const intention = beliefs.mate.intention;

  assert.ok(intention);
  assert.ok(intention.behavior);
  assert.equal(typeof intention.behavior.style, "string");
  assert.ok([
    "insufficient-evidence",
    "mostly-forced",
    "consistent-number-control",
    "flexible-or-changing",
    "mixed"
  ].includes(intention.behavior.style));
  assert.ok(intention.behavior.weightedPlaySignal >= 0);
  assert.equal(Object.prototype.hasOwnProperty.call(intention.behavior, "observedPlays"), false);
  assert.ok(intention.behavior.persistence >= 0);
  assert.ok(intention.behavior.changesAway >= 0);
});

test("next-move estimate combines tile availability with observed preference", () => {
  const view = normalize(state([
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ], { left: 2, right: 3 }));
  const intention = buildBeliefs(view).mate.intention;
  const prediction = intention.nextMovePrediction;

  assert.ok(prediction);
  assert.ok(["tile-availability", "tile-availability-plus-behavior", "no-public-evidence", "unavailable"].includes(prediction.basis));
  assert.ok(prediction.confidence >= 0 && prediction.confidence <= 1);
  assert.ok(prediction.leftProbability >= 0 && prediction.leftProbability <= 1);
  assert.ok(prediction.rightProbability >= 0 && prediction.rightProbability <= 1);
  if (prediction.basis !== "unavailable" && prediction.basis !== "no-public-evidence") {
    assert.ok(Math.abs(prediction.leftProbability + prediction.rightProbability - 1) <= 0.02);
    assert.ok(prediction.baselineLeftProbability >= 0 && prediction.baselineLeftProbability <= 1);
    assert.ok(prediction.baselineRightProbability >= 0 && prediction.baselineRightProbability <= 1);
    assert.ok(Math.abs(prediction.baselineLeftProbability + prediction.baselineRightProbability - 1) <= 0.02);
    if (intention.preferred === 3) {
      assert.ok(prediction.rightProbability > prediction.baselineRightProbability,
        "behavioral evidence should increase the predicted choice of the preferred right end");
    }
  }
});

test("a player with no observed history is not assigned a confident behavioral style", () => {
  const view = normalize(state([], { left: 2, right: 3 }));
  const intention = buildBeliefs(view).mate.intention;

  assert.equal(intention.behavior.style, "insufficient-evidence");
  assert.equal(intention.behavior.observedPlays, 0);
  assert.equal(intention.preferred, null);
});

test("identical open ends do not create a false 100% left-side prediction", () => {
  const rows = Array.from({ length: 7 }, () => ({ pAtLeastOne: 0.5, confidence: 0 }));
  const prediction = predictNextMove({
    leftEnd: 3,
    rightEnd: 3,
    players: [{ id: "mate", handCount: 4 }]
  }, { byPip: rows, preferred: 3, confidence: 0.9 }, "mate");

  assert.equal(prediction.likelyEnd, 3);
  assert.equal(prediction.confidence, 0);
  assert.equal(prediction.leftProbability, 0.5);
  assert.equal(prediction.rightProbability, 0.5);
  assert.equal(prediction.baselineLeftProbability, 0.5);
  assert.equal(prediction.baselineRightProbability, 0.5);
  assert.equal(prediction.basis, "same-open-number");
  assert.equal(prediction.interpretation, "heuristic-score-share-not-calibrated");
});

test("identical open ends without availability evidence remain unpredicted", () => {
  const rows = Array.from({ length: 7 }, () => ({ pAtLeastOne: 0, confidence: 0 }));
  const prediction = predictNextMove({
    leftEnd: 5,
    rightEnd: 5,
    players: [{ id: "mate", handCount: 4 }]
  }, { byPip: rows, preferred: null, confidence: 0 }, "mate");

  assert.equal(prediction.likelyEnd, null);
  assert.equal(prediction.confidence, 0);
  assert.equal(prediction.leftProbability, 0.5);
  assert.equal(prediction.rightProbability, 0.5);
  assert.equal(prediction.basis, "no-public-evidence");
});

test("a draw by the player breaks consecutive-play pattern evidence", () => {
  const view = normalize(state([
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    { type: "draw", playerId: "mate" },
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ]));
  const intention = buildBeliefs(view).mate.intention;

  // The same pip appears in both played tiles, but a draw separated the
  // choices. It must not be counted as one continuous bridge pattern.
  assert.equal(intention.byPip[3].bridged, 0);
});

test("a forced play breaks consecutive-play pattern evidence", () => {
  const forced = Object.assign(
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    { legalAlternatives: 0, boardLeftBefore: 2, boardRightBefore: 1 }
  );
  const view = normalize(state([
    play("mate", 0, 1, "left", 2, 1, 0, 1),
    forced,
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ]));
  const intention = buildBeliefs(view).mate.intention;

  assert.equal(intention.byPip[3].bridged, 0);
});
