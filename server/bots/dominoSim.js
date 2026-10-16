"use strict";

/*
 * Headless four-player (or fewer) Dominoes matches.
 * Deals, legality, passes, draws, and scoring follow server/domino.js.
 * Strategies see the same public view the live bot receives.
 */

const domino = require("../domino");
const dominoBot = require("./dominoBot");
const { mulberry32, hashString } = require("./domino/sample");

const QUIET = { samples: 0, maxMs: 0, maxPlies: 28, maxNodes: 6000 };

function cloneTile(tile) {
  return { id: tile.id, a: tile.a, b: tile.b };
}

function teamOf(table, playerId) {
  if (!table.teamMode) return null;
  if ((table.teamA || []).indexOf(playerId) >= 0) return "A";
  if ((table.teamB || []).indexOf(playerId) >= 0) return "B";
  return null;
}

function shuffleWith(tiles, rng) {
  const arr = tiles.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr;
}

function forceTile(playerIds, dealt, tileId) {
  if (domino.findTileHolder(playerIds, dealt.hands, tileId)) return;
  const yardIndex = dealt.boneyard.findIndex((tile) => tile.id === tileId);
  if (yardIndex < 0) return;
  const tile = dealt.boneyard.splice(yardIndex, 1)[0];
  const displaced = dealt.hands[playerIds[0]].pop();
  dealt.hands[playerIds[0]].push(tile);
  if (displaced) dealt.boneyard.push(displaced);
}

function dealSeeded(playerIds, rng, requireTileId) {
  function once() {
    const deck = shuffleWith(domino.buildDoubleSixSet(), rng);
    const hands = {};
    playerIds.forEach((id) => {
      hands[id] = [];
    });
    for (let i = 0; i < domino.HAND_SIZE; i++) {
      playerIds.forEach((id) => {
        hands[id].push(deck.pop());
      });
    }
    return { hands: hands, boneyard: deck };
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const dealt = once();
    if (!requireTileId || domino.findTileHolder(playerIds, dealt.hands, requireTileId)) return dealt;
  }
  const dealt = once();
  if (requireTileId) forceTile(playerIds, dealt, requireTileId);
  return dealt;
}

function freshMatch(order) {
  const players = {};
  order.forEach((id) => {
    players[id] = { roundsWon: 0, score: 0 };
  });
  return {
    roundsCompleted: 0,
    lastWinnerId: null,
    teams: {
      A: { roundsWon: 0, score: 0 },
      B: { roundsWon: 0, score: 0 }
    },
    players: players
  };
}

function makeTable(spec) {
  const order = spec.order.slice();
  const starter = spec.starter || order[0];
  return {
    order: order,
    turn: Math.max(0, order.indexOf(starter)),
    hands: spec.hands,
    boneyard: spec.boneyard ? spec.boneyard.slice() : [],
    chain: spec.chain ? spec.chain.map(cloneTile) : [],
    leftEnd: spec.leftEnd == null ? null : spec.leftEnd,
    rightEnd: spec.rightEnd == null ? null : spec.rightEnd,
    mustPlayId: spec.mustPlayId || null,
    log: [],
    passes: 0,
    over: !!spec.over,
    teamMode: !!spec.teamMode,
    teamA: spec.teamA ? spec.teamA.slice() : null,
    teamB: spec.teamB ? spec.teamB.slice() : null,
    winnerId: spec.winnerId || null,
    winnerTeam: spec.winnerTeam || null,
    winReason: spec.winReason || null,
    roundPoints: spec.roundPoints || 0
  };
}

function startRound(order, match, rng, teamMode) {
  const first = !match.roundsCompleted;
  const dealt = dealSeeded(order, rng, first ? "6-6" : null);
  const plan = domino.planOpening(order, dealt.hands, match);
  const starter = plan.starterId || order[0];
  return {
    order: order.slice(),
    turn: Math.max(0, order.indexOf(starter)),
    hands: dealt.hands,
    boneyard: dealt.boneyard,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    mustPlayId: plan.mustPlayId,
    firstRound: !!plan.firstRound,
    log: [],
    passes: 0,
    over: false,
    teamMode: !!(teamMode && order.length === 4),
    teamA: order.length === 4 ? [order[0], order[2]] : null,
    teamB: order.length === 4 ? [order[1], order[3]] : null,
    winnerId: null,
    winnerTeam: null,
    winReason: null,
    roundPoints: 0
  };
}

