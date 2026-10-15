"use strict";

const { api, cloneTile, pips, touches, matchesEither, violates } = require("./engine");
const { hardVoid, suitAffinity } = require("./beliefs");
const { unseenTiles } = require("./sample");

function seatIndex(view, playerId) {
  const players = view.players || [];
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === playerId) return i;
  }
  return -1;
}

function playerByOffset(view, offset) {
  const players = view.players || [];
  if (!players.length) return null;
  const self = seatIndex(view, view.selfId);
  if (self < 0) return null;
  return players[(self + offset) % players.length];
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

function isMate(view, playerId) {
  return !!playerId && playerId === partnerId(view);
}

function isOpponent(view, playerId) {
  if (!playerId || playerId === view.selfId) return false;
  if (!view.teamMode) return true;
  return !isMate(view, playerId);
}

function previewEnds(view, move) {
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
  return {
    tile: tile,
    leftEnd: state.leftEnd,
    rightEnd: state.rightEnd
  };
}

function probabilityAtLeastOne(pool, matches, handCount) {
  if (handCount <= 0 || matches <= 0 || pool <= 0) return 0;
  if (pool < handCount) return matches > 0 ? matches / pool : 0;
  if (pool - matches < handCount) return 1;
  let none = 1;
  for (let i = 0; i < handCount; i++) {
    none *= (pool - matches - i) / (pool - i);
  }
  return 1 - none;
}

function canPlayProbability(view, beliefs, player, left, right) {
  if (!player || player.handCount <= 0) return 0;
  const unseen = unseenTiles(view);
  const voids = hardVoid(beliefs, player.id);
  let pool = unseen.filter((tile) => !violates(tile, voids));
  if (pool.length < player.handCount) pool = unseen;
  const matches = pool.filter((tile) => matchesEither(tile, left, right)).length;
  return probabilityAtLeastOne(pool.length, matches, player.handCount);
}

function expectedPips(view, beliefs, player) {
  if (!player || player.handCount <= 0) return 0;
  const unseen = unseenTiles(view);
  const voids = hardVoid(beliefs, player.id);
  let pool = unseen.filter((tile) => !violates(tile, voids));
  if (!pool.length) pool = unseen;
  if (!pool.length) return 0;
  const average = pool.reduce((sum, tile) => sum + pips(tile), 0) / pool.length;
  return average * player.handCount;
}

function blockEdge(view, beliefs, tile) {
  const own = (view.hand || []).reduce((sum, item) => sum + pips(item), 0) - pips(tile);
  let mate = 0;
  let opp = 0;
  let oppCount = 0;
  (view.players || []).forEach((player) => {
    if (player.id === view.selfId) return;
    const estimate = expectedPips(view, beliefs, player);
    if (isMate(view, player.id)) mate += estimate;
    else {
      opp += estimate;
      oppCount += 1;
    }
  });
  if (!view.teamMode) {
    const average = oppCount ? opp / oppCount : 0;
    return (average - own) / 30;
  }
  return (opp - (own + mate)) / 30;
}

function blankParts() {
  return {
    immediateWin: 0,
    pointBonus: 0,
    oppOut: 0,
    denyNext: 0,
    forcePass: 0,
    mateReply: 0,
    mateSuit: 0,
    otherOpp: 0,
    ownOuts: 0,
    stuckDouble: 0,
    shedPips: 0,
    dumpDouble: 0,
    blockEquity: 0
  };
}

function scoreMoveParts(view, beliefs, move, weights, options) {
  const preview = previewEnds(view, move);
  if (!preview) return { score: -Infinity, parts: null };
  const parts = blankParts();
function scoreMove(view, beliefs, move, weights, options) {
  const preview = previewEnds(view, move);
  if (!preview) return -Infinity;
  const rest = (view.hand || []).filter((tile) => tile.id !== preview.tile.id);
  const ignoreTeam = !!(options && options.ignoreTeam);
  if (rest.length === 0) {
    let award = 0;
    (view.players || []).forEach((player) => {
      if (player.id === view.selfId) return;
      if (view.teamMode && isMate(view, player.id)) return;
      award += expectedPips(view, beliefs, player);
    });
    parts.immediateWin = weights.roundWin;
    parts.pointBonus = weights.pointScale * award;
    return { score: parts.immediateWin + parts.pointBonus, parts: parts };
    return weights.roundWin + weights.pointScale * award;
  }

  const left = preview.leftEnd;
  const right = preview.rightEnd;
  const next = playerByOffset(view, 1);
  const mate = ignoreTeam ? null : (view.players || []).find((player) => player.id === partnerId(view));
  const other = playerByOffset(view, view.teamMode ? 3 : 2);
  const edge = blockEdge(view, beliefs, preview.tile);
  let score = 0;

  const pNext = next && next.id !== view.selfId ? canPlayProbability(view, beliefs, next, left, right) : 0;
  if (next && next.handCount === 1 && isOpponent(view, next.id)) {
    parts.oppOut = -(weights.roundWin * weights.oppOutScale * pNext);
    score += parts.oppOut;
  } else if (next && isOpponent(view, next.id)) {
    parts.denyNext = -(weights.denyNext * pNext);
    score += parts.denyNext;
    score -= weights.roundWin * weights.oppOutScale * pNext;
  } else if (next && isOpponent(view, next.id)) {
    score -= weights.denyNext * pNext;
    if (pNext === 0 && next.handCount > 0) {
      // A forced pass is worth taking when the team is not heavier. A large
      // pip deficit makes the same pass a way of handing the blocked round over.
      const passWeight = edge >= 0 ? 1 : Math.max(-1, edge * 1.5);
      parts.forcePass = weights.forcePass * passWeight;
      score += parts.forcePass;
      score += weights.forcePass * passWeight;
    }
  }

  if (mate) {
    const pMate = canPlayProbability(view, beliefs, mate, left, right);
    const mateNext = next && mate.id === next.id;
    const replyWeight = mateNext || pNext === 0 ? 1 : 0.45;
    parts.mateReply = weights.mateCanReply * pMate * replyWeight;
    parts.mateSuit = weights.mateSuit * suitAffinity(beliefs, mate.id, left, right) * replyWeight;
    score += parts.mateReply;
    score += parts.mateSuit;
  }

  if (other && isOpponent(view, other.id) && other !== next) {
    parts.otherOpp = -(weights.otherOpp * canPlayProbability(view, beliefs, other, left, right));
    score += parts.otherOpp;
  }

  const outs = rest.filter((tile) => matchesEither(tile, left, right)).length;
  parts.ownOuts = weights.ownOuts * outs;
  score += parts.ownOuts;
    score += weights.mateCanReply * pMate * replyWeight;
    score += weights.mateSuit * suitAffinity(beliefs, mate.id, left, right) * replyWeight;
  }

  if (other && isOpponent(view, other.id) && other !== next) {
    score -= weights.otherOpp * canPlayProbability(view, beliefs, other, left, right);
  }

  const outs = rest.filter((tile) => matchesEither(tile, left, right)).length;
  score += weights.ownOuts * outs;

  let unlocked = 0;
  let stuck = 0;
  rest.forEach((tile) => {
    if (tile.a !== tile.b) return;
    if (tile.a === left || tile.a === right) unlocked += 1;
    else stuck += 1;
  });
  parts.stuckDouble = weights.stuckDoubleRelief * unlocked - weights.stuckDoubleRelief * 0.6 * stuck;
  score += parts.stuckDouble;

  parts.shedPips = weights.shedPips * (pips(preview.tile) / 12);
  score += parts.shedPips;
  if (preview.tile.a === preview.tile.b) {
    parts.dumpDouble = weights.dumpDouble * (preview.tile.a / 6);
    score += parts.dumpDouble;
  }
  parts.blockEquity = weights.blockEquity * edge;
  score += parts.blockEquity;
  return { score: score, parts: parts };
}

function scoreMove(view, beliefs, move, weights, options) {
  return scoreMoveParts(view, beliefs, move, weights, options).score;
  score += weights.stuckDoubleRelief * unlocked;
  score -= weights.stuckDoubleRelief * 0.6 * stuck;

  score += weights.shedPips * (pips(preview.tile) / 12);
  if (preview.tile.a === preview.tile.b) score += weights.dumpDouble * (preview.tile.a / 6);
  score += weights.blockEquity * edge;
  return score;
}

function rankMoves(view, beliefs, weights, options) {
  const ranked = [];
  (view.validMoves || []).forEach((move, index) => {
    const detail = scoreMoveParts(view, beliefs, move, weights, options);
    ranked.push({
      move: { tileId: move.tileId, side: move.side },
      index: index,
      score: detail.score,
      parts: detail.parts
    ranked.push({
      move: { tileId: move.tileId, side: move.side },
      index: index,
      score: scoreMove(view, beliefs, move, weights, options)
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked;
}

module.exports = {
  partnerId,
  isMate,
  isOpponent,
  previewEnds,
  canPlayProbability,
  scoreMove,
  scoreMoveParts,
  rankMoves,
  touches
};
