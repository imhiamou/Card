"use strict";

/*
 * Diagnostic snapshot for the partnership bot.
 *
 * This module does not choose a second move. It explains the ranked row
 * the decision function already selected. Room 1111 is the only caller
 * that may send the result to a client, and only to that client's socket.
 *
 * There is no login or development flag. Anyone seated in room 1111 can
 * request the seated bots' snapshots, including the inspected bot's hand.
 * Every other room is refused. The snapshot is not part of the public
 * game state and is not broadcast with dominoState.
 */

const { api, cloneTile, touches } = require("./engine");
const { rankMoves, previewEnds, partnerId, canPlayProbability, isOpponent, playerByOffset } = require("./eval");
const { publicIntention } = require("./intent");

const MODE_WIN = "Going for the win";
const MODE_MATE = "Supporting teammate";
const MODE_BLOCK = "Blocking opponents";
const MODE_BOARD = "Controlling the board";
const MODE_BLOCKED = "Winning the block";
const MODE_DEFEND = "Defensive recovery";
const MODE_RE = "Re-evaluating";

function round3(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function signWord(value) {
  const rounded = round3(value);
  if (rounded == null) return "unavailable";
  if (rounded > 0) return "positive";
  if (rounded < 0) return "negative";
  return "neutral";
}

function positionKey(view) {
  const hand = (view && view.hand ? view.hand : []).map((tile) => tile.id).sort().join(",");
  const seats = (view && view.players ? view.players : []).map((player) => {
    return player.id + ":" + player.handCount + ":" + (player.team || "");
  }).join(",");
  const log = (view && view.log ? view.log : []).map((event) => {
    const tile = event && event.tile ? event.tile.id : "";
    return [event && event.type, event && event.playerId, tile, event && event.leftEnd, event && event.rightEnd].join(":");
  }).join(";");
  return [
    view && view.selfId,
    view && view.leftEnd,
    view && view.rightEnd,
    view && view.chain ? view.chain.length : 0,
    view && view.boneyardCount,
    view && view.mustPlayId,
    hand,
    seats,
    log
  ].join("|");
}

function tileLabel(tile) {
  if (!tile) return "unknown";
  return "[" + tile.a + "|" + tile.b + "]";
}

function copyTile(tile) {
  if (!tile) return null;
  return { id: tile.id, a: tile.a, b: tile.b };
}

function handTile(view, tileId) {
  return (view.hand || []).find((tile) => tile.id === tileId) || null;
}

function deriveMode(parts, context) {
  if (context && context.recalculating) {
    return {
      label: MODE_RE,
      code: "RECOVER_FROM_BAD_POSITION",
      reason: "New evidence or a new board changed the position, and the selected move is being updated."
    };
  }
  if (!parts) {
    return {
      label: null,
      code: null,
      reason: "Evaluation components are unavailable, so a strategic mode was not assigned."
    };
  }
  if (parts.immediateWin > 0) {
    return {
      label: MODE_WIN,
      code: "FINISH_OWN_HAND",
      reason: "The selected tile empties this hand."
    };
  }
  const groups = [
    {
      label: MODE_MATE,
      value: (parts.mateReply || 0) + (parts.mateSuit || 0) + Math.max(0, parts.intentKeep || 0) + Math.max(0, parts.mateFinish || 0),
      reason: "Teammate continuation is the largest positive component."
    },
    {
      label: MODE_BLOCK,
      value: Math.max(0, parts.forcePass || 0) + Math.max(0, -(parts.denyNext || 0)) + Math.max(0, -(parts.otherOpp || 0)) + Math.max(0, parts.oppVoidExploit || 0) + Math.max(0, -(parts.oppFeed || 0)) + Math.max(0, -(parts.mateVoidHarm || 0)),
      reason: "Denying an opponent response is the largest component."
    },
    {
      label: MODE_BOARD,
      value: (parts.ownOuts || 0) + (parts.stuckDouble || 0),
      reason: "Preserving follow-up moves and favorable ends is the largest component."
    },
    {
      label: MODE_BLOCKED,
      value: (parts.blockEquity || 0) > 0 ? parts.blockEquity : 0,
      reason: "The blocked-round estimate favors this team and is the largest component."
    },
    {
      label: MODE_DEFEND,
      value: ((parts.oppOut || 0) < 0 ? -(parts.oppOut || 0) : 0) + ((parts.otherFinish || 0) < 0 ? -(parts.otherFinish || 0) : 0) + ((parts.blockEquity || 0) < 0 ? -(parts.blockEquity || 0) : 0),
      reason: "The move reduces the estimated chance of a team loss."
    }
  ];
  if (context && context.canEmpty) {
    groups.push({
      label: MODE_WIN,
      value: (parts.ownOuts || 0) + (parts.shedPips || 0) + (parts.dumpDouble || 0),
      reason: "The projected continuation can empty this hand if the ends stay in place, and that value is the largest component."
    });
  }
  let best = null;
  groups.forEach((group) => {
    if (group.value > 0 && (!best || group.value > best.value)) best = group;
  });
  if (!best) {
    return {
      label: null,
      code: null,
      reason: "No evaluation component is large enough to name a strategic mode. The selected move is the highest ranked legal play."
    };
  }
  return { label: best.label, code: modeCode(best.label, parts), reason: best.reason };
}

function modeCode(label, parts) {
  if (label === MODE_WIN) return "FINISH_OWN_HAND";
  if (label === MODE_MATE) return "SUPPORT_PARTNER";
  if (label === MODE_BLOCKED) return "FORCE_FAVORABLE_BLOCK";
  if (label === MODE_BOARD) return "ESTABLISH_OWN_STRENGTH";
  if (label === MODE_BLOCK) {
    return (parts && (parts.forcePass || 0) > 0 && (parts.blockEquity || 0) > 0)
      ? "FORCE_FAVORABLE_BLOCK"
      : "DENY_OPPONENT";
  }
  if (label === MODE_DEFEND) {
    const finishRisk = -((parts && parts.oppOut) || 0) + -((parts && parts.otherFinish) || 0);
    const recovery = (parts && parts.blockEquity) < 0 ? -(parts.blockEquity || 0) : 0;
    return finishRisk >= recovery ? "DEFEND_AGAINST_FINISH" : "RECOVER_FROM_BAD_POSITION";
  }
  if (label === MODE_RE) return "RECOVER_FROM_BAD_POSITION";
  return null;
}

function project(view, beliefs, weights, move, options, role) {
  const tile = handTile(view, move.tileId);
  const ends = previewEnds(view, move);
  if (!tile || !ends) return null;
  const steps = [];
  let hand = (view.hand || []).filter((item) => item.id !== tile.id).map(cloneTile);
  let left = ends.leftEnd;
  let right = ends.rightEnd;
  let chain = (view.chain || []).map(cloneTile);
  if (!chain.length) chain = [{ id: "plan-open", a: left, b: right }];
  else chain = chain.concat([{ id: "plan-step", a: left, b: right }]);
  for (let depth = 0; depth < 3 && hand.length; depth++) {
    const moves = api().listValidMoves(hand, left, right, chain.length, null);
    if (!moves.length) break;
    const sim = Object.assign({}, view, {
      hand: hand,
      leftEnd: left,
      rightEnd: right,
      chain: chain,
      validMoves: moves,
      mustPlayId: null
    });
    const ranked = rankMoves(sim, beliefs, weights, options);
    if (!ranked.length || !Number.isFinite(ranked[0].score)) break;
    const next = ranked[0].move;
    const nextTile = hand.find((item) => item.id === next.tileId);
    if (!nextTile) break;
    steps.push({
      role: role,
      tileId: next.tileId,
      side: next.side,
      tile: copyTile(nextTile),
      conditional: true,
      assumption: "This follow-up assumes the ends stay as this bot left them. Another player's tile can make it illegal."
    });
    const placed = previewEnds(sim, next);
    if (!placed) break;
    hand = hand.filter((item) => item.id !== next.tileId);
    left = placed.leftEnd;
    right = placed.rightEnd;
    chain = chain.concat([{ id: "plan-" + depth, a: left, b: right }]);
  }
  let note = null;
  if (!steps.length) {
    note = "A longer sequence is unavailable because no remaining tile matches the ends this move leaves. The next move is the only step the search can stand behind.";
  } else if (hand.length && !api().listValidMoves(hand, left, right, chain.length, null).length) {
    note = "Further tiles in hand do not match these ends. Later steps are not shown.";
  }
  return { steps: steps, note: note };
}

function moveRow(view, row, role, conditional) {
  const tile = handTile(view, row.move.tileId);
  return {
    role: role,
    tileId: row.move.tileId,
    side: row.move.side,
    tile: copyTile(tile),
    score: round3(row.score),
    conditional: !!conditional,
    parts: row.parts || null,
    wins: row.wins == null ? null : row.wins,
    samplesUsed: row.samplesUsed == null ? null : row.samplesUsed,
    mean: round3(row.mean)
  };
}

function componentReport(parts) {
  const names = [
    ["immediateWin", "Immediate winning opportunity"],
    ["mateReply", "Teammate continuation"],
    ["mateSuit", "Teammate suit support"],
    ["denyNext", "Next opponent response"],
    ["otherOpp", "Other opponent response"],
    ["oppOut", "Opponent go-out risk"],
    ["forcePass", "Forced pass"],
    ["blockEquity", "Blocked-round outcome"],
    ["ownOuts", "Own follow-up moves"],
    ["stuckDouble", "Double control"],
    ["shedPips", "Pip shedding"],
    ["dumpDouble", "Double shedding"],
    ["pointBonus", "Point bonus"],
    ["intentKeep", "Teammate number kept"],
    ["mateVoidHarm", "Teammate void harmed"],
    ["mateFinish", "Teammate finish"],
    ["oppVoidExploit", "Opponent void used"],
    ["oppFeed", "Opponent number fed"],
    ["otherFinish", "Later opponent finish"]
  ];
  if (!parts) {
    return names.map((entry) => ({
      key: entry[0],
      label: entry[1],
      value: null,
      sign: "unavailable"
    }));
  }
  return names.map((entry) => ({
    key: entry[0],
    label: entry[1],
    value: round3(parts[entry[0]]),
    sign: signWord(parts[entry[0]])
  }));
}

function overrideText(chosen, alternative, samples) {
  if (!chosen || !chosen.parts || !alternative || !alternative.parts) {
    return {
      kind: "unavailable",
      text: "A comparison with another candidate is unavailable."
    };
  }
  const mate = (row) => (row.parts.mateReply || 0) + (row.parts.mateSuit || 0);
  const own = (row) => (row.parts.immediateWin || 0) + (row.parts.ownOuts || 0) + (row.parts.shedPips || 0) + (row.parts.dumpDouble || 0);
  const chosenMate = mate(chosen);
  const altMate = mate(alternative);
  const sampleNote = samples > 0 && chosen.samplesUsed
    ? " Sample win fraction " + round3(chosen.wins / chosen.samplesUsed) + " over " + chosen.samplesUsed + " samples."
    : " A win probability is unavailable because this decision has no completed search samples.";
  if ((chosen.parts.immediateWin || 0) > 0 && altMate > chosenMate) {
    return {
      kind: "own-finish",
      text: "Prioritizing my own finish. The selected line empties this hand and scores " +
        round3(chosen.score) + ", above the partnership alternative at " + round3(alternative.score) + "." + sampleNote
    };
  }
  if (own(chosen) > own(alternative) && chosen.score >= alternative.score && altMate > chosenMate) {
    return {
      kind: "own-finish",
      text: "Prioritizing my own finish. The selected line has a higher estimated score (" +
        round3(chosen.score) + ") than the available partnership-supporting alternative (" +
        round3(alternative.score) + ")." + sampleNote
    };
  }
  if (chosenMate > altMate && own(alternative) > own(chosen)) {
    return {
      kind: "partnership",
      text: "Prioritizing the teammate. Partnership terms on the selected move are higher, and the more selfish line scored " +
        round3(alternative.score) + " against " + round3(chosen.score) + "." + sampleNote
    };
  }
  return {
    kind: "aligned",
    text: "The selected move is the highest scored legal play. Partnership support and this bot's own route do not conflict on the recorded components." +
      sampleNote
  };
}

function numberNotes(belief, kind) {
  if (!belief) return [];
  if (kind === "proven") {
    return (belief.knownImpossibleNumbers || []).map((pip) => ({
      pip: pip,
      confidence: "proven",
      evidence: (belief.passHistory || []).filter((pass) => !pass.invalidated && (pass.ends || []).indexOf(pip) >= 0)
    }));
  }
  if (kind === "weak") {
    const weak = belief.suspectedWeakNumbers || {};
    return Object.keys(weak).map((pip) => ({
      pip: Number(pip),
      confidence: "probabilistic",
      count: weak[pip],
      evidence: (belief.passHistory || []).filter((pass) => pass.invalidated && (pass.ends || []).indexOf(Number(pip)) >= 0)
    }));
  }
  const strong = belief.suspectedStrongNumbers || {};
  return Object.keys(strong).map((pip) => ({
    pip: Number(pip),
    confidence: round3(strong[pip]),
    support: belief.numberSupportScores ? belief.numberSupportScores[pip] : null,
    evidence: (belief.recent || []).filter((event) => event.type === "play")
  }));
}

function preservesPip(view, move, pip) {
  const rest = (view.hand || []).filter((tile) => tile.id !== move.tileId);
  return rest.some((tile) => touches(tile, pip));
}

function partnershipReport(view, beliefs, chosen, ranked) {
  const mateId = partnerId(view);
  if (!mateId) {
    return { available: false, reason: "This table has no teammate." };
  }
  const belief = beliefs[mateId] || null;
  const mate = (view.players || []).find((player) => player.id === mateId) || null;
  const preview = chosen ? previewEnds(view, chosen.move) : null;
  const reply = preview && mate ? canPlayProbability(view, beliefs, mate, preview.leftEnd, preview.rightEnd) : null;
  const strong = numberNotes(belief, "strong");
  const kept = strong.filter((note) => chosen && preservesPip(view, chosen.move, note.pip)).map((note) => note.pip);
  const plan = beliefs._plan || null;
  const committedTarget = plan && plan.mode === "teammate-support"
    ? plan.target : plan && plan.teammateTarget != null ? plan.teammateTarget : null;
  const intention = belief && belief.intention;
  const byPip = intention && intention.byPip || [];
  const provenPips = belief && belief.knownImpossibleNumbers || [];
  const numberBeliefs = byPip.map((info, pip) => {
    const probability = info.pAtLeastOne == null ? null : round3(info.pAtLeastOne);
    let status = "uncertain";
    if (provenPips.indexOf(pip) >= 0) status = "proven-absent";
    else if (probability != null && probability >= 0.65) status = "likely-has";
    else if (probability != null && probability < 0.35) status = "possibly-weak";
    return { pip: pip, probability: probability, expectedTiles: round3(info.expectedTiles || 0), status: status };
  });
  const resultingEnds = chosen ? previewEnds(view, chosen.move) : null;
  const preservesObjective = committedTarget != null && resultingEnds
    ? resultingEnds.leftEnd === committedTarget || resultingEnds.rightEnd === committedTarget : null;
  const preservingCandidates = committedTarget == null ? [] : (ranked || []).filter((row) => {
    if (!row || !row.move) return false;
    const ends = previewEnds(view, row.move);
    return ends && (ends.leftEnd === committedTarget || ends.rightEnd === committedTarget);
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
  const recommended = preservingCandidates[0] || null;
  let recommendation = "No teammate number has enough evidence to commit to yet.";
  if (committedTarget != null && recommended) {
    const sameAsChosen = chosen && recommended.move.tileId === chosen.move.tileId && recommended.move.side === chosen.move.side;
    recommendation = sameAsChosen
      ? "Best support move: the selected " + recommended.move.side + "-end play keeps " + committedTarget +
        " open and is the highest-scoring legal move among those that preserve it."
      : "Best support move: prefer a legal " + recommended.move.side + "-end play that leaves " + committedTarget +
        " open (highest-scoring candidate that preserves the target). The currently selected move does not do this.";
  } else if (committedTarget != null) {
    recommendation = "No legal move leaves " + committedTarget +
      " open. Keep the teammate-support strategy, then choose the highest team-advantage legal move without conceding an immediate win.";
  }
  return {
    available: true, playerId: mateId, handCount: mate ? mate.handCount : null,
    strong: strong, provenVoids: numberNotes(belief, "proven"), suspectedWeak: numberNotes(belief, "weak"),
    numberBeliefs: numberBeliefs,
    inferredPreferredNumber: intention && intention.preferred != null ? intention.preferred : null,
    preferenceConfidence: intention ? round3(intention.confidence) : 0,
    committedMode: plan ? plan.mode : "none", committedTarget: committedTarget,
    preservesObjective: preservesObjective, recommendation: recommendation,
    replyProbability: round3(reply), replyCertain: false, preserves: kept,
    helpsEmpty: reply != null && mate && mate.handCount > 0 && reply >= 0.5,
    helpNote: reply == null ? "A teammate reply estimate is unavailable."
      : "Estimated chance the teammate can match the resulting ends: " + round3(reply) + ". This is not knowledge of the teammate's hand."
  };
}

function opponentReport(view, beliefs, chosen) {
  const preview = chosen ? previewEnds(view, chosen.move) : null;
  const opponents = (view.players || []).filter((player) => isOpponent(view, player.id));
  let dangerous = null;
  const rows = opponents.map((player) => {
    const belief = beliefs[player.id] || {};
    const current = canPlayProbability(view, beliefs, player, view.leftEnd, view.rightEnd);
    const after = preview ? canPlayProbability(view, beliefs, player, preview.leftEnd, preview.rightEnd) : null;
    const row = {
      playerId: player.id,
      handCount: player.handCount,
      provenVoids: numberNotes(belief, "proven"),
      suspectedWeak: numberNotes(belief, "weak"),
      strong: numberNotes(belief, "strong"),
      playableNow: round3(current),
      playableAfter: round3(after),
      certain: false
    };
    if (!dangerous || player.handCount < dangerous.handCount ||
      (player.handCount === dangerous.handCount && current > dangerous.playableNow)) {
      dangerous = { playerId: player.id, handCount: player.handCount, playableNow: current };
    }
    return row;
  });
  const forcesPass = !!(chosen && chosen.parts && chosen.parts.forcePass > 0);
  return {
    opponents: rows,
    mostDangerous: dangerous ? dangerous.playerId : null,
    forcesPass: forcesPass,
    deniesWin: !!(chosen && chosen.parts && chosen.parts.oppOut < 0)
  };
}

function roundChance(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function plainSummary(view, beliefs, chosen, mode) {
  const mateId = partnerId(view);
  const mateIntent = mateId && beliefs[mateId] ? publicIntention(beliefs[mateId].intention) : null;
  const next = playerByOffset(view, 1);
  const preview = chosen ? previewEnds(view, chosen.move) : null;
  const pNext = preview && next ? canPlayProbability(view, beliefs, next, preview.leftEnd, preview.rightEnd) : null;
  const mate = mateId ? (view.players || []).find((player) => player.id === mateId) : null;
  const pMate = preview && mate ? canPlayProbability(view, beliefs, mate, preview.leftEnd, preview.rightEnd) : null;
  const nextIsMate = !!(next && mateId && next.id === mateId);
  let noticed = "I do not have a repeated teammate choice yet.";
  if (mateIntent && mateIntent.lastMoveForced) {
    noticed = "My teammate's last play was likely forced, so I am not treating it as a chosen number.";
  } else if (mateIntent && mateIntent.preferred != null && mateIntent.confidence >= 0.45) {
    noticed = "My teammate has kept " + mateIntent.preferred + " available on purpose. Confidence " +
      roundChance(mateIntent.confidence) + ".";
  }
  const mateVoids = mateId && beliefs[mateId] ? beliefs[mateId].knownImpossibleNumbers || [] : [];
  if (mateVoids.length) {
    noticed += " My teammate has passed on " + mateVoids.join(" and ") + ".";
  }
  const oppVoids = [];
  (view.players || []).forEach((player) => {
    if (!player || player.id === view.selfId || player.id === mateId) return;
    const voids = beliefs[player.id] ? beliefs[player.id].knownImpossibleNumbers || [] : [];
    if (voids.length) oppVoids.push(player.id + " passed on " + voids.join(" and "));
  });
  if (oppVoids.length) noticed += " " + oppVoids.join(". ") + ".";
  let expect = "I do not have a reply estimate yet.";
  if (pNext != null || pMate != null) {
    expect = (next ? "Next is " + next.id : "Next player") +
      " and can answer with chance " + (roundChance(pNext) == null ? "unknown" : roundChance(pNext)) +
      ". Teammate can answer with chance " + (roundChance(pMate) == null ? "unknown" : roundChance(pMate)) + ".";
    if (!nextIsMate && pNext > 0) {
      expect += " They play before my teammate, so a kept number may not survive.";
    }
  }
  let risk = null;
  if (next && next.handCount === 1 && isOpponent(view, next.id) && pNext > 0) {
    risk = "The next opponent may finish.";
  } else if (!nextIsMate && pNext >= 0.5 && mateIntent && mateIntent.preferred != null) {
    risk = "The next opponent may change the end before my teammate plays.";
  } else if (chosen && chosen.parts && chosen.parts.mateVoidHarm < 0) {
    risk = "This leaves a number my teammate has already passed on.";
  }
  return {
    plan: mode && mode.label ? mode.label : null,
    noticed: noticed.trim(),
    expect: expect,
    risk: risk,
    nextCanPlay: roundChance(pNext),
    teammateCanPlay: roundChance(pMate),
    nextIsTeammate: nextIsMate,
    teammateIntention: mateIntent
  };
}

function publicBelief(belief) {
  if (!belief) return null;
  return {
    knownImpossibleNumbers: (belief.knownImpossibleNumbers || []).slice(),
    suspectedWeakNumbers: Object.assign({}, belief.suspectedWeakNumbers || {}),
    suspectedStrongNumbers: Object.assign({}, belief.suspectedStrongNumbers || {}),
    numberSupportScores: (belief.numberSupportScores || []).slice(),
    numberSupportConfidence: (belief.numberSupportConfidence || []).map(round3),
    passHistory: (belief.passHistory || []).map((pass) => ({
      ends: (pass.ends || []).slice(),
      invalidated: !!pass.invalidated
    })),
    remainingTileCount: belief.remainingTileCount,
    recent: (belief.recent || []).map((event) => Object.assign({}, event)),
    intention: publicIntention(belief.intention)
  };
}

function planSentence(pred, label) {
  const samples = pred.samples;
  const counts = pred.counts || {};
  if (!pred.trusted) {
    return "My plan: " + samples + " deals do not agree on the next board, so " + label + " stays the highest immediate evaluation.";
  }
  if (pred.pBotFinishNext >= 0.5 && pred.pBotFinishNext >= (pred.pTeammateFinish || 0)) {
    return "My plan: Empty this hand. " + label + " leads to a finish in " + counts.botFinish + " of " + samples + " deals.";
  }
  if (pred.pTeammateFinish >= 0.5 && pred.pTeammateFinish > (pred.pBotFinishNext || 0)) {
    return "My plan: Let my teammate finish. They empty their hand in " + counts.mateFinished + " of " + samples + " deals.";
  }
  if ((pred.pMaintain || 0) >= 0.5 && (pred.pMaintain || 0) >= (pred.pForcedAbandon || 0)) {
    return "My plan: Keep my teammate's number available. They continue it in " + counts.maintained + " of " + samples + " deals.";
  }
  if ((pred.pForcedAbandon || 0) >= 0.5) {
    return "My plan: " + label + " still leaves my teammate forced off their number in " + counts.forcedAbandon + " of " + samples + " deals.";
  }
  if ((pred.pRoundEnds || 0) >= 0.5 && pred.mean > 0) {
    return "My plan: The round ends before my next turn in " + counts.endedBefore + " of " + samples + " deals, and the sampled result favors this team.";
  }
  if ((pred.pRoundEnds || 0) >= 0.5 && pred.mean < 0) {
    return "My plan: The sampled deals lose before my next turn in " + counts.endedBefore + " of " + samples + ".";
  }
  return "My plan: " + label + " has the best sampled team result (" + round3(pred.mean) + ").";
}

function riskSentence(pred) {
  const counts = pred.counts || {};
  const samples = pred.samples;
  if (counts.removed > 0) {
    return "Main risk: An opponent removes my teammate's number before they act in " + counts.removed + " of " + samples + " deals.";
  }
  if (counts.forcedAbandon > 0) {
    return "Main risk: My teammate is forced to give up their number in " + counts.forcedAbandon + " of " + samples + " deals.";
  }
  if (counts.matePassed > 0 && counts.matePlayed === 0) {
    return "Main risk: My teammate passes in every sampled deal (" + counts.matePassed + " of " + samples + ").";
  }
  if (counts.endedBefore > 0 && pred.mean < 0) {
    return "Main risk: The round ends against this team before my next turn in " + counts.endedBefore + " of " + samples + " deals.";
  }
  return "Main risk: The sampled deals did not show an opponent taking my teammate's number away.";
}

function responseSentence(pred, alternative, label) {
  if (!alternative || !alternative.move) {
    return "My response: " + label + " is the only simulated line.";
  }
  const altMean = alternative.prediction && alternative.prediction.samples
    ? alternative.prediction.mean
    : alternative.prior != null ? alternative.prior : alternative.score;
  return "My response: Prefer " + label + " over " + alternative.move.tileId +
    " on the " + alternative.move.side + " because the simulated means are " +
    round3(pred.mean) + " and " + round3(altMean) + ".";
}

function describeNextTurn(view, chosen, alternative) {
  const pred = chosen && chosen.prediction;
  if (!pred || !pred.samples) {
    return {
      available: false,
      samples: 0,
      plan: null,
      risk: null,
      response: null,
      lines: ["No intervening turns were simulated for this decision."],
      expectedEnds: null,
      actions: [],
      rates: null
    };
  }
  const tile = handTile(view, chosen.move.tileId);
  const label = tileLabel(tile);
  const plan = planSentence(pred, label);
  const risk = riskSentence(pred);
  const response = responseSentence(pred, alternative, label);
  const samples = pred.samples;
  const counts = pred.counts || {};
  const lines = [plan, risk, response];
  if (pred.modalEnds) {
    lines.push(
      "Expected ends when the turn returns: " + pred.modalEnds.left + " and " + pred.modalEnds.right +
      " in " + pred.modalEnds.n + " of " + samples + " deals."
    );
  } else {
    lines.push("The sampled deals did not agree on open ends for the next turn.");
  }
  (pred.actions || []).forEach((action) => {
    if (!action || action.n == null) return;
    if (action.type === "pass") {
      lines.push(action.playerId + " passes in " + action.n + " of " + samples + " deals.");
    } else {
      const forced = action.forced ? " That play was the only legal tile in the sampled hand." : "";
      lines.push(
        action.playerId + " most often plays the " + action.side + " end and leaves " + action.exposed +
        " (" + action.n + " of " + samples + ")." + forced
      );
    }
  });
  lines.push(
    "Teammate plays in " + (counts.matePlayed || 0) + " of " + samples +
    " and passes in " + (counts.matePassed || 0) + " of " + samples + "."
  );
  lines.push(
    "Teammate keeps the preferred number in " + (counts.maintained || 0) +
    " of " + samples + ", an opponent removes it in " + (counts.removed || 0) +
    " of " + samples + ", and the teammate is forced to give it up in " + (counts.forcedAbandon || 0) +
    " of " + samples + "."
  );
  return {
    available: true,
    samples: samples,
    plan: plan,
    risk: risk,
    response: response,
    lines: lines,
    expectedEnds: pred.modalEnds || null,
    actions: pred.actions || [],
    rates: {
      teammatePlay: pred.pTeammatePlay,
      teammatePass: pred.pTeammatePass,
      maintain: pred.pMaintain,
      abandon: pred.pAbandon,
      forcedAbandon: pred.pForcedAbandon,
      preferredRemoved: pred.pPreferredRemoved,
      preferredSurvives: pred.pPreferredSurvives,
      teammateFinish: pred.pTeammateFinish,
      opponentDanger: pred.pOpponentDanger,
      botUseful: pred.pBotUseful,
      botFinishNext: pred.pBotFinishNext,
      roundEnds: pred.pRoundEnds
    },
    partnerContinuation: pred.partnerContinuation,
    mean: round3(pred.mean)
  };
}

function unavailableSnapshot(view, reason) {
  const message = reason || "A diagnostic snapshot is unavailable.";
  return {
    available: false,
    status: "error",
    error: message,
    reason: message,
    positionKey: positionKey(view || {}),
    botId: view && view.selfId,
    playerId: view && view.selfId,
    team: view && view.players && view.selfId
      ? ((view.players.find((player) => player.id === view.selfId) || {}).team || null)
      : null,
    hand: (view && view.hand ? view.hand : []).map(copyTile),
    legalMoves: (view && view.validMoves ? view.validMoves : []).map((move) => ({
      tileId: move.tileId,
      side: move.side
    })),
    selected: null,
    selectedMove: null,
    candidateEvaluations: [],
    mode: { label: null, reason: message },
    strategicMode: { label: null, reason: message },
    plan: { selected: null, continuation: [], alternatives: [], note: message },
    plannedContinuation: [],
    reasoning: message,
    scores: [],
    stage: "unavailable",
    samples: 0,
    conflicts: 0,
    conflict: "",
    nodes: 0,
    ms: 0,
    searchStats: { stage: "unavailable", samples: 0, conflicts: 0, nodes: 0, ms: 0, interrupted: false },
    beliefs: []
  };
}

function clientSnapshot(diagnostics) {
  const source = diagnostics || unavailableSnapshot(null, "No decision was recorded.");
  let copy = null;
  try {
    copy = JSON.parse(JSON.stringify(source));
  } catch (err) {
    copy = unavailableSnapshot(null, "The diagnostic snapshot could not be serialized.");
  }
  if (!copy.status) copy.status = copy.available === false ? "error" : "ready";
  copy.playerId = copy.playerId || copy.botId || null;
  copy.teamId = copy.teamId || copy.team || null;
  copy.boardEnds = copy.boardEnds || {
    left: copy.leftEnd == null ? null : copy.leftEnd,
    right: copy.rightEnd == null ? null : copy.rightEnd
  };
  copy.selectedMove = copy.selectedMove || copy.selected || null;
  copy.legalMoves = Array.isArray(copy.legalMoves) ? copy.legalMoves : [];
  copy.candidateEvaluations = Array.isArray(copy.candidateEvaluations) ? copy.candidateEvaluations : (copy.scores || []);
  copy.plannedContinuation = Array.isArray(copy.plannedContinuation)
    ? copy.plannedContinuation
    : (copy.plan && copy.plan.continuation) || [];
  copy.strategicMode = copy.strategicMode || copy.mode || null;
  copy.reasoning = copy.reasoning || (copy.comparison && copy.comparison.text) || null;
  copy.teammateAnalysis = copy.teammateAnalysis || copy.partnership || null;
  copy.opponentAnalysis = copy.opponentAnalysis || copy.opponents || null;
  copy.searchStats = copy.searchStats || {
    stage: copy.stage,
    samples: copy.samples,
    conflicts: copy.conflicts,
    nodes: copy.nodes,
    ms: copy.ms,
    interrupted: false
  };
  copy.lastUpdatedAt = Date.now();
  if (copy.status === "error" && !copy.error) copy.error = copy.reason || "The decision failed.";
  if (copy.status !== "error") copy.error = null;

  // Diagnostics are delivered to a client. Keep the strategy explanation,
  // counts, probabilities, and scores, but never serialize a hidden hand or
  // a tile identity/value that would reveal a bot's private tiles.
  function redact(value, path) {
    if (Array.isArray(value)) return value.map((item, index) => redact(item, (path || "") + "[" + index + "]"));
    if (!value || typeof value !== "object") return value;
    const safe = {};
    const currentPath = path || "";
    Object.keys(value).forEach((key) => {
      const identityIsInspectable = /(^|\.)(legalMoves|candidateEvaluations|selectedMove|selected|scores|plan|continuation|alternatives|publicActions|decisionRecords)(\.|\[|$)/.test(currentPath);
      if (/^(hand|hands|tiles|handTiles|unseenTileIds|positionKey)$/i.test(key)) return;
      if (/^(tile|tileId|tileIds)$/i.test(key) && !identityIsInspectable) return;
      safe[key] = redact(value[key], currentPath + "." + key);
    });
    return safe;
  }
  return redact(copy);
}

function buildDiagnostics(input) {
  const view = input.view;
  const beliefs = input.beliefs || {};
  const ranked = input.ranked || [];
  const chosenMove = input.chosen;
  const report = input.report || null;
  const weights = input.weights;
  const options = input.options || null;
  const chosen = ranked.find((row) => row.move.tileId === chosenMove.tileId && row.move.side === chosenMove.side) || ranked[0];
  const alternative = ranked.find((row) => row !== chosen) || null;
  const samples = report ? report.samples : 0;
  const selected = chosen ? moveRow(view, chosen, "selected", false) : null;
  const projected = chosen ? project(view, beliefs, weights, chosen.move, options, "preferred-continuation") : null;
  const altProjected = alternative ? project(view, beliefs, weights, alternative.move, options, "alternative") : null;
  const handCount = (view.hand || []).length;
  const mode = deriveMode(chosen && chosen.parts, {
    canEmpty: !!(projected && projected.steps && handCount > 0 && projected.steps.length + 1 >= handCount)
  });
  const nextTurn = describeNextTurn(view, chosen, alternative);
  const confidence = selected && samples > 0 && selected.samplesUsed
    ? { kind: "sample-win-fraction", value: round3(selected.wins / selected.samplesUsed), samples: selected.samplesUsed }
    : { kind: "unavailable", value: null, samples: samples || 0 };
  return {
    available: true,
    positionKey: positionKey(view),
    botId: view.selfId,
    team: ((view.players || []).find((player) => player.id === view.selfId) || {}).team || null,
    leftEnd: view.leftEnd,
    rightEnd: view.rightEnd,
    boneyardCount: view.boneyardCount || 0,
    players: (view.players || []).map((player) => ({
      id: player.id,
      handCount: player.handCount,
      team: player.team || null
    })),
    hand: (view.hand || []).map(copyTile),
    selected: selected,
    mode: mode,
    summary: plainSummary(view, beliefs, chosen, mode),
    nextTurn: nextTurn,
    strategy: beliefs._plan || null,
    inventory: beliefs._inventory ? {
      byPip: beliefs._inventory.byPip,
      unseenCount: beliefs._inventory.unseenCount,
      boneyardCount: beliefs._inventory.boneyardCount,
      allDealt: beliefs._inventory.allDealt
    } : null,
    confidence: confidence,
    plan: {
      selected: selected,
      continuation: projected ? projected.steps : [],
      alternatives: alternative ? [{
        move: moveRow(view, alternative, "alternative", true),
        continuation: altProjected ? altProjected.steps : [],
        note: "This line is a lower-scored candidate. It is conditional on the current belief model."
      }] : [],
      note: projected && projected.note ? projected.note : null
    },
    partnership: partnershipReport(view, beliefs, chosen, ranked),
    opponents: opponentReport(view, beliefs, chosen),
    components: componentReport(chosen && chosen.parts),
    comparison: overrideText(chosen, alternative, samples),
    alternative: alternative ? moveRow(view, alternative, "alternative", true) : null,
    stage: report && report.forecast ? "forecast" : report && report.samples ? "searched" : "heuristic",
    samples: samples,
    conflicts: report ? report.conflicts : 0,
    conflict: report ? report.conflict : "",
    nodes: report ? report.nodes : 0,
    ms: report ? report.ms : 0,
    status: "ready",
    error: null,
    playerId: view.selfId,
    teamId: ((view.players || []).find((player) => player.id === view.selfId) || {}).team || null,
    boardEnds: { left: view.leftEnd, right: view.rightEnd },
    legalMoves: (view.validMoves || []).map((move) => ({ tileId: move.tileId, side: move.side })),
    selectedMove: selected,
    candidateEvaluations: ranked.map((row) => ({
      tile: copyTile(handTile(view, row.move.tileId)),
      tileId: row.move.tileId,
      side: row.move.side,
      score: round3(row.score),
      parts: row.parts || null,
      wins: row.wins == null ? null : row.wins,
      samplesUsed: row.samplesUsed == null ? null : row.samplesUsed,
      prediction: row.prediction || null
    })),
    plannedContinuation: projected ? projected.steps : [],
    strategicMode: mode,
    reasoning: overrideText(chosen, alternative, samples).text,
    teammateAnalysis: partnershipReport(view, beliefs, chosen, ranked),
    opponentAnalysis: opponentReport(view, beliefs, chosen),
    searchStats: {
      stage: report && report.forecast ? "forecast" : report && report.samples ? "searched" : "heuristic",
      samples: samples,
      conflicts: report ? report.conflicts : 0,
      nodes: report ? report.nodes : 0,
      ms: report ? report.ms : 0,
      interrupted: !!(report && report.interrupted)
    },
    scores: ranked.slice(0, 6).map((row) => ({
      tileId: row.move.tileId,
      side: row.move.side,
      score: round3(row.score)
    })),
    beliefs: Object.keys(beliefs).map((id) => ({
      playerId: id,
      impossible: beliefs[id].knownImpossibleNumbers,
      strong: beliefs[id].suspectedStrongNumbers,
      remaining: beliefs[id].remainingTileCount
    })),
    historyConsistency: Object.keys(beliefs).reduce((result, id) => {
      const conflicts = (beliefs[id].contradictions || []).map((item) => ({
        playerId: id,
        number: item.pip,
        moveIndex: item.index
      }));
      result.contradictions.push.apply(result.contradictions, conflicts);
      result.contradictionCount += conflicts.length;
      result.consistent = result.contradictionCount === 0;
      return result;
    }, { consistent: true, contradictionCount: 0, contradictions: [] }),
    beliefDetail: Object.keys(beliefs).reduce((copy, id) => {
      if (id === view.selfId) return copy;
      copy[id] = publicBelief(beliefs[id]);
      return copy;
    }, {}),
    // Public-history inference only; never expose reconstructed hidden hands.
    playerInferences: (view.players || []).filter((player) => player.id !== view.selfId).map((player) => {
      const belief = beliefs[player.id] || {};
      const intention = publicIntention(belief.intention);
      const byPip = intention && intention.byPip || [];
      const provenVoids = (belief.knownImpossibleNumbers || []).slice();
      const suspectedMissing = byPip.map((info, pip) => ({ info: info, pip: pip }))
        .filter((item) => provenVoids.indexOf(item.pip) < 0 &&
          item.info.missed >= 1 && item.info.pAtLeastOne < 0.4)
        .map((item) => item.pip);
      return {
        playerId: player.id,
        handCount: player.handCount,
        preferredNumber: intention && intention.preferred != null ? intention.preferred : null,
        preferenceConfidence: intention ? intention.confidence : 0,
        lastMoveForced: !!(intention && intention.lastMoveForced),
        provenVoids: provenVoids,
        suspectedMissing: suspectedMissing
      };
    })
  };
}

module.exports = {
  positionKey,
  deriveMode,
  buildDiagnostics,
  unavailableSnapshot,
  clientSnapshot,
  MODE_WIN,
  MODE_MATE,
  MODE_BLOCK,
  MODE_BOARD,
  MODE_BLOCKED,
  MODE_DEFEND,
  MODE_RE
};
