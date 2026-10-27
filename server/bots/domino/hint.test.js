"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("../domino");
const { getDominoHint } = require("./hint");

function tile(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: lo + "-" + hi, a: lo, b: hi };
}

function state(extra) {
  return Object.assign({
    selfId: "me",
    hand: [],
    validMoves: [],
    leftEnd: null,
    rightEnd: null,
    chain: [],
    players: [
      { id: "me", handCount: 0, team: "A" },
      { id: "opp", handCount: 7, team: "B" },
      { id: "mate", handCount: 7, team: "A" },
      { id: "far", handCount: 7, team: "B" }
    ],
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: []
  }, extra || {});
}

test("hint chooses an immediate hand-emptying play above every heuristic", () => {
  const view = state({
    hand: [tile(6, 6), tile(1, 2)],
    validMoves: [{ tileId: "6-6", side: "left" }, { tileId: "1-2", side: "right" }],
    leftEnd: 6,
    rightEnd: 2,
    chain: [tile(4, 6), tile(4, 2)]
  });
  const hint = getDominoHint(view);
  assert.equal(hint.pass, false);
  assert.equal(hint.tile.id, "6-6");
  assert.equal(hint.score, 100000);
  assert.match(hint.reason, /empties your hand/);
});

test("hint prefers controlling both ends on a number the hand can continue", () => {
  const view = state({
    hand: [tile(4, 5), tile(2, 4), tile(4, 4), tile(1, 4), tile(6, 6)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "2-4", side: "right" },
      { tileId: "4-4", side: "right" }
    ],
    leftEnd: 5,
    rightEnd: 4,
    chain: [tile(3, 5), tile(3, 4)],
    players: [
      { id: "me", handCount: 5, team: "A" },
      { id: "opp", handCount: 7, team: "B" },
      { id: "mate", handCount: 7, team: "A" },
      { id: "far", handCount: 7, team: "B" }
    ]
  });
  const hint = getDominoHint(view);
  assert.equal(hint.tile.id, "4-5");
  assert.equal(hint.side, "left");
  assert.deepEqual(hint.resultingEnds, { left: 4, right: 4 });
  assert.ok(hint.alternatives[0].reasons.some((reason) => /ends aligned/.test(reason)));
});

test("hint gives playable doubles a meaningful urgency bonus", () => {
  const view = state({
    hand: [tile(6, 6), tile(4, 6), tile(1, 2), tile(3, 3)],
    validMoves: [
      { tileId: "6-6", side: "left" },
      { tileId: "4-6", side: "left" }
    ],
    leftEnd: 6,
    rightEnd: 1,
    chain: [tile(5, 6), tile(5, 1)],
    players: [
      { id: "me", handCount: 4, team: "A" },
      { id: "opp", handCount: 7, team: "B" },
      { id: "mate", handCount: 7, team: "A" },
      { id: "far", handCount: 7, team: "B" }
    ]
  });
  const hint = getDominoHint(view);
  assert.equal(hint.tile.id, "6-6");
  const double = hint.alternatives.find((row) => row.tile.id === "6-6");
  const connector = hint.alternatives.find((row) => row.tile.id === "4-6");
  assert.ok(double.parts.doubleUrgency > 0);
  assert.ok(double.score > connector.score);
});

test("hint uses public pass evidence to prefer a known opponent void", () => {
  const view = state({
    hand: [tile(2, 4), tile(1, 5), tile(4, 4), tile(0, 3)],
    validMoves: [
      { tileId: "2-4", side: "right" },
      { tileId: "1-5", side: "left" }
    ],
    leftEnd: 5,
    rightEnd: 4,
    chain: [tile(3, 5), tile(3, 4)],
    players: [
      { id: "me", handCount: 4, team: "A" },
      { id: "opp", handCount: 7, team: "B" },
      { id: "mate", handCount: 7, team: "A" },
      { id: "far", handCount: 7, team: "B" }
    ],
    log: [
      { type: "pass", playerId: "opp", leftEnd: 2, rightEnd: 4 }
    ]
  });
  const hint = getDominoHint(view);
  const chosen = hint.alternatives[0];
  assert.ok(chosen.parts.knownVoidUse > 0);
  assert.ok(chosen.reasons.some((reason) => /publicly shown they cannot play/.test(reason)));
});

test("no legal move recommends drawing or passing according to boneyard state", () => {
  const draw = getDominoHint(state({ boneyardCount: 3, validMoves: [] }));
  assert.equal(draw.pass, true);
  assert.equal(draw.canDraw, true);
  assert.match(draw.reason, /Draw/);

  const pass = getDominoHint(state({ boneyardCount: 0, validMoves: [] }));
  assert.equal(pass.pass, true);
  assert.equal(pass.canDraw, false);
  assert.match(pass.reason, /must pass/);
});

test("hint alternatives expose scores, reasons, and resulting ends without hidden hands", () => {
  const view = state({
    hand: [tile(4, 5), tile(2, 4), tile(4, 4)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "2-4", side: "right" }
    ],
    leftEnd: 5,
    rightEnd: 4,
    chain: [tile(3, 5), tile(3, 4)],
    players: [
      { id: "me", handCount: 3, team: "A" },
      { id: "opp", handCount: 7, team: "B" },
      { id: "mate", handCount: 7, team: "A" },
      { id: "far", handCount: 7, team: "B" }
    ]
  });
  const hint = getDominoHint(view);
  assert.ok(hint.alternatives.length >= 2);
  hint.alternatives.forEach((row) => {
    assert.equal(typeof row.score, "number");
    assert.ok(Array.isArray(row.reasons));
    assert.ok(row.resultingEnds);
  });
  const encoded = JSON.stringify(hint);
  assert.equal(encoded.includes("hands"), false);
  assert.equal(encoded.includes("allocation"), false);
});
