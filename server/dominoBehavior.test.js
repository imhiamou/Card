"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalize } = require("./bots/domino/ai");
const { buildBeliefs } = require("./bots/domino/beliefs");

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
  assert.ok(intention.behavior.observedPlays >= 0);
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
  }
});

test("a player with no observed history is not assigned a confident behavioral style", () => {
  const view = normalize(state([], { left: 2, right: 3 }));
  const intention = buildBeliefs(view).mate.intention;

  assert.equal(intention.behavior.style, "insufficient-evidence");
  assert.equal(intention.behavior.observedPlays, 0);
  assert.equal(intention.preferred, null);
});
