"use strict";

const { api, cloneTile, pips } = require("./engine");
const { buildBeliefs } = require("./beliefs");
const { sampleAllocation } = require("./sample");
const { rankMoves } = require("./eval");

function teamOf(sim, playerId) {
  if (!sim.teamMode) return null;
  if ((sim.teamA || []).indexOf(playerId) >= 0) return "A";
  if ((sim.teamB || []).indexOf(playerId) >= 0) return "B";
  return null;
}

function handPips(tiles) {
  return (tiles || []).reduce((sum, tile) => sum + pips(tile), 0);
}

function teamPips(sim, team) {
  return (sim.order || []).reduce((sum, id) => {
    if (teamOf(sim, id) !== team) return sum;
    return sum + handPips(sim.hands[id]);
  }, 0);
}

/*
 * Mirrors server scoring: an emptied hand wins the round and scores the
 * opposing side's remaining pips. A block awards the lighter team (Team A
 * on a tie) the other team's pips. Free-for-all uses the lightest seat,
 * with seat order breaking ties.
 */
function terminalValue(sim, selfId, weights) {
  let we = false;
  let points = 0;
  if (sim.winReason === "emptied") {
    if (sim.teamMode) {
      const winnerTeam = teamOf(sim, sim.winnerId);
      const loserTeam = winnerTeam === "A" ? "B" : "A";
      we = teamOf(sim, selfId) === winnerTeam;
      points = teamPips(sim, loserTeam);
    } else {
      we = sim.winnerId === selfId;
      points = (sim.order || []).reduce((sum, id) => {
        if (id === sim.winnerId) return sum;
        return sum + handPips(sim.hands[id]);
      }, 0);
    }
  } else if (sim.winReason === "blocked") {
    if (sim.teamMode) {
      const a = teamPips(sim, "A");
      const b = teamPips(sim, "B");
      const winnerTeam = a <= b ? "A" : "B";
      we = teamOf(sim, selfId) === winnerTeam;
      points = winnerTeam === "A" ? b : a;
    } else {
      let best = null;
      let bestIndex = 0;
      sim.order.forEach((id, index) => {
        const total = handPips(sim.hands[id]);
        if (best == null || total < best) {
          best = total;
          bestIndex = index;
        }
      });
      const winnerId = sim.order[bestIndex];
      we = winnerId === selfId;
      points = (sim.order || []).reduce((sum, id) => {
        if (id === winnerId) return sum;
        return sum + handPips(sim.hands[id]);
      }, 0);
    }
  }
  const signed = we ? 1 : -1;
  return signed * (weights.roundWin + weights.pointScale * points);
}

function viewFromSim(sim, actorId) {
  const players = sim.order.map((id) => ({
    id: id,
    handCount: sim.hands[id].length,
    team: teamOf(sim, id)
  }));
  return {
    selfId: actorId,
    hand: sim.hands[actorId].map(cloneTile),
    validMoves: [],
    leftEnd: sim.leftEnd,
    rightEnd: sim.rightEnd,
    chain: sim.chain.map((tile) => ({ id: tile.id, a: tile.a, b: tile.b })),
    players: players,
    teamMode: !!sim.teamMode,
    teamA: sim.teamA,
    teamB: sim.teamB,
    log: sim.log,
    boneyardCount: sim.boneyard.length,
    mustPlayId: sim.mustPlayId || null
  };
}

function applyPlay(sim, actorId, move) {
  const hand = sim.hands[actorId];
  const index = hand.findIndex((tile) => tile.id === move.tileId);
  if (index < 0) return false;
  const tile = hand[index];
  const leftBefore = sim.leftEnd;
  const rightBefore = sim.rightEnd;
  const placed = api().placeTile(sim, tile, move.side);
  if (!placed) return false;
  hand.splice(index, 1);
  sim.passes = 0;
  sim.log.push({
    type: "play",
    playerId: actorId,
    tile: cloneTile(tile),
    side: move.side,
    leftEndBefore: leftBefore,
    rightEndBefore: rightBefore,
    leftEnd: sim.leftEnd,
    rightEnd: sim.rightEnd
  });
  if (hand.length === 0) {
    sim.over = true;
    sim.winReason = "emptied";
    sim.winnerId = actorId;
    return true;
  }
  sim.turn = (sim.turn + 1) % sim.order.length;
  return true;
}

