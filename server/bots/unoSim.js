/*
 * Headless UNO rounds using Gameweb's exported legality helpers.
 * Strategies receive public state only: own hand, legal ids, seat
 * counts, direction, and the visible discard. The draw pile and the
 * other hands stay inside the simulator.
 */

const uno = require("../uno");
const strategyBot = require("./unoBot");
const baselineBot = require("./unoBotBaseline");

const COLORS = strategyBot.COLORS;
const MAX_TURNS = 450;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(cards, rng) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function isWild(card) {
  return card && (card.kind === "wild" || card.kind === "wild4");
}

function ensureDraw(state, rng) {
  if (state.draw.length > 0) return;
  if (state.discard.length <= 1) return;
  const top = state.discard.pop();
  const rest = state.discard.map((card) => {
    const copy = Object.assign({}, card);
    delete copy.chosenColor;
    if (isWild(copy)) copy.color = null;
    return copy;
  });
  state.draw = shuffle(rest, rng);
  state.discard = [top];
}

function drawFrom(state, count, rng) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    ensureDraw(state, rng);
    if (state.draw.length === 0) break;
    drawn.push(state.draw.pop());
  }
  return drawn;
}

function advance(state, steps) {
  const n = state.hands.length;
  let idx = state.turnIndex;
  for (let i = 0; i < steps; i++) idx = (idx + state.direction + n * 8) % n;
  state.turnIndex = idx;
}

function resolvePenalties(state, rng) {
  const n = state.hands.length;
  let guard = 0;
  while (guard++ < n + 1) {
    if (state.over || state.pendingPenalty <= 0) return;
    const hand = state.hands[state.turnIndex];
    if (uno.listPlayable(state, hand).length > 0) return;
    const drawn = drawFrom(state, state.pendingPenalty, rng);
    hand.push(...drawn);
    state.pendingPenalty = 0;
    state.pendingKind = null;
    advance(state, 1);
  }
}

function applyOpening(state, rng) {
  const top = state.discard[state.discard.length - 1];
  const n = state.hands.length;
  if (!top) return;
  if (top.kind === "skip") {
    advance(state, 1);
  } else if (top.kind === "reverse") {
    if (n === 2) advance(state, 1);
    else state.direction = -1;
  } else if (top.kind === "draw2") {
    const drawn = drawFrom(state, 2, rng);
    state.hands[state.turnIndex].push(...drawn);
    advance(state, 1);
  }
}

function deal(playerCount, rng) {
  const deck = shuffle(uno.buildDeck(), rng);
  const hands = [];
  for (let i = 0; i < playerCount; i++) hands.push([]);
  for (let i = 0; i < uno.HAND_SIZE; i++) {
    for (let p = 0; p < playerCount; p++) hands[p].push(deck.pop());
  }
  const wildPark = [];
  let starter = null;
  while (deck.length) {
    const card = deck.pop();
    if (isWild(card)) wildPark.push(card);
    else {
      starter = card;
      break;
    }
  }
  const draw = shuffle(deck.concat(wildPark), rng);
  if (!starter) starter = { id: "c0", color: "red", kind: "number", value: 0 };
  const state = {
    draw,
    discard: [starter],
    hands,
    turnIndex: Math.floor(rng() * playerCount),
    direction: 1,
    pendingPenalty: 0,
    pendingKind: null,
    awaiting: null,
    over: false,
    winner: null,
    turnsPlayed: 0,
    illegal: 0,
    misses: {}
  };
  applyOpening(state, rng);
  return state;
}

function publicView(state, seat, playableIds) {
  const n = state.hands.length;
  const next = (seat + state.direction + n * 8) % n;
  return {
    hand: state.hands[seat].slice(),
    playableIds: playableIds.slice(),
    pendingPenalty: state.pendingPenalty,
    pendingKind: state.pendingKind,
    nextPlayerHandCount: state.hands[next].length,
    turnIndex: seat,
    direction: state.direction,
    seats: state.hands.map((hand) => ({ handCount: hand.length, away: false })),
    discard: state.discard.map((card) => ({
      id: card.id,
      color: card.color,
      kind: card.kind,
      value: card.value,
      chosenColor: card.chosenColor || null
    })),
    awaitingDrawnPlay: !!(state.awaiting && state.awaiting.seat === seat),
    misses: state.hands.map((_, index) => {
      const miss = state.misses && state.misses[index];
      if (!miss) return null;
      return { color: miss.color, kind: miss.kind, value: miss.value, blank: miss.blank };
    })
  };
}