function publicView(table, playerId) {
  const moves = domino.listValidMoves(
    table.hands[playerId] || [],
    table.leftEnd,
    table.rightEnd,
    table.chain.length,
    table.mustPlayId
  );
  return {
    selfId: playerId,
    hand: (table.hands[playerId] || []).map(cloneTile),
    validMoves: moves.map((move) => ({ tileId: move.tileId, side: move.side })),
    leftEnd: table.leftEnd,
    rightEnd: table.rightEnd,
    chain: table.chain.map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    chainLength: table.chain.length,
    players: table.order.map((id) => ({
      id: id,
      handCount: table.hands[id].length,
      team: teamOf(table, id)
    })),
    teamMode: !!table.teamMode,
    teamA: table.teamA ? table.teamA.slice() : null,
    teamB: table.teamB ? table.teamB.slice() : null,
    log: table.log.map((entry) => {
      const copy = Object.assign({}, entry);
      if (entry.tile) copy.tile = cloneTile(entry.tile);
      return copy;
    }),
    boneyardCount: table.boneyard.length,
    mustPlayId: table.mustPlayId || null
  };
}

function account(table) {
  const ids = [];
  table.order.forEach((id) => {
    (table.hands[id] || []).forEach((tile) => ids.push(tile.id));
  });
  table.chain.forEach((tile) => ids.push(tile.id));
  table.boneyard.forEach((tile) => ids.push(tile.id));
  return {
    count: ids.length,
    unique: new Set(ids).size
  };
}

function applyPlay(table, playerId, move) {
  const hand = table.hands[playerId];
  const index = hand.findIndex((tile) => tile.id === move.tileId);
  if (index < 0) return false;
  const tile = hand[index];
  const leftBefore = table.leftEnd;
  const rightBefore = table.rightEnd;
  const placed = domino.placeTile(table, tile, move.side);
  if (!placed) return false;
  hand.splice(index, 1);
  table.passes = 0;
  table.log.push({
    type: "play",
    playerId: playerId,
    tile: cloneTile(tile),
    side: move.side,
    leftEndBefore: leftBefore,
    rightEndBefore: rightBefore,
    leftEnd: table.leftEnd,
    rightEnd: table.rightEnd
  });
  if (hand.length === 0) {
    table.over = true;
    table.winReason = "emptied";
    table.winnerId = playerId;
    return true;
  }
  table.turn = (table.turn + 1) % table.order.length;
  return true;
}

function humanSuitMove(view) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  view.hand.forEach((tile) => {
    counts[tile.a] += 1;
    if (tile.b !== tile.a) counts[tile.b] += 1;
  });
  let best = null;
  let bestScore = -1;
  view.validMoves.forEach((move, index) => {
    const tile = view.hand.find((item) => item.id === move.tileId);
    if (!tile) return;
    const score = (counts[tile.a] + counts[tile.b]) * 10 - index * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  });
  return best;
}

