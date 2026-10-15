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
  const totals = ranked.map(() => 0);
  const counts = ranked.map(() => 0);
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
    const dealt = sampleAllocation(view, beliefs, rng);
    if (!dealt.allocation) {
      conflicts += 1;
      conflictNote = dealt.conflict || conflictNote;
      continue;
    }
    const sampleValues = [];
    let sampleNodes = 0;
    for (let i = 0; i < ranked.length; i++) {
      const outcome = playout(view, ranked[i].move, dealt.allocation, weights, options, limits);
      sampleValues.push(outcome.value);
      sampleNodes += outcome.nodes;
    }
    nodes += sampleNodes;
    used += 1;
    for (let i = 0; i < ranked.length; i++) {
      totals[i] += sampleValues[i];
      counts[i] += 1;
      if (sampleValues[i] > 0) wins[i] += 1;
    }
  }
  const elapsed = Date.now() - started;
  if (!used || counts.every((count) => count === 0)) {
    return {
      ranked: ranked,
      samples: 0,
      conflicts: conflicts,
      conflict: conflictNote,
      nodes: nodes,
      ms: elapsed
    };
  }
  const trust = Math.min(1.25, Math.sqrt(used / 8));
  const scale = weights.searchScale == null ? 12 : weights.searchScale;
  const unit = weights.roundWin || 100;
  const blended = ranked.map((row, index) => {
    const mean = counts[index] ? totals[index] / counts[index] : 0;
    return {
      move: row.move,
      index: row.index,
      prior: row.score,
      parts: row.parts || null,
      score: row.score + scale * trust * (mean / unit),
      mean: mean,
      wins: wins[index],
      samplesUsed: counts[index]
    };
  });
  blended.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ranked: blended,
    samples: used,
    conflicts: conflicts,
    conflict: conflictNote,
    nodes: nodes,
    ms: elapsed
  };
}

module.exports = {
  terminalValue,
  searchMoves
};