function stepSim(sim, weights, options) {
  if (sim.over) return;
  const actorId = sim.order[sim.turn];
  let guard = 0;
  while (guard++ < 16) {
    const hand = sim.hands[actorId];
    const moves = api().listValidMoves(hand, sim.leftEnd, sim.rightEnd, sim.chain.length, sim.mustPlayId);
    if (moves.length) {
      const view = viewFromSim(sim, actorId);
      view.validMoves = moves;
      const beliefs = buildBeliefs(view, options);
      const ranked = rankMoves(view, beliefs, weights, options);
      if (!ranked.length || !applyPlay(sim, actorId, ranked[0].move)) {
        sim.over = true;
        sim.winReason = "stuck";
      }
      return;
    }
    if (sim.boneyard.length) {
      hand.push(sim.boneyard.pop());
      sim.log.push({ type: "draw", playerId: actorId });
      continue;
    }
    sim.log.push({
      type: "pass",
      playerId: actorId,
      leftEnd: sim.leftEnd,
      rightEnd: sim.rightEnd
    });
    sim.passes += 1;
    if (sim.passes >= sim.order.length) {
      sim.over = true;
      sim.winReason = "blocked";
      return;
    }
    sim.turn = (sim.turn + 1) % sim.order.length;
    return;
  }
}

function buildSim(view, allocation) {
  const hands = {};
  hands[view.selfId] = (view.hand || []).map(cloneTile);
  (view.players || []).forEach((player) => {
    if (player.id === view.selfId) return;
    hands[player.id] = ((allocation && allocation[player.id]) || []).map(cloneTile);
  });
  const order = (view.players || []).map((player) => player.id);
  return {
    order: order,
    turn: Math.max(0, order.indexOf(view.selfId)),
    hands: hands,
    boneyard: ((allocation && allocation.boneyard) || []).map(cloneTile),
    chain: (view.chain || []).map(cloneTile),
    leftEnd: view.leftEnd,
    rightEnd: view.rightEnd,
    mustPlayId: view.mustPlayId || null,
    log: (view.log || []).map((event) => Object.assign({}, event)),
    passes: 0,
    over: false,
    winReason: null,
    winnerId: null,
    teamMode: !!view.teamMode,
    teamA: view.teamA ? view.teamA.slice() : null,
    teamB: view.teamB ? view.teamB.slice() : null
  };
}

function mateId(view) {
  const { partnerId } = require("./eval");
  return partnerId(view);
}

function preferredPip(view, beliefs) {
  const id = mateId(view);
  const intention = id && beliefs && beliefs[id] && beliefs[id].intention;
  if (!intention || intention.preferred == null || !(intention.confidence >= 0.45)) return null;
  return intention.preferred;
}

function policyOptions(options) {
  const copy = Object.assign({}, options || {});
  delete copy.explain;
  copy.ignoreFuture = true;
  return copy;
}

function chooseActorMove(sim, actorId, weights, options, rng) {
  const hand = sim.hands[actorId] || [];
  const moves = api().listValidMoves(hand, sim.leftEnd, sim.rightEnd, sim.chain.length, sim.mustPlayId);
  if (!moves.length) return null;
  if (moves.length === 1) return { move: moves[0], forced: true };
  const policy = (options && options.opponentPolicy) || "interest";
  if (policy === "first") return { move: moves[0], forced: false };
  if (policy === "random") {
    return { move: moves[Math.floor(rng() * moves.length)], forced: false };
  }
  const view = viewFromSim(sim, actorId);
  view.validMoves = moves;
  const beliefs = buildBeliefs(view, policyOptions(options));
  const ranked = rankMoves(view, beliefs, weights, policyOptions(options));
  if (!ranked.length || !ranked[0].move) return { move: moves[0], forced: false };
  return { move: ranked[0].move, forced: false };
}