function applyPlay(state, cardId, color) {
  const seat = state.turnIndex;
  const hand = state.hands[seat];
  const idx = hand.findIndex((card) => card.id === cardId);
  if (idx < 0) return { ok: false, error: "missing" };
  const card = hand[idx];
  if (state.awaiting && state.awaiting.seat === seat && state.awaiting.cardId !== cardId) {
    return { ok: false, error: "drawn" };
  }
  if (!uno.canPlayCard(state, card)) return { ok: false, error: "illegal" };
  if (isWild(card) && COLORS.indexOf(color) < 0) return { ok: false, error: "color" };
  if (state.misses) delete state.misses[seat];
  hand.splice(idx, 1);
  const played = Object.assign({}, card);
  if (color) played.chosenColor = color;
  state.discard.push(played);
  state.awaiting = null;
  state.turnsPlayed += 1;
  if (hand.length === 0) {
    state.over = true;
    state.winner = seat;
    state.pendingPenalty = 0;
    state.pendingKind = null;
    return { ok: true, win: true };
  }
  const n = state.hands.length;
  if (card.kind === "draw2") {
    state.pendingPenalty += 2;
    state.pendingKind = "draw2";
    advance(state, 1);
  } else if (card.kind === "wild4") {
    state.pendingPenalty += 4;
    state.pendingKind = "wild4";
    advance(state, 1);
  } else if (card.kind === "skip" || (card.kind === "reverse" && n === 2)) {
    advance(state, 2);
  } else if (card.kind === "reverse") {
    state.direction *= -1;
    advance(state, 1);
  } else {
    advance(state, 1);
  }
  return { ok: true };
}

function noteMiss(state) {
  if (state.pendingPenalty > 0) return;
  const seat = state.turnIndex;
  const hand = state.hands[seat];
  if (uno.listPlayable(state, hand).length > 0) return;
  const top = state.discard[state.discard.length - 1];
  if (!top) return;
  if (!state.misses) state.misses = {};
  state.misses[seat] = {
    color: top.chosenColor || top.color,
    kind: top.kind,
    value: top.value,
    blank: hand.length
  };
}

function applyDraw(state, rng) {
  const seat = state.turnIndex;
  const hand = state.hands[seat];
  if (state.awaiting && state.awaiting.seat === seat) {
    state.awaiting = null;
    state.turnsPlayed += 1;
    advance(state, 1);
    resolvePenalties(state, rng);
    return { ok: true };
  }
  if (state.pendingPenalty > 0) {
    const drawn = drawFrom(state, state.pendingPenalty, rng);
    hand.push(...drawn);
    state.pendingPenalty = 0;
    state.pendingKind = null;
    state.turnsPlayed += 1;
    advance(state, 1);
    resolvePenalties(state, rng);
    return { ok: true };
  }
  noteMiss(state);
  const drawn = drawFrom(state, 1, rng);
  if (!drawn.length) {
    if (uno.listPlayable(state, hand).length > 0) return { ok: false, error: "empty" };
    state.turnsPlayed += 1;
    advance(state, 1);
    resolvePenalties(state, rng);
    return { ok: true, passed: true };
  }
  hand.push(drawn[0]);
  if (uno.canPlayCard(state, drawn[0])) {
    state.awaiting = { seat, cardId: drawn[0].id };
    return { ok: true, awaiting: true };
  }
  if (state.misses && state.misses[seat]) state.misses[seat].blank = hand.length;
  state.turnsPlayed += 1;
  advance(state, 1);
  resolvePenalties(state, rng);
  return { ok: true };
}

function legalIds(state) {
  const seat = state.turnIndex;
  let ids = uno.listPlayable(state, state.hands[seat]);
  if (state.awaiting && state.awaiting.seat === seat) {
    ids = ids.filter((id) => id === state.awaiting.cardId);
  }
  return ids;
}

function resolveMove(state, move, playable, rng) {
  if (!playable.length || (move && move.action === "draw")) {
    return applyDraw(state, rng);
  }
  const cardId = playable.indexOf(move && move.cardId) >= 0 ? move.cardId : null;
  if (!cardId) {
    state.illegal += 1;
    const fallback = playable[0];
    const card = state.hands[state.turnIndex].find((item) => item.id === fallback);
    const color = card && isWild(card) ? "red" : null;
    const played = applyPlay(state, fallback, color);
    if (played.ok) resolvePenalties(state, rng);
    return played;
  }
  const card = state.hands[state.turnIndex].find((item) => item.id === cardId);
  let color = move.color;
  if (card && isWild(card) && COLORS.indexOf(color) < 0) {
    state.illegal += 1;
    color = strategyBot.pickColor(state.hands[state.turnIndex].filter((item) => item.id !== cardId));
  }
  const played = applyPlay(state, cardId, color);
  if (!played.ok) {
    state.illegal += 1;
    return played;
  }
  if (!played.win) resolvePenalties(state, rng);
  return played;
}

