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
 * for playing a 6-6; smaller doubles get pip/6 of that. These were raised
 * after an early bench lost to the previous pip-and-follow-up bot.
 * A later headless run of the searching bot won 89 of 144 matches against
 * that bot (three seeds). That is evidence for this set, not an optimum.
 */

const DEFAULT_WEIGHTS = {
  roundWin: 100,
  pointScale: 0.04,
  oppOutScale: 0.95,
  denyNext: 0.55,
  forcePass: 3.5,
  mateCanReply: 1.2,
  mateSuit: 1.1,
  otherOpp: 0.4,
  ownOuts: 2,
  stuckDoubleRelief: 1.4,
  shedPips: 12,
  dumpDouble: 5,
  blockEquity: 0.9,
  searchScale: 6
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