function hasPip(left, right, pip) {
  return pip != null && (left === pip || right === pip);
}

function recordPass(sim, actorId) {
  sim.log.push({
    type: "pass",
    playerId: actorId,
    leftEnd: sim.leftEnd,
    rightEnd: sim.rightEnd
  });
  sim.passes += 1;
  if (sim.passes >= sim.order.length) {
    sim.over = true;
    sim.winReason = "blocked";
    return;
  }
  sim.turn = (sim.turn + 1) % sim.order.length;
}

function drawOne(sim, actorId) {
  const hand = sim.hands[actorId];
  hand.push(sim.boneyard.pop());
  sim.log.push({ type: "draw", playerId: actorId });
}

/*
 * One hidden deal, from this move until this seat is reached again.
 * Actors see their own hand and the public log. They do not see the
 * deal's other hands, and they do not know which line the bot hoped for.
 * The returned steps name ends and seats, not another player's tile id.
 */
function forecastLine(view, move, allocation, beliefs, weights, options, rng) {
  const sim = buildSim(view, allocation);
  sim.selfId = view.selfId;
  const mate = mateId(view);
  const preferred = (options && options.ignoreIntent) ? null : preferredPip(view, beliefs);
  const partner = {
    played: false,
    passed: false,
    maintained: false,
    abandoned: false,
    forcedAbandon: false,
    preferredRemoved: false,
    survived: false,
    finished: false,
    reached: false
  };
  const steps = [];
  if (!applyPlay(sim, view.selfId, move)) {
    return {
      ok: false,
      ended: true,
      endedBeforeReturn: true,
      value: 0,
      partner: partner,
      steps: steps,
      returned: null,
      bot: { canPlay: false, canFinish: false, score: 0 },
      dangerous: false
    };
  }
  const selfId = view.selfId;
  let guard = 0;
  let dangerous = false;
  let oppFinished = false;
  const plyCap = Math.max(1, (options && options.forecastPlies) || 8);
  while (!sim.over && sim.order[sim.turn] !== selfId && steps.length < plyCap && guard++ < 24) {
    const actorId = sim.order[sim.turn];
    const beforeLeft = sim.leftEnd;
    const beforeRight = sim.rightEnd;
    let acted = false;
    let draws = 0;
    while (!acted && draws < 12 && !sim.over) {
      const choice = chooseActorMove(sim, actorId, weights, options, rng);
      if (choice) {
        if (!applyPlay(sim, actorId, choice.move)) {
          sim.over = true;
          sim.winReason = "stuck";
          break;
        }
        const exposed = choice.move.side === "left" ? sim.leftEnd : choice.move.side === "right" ? sim.rightEnd : null;
        const opponent = actorId !== mate && actorId !== selfId;
        if (opponent && preferred != null && hasPip(beforeLeft, beforeRight, preferred) && !hasPip(sim.leftEnd, sim.rightEnd, preferred)) {
          partner.preferredRemoved = true;
          dangerous = true;
        }
        if (opponent && sim.over && sim.winnerId === actorId) {
          oppFinished = true;
          dangerous = true;
        }
        if (actorId === mate) {
          partner.reached = true;
          partner.played = true;
          if (sim.over && sim.winnerId === mate) partner.finished = true;
          if (preferred != null && hasPip(sim.leftEnd, sim.rightEnd, preferred)) partner.maintained = true;
          else if (preferred != null) partner.abandoned = true;
          if (preferred != null && hasPip(sim.leftEnd, sim.rightEnd, preferred)) partner.survived = true;
        }
        steps.push({
          playerId: actorId,
          type: "play",
          side: choice.move.side,
          exposed: exposed,
          left: sim.leftEnd,
          right: sim.rightEnd,
          forced: !!choice.forced
        });
        acted = true;
      } else if (sim.boneyard.length && sim.chain.length) {
        drawOne(sim, actorId);
        draws += 1;
      } else {
        const preferredThere = hasPip(beforeLeft, beforeRight, preferred);
        recordPass(sim, actorId);
        if (actorId === mate) {
          partner.reached = true;
          partner.passed = true;
          if (preferred != null && !preferredThere) partner.forcedAbandon = true;
          if (preferred != null && preferredThere) partner.survived = true;
        }
        steps.push({
          playerId: actorId,
          type: "pass",
          side: null,
          exposed: null,
          left: beforeLeft,
          right: beforeRight,
          forced: true
        });
        acted = true;
      }
    }
  }
  const endedBeforeReturn = !!sim.over;
  const returned = endedBeforeReturn ? null : { left: sim.leftEnd, right: sim.rightEnd };
  if (preferred != null && returned && hasPip(returned.left, returned.right, preferred)) partner.survived = true;
  let bot = { canPlay: false, canFinish: false, score: 0 };
  if (!sim.over && sim.order[sim.turn] === selfId) {
    const moves = api().listValidMoves(sim.hands[selfId], sim.leftEnd, sim.rightEnd, sim.chain.length, sim.mustPlayId);
    bot.canPlay = moves.length > 0;
    if (!moves.length && !sim.boneyard.length) {
      recordPass(sim, selfId);
    } else if (moves.length) {
      const nextView = viewFromSim(sim, selfId);
      nextView.validMoves = moves;
      const nextBeliefs = buildBeliefs(nextView, policyOptions(options));
      const ranked = rankMoves(nextView, nextBeliefs, weights, policyOptions(options));
      const best = ranked[0];
      bot.score = best ? best.score : 0;
      if ((sim.hands[selfId] || []).length === 1 && best) {
        applyPlay(sim, selfId, best.move);
        bot.canFinish = !!(sim.over && sim.winnerId === selfId);
      }
    }
  }
  let partnerScore = 0;
  partnerScore += (weights.partnerPlay || 0) * (partner.played ? 1 : 0);
  partnerScore += (weights.partnerKeep || 0) * (partner.maintained ? 1 : 0);
  partnerScore -= (weights.partnerAbandon || 0) * (partner.abandoned ? 1 : 0);
  partnerScore -= (weights.partnerPass || 0) * (partner.passed ? 1 : 0);
  partnerScore -= (weights.partnerDanger || 0) * ((partner.forcedAbandon || partner.preferredRemoved) ? 1 : 0);
  // The returned position is scored with the same move evaluation the bot
  // uses for a single turn. Partnership events shift that future. A round
  // that actually ends uses the scored result instead.
  const partnerScale = weights.partnerScale == null ? 0.45 : weights.partnerScale;
  let value;
  if (sim.over) value = terminalValue(sim, selfId, weights);
  else value = bot.score + partnerScore * partnerScale;
  if (oppFinished && !sim.over) value = terminalValue(sim, selfId, weights);
  return {
    ok: true,
    ended: !!sim.over,
    endedBeforeReturn: endedBeforeReturn,
    winReason: sim.winReason,
    winnerId: sim.winnerId,
    value: value,
    partnerScore: partnerScore,
    partner: partner,
    steps: steps,
    returned: returned,
    bot: bot,
    dangerous: dangerous || partner.forcedAbandon || oppFinished,
    preferred: preferred
  };
}

