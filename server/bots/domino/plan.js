"use strict";

/*
 * A plan stays with one deal. The key is the bot's own tiles: the current
 * hand plus the tiles this seat has already played. A new deal has a new
 * set, so a stored plan cannot leak into it.
 */

const memory = new Map();
const teammateMemory = new Map();
const SWITCH_MARGIN = 2;
const MEMORY_LIMIT = 256;
const stats = { decisions: 0, held: 0, switched: 0, started: 0, none: 0 };

function planStats() {
  return {
    decisions: stats.decisions,
    held: stats.held,
    switched: stats.switched,
    started: stats.started,
    none: stats.none
  };
}

function partnerId(view) {
  if (!view.teamMode || !view.teamA || !view.teamB) return null;
  const team = view.teamA.indexOf(view.selfId) >= 0 ? view.teamA
    : view.teamB.indexOf(view.selfId) >= 0 ? view.teamB
    : null;
  if (!team) return null;
  for (let i = 0; i < team.length; i++) {
    if (team[i] !== view.selfId) return team[i];
  }
  return null;
}

function dealKey(view) {
  const ids = new Set((view.hand || []).map((tile) => tile.id));
  (view.log || []).forEach((event) => {
    if (event && event.type === "play" && event.playerId === view.selfId && event.tile) ids.add(event.tile.id);
  });
  // A repeated hand in a later round must not inherit the previous round's
  // objective. The authoritative adapter supplies game/round identity.
  const game = view.gameId || view.roomId || "game";
  const round = view.roundNumber != null ? view.roundNumber : (view.roundId || "round");
  return [game, round, view.selfId, Array.from(ids).sort().join(",")].join("|");
}

function clearPlans() {
  memory.clear();
  teammateMemory.clear();
  stats.decisions = 0;
  stats.held = 0;
  stats.switched = 0;
  stats.started = 0;
  stats.none = 0;
}

function remember(key, plan) {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, plan);
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

function note(plan) {
  stats.decisions += 1;
  if (plan && plan.switched) stats.switched += 1;
  else if (!plan || plan.mode === "none") stats.none += 1;
  else if (plan.held) stats.held += 1;
  else stats.started += 1;
}

function emptyPlan(reason) {
  return {
    mode: "none",
    target: null,
    owner: null,
    ownerId: null,
    confidence: 0,
    score: 0,
    held: false,
    switched: false,
    evidence: reason || "No number has enough public support to commit to.",
    lines: []
  };
}

function ownCandidate(inventory) {
  if (!inventory) return null;
  let best = null;
  inventory.byPip.forEach((info) => {
    const held = info.inHand || 0;
    const hidden = info.unseen || 0;
    if (held < 3 || held < hidden) return;
    const score = held * 2 - hidden;
    if (!best || score > best.score) best = { pip: info.pip, score: score, held: held, hidden: hidden };
  });
  return best;
}

function intentionOf(beliefs, id) {
  const belief = beliefs && id ? beliefs[id] : null;
  return belief && belief.intention ? belief.intention : null;
}

function teammateKey(view, mateId) {
  const game = view.gameId || view.roomId || "game";
  const round = view.roundNumber != null ? view.roundNumber : (view.roundId || "round");
  return [game, round, view.selfId, mateId].join("|");
}

function teammateCandidate(beliefs, mateId) {
  const intent = intentionOf(beliefs, mateId);
  const belief = beliefs && beliefs[mateId];
  const voids = belief && belief.knownImpossibleNumbers || [];
  if (!intent || intent.preferred == null || intent.confidence < 0.45) return null;
  const info = intent.byPip[intent.preferred];
  if (!info || voids.indexOf(intent.preferred) >= 0 || info.pAtLeastOne < 0.2 ||
      (info.missed >= 0.75 && info.pAtLeastOne < 0.35)) return null;
  const support = (info.inTile || 0) + (info.bridged || 0) + (info.continued || 0);
  if (support < 1.5) return null;
  return {
    pip: intent.preferred,
    confidence: intent.confidence,
    score: intent.confidence * 6 + (info.pMultiple || 0) * 2,
    info: info
  };
}

