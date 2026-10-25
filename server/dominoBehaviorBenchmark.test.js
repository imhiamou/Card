"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { atLeastOne, predictNextMove } = require("./bots/domino/intent");
const { mulberry32 } = require("./bots/domino/sample");

function doubleSixSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) tiles.push({ id: a + "-" + b, a, b });
  }
  return tiles;
}

function shuffle(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function touches(tile, pip) {
  return tile.a === pip || tile.b === pip;
}

function removeById(tiles, id) {
  const index = tiles.findIndex((tile) => tile.id === id);
  if (index >= 0) return tiles.splice(index, 1)[0];
  return null;
}

function scenario(rng, withPreference) {
  const full = doubleSixSet();
  const deck = shuffle(full, rng);
  const left = Math.floor(rng() * 7);
  let right = Math.floor(rng() * 6);
  if (right >= left) right += 1;

  // A real double-six tile opens the board with these two ends.
  const boardTile = deck.find((tile) =>
    tile.a === Math.min(left, right) && tile.b === Math.max(left, right)
  );
  const remaining = deck.filter((tile) => tile.id !== boardTile.id);
  const botHand = remaining.splice(0, 7);

  // Construct a legal hidden hand with at least one move exclusive to each
  // end, so the simulated player's chosen side is genuinely available.
  const leftOnly = remaining.filter((tile) => touches(tile, left) && !touches(tile, right));
  const rightOnly = remaining.filter((tile) => touches(tile, right) && !touches(tile, left));
  assert.ok(leftOnly.length > 0 && rightOnly.length > 0);
  const leftTile = leftOnly[Math.floor(rng() * leftOnly.length)];
  const rightTile = rightOnly[Math.floor(rng() * rightOnly.length)];
  const targetHandPool = remaining.slice();
  removeById(targetHandPool, leftTile.id);
  removeById(targetHandPool, rightTile.id);
  const targetHand = [leftTile, rightTile, ...shuffle(targetHandPool, rng).slice(0, 5)];
  assert.equal(targetHand.length, 7);

  // The observer knows their own hand and the board tile, but not the target
  // player's hand. The 20 remaining tiles are the correct unseen pool.
  const unseen = full.filter((tile) =>
    tile.id !== boardTile.id && !botHand.some((own) => own.id === tile.id)
  );
  const preferred = withPreference ? (rng() < 0.5 ? left : right) : null;
  const byPip = Array.from({ length: 7 }, (_, pip) => {
    const matches = unseen.filter((tile) => touches(tile, pip)).length;
    return {
      pAtLeastOne: atLeastOne(unseen.length, matches, targetHand.length),
      confidence: withPreference && pip === preferred ? 0.9 : 0
    };
  });
  const prediction = predictNextMove({
    leftEnd: left,
    rightEnd: right,
    players: [{ id: "target", handCount: targetHand.length }]
  }, {
    byPip,
    preferred,
    confidence: withPreference ? 0.9 : 0
  }, "target");

  // In the behavior-controlled cohort, the player follows the established
  // target number 80% of the time; otherwise they take the other legal end.
  // In the no-preference cohort, they choose either legal end uniformly.
  const followsTarget = withPreference ? rng() < 0.8 : rng() < 0.5;
  const actualPip = withPreference
    ? (followsTarget ? preferred : (preferred === left ? right : left))
    : (followsTarget ? left : right);

  assert.ok(targetHand.some((tile) => touches(tile, actualPip)));
  return { left, right, preferred, actualPip, prediction };
}

test("controlled 3000-position benchmark: behavior evidence improves next-end predictions", (t) => {
  const rng = mulberry32(20261025);
  const count = 3000;
  let baselineBrier = 0;
  let adjustedBrier = 0;
  let baselineCorrect = 0;
  let adjustedCorrect = 0;

  for (let i = 0; i < count; i++) {
    const row = scenario(rng, true);
    const actualLeft = row.actualPip === row.left ? 1 : 0;
    const base = row.prediction.baselineLeftProbability;
    const adjusted = row.prediction.leftProbability;
    baselineBrier += (base - actualLeft) ** 2;
    adjustedBrier += (adjusted - actualLeft) ** 2;

    const baselinePip = row.prediction.baselineLikelyEnd;
    baselineCorrect += baselinePip === row.actualPip ? 1 : 0;
    adjustedCorrect += row.prediction.likelyEnd === row.actualPip ? 1 : 0;
  }

  baselineBrier /= count;
  adjustedBrier /= count;
  baselineCorrect /= count;
  adjustedCorrect /= count;

  t.diagnostic("controlled behavior benchmark (" + count + " legal positions): " +
    "baseline Brier=" + baselineBrier.toFixed(4) +
    ", behavior-adjusted Brier=" + adjustedBrier.toFixed(4) +
    ", baseline accuracy=" + (baselineCorrect * 100).toFixed(1) + "%" +
    ", behavior-adjusted accuracy=" + (adjustedCorrect * 100).toFixed(1) + "%");

  assert.ok(adjustedBrier < baselineBrier - 0.03,
    "behavior evidence should reduce Brier score in a policy that follows its established target");
  assert.ok(adjustedCorrect > baselineCorrect + 0.15,
    "behavior evidence should improve top-choice accuracy in a target-following policy");
});

test("no-preference benchmark: predictions do not invent a behavioral advantage", (t) => {
  const rng = mulberry32(9021026);
  const count = 1500;
  let baselineBrier = 0;
  let adjustedBrier = 0;
  let baselineCorrect = 0;
  let adjustedCorrect = 0;
  let availabilityOnlyCount = 0;

  for (let i = 0; i < count; i++) {
    const row = scenario(rng, false);
    const actualLeft = row.actualPip === row.left ? 1 : 0;
    const base = row.prediction.baselineLeftProbability;
    const adjusted = row.prediction.leftProbability;
    baselineBrier += (base - actualLeft) ** 2;
    adjustedBrier += (adjusted - actualLeft) ** 2;
    const baselinePip = row.prediction.baselineLikelyEnd;
    baselineCorrect += baselinePip === row.actualPip ? 1 : 0;
    adjustedCorrect += row.prediction.likelyEnd === row.actualPip ? 1 : 0;
    if (row.prediction.basis === "tile-availability") availabilityOnlyCount += 1;
    assert.equal(row.prediction.basis, "tile-availability");
    assert.equal(adjusted, base);
  }

  baselineBrier /= count;
  adjustedBrier /= count;
  baselineCorrect /= count;
  adjustedCorrect /= count;
  t.diagnostic("no-preference benchmark (" + count + " legal positions): " +
    "baseline Brier=" + baselineBrier.toFixed(4) +
    ", adjusted Brier=" + adjustedBrier.toFixed(4) +
    ", baseline accuracy=" + (baselineCorrect * 100).toFixed(1) + "%" +
    ", adjusted accuracy=" + (adjustedCorrect * 100).toFixed(1) + "%" +
    ", insufficient behavior evidence=" + availabilityOnlyCount + "/" + count +
    " (availability-only fallback)");
  assert.equal(adjustedBrier, baselineBrier);
  assert.equal(availabilityOnlyCount, count);
  assert.equal(adjustedCorrect, baselineCorrect);
});
