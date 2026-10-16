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

  (view.log || []).forEach((event, index, events) => {
    if (!event || event.type !== "play" || !event.tile || !scores[event.playerId]) return;
    const row = scores[event.playerId];
    const tile = event.tile;
    if (Number.isInteger(tile.a) && tile.a >= 0 && tile.a <= 6) row[tile.a] += 0.12;
    if (Number.isInteger(tile.b) && tile.b >= 0 && tile.b <= 6 && tile.b !== tile.a) row[tile.b] += 0.12;

    let exposed = null;
    if (event.side === "left") exposed = event.leftEnd;
    else if (event.side === "right") exposed = event.rightEnd;
    else if (event.side === "center") exposed = event.rightEnd != null ? event.rightEnd : event.leftEnd;
    if (!Number.isInteger(exposed) || exposed < 0 || exposed > 6) return;

    // A deliberately selected play is stronger evidence than a forced move.
    const alternatives = Number.isFinite(event.legalAlternatives) ? event.legalAlternatives : null;
    const choiceFactor = alternatives == null ? 0.85 : alternatives > 1 ? 1.25 : 0.55;
    row[exposed] += 1.0 * choiceFactor;
    if (lastExposed[event.playerId] === exposed) row[exposed] += 0.65 * choiceFactor;

    // A repeated preference is more meaningful when it recurs after another
    // player has had a chance to change the ends.
    const prior = events.slice(Math.max(0, index - 5), index).some((previous) =>
      previous && previous.type === "play" && previous.playerId === event.playerId &&
      ((previous.side === "left" && previous.leftEnd === exposed) ||
       (previous.side === "right" && previous.rightEnd === exposed))
    );
    if (prior) row[exposed] += 0.45 * choiceFactor;
    lastExposed[event.playerId] = exposed;
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
    return own * 1.35 + Math.min(1, enemyVoids) * 0.35;
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
    for (let pip = 0; pip <= 6; pip++) {
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
    const stillOwnsTarget = previous.mode !== "self-control" ||
      countOnes(view.hand, previous.targetNumber) > 0;
    const previousCurrentScore = targetScore(
      view, beliefs || {}, previous.mode, previous.targetNumber,
      previous.targetPlayerId, intents
    );
    const previousCandidate = Object.assign({}, previous, { score: previousCurrentScore });
    const materiallyBetter = best.score > previousCurrentScore + 1.35;
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
    switchThreshold: 1.35,
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
