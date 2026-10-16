"use strict";

/*
 * A plan stays with one deal. The key is the bot's own tiles: the current
 * hand plus the tiles this seat has already played. A new deal has a new
 * set, so a stored plan cannot leak into it.
 */

const memory = new Map();
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
  return view.selfId + "|" + Array.from(ids).sort().join(",");
}

function clearPlans() {
  memory.clear();
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

function freshPlan(view, beliefs) {
  const inventory = beliefs && beliefs._inventory;
  const own = ownCandidate(inventory);
  const mateId = partnerId(view);
  const mateIntent = intentionOf(beliefs, mateId);
  let mate = null;
  if (mateIntent && mateIntent.preferred != null && mateIntent.confidence >= 0.45) {
    const info = mateIntent.byPip[mateIntent.preferred];
    const voids = (beliefs[mateId].knownImpossibleNumbers || []);
    if (info && voids.indexOf(mateIntent.preferred) < 0 && info.pAtLeastOne >= 0.2 && !(info.missed >= 0.75 && info.pAtLeastOne < 0.35)) {
      mate = {
        pip: mateIntent.preferred,
        score: mateIntent.confidence * 6 + (info.pMultiple || 0) * 2,
        info: info
      };
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
  if (selfScore >= mateScore && selfScore >= oppScore && selfScore > 0) {
    return {
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
  }
  if (mateScore >= oppScore && mateScore > 0) {
    return {
      mode: "teammate-support",
      target: mate.pip,
      owner: "teammate",
      ownerId: mateId,
      confidence: mateIntent.confidence,
      score: mateScore,
      held: false,
      switched: false,
      evidence: "Teammate tiles contain " + mate.pip + " across " + round1(mate.info.inTile) +
        " deliberate plays, with " + round1(mate.info.bridged) + " linking the previous tile."
    };
  }
  if (oppScore > 0) {
    return {
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
  }
  return emptyPlan();
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
    copy.held
      ? "The previous plan still fits the public evidence."
      : copy.switched
        ? "The previous plan was dropped because it is no longer feasible or another plan scores at least " + SWITCH_MARGIN + " higher."
        : "This is the first committed plan for this deal."
  ];
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
