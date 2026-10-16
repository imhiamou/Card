"use strict";

const { api, cloneTile } = require("./engine");

/*
 * Persistent, public-information-only strategy memory for the Dominoes AI.
 * Intent is inferred from the public play sequence; it is never treated as
 * knowledge of a hidden hand.
 */
const memoryByKey = new Map();
const MAX_MEMORY_ENTRIES = 500;

function pipCounts(hand) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  (hand || []).forEach((tile) => {
    if (Number.isInteger(tile.a) && tile.a >= 0 && tile.a <= 6) counts[tile.a] += 1;
    if (Number.isInteger(tile.b) && tile.b >= 0 && tile.b <= 6 && tile.b !== tile.a) counts[tile.b] += 1;
  });
  return counts;
}

function teamOf(view, playerId) {
  if ((view.teamA || []).includes(playerId)) return "A";
  if ((view.teamB || []).includes(playerId)) return "B";
  const player = (view.players || []).find((row) => row.id === playerId);
  return player && player.team != null ? player.team : null;
}

function teammateId(view) {
  if (!view.teamMode) return null;
  const ownTeam = teamOf(view, view.selfId);
  if (ownTeam == null) return null;
  const mate = (view.players || []).find((player) =>
    player.id !== view.selfId && teamOf(view, player.id) === ownTeam
  );
  return mate ? mate.id : null;
}

function inferIntentScores(view) {
  const scores = {};
  const lastExposed = {};
  (view.players || []).forEach((player) => {
    scores[player.id] = [0, 0, 0, 0, 0, 0, 0];
  });

  const events = view.log || [];
  events.forEach((event, index) => {
    if (!event || event.type !== "play" || !event.tile || !scores[event.playerId]) return;
    const row = scores[event.playerId];
    const tile = event.tile;
    // Old evidence decays by turn distance so a once-useful number cannot
    // dominate the plan forever after the teammate's choices change.
    const recency = Math.pow(0.88, events.length - 1 - index);
    if (Number.isInteger(tile.a) && tile.a >= 0 && tile.a <= 6) row[tile.a] += 0.08 * recency;
    if (Number.isInteger(tile.b) && tile.b >= 0 && tile.b <= 6 && tile.b !== tile.a) row[tile.b] += 0.08 * recency;

    const exposedPips = [];
    if (event.side === "left") exposedPips.push(event.leftEnd);
    else if (event.side === "right") exposedPips.push(event.rightEnd);
    else if (event.side === "center") {
      // An opening tile exposes both ends; neither pip should be silently
      // discarded as intent evidence.
      exposedPips.push(event.leftEnd);
      if (event.rightEnd !== event.leftEnd) exposedPips.push(event.rightEnd);
    }
    const validExposed = exposedPips.filter((pip) => Number.isInteger(pip) && pip >= 0 && pip <= 6);
    if (!validExposed.length) return;

    // A play with one legal choice is weak intent evidence; a genuine choice
    // between several legal placements is stronger.
    const alternatives = Number.isFinite(event.legalAlternatives) ? event.legalAlternatives : null;
    const choiceFactor = alternatives == null ? 0.85 : alternatives > 1 ? 1.25 : 0.12;
    const exposedWeight = event.side === "center" ? 0.6 : 1.0;
    validExposed.forEach((exposed) => {
      row[exposed] += exposedWeight * choiceFactor * recency;
      if (lastExposed[event.playerId] === exposed) row[exposed] += 0.65 * exposedWeight * choiceFactor * recency;

      const prior = events.slice(Math.max(0, index - 5), index).some((previous) =>
        previous && previous.type === "play" && previous.playerId === event.playerId &&
        ((previous.side === "left" && previous.leftEnd === exposed) ||
         (previous.side === "right" && previous.rightEnd === exposed))
      );
      if (prior) row[exposed] += 0.45 * exposedWeight * choiceFactor * recency;
      lastExposed[event.playerId] = exposed;
    });

    // Record the number the tile connected to separately from the new end.
    // Repeatedly spending a suit is evidence of holding/supporting that suit,
    // but it is not the same signal as deliberately exposing its other pip.
    let matched = Number.isInteger(event.connectPip) ? event.connectPip : null;
    if (matched == null && event.side === "left" && Number.isInteger(event.leftEndBefore)) matched = event.leftEndBefore;
    if (matched == null && event.side === "right" && Number.isInteger(event.rightEndBefore)) matched = event.rightEndBefore;
    if (matched == null && event.side === "left" && Number.isInteger(event.leftEnd)) {
      matched = tile.a === event.leftEnd ? tile.a : tile.b === event.leftEnd ? tile.b : null;
    }
    if (matched != null && !validExposed.includes(matched) && matched >= 0 && matched <= 6) {
      row[matched] += 0.28 * choiceFactor * recency;
    }
  });
  return scores;
}

