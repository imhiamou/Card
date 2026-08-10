/*
 * UNO bot — Normal difficulty (server-side only).
 *
 * The bot only DECIDES here; the decision is executed through the same
 * "unoPlayCard" / "unoDraw" / "unoCall" Socket.IO handlers (and
 * validation) that human players use.
 *
 * Heuristics (Normal):
 *  - Under a penalty stack: continue with +2 (or +4 on a +2/+4 chain).
 *  - Otherwise prefer number cards in the bot's strongest color.
 *  - Skip / Reverse / +2 gain value when the next player is close to
 *    winning (2 cards or fewer).
 *  - Plain Wilds are saved unless little else is playable.
 *  - Wild +4 is used strategically: to pressure a nearly-finished next
 *    player or as a last resort, never as a random first choice.
 *  - Wild color choice: the color the bot holds the most of.
 */

const COLORS = ["red", "blue", "green", "yellow"];

/** The color the bot holds most of (ties break in COLORS order). */
function pickColor(hand) {
  const freq = {};
  (hand || []).forEach((c) => {
    if (c.color) freq[c.color] = (freq[c.color] || 0) + 1;
  });
  let best = null;
  COLORS.forEach((color) => {
    const n = freq[color] || 0;
    if (!best || n > best.n) best = { color, n };
  });
  return best ? best.color : "red";
}

/**
 * Pick the bot's play from the server-validated playable list.
 *
 * state = {
 *   hand:           [{ id, color, kind, value }, ...]  — bot's own cards
 *   playableIds:    [id, ...]                          — legal plays (server-built)
 *   pendingPenalty: number                             — active +2/+4 stack total
 *   pendingKind:    "draw2" | "wild4" | null
 *   nextPlayerHandCount: number                        — public card count
 * }
 *
 * Returns { cardId, color? } (cardId always from playableIds) or null
 * (meaning: draw).
 */
function getUnoMove(state) {
  const hand = state.hand || [];
  const playable = state.playableIds || [];
  if (!playable.length) return null;

  const nextCount = typeof state.nextPlayerHandCount === "number"
    ? state.nextPlayerHandCount
    : 7;
  const colorFreq = {};
  hand.forEach((c) => {
    if (c.color) colorFreq[c.color] = (colorFreq[c.color] || 0) + 1;
  });

  let best = null;
  playable.forEach((id) => {
    const card = hand.find((c) => c.id === id);
    if (!card) return;
    let score = 0;

    if (state.pendingPenalty > 0) {
      // Keep the stack going; prefer +2 over burning a +4.
      score = card.kind === "draw2" ? 100 : 90;
    } else if (card.kind === "number") {
      score = 40 + card.value + (colorFreq[card.color] || 0) * 3;
    } else if (card.kind === "skip" || card.kind === "reverse") {
      score = 30 + (colorFreq[card.color] || 0) * 3 + (nextCount <= 2 ? 25 : 0);
    } else if (card.kind === "draw2") {
      score = 35 + (colorFreq[card.color] || 0) * 3 + (nextCount <= 2 ? 30 : 0);
    } else if (card.kind === "wild") {
      score = 15; // save wilds while other plays exist
    } else if (card.kind === "wild4") {
      score = 10 + (nextCount <= 2 ? 45 : 0); // strategic, not random
    }

    if (!best || score > best.score) best = { card, score };
  });
  if (!best) return null;

  const move = { cardId: best.card.id };
  if (best.card.kind === "wild" || best.card.kind === "wild4") {
    move.color = pickColor(hand.filter((c) => c.id !== best.card.id));
  }
  return move;
}

module.exports = { getUnoMove, pickColor, COLORS };
