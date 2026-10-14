/*
 * UNO bot — research-informed deterministic evaluator.
 *
 * Gameweb wins by emptying the hand. Printed face value is not a goal.
 * Two-player Reverse is a Skip. Draw Two stacks on Draw Two; Wild Draw
 * Four stacks on either; Draw Two does not stack on Wild Draw Four.
 * A drawn card that can be played is the only card legal that turn.
 *
 * moveScore = tacticalDenial + handFlexibility + colorControl
 *   + futureOptions + rankTie - wildOpportunityCost - strategicRisk
 *
 * Color control counts cards of the color this play leaves active.
 * A cross-color rank or action match is a weaker future option, not
 * another card of that color. Rank tie-break separates number cards
 * that leave similar hands. Gameweb does not score printed points;
 * the rank term is only that measured tie-break.
 *
 * Tie-break: higher score wins. Equal scores keep the earlier playable
 * id. Equal Wild colors keep COLORS order: red, blue, green, yellow.
 *
 * Ordinary number and action choices are then checked against a
 * color-and-rank prior taken from the previous bot, because that prior
 * won the seeded rollouts on cards that hit the same opponent. The
 * evaluator's own choice stands when it denies a shorter hand, avoids
 * enabling a short hand, or spends a Wild to leave a dead color.
 *
 * The evaluator never reads another player's cards or the draw pile.
 * Unseen cards are the 108-card deck minus this hand and the cards
 * still in the discard pile. Recycled discards are not in that pile,
 * so they return to the unseen pool. Opponent hands are a random
 * subset of that pool (hypergeometric). Absence-of-play history is not
 * tracked: a voluntary draw does not prove a missing color.
 */

const COLORS = ["red", "blue", "green", "yellow"];

/**
 * Named weights. Tuned on the seeded simulation in unoStrategy.bench.js
 * (seeds 1..N) and checked on a disjoint validation seed range.
 */
const WEIGHTS = {
  threat1: 16,
  threat2: 9,
  threat3: 2.4,
  threatRest: 0.2,
  deny: 1,
  enable: 1,
  selfTempo: 2.15,
  tempoFollow: 1.1,
  penaltyCard: 0.45,
  stackMatch: 2.2,
  blowback: 1.15,
  passAlong: 0.35,
  follow: 3,
  wildFollow: 1.25,
  symbolFollow: 0.5,
  spread: 1,
  bridge: 0.42,
  bridgeCap: 4,
  wildCost: 8.2,
  wild4Cost: 7.6,
  skipCost: 2.4,
  reverseCost: 2.3,
  draw2Cost: 2.6,
  rankTie: 1,
  attackScale: 0.42,
  attackHandMax: 1,
  lateBoost: 0.4,
  lateHand: 3,
  acceptPerCard: 2.35,
  passHold: 5.5
};

function threatOf(count) {
  if (count <= 1) return WEIGHTS.threat1;
  if (count === 2) return WEIGHTS.threat2;
  if (count === 3) return WEIGHTS.threat3;
  return WEIGHTS.threatRest;
}

function isWildKind(card) {
  return !!card && (card.kind === "wild" || card.kind === "wild4");
}

function coloredCount(hand, color) {
  let n = 0;
  (hand || []).forEach((card) => {
    if (!isWildKind(card) && card.color === color) n += 1;
  });
  return n;
}

function moveIndex(index, direction, steps, count) {
  let idx = index;
  const n = count || 1;
  for (let i = 0; i < steps; i++) idx = (idx + direction + n * 8) % n;
  return idx;
}

function land(index, direction, seats) {
  const n = seats.length;
  if (!seats[index] || !seats[index].away) return index;
  for (let i = 0; i < n; i++) {
    index = moveIndex(index, direction, 1, n);
    if (!seats[index].away) return index;
  }
  return index;
}

function normalize(state) {
  const hand = (state && state.hand) || [];
  const playableIds = (state && state.playableIds) || [];
  let seats = state && Array.isArray(state.seats) ? state.seats : null;
  if (!seats || !seats.length) {
    const next = state && typeof state.nextPlayerHandCount === "number"
      ? state.nextPlayerHandCount
      : 7;
    seats = [
      { handCount: hand.length, away: false },
      { handCount: next, away: false }
    ];
  } else {
    seats = seats.map((seat) => ({
      handCount: typeof seat.handCount === "number" ? seat.handCount : 7,
      away: !!seat.away
    }));
  }
  const turnIndex = state && Number.isInteger(state.turnIndex) ? state.turnIndex : 0;
  const direction = state && state.direction === -1 ? -1 : 1;
  const discard = (state && state.discard) || [];
  return {
    hand,
    playableIds,
    seats,
    turnIndex: ((turnIndex % seats.length) + seats.length) % seats.length,
    direction,
    discard,
    misses: Array.isArray(state && state.misses) ? state.misses : [],
    pendingPenalty: state && state.pendingPenalty > 0 ? state.pendingPenalty : 0,
    pendingKind: state && state.pendingKind ? state.pendingKind : null,
    awaitingDrawnPlay: !!(state && state.awaitingDrawnPlay)
  };
}