function countOnes(hand, pip) {
  return (hand || []).reduce((count, tile) =>
    count + ((tile.a === pip || tile.b === pip) ? 1 : 0), 0);
}

function targetScore(view, beliefs, mode, targetNumber, targetPlayerId, intentScores) {
  if (targetNumber == null) return 0;
  if (mode === "self-control") {
    const own = countOnes(view.hand, targetNumber);
    const enemyVoids = (view.players || []).filter((player) =>
      player.id !== view.selfId && player.id !== teammateId(view)
    ).filter((player) => {
      const belief = beliefs && beliefs[player.id];
      return belief && (belief.knownImpossibleNumbers || []).includes(targetNumber);
    }).length;
    return own * 1.35 + (own >= 3 ? 1.25 : 0) + (own === (view.hand || []).length && own >= 2 ? 2.5 : 0) + Math.min(1, enemyVoids) * 0.35;
  }
  const playerScores = intentScores[targetPlayerId] || [];
  const intent = playerScores[targetNumber] || 0;
  const belief = beliefs && beliefs[targetPlayerId];
  const knownVoid = !!(belief && (belief.knownImpossibleNumbers || []).includes(targetNumber));
  if (mode === "teammate-support") return intent * 1.1 - (knownVoid ? 2.8 : 0);
  if (mode === "opponent-denial") return intent * 0.75 - (knownVoid ? 2.2 : 0);
  return 0;
}

