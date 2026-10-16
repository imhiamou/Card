"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");
const { getDominoMove, normalize } = require("./bots/domino/ai");
const { buildBeliefs } = require("./bots/domino/beliefs");
const { resolvePlan, clearPlans, planStats } = require("./bots/domino/plan");
const client = require("../assets/domino-inspect");

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

function pass(id, left, right) {
  return { type: "pass", playerId: id, leftEnd: left, rightEnd: right };
}

function seats(counts, order) {
  const ids = order || ["me", "opp", "mate", "far"];
  const teams = { me: "A", mate: "A", opp: "B", far: "B", hold: "A" };
  return ids.map((id, index) => ({ id: id, handCount: counts[index], team: teams[id] || "B" }));
}

function base(extra) {
  return Object.assign({
    selfId: "me",
    players: seats([4, 4, 4, 4]),
    teamMode: true,
    teamA: ["me", "mate"],
    teamB: ["opp", "far"],
    boneyardCount: 0,
    log: []
  }, extra || {});
}

function chainExcept(ids) {
  const skip = new Set(ids);
  return domino.buildDoubleSixSet().filter((item) => !skip.has(item.id));
}

function decide(state, options) {
  return getDominoMove(state, Object.assign({ explain: true }, quiet, options || {}));
}

function belief(state) {
  return buildBeliefs(normalize(state));
}

function row(result, id) {
  return result.diagnostics.candidateEvaluations.find((item) => item.tileId === id);
}

test("matched, exposed, and strategic numbers stay distinct", () => {
  clearPlans();
  const state = base({
    hand: [tile(0, 0), tile(5, 6), tile(2, 2), tile(6, 6)],
    validMoves: [{ tileId: "2-2", side: "left" }],
    leftEnd: 2,
    rightEnd: 4,
    log: [
      play("mate", 1, 3, "right", 2, 1, 2, 3),
      play("mate", 4, 3, "right", 2, 3, 2, 4)
    ]
  });
  const pip = belief(state).mate.intention.byPip;
  assert.equal(pip[1].matched, 1);
  assert.equal(pip[1].exposedPlays, 0);
  assert.ok(pip[1].confidence < 0.45);
  assert.equal(pip[4].matched, 0);
  assert.equal(pip[4].exposedPlays, 1);
  assert.equal(pip[4].confidence, 0);
  assert.ok(pip[3].inTile > pip[4].inTile);
  assert.ok(pip[3].strategic > pip[1].strategic);
  assert.ok(pip[3].strategic > pip[4].strategic);
  assert.ok(pip[3].confidence >= 0.45);
  assert.equal(belief(state).mate.intention.preferred, 3);
});

test("a different bridging sequence infers that number without a special case", () => {
  clearPlans();
  const state = base({
    hand: [tile(0, 0), tile(1, 1), tile(2, 2), tile(3, 3)],
    validMoves: [{ tileId: "0-0", side: "left" }],
    leftEnd: 0,
    rightEnd: 4,
    log: [
      play("mate", 1, 6, "right", 0, 1, 0, 6),
      play("mate", 4, 6, "right", 0, 6, 0, 4)
    ]
  });
  const intention = belief(state).mate.intention;
  assert.equal(intention.preferred, 6);
  assert.ok(intention.byPip[6].bridged > 0);
  assert.ok(intention.byPip[6].confidence > intention.byPip[1].confidence);
  assert.ok(intention.byPip[6].confidence > intention.byPip[4].confidence);
  assert.equal(intention.byPip[4].confidence, 0);
});

