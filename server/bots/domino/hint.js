"use strict";

/*
 * Human-facing Dominoes hints.
 *
 * This is intentionally separate from the bot's move selector. The hint ranks
 * each legal placement using explicit tactical priorities and reports the
 * reasons behind the ranking. It uses only the player's hand and public
 * history; hidden hands are never read.
 */

const { buildBeliefs, hardVoid } = require("./beliefs");
const { unseenTiles } = require("./sample");
const { api, cloneTile, pips, touches, matchesEither, violates } = require("./engine");
const { previewEnds, partnerId, isOpponent } = require("./eval");

function playerAt(view, offset) {
  const players = view.players || [];
  const selfIndex = players.findIndex((player) => player.id === view.selfId);
  if (selfIndex < 0 || !players.length) return null;
  return players[(selfIndex + offset) % players.length] || null;
}

function probabilityAtLeastOne(poolCount, matchCount, handCount) {
  if (poolCount <= 0 || matchCount <= 0 || handCount <= 0) return 0;
  const n = Math.min(handCount, poolCount);
  if (poolCount - matchCount < n) return 1;
  let noMatch = 1;
  for (let i = 0; i < n; i++) {
    noMatch *= (poolCount - matchCount - i) / (poolCount - i);
  }
  return Math.max(0, Math.min(1, 1 - noMatch));
}

function canPlayerAnswer(view, beliefs, player, left, right) {
  if (!player || !(player.handCount > 0)) return 0;
  const voids = hardVoid(beliefs, player.id);
  const pool = unseenTiles(view).filter((tile) => !violates(tile, voids));
  const matches = pool.filter((tile) => matchesEither(tile, left, right)).length;
  return probabilityAtLeastOne(pool.length, matches, player.handCount);
}

function pipCounts(tiles) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  (tiles || []).forEach((tile) => {
    counts[tile.a] += 1;
    if (tile.b !== tile.a) counts[tile.b] += 1;
  });
  return counts;
}

function ownStrength(hand) {
  const counts = pipCounts(hand);
  let target = 0;
  for (let pip = 1; pip <= 6; pip++) {
    if (counts[pip] > counts[target]) target = pip;
  }
  return { counts, target, strength: counts[target] };
}

function numberAvailability(view, pip) {
  const gone = new Set();
  (view.chain || []).forEach((tile) => gone.add(tile.id));
  (view.log || []).forEach((event) => {
    if (event && event.type === "play" && event.tile) gone.add(event.tile.id);
  });
  return api().buildDoubleSixSet().filter((tile) =>
    !gone.has(tile.id) && !(view.hand || []).some((held) => held.id === tile.id) &&
    touches(tile, pip)
  ).length;
}

function remainingPipTotal(hand) {
  return (hand || []).reduce((sum, tile) => sum + pips(tile), 0);
}

function blockEquity(view, rest) {
  if ((view.boneyardCount || 0) > 0) return 0;
  const others = (view.players || []).filter((player) => player.id !== view.selfId);
  if (!others.length) return 0;
  const ownPips = remainingPipTotal(rest);
  const estimates = others.map((player) => {
    const count = Math.max(0, player.handCount || 0);
    return count * 3; // Double-six unseen tiles average three pips per tile.
  });
  if (view.teamMode) {
    const mate = partnerId(view);
    const opponentEstimate = others.filter((p) => p.id !== mate)
      .reduce((sum, p) => sum + (p.handCount || 0) * 3, 0);
    const ownTeamEstimate = ownPips + others.filter((p) => p.id === mate)
      .reduce((sum, p) => sum + (p.handCount || 0) * 3, 0);
    return Math.max(-8, Math.min(8, (opponentEstimate - ownTeamEstimate) * 0.35));
  }
  const opponentAverage = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  return Math.max(-8, Math.min(8, (opponentAverage - ownPips) * 0.35));
}

function makeParts() {
  return {
    immediateWin: 0,
    shedPips: 0,
    doubleUrgency: 0,
    ownFollowUps: 0,
    handFlexibility: 0,
    ownNumberControl: 0,
    opponentDenial: 0,
    opponentFinishRisk: 0,
    teammateSupport: 0,
    teammateIntent: 0,
    knownVoidUse: 0,
    blockEquity: 0,
    strandedDoubleRisk: 0
  };
}