function emptyPool() {
  const colors = {};
  COLORS.forEach((color) => {
    const number = {};
    for (let value = 0; value <= 9; value++) number[value] = value === 0 ? 1 : 2;
    colors[color] = { number, skip: 2, reverse: 2, draw2: 2 };
  });
  return { colors, wild: 4, wild4: 4 };
}

function takeFromPool(pool, card) {
  if (!card) return;
  if (card.kind === "wild") {
    pool.wild = Math.max(0, pool.wild - 1);
    return;
  }
  if (card.kind === "wild4") {
    pool.wild4 = Math.max(0, pool.wild4 - 1);
    return;
  }
  const bucket = pool.colors[card.color];
  if (!bucket) return;
  if (card.kind === "number") {
    const value = card.value;
    if (bucket.number[value] > 0) bucket.number[value] -= 1;
    return;
  }
  if (bucket[card.kind] > 0) bucket[card.kind] -= 1;
}

function summarize(pool) {
  let total = pool.wild + pool.wild4;
  let draw2 = 0;
  const byColor = {};
  COLORS.forEach((color) => {
    const bucket = pool.colors[color];
    let n = bucket.skip + bucket.reverse + bucket.draw2;
    draw2 += bucket.draw2;
    for (let value = 0; value <= 9; value++) n += bucket.number[value];
    byColor[color] = n;
    total += n;
  });
  return { total, byColor, wild: pool.wild, wild4: pool.wild4, draw2, pool };
}

/** Deck minus this hand and the cards still sitting in the discard. */
function unseenProfile(view) {
  const pool = emptyPool();
  view.hand.forEach((card) => takeFromPool(pool, card));
  view.discard.forEach((card) => takeFromPool(pool, card));
  return summarize(pool);
}

function logChoose(n, k) {
  if (k < 0 || n < 0 || k > n) return Number.NEGATIVE_INFINITY;
  if (k === 0 || k === n) return 0;
  const take = Math.min(k, n - k);
  let sum = 0;
  for (let i = 1; i <= take; i++) sum += Math.log(n - take + i) - Math.log(i);
  return sum;
}

/** P(at least one of `bad` cards in a `draw`-card sample from `pop`). */
function probAtLeast(pop, bad, draw) {
  if (draw <= 0 || bad <= 0) return 0;
  if (pop <= 0) return 0.35;
  const sample = Math.min(draw, pop);
  if (pop - bad < sample) return 1;
  const pZero = Math.exp(logChoose(pop - bad, sample) - logChoose(pop, sample));
  if (!isFinite(pZero)) return 0.35;
  return 1 - pZero;
}

function answersFor(summary, color, kind, value) {
  let bad = (summary.byColor[color] || 0) + summary.wild + summary.wild4;
  if (kind === "number") {
    COLORS.forEach((other) => {
      if (other === color) return;
      bad += summary.pool.colors[other].number[value] || 0;
    });
  } else if (kind === "skip" || kind === "reverse" || kind === "draw2") {
    COLORS.forEach((other) => {
      if (other === color) return;
      bad += summary.pool.colors[other][kind] || 0;
    });
  }
  return bad;
}

function playsOn(card, color, kind, value) {
  if (!card) return false;
  if (isWildKind(card)) return true;
  if (card.color && card.color === color) return true;
  if (card.kind === "number" && kind === "number" && card.value === value) return true;
  if (card.kind !== "number" && card.kind === kind) return true;
  return false;
}

function followCount(cards, color, kind, value) {
  let n = 0;
  cards.forEach((card) => {
    if (playsOn(card, color, kind, value)) n += 1;
  });
  return n;
}

/**
 * Same-color cards support the color this play commits to. Wilds are
 * fallback. A matching number or action in another color is only a
 * later switch, so it must not be scored as color depth.
 */