function freshPlan(view, beliefs) {
  const inventory = beliefs && beliefs._inventory;
  const own = ownCandidate(inventory);
  const mateId = partnerId(view);
  const mateIntent = intentionOf(beliefs, mateId);
  let mate = teammateCandidate(beliefs, mateId);
  let teammateTarget = null;
  let teammateConfidence = 0;
  if (mateId) {
    const key = teammateKey(view, mateId);
    const previous = teammateMemory.get(key);
    const currentBelief = beliefs && beliefs[mateId];
    const voids = currentBelief && currentBelief.knownImpossibleNumbers || [];
    const previousInfo = previous && mateIntent && mateIntent.byPip[previous.pip];
    const support = previousInfo
      ? (previousInfo.inTile || 0) + (previousInfo.bridged || 0) + (previousInfo.continued || 0)
      : 0;
    const previousStillSupported = previous && previousInfo &&
      voids.indexOf(previous.pip) < 0 &&
      previousInfo.pAtLeastOne >= 0.2 &&
      !((previousInfo.missed || 0) >= 0.75 && previousInfo.pAtLeastOne < 0.35) &&
      support >= 1.5;
    // Retain a well-supported target through small confidence swings. Replace
    // it only when a different target has materially stronger evidence.
    if (previousStillSupported && (!mate ||
        mate.pip === previous.pip ||
        (mate.pip !== previous.pip && mate.score < previous.score + SWITCH_MARGIN))) {
      mate = {
        pip: previous.pip,
        score: Math.max(previous.score, previousInfo.confidence * 6 + (previousInfo.pMultiple || 0) * 2),
        confidence: previousInfo.confidence,
        info: previousInfo
      };
    }
    if (mate) {
      teammateMemory.set(key, {
        pip: mate.pip,
        score: mate.score,
        confidence: mate.confidence != null ? mate.confidence : mateIntent.confidence
      });
      teammateTarget = mate.pip;
      teammateConfidence = mate.confidence != null ? mate.confidence : mateIntent.confidence;
    } else if (previous && (!currentBelief || voids.indexOf(previous.pip) < 0)) {
      // Keep the displayed objective while evidence is temporarily inconclusive,
      // but never carry it through a known teammate void.
      teammateTarget = previous.pip;
      teammateConfidence = previous.confidence || 0;
    } else {
      teammateMemory.delete(key);
    }
  }

  let opp = null;
  (view.players || []).forEach((player) => {
    if (!player || player.id === view.selfId || player.id === mateId) return;
    const intent = intentionOf(beliefs, player.id);
    if (!intent || intent.preferred == null || intent.confidence < 0.45) return;
    const info = intent.byPip[intent.preferred];
    const voids = (beliefs[player.id].knownImpossibleNumbers || []);
    if (!info || voids.indexOf(intent.preferred) >= 0) return;
    const score = intent.confidence * 5 + (info.pMultiple || 0);
    if (!opp || score > opp.score) opp = { pip: intent.preferred, score: score, id: player.id, info: info };
  });

  const selfScore = own && own.score >= 4 ? own.score : 0;
  const mateScore = mate ? mate.score : 0;
  const oppScore = opp ? opp.score : 0;
  let plan;
  if (selfScore >= mateScore && selfScore >= oppScore && selfScore > 0) {
    plan = {
      mode: "self-control",
      target: own.pip,
      owner: "self",
      ownerId: view.selfId,
      confidence: Math.max(0, Math.min(1, selfScore / 8)),
      score: selfScore,
      held: false,
      switched: false,
      evidence: "This hand holds " + own.held + " tiles with " + own.pip +
        " and " + own.hidden + " such tiles are still unseen."
    };
  } else if (mateScore >= oppScore && mateScore > 0) {
    plan = {
      mode: "teammate-support",
      target: mate.pip,
      owner: "teammate",
      ownerId: mateId,
      confidence: mate.confidence != null ? mate.confidence : mateIntent.confidence,
      score: mateScore,
      held: false,
      switched: false,
      evidence: "Public play history repeatedly supports " + mate.pip + " as the teammate's useful number: " +
        round1(mate.info.inTile) + " tile observations and " + round1(mate.info.bridged) +
        " links to previous plays."
    };
  } else if (oppScore > 0) {
    plan = {
      mode: "opponent-denial",
      target: opp.pip,
      owner: "opponent",
      ownerId: opp.id,
      confidence: intentionOf(beliefs, opp.id).confidence,
      score: oppScore,
      held: false,
      switched: false,
      evidence: opp.id + " has been building around " + opp.pip +
        " (confidence " + round1(intentionOf(beliefs, opp.id).confidence) + ")."
    };
  } else {
    plan = emptyPlan();
  }
  plan.teammateTarget = teammateTarget;
  plan.teammateConfidence = teammateConfidence;
  plan.teammateVoidNumbers = (beliefs && beliefs[mateId] && beliefs[mateId].knownImpossibleNumbers || []).slice();
  const teammateIntent = intentionOf(beliefs, mateId);
  plan.teammateSuspectedMissingNumbers = teammateIntent
    ? teammateIntent.byPip.map((info, pip) => ({ info: info, pip: pip }))
      .filter((item) => item.info.missed >= 1 && item.info.pAtLeastOne < 0.4 &&
        plan.teammateVoidNumbers.indexOf(item.pip) < 0)
      .map((item) => item.pip)
    : [];
  return plan;
}

function round1(value) {
  return Math.round((value || 0) * 10) / 10;
}