test("playing away from a preferred number lowers it and records a soft miss", () => {
  clearPlans();
  const hand = [tile(0, 5), tile(2, 5), tile(4, 5), tile(5, 6)];
  const beforeLog = [
    play("mate", 5, 5, "right", 2, 5, 2, 5),
    play("mate", 5, 1, "right", 2, 5, 2, 1)
  ];
  const before = belief(base({
    hand: hand,
    leftEnd: 5,
    rightEnd: 3,
    log: beforeLog
  }));
  assert.equal(before.mate.intention.preferred, 5);
  assert.ok(before.mate.intention.confidence > 0.8);
  const afterState = base({
    hand: hand,
    validMoves: [
      { tileId: "0-5", side: "left" },
      { tileId: "0-5", side: "right" }
    ],
    leftEnd: 5,
    rightEnd: 0,
    chain: [tile(5, 5), tile(5, 1), tile(3, 0)],
    players: seats([4, 3, 3, 4]),
    log: beforeLog.concat([play("mate", 3, 0, "right", 5, 3, 5, 0)])
  });
  const after = belief(afterState);
  const five = after.mate.intention.byPip[5];
  assert.notEqual(after.mate.intention.preferred, 5);
  assert.ok(five.confidence < before.mate.intention.byPip[5].confidence);
  assert.ok(five.absent > 0);
  assert.ok(five.missed > 0.5);
  assert.ok(five.pAtLeastOne > 0);
  assert.ok(five.pAtLeastOne < 0.35);
  assert.equal(after.mate.knownImpossibleNumbers.indexOf(5), -1);
  const move = decide(afterState);
  const keep = row(move, "0-5");
  const rows = move.diagnostics.candidateEvaluations.filter((item) => item.tileId === "0-5");
  const kept = rows.find((item) => item.side === "right");
  const changed = rows.find((item) => item.side === "left");
  assert.ok(kept.parts.mateVoidHarm < changed.parts.mateVoidHarm);
  assert.ok(keep);
});

test("passes and remaining counts constrain hidden hands", () => {
  clearPlans();
  const state = base({
    hand: [tile(3, 3), tile(4, 4), tile(6, 6)],
    validMoves: [{ tileId: "3-3", side: "left" }],
    leftEnd: 3,
    rightEnd: 6,
    players: seats([3, 5, 5, 5]),
    log: [
      pass("opp", 2, 5),
      play("mate", 1, 1, "left", 1, 2, 1, 2)
    ]
  });
  const view = normalize(state);
  const beliefs = buildBeliefs(view);
  const inventory = beliefs._inventory;
  assert.deepEqual(beliefs.opp.knownImpossibleNumbers, [2, 5]);
  assert.equal(beliefs.opp.intention.byPip[2].expectedTiles, 0);
  assert.equal(beliefs.opp.intention.byPip[2].pAtLeastOne, 0);
  assert.equal(beliefs.opp.intention.byPip[5].pAtLeastOne, 0);
  inventory.byPip.forEach((pip) => {
    assert.equal(pip.total, 7);
    assert.equal(pip.inHand + pip.played + pip.unseen, 7);
    const expected = (pip.holders || []).reduce((sum, holder) => sum + holder.expected, 0);
    assert.ok(Math.abs(expected - pip.unseen) < 0.02);
  });
  assert.ok(beliefs.mate.intention.byPip[3].pAtLeastOne > 0);
  assert.ok(beliefs.mate.intention.byPip[3].pAtLeastOne < 1);
});

test("an uncertain hand estimate is not stored as a proven void", () => {
  clearPlans();
  const state = base({
    hand: [tile(0, 0), tile(5, 6), tile(2, 2), tile(6, 6)],
    validMoves: [{ tileId: "2-2", side: "left" }],
    leftEnd: 2,
    rightEnd: 4,
    log: [
      play("mate", 1, 3, "right", 2, 1, 2, 3),
      play("mate", 4, 3, "right", 2, 3, 2, 4)
    ]
  });
  const info = belief(state).mate.intention.byPip[3];
  assert.ok(info.confidence > 0.45);
  assert.ok(info.confidence < 1);
  assert.ok(info.pAtLeastOne > 0);
  assert.ok(info.pAtLeastOne < 1);
  assert.ok(info.pMultiple < 1);
  assert.equal(belief(state).mate.knownImpossibleNumbers.length, 0);
});

