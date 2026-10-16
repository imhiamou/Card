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

if (require.main === module) {
  const matches = Number(process.env.DOMINO_BENCH_MATCHES || 8);
  const rounds = Number(process.env.DOMINO_BENCH_ROUNDS || 3);
  console.log(sim.formatReport(partnershipJobs({
    matches: matches,
    rounds: rounds,
    seed: 20261015
  })));
}

module.exports = {
  partnershipJobs
};