function matchParts(cards, color, kind, value) {
  let colorHits = 0;
  let wildHits = 0;
  let symbolHits = 0;
  cards.forEach((card) => {
    if (isWildKind(card)) {
      wildHits += 1;
      return;
    }
    if (card.color && card.color === color) {
      colorHits += 1;
      return;
    }
    const symbol = (card.kind === "number" && kind === "number" && card.value === value) ||
      (card.kind !== "number" && kind !== "number" && card.kind === kind);
    if (symbol) symbolHits += 1;
  });
  return { colorHits, wildHits, symbolHits };
}

function spreadScore(cards) {
  const present = {};
  cards.forEach((card) => {
    if (!isWildKind(card) && card.color) present[card.color] = true;
  });
  const n = Object.keys(present).length;
  if (n <= 1) return 0.35;
  if (n === 2) return 1.15;
  if (n === 3) return 0.75;
  return 0.4;
}

function bridgeScore(cards) {
  let bridges = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if (isWildKind(a) || isWildKind(b)) continue;
      if (a.color && b.color && a.color !== b.color) {
        if (a.kind === "number" && b.kind === "number" && a.value === b.value) bridges += 1;
        else if (a.kind !== "number" && a.kind === b.kind) bridges += 1;
      }
    }
  }
  return Math.min(bridges, WEIGHTS.bridgeCap) * WEIGHTS.bridge;
}

function without(hand, card) {
  return hand.filter((other) => other !== card && other.id !== card.id);
}

/**
 * Who actually loses the turn, and who acts next, under Gameweb's
 * direction, skip, and two-player reverse rules.
 */
function effectOf(view, card) {
  const n = view.seats.length;
  const me = view.turnIndex;
  const dir = view.direction;
  const natural = land(moveIndex(me, dir, 1, n), dir, view.seats);
  let kind = "normal";
  let direction = dir;
  let actor = natural;
  let victim = null;

  if (view.pendingPenalty > 0) {
    kind = "stack";
    victim = natural;
    actor = natural;
  } else if (card.kind === "skip" || (card.kind === "reverse" && n === 2)) {
    kind = "skip";
    victim = natural;
    actor = land(moveIndex(me, dir, 2, n), dir, view.seats);
  } else if (card.kind === "reverse") {
    kind = "reverse";
    direction = -dir;
    victim = natural;
    actor = land(moveIndex(me, direction, 1, n), direction, view.seats);
  } else if (card.kind === "draw2" || card.kind === "wild4") {
    kind = "penalty";
    victim = natural;
    actor = natural;
  }

  const activeColor = isWildKind(card) ? null : (card.color || null);
  return { kind, direction, actor, victim, natural, activeColor };
}

function activeTop(card, color) {
  const chosen = isWildKind(card) ? color : card.color;
  return { color: chosen, kind: card.kind, value: card.value };
}

function counterChance(summary, view, card, victimCount) {
  let bad = 0;
  if (view.pendingPenalty > 0) {
    const resulting = card.kind === "wild4" ? "wild4" : view.pendingKind;
    bad = resulting === "wild4" ? summary.wild4 : summary.draw2 + summary.wild4;
  } else if (card.kind === "wild4") {
    bad = summary.wild4;
  } else if (card.kind === "draw2") {
    bad = summary.draw2 + summary.wild4;
  } else {
    return 0;
  }
  return probAtLeast(summary.total, bad, victimCount);
}

function penaltySize(view, card) {
  if (view.pendingPenalty > 0) {
    return view.pendingPenalty + (card.kind === "wild4" ? 4 : 2);
  }
  if (card.kind === "wild4") return 4;
  if (card.kind === "draw2") return 2;
  return 0;
}

function lateMultiplier(view, remaining) {
  const close = view.seats.some((seat, index) =>
    index !== view.turnIndex && !seat.away && seat.handCount <= 2
  );
  if (close || remaining <= WEIGHTS.lateHand) return 1 + WEIGHTS.lateBoost;
  return 1;
}

function actorAfterFailure(view, victim, direction) {
  const n = view.seats.length;
  return land(moveIndex(victim, direction, 1, n), direction, view.seats);
}

