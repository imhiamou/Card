"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const uno = require("./uno");
const bot = require("./bots/unoBot");
const baseline = require("./bots/unoBotBaseline");
const sim = require("./bots/unoSim");

function card(id, color, kind, value) {
  return { id, color, kind, value: value == null ? (kind === "number" ? 0 : kind) : value };
}

function colorSuit(color) {
  const cards = [card(color + "-0", color, "number", 0)];
  for (let value = 1; value <= 9; value++) {
    cards.push(card(color + "-" + value + "a", color, "number", value));
    cards.push(card(color + "-" + value + "b", color, "number", value));
  }
  ["skip", "reverse", "draw2"].forEach((kind) => {
    cards.push(card(color + "-" + kind + "a", color, kind));
    cards.push(card(color + "-" + kind + "b", color, kind));
  });
  return cards;
}

function seats(counts) {
  return counts.map((handCount) => ({ handCount, away: false }));
}

function view(extra) {
  return Object.assign({
    pendingPenalty: 0,
    pendingKind: null,
    direction: 1,
    turnIndex: 0,
    discard: [card("top", "red", "number", 4)]
  }, extra);
}

describe("UNO strategy bot", { concurrency: false }, () => {
  test("an immediate win is taken before any other scoring", () => {
    const only = card("last", "blue", "number", 1);
    const move = bot.getUnoMove(view({
      hand: [only],
      playableIds: ["last"],
      seats: seats([1, 1]),
      nextPlayerHandCount: 1
    }));
    assert.deepEqual(move, { cardId: "last" });

    const wild = card("w", null, "wild");
    const winningWild = bot.getUnoMove(view({
      hand: [wild],
      playableIds: ["w"],
      seats: seats([1, 2])
    }));
    assert.equal(winningWild.cardId, "w");
    assert.ok(bot.COLORS.indexOf(winningWild.color) >= 0);
  });

  test("two ordinary cards are separated by the hand they leave", () => {
    const red9 = card("r9", "red", "number", 9);
    const red2 = card("r2", "red", "number", 2);
    const blue9 = card("b9", "blue", "number", 9);
    const move = bot.getUnoMove(view({
      hand: [red9, red2, blue9],
      playableIds: ["r9", "b9"],
      seats: seats([3, 6]),
      nextPlayerHandCount: 6
    }));
    assert.equal(move.cardId, "r9");
    const playedRed = bot.evaluateChoice(bot.normalize(view({
      hand: [red9, red2, blue9],
      playableIds: ["r9", "b9"],
      seats: seats([3, 6])
    })), red9, "red", 0);
    const playedBlue = bot.evaluateChoice(bot.normalize(view({
      hand: [red9, red2, blue9],
      playableIds: ["r9", "b9"],
      seats: seats([3, 6])
    })), blue9, "blue", 1);
    assert.ok(playedRed.parts.colorControl > playedBlue.parts.colorControl);
  });

  test("a wild is kept when a colored run works and spent to escape a dead color", () => {
    const keep = bot.getUnoMove(view({
      hand: [
        card("r1", "red", "number", 1),
        card("r5", "red", "number", 5),
        card("r9", "red", "number", 9),
        card("w", null, "wild")
      ],
      playableIds: ["r1", "r5", "r9", "w"],
      seats: seats([4, 6]),
      nextPlayerHandCount: 6
    }));
    assert.notEqual(keep.cardId, "w");

    const spend = bot.getUnoMove(view({
      hand: [
        card("b3", "blue", "number", 3),
        card("w", null, "wild"),
        card("r1", "red", "number", 1),
        card("r2", "red", "number", 2),
        card("r5", "red", "number", 5),
        card("r8", "red", "number", 8)
      ],
      playableIds: ["b3", "w"],
      discard: [card("top", "blue", "number", 9)],
      seats: seats([6, 6]),
      nextPlayerHandCount: 6
    }));
    assert.deepEqual(spend, { cardId: "w", color: "red" });
  });

  test("wild color follows the remaining hand, with a documented color tie-break", () => {
    assert.equal(bot.pickColor([
      card("g1", "green", "number", 3),
      card("g2", "green", "number", 8),
      card("b1", "blue", "number", 1),
      card("b2", "blue", "number", 4)
    ]), "blue");
    assert.equal(bot.pickColor([]), "red");

    const move = bot.getUnoMove(view({
      hand: [
        card("w", null, "wild"),
        card("g1", "green", "number", 2),
        card("g2", "green", "number", 8),
        card("b1", "blue", "number", 4)
      ],
      playableIds: ["w"],
      seats: seats([4, 6])
    }));
    assert.deepEqual(move, { cardId: "w", color: "green" });
  });

  test("the threatened seat follows direction, not the left-hand neighbor", () => {
    const hand = [
      card("rs", "red", "skip"),
      card("r5", "red", "number", 5),
      card("r8", "red", "number", 8),
      card("r2", "red", "number", 2)
    ];
    const againstFlow = bot.getUnoMove(view({
      hand,
      playableIds: ["rs", "r5", "r8", "r2"],
      direction: -1,
      seats: seats([4, 7, 7, 1])
    }));
    assert.equal(againstFlow.cardId, "rs");

    const notNext = bot.getUnoMove(view({
      hand,
      playableIds: ["rs", "r5", "r8", "r2"],
      direction: 1,
      seats: seats([4, 7, 1, 7])
    }));
    assert.notEqual(notNext.cardId, "rs");
  });

  test("reverse and skip use the player count", () => {
    const hand = [
      card("rs", "red", "skip"),
      card("rr", "red", "reverse"),
      card("r9", "red", "number", 9),
      card("r3", "red", "number", 3)
    ];
    const headsUp = bot.getUnoMove(view({
      hand,
      playableIds: ["rs", "rr", "r9", "r3"],
      seats: seats([4, 1])
    }));
    assert.ok(headsUp.cardId === "rs" || headsUp.cardId === "rr");

    const four = bot.getUnoMove(view({
      hand,
      playableIds: ["rs", "rr", "r9", "r3"],
      seats: seats([4, 1, 6, 1])
    }));
    assert.equal(four.cardId, "rs");
  });

  test("a penalty stack only considers cards the rules allow", () => {
    const state = {
      discard: [card("top", "red", "wild4")],
      pendingPenalty: 4,
      pendingKind: "wild4"
    };
    state.discard[0].kind = "wild4";
    const draw2 = card("d2", "red", "draw2");
    const wild4 = card("w4", null, "wild4");
    const red5 = card("r5", "red", "number", 5);
    const hand = [draw2, wild4, red5];
    const playable = uno.listPlayable(state, hand);
    assert.deepEqual(playable, ["w4"]);
    const move = bot.getUnoMove(view({
      hand,
      playableIds: playable,
      pendingPenalty: 4,
      pendingKind: "wild4",
      discard: state.discard,
      seats: seats([3, 5])
    }));
    assert.equal(move.cardId, "w4");

    const stacked = {
      discard: [card("plus", "blue", "draw2")],
      pendingPenalty: 2,
      pendingKind: "draw2"
    };
    const both = [card("d2b", "yellow", "draw2"), card("w4b", null, "wild4"), card("y3", "yellow", "number", 3)];
    const legal = uno.listPlayable(stacked, both);
    assert.deepEqual(legal.sort(), ["d2b", "w4b"]);
    const preferDraw2 = bot.getUnoMove(view({
      hand: both,
      playableIds: legal,
      pendingPenalty: 2,
      pendingKind: "draw2",
      discard: stacked.discard,
      seats: seats([6, 6])
    }));
    assert.equal(preferDraw2.cardId, "d2b");
  });

  test("public color evidence matters only against a short threatened hand", () => {
    const greens = colorSuit("green").filter((item) => item.id !== "green-2a");
    const hand = [
      card("w", null, "wild"),
      card("green-2a", "green", "number", 2),
      card("b2", "blue", "number", 2)
    ];
    const scarce = bot.getUnoMove(view({
      hand,
      playableIds: ["w"],
      discard: greens,
      seats: seats([3, 1])
    }));
    assert.equal(scarce.color, "green");

    const quiet = bot.getUnoMove(view({
      hand,
      playableIds: ["w"],
      discard: greens,
      seats: seats([3, 7])
    }));
    assert.equal(quiet.color, "blue");
  });

  test("a forced miss changes a tied color and hidden cards still do not", () => {
    const hand = [
      card("w", null, "wild"),
      card("g2", "green", "number", 2),
      card("b2", "blue", "number", 2)
    ];
    const tied = view({
      hand,
      playableIds: ["w"],
      seats: seats([3, 1])
    });
    assert.equal(bot.getUnoMove(tied).color, "blue");
    const missed = view({
      hand,
      playableIds: ["w"],
      seats: seats([3, 1]),
      misses: [null, { color: "green", kind: "number", value: 4, blank: 1 }]
    });
    assert.equal(bot.getUnoMove(missed).color, "green");
    const decoy = bot.getUnoMove(Object.assign({}, missed, {
      opponentHands: [[card("blue-secret", "blue", "number", 9)]],
      drawPile: [card("pile", "green", "number", 1)]
    }));
    assert.equal(decoy.color, "green");
  });

  test("hidden hands and draw order are not inputs", () => {
    const base = view({
      hand: [
        card("r5", "red", "number", 5),
        card("r2", "red", "number", 2),
        card("b5", "blue", "number", 5),
        card("w", null, "wild")
      ],
      playableIds: ["r5", "b5", "w"],
      seats: seats([4, 2, 6]),
      direction: -1
    });
    const first = bot.getUnoMove(base);
    const second = bot.getUnoMove(Object.assign({}, base, {
      opponentHands: [[card("secret", "green", "number", 9)]],
      drawPile: [card("next", "yellow", "wild4"), card("after", "red", "skip")]
    }));
    assert.deepEqual(first, second);
    const profile = bot.unseenProfile(bot.normalize(base));
    assert.equal(profile.hand, undefined);
    assert.ok(profile.total < 108);
  });

  test("the same snapshot always produces the same choice", () => {
    const state = view({
      hand: [
        card("rs", "red", "skip"),
        card("r2", "red", "number", 2),
        card("w", null, "wild"),
        card("w4", null, "wild4")
      ],
      playableIds: ["rs", "r2", "w", "w4"],
      seats: seats([4, 1]),
      nextPlayerHandCount: 1
    });
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(JSON.stringify(bot.getUnoMove(state)));
    assert.equal(seen.size, 1);
    assert.equal(JSON.parse([...seen][0]).cardId, "rs");
  });

  test("selected moves stay inside the authoritative legal list", () => {
    let illegal = 0;
    let rounds = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const round = sim.playRound(2 + (seed % 5), seed, [
        sim.strategyNew, sim.strategyNew, sim.strategyNew, sim.strategyNew, sim.strategyNew, sim.strategyNew
      ].slice(0, 2 + (seed % 5)));
      illegal += round.illegal;
      if (round.finished) rounds += 1;
    }
    assert.equal(illegal, 0);
    assert.ok(rounds >= 10);
  });

  test("a round with the strategy bot finishes instead of spinning", () => {
    for (let players = 2; players <= 6; players++) {
      const strategies = [];
      for (let i = 0; i < players; i++) strategies.push(sim.strategyNew);
      const round = sim.playRound(players, 40 + players, strategies);
      assert.equal(round.stalled, false);
      assert.equal(round.finished, true);
      assert.equal(round.winnerCards, 0);
      assert.ok(round.steps < sim.MAX_TURNS);
    }
  });

  test("the frozen baseline still makes its old choices", () => {
    const red9 = card("r9", "red", "number", 9);
    const red1 = card("r1", "red", "number", 1);
    const blue4 = card("b4", "blue", "number", 4);
    const wild = card("w", null, "wild");
    const wild4 = card("w4", null, "wild4");
    assert.deepEqual(baseline.getUnoMove({
      hand: [red9, red1, blue4, wild, wild4],
      playableIds: ["r9", "r1", "b4", "w", "w4"],
      pendingPenalty: 0,
      nextPlayerHandCount: 5
    }), { cardId: "r9" });
    assert.deepEqual(baseline.getUnoMove({
      hand: [wild4, red9],
      playableIds: ["w4", "r9"],
      pendingPenalty: 0,
      nextPlayerHandCount: 7
    }), { cardId: "r9" });
    assert.deepEqual(baseline.getUnoMove({
      hand: [wild4, red9],
      playableIds: ["w4", "r9"],
      pendingPenalty: 0,
      nextPlayerHandCount: 1
    }), { cardId: "w4", color: "red" });
  });

  test("empty draw, recycle, skip, and reverse match the live rules", () => {
    const rng = sim.mulberry32(3);
    const pass = {
      draw: [],
      discard: [card("top", "red", "number", 4)],
      hands: [[card("y9", "yellow", "number", 9)], [card("b8", "blue", "number", 8)]],
      turnIndex: 0,
      direction: 1,
      pendingPenalty: 0,
      pendingKind: null,
      awaiting: null,
      over: false,
      winner: null,
      turnsPlayed: 0,
      illegal: 0
    };
    sim.applyDraw(pass, rng);
    assert.equal(pass.turnIndex, 1);
    assert.equal(pass.turnsPlayed, 1);
    assert.equal(pass.hands[0].length, 1);

    const recycle = {
      draw: [],
      discard: [
        card("old", "blue", "number", 2),
        card("w", null, "wild"),
        card("top", "red", "number", 4)
      ],
      hands: [[card("y9", "yellow", "number", 9)], [card("b8", "blue", "number", 8)]],
      turnIndex: 0,
      direction: 1,
      pendingPenalty: 0,
      pendingKind: null,
      awaiting: null,
      over: false,
      winner: null,
      turnsPlayed: 0,
      illegal: 0
    };
    recycle.discard[1].chosenColor = "blue";
    recycle.discard[1].color = "blue";
    sim.applyDraw(recycle, sim.mulberry32(9));
    assert.equal(recycle.discard[recycle.discard.length - 1].id, "top");
    assert.equal(recycle.hands[0].some((item) => item.id === "old" || item.id === "w"), true);
    const wild = recycle.hands[0].find((item) => item.id === "w") || recycle.draw.find((item) => item.id === "w");
    if (wild) {
      assert.equal(wild.color, null);
      assert.equal(wild.chosenColor, undefined);
    }

    const skip = simDealLike([
      [card("rs", "red", "skip"), card("x", "yellow", "number", 1)],
      [card("a", "blue", "number", 2)],
      [card("b", "green", "number", 3)]
    ]);
    sim.commitPlay(skip, "rs", null, rng);
    assert.equal(skip.turnIndex, 2);

    const rev2 = simDealLike([
      [card("rr", "red", "reverse"), card("x", "yellow", "number", 1)],
      [card("a", "blue", "number", 2)]
    ]);
    sim.commitPlay(rev2, "rr", null, rng);
    assert.equal(rev2.turnIndex, 0);
    assert.equal(rev2.direction, 1);

    const rev4 = simDealLike([
      [card("rr", "red", "reverse"), card("x", "yellow", "number", 1)],
      [card("a", "blue", "number", 2)],
      [card("b", "green", "number", 3)],
      [card("c", "yellow", "number", 4)]
    ]);
    sim.commitPlay(rev4, "rr", null, rng);
    assert.equal(rev4.direction, -1);
    assert.equal(rev4.turnIndex, 3);
  });

  test("the live driver shows the bot only public seat counts", () => {
    const room = {
      players: [
        { id: "h1", name: "Ava" },
        { id: "b1", name: "Bot" }
      ],
      uno: {
        draw: [card("secret", "yellow", "wild4")],
        discard: [card("top", "red", "number", 4)],
        hands: {
          h1: [card("r2", "red", "number", 2), card("y9", "yellow", "number", 9)],
          b1: [card("r9", "red", "number", 9)]
        },
        currentTurn: "b1",
        turnIndex: 1,
        direction: 1,
        pendingPenalty: 0,
        pendingKind: null,
        awaitingDrawnPlay: null
      }
    };
    const exposed = uno.publicBotState(room, ["r9"]);
    assert.equal(exposed.draw, undefined);
    assert.equal(exposed.hands, undefined);
    assert.equal(exposed.opponentHands, undefined);
    assert.deepEqual(exposed.seats.map((seat) => seat.handCount), [2, 1]);
    assert.equal(exposed.hand.length, 1);
    assert.equal(exposed.hand[0].id, "r9");
    assert.equal(JSON.stringify(exposed).indexOf("secret"), -1);
  });
});

function simDealLike(hands) {
  return {
    draw: [card("pad", "yellow", "number", 6), card("pad2", "green", "number", 7)],
    discard: [card("top", "red", "number", 4)],
    hands,
    turnIndex: 0,
    direction: 1,
    pendingPenalty: 0,
    pendingKind: null,
    awaiting: null,
    over: false,
    winner: null,
    turnsPlayed: 0,
    illegal: 0
  };
}