function candidatePlans(view, beliefs, intentScores) {
  const candidates = [];
  const ownCounts = pipCounts(view.hand);
  for (let pip = 0; pip <= 6; pip++) {
    if (ownCounts[pip] >= 2) {
      candidates.push({
        mode: "self-control",
        targetNumber: pip,
        targetPlayerId: view.selfId,
        score: targetScore(view, beliefs, "self-control", pip, view.selfId, intentScores),
        reason: "The bot holds multiple tiles containing this number."
      });
    }
  }

  const mateId = teammateId(view);
  if (mateId) {
    const mateBelief = beliefs && beliefs[mateId];
    const mateVoids = mateBelief && Array.isArray(mateBelief.knownImpossibleNumbers)
      ? mateBelief.knownImpossibleNumbers
      : [];
    for (let pip = 0; pip <= 6; pip++) {
      // A known void is stronger evidence than a historical preference:
      // never build a support plan around a number the teammate cannot play.
      if (mateVoids.includes(pip)) continue;
      const score = targetScore(view, beliefs, "teammate-support", pip, mateId, intentScores);
      if (score >= 1.7) {
        candidates.push({
          mode: "teammate-support",
          targetNumber: pip,
          targetPlayerId: mateId,
          score: score,
          reason: "The teammate's public play sequence repeatedly exposed this number."
        });
      }
    }
  }

  if (view.teamMode) {
    (view.players || []).filter((player) =>
      player.id !== view.selfId && player.id !== mateId
    ).forEach((opponent) => {
      for (let pip = 0; pip <= 6; pip++) {
        const score = targetScore(view, beliefs, "opponent-denial", pip, opponent.id, intentScores);
        if (score >= 1.8) {
          candidates.push({
            mode: "opponent-denial",
            targetNumber: pip,
            targetPlayerId: opponent.id,
            score: score,
            reason: "The opponent's public play sequence suggests a number preference."
          });
        }
      }
    });
  }

  if (!candidates.length) {
    candidates.push({
      mode: "defensive-block",
      targetNumber: null,
      targetPlayerId: null,
      score: 0,
      reason: "There is not enough evidence for a reliable number-control plan."
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.targetNumber - b.targetNumber);
  return candidates;
}

function memoryKey(view) {
  return [
    view.gameId || "game",
    view.roundId == null ? "round" : view.roundId,
    view.selfId || "self"
  ].join("|");
}

function updateStrategicPlan(view, beliefs) {
  const key = memoryKey(view);
  const intents = inferIntentScores(view);
  const candidates = candidatePlans(view, beliefs || {}, intents);
  const best = candidates[0];
  const previous = memoryByKey.get(key);
  let chosen = best;

  if (previous && previous.targetNumber != null) {
    const previousBelief = beliefs && beliefs[previous.targetPlayerId];
    const previousTargetVoid = (previous.mode === "teammate-support" || previous.mode === "opponent-denial") &&
      previousBelief && (previousBelief.knownImpossibleNumbers || []).includes(previous.targetNumber);
    const previousCurrentScore = targetScore(
      view, beliefs || {}, previous.mode, previous.targetNumber,
      previous.targetPlayerId, intents
    );
    // Persistence is not permission to keep a dead objective forever. A
    // teammate/opponent target must still clear the same evidence threshold
    // used for a fresh plan; self-control only needs the bot to retain that pip.
    const evidenceFloor = previous.mode === "teammate-support" ? 1.7
      : previous.mode === "opponent-denial" ? 1.8
      : 0;
    const stillOwnsTarget = !previousTargetVoid &&
      previousCurrentScore >= evidenceFloor &&
      (previous.mode !== "self-control" || countOnes(view.hand, previous.targetNumber) >= 2);
    const previousCandidate = Object.assign({}, previous, { score: previousCurrentScore });
    const materiallyBetter = best.score > previousCurrentScore + 0.8;
    if (stillOwnsTarget && !materiallyBetter) chosen = previousCandidate;
  }

  const confidence = chosen.targetNumber == null
    ? 0.2
    : Math.max(0.2, Math.min(0.92, chosen.score / (chosen.score + 2.5)));
  const plan = {
    mode: chosen.mode,
    targetNumber: chosen.targetNumber == null ? null : chosen.targetNumber,
    targetPlayerId: chosen.targetPlayerId || null,
    confidence: Number(confidence.toFixed(3)),
    score: Number((chosen.score || 0).toFixed(3)),
    reason: chosen.reason || "Maintaining the current plan while evidence remains stable.",
    createdAtTurn: previous && previous.mode === chosen.mode &&
      previous.targetNumber === chosen.targetNumber &&
      previous.targetPlayerId === chosen.targetPlayerId
      ? previous.createdAtTurn
      : view.log.length,
    lastReviewedTurn: view.log.length,
    switchThreshold: 0.8,
    supportingEvidenceCount: chosen.targetPlayerId && intents[chosen.targetPlayerId]
      ? Number((intents[chosen.targetPlayerId][chosen.targetNumber] || 0).toFixed(2))
      : 0
  };

  // Preserve the original creation turn when the same objective is retained.
  if (previous && previous.mode === plan.mode &&
      previous.targetNumber === plan.targetNumber &&
      previous.targetPlayerId === plan.targetPlayerId) {
    plan.createdAtTurn = previous.createdAtTurn;
  }
  memoryByKey.set(key, plan);
  if (memoryByKey.size > MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryByKey.keys().next().value;
    memoryByKey.delete(oldestKey);
  }
  return Object.assign({}, plan);
}

function resultingEnds(view, move) {
  const tile = (view.hand || []).find((item) => item.id === move.tileId);
  if (!tile) return null;
  const state = {
    chain: (view.chain || []).map(cloneTile),
    leftEnd: view.leftEnd,
    rightEnd: view.rightEnd,
    mustPlayId: view.mustPlayId || null
  };
  const placed = api().placeTile(state, tile, move.side);
  if (!placed) return null;
  return { leftEnd: state.leftEnd, rightEnd: state.rightEnd };
}

function scoreStrategicMove(view, move, plan, beliefs) {
  if (!plan || plan.targetNumber == null) return 0;
  const ends = resultingEnds(view, move);
  if (!ends) return 0;
  const target = plan.targetNumber;
  const onBoard = ends.leftEnd === target || ends.rightEnd === target;
  const bothEnds = ends.leftEnd === target && ends.rightEnd === target;
  const mateId = teammateId(view);
  const next = (view.players || []).length
    ? view.players[((view.players.findIndex((player) => player.id === view.selfId) + 1) % view.players.length)]
    : null;
  const mateBelief = mateId && beliefs ? beliefs[mateId] : null;

  if (plan.mode === "self-control") {
    const ownAfter = (view.hand || []).filter((tile) => tile.id !== move.tileId);
    const stillHolds = countOnes(ownAfter, target) > 0;
    return (onBoard ? 2.2 : -1.1) + (stillHolds && onBoard ? 0.7 : 0) + (bothEnds ? 0.35 : 0);
  }
  if (plan.mode === "teammate-support") {
    const knownVoid = mateBelief && (mateBelief.knownImpossibleNumbers || []).includes(target);
    let score = onBoard ? 2.8 : -0.9;
    if (knownVoid) score -= 2.2;
    if (next && next.id === mateId && onBoard && !knownVoid) score += 0.9;
    if (bothEnds) score += 0.25;
    return score;
  }
  if (plan.mode === "opponent-denial") {
    const targetBelief = beliefs && beliefs[plan.targetPlayerId];
    const targetVoid = targetBelief && (targetBelief.knownImpossibleNumbers || []).includes(target);
    const nextIsTarget = !!(next && next.id === plan.targetPlayerId);
    // Keep the inferred number relevant when it can pressure the opponent,
    // but do not feed it to a target opponent who is next and likely able to play.
    let score = onBoard ? 1.25 : -0.45;
    if (targetVoid && onBoard) score += 0.8;
    if (nextIsTarget && onBoard && !targetVoid) score -= 1.6;
    return score;
  }
  return 0;
}

function clearMemory() {
  memoryByKey.clear();
}

module.exports = {
  inferIntentScores,
  updateStrategicPlan,
  scoreStrategicMove,
  clearMemory
};
