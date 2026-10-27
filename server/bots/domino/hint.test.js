"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("../../domino");
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
    hand: [tile(6, 6)],
    validMoves: [{ tileId: "6-6", side: "left" }],
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
    hand: [tile(4, 5), tile(2, 4), tile(1, 4), tile(3, 4), tile(6, 6)],
    validMoves: [
      { tileId: "4-5", side: "left" },
      { tileId: "2-4", side: "right" },
      { tileId: "1-4", side: "right" },
      { tileId: "3-4", side: "right" }
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


test("hint returns only legal moves across 120 randomized legal board states", () => {
  let seed = 0x6d2b79f5;
  function rng() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  function opponentCounts(total) {
    const counts = [0, 0, 0];
    for (let i = 0; i < total; i++) {
      const index = counts.findIndex((count) => count < 7);
      assert.notEqual(index, -1, "unseen tiles must fit the other three hands");
      counts[index] += 1;
    }
    return counts;
  }

  for (let iteration = 0; iteration < 120; iteration++) {
    const deck = shuffle(domino.buildDoubleSixSet().map((item) => tile(item.a, item.b)));
    const hand = deck.slice(0, 7);
    const pool = deck.slice(7);
    const board = { chain: [], leftEnd: null, rightEnd: null, mustPlayId: null };
    const opening = pool.shift();
    domino.placeTile(board, opening, "center");
    const targetLength = 1 + Math.floor(rng() * 8);

    while (board.chain.length < targetLength) {
      const moves = domino.listValidMoves(pool, board.leftEnd, board.rightEnd, board.chain.length);
      if (!moves.length) break;
      const move = moves[Math.floor(rng() * moves.length)];
      const next = pool.find((item) => item.id === move.tileId);
      assert.ok(next);
      assert.ok(domino.placeTile(board, next, move.side));
      pool.splice(pool.findIndex((item) => item.id === next.id), 1);
    }

    const counts = opponentCounts(pool.length);
    const players = [
      { id: "me", handCount: hand.length, team: "A" },
      { id: "opp", handCount: counts[0], team: "B" },
      { id: "mate", handCount: counts[1], team: "A" },
      { id: "far", handCount: counts[2], team: "B" }
    ];
    const validMoves = domino.listValidMoves(hand, board.leftEnd, board.rightEnd, board.chain.length)
      .map((move) => ({ tileId: move.tileId, side: move.side }));
    const view = {
      selfId: "me",
      hand,
      validMoves,
      leftEnd: board.leftEnd,
      rightEnd: board.rightEnd,
      chain: board.chain,
      players,
      teamMode: true,
      teamA: ["me", "mate"],
      teamB: ["opp", "far"],
      boneyardCount: 0,
      log: []
    };
    const hint = getDominoHint(view);
    if (!validMoves.length) {
      assert.equal(hint.pass, true, "position " + iteration + " has no legal move");
      continue;
    }
    assert.equal(hint.pass, false, "position " + iteration + " has legal moves");
    assert.ok(validMoves.some((move) =>
      move.tileId === hint.tile.id && move.side === hint.side
    ), "position " + iteration + " recommended an illegal move");
    assert.ok(Number.isFinite(hint.score), "position " + iteration + " must have a finite score");
    hint.alternatives.forEach((row) => {
      assert.ok(validMoves.some((move) =>
        move.tileId === row.tile.id && move.side === row.side
      ), "position " + iteration + " contains an illegal alternative");
    });
  }
});
