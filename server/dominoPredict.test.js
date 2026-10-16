"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");
const { getDominoMove, normalize } = require("./bots/domino/ai");
const { buildBeliefs } = require("./bots/domino/beliefs");
const { buildInventory } = require("./bots/domino/inventory");
const { forecastLine } = require("./bots/domino/search");
const { mergeWeights } = require("./bots/domino/weights");
const { sampleAllocation, mulberry32 } = require("./bots/domino/sample");
const client = require("../assets/domino-inspect");

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

function chainExcept(ids) {
  const skip = new Set(ids);
  return domino.buildDoubleSixSet().filter((item) => !skip.has(item.id));
}

function pass(id, left, right) {
  return { type: "pass", playerId: id, leftEnd: left, rightEnd: right };
}

/*
 * Teammate has been keeping 4 and cannot match 2. The next opponent's only
 * answer to a live 4 is [4|6], which leaves 6 and 2. The teammate then has
 * to pass. [1|4] changes the 4 into a 1 the teammate can play.
 */
function rescueState() {
  const log = [
    play("mate", 4, 3, "left", 3, 0, 4, 0),
    play("mate", 4, 0, "right", 4, 0, 4, 4),
    play("mate", 4, 5, "left", 5, 4, 4, 4),
    pass("mate", 2, 6),
    pass("mate", 0, 5),
    pass("opp", 0, 1),
    pass("opp", 2, 3),
    pass("opp", 5, 5),
    pass("far", 1, 2),
    pass("far", 3, 4),
    pass("far", 5, 6)
  ];
  const hands = {
    me: [tile(4, 4), tile(4, 1)],
    opp: [tile(4, 6), tile(6, 6)],
    mate: [tile(1, 1), tile(1, 3)],
    far: [tile(0, 0)]
  };
  const ids = []
    .concat(hands.me, hands.opp, hands.mate, hands.far)
    .map((item) => item.id)
    .concat(log.filter((event) => event.tile).map((event) => event.tile.id));
  return {
    selfId: "me",
    hand: hands.me,
    validMoves: [
      { tileId: "4-4", side: "left" },
      { tileId: "1-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 2,
    chain: chainExcept(ids),
    players: [
      { id: "me", handCount: 2, team: "A" },
      { id: "opp", handCount: 2, team: "B" },
      { id: "mate", handCount: 2, team: "A" },
      { id: "far", handCount: 1, team: "B" }
    ],
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: log
  };
}

function predict(state, options) {
  return getDominoMove(state, Object.assign({
    explain: true,
    seed: 4,
    limits: { samples: 4, maxMs: 0, maxNodes: 4000 }
  }, options || {}));
}

function row(result, id) {
  return result.diagnostics.candidateEvaluations.find((item) => item.tileId === id);
}

test("the forecast rescues a teammate the immediate board would trap", () => {
  const state = rescueState();
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  assert.equal(beliefs.mate.intention.preferred, 4);
  assert.ok(beliefs.mate.intention.confidence >= 0.45);
  assert.ok(beliefs.mate.knownImpossibleNumbers.indexOf(2) >= 0);
  assert.ok(beliefs.opp.knownImpossibleNumbers.indexOf(1) >= 0);
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const dealt = sampleAllocation(view, beliefs, mulberry32(seed));
    assert.ok(dealt.allocation, dealt.conflict);
    const ids = ["opp", "mate", "far"].map((id) => dealt.allocation[id].map((item) => item.id).sort().join(","));
    seen.add(ids.join("|"));
  }
  assert.equal(seen.size, 1);

  const quiet = getDominoMove(state, { explain: true, limits: { samples: 0, maxMs: 0 } });
  assert.equal(quiet.tileId, "4-4");
  const futureOff = predict(state, { ignoreFuture: true });
  assert.equal(futureOff.tileId, "4-4");
  assert.equal(futureOff.diagnostics.nextTurn.available, false);

  const move = predict(state);
  assert.equal(move.tileId, "1-4");
  assert.equal(move.side, "left");
  const kept = row(move, "4-4").prediction;
  const changed = row(move, "1-4").prediction;
  assert.equal(kept.pForcedAbandon, 1);
  assert.equal(kept.pPreferredRemoved, 1);
  assert.equal(kept.pTeammatePass, 1);
  assert.equal(kept.pTeammatePlay, 0);
  assert.deepEqual(
    { left: kept.modalEnds.left, right: kept.modalEnds.right },
    { left: 6, right: 2 }
  );
  assert.equal(kept.actions[0].playerId, "opp");
  assert.equal(kept.actions[0].type, "play");
  assert.equal(kept.actions[0].exposed, 6);
  assert.equal(kept.actions[0].forced, true);
  assert.equal(changed.pTeammatePlay, 1);
  assert.equal(changed.pTeammatePass, 0);
  assert.equal(changed.actions[0].type, "pass");
  assert.ok(changed.mean > kept.mean);
  assert.equal(move.diagnostics.stage, "forecast");
  assert.equal(move.diagnostics.nextTurn.available, true);
  assert.match(move.diagnostics.nextTurn.lines.join(" "), /1-4|\[1\|4\]/);
  const hidden = ["1-1", "1-3", "4-6", "6-6", "0-0"];
  const blob = JSON.stringify(move.diagnostics);
  hidden.forEach((id) => assert.equal(blob.includes(id), false, id));
  const panel = client.planView(move.diagnostics);
  const section = panel.sections.find((item) => item.heading === "Next turn prediction");
  assert.ok(section);
  assert.match(section.lines.join(" "), /simulated means/);
});

test("a one-tile opponent reply is forced, and a two-tile reply prefers the heavier denial", () => {
  const state = rescueState();
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  const weights = mergeWeights();
  const forced = {
    opp: [tile(4, 6), tile(6, 6)],
    mate: [tile(1, 1), tile(1, 3)],
    far: [tile(0, 0)],
    boneyard: []
  };
  const line = forecastLine(view, { tileId: "4-4", side: "left" }, forced, beliefs, weights, {}, mulberry32(1));
  assert.equal(line.steps[0].forced, true);
  assert.equal(line.steps[0].exposed, 6);
  assert.equal(line.partner.forcedAbandon, true);

  const choice = {
    opp: [tile(4, 6), tile(4, 1)],
    mate: [tile(2, 2)],
    far: [tile(0, 0)],
    boneyard: []
  };
  const picked = forecastLine(view, { tileId: "4-4", side: "left" }, choice, beliefs, weights, {}, mulberry32(1));
  assert.equal(picked.steps[0].forced, false);
  assert.equal(picked.steps[0].exposed, 6);
  const again = forecastLine(view, { tileId: "4-4", side: "left" }, choice, beliefs, weights, {}, mulberry32(9));
  assert.equal(again.steps[0].exposed, 6);
});

test("turn order comes from the seat list, and the same board can hide different hands", () => {
  const state = rescueState();
  const swapped = Object.assign({}, state, {
    players: [
      state.players[0],
      state.players[2],
      state.players[1],
      state.players[3]
    ]
  });
  const view = normalize(swapped);
  const beliefs = buildBeliefs(view);
  const dealt = sampleAllocation(view, beliefs, mulberry32(1));
  const line = forecastLine(
    view,
    { tileId: "1-4", side: "left" },
    dealt.allocation,
    beliefs,
    mergeWeights(),
    {},
    mulberry32(1)
  );
  assert.equal(line.steps[0].playerId, "mate");

  const open = rescueState();
  open.log = open.log.filter((event) => event.playerId !== "far" && !(event.playerId === "opp" && event.leftEnd === 0));
  const openView = normalize(open);
  const openBeliefs = buildBeliefs(openView);
  const owners = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const sample = sampleAllocation(openView, openBeliefs, mulberry32(seed));
    assert.ok(sample.allocation, sample.conflict);
    const far = sample.allocation.far.map((item) => item.id).join(",");
    owners.add(far);
  }
  assert.ok(owners.size > 1, Array.from(owners).join(" / "));
});