function emptyForecast() {
  return {
    n: 0,
    total: 0,
    partnerTotal: 0,
    ended: 0,
    endedBefore: 0,
    matePlayed: 0,
    matePassed: 0,
    maintained: 0,
    abandoned: 0,
    forcedAbandon: 0,
    removed: 0,
    survived: 0,
    mateFinished: 0,
    botPlay: 0,
    botFinish: 0,
    dangerous: 0,
    ends: {},
    actions: {}
  };
}

function rememberForecast(bucket, outcome) {
  bucket.n += 1;
  bucket.total += outcome.value;
  bucket.partnerTotal += outcome.partnerScore || 0;
  if (outcome.ended) bucket.ended += 1;
  if (outcome.endedBeforeReturn) bucket.endedBefore += 1;
  const partner = outcome.partner || {};
  if (partner.played) bucket.matePlayed += 1;
  if (partner.passed) bucket.matePassed += 1;
  if (partner.maintained) bucket.maintained += 1;
  if (partner.abandoned) bucket.abandoned += 1;
  if (partner.forcedAbandon) bucket.forcedAbandon += 1;
  if (partner.preferredRemoved) bucket.removed += 1;
  if (partner.survived) bucket.survived += 1;
  if (partner.finished) bucket.mateFinished += 1;
  if (outcome.bot && outcome.bot.canPlay) bucket.botPlay += 1;
  if (outcome.bot && outcome.bot.canFinish) bucket.botFinish += 1;
  if (outcome.dangerous) bucket.dangerous += 1;
  if (outcome.returned) {
    const key = outcome.returned.left + ":" + outcome.returned.right;
    bucket.ends[key] = (bucket.ends[key] || 0) + 1;
  }
  (outcome.steps || []).forEach((step, index) => {
    const key = [
      index,
      step.playerId,
      step.type,
      step.side || "",
      step.exposed == null ? "" : step.exposed,
      step.left,
      step.right,
      step.forced ? "1" : "0"
    ].join("|");
    bucket.actions[key] = (bucket.actions[key] || 0) + 1;
  });
}