function scoreCandidate(view, beliefs, move) {
  const placed = previewEnds(view, move);
  if (!placed) return null;
  const tile = placed.tile;
  const rest = (view.hand || []).filter((item) => item.id !== tile.id);
  const parts = makeParts();
  const left = placed.leftEnd;
  const right = placed.rightEnd;
  const next = playerAt(view, 1);
  const mateId = view.teamMode ? partnerId(view) : null;
  const mate = mateId ? (view.players || []).find((player) => player.id === mateId) : null;
  const strength = ownStrength(rest);
  const followUps = rest.filter((item) => matchesEither(item, left, right)).length;
  const nextCanAnswer = next ? canPlayerAnswer(view, beliefs, next, left, right) : 0;

  // Finishing the hand is a terminal result and overrides every heuristic.
  if (rest.length === 0) {
    parts.immediateWin = 100000;
    return {
      move: { tileId: move.tileId, side: move.side },
      tile: cloneTile(tile),
      leftEnd: left,
      rightEnd: right,
      score: parts.immediateWin,
      parts,
      reasons: ["This play empties your hand and wins the round immediately."]
    };
  }

  parts.shedPips = pips(tile) * 0.85;

  // Doubles have only one matching value. Their urgency rises as the number
  // becomes scarce, while held connectors reduce the risk of stranding it.
  if (tile.a === tile.b) {
    const heldSameNumber = rest.filter((item) => touches(item, tile.a)).length;
    const unseenSameNumber = numberAvailability(view, tile.a);
    const scarcity = unseenSameNumber <= 1 ? 1 : unseenSameNumber <= 3 ? 0.65 : 0.25;
    parts.doubleUrgency = 4.5 + tile.a * 0.7 +
      (heldSameNumber === 0 ? 6 : heldSameNumber === 1 ? 3.2 : 1.1) +
      scarcity * 3.5;
  }

  parts.ownFollowUps = Math.min(5, followUps) * 2.25;
  const distinct = new Set();
  rest.forEach((item) => { distinct.add(item.a); distinct.add(item.b); });
  parts.handFlexibility = Math.min(7, distinct.size) * 0.65;

  // Prefer exposing a number that the remaining hand can repeatedly support.
  [left, right].filter((pip, index, all) => pip != null && all.indexOf(pip) === index)
    .forEach((pip) => {
      const held = rest.filter((item) => touches(item, pip)).length;
      parts.ownNumberControl += Math.min(3, held) * (pip === strength.target ? 1.8 : 0.7);
    });
  if (left != null && left === right) {
    const held = rest.filter((item) => touches(item, left)).length;
    if (held > 0) parts.ownNumberControl += 2.5 + Math.min(held, 3) * 1.4;
  }

  if (next && isOpponent(view, next.id)) {
    parts.opponentDenial = (1 - nextCanAnswer) * 5.5;
    if (next.handCount === 1) parts.opponentFinishRisk = -nextCanAnswer * 45;
    else parts.opponentFinishRisk = -nextCanAnswer * 1.5;

    const voids = hardVoid(beliefs, next.id);
    const preserved = [left, right].filter((pip, index, all) =>
      pip != null && all.indexOf(pip) === index && voids.has(pip)).length;
    parts.knownVoidUse = preserved * 4.5;

    const intent = beliefs[next.id] && beliefs[next.id].intention;
    if (intent && intent.byPip) {
      [left, right].filter((pip, index, all) => pip != null && all.indexOf(pip) === index)
        .forEach((pip) => {
          const row = intent.byPip[pip];
          if (row && row.confidence >= 0.45) parts.opponentDenial -= row.confidence * 3;
        });
    }
  }

  if (mate) {
    const mateCanAnswer = canPlayerAnswer(view, beliefs, mate, left, right);
    const mateActsNext = next && next.id === mate.id;
    parts.teammateSupport = mateCanAnswer * (mateActsNext ? 5.5 : 2.2);
    if (mate.handCount === 1) {
      parts.teammateSupport += mateCanAnswer * (mateActsNext ? 55 : 12);
    }
    const intent = beliefs[mate.id] && beliefs[mate.id].intention;
    const preferred = intent && intent.preferred;
    if (preferred != null && (left === preferred || right === preferred) &&
        !hardVoid(beliefs, mate.id).has(preferred)) {
      const confidence = Math.max(0, Math.min(1, intent.confidence || 0));
      parts.teammateIntent = confidence * (mateActsNext ? 7 : 3);
    }
  }

  parts.blockEquity = blockEquity(view, rest);
  // A double still in hand is especially dangerous if its value is no longer
  // on either end and the hand is short enough that it may never return.
  rest.filter((item) => item.a === item.b).forEach((double) => {
    const live = left === double.a || right === double.a;
    const heldConnectors = rest.filter((item) => item.id !== double.id && touches(item, double.a)).length;
    if (!live && heldConnectors === 0) parts.strandedDoubleRisk -= 2.8 + double.a * 0.55;
  });

  const score = Object.keys(parts).reduce((sum, key) => sum + parts[key], 0);
  const reasons = Object.keys(parts)
    .map((key) => ({ key, value: parts[key] }))
    .filter((item) => Math.abs(item.value) >= 1.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((item) => {
      const labels = {
        shedPips: "Sheds " + pips(tile) + " pips from your hand",
        doubleUrgency: "Gets a playable double out before it can become stranded",
        ownFollowUps: "Leaves " + followUps + " immediate follow-up tile(s) in your hand",
        handFlexibility: "Preserves a spread of numbers in your remaining hand",
        ownNumberControl: "Keeps the resulting ends aligned with numbers you can support",
        opponentDenial: "Limits the next opponent's likely replies",
        opponentFinishRisk: "Reduces the danger of the next opponent finishing",
        teammateSupport: "Leaves a useful reply for your teammate",
        teammateIntent: "Supports a number suggested by your teammate's public play",
        knownVoidUse: "Uses a number the next opponent has publicly shown they cannot play",
        blockEquity: "The remaining pip-count estimate favors a block",
        strandedDoubleRisk: "Avoids leaving an unsupported double in your hand"
      };
      return (item.value < 0 ? "Risk: " : "") + (labels[item.key] || item.key) + ".";
    });

  return {
    move: { tileId: move.tileId, side: move.side },
    tile: cloneTile(tile),
    leftEnd: left,
    rightEnd: right,
    score,
    parts,
    reasons
  };
}

function chooseFocus(view, beliefs, candidate) {
  const plan = { mode: "board-control", target: null, owner: "self", confidence: null, evidence: "" };
  if (candidate.parts.immediateWin > 0) {
    plan.mode = "finish";
    plan.evidence = "An immediate round win takes priority over all positional heuristics.";
    return plan;
  }
  if (view.teamMode) {
    const mateId = partnerId(view);
    const mate = mateId && beliefs[mateId];
    if (mate && mate.intention && mate.intention.preferred != null &&
        candidate.parts.teammateIntent > candidate.parts.ownNumberControl) {
      plan.mode = "teammate-support";
      plan.target = mate.intention.preferred;
      plan.owner = "teammate";
      plan.confidence = mate.intention.confidence;
      plan.evidence = "The selected move supports a number inferred from public teammate plays.";
      return plan;
    }
  }
  if (candidate.leftEnd != null && candidate.leftEnd === candidate.rightEnd) {
    plan.target = candidate.leftEnd;
    plan.evidence = "Both ends show " + candidate.leftEnd + "; control is useful only while your remaining hand can answer it.";
  } else {
    const strength = ownStrength((view.hand || []).filter((tile) => tile.id !== candidate.move.tileId));
    plan.target = strength.target;
    plan.confidence = strength.strength / Math.max(1, (view.hand || []).length - 1);
    plan.evidence = "The remaining hand has its strongest support on " + strength.target + ".";
  }
  return plan;
}

function getDominoHint(view) {
  const beliefs = buildBeliefs(view || {});
  const legalMoves = view && Array.isArray(view.validMoves) ? view.validMoves : [];
  if (!legalMoves.length) {
    return {
      pass: true,
      canDraw: (view && view.boneyardCount || 0) > 0,
      reason: (view && view.boneyardCount || 0) > 0
        ? "No tile matches either open end. Draw; the pass history does not prove a permanent absence until the draw pile is exhausted."
        : "No tile matches either open end and the boneyard is empty, so you must pass.",
      strategy: { mode: "forced-pass", target: null, owner: null, confidence: 1,
        evidence: "There is no legal play in the current hand." },
      alternatives: []
    };
  }

  const ranked = legalMoves.map((move) => scoreCandidate(view, beliefs, move)).filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    const fallback = legalMoves[0];
    const tile = (view.hand || []).find((item) => item.id === fallback.tileId);
    return {
      pass: false, tile: tile ? cloneTile(tile) : null, side: fallback.side,
      reason: "The evaluator could not compare all candidates; this is a legal-move fallback.",
      strategy: { mode: "fallback", target: null, owner: null, confidence: null, evidence: "" },
      alternatives: []
    };
  }
  const strategy = chooseFocus(view, beliefs, best);
  const alternatives = ranked.slice(0, 4).map((row) => ({
    tile: row.tile,
    side: row.move.side,
    score: Math.round(row.score * 100) / 100,
    reasons: row.reasons,
    resultingEnds: { left: row.leftEnd, right: row.rightEnd },
    parts: row.parts
  }));
  const margin = ranked.length > 1 ? best.score - ranked[1].score : null;
  const reason = best.reasons.length
    ? best.reasons.join(" ") + (margin != null
      ? " It ranks " + Math.round(margin * 100) / 100 + " heuristic points above the next candidate."
      : " It is the only legal placement.")
    : "This is the highest-ranked legal placement under the hint's tactical evaluation.";
  return {
    pass: false,
    tile: best.tile,
    side: best.move.side,
    reason,
    strategy,
    alternatives,
    score: Math.round(best.score * 100) / 100,
    margin: margin == null ? null : Math.round(margin * 100) / 100,
    board: { leftEnd: view.leftEnd, rightEnd: view.rightEnd },
    resultingEnds: { left: best.leftEnd, right: best.rightEnd }
  };
}

module.exports = {
  getDominoHint,
  scoreCandidate,
  canPlayerAnswer,
  probabilityAtLeastOne
};