function greedyMove(view) {
  let best = null;
  let bestPips = -1;
  view.validMoves.forEach((move, index) => {
    const tile = view.hand.find((item) => item.id === move.tileId);
    const pips = tile ? tile.a + tile.b : -1;
    if (!best || pips > bestPips || (pips === bestPips && index < best.index)) {
      bestPips = pips;
      best = { move: move, index: index };
    }
  });
  return best ? best.move : null;
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

function followMove(view) {
  const mate = partnerId(view);
  let pip = null;
  (view.log || []).forEach((event) => {
    if (!mate || !event || event.playerId !== mate || event.type !== "play") return;
    if (event.side === "left" && event.leftEnd != null) pip = event.leftEnd;
    else if (event.side === "right" && event.rightEnd != null) pip = event.rightEnd;
  });
  if (pip == null) return greedyMove(view);
  let best = null;
  view.validMoves.forEach((move, index) => {
    const tile = view.hand.find((item) => item.id === move.tileId);
    if (!tile) return;
    const state = {
      chain: (view.chain || []).map(cloneTile),
      leftEnd: view.leftEnd,
      rightEnd: view.rightEnd,
      mustPlayId: view.mustPlayId || null
    };
    if (!domino.placeTile(state, tile, move.side)) return;
    const keeps = state.leftEnd === pip || state.rightEnd === pip;
    const score = (keeps ? 100 : 0) + tile.a + tile.b - index * 0.01;
    if (!best || score > best.score) best = { move: move, score: score };
  });
  return best ? best.move : greedyMove(view);
}

function choose(strategy, view, rng, config) {
  if (!view.validMoves.length) return null;
  if (strategy === "random") {
    return view.validMoves[Math.floor(rng() * view.validMoves.length)];
  }
  if (strategy === "greedy") return greedyMove(view);
  if (strategy === "legacy") return dominoBot.legacyGetDominoMove(view);
  if (strategy === "human") return humanSuitMove(view);
  if (strategy === "follow") return followMove(view);
  if (strategy === "first") return view.validMoves[0];
  if (strategy === "illegal") return { tileId: "9-9", side: "left" };
  const limits = Object.assign({}, QUIET);
  const options = { limits: limits };
  if (strategy === "ai" || strategy === "ai-no-passes" || strategy === "ai-no-team" || strategy === "no-hands") {
    Object.assign(limits, config && config.aiLimits ? config.aiLimits : {
      samples: 4,
      maxMs: 12,
      maxPlies: 18,
      maxNodes: 1800
    });
  }
  if (strategy === "no-passes" || strategy === "ai-no-passes") options.ignorePasses = true;
  if (strategy === "no-team" || strategy === "ai-no-team") options.ignoreTeam = true;
  if (strategy === "no-intent") options.ignoreIntent = true;
  if (strategy === "no-hands") options.ignoreHands = true;
  if (strategy === "baseline") {
    options.ignoreIntent = true;
    options.weights = {
      shedPips: 12,
      dumpDouble: 5,
      mateSuit: 1.1,
      intentKeep: 0,
      mateVoidHarm: 0,
      oppVoidExploit: 0,
      oppFeed: 0,
      mateFinish: 0,
      otherFinish: 0
    };
  }
  if (strategy === "passes") {
    options.ignoreIntent = true;
    options.weights = {
      mateSuit: 0,
      intentKeep: 0,
      mateFinish: 0,
      oppFeed: 0,
      shedPips: 8,
      dumpDouble: 4
    };
  }
  options.seed = (config && config.seed) || 1;
  return dominoBot.getDominoMove(view, options);
}

function stepTable(table, strategies, rng, stats, config) {
  if (table.over) return;
  const playerId = table.order[table.turn];
  let guard = 0;
  while (!table.over && guard++ < 24) {
    const hand = table.hands[playerId];
    const moves = domino.listValidMoves(
      hand,
      table.leftEnd,
      table.rightEnd,
      table.chain.length,
      table.mustPlayId
    );
    if (moves.length) {
      const view = publicView(table, playerId);
      const started = Date.now();
      let choice = choose(strategies[playerId], view, rng, config);
      if (stats) {
        stats.decisions += 1;
        stats.ms += Date.now() - started;
        if (hand.length === 1 && (!choice || choice.tileId !== hand[0].id)) stats.missedWins += 1;
      }
      const matched = choice && moves.some((move) => move.tileId === choice.tileId && move.side === choice.side);
      if (!matched) {
        if (stats) stats.illegal += 1;
        choice = { tileId: moves[0].tileId, side: moves[0].side };
      }
      applyPlay(table, playerId, choice);
      return;
    }
    if (table.chain.length > 0 && table.boneyard.length) {
      hand.push(table.boneyard.pop());
      table.log.push({ type: "draw", playerId: playerId });
      if (stats) stats.draws += 1;
      continue;
    }
    if (moves.length > 0 && stats) stats.avoidablePasses += 1;
    table.log.push({
      type: "pass",
      playerId: playerId,
      leftEnd: table.leftEnd,
      rightEnd: table.rightEnd
    });
    table.passes += 1;
    if (stats) stats.passes += 1;
    if (table.passes >= table.order.length) {
      table.over = true;
      table.winReason = "blocked";
      return;
    }
    table.turn = (table.turn + 1) % table.order.length;
    return;
  }
}

function scoreStanding(table, match) {
  const ids = table.order;
  if (table.teamMode) {
    const sum = (team) => (team || []).reduce((total, id) => total + domino.handScore(table.hands[id] || []), 0);
    const a = sum(table.teamA);
    const b = sum(table.teamB);
    let winnerTeam;
    if (table.winReason === "emptied") {
      winnerTeam = (table.teamA || []).indexOf(table.winnerId) >= 0 ? "A" : "B";
    } else {
      winnerTeam = a <= b ? "A" : "B";
      table.winnerId = (winnerTeam === "A" ? table.teamA : table.teamB)[0];
    }
    table.winnerTeam = winnerTeam;
    table.roundPoints = winnerTeam === "A" ? b : a;
    if (match) {
      match.teams[winnerTeam].roundsWon += 1;
      match.teams[winnerTeam].score += table.roundPoints;
      match.lastWinnerId = table.winnerId;
      match.roundsCompleted += 1;
    }
    return table;
  }
  if (table.winReason !== "emptied") {
    let best = null;
    let winner = ids[0];
    ids.forEach((id) => {
      const pips = domino.handScore(table.hands[id] || []);
      if (best == null || pips < best) {
        best = pips;
        winner = id;
      }
    });
    table.winnerId = winner;
  }
  let points = 0;
  ids.forEach((id) => {
    if (id !== table.winnerId) points += domino.handScore(table.hands[id] || []);
  });
  table.roundPoints = points;
  table.winnerTeam = null;
  if (match) {
    if (!match.players[table.winnerId]) match.players[table.winnerId] = { roundsWon: 0, score: 0 };
    match.players[table.winnerId].roundsWon += 1;
    match.players[table.winnerId].score += points;
    match.lastWinnerId = table.winnerId;
    match.roundsCompleted += 1;
  }
  return table;
}

function emptyStats() {
  return {
    decisions: 0,
    ms: 0,
    illegal: 0,
    missedWins: 0,
    passes: 0,
    avoidablePasses: 0,
    draws: 0
  };
}

function playTable(table, strategies, seed, stats, config) {
  const rng = mulberry32(seed || 1);
  const map = {};
  table.order.forEach((id, index) => {
    map[id] = Array.isArray(strategies) ? strategies[index] : strategies[id];
  });
  let guard = 0;
  while (!table.over && guard++ < 400) {
    stepTable(table, map, rng, stats, config);
    const books = account(table);
    if (books.unique !== books.count) {
      table.over = true;
      table.winReason = "corrupt";
      break;
    }
  }
  if (!table.over) {
    table.over = true;
    table.winReason = "blocked";
  }
  return table;
}

function playMatch(options) {
  const seats = options.seats;
  const order = seats.map((name, index) => "p" + index);
  const strategies = {};
  order.forEach((id, index) => {
    strategies[id] = seats[index];
  });
  const teamMode = options.teamMode !== false && order.length === 4;
  const match = freshMatch(order);
  const stats = emptyStats();
  const rounds = [];
  const total = options.rounds || 1;
  for (let round = 0; round < total; round++) {
    const dealRng = mulberry32(hashString(String(options.seed) + ":" + round));
    const table = startRound(order, match, dealRng, teamMode);
    playTable(table, strategies, hashString(String(options.seed) + ":play:" + round), stats, {
      seed: options.seed,
      aiLimits: options.aiLimits
    });
    scoreStanding(table, match);
    rounds.push({
      winnerId: table.winnerId,
      winnerTeam: table.winnerTeam,
      winReason: table.winReason,
      roundPoints: table.roundPoints,
      accounted: account(table)
    });
  }
  return { match: match, stats: stats, rounds: rounds, order: order };
}

function focusResult(played, team) {
  const ours = played.match.teams[team];
  const theirs = played.match.teams[team === "A" ? "B" : "A"];
  const outcome = ours.score > theirs.score ? 1 : ours.score < theirs.score ? 0 : 0.5;
  let roundWins = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let blocks = 0;
  let blocksWon = 0;
  let goOuts = 0;
  let oppGoOuts = 0;
  played.rounds.forEach((round) => {
    const won = round.winnerTeam === team;
    if (won) roundWins += 1;
    if (won) pointsFor += round.roundPoints;
    else pointsAgainst += round.roundPoints;
    if (round.winReason === "blocked") {
      blocks += 1;
      if (won) blocksWon += 1;
    }
    if (round.winReason === "emptied") {
      if (won) goOuts += 1;
      else oppGoOuts += 1;
    }
  });
  return {
    outcome: outcome,
    roundWins: roundWins,
    rounds: played.rounds.length,
    pointsFor: pointsFor,
    pointsAgainst: pointsAgainst,
    blocks: blocks,
    blocksWon: blocksWon,
    goOuts: goOuts,
    oppGoOuts: oppGoOuts,
    illegal: played.stats.illegal,
    missedWins: played.stats.missedWins,
    passes: played.stats.passes,
    avoidablePasses: played.stats.avoidablePasses,
    decisions: played.stats.decisions,
    ms: played.stats.ms
  };
}

function aggregate(rows) {
  const n = rows.length || 1;
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const mean = sum("outcome") / n;
  const variance = rows.reduce((total, row) => total + Math.pow(row.outcome - mean, 2), 0) / Math.max(1, n - 1);
  const wins = rows.filter((row) => row.outcome === 1).length;
  const draws = rows.filter((row) => row.outcome === 0.5).length;
  const losses = rows.filter((row) => row.outcome === 0).length;
  return {
    matches: rows.length,
    wins: wins,
    draws: draws,
    losses: losses,
    winRate: mean,
    stdError: Math.sqrt(variance / n),
    roundWins: sum("roundWins"),
    rounds: sum("rounds"),
    roundRate: sum("roundWins") / Math.max(1, sum("rounds")),
    pointsFor: sum("pointsFor"),
    pointsAgainst: sum("pointsAgainst"),
    avgPointsFor: sum("pointsFor") / n,
    avgPointsAgainst: sum("pointsAgainst") / n,
    blocks: sum("blocks"),
    blocksWon: sum("blocksWon"),
    blockWinRate: sum("blocks") ? sum("blocksWon") / sum("blocks") : null,
    goOuts: sum("goOuts"),
    oppGoOuts: sum("oppGoOuts"),
    illegal: sum("illegal"),
    missedWins: sum("missedWins"),
    passes: sum("passes"),
    avoidablePasses: sum("avoidablePasses"),
    decisions: sum("decisions"),
    meanDecisionMs: sum("decisions") ? sum("ms") / sum("decisions") : 0
  };
}

function compare(options) {
  const rows = [];
  const matches = options.matches || 12;
  const rounds = options.rounds || 4;
  for (let i = 0; i < matches; i++) {
    const seed = (options.seed + i * 104729) >>> 0;
    const left = options.left;
    const right = options.right;
    const forward = playMatch({
      seats: [left[0], right[0], left[1], right[1]],
      rounds: rounds,
      seed: seed,
      aiLimits: options.aiLimits
    });
    const swapped = playMatch({
      seats: [right[0], left[0], right[1], left[1]],
      rounds: rounds,
      seed: seed,
      aiLimits: options.aiLimits
    });
    rows.push(focusResult(forward, "A"));
    rows.push(focusResult(swapped, "B"));
  }
  return aggregate(rows);
}

function round3(value) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

function formatReport(report) {
  const lines = [];
  report.forEach((row) => {
    lines.push(
      row.name +
      "  matches " + row.result.matches +
      "  win " + round3(row.result.winRate) + " ± " + round3(row.result.stdError) +
      "  (W" + row.result.wins + " D" + row.result.draws + " L" + row.result.losses + ")" +
      "  rounds " + round3(row.result.roundRate) +
      "  pts " + Math.round(row.result.avgPointsFor) + "/" + Math.round(row.result.avgPointsAgainst) +
      "  blockWin " + round3(row.result.blockWinRate) +
      "  goOut " + row.result.goOuts + "/" + (row.result.goOuts + row.result.oppGoOuts) +
      "  illegal " + row.result.illegal +
      "  missedWins " + row.result.missedWins +
      "  avoidablePasses " + row.result.avoidablePasses +
      "  ms " + round3(row.result.meanDecisionMs)
    );
  });
  return lines.join("\n");
}

function runBench(options) {
  const matches = options.matches || 16;
  const rounds = options.rounds || 4;
  const seed = options.seed || 20261015;
  const aiLimits = options.aiLimits || { samples: 4, maxMs: 12, maxPlies: 18, maxNodes: 1800 };
  const jobs = [
    { name: "heuristic vs random", left: ["heuristic", "heuristic"], right: ["random", "random"] },
    { name: "heuristic vs greedy", left: ["heuristic", "heuristic"], right: ["greedy", "greedy"] },
    { name: "heuristic vs legacy", left: ["heuristic", "heuristic"], right: ["legacy", "legacy"] },
    { name: "ai vs legacy", left: ["ai", "ai"], right: ["legacy", "legacy"] },
    { name: "ai vs heuristic", left: ["ai", "ai"], right: ["heuristic", "heuristic"] },
    { name: "no-passes vs heuristic", left: ["no-passes", "no-passes"], right: ["heuristic", "heuristic"] },
    { name: "no-team vs heuristic", left: ["no-team", "no-team"], right: ["heuristic", "heuristic"] },
    { name: "heuristic+human vs legacy", left: ["heuristic", "human"], right: ["legacy", "legacy"] },
    { name: "heuristic+legacy vs legacy", left: ["heuristic", "legacy"], right: ["legacy", "legacy"] }
  ];
  return jobs.map((job) => ({
    name: job.name,
    result: compare({
      left: job.left,
      right: job.right,
      matches: matches,
      rounds: rounds,
      seed: seed,
      aiLimits: aiLimits
    })
  }));
}

if (require.main === module) {
  const matches = Number(process.env.DOMINO_BENCH_MATCHES || 16);
  const rounds = Number(process.env.DOMINO_BENCH_ROUNDS || 4);
  const report = runBench({ matches: matches, rounds: rounds, seed: 20261015 });
  console.log(formatReport(report));
}

module.exports = {
  makeTable,
  startRound,
  publicView,
  account,
  playTable,
  playMatch,
  scoreStanding,
  compare,
  runBench,
  formatReport,
  freshMatch
};
