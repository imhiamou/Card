"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");

function room(ids, match) {
  return {
    players: ids.map((id) => ({ id: id, name: id })),
    dominoMatch: match || null,
    dominoBotTimer: null
  };
}

function holderOf(hands, tileId) {
  return Object.keys(hands).find((id) => (hands[id] || []).some((tile) => tile.id === tileId));
}

describe("domino opening rules", () => {
  it("requires double-six to open the first round", () => {
    const hands = {
      a: [{ id: "6-6", a: 6, b: 6 }, { id: "1-2", a: 1, b: 2 }],
      b: [{ id: "5-5", a: 5, b: 5 }, { id: "0-1", a: 0, b: 1 }]
    };
    const plan = domino.planOpening(["a", "b"], hands, null);
    assert.equal(plan.firstRound, true);
    assert.equal(plan.starterId, "a");
    assert.equal(plan.mustPlayId, "6-6");

    const state = {
      firstRound: true,
      currentTurn: "a",
      mustPlayId: "6-6",
      chain: [],
      hands: hands
    };
    assert.equal(domino.openingPlayAllowed(state, "a", "6-6").ok, true);
    const rejected = domino.openingPlayAllowed(state, "a", "1-2");
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /double-six/);
    assert.equal(domino.openingPlayAllowed(state, "a", "5-5").ok, false);
    assert.equal(domino.openingPlayAllowed(state, "b", "6-6").ok, false);
  });

  it("deals the double-six to the first-round leader", () => {
    for (let i = 0; i < 12; i++) {
      const dealt = domino.dealHands(["a", "b"], { requireTileId: "6-6" });
      const holder = holderOf(dealt.hands, "6-6");
      assert.ok(holder);
      assert.equal(dealt.starterId, holder);
      assert.equal(dealt.mustPlayId, "6-6");
      assert.equal(dealt.hands.a.length, 7);
      assert.equal(dealt.hands.b.length, 7);
    }
    const table = room(["a", "b"]);
    domino.initRound(table);
    assert.equal(table.domino.firstRound, true);
    assert.equal(table.domino.chain.length, 0);
    assert.equal(table.domino.mustPlayId, "6-6");
    assert.equal(table.domino.currentTurn, holderOf(table.domino.hands, "6-6"));
  });

  it("lets the previous winner open a later round with any tile they hold", () => {
    const table = room(["a", "b"]);
    domino.initRound(table);
    table.domino.winnerId = "b";
    domino.rememberRoundWinner(table);
    domino.initRound(table);
    assert.equal(table.domino.firstRound, false);
    assert.equal(table.domino.mustPlayId, null);
    assert.equal(table.domino.currentTurn, "b");
    assert.equal(table.domino.chain.length, 0);
    const hand = table.domino.hands.b;
    hand.forEach((tile) => {
      assert.equal(domino.openingPlayAllowed(table.domino, "b", tile.id).ok, true, tile.id);
    });
    assert.equal(domino.openingPlayAllowed(table.domino, "a", hand[0].id).ok, false);
    const missing = domino.openingPlayAllowed(table.domino, "b", "9-9");
    assert.equal(missing.ok, false);
    assert.match(missing.error, /not in your hand/);
  });

  it("rejects a second opening play", () => {
    const state = {
      firstRound: false,
      currentTurn: "b",
      mustPlayId: null,
      chain: [],
      hands: { b: [{ id: "2-4", a: 2, b: 4 }, { id: "0-0", a: 0, b: 0 }] },
      leftEnd: null,
      rightEnd: null
    };
    assert.equal(domino.placeTile(state, state.hands.b[0], "center").id, "2-4");
    state.hands.b.shift();
    const again = domino.openingPlayAllowed(state, "b", "0-0");
    assert.equal(again.ok, false);
    assert.match(again.error, /already opened/);
  });

  it("keeps the later-round opening rule after a state restore", () => {
    const table = room(["a", "b"]);
    domino.initRound(table);
    table.domino.winnerId = "a";
    domino.rememberRoundWinner(table);
    domino.initRound(table);
    assert.equal(table.domino.chain.length, 0);
    const snap = domino.roundSnapshot(table.domino);
    const restored = domino.restoreRound(snap);
    assert.equal(restored.chain.length, 0);
    assert.equal(restored.firstRound, false);
    assert.equal(restored.currentTurn, "a");
    assert.equal(restored.mustPlayId, null);
    const tile = restored.hands.a[0];
    assert.equal(domino.openingPlayAllowed(restored, "a", tile.id).ok, true);
    assert.equal(domino.openingPlayAllowed(restored, "b", tile.id).ok, false);
    assert.equal(domino.planOpening(["a", "b"], restored.hands, { roundsCompleted: 1, lastWinnerId: "a" }).firstRound, false);
  });
});
