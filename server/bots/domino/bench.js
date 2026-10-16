"use strict";

const sim = require("../dominoSim");

/*
 * Headless partnership matches. Every strategy sees only the public view
 * the live bot receives. Search stays off unless a job asks for samples.
 */

function partnershipJobs(options) {
  const quiet = options.aiLimits || { samples: 0, maxMs: 0, maxPlies: 8, maxNodes: 200 };
  const jobs = [
    ["heuristic vs baseline", ["heuristic", "heuristic"], ["baseline", "baseline"]],
    ["heuristic vs greedy", ["heuristic", "heuristic"], ["greedy", "greedy"]],
    ["heuristic vs passes", ["heuristic", "heuristic"], ["passes", "passes"]],
    ["heuristic vs follow", ["heuristic", "heuristic"], ["follow", "follow"]],
    ["heuristic vs legacy", ["heuristic", "heuristic"], ["legacy", "legacy"]],
    ["heuristic+human vs baseline+human", ["heuristic", "human"], ["baseline", "human"]],
    ["no-intent vs heuristic", ["no-intent", "no-intent"], ["heuristic", "heuristic"]],
    ["no-passes vs heuristic", ["no-passes", "no-passes"], ["heuristic", "heuristic"]],
    ["heuristic vs heuristic", ["heuristic", "heuristic"], ["heuristic", "heuristic"]]
  ];
  return jobs.map((job) => ({
    name: job[0],
    result: sim.compare({
      left: job[1],
      right: job[2],
      matches: options.matches || 8,
      rounds: options.rounds || 3,
      seed: options.seed || 20261015,
      aiLimits: quiet
    })
  }));
}

function predictiveJobs(options) {
  const limits = options.aiLimits || { samples: 4, maxMs: 16, maxPlies: 8, maxNodes: 1600 };
  const jobs = [
    ["predict vs heuristic", ["predict", "predict"], ["heuristic", "heuristic"]],
    ["predict vs greedy", ["predict", "predict"], ["greedy", "greedy"]],
    ["predict vs passes", ["predict", "predict"], ["passes", "passes"]],
    ["predict vs follow", ["predict", "predict"], ["follow", "follow"]],
    ["no-future vs predict", ["no-future", "no-future"], ["predict", "predict"]],
    ["predict-no-intent vs predict", ["predict-no-intent", "predict-no-intent"], ["predict", "predict"]],
    ["predict-no-sample vs predict", ["predict-no-sample", "predict-no-sample"], ["predict", "predict"]]
  ];
  return jobs.map((job) => ({
    name: job[0],
    result: sim.compare({
      left: job[1],
      right: job[2],
      matches: options.matches || 8,
      rounds: options.rounds || 3,
      seed: options.seed || 20261016,
      aiLimits: limits
    })
  }));
}

/*
 * Ask the predictive bot for the board it expects, then play the true
 * hidden hands with the same imperfect-information policy and compare.
 */
function predictionProbe(options) {
  const { getDominoMove } = require("./ai");
  const { forecastLine } = require("./search");
  const { buildBeliefs } = require("./beliefs");
  const { mergeWeights } = require("./weights");
  const { mulberry32 } = require("./sample");
  const deals = options.deals || 12;
  let endsHit = 0;
  let endsSeen = 0;
  let passHit = 0;
  let passSeen = 0;
  let playHit = 0;
  let playSeen = 0;
  let ms = 0;
  let decisions = 0;
  for (let i = 0; i < deals; i++) {
    const match = sim.freshMatch(["p0", "p1", "p2", "p3"]);
    const table = sim.startRound(["p0", "p1", "p2", "p3"], match, mulberry32(9000 + i), true);
    sim.playTable(table, ["greedy", "greedy", "greedy", "greedy"], 50 + i, null, { maxSteps: 8 });
    if (table.over) continue;
    const actor = table.order[table.turn];
    const view = sim.publicView(table, actor);
    if (!view.validMoves.length) continue;
    const started = Date.now();
    const move = getDominoMove(view, {
      explain: true,
      seed: 1000 + i,
      limits: { samples: 4, maxMs: 0, maxNodes: 2000 }
    });
    ms += Date.now() - started;
    decisions += 1;
    const pred = move.diagnostics && move.diagnostics.nextTurn;
    const allocation = { boneyard: table.boneyard.map((item) => ({ id: item.id, a: item.a, b: item.b })) };
    table.order.forEach((id) => {
      if (id === actor) return;
      allocation[id] = table.hands[id].map((item) => ({ id: item.id, a: item.a, b: item.b }));
    });
    const truth = forecastLine(
      view,
      { tileId: move.tileId, side: move.side },
      allocation,
      buildBeliefs(view),
      mergeWeights(),
      {},
      mulberry32(3)
    );
    const row = (move.diagnostics.candidateEvaluations || []).find((item) => item.tileId === move.tileId && item.side === move.side);
    const forecast = row && row.prediction;
    if (truth.returned && forecast && forecast.modalEnds) {
      endsSeen += 1;
      if (forecast.modalEnds.left === truth.returned.left && forecast.modalEnds.right === truth.returned.right) endsHit += 1;
    }
    const mateIndex = (view.players || []).findIndex((player) => player.team && player.team === (view.players.find((seat) => seat.id === actor) || {}).team && player.id !== actor);
    const mate = mateIndex >= 0 ? view.players[mateIndex] : null;
    const trueMate = mate && (truth.steps || []).find((step) => step.playerId === mate.id);
    if (trueMate && forecast) {
      if (trueMate.type === "pass") {
        passSeen += 1;
        if (forecast.pTeammatePass >= 0.5) passHit += 1;
      } else {
        playSeen += 1;
        if (forecast.pTeammatePlay >= 0.5) playHit += 1;
      }
    }
    if (pred && pred.available === false) endsSeen += 0;
  }
  return {
    decisions: decisions,
    meanDecisionMs: decisions ? ms / decisions : 0,
    endAccuracy: endsSeen ? endsHit / endsSeen : null,
    endsSeen: endsSeen,
    passAccuracy: passSeen ? passHit / passSeen : null,
    passSeen: passSeen,
    playAccuracy: playSeen ? playHit / playSeen : null,
    playSeen: playSeen
  };
}