function rate(count, total) {
  if (!total) return 0;
  return count / total;
}

function modalEnds(bucket) {
  let best = null;
  let bestN = 0;
  Object.keys(bucket.ends).forEach((key) => {
    const n = bucket.ends[key];
    if (n > bestN) {
      bestN = n;
      best = key;
    }
  });
  if (!best) return null;
  const parts = best.split(":");
  return { left: Number(parts[0]), right: Number(parts[1]), n: bestN };
}

function modalActions(bucket) {
  const bySeat = {};
  Object.keys(bucket.actions).forEach((key) => {
    const parts = key.split("|");
    const index = parts[0];
    const row = {
      index: Number(index),
      playerId: parts[1],
      type: parts[2],
      side: parts[3] || null,
      exposed: parts[4] === "" ? null : Number(parts[4]),
      left: Number(parts[5]),
      right: Number(parts[6]),
      forced: parts[7] === "1",
      n: bucket.actions[key]
    };
    const prev = bySeat[index];
    if (!prev || row.n > prev.n) bySeat[index] = row;
  });
  return Object.keys(bySeat).map((key) => bySeat[key]).sort((a, b) => a.index - b.index);
}

function forecastTrusted(forecast) {
  if (!forecast || !forecast.samples) return false;
  const agree = forecast.modalEnds && forecast.modalEnds.n / forecast.samples >= 0.75;
  const sharp = [
    forecast.pRoundEnds,
    forecast.pForcedAbandon,
    forecast.pBotFinishNext,
    forecast.pTeammateFinish,
    forecast.pPreferredRemoved
  ].some((rate) => rate >= 0.75);
  return !!(agree || sharp);
}

function publicForecast(bucket) {
  const n = bucket.n;
  return {
    samples: n,
    mean: n ? bucket.total / n : 0,
    partnerContinuation: n ? bucket.partnerTotal / n : 0,
    pTeammatePlay: rate(bucket.matePlayed, n),
    pTeammatePass: rate(bucket.matePassed, n),
    pMaintain: rate(bucket.maintained, n),
    pAbandon: rate(bucket.abandoned, n),
    pForcedAbandon: rate(bucket.forcedAbandon, n),
    pPreferredRemoved: rate(bucket.removed, n),
    pPreferredSurvives: rate(bucket.survived, n),
    pTeammateFinish: rate(bucket.mateFinished, n),
    pOpponentDanger: rate(bucket.dangerous, n),
    pBotUseful: rate(bucket.botPlay, n),
    pBotFinishNext: rate(bucket.botFinish, n),
    pRoundEnds: rate(bucket.endedBefore, n),
    modalEnds: modalEnds(bucket),
    actions: modalActions(bucket),
    counts: {
      matePlayed: bucket.matePlayed,
      matePassed: bucket.matePassed,
      maintained: bucket.maintained,
      abandoned: bucket.abandoned,
      forcedAbandon: bucket.forcedAbandon,
      removed: bucket.removed,
      survived: bucket.survived,
      mateFinished: bucket.mateFinished,
      botPlay: bucket.botPlay,
      botFinish: bucket.botFinish,
      dangerous: bucket.dangerous,
      endedBefore: bucket.endedBefore,
      ended: bucket.ended
    }
  };
}