test("an immediate own finish outranks keeping the teammate's number", () => {
  const state = rescueState();
  state.hand = [tile(4, 2)];
  state.validMoves = [{ tileId: "2-4", side: "right" }];
  state.players[0].handCount = 1;
  const move = predict(state);
  assert.equal(move.tileId, "2-4");
  assert.ok(move.diagnostics.scores[0].score >= 100);
  assert.equal(move.diagnostics.mode.code, "FINISH_OWN_HAND");
});

test("the teammate's finish is taken when it scores more than a kept number", () => {
  const state = rescueState();
  state.hand = [tile(4, 4), tile(4, 1)];
  const mate = state.players.find((player) => player.id === "mate");
  mate.handCount = 1;
  state.log = state.log.filter((event) => event.type !== "pass" || event.playerId !== "mate" || event.leftEnd !== 0);
  const ids = ["4-4", "1-4", "4-6", "6-6", "1-1", "0-0", "3-4", "0-4", "4-5"];
  state.chain = chainExcept(ids);
  const move = predict(state);
  const finish = row(move, "1-4");
  const keep = row(move, "4-4");
  assert.ok(finish && keep);
  assert.equal(finish.prediction.pTeammateFinish, 1);
  assert.equal(keep.prediction.pTeammateFinish, 0);
  assert.ok(finish.prediction.mean > keep.prediction.mean);
  assert.equal(move.tileId, "1-4");
});

