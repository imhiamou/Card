/*
 * Dominoes bot — Normal difficulty (server-side only).
 *
 * The bot only DECIDES a move here; the decision is returned as an
 * intended action and executed through the same "dominoPlayTile" /
 * "dominoDraw" Socket.IO handlers (and validation) that humans use.
 *
 * Heuristics (Normal):
 *  - Shed high-pip tiles first (reduces this seat's — and in 4-player
 *    team mode the team's — remaining points if the table blocks).
 *  - Play doubles early: they are the least flexible tiles in hand.
 *  - Prefer moves that keep more follow-up options: after placing,
 *    count how many remaining tiles could still connect to the board.
 *  - Drawing/passing is not decided here: the caller only asks for a
 *    move when at least one legal move exists.
 */

/**
 * The pip value that would be exposed at the played end after placing
 * `tile` on `side`. For the opening tile both pips become open ends.
 */
function exposedPip(tile, side, leftEnd, rightEnd, chainLength) {
  if (chainLength === 0 || side === "center") return tile.b;
  const end = side === "left" ? leftEnd : rightEnd;
  if (tile.a === end && tile.b === end) return end;
  return tile.a === end ? tile.b : tile.a;
}

/**
 * Pick the bot's move from the server-validated legal move list.
 *
 * state = {
 *   hand:       [{ id, a, b }, ...]          — the bot's own tiles
 *   validMoves: [{ tileId, side }, ...]      — legal moves (server-built)
 *   leftEnd, rightEnd, chainLength           — public board facts
 *   teamMode:   true in 4-player team games
 * }
 *
 * Returns { tileId, side } (always one of validMoves) or null.
 */
function getDominoMove(state) {
  const hand = state.hand || [];
  const validMoves = state.validMoves || [];
  if (!validMoves.length) return null;

  let best = null;
  validMoves.forEach((move) => {
    const tile = hand.find((t) => t.id === move.tileId);
    if (!tile) return;

    // Base: prefer shedding high-value tiles (protects blocked-game score).
    let score = tile.a + tile.b;

    // Doubles are inflexible — get rid of them while they are playable.
    if (tile.a === tile.b) score += 5;

    // Flexibility: after this placement, how many of our remaining tiles
    // could still connect to either open end? More options = safer turn
    // (and in team mode, less chance of being forced to pass while our
    // partner carries the round).
    const rest = hand.filter((t) => t.id !== tile.id);
    const newEnd = exposedPip(tile, move.side, state.leftEnd, state.rightEnd, state.chainLength);
    const otherEnd = move.side === "left" ? state.rightEnd
      : move.side === "right" ? state.leftEnd
      : tile.a; // opening: both pips open
    const followUps = rest.filter((t) =>
      t.a === newEnd || t.b === newEnd ||
      (otherEnd != null && (t.a === otherEnd || t.b === otherEnd))
    ).length;
    score += followUps * 2;

    if (!best || score > best.score) best = { move, score };
  });

  return best ? { tileId: best.move.tileId, side: best.move.side } : null;
}

module.exports = { getDominoMove };