/**
 * strategies[seat] is (publicView, rng) => move.
 * Returns the finished round summary. Hidden cards are not copied out.
 */
function playRound(playerCount, seed, strategies) {
  const rng = mulberry32(seed);
  const state = deal(playerCount, rng);
  const decisions = [];
  let turns = 0;
  while (!state.over && turns < MAX_TURNS) {
    const seat = state.turnIndex;
    const playable = legalIds(state);
    const view = publicView(state, seat, playable);
    const started = process.hrtime.bigint();
    const move = strategies[seat](view, rng);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    decisions.push({ seat, ms });
    const before = state.turnIndex;
    const pending = state.pendingPenalty;
    const discardLen = state.discard.length;
    const result = resolveMove(state, move, playable, rng);
    turns += 1;
    if (!result.ok) break;
    const progressed = state.over || state.turnIndex !== before ||
      state.pendingPenalty !== pending || state.discard.length !== discardLen ||
      state.awaiting;
    if (!progressed) break;
  }
  const finished = !!state.over && state.winner !== null;
  const loserCards = finished
    ? state.hands.reduce((sum, hand, index) => sum + (index === state.winner ? 0 : hand.length), 0)
    : null;
  return {
    finished,
    winner: state.winner,
    turns: state.turnsPlayed,
    steps: turns,
    illegal: state.illegal,
    stalled: !finished,
    winnerCards: finished ? 0 : null,
    loserCards,
    decisions
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function wilson(wins, n) {
  if (!n) return { low: 0, high: 0 };
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function strategyNew(view) {
  return strategyBot.getUnoMove(view);
}

function strategyBaseline(view) {
  return baselineBot.getUnoMove(view);
}

function strategyRandom(view, rng) {
  const ids = view.playableIds || [];
  if (!ids.length) return { action: "draw" };
  const cardId = ids[Math.floor(rng() * ids.length)];
  const card = (view.hand || []).find((item) => item.id === cardId);
  const move = { cardId };
  if (card && isWild(card)) move.color = COLORS[Math.floor(rng() * COLORS.length)];
  return move;
}

/**
 * One focal strategy against a field. The focal seat rotates so each
 * seat plays the same number of rounds.
 */
function compare(options) {
  const players = options.players;
  const games = options.games;
  const seedStart = options.seedStart || 1;
  const focal = options.focal;
  const field = options.field;
  const bySeat = [];
  for (let seat = 0; seat < players; seat++) bySeat.push({ wins: 0, games: 0 });
  let wins = 0;
  let finished = 0;
  let stalled = 0;
  let illegal = 0;
  let turns = 0;
  let loserCards = 0;
  const latency = [];
  const perSeat = Math.floor(games / players);
  const total = perSeat * players;
  let cursor = 0;
  for (let seat = 0; seat < players; seat++) {
    for (let g = 0; g < perSeat; g++) {
      const strategies = [];
      for (let i = 0; i < players; i++) strategies.push(i === seat ? focal : field);
      const round = playRound(players, seedStart + cursor, strategies);
      cursor += 1;
      bySeat[seat].games += 1;
      if (round.finished) {
        finished += 1;
        turns += round.turns;
        loserCards += round.loserCards;
        if (round.winner === seat) {
          wins += 1;
          bySeat[seat].wins += 1;
        }
      } else stalled += 1;
      illegal += round.illegal;
      round.decisions.forEach((decision) => {
        if (decision.seat === seat) latency.push(decision.ms);
      });
    }
  }
  const interval = wilson(wins, finished);
  return {
    players,
    games: total,
    finished,
    stalled,
    illegal,
    wins,
    winRate: finished ? wins / finished : 0,
    expected: 1 / players,
    wilson95: interval,
    bySeat: bySeat.map((row) => ({
      wins: row.wins,
      games: row.games,
      winRate: row.games ? row.wins / row.games : 0
    })),
    avgTurns: finished ? turns / finished : 0,
    avgLoserCards: finished ? loserCards / finished : 0,
    winnerCards: 0,
    latencyMean: latency.length ? latency.reduce((s, n) => s + n, 0) / latency.length : 0,
    latencyP95: percentile(latency, 0.95)
  };
}

function commitPlay(state, cardId, color, rng) {
  const played = applyPlay(state, cardId, color);
  if (played.ok && !played.win) resolvePenalties(state, rng);
  return played;
}

module.exports = {
  mulberry32,
  deal,
  playRound,
  compare,
  publicView,
  applyPlay,
  applyDraw,
  commitPlay,
  strategyNew,
  strategyBaseline,
  strategyRandom,
  MAX_TURNS,
  wilson
};