function tacticalDenial(view, card, effect, summary, remaining) {
  const late = lateMultiplier(view, remaining.length);
  const me = view.turnIndex;
  let score = 0;

  if (effect.kind === "skip" || effect.kind === "reverse") {
    const victimCount = effect.victim === me ? 99 : view.seats[effect.victim].handCount;
    if (effect.victim !== me) score += threatOf(victimCount) * WEIGHTS.deny;
    if (effect.actor === me) {
      // An extra turn is worth spending the card when that opponent is
      // already short. Against a full hand the same follow is cheaper
      // as an ordinary play, which keeps the Skip or Reverse.
      if (victimCount <= 2) {
        const top = activeTop(card, effect.activeColor);
        const follow = followCount(remaining, top.color, top.kind, top.value);
        score += WEIGHTS.selfTempo + follow * WEIGHTS.tempoFollow;
      }
    } else {
      score -= threatOf(view.seats[effect.actor].handCount) * WEIGHTS.enable;
    }
    return score * late;
  }

  if (effect.kind === "penalty" || effect.kind === "stack") {
    const victimCount = view.seats[effect.victim].handCount;
    const fail = 1 - counterChance(summary, view, card, victimCount);
    const hit = threatOf(victimCount) * WEIGHTS.deny * fail;
    const cards = penaltySize(view, card);
    score += hit;
    score += cards * WEIGHTS.penaltyCard * fail * (0.35 + threatOf(victimCount) / WEIGHTS.threat1);
    // A Draw Two already answers a Draw Two. Escalating to Wild Draw Four
    // spends the harder-to-answer card for a penalty the cheaper card covers.
    if (view.pendingKind === "draw2" && card.kind === "draw2") score += WEIGHTS.stackMatch;
    const nextDir = effect.kind === "reverse" ? effect.direction : view.direction;
    const after = actorAfterFailure(view, effect.victim, nextDir);
    if (after === me) {
      if (victimCount <= 2) score += WEIGHTS.selfTempo * fail;
    } else {
      score -= threatOf(view.seats[after].handCount) * WEIGHTS.enable * fail;
    }
    const countered = 1 - fail;
    if (countered > 0) {
      const add = card.kind === "wild4" || view.pendingKind === "wild4" ? 4 : 2;
      const returned = cards + add;
      const canChain = remaining.some((other) => {
        if (other.kind === "wild4") return true;
        return other.kind === "draw2" && add === 2 && view.pendingKind !== "wild4" && card.kind !== "wild4";
      });
      const scale = view.seats.length === 2 ? WEIGHTS.blowback : WEIGHTS.passAlong;
      score -= countered * returned * (canChain ? WEIGHTS.passAlong : scale);
    }
    return score * late;
  }

  return 0;
}

function opportunityCost(card) {
  if (card.kind === "wild") return WEIGHTS.wildCost;
  if (card.kind === "wild4") return WEIGHTS.wild4Cost;
  if (card.kind === "skip") return WEIGHTS.skipCost;
  if (card.kind === "reverse") return WEIGHTS.reverseCost;
  if (card.kind === "draw2") return WEIGHTS.draw2Cost;
  return 0;
}

/**
 * Public-information penalty for handing a threatened opponent a color
 * they are more likely to match. Ignored once that hand is larger than
 * attackHandMax, so a thin discard sample cannot override hand structure.
 */
/**
 * A forced miss means that player had no legal card for that top, so
 * their `blank` cards contain neither that color nor a Wild. Cards drawn
 * afterward are still unknown. A voluntary draw is not a miss.
 */
function followProbability(summary, count, miss, color, kind, value) {
  const bad = answersFor(summary, color, kind, value);
  if (!miss || typeof miss.blank !== "number" || miss.color !== color) {
    return probAtLeast(summary.total, bad, count);
  }
  const unknown = Math.max(0, count - miss.blank);
  if (unknown <= 0) return 0;
  return probAtLeast(summary.total, bad, unknown);
}

function colorRisk(view, effect, summary, color, kind, value) {
  if (!color) return 0;
  let target = effect.actor;
  if (effect.kind === "penalty" || effect.kind === "stack") {
    target = actorAfterFailure(view, effect.victim, view.direction);
  }
  if (target === view.turnIndex) return 0;
  const count = view.seats[target].handCount;
  if (count > WEIGHTS.attackHandMax) return 0;
  const miss = view.misses && view.misses[target];
  const followP = followProbability(summary, count, miss, color, kind, value);
  return followP * threatOf(count) * WEIGHTS.attackScale;
}

