"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const strategy = require("./strategy");
const { api } = require("./engine");

function baseView(overrides) {
  return Object.assign({
    gameId: "test-room",
    roundId: 1,
    selfId: "bot-a",
    hand: [
      { id: "0-1", a: 0, b: 1 },
      { id: "2-3", a: 2, b: 3 },
      { id: "4-5", a: 4, b: 5 },
      { id: "6-6", a: 6, b: 6 }
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


test("abandons a teammate-support action when the target becomes a known void", () => {
  strategy.clearMemory();
  const view = baseView({
    log: [
      { type: "play", playerId: "mate", tile: { id: "1-3", a: 1, b: 3 }, side: "right", leftEnd: 2, rightEnd: 3, legalAlternatives: 3 },
      { type: "play", playerId: "mate", tile: { id: "3-4", a: 3, b: 4 }, side: "right", leftEnd: 2, rightEnd: 3, legalAlternatives: 2 }
    ]
  });
  const initial = strategy.updateStrategicPlan(view, {});
  assert.equal(initial.mode, "teammate-support");
  assert.equal(initial.targetNumber, 3);

  const constrained = strategy.updateStrategicPlan(view, {
    mate: { knownImpossibleNumbers: [3] }
  });
  assert.notEqual(constrained.mode, "teammate-support");
});


test("Double-Six set has 28 unique tiles and seven tiles per number", () => {
  const tiles = api().buildDoubleSixSet();
  assert.equal(tiles.length, 28);
  assert.equal(new Set(tiles.map((tile) => tile.id)).size, 28);
  for (let pip = 0; pip <= 6; pip++) {
    assert.equal(tiles.filter((tile) => tile.a === pip || tile.b === pip).length, 7);
  }
});


test("recent teammate choices can replace a stale number preference", () => {
  strategy.clearMemory();
  const log = [];
  [0, 1, 2].forEach((i) => log.push({
    type: "play", playerId: "mate", tile: { id: "1-3", a: 1, b: 3 },
    side: "right", leftEnd: 1, rightEnd: 3, legalAlternatives: 3
  }));
  [0, 1, 2, 3].forEach((i) => log.push({
    type: "play", playerId: "mate", tile: { id: "2-6", a: 2, b: 6 },
    side: "right", leftEnd: 2, rightEnd: 6, legalAlternatives: 3
  }));
  const scores = strategy.inferIntentScores(baseView({ log }));
  assert.ok(scores.mate[6] > scores.mate[3], JSON.stringify(scores.mate));
});

test("forced teammate plays contribute much less intent evidence than real choices", () => {
  strategy.clearMemory();
  const log = [
    { type: "play", playerId: "mate", tile: { id: "1-3", a: 1, b: 3 },
      side: "right", leftEnd: 1, rightEnd: 3, legalAlternatives: 1 },
    { type: "play", playerId: "mate", tile: { id: "2-6", a: 2, b: 6 },
      side: "right", leftEnd: 2, rightEnd: 6, legalAlternatives: 4 }
  ];
  const scores = strategy.inferIntentScores(baseView({ log }));
  assert.ok(scores.mate[6] > scores.mate[3], JSON.stringify(scores.mate));
});

test("the strategic target changes the actual move ranking", () => {
  const { rankMoves } = require("./eval");
  const view = baseView({
    hand: [
      { id: "2-6", a: 2, b: 6 },
      { id: "3-4", a: 3, b: 4 }
    ],
    leftEnd: 2,
    rightEnd: 3,
    chain: [{ id: "2-3", a: 2, b: 3 }],
    validMoves: [
      { tileId: "2-6", side: "left" },
      { tileId: "3-4", side: "right" }
    ]
  });
  const neutralWeights = {
    roundWin: 0, pointScale: 0, oppOutScale: 0, denyNext: 0,
    forcePass: 0, mateCanReply: 0, mateSuit: 0, otherOpp: 0,
    ownOuts: 0, stuckDoubleRelief: 0, shedPips: 0, dumpDouble: 0,
    blockEquity: 0
  };
  const ranked = rankMoves(view, {}, neutralWeights, {
    strategicPlan: {
      mode: "teammate-support", targetNumber: 6, targetPlayerId: "mate"
    }
  });
  assert.equal(ranked[0].move.tileId, "2-6");
  assert.equal(ranked[0].move.side, "left");
  assert.ok(ranked[0].score > ranked[1].score);
});


test("a clear own-suit control plan outranks teammate support when the hand is concentrated", () => {
  strategy.clearMemory();
  const view = baseView({
    hand: [
      { id: "4-4", a: 4, b: 4 },
      { id: "4-5", a: 4, b: 5 },
      { id: "4-6", a: 4, b: 6 },
      { id: "2-4", a: 2, b: 4 }
    ],
    log: [
      { type: "play", playerId: "mate", tile: { id: "1-6", a: 1, b: 6 },
        side: "right", leftEnd: 1, rightEnd: 6, legalAlternatives: 3 },
      { type: "play", playerId: "mate", tile: { id: "2-6", a: 2, b: 6 },
        side: "right", leftEnd: 2, rightEnd: 6, legalAlternatives: 3 },
      { type: "play", playerId: "mate", tile: { id: "3-6", a: 3, b: 6 },
        side: "right", leftEnd: 3, rightEnd: 6, legalAlternatives: 3 }
    ]
  });
  const plan = strategy.updateStrategicPlan(view, {});
  assert.equal(plan.mode, "self-control");
  assert.equal(plan.targetNumber, 4);
  assert.equal(plan.targetPlayerId, "bot-a");
});
