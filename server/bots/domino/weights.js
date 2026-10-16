"use strict";

/*
 * Partnership evaluation weights.
 *
 * Terminal round results use roundWin / pointScale and sit far above the
 * heuristic terms. Heuristic terms are roughly in the same units so a
 * forced pass or a stuck double can outweigh pip-shedding, and a likely
 * opponent go-out can outweigh both.
 *
 * ownOuts is points per remaining tile that still matches an end.
 * shedPips is the value of playing a 12-pip tile. dumpDouble is the bonus
 * for playing a 6-6; smaller doubles get pip/6 of that. Shedding stays at
 * the previous level because lowering it lost matches to that bot.
 * intentKeep, mateFinish, and the void terms sit on top of that shedding.
 * With shedding unchanged, three seeds of 60 matches were 88 wins,
 * 2 draws, and 90 losses against the previous weights. The same bot
 * beat the older pip bot (37-2-21 over 60) and a bot that copies its
 * teammate's last number (36-0-24 over 60). Two-sample search did not
 * add a measured gain.
 *
 * The future-turn forecast replaces that score only when the samples
 * agree. Three seeds of 8 matches (48 oriented matches, 3 rounds,
 * 4 samples) were 25 wins and 23 losses against this heuristic, with
 * about 28 points scored and 22 conceded per match. Against a greedy
 * bot the same run was 28-20. Against a bot that copies its teammate's
 * last number it was 29-19. On open deals the predicted ends matched
 * the true hidden deal about 4% of the time, which is why a noisy
 * sample does not override the heuristic. These are observations.
 */

const DEFAULT_WEIGHTS = {
  roundWin: 100,
  pointScale: 0.04,
  oppOutScale: 0.95,
  denyNext: 0.55,
  forcePass: 3.5,
  mateCanReply: 1.2,
  mateSuit: 0.6,
  otherOpp: 0.4,
  ownOuts: 2,
  stuckDoubleRelief: 1.4,
  shedPips: 12,
  dumpDouble: 5,
  blockEquity: 0.9,
  searchScale: 6,
  intentKeep: 5,
  mateVoidHarm: 7,
  mateFinish: 0.85,
  oppVoidExploit: 6,
  oppFeed: 5,
  otherFinish: 0.7,
  /*
   * Used only by the future-turn forecast, never by the immediate heuristic.
   * A sampled win or loss is still roundWin. These terms describe what
   * happened to the teammate on the way back to this seat.
   */
  futureScale: 0.15,
  partnerScale: 0.45,
  partnerPlay: 8,
  partnerKeep: 12,
  partnerAbandon: 10,
  partnerPass: 14,
  partnerDanger: 11,
  /*
   * Small tie-break for the committed plan. It stays under a forced pass,
   * a void, and a winning play, so the plan cannot veto those.
   */
  planFit: 3
};

const DEFAULT_LIMITS = {
  samples: 8,
  maxMs: 18,
  maxPlies: 28,
  maxNodes: 6000,
  varyEpsilon: 0.35
};

function mergeWeights(overrides) {
  return Object.assign({}, DEFAULT_WEIGHTS, overrides || {});
}

function mergeLimits(overrides) {
  const limits = Object.assign({}, DEFAULT_LIMITS);
  if (process.env.DOMINO_AI_SAMPLES != null && process.env.DOMINO_AI_SAMPLES !== "") {
    const samples = Number(process.env.DOMINO_AI_SAMPLES);
    if (Number.isFinite(samples)) limits.samples = samples;
  }
  if (process.env.DOMINO_AI_MS != null && process.env.DOMINO_AI_MS !== "") {
    const maxMs = Number(process.env.DOMINO_AI_MS);
    if (Number.isFinite(maxMs)) limits.maxMs = maxMs;
  }
  const given = overrides || {};
  if (given.samples != null) limits.samples = given.samples;
  if (given.maxMs != null) limits.maxMs = given.maxMs;
  if (given.maxPlies != null) limits.maxPlies = given.maxPlies;
  if (given.maxNodes != null) limits.maxNodes = given.maxNodes;
  if (given.varyEpsilon != null) limits.varyEpsilon = given.varyEpsilon;
  limits.samples = Math.max(0, limits.samples | 0);
  limits.maxMs = Math.max(0, limits.maxMs);
  limits.maxPlies = Math.max(1, limits.maxPlies | 0);
  limits.maxNodes = Math.max(1, limits.maxNodes | 0);
  return limits;
}

module.exports = {
  DEFAULT_WEIGHTS,
  DEFAULT_LIMITS,
  mergeWeights,
  mergeLimits
};