function stillFeasible(plan, view, beliefs) {
  if (!plan || plan.mode === "none" || plan.target == null) return false;
  const inventory = beliefs && beliefs._inventory;
  if (plan.mode === "self-control") {
    const info = inventory && inventory.byPip[plan.target];
    if (!info || info.inHand < 2) return false;
    // A committed number stays only while this hand still has the count
    // advantage, or the remaining copies are already known to be scarce.
    if (info.inHand >= 3 && info.inHand >= info.unseen) return true;
    return info.unseen <= 1;
  }
  const belief = beliefs && plan.ownerId ? beliefs[plan.ownerId] : null;
  if (!belief) return false;
  const voids = belief.knownImpossibleNumbers || [];
  if (voids.indexOf(plan.target) >= 0) return false;
  const info = belief.intention && belief.intention.byPip[plan.target];
  if (!info) return false;
  if (info.missed >= 0.75 && info.pAtLeastOne < 0.25) return false;
  if (plan.mode === "teammate-support" || plan.mode === "opponent-denial") {
    return info.confidence >= 0.3 || info.pAtLeastOne >= 0.35 || info.inTile >= 1;
  }
  return false;
}

function withLines(plan) {
  const copy = Object.assign({}, plan);
  if (!copy.mode || copy.mode === "none" || copy.target == null) {
    const reason = copy.evidence || "No number-control plan is committed.";
    copy.lines = [copy.switched ? "The previous plan was dropped. " + reason : reason];
    if (copy.teammateTarget != null) {
      copy.lines.push("Separate teammate-support target: " + copy.teammateTarget +
        " (confidence " + round1(copy.teammateConfidence) + ").");
    }
    if (copy.teammateVoidNumbers && copy.teammateVoidNumbers.length) {
      copy.lines.push("Teammate numbers ruled out by public passes: " + copy.teammateVoidNumbers.join(", ") + ".");
    }
    if (copy.teammateSuspectedMissingNumbers && copy.teammateSuspectedMissingNumbers.length) {
      copy.lines.push("Teammate may lack these numbers after repeatedly playing away from them: " +
        copy.teammateSuspectedMissingNumbers.join(", ") + " (suspected, not confirmed).");
    }
    return copy;
  }
  const whose = copy.owner === "self" ? "this hand" : copy.owner === "teammate" ? "the teammate" : "an opponent";
  const stance = copy.switched
    ? "Switching"
    : copy.held ? "Keeping" : "Starting";
  copy.lines = [
    stance + " " + copy.mode + " on " + copy.target + " for " + whose +
      ". Confidence " + round1(copy.confidence) + ".",
    copy.evidence,
    copy.teammateTarget != null && (copy.owner !== "teammate" || copy.target !== copy.teammateTarget)
      ? "Separate teammate-support target: " + copy.teammateTarget + " (confidence " +
        round1(copy.teammateConfidence) + "). Keep this objective visible even when this move follows another plan."
      : null,
    copy.teammateVoidNumbers && copy.teammateVoidNumbers.length
      ? "Teammate numbers ruled out by public passes: " + copy.teammateVoidNumbers.join(", ") + "."
      : null,
    copy.teammateSuspectedMissingNumbers && copy.teammateSuspectedMissingNumbers.length
      ? "Teammate may lack these numbers after repeatedly playing away from them: " +
        copy.teammateSuspectedMissingNumbers.join(", ") + " (suspected, not confirmed)."
      : null,
    copy.held
      ? "The previous plan still fits the public evidence."
      : copy.switched
        ? "The previous plan was dropped because it is no longer feasible or another plan scores at least " + SWITCH_MARGIN + " higher."
        : "This is the first committed plan for this deal."
  ].filter(Boolean);
  return copy;
}

function resolvePlan(view, beliefs, options) {
  if (options && options.ignorePlan) return withLines(emptyPlan("Plan memory is turned off for this decision."));
  const fresh = freshPlan(view, beliefs || {});
  const key = dealKey(view);
  const prev = memory.get(key);
  let next = fresh;
  if (prev && stillFeasible(prev, view, beliefs)) {
    const freshScore = fresh && fresh.mode !== "none" ? fresh.score : 0;
    const different = !fresh || fresh.mode !== prev.mode || fresh.target !== prev.target;
    if (!different || freshScore < prev.score + SWITCH_MARGIN) {
      next = Object.assign({}, prev, {
        held: true,
        switched: false,
        confidence: different ? prev.confidence : (fresh.confidence || prev.confidence)
      });
      if (!different && fresh && fresh.evidence) next.evidence = fresh.evidence;
    } else {
      next = Object.assign({}, fresh, { switched: true, held: false });
    }
  } else if (prev && prev.mode !== "none" && (fresh.mode !== prev.mode || fresh.target !== prev.target)) {
    next = Object.assign({}, fresh, { switched: true, held: false });
  }
  next.teammateTarget = fresh.teammateTarget != null ? fresh.teammateTarget : (prev && prev.teammateTarget != null ? prev.teammateTarget : null);
  next.teammateConfidence = fresh.teammateConfidence || (prev && prev.teammateConfidence) || 0;
  next.teammateVoidNumbers = fresh.teammateVoidNumbers || (prev && prev.teammateVoidNumbers) || [];
  next.teammateSuspectedMissingNumbers = fresh.teammateSuspectedMissingNumbers ||
    (prev && prev.teammateSuspectedMissingNumbers) || [];
  remember(key, next);
  const lined = withLines(next);
  note(lined);
  return lined;
}

module.exports = {
  resolvePlan,
  clearPlans,
  freshPlan,
  planStats,
  SWITCH_MARGIN
};