function evaluateChoice(view, card, color, order) {
  const remaining = without(view.hand, card);
  if (remaining.length === 0) {
    return { win: true, score: Number.POSITIVE_INFINITY, card, color, order };
  }
  const summary = unseenProfile(view);
  const effect = effectOf(view, card);
  const top = activeTop(card, color);
  effect.activeColor = top.color;
  const matched = matchParts(remaining, top.color, top.kind, top.value);
  const colorControl = matched.colorHits * WEIGHTS.follow +
    matched.wildHits * WEIGHTS.wildFollow +
    matched.symbolHits * WEIGHTS.symbolFollow;
  const flexibility = spreadScore(remaining) * WEIGHTS.spread;
  const future = bridgeScore(remaining);
  const tactical = tacticalDenial(view, card, effect, summary, remaining);
  const wildCost = opportunityCost(card);
  const risk = colorRisk(view, effect, summary, top.color, top.kind, top.value);
  const rankTie = card.kind === "number" ? (Number(card.value) || 0) * WEIGHTS.rankTie : 0;
  const score = tactical + flexibility + colorControl + future + rankTie - wildCost - risk;
  return {
    win: false,
    score: isFinite(score) ? score : -1e9,
    card,
    color: color || null,
    order,
    parts: {
      tacticalDenial: tactical,
      handFlexibility: flexibility,
      colorControl,
      futureOptions: future,
      rankTie,
      wildOpportunityCost: wildCost,
      strategicRisk: risk
    }
  };
}

function prefer(best, next) {
  if (!best) return next;
  if (next.score > best.score + 1e-9) return next;
  if (next.score < best.score - 1e-9) return best;
  if (next.order !== best.order) return next.order < best.order ? next : best;
  const nextColor = next.color ? COLORS.indexOf(next.color) : -1;
  const bestColor = best.color ? COLORS.indexOf(best.color) : -1;
  return nextColor < bestColor ? next : best;
}

function colorChoices(card) {
  if (isWildKind(card)) return COLORS.slice();
  return [card.color || null];
}

/**
 * Color to name on a Wild when the play itself is already chosen.
 * Equal support keeps COLORS order. A threatened short hand can break
 * that tie toward the color the public remainder makes harder to follow.
 */
function pickColor(hand, context) {
  const cards = hand || [];
  if (!cards.length) return "red";
  const view = normalize(Object.assign({}, context || {}, { hand: cards, playableIds: [] }));
  const summary = unseenProfile(view);
  const probe = { kind: "wild", color: null, value: "wild", id: "__color__" };
  const effect = effectOf(view, probe);
  let best = null;
  COLORS.forEach((color) => {
    const support = coloredCount(cards, color) * WEIGHTS.follow;
    const risk = context ? colorRisk(view, effect, summary, color, "wild", "wild") : 0;
    const score = support - risk;
    const order = COLORS.indexOf(color);
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && order < best.order)) {
      best = { color, score, order };
    }
  });
  return best ? best.color : "red";
}

function acceptScore(view) {
  const me = view.turnIndex;
  const next = effectOf(view, { kind: "number", color: "red", value: 0 }).natural;
  let score = -view.pendingPenalty * WEIGHTS.acceptPerCard;
  if (next !== me) score -= threatOf(view.seats[next].handCount) * 0.5;
  return score;
}

function passScore(view) {
  const me = view.turnIndex;
  const next = effectOf(view, { kind: "number", color: "red", value: 0 }).natural;
  let score = -WEIGHTS.passHold;
  if (next !== me) score -= threatOf(view.seats[next].handCount) * 0.35;
  return score;
}

function raceOn(view) {
  return view.seats.some((seat, index) =>
    index !== view.turnIndex && !seat.away && seat.handCount <= 2
  );
}

/**
 * Color-and-rank prior measured against the previous bot. Ordinary
 * plays use it. The structured evaluator replaces it only when the
 * candidate changes who is denied or enabled, or a Wild escapes a
 * one-card color into a color that still has support.
 */
