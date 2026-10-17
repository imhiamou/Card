"use strict";

const { buildBeliefs } = require("./beliefs");
const { hashString, mulberry32 } = require("./sample");
const { rankMoves } = require("./eval");
const { searchMoves } = require("./search");
const { mergeWeights, mergeLimits } = require("./weights");
const { buildDiagnostics } = require("./inspect");
const { resolvePlan } = require("./plan");

/*
 * Callers that only know how long the chain is (the older bot tests) never
 * pass the tiles. placeTile treats an empty chain as an opening even when
 * the ends are already set, so a mid-game decision has to carry that many
 * placeholders. Their ids are outside the double-six set.
 */
function boardChain(state) {
  const given = state && Array.isArray(state.chain)
    ? state.chain.map((tile) => ({ id: tile.id, a: tile.a, b: tile.b }))
    : [];
  if (given.length) return given;
  const n = state && state.chainLength != null ? state.chainLength : 0;
  const chain = [];
  const left = state && state.leftEnd != null ? state.leftEnd : 0;
  const right = state && state.rightEnd != null ? state.rightEnd : 0;
  for (let i = 0; i < n; i++) {
    chain.push({ id: "board-" + i, a: left, b: right });
  }
  return chain;
}

function normalize(state) {
  const hand = (state && state.hand ? state.hand : []).map((tile) => ({
    id: tile.id,
    a: tile.a,
    b: tile.b
  }));
  const selfId = state && state.selfId ? state.selfId : "self";
  let players = state && Array.isArray(state.players) ? state.players.map((player) => ({
    id: player.id,
    handCount: player.handCount,
    team: player.team || null
  })) : null;
  if (!players || !players.length) {
    players = [{ id: selfId, handCount: hand.length, team: null }];
  }
  return {
    selfId: selfId,
    gameId: state && (state.gameId || state.roomId || state.roomCode) || null,
    roundNumber: state && state.roundNumber != null ? state.roundNumber : (state && state.roundId != null ? state.roundId : null),
    hand: hand,
    validMoves: (state && state.validMoves ? state.validMoves : []).map((move) => ({
      tileId: move.tileId,
      side: move.side
    })),
    leftEnd: state ? state.leftEnd : null,
    rightEnd: state ? state.rightEnd : null,
    chain: boardChain(state),
    players: players,
    teamMode: !!(state && state.teamMode),
    teamA: state && state.teamA ? state.teamA.slice() : null,
    teamB: state && state.teamB ? state.teamB.slice() : null,
    log: state && state.log ? state.log : [],
    boneyardCount: state && state.boneyardCount ? state.boneyardCount : 0,
    mustPlayId: state && state.mustPlayId ? state.mustPlayId : null
  };
}

function seedFor(view, options) {
  if (options && options.seed != null) return options.seed >>> 0;
  const key = [
    view.selfId,
    view.leftEnd,
    view.rightEnd,
    view.hand.map((tile) => tile.id).join(","),
    (view.log || []).length,
    (view.chain || []).length
  ].join("|");
  return hashString(key);
}

function chooseRanked(ranked, rng, vary, epsilon) {
  if (!ranked.length) return null;
  if (!vary) return ranked[0].move;
  const best = ranked[0].score;
  const close = ranked.filter((row) => best - row.score <= epsilon);
  const pick = close[Math.floor(rng() * close.length)] || ranked[0];
  return pick.move;
}

/**
 * Public-information decision. `state.hand` is the bot's hand. Other
 * hands, including a teammate bot's memory, are ignored if present.
 */
function getDominoMove(state, options) {
  const view = normalize(state || {});
  if (view.mustPlayId && view.chain.length === 0) {
    const forced = view.validMoves.filter((move) => move.tileId === view.mustPlayId);
    if (forced.length) view.validMoves = forced;
  }
  const weights = mergeWeights(options && options.weights);
  const limits = mergeLimits(options && options.limits);
  const beliefs = buildBeliefs(view, options);
  // Resolve/refresh the round plan even on a pass. A forced pass is a game
  // event, not a reason to forget the objective; its public cause becomes
  // evidence for the next decision.
  beliefs._plan = resolvePlan(view, beliefs, options);
  if (!view.validMoves.length) {
    if (!(options && options.explain)) return null;
    const plan = beliefs._plan || {};
    const { unavailableSnapshot } = require("./inspect");
    const diagnostics = unavailableSnapshot(view, "No legal tile matches either open end.");
    diagnostics.available = true;
    diagnostics.status = "ready";
    diagnostics.error = null;
    diagnostics.reason = "I must pass because no tile in my hand matches either open end. I keep my round objective and use this pass as evidence about the board and hidden hands.";
    diagnostics.reasoning = diagnostics.reason;
    diagnostics.passAnalysis = {
      forced: true,
      reason: "No legal tile matches the current left or right end.",
      leftEnd: view.leftEnd,
      rightEnd: view.rightEnd,
      handCount: view.hand.length,
      objective: { mode: plan.mode || "none", target: plan.target == null ? null : plan.target,
        owner: plan.owner || null, confidence: plan.confidence || 0, evidence: plan.evidence || null },
      futureAdjustment: "After the pass, update number-absence beliefs from the public pass record; retain the strategy unless public evidence invalidates its target."
    };
    diagnostics.strategicMode = { label: plan.mode || "No committed objective", reason: plan.evidence || diagnostics.reason };
    diagnostics.mode = diagnostics.strategicMode;
    diagnostics.plan = { selected: null, continuation: [], alternatives: [], note: diagnostics.reason,
      committed: diagnostics.passAnalysis.objective };
    diagnostics.selected = null;
    diagnostics.selectedMove = null;
    diagnostics.legalMoves = [];
    return { pass: true, diagnostics: diagnostics };
  }
  let ranked = rankMoves(view, beliefs, weights, options);
  if (!ranked.length) {
    return { tileId: view.validMoves[0].tileId, side: view.validMoves[0].side };
  }
  const rng = mulberry32(seedFor(view, options));
  let report = null;
  const alreadyWinning = ranked[0].score >= weights.roundWin;
  if (!alreadyWinning && limits.samples > 0 && view.players.length > 1) {
    report = searchMoves(view, beliefs, ranked, weights, options, rng, limits);
    ranked = report.ranked;
  }
  const vary = !!(options && options.vary);
  const chosen = chooseRanked(ranked, rng, vary, limits.varyEpsilon);
  if (options && options.explain) {
    return {
      tileId: chosen.tileId,
      side: chosen.side,
      diagnostics: buildDiagnostics({
        view: view,
        beliefs: beliefs,
        ranked: ranked,
        chosen: chosen,
        report: report,
        weights: weights,
        options: options
      })
    };
  }
  return { tileId: chosen.tileId, side: chosen.side };
}

module.exports = {
  getDominoMove,
  normalize,
  seedFor
};
