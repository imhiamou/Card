"use strict";

/*
 * Dominoes bot. The live decision is the partnership AI in ./domino.
 * legacyGetDominoMove keeps the previous pip-shedding policy so benchmarks
 * can compare against it. Both return an intended play; server/domino.js
 * still validates it through the same handlers humans use.
 *
 * The AI sees its own hand, the public chain, hand counts, and the public
 * action log. It does not read hidden hands or another bot's memory.
 */

const ai = require("./domino/ai");

function exposedPip(tile, side, leftEnd, rightEnd, chainLength) {
  if (chainLength === 0 || side === "center") return tile.b;
  const end = side === "left" ? leftEnd : rightEnd;
  if (tile.a === end && tile.b === end) return end;
  return tile.a === end ? tile.b : tile.a;
}

function legacyGetDominoMove(state) {
  const hand = state.hand || [];
  const validMoves = state.validMoves || [];
  if (!validMoves.length) return null;

  let best = null;
  validMoves.forEach((move) => {
    const tile = hand.find((item) => item.id === move.tileId);
    if (!tile) return;
    let score = tile.a + tile.b;
    if (tile.a === tile.b) score += 5;
    const rest = hand.filter((item) => item.id !== tile.id);
    const newEnd = exposedPip(tile, move.side, state.leftEnd, state.rightEnd, state.chainLength);
    const otherEnd = move.side === "left" ? state.rightEnd
      : move.side === "right" ? state.leftEnd
      : tile.a;
    const followUps = rest.filter((item) =>
      item.a === newEnd || item.b === newEnd ||
      (otherEnd != null && (item.a === otherEnd || item.b === otherEnd))
    ).length;
    score += followUps * 2;
    if (!best || score > best.score) best = { move, score };
  });

  return best ? { tileId: best.move.tileId, side: best.move.side } : null;
}

function getDominoMove(state, options) {
  return ai.getDominoMove(state, options);
}

module.exports = {
  getDominoMove,
  legacyGetDominoMove
};
