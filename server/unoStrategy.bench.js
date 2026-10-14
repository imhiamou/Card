/*
 * Seeded UNO benchmark. Not part of the unit-test run.
 *
 *   node server/unoStrategy.bench.js 2000
 *
 * Compares the strategy bot, the frozen baseline scorer, and a random
 * legal mover at every supported player count. Tune seeds start at 1.
 * Validation seeds start at 900001.
 */

const sim = require("./bots/unoSim");

const games = Math.max(2, Number(process.argv[2]) || 200);
const players = (process.argv[3] || "2,3,4,5,6").split(",").map((n) => Number(n));

function printRow(label, row) {
  const pct = (row.winRate * 100).toFixed(1);
  const low = (row.wilson95.low * 100).toFixed(1);
  const high = (row.wilson95.high * 100).toFixed(1);
  const exp = (row.expected * 100).toFixed(1);
  const seats = row.bySeat.map((seat) => (seat.winRate * 100).toFixed(0)).join("/");
  console.log(
    label +
    " p=" + row.players +
    " games=" + row.finished + "/" + row.games +
    " win=" + pct + "% [" + low + ", " + high + "]" +
    " expected=" + exp + "%" +
    " seats=" + seats +
    " turns=" + row.avgTurns.toFixed(1) +
    " loserCards=" + row.avgLoserCards.toFixed(1) +
    " illegal=" + row.illegal +
    " stalled=" + row.stalled +
    " ms=" + row.latencyMean.toFixed(3) +
    " p95=" + row.latencyP95.toFixed(3)
  );
}

function runSet(seedStart, title) {
  console.log("\n" + title + " seed=" + seedStart + " games/config≈" + games);
  players.forEach((count) => {
    printRow("new vs baseline", sim.compare({
      players: count,
      games,
      seedStart,
      focal: sim.strategyNew,
      field: sim.strategyBaseline
    }));
    printRow("baseline vs new", sim.compare({
      players: count,
      games,
      seedStart,
      focal: sim.strategyBaseline,
      field: sim.strategyNew
    }));
    printRow("new vs random", sim.compare({
      players: count,
      games: Math.max(count, Math.floor(games / 4)),
      seedStart: seedStart + 500000,
      focal: sim.strategyNew,
      field: sim.strategyRandom
    }));
    printRow("baseline vs random", sim.compare({
      players: count,
      games: Math.max(count, Math.floor(games / 4)),
      seedStart: seedStart + 500000,
      focal: sim.strategyBaseline,
      field: sim.strategyRandom
    }));
  });
}

runSet(1, "tune");
runSet(900001, "validation");