function legacyMove(view) {
  const hand = view.hand;
  const probe = effectOf(view, { kind: "number", color: "red", value: 0 });
  const nextCount = view.seats[probe.natural].handCount;
  const colorFreq = {};
  hand.forEach((card) => {
    if (card.color && !isWildKind(card)) colorFreq[card.color] = (colorFreq[card.color] || 0) + 1;
  });
  let best = null;
  view.playableIds.forEach((id) => {
    const card = hand.find((item) => item.id === id);
    if (!card) return;
    let score = 0;
    if (view.pendingPenalty > 0) score = card.kind === "draw2" ? 100 : 90;
    else if (card.kind === "number") score = 40 + (Number(card.value) || 0) + (colorFreq[card.color] || 0) * 3;
    else if (card.kind === "skip" || card.kind === "reverse") {
      score = 30 + (colorFreq[card.color] || 0) * 3 + (nextCount <= 2 ? 25 : 0);
    } else if (card.kind === "draw2") {
      score = 35 + (colorFreq[card.color] || 0) * 3 + (nextCount <= 2 ? 30 : 0);
    } else if (card.kind === "wild") score = 15;
    else if (card.kind === "wild4") score = 10 + (nextCount <= 2 ? 45 : 0);
    if (!best || score > best.score) best = { card, score };
  });
  if (!best) return null;
  const move = { cardId: best.card.id };
  if (isWildKind(best.card)) {
    const rest = hand.filter((card) => card.id !== best.card.id);
    const freq = {};
    rest.forEach((card) => {
      if (card.color && !isWildKind(card)) freq[card.color] = (freq[card.color] || 0) + 1;
    });
    let color = "red";
    let n = -1;
    COLORS.forEach((entry) => {
      const count = freq[entry] || 0;
      if (count > n) {
        color = entry;
        n = count;
      }
    });
    move.color = color;
  }
  return move;
}

function seatCount(view, index) {
  if (index == null || !view.seats[index]) return 99;
  return view.seats[index].handCount;
}

function deniesShort(view, effect) {
  if (!effect || effect.victim == null || effect.victim === view.turnIndex) return false;
  if (effect.kind !== "skip" && effect.kind !== "reverse" && effect.kind !== "penalty" && effect.kind !== "stack") {
    return false;
  }
  return seatCount(view, effect.victim) <= 2;
}

function enablesShort(view, effect) {
  if (!effect || effect.kind === "penalty" || effect.kind === "stack") return false;
  if (effect.actor == null || effect.actor === view.turnIndex) return false;
  return seatCount(view, effect.actor) <= 2;
}

function keepEvaluated(view, evaluated, legacy) {
  if (!legacy) return evaluated;
  if (!evaluated || evaluated.action === "draw") return legacy;
  if (evaluated.cardId === legacy.cardId) return evaluated;
  const ourCard = view.hand.find((card) => card.id === evaluated.cardId);
  const legacyCard = view.hand.find((card) => card.id === legacy.cardId);
  if (!ourCard || !legacyCard) return legacy;
  const ourEffect = effectOf(view, ourCard);
  const legacyEffect = effectOf(view, legacyCard);
  if (deniesShort(view, ourEffect) && seatCount(view, ourEffect.victim) < seatCount(view, legacyEffect.victim)) {
    return evaluated;
  }
  if (enablesShort(view, legacyEffect) && !enablesShort(view, ourEffect)) return evaluated;
  if (isWildKind(ourCard) && !isWildKind(legacyCard)) {
    const stranded = coloredCount(view.hand, legacyCard.color) <= 1;
    const support = coloredCount(without(view.hand, ourCard), evaluated.color);
    if (stranded && support >= 3) return evaluated;
  }
  return legacy;
}

/**
 * Choose a legal play. Returns { cardId, color? }, { action: "draw" }
 * when accepting a penalty or declining a drawn card is better, or null
 * when nothing is playable.
 */
function getUnoMove(state) {
  const view = normalize(state || {});
  const hand = view.hand;
  const playable = view.playableIds;
  if (!playable.length) return null;

  let winner = null;
  playable.forEach((id, order) => {
    if (winner) return;
    const card = hand.find((item) => item.id === id);
    if (!card) return;
    if (without(hand, card).length === 0) {
      winner = {
        cardId: card.id,
        color: isWildKind(card) ? pickColor(without(hand, card), state) : undefined
      };
    }
  });
  if (winner) {
    if (!winner.color) delete winner.color;
    return winner;
  }

  let best = null;
  playable.forEach((id, order) => {
    const card = hand.find((item) => item.id === id);
    if (!card) return;
    colorChoices(card).forEach((color) => {
      best = prefer(best, evaluateChoice(view, card, color, order));
    });
  });
  if (!best) return null;

  let evaluated = null;
  if (view.pendingPenalty > 0 && !raceOn(view) && best.score < acceptScore(view)) {
    evaluated = { action: "draw" };
  } else if (view.awaitingDrawnPlay && best.score < passScore(view)) {
    evaluated = { action: "draw" };
  } else {
    evaluated = { cardId: best.card.id };
    if (isWildKind(best.card)) evaluated.color = best.color || "red";
  }
  return keepEvaluated(view, evaluated, legacyMove(view));
}

module.exports = {
  getUnoMove,
  pickColor,
  COLORS,
  WEIGHTS,
  evaluateChoice,
  normalize,
  unseenProfile,
  probAtLeast
};