function strategyJobs(options) {
  const { clearPlans, planStats } = require("./plan");
  const quiet = options.aiLimits || { samples: 0, maxMs: 0, maxPlies: 8, maxNodes: 200 };
  const jobs = [
    ["heuristic vs no-plan", ["heuristic", "heuristic"], ["no-plan", "no-plan"]],
    ["heuristic vs baseline", ["heuristic", "heuristic"], ["baseline", "baseline"]],
    ["heuristic vs greedy", ["heuristic", "heuristic"], ["greedy", "greedy"]],
    ["heuristic vs passes", ["heuristic", "heuristic"], ["passes", "passes"]],
    ["heuristic vs follow", ["heuristic", "heuristic"], ["follow", "follow"]]
  ];
  return jobs.map((job) => {
    clearPlans();
    const result = sim.compare({
      left: job[1],
      right: job[2],
      matches: options.matches || 8,
      rounds: options.rounds || 3,
      seed: options.seed || 20261016,
      aiLimits: quiet
    });
    const plans = planStats();
    const decisions = plans.decisions || 1;
    return {
      name: job[0],
      result: result,
      plans: plans,
      planSwitchRate: plans.switched / decisions,
      planHoldRate: plans.held / decisions
    };
  });
}

if (require.main === module && process.env.DOMINO_BENCH_PLAN === "1") {
  const matches = Number(process.env.DOMINO_BENCH_MATCHES || 8);
  const rounds = Number(process.env.DOMINO_BENCH_ROUNDS || 3);
  const seeds = String(process.env.DOMINO_BENCH_SEEDS || "42,99,20261016").split(",").map((item) => Number(item));
  seeds.forEach((seed) => {
    console.log("seed " + seed);
    const report = strategyJobs({ matches: matches, rounds: rounds, seed: seed });
    console.log(sim.formatReport(report));
    report.forEach((row) => {
      console.log(row.name + " plan " + JSON.stringify({
        decisions: row.plans.decisions,
        started: row.plans.started,
        held: row.plans.held,
        switched: row.plans.switched,
        none: row.plans.none,
        switchRate: Math.round(row.planSwitchRate * 1000) / 1000,
        holdRate: Math.round(row.planHoldRate * 1000) / 1000
      }));
    });
  });
} else if (require.main === module) {
  const matches = Number(process.env.DOMINO_BENCH_MATCHES || 8);
  const rounds = Number(process.env.DOMINO_BENCH_ROUNDS || 3);
  if (process.env.DOMINO_BENCH_PREDICT === "1") {
    console.log(sim.formatReport(predictiveJobs({
      matches: matches,
      rounds: rounds,
      seed: 20261016
    })));
    console.log(JSON.stringify(predictionProbe({ deals: Number(process.env.DOMINO_BENCH_DEALS || 12) })));
  } else {
    console.log(sim.formatReport(partnershipJobs({
      matches: matches,
      rounds: rounds,
      seed: 20261015
    })));
  }
}

module.exports = {
  partnershipJobs,
  predictiveJobs,
  predictionProbe,
  strategyJobs
};
