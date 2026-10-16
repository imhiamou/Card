"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const strategy = require("./strategy");

function baseView(overrides) {
  return Object.assign({
    gameId: "test-room",
    roundId: 1,
    selfId: "bot-a",
    hand: [
      { id: "0-1", a: 0, b: 1 },
      { id: "0-2", a: 0, b: 2 },
      { id: "1-2", a: 1, b: 2 },
      { id: "2-6", a: 2, b: 6 }
    ],
    players: [
      { id: "bot-a", handCount: 4, team: "A" },
      { id: "mate", handCount: 4, team: "A" },
      { id: "opp-b", handCount: 4, team: "B" },
      { id: "opp-c", handCount: 4, team: "B" }
    ],
    teamMode: true,
    teamA: ["bot-a", "mate"],
    teamB: ["opp-b", "opp-c"],
    leftEnd: 2,
    rightEnd: 3,
    chain: [{ id: "board-1", a: 2, b: 3 }],
    validMoves: [],
    log: []
  }, overrides || {});
}

test("recognizes repeated teammate exposure as a likely useful number", () => {
  strategy.clearMemory();
  const view = baseView({
    log: [
      {
        type: "play", playerId: "mate",
        tile: { id: "1-3", a: 1, b: 3 }, side: "right",
        leftEndBefore: 2, rightEndBefore: 1, leftEnd: 2, rightEnd: 3,
        legalAlternatives: 3
      },
      {
        type: "play", playerId: "opp-b",
        tile: { id: "3-5", a: 3, b: 5 }, side: "right",
        leftEndBefore: 2, rightEndBefore: 3, leftEnd: 2, rightEnd: 5,
        legalAlternatives: 2
      },
      {
        type: "play", playerId: "mate",
        tile: { id: "3-4", a: 3, b: 4 }, side: "left",
        leftEndBefore: 2, rightEndBefore: 5, leftEnd: 4, rightEnd: 5,
        legalAlternatives: 2
      },
      {
        type: "play", playerId: "mate",
        tile: { id: "3-6", a: 3, b: 6 }, side: "right",
        leftEndBefore: 4, rightEndBefore: 5, leftEnd: 4, rightEnd: 3,
        legalAlternatives: 2
      }
    ]
  });
  const scores = strategy.inferIntentScores(view);
  assert.ok(scores.mate[3] > scores.mate[1]);
  const plan = strategy.updateStrategicPlan(view, {});
  assert.equal(plan.mode, "teammate-support");
  assert.equal(plan.targetPlayerId, "mate");
  assert.equal(plan.targetNumber, 3);
});

test("retains a viable teammate target across later turns", () => {
  strategy.clearMemory();
  const first = baseView({
    log: [
      { type: "play", playerId: "mate", tile: { id: "1-3", a: 1, b: 3 }, side: "right", leftEnd: 2, rightEnd: 3, legalAlternatives: 3 },
      { type: "play", playerId: "mate", tile: { id: "3-4", a: 3, b: 4 }, side: "right", leftEnd: 2, rightEnd: 3, legalAlternatives: 2 }
    ]
  });
  const firstPlan = strategy.updateStrategicPlan(first, {});
  assert.equal(firstPlan.targetNumber, 3);

  const later = Object.assign({}, first, {
    log: first.log.concat([
      { type: "play", playerId: "opp-b", tile: { id: "2-5", a: 2, b: 5 }, side: "left", leftEnd: 5, rightEnd: 3, legalAlternatives: 2 }
    ]),
    leftEnd: 5,
    rightEnd: 3
  });
  const laterPlan = strategy.updateStrategicPlan(later, {});
  assert.equal(laterPlan.mode, firstPlan.mode);
  assert.equal(laterPlan.targetNumber, firstPlan.targetNumber);
  assert.equal(laterPlan.targetPlayerId, firstPlan.targetPlayerId);
  assert.equal(laterPlan.createdAtTurn, firstPlan.createdAtTurn);
});

test("self-control plan targets a number held by multiple own tiles", () => {
  strategy.clearMemory();
  const view = baseView({
    hand: [
      { id: "4-4", a: 4, b: 4 },
      { id: "4-5", a: 4, b: 5 },
      { id: "4-6", a: 4, b: 6 },
      { id: "0-1", a: 0, b: 1 }
    ],
    log: []
  });
  const plan = strategy.updateStrategicPlan(view, {});
  assert.equal(plan.mode, "self-control");
  assert.equal(plan.targetPlayerId, "bot-a");
  assert.equal(plan.targetNumber, 4);
});