test("the forecast expects an opponent to change an exposed strategic end", () => {
  clearPlans();
  const bridge = [
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ];
  const passes = [
    pass("opp", 0, 2),
    pass("opp", 5, 4),
    pass("mate", 0, 1),
    pass("mate", 6, 6),
    pass("far", 3, 4)
  ];
  const hands = {
    me: [tile(2, 3), tile(4, 6), tile(5, 5)],
    opp: [tile(3, 6), tile(1, 1)],
    mate: [tile(3, 5), tile(2, 5)],
    far: [tile(0, 0)]
  };
  const log = bridge.concat(passes);
  const ids = []
    .concat(hands.me, hands.opp, hands.mate, hands.far)
    .map((item) => item.id)
    .concat(log.filter((event) => event.tile).map((event) => event.tile.id));
  const state = {
    selfId: "me",
    hand: hands.me,
    validMoves: [
      { tileId: "2-3", side: "left" },
      { tileId: "4-6", side: "right" }
    ],
    leftEnd: 2,
    rightEnd: 4,
    chain: chainExcept(ids),
    players: [
      { id: "me", handCount: 3, team: "A" },
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
  const move = getDominoMove(state, {
    explain: true,
    seed: 7,
    limits: { samples: 4, maxMs: 0, maxNodes: 4000 }
  });
  assert.equal(move.diagnostics.strategy.mode, "teammate-support");
  assert.equal(move.diagnostics.strategy.target, 3);
  assert.equal(move.diagnostics.strategy.owner, "teammate");
  const exposed = row(move, "2-3").prediction;
  const other = row(move, "4-6").prediction;
  assert.equal(exposed.pPreferredRemoved, 1);
  assert.equal(exposed.pTeammatePass, 1);
  assert.equal(exposed.actions[0].playerId, "opp");
  assert.equal(exposed.actions[0].exposed, 6);
  assert.equal(other.pPreferredSurvives, 1);
  assert.equal(other.pTeammatePlay, 1);
  assert.equal(other.modalEnds.left, 5);
  assert.equal(other.modalEnds.right, 3);
  assert.equal(move.tileId, "4-6");
  assert.ok(other.mean > exposed.mean);
  const hidden = ["3-6", "1-1", "3-5", "2-5", "0-0"];
  const blob = JSON.stringify(move.diagnostics);
  hidden.forEach((id) => assert.equal(blob.includes(id), false, id));
});

test("a hand with a real count advantage commits to self-control", () => {
  clearPlans();
  const state = base({
    hand: [tile(4, 4), tile(4, 0), tile(4, 1), tile(4, 2)],
    validMoves: [
      { tileId: "4-4", side: "left" },
      { tileId: "0-4", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 6,
    chain: [tile(4, 6)],
    log: []
  });
  const move = decide(state);
  assert.equal(move.diagnostics.strategy.mode, "self-control");
  assert.equal(move.diagnostics.strategy.target, 4);
  assert.equal(move.diagnostics.strategy.owner, "self");
  assert.ok(move.diagnostics.strategy.confidence > 0);
  assert.ok(row(move, "4-4").parts.planFit > 0);
  assert.equal(row(move, "0-4").parts.planFit, 0);
  assert.equal(move.tileId, "4-4");
});

test("the bot supports a teammate number when its own hand has no count advantage", () => {
  clearPlans();
  const state = base({
    hand: [tile(0, 1), tile(2, 6), tile(3, 5)],
    validMoves: [
      { tileId: "2-6", side: "left" },
      { tileId: "3-5", side: "right" }
    ],
    leftEnd: 2,
    rightEnd: 3,
    chain: [tile(1, 3), tile(3, 4)],
    log: [
      play("mate", 1, 3, "right", 2, 1, 2, 3),
      play("mate", 4, 3, "right", 2, 3, 2, 4)
    ]
  });
  const move = decide(state);
  assert.equal(move.diagnostics.strategy.mode, "teammate-support");
  assert.equal(move.diagnostics.strategy.target, 3);
  assert.equal(move.diagnostics.strategy.owner, "teammate");
  assert.ok(row(move, "2-6").parts.planFit > row(move, "3-5").parts.planFit);
});

test("the bot denies an opponent who is the only player building a number", () => {
  clearPlans();
  const state = base({
    hand: [tile(0, 1), tile(2, 3), tile(2, 4)],
    validMoves: [
      { tileId: "2-4", side: "left" },
      { tileId: "0-1", side: "right" }
    ],
    leftEnd: 4,
    rightEnd: 1,
    chain: [tile(4, 4), tile(4, 1), tile(4, 6)],
    log: [
      play("opp", 4, 4, "left", 4, 0, 4, 0),
      play("opp", 4, 1, "right", 4, 1, 4, 4),
      play("opp", 4, 6, "left", 6, 4, 4, 4)
    ]
  });
  const move = decide(state);
  assert.equal(move.diagnostics.strategy.mode, "opponent-denial");
  assert.equal(move.diagnostics.strategy.target, 4);
  assert.equal(move.diagnostics.strategy.owner, "opponent");
  assert.ok(row(move, "0-1").parts.planFit > 0);
  assert.equal(row(move, "2-4").parts.planFit, 0);
});

test("a plan is kept when a later pass does not change the evidence", () => {
  clearPlans();
  const hand = [tile(4, 4), tile(4, 0), tile(4, 1), tile(4, 2)];
  const first = decide(base({
    selfId: "hold",
    hand: hand,
    validMoves: [{ tileId: "4-4", side: "left" }],
    leftEnd: 4,
    rightEnd: 3,
    players: seats([4, 4, 4, 4], ["hold", "opp", "mate", "far"]),
    teamA: ["hold", "mate"],
    log: []
  }));
  const second = decide(base({
    selfId: "hold",
    hand: hand,
    validMoves: [{ tileId: "4-4", side: "left" }],
    leftEnd: 4,
    rightEnd: 3,
    players: seats([4, 4, 4, 4], ["hold", "opp", "mate", "far"]),
    teamA: ["hold", "mate"],
    log: [pass("far", 1, 2)]
  }));
  assert.equal(first.diagnostics.strategy.mode, "self-control");
  assert.equal(first.diagnostics.strategy.held, false);
  assert.equal(second.diagnostics.strategy.mode, "self-control");
  assert.equal(second.diagnostics.strategy.target, 4);
  assert.equal(second.diagnostics.strategy.held, true);
  assert.equal(second.diagnostics.strategy.switched, false);
  assert.match(second.diagnostics.strategy.lines.join(" "), /Keeping/);
});

test("a plan is dropped when the hand no longer has that count advantage", () => {
  clearPlans();
  const full = [tile(4, 4), tile(4, 0), tile(4, 1), tile(4, 2), tile(3, 5)];
  const start = normalize(base({
    selfId: "hold",
    hand: full,
    validMoves: [{ tileId: "4-4", side: "left" }],
    leftEnd: 4,
    rightEnd: 6,
    players: seats([5, 4, 4, 4], ["hold", "opp", "mate", "far"]),
    teamA: ["hold", "mate"]
  }));
  const first = resolvePlan(start, buildBeliefs(start), {});
  assert.equal(first.mode, "self-control");
  assert.equal(first.target, 4);
  const later = normalize(base({
    selfId: "hold",
    hand: [tile(4, 4), tile(3, 5)],
    validMoves: [{ tileId: "3-5", side: "right" }],
    leftEnd: 2,
    rightEnd: 5,
    players: seats([2, 4, 4, 4], ["hold", "opp", "mate", "far"]),
    teamA: ["hold", "mate"],
    log: [
      play("hold", 4, 0, "left", 4, 6, 0, 6),
      play("hold", 4, 1, "left", 4, 6, 1, 6),
      play("hold", 4, 2, "left", 4, 6, 2, 6)
    ]
  }));
  const second = resolvePlan(later, buildBeliefs(later), {});
  assert.equal(buildBeliefs(later)._inventory.byPip[4].inHand, 1);
  assert.equal(second.mode, "none");
  assert.equal(second.switched, true);
  assert.equal(second.held, false);
  assert.match(second.lines.join(" "), /dropped/);
  const stats = planStats();
  assert.ok(stats.switched >= 1);
  assert.ok(stats.started >= 1);
});

test("a teammate finish outranks the committed self-control plan", () => {
  clearPlans();
  const state = base({
    hand: [tile(4, 4), tile(4, 0), tile(4, 1), tile(4, 6)],
    validMoves: [
      { tileId: "4-4", side: "left" },
      { tileId: "4-6", side: "left" }
    ],
    leftEnd: 4,
    rightEnd: 2,
    players: seats([4, 1, 4, 4], ["me", "mate", "opp", "far"]),
    log: [pass("mate", 0, 1), pass("mate", 2, 3), pass("mate", 4, 5)]
  });
  const move = decide(state);
  assert.equal(move.diagnostics.strategy.mode, "self-control");
  assert.equal(move.diagnostics.strategy.target, 4);
  assert.equal(move.tileId, "4-6");
  assert.ok(row(move, "4-6").parts.mateFinish > row(move, "4-4").parts.planFit);
  assert.equal(row(move, "4-4").parts.immediateWin, 0);
  const only = decide(base({
    hand: [tile(6, 6)],
    validMoves: [{ tileId: "6-6", side: "left" }],
    leftEnd: 6,
    rightEnd: 2,
    players: seats([1, 4, 4, 4]),
    log: [
      play("mate", 1, 3, "right", 2, 1, 2, 3),
      play("mate", 4, 3, "right", 2, 3, 2, 4)
    ]
  }));
  assert.equal(only.tileId, "6-6");
  assert.equal(only.diagnostics.strategy.mode, "teammate-support");
  assert.equal(row(only, "6-6").parts.immediateWin, 100);
  assert.equal(row(only, "6-6").parts.planFit, 0);
});

test("the inspector shows the recorded plan and the next-turn prediction", () => {
  clearPlans();
  const bridge = [
    play("mate", 1, 3, "right", 2, 1, 2, 3),
    play("mate", 3, 4, "right", 2, 3, 2, 4)
  ];
  const passes = [
    pass("opp", 0, 2),
    pass("opp", 5, 4),
    pass("mate", 0, 1),
    pass("mate", 6, 6),
    pass("far", 3, 4)
  ];
  const hands = {
    me: [tile(2, 3), tile(4, 6), tile(5, 5)],
    opp: [tile(3, 6), tile(1, 1)],
    mate: [tile(3, 5), tile(2, 5)],
    far: [tile(0, 0)]
  };
  const log = bridge.concat(passes);
  const ids = []
    .concat(hands.me, hands.opp, hands.mate, hands.far)
    .map((item) => item.id)
    .concat(log.filter((event) => event.tile).map((event) => event.tile.id));
  const state = {
    selfId: "me",
    hand: hands.me,
    validMoves: [
      { tileId: "2-3", side: "left" },
      { tileId: "4-6", side: "right" }
    ],
    leftEnd: 2,
    rightEnd: 4,
    chain: chainExcept(ids),
    players: [
      { id: "me", handCount: 3, team: "A" },
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
  const move = getDominoMove(state, {
    explain: true,
    seed: 7,
    limits: { samples: 4, maxMs: 0, maxNodes: 4000 }
  });
  const panel = client.planView(move.diagnostics);
  const plan = panel.sections.find((item) => item.heading === "Strategic plan");
  const next = panel.sections.find((item) => item.heading === "Next turn prediction");
  assert.ok(plan);
  assert.match(plan.lines.join(" "), /teammate-support/);
  assert.match(plan.lines.join(" "), /on 3/);
  assert.match(plan.lines.join(" "), /teammate/);
  assert.ok(next);
  assert.match(next.lines.join(" "), /5 and 3/);
  assert.match(next.lines.join(" "), /opp/);
  assert.match(next.lines.join(" "), /keeps the preferred number/);
  assert.match(next.lines.join(" "), /4\|6|4-6/);
  assert.equal(move.diagnostics.strategy.mode, panel.sections ? move.diagnostics.strategy.mode : "");
  assert.equal(JSON.stringify(move.diagnostics).includes("3-6"), false);
});