function playout(view, move, allocation, weights, options, limits) {
  const sim = buildSim(view, allocation);
  if (!applyPlay(sim, view.selfId, move)) return { value: 0, nodes: 1 };
  let plies = 0;
  const cap = limits.maxPlies || 28;
  while (!sim.over && plies < cap) {
    stepSim(sim, weights, options);
    plies += 1;
  }
  return {
    value: sim.over ? terminalValue(sim, view.selfId, weights) : 0,
    nodes: plies + 1
  };
}

function searchMoves(view, beliefs, ranked, weights, options, rng, limits) {
  const started = Date.now();
  if (options && (options.ignoreFuture || options.ignoreSamples)) {
    return {
      ranked: ranked,
      samples: 0,
      conflicts: 0,
      conflict: "",
      nodes: 0,
      ms: 0,
      interrupted: false,
      forecast: false
    };
  }
  const buckets = ranked.map(() => emptyForecast());
  const wins = ranked.map(() => 0);
  let used = 0;
  let nodes = 0;
  let conflicts = 0;
  let conflictNote = "";
  const target = limits.samples;
  const nodeCap = limits.maxNodes || 6000;
  for (let sample = 0; sample < target; sample++) {
    if (used > 0 && limits.maxMs > 0 && Date.now() - started > limits.maxMs) break;
    if (used > 0 && nodes >= nodeCap) break;
    const dealt = sampleAllocation(view, beliefs, rng, options);
    if (!dealt.allocation) {
      conflicts += 1;
      conflictNote = dealt.conflict || conflictNote;
      continue;
    }
    let sampleNodes = 0;
    for (let i = 0; i < ranked.length; i++) {
      if (used > 0 && limits.maxMs > 0 && Date.now() - started > limits.maxMs) break;
      const outcome = forecastLine(view, ranked[i].move, dealt.allocation, beliefs, weights, options, rng);
      rememberForecast(buckets[i], outcome);
      sampleNodes += 1 + (outcome.steps ? outcome.steps.length : 0);
      if (outcome.value > 0) wins[i] += 1;
    }
    nodes += sampleNodes;
    used += 1;
  }
  const elapsed = Date.now() - started;
  if (!used || buckets.every((bucket) => bucket.n === 0)) {
    return {
      ranked: ranked,
      samples: 0,
      conflicts: conflicts,
      conflict: conflictNote,
      nodes: nodes,
      ms: elapsed,
      interrupted: target > 0,
      forecast: false
    };
  }
  const blended = ranked.map((row, index) => {
    const forecast = publicForecast(buckets[index]);
    const trusted = forecastTrusted(forecast);
    forecast.trusted = trusted;
    return {
      move: row.move,
      index: row.index,
      prior: row.score,
      parts: row.parts || null,
      // A noisy sample is not a reason to abandon a legal evaluation.
      // A future that keeps showing up is.
      score: forecast.samples && trusted ? forecast.mean : row.score,
      mean: forecast.mean,
      wins: wins[index],
      samplesUsed: forecast.samples,
      prediction: forecast
    };
  });
  blended.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ranked: blended,
    samples: used,
    conflicts: conflicts,
    conflict: conflictNote,
    nodes: nodes,
    ms: elapsed,
    interrupted: used < target || blended.some((row) => row.samplesUsed !== used),
    forecast: true
  };
}

module.exports = {
  terminalValue,
  searchMoves,
  forecastLine,
  publicForecast
};