test("a line that ends the round before the next turn is reported as such", () => {
  const state = rescueState();
  state.players.find((player) => player.id === "opp").handCount = 1;
  const ids = ["4-4", "1-4", "4-6", "1-1", "1-3", "0-0", "3-4", "0-4", "4-5"];
  state.chain = chainExcept(ids);
  const move = predict(state);
  const keep = row(move, "4-4").prediction;
  assert.equal(keep.pRoundEnds, 1);
  assert.equal(keep.modalEnds, null);
  assert.match(move.diagnostics.nextTurn.lines.join(" "), /opp/);
});

test("tile counts stay exact and a favorable block beats an open board", () => {
  const state = rescueState();
  const inventory = buildInventory(normalize(state));
  inventory.byPip.forEach((pip) => {
    assert.equal(pip.total, 7);
    assert.equal(pip.inHand + pip.played + pip.unseen, 7);
  });

  const log = [
    pass("opp", 0, 1),
    pass("opp", 2, 3),
    pass("opp", 5, 5),
    pass("mate", 0, 1),
    pass("mate", 3, 4),
    pass("mate", 5, 6),
    pass("far", 1, 2),
    pass("far", 4, 5),
    pass("far", 6, 6)
  ];
  const hands = {
    me: [tile(0, 0), tile(0, 5)],
    opp: [tile(6, 6), tile(4, 4)],
    mate: [tile(2, 2)],
    far: [tile(0, 3)]
  };
  const ids = [].concat(hands.me, hands.opp, hands.mate, hands.far).map((item) => item.id);
  const blocked = {
    selfId: "me",
    hand: hands.me,
    validMoves: [
      { tileId: "0-0", side: "left" },
      { tileId: "0-5", side: "left" }
    ],
    leftEnd: 0,
    rightEnd: 1,
    chain: chainExcept(ids),
    players: [
      { id: "me", handCount: 2, team: "A" },
      { id: "opp", handCount: 2, team: "B" },
      { id: "mate", handCount: 1, team: "A" },
      { id: "far", handCount: 1, team: "B" }
    ],
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: log
  };
  const view = normalize(blocked);
  const beliefs = buildBeliefs(view);
  const weights = mergeWeights();
  const allocation = {
    opp: hands.opp,
    mate: hands.mate,
    far: hands.far,
    boneyard: []
  };
  const closed = forecastLine(view, { tileId: "0-5", side: "left" }, allocation, beliefs, weights, {}, mulberry32(1));
  const open = forecastLine(view, { tileId: "0-0", side: "left" }, allocation, beliefs, weights, {}, mulberry32(1));
  assert.equal(closed.winReason, "blocked");
  assert.ok(closed.value > 0);
  assert.equal(open.winnerId, "far");
  assert.ok(closed.value > open.value);
  const chosen = predict(blocked);
  assert.equal(chosen.tileId, "0-5");
  assert.equal(row(chosen, "0-5").prediction.counts.ended, row(chosen, "0-5").prediction.samples);
  assert.ok(row(chosen, "0-5").prediction.mean > row(chosen, "0-0").prediction.mean);
});

test("preserving a number is refused when that line hands the opponent the round", () => {
  const state = rescueState();
  state.players.find((player) => player.id === "far").handCount = 1;
  state.log = state.log.filter((event) => event.playerId !== "far");
  const ids = ["4-4", "1-4", "4-6", "6-6", "1-1", "1-3", "2-2", "3-4", "0-4", "4-5"];
  state.chain = chainExcept(ids);
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  const allocation = {
    opp: [tile(4, 6), tile(3, 3)],
    mate: [tile(1, 1), tile(1, 3)],
    far: [tile(6, 6)],
    boneyard: []
  };
  const weights = mergeWeights();
  const kept = forecastLine(view, { tileId: "4-4", side: "left" }, allocation, beliefs, weights, {}, mulberry32(1));
  const safe = forecastLine(view, { tileId: "1-4", side: "left" }, allocation, beliefs, weights, {}, mulberry32(1));
  assert.equal(kept.winnerId, "far");
  assert.ok(kept.value < 0);
  assert.ok(safe.value > kept.value);
  assert.notEqual(safe.winnerId, "far");
});
