"use strict";

/*
 * Paired 4-player Dominoes benchmark:
 *   - Hint team: both partners select moves with getDominoHint().
 *   - Production team: both partners select moves with the live getDominoMove().
 *
 * Every deal is played twice, with the two policies swapping teams. This
 * balances seat/deal effects. The benchmark uses the real double-six tile set,
 * legal-move and placement helpers, the production move policy with its default
 * limits, public-only observations, team scoring, and the standard 6-6 opening.
 *
 * It is a simulated benchmark, not evidence about human play or live-server
 * performance. Run: node server/bots/domino/hintBenchmark.js --pairs=1000
 */

const domino = require("../../domino");
const { getDominoMove } = require("./ai");
const { getDominoHint } = require("./hint");
const { clearPlans } = require("./plan");

function argValue(name, fallback) {
  const prefix = "--" + name + "=";
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (!found) return fallback;
  const parsed = Number(found.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function deal(seed) {
  const rng = mulberry32(seed);
  const deck = shuffle(domino.buildDoubleSixSet(), rng);
  const hands = { p0: [], p1: [], p2: [], p3: [] };
  for (let round = 0; round < 7; round++) {
    for (let seat = 0; seat < 4; seat++) {
      hands["p" + seat].push(deck.pop());
    }
  }
  // The boneyard is unused in 4-player double-six play (28 tiles / 4 hands).
  return hands;
}

function pipTotal(hand) {
  return hand.reduce((sum, tile) => sum + tile.a + tile.b, 0);
}

function teamOf(seat) {
  return seat % 2 === 0 ? "A" : "B";
}

function viewFor(game, seat) {
  const selfId = "p" + seat;
  const hand = game.hands[selfId];
  const validMoves = domino.listValidMoves(
    hand,
    game.leftEnd,
    game.rightEnd,
    game.chain.length,
    game.mustPlayId
  ).map((move) => ({ tileId: move.tileId, side: move.side }));

  return {
    selfId,
    gameId: game.gameId,
    roundNumber: 1,
    hand: hand.map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    validMoves,
    leftEnd: game.leftEnd,
    rightEnd: game.rightEnd,
    chain: game.chain.map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    players: [0, 1, 2, 3].map((index) => ({
      id: "p" + index,
      handCount: game.hands["p" + index].length,
      team: teamOf(index)
    })),
    teamMode: true,
    teamA: ["p0", "p2"],
    teamB: ["p1", "p3"],
    log: game.log.map((event) => ({ ...event, tile: event.tile ? { ...event.tile } : undefined })),
    boneyardCount: 0,
    mustPlayId: game.mustPlayId,
    firstRound: true
  };
}

function pickMove(game, seat, policy) {
  const view = viewFor(game, seat);
  if (!view.validMoves.length) return null;

  let selected;
  if (policy === "hint") {
    const hint = getDominoHint(view);
    if (!hint || hint.pass || !hint.tile) {
      throw new Error("Hint policy failed to choose a move in a legal position: " + game.gameId);
    }
    selected = { tileId: hint.tile.id, side: hint.side };
  } else {
    const choice = getDominoMove(view);
    if (!choice) throw new Error("Production policy failed to choose a legal move: " + game.gameId);
    selected = { tileId: choice.tileId, side: choice.side };
  }

  const legal = view.validMoves.some((move) =>
    move.tileId === selected.tileId && move.side === selected.side
  );
  if (!legal) {
    throw new Error(policy + " policy returned an illegal move in " + game.gameId +
      ": " + JSON.stringify(selected));
  }
  return selected;
}

function playGame(handsInput, hintTeam, gameId) {
  // Clone because the paired game must use the exact same initial deal.
  const hands = {};
  Object.keys(handsInput).forEach((id) => {
    hands[id] = handsInput[id].map((tile) => ({ id: tile.id, a: tile.a, b: tile.b }));
  });

  const holder = Object.keys(hands).find((id) => hands[id].some((tile) => tile.id === "6-6"));
  if (!holder) throw new Error("Invalid deal: 6-6 is missing");
  const game = {
    gameId,
    hands,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    mustPlayId: "6-6",
    log: [],
    consecutivePasses: 0,
    turn: Number(holder.slice(1)),
    plies: 0
  };

  let winnerTeam = null;
  let winReason = null;
  let safetyCounter = 0;
  while (!winnerTeam && safetyCounter++ < 100) {
    const seat = game.turn;
    const playerId = "p" + seat;
    const hand = game.hands[playerId];
    const policy = teamOf(seat) === hintTeam ? "hint" : "production";
    const beforeLeft = game.leftEnd;
    const beforeRight = game.rightEnd;
    const legalMoves = domino.listValidMoves(
      hand, game.leftEnd, game.rightEnd, game.chain.length, game.mustPlayId
    );

    if (!legalMoves.length) {
      game.log.push({
        type: "pass", playerId, leftEnd: game.leftEnd, rightEnd: game.rightEnd,
        boardLeftBefore: game.leftEnd, boardRightBefore: game.rightEnd,
        boardLeftAfter: game.leftEnd, boardRightAfter: game.rightEnd,
        handSizeBefore: hand.length, handSizeAfter: hand.length
      });
      game.consecutivePasses++;
      if (game.consecutivePasses >= 4) {
        const teamAPips = pipTotal(game.hands.p0) + pipTotal(game.hands.p2);
        const teamBPips = pipTotal(game.hands.p1) + pipTotal(game.hands.p3);
        winnerTeam = teamAPips <= teamBPips ? "A" : "B";
        winReason = "blocked";
        break;
      }
      game.turn = (seat + 1) % 4;
      game.plies++;
      continue;
    }

    const move = pickMove(game, seat, policy);
    const tileIndex = hand.findIndex((tile) => tile.id === move.tileId);
    if (tileIndex < 0) throw new Error("Selected tile not in acting hand: " + move.tileId);
    const tile = hand[tileIndex];
    const placed = domino.placeTile(game, tile, move.side);
    if (!placed) throw new Error("Production placement helper rejected legal move " + move.tileId);

    game.log.push({
      type: "play",
      playerId,
      tile: { id: tile.id, a: tile.a, b: tile.b },
      tileValues: [tile.a, tile.b],
      side: move.side,
      matchedEnd: move.side === "left" || move.side === "right" ? move.side : null,
      matchedValue: move.side === "left" ? beforeLeft : move.side === "right" ? beforeRight : null,
      leftEndBefore: beforeLeft,
      rightEndBefore: beforeRight,
      leftEnd: game.leftEnd,
      rightEnd: game.rightEnd,
      boardLeftBefore: beforeLeft,
      boardRightBefore: beforeRight,
      boardLeftAfter: game.leftEnd,
      boardRightAfter: game.rightEnd,
      handSizeBefore: hand.length,
      handSizeAfter: hand.length - 1
    });
    hand.splice(tileIndex, 1);
    game.mustPlayId = null;
    game.consecutivePasses = 0;
    game.plies++;

    if (!hand.length) {
      winnerTeam = teamOf(seat);
      winReason = "empty-hand";
      break;
    }
    game.turn = (seat + 1) % 4;
  }

  if (safetyCounter >= 100) throw new Error("Game exceeded safety turn limit: " + gameId);
  const teamAPips = pipTotal(game.hands.p0) + pipTotal(game.hands.p2);
  const teamBPips = pipTotal(game.hands.p1) + pipTotal(game.hands.p3);
  return {
    winnerTeam,
    winReason,
    plies: game.plies,
    teamAPips,
    teamBPips,
    pointsAwarded: winnerTeam === "A" ? teamBPips : winnerTeam === "B" ? teamAPips : 0
  };
}

function runBenchmark(pairs, seed) {
  const stats = {
    pairs,
    games: pairs * 2,
    hintWins: 0,
    productionWins: 0,
    draws: 0,
    hintPoints: 0,
    productionPoints: 0,
    hintEmptyHandWins: 0,
    hintBlockedWins: 0,
    productionEmptyHandWins: 0,
    productionBlockedWins: 0,
    hintSweptPairs: 0,
    splitPairs: 0,
    productionSweptPairs: 0,
    pairsWithDraws: 0,
    totalPlies: 0
  };
  const pairedDealScores = [];

  for (let index = 0; index < pairs; index++) {
    const hands = deal((seed + Math.imul(index + 1, 0x9E3779B1)) >>> 0);

    // First game: hint team A, production team B.
    clearPlans();
    const first = playGame(hands, "A", "hint-benchmark-" + seed + "-" + index + "-A");
    // Second game: exact same deal, policies swap teams.
    clearPlans();
    const second = playGame(hands, "B", "hint-benchmark-" + seed + "-" + index + "-B");

    let hintWinsInPair = 0;
    let productionWinsInPair = 0;
    let drawsInPair = 0;
    for (const result of [first, second]) {
      stats.totalPlies += result.plies;
      if (result.winnerTeam == null) {
        stats.draws++;
        drawsInPair++;
        continue;
      }
      const hintWon = result.winnerTeam === (result === first ? "A" : "B");
      if (hintWon) {
        hintWinsInPair++;
        stats.hintWins++;
        stats.hintPoints += result.pointsAwarded;
        if (result.winReason === "empty-hand") stats.hintEmptyHandWins++;
        else stats.hintBlockedWins++;
      } else {
        productionWinsInPair++;
        stats.productionWins++;
        stats.productionPoints += result.pointsAwarded;
        if (result.winReason === "empty-hand") stats.productionEmptyHandWins++;
        else stats.productionBlockedWins++;
      }
    }

    pairedDealScores.push((hintWinsInPair + drawsInPair * 0.5) / 2);
    if (hintWinsInPair === 2) stats.hintSweptPairs++;
    else if (productionWinsInPair === 2) stats.productionSweptPairs++;
    else if (hintWinsInPair === 1 && productionWinsInPair === 1) stats.splitPairs++;
    if (drawsInPair > 0) stats.pairsWithDraws++;

    if ((index + 1) % 100 === 0 || index + 1 === pairs) {
      process.stderr.write("Completed " + (index + 1) + "/" + pairs + " paired deals\n");
    }
  }

  const decisive = stats.hintWins + stats.productionWins;
  const scoreRate = (stats.hintWins + stats.draws * 0.5) / stats.games;
  const winRate = decisive ? stats.hintWins / decisive : null;
  // The two games in a pair share the same deal, so they are not independent.
  // Estimate uncertainty across paired-deal score shares instead of pretending
  // all 2,000 game outcomes are independent observations.
  const pairedMean = pairedDealScores.reduce((sum, value) => sum + value, 0) / pairs;
  const pairedVariance = pairs > 1
    ? pairedDealScores.reduce((sum, value) => sum + Math.pow(value - pairedMean, 2), 0) / (pairs - 1)
    : 0;
  const standardError = Math.sqrt(pairedVariance / pairs);
  stats.hintScoreRate = Number(scoreRate.toFixed(4));
  stats.hintWinRateAmongDecisive = winRate == null ? null : Number(winRate.toFixed(4));
  stats.hintScoreRate95CI = [
    Number(Math.max(0, pairedMean - 1.96 * standardError).toFixed(4)),
    Number(Math.min(1, pairedMean + 1.96 * standardError).toFixed(4))
  ];
  stats.confidenceIntervalMethod = "Approximate 95% t/normal interval calculated across paired-deal score shares; paired games are not treated as independent.";
  stats.averagePliesPerGame = Number((stats.totalPlies / stats.games).toFixed(2));
  stats.averagePointsWhenHintWins = stats.hintWins
    ? Number((stats.hintPoints / stats.hintWins).toFixed(2)) : null;
  stats.averagePointsWhenProductionWins = stats.productionWins
    ? Number((stats.productionPoints / stats.productionWins).toFixed(2)) : null;
  stats.seed = seed >>> 0;
  stats.interpretation = "Synthetic self-play only. Each pair replays the same deal with policies swapping teams. The confidence interval uses pair-level score shares to account for the two games sharing a deal; it does not establish performance against humans.";
  return stats;
}

const pairs = Math.max(1, Math.min(100000, Math.floor(argValue("pairs", 1000))));
const seed = Math.floor(argValue("seed", 0x51A7E123)) >>> 0;
const result = runBenchmark(pairs, seed);
console.log(JSON.stringify(result, null, 2));
