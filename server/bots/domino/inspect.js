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
const { rankMoves, previewEnds, partnerId, canPlayProbability, isOpponent } = require("./eval");

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
      reason: "New evidence or a new board changed the position, and the selected move is being updated."
    };
  }
  if (!parts) {
    return {
      label: null,
      reason: "Evaluation components are unavailable, so a strategic mode was not assigned."
    };
  }
  if (parts.immediateWin > 0) {
    return {
      label: MODE_WIN,
      reason: "The selected tile empties this hand."
    };
  }
  const groups = [
    {
      label: MODE_MATE,
      value: (parts.mateReply || 0) + (parts.mateSuit || 0),
      reason: "Teammate continuation is the largest positive component."
    },
    {
      label: MODE_BLOCK,
      value: Math.max(0, parts.forcePass || 0) + Math.max(0, -(parts.denyNext || 0)) + Math.max(0, -(parts.otherOpp || 0)),
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
      value: ((parts.oppOut || 0) < 0 ? -(parts.oppOut || 0) : 0) + ((parts.blockEquity || 0) < 0 ? -(parts.blockEquity || 0) : 0),
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
      reason: "No evaluation component is large enough to name a strategic mode. The selected move is the highest ranked legal play."
    };
  }
  return { label: best.label, reason: best.reason };
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
    ["pointBonus", "Point bonus"]
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

function partnershipReport(view, beliefs, chosen) {
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
  return {
    available: true,
    playerId: mateId,
    handCount: mate ? mate.handCount : null,
    strong: strong,
    provenVoids: numberNotes(belief, "proven"),
    suspectedWeak: numberNotes(belief, "weak"),
    replyProbability: round3(reply),
    replyCertain: false,
    preserves: kept,
    helpsEmpty: reply != null && mate && mate.handCount > 0 && reply >= 0.5,
    helpNote: reply == null
      ? "A teammate reply estimate is unavailable."
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
    recent: (belief.recent || []).map((event) => Object.assign({}, event))
  };
}

function unavailableSnapshot(view, reason) {
  return {
    available: false,
    reason: reason || "A diagnostic snapshot is unavailable.",
    positionKey: positionKey(view || {}),
    botId: view && view.selfId,
    hand: (view && view.hand ? view.hand : []).map(copyTile),
    selected: null,
    mode: { label: null, reason: reason || "No decision was recorded." },
    plan: { selected: null, continuation: [], alternatives: [], note: reason || "No plan was recorded." },
    scores: [],
    stage: "unavailable",
    samples: 0,
    conflicts: 0,
    conflict: "",
    nodes: 0,
    ms: 0,
    beliefs: []
  };
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
    partnership: partnershipReport(view, beliefs, chosen),
    opponents: opponentReport(view, beliefs, chosen),
    components: componentReport(chosen && chosen.parts),
    comparison: overrideText(chosen, alternative, samples),
    alternative: alternative ? moveRow(view, alternative, "alternative", true) : null,
    stage: report && report.samples ? "searched" : "heuristic",
    samples: samples,
    conflicts: report ? report.conflicts : 0,
    conflict: report ? report.conflict : "",
    nodes: report ? report.nodes : 0,
    ms: report ? report.ms : 0,
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
    beliefDetail: Object.keys(beliefs).reduce((copy, id) => {
      if (id === view.selfId) return copy;
      copy[id] = publicBelief(beliefs[id]);
      return copy;
    }, {})
  };
}

module.exports = {
  positionKey,
  deriveMode,
  buildDiagnostics,
  unavailableSnapshot,
  MODE_WIN,
  MODE_MATE,
  MODE_BLOCK,
  MODE_BOARD,
  MODE_BLOCKED,
  MODE_DEFEND,
  MODE_RE
};
