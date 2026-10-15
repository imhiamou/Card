"use strict";

const { violates } = require("./engine");

/*
 * Beliefs are a pure function of the public action log, seat counts, and
 * nothing else. A pass while the boneyard is empty is a hard void for the
 * rest of the round. A later draw (possible only if a caller feeds that
 * history) demotes those voids to a weak suspicion. Playing one tile that
 * contains a number is evidence, not proof that more of that number remain.
 */

function emptyBelief(handCount) {
  return {
    knownImpossibleNumbers: [],
    suspectedWeakNumbers: {},
    suspectedStrongNumbers: {},
    numberSupportScores: [0, 0, 0, 0, 0, 0, 0],
    numberSupportConfidence: [0, 0, 0, 0, 0, 0, 0],
    passHistory: [],
    remainingTileCount: handCount || 0,
    recent: []
  };
}

function exposedPip(event) {
  if (!event || event.type !== "play") return null;
  if (event.side === "left") return event.leftEnd;
  if (event.side === "right") return event.rightEnd;
  return null;
}

function buildBeliefs(view, options) {
  const ignorePasses = !!(options && options.ignorePasses);
  const players = {};
  (view.players || []).forEach((player) => {
    players[player.id] = {
      hard: new Set(),
      weak: {},
      support: [0, 0, 0, 0, 0, 0, 0],
      passHistory: [],
      recent: [],
      handCount: player.handCount || 0
    };
  });

  (view.log || []).forEach((event) => {
    const belief = players[event.playerId];
    if (!belief || !event) return;
    if (event.type === "draw") {
      belief.hard.forEach((pip) => {
        belief.weak[pip] = (belief.weak[pip] || 0) + 1;
      });
      belief.hard = new Set();
      belief.passHistory.forEach((pass) => {
        pass.invalidated = true;
      });
      belief.recent.push({ type: "draw" });
      return;
    }
    if (event.type === "pass") {
      const ends = [];
      [event.leftEnd, event.rightEnd].forEach((pip) => {
        if (pip == null || ends.indexOf(pip) >= 0) return;
        ends.push(pip);
      });
      const pass = { ends: ends.slice(), invalidated: false };
      belief.passHistory.push(pass);
      if (!ignorePasses) ends.forEach((pip) => belief.hard.add(pip));
      belief.recent.push({ type: "pass", ends: ends.slice() });
      return;
    }
    if (event.type === "play" && event.tile) {
      const tile = event.tile;
      belief.support[tile.a] += 1;
      if (tile.b !== tile.a) belief.support[tile.b] += 1;
      const exposed = exposedPip(event);
      if (exposed != null) belief.support[exposed] += 0.5;
      if (belief.hard.has(tile.a)) belief.hard.delete(tile.a);
      if (belief.hard.has(tile.b)) belief.hard.delete(tile.b);
      belief.recent.push({ type: "play", tileId: tile.id });
    }
  });

  const out = {};
  Object.keys(players).forEach((id) => {
    const raw = players[id];
    const total = raw.support.reduce((sum, value) => sum + value, 0);
    const confidence = raw.support.map((value) => (total > 0 ? value / (total + 1) : 0));
    const strong = {};
    const weak = {};
    for (let pip = 0; pip <= 6; pip++) {
      if (raw.weak[pip]) weak[pip] = raw.weak[pip];
      // One tile is a single observation. Strength needs the number to come
      // back a second time, and a hard void always wins over that estimate.
      if (!raw.hard.has(pip) && raw.support[pip] >= 2 && confidence[pip] >= 0.18) {
        strong[pip] = confidence[pip];
      }
    }
    const recent = raw.recent.slice(-6);
    out[id] = {
      knownImpossibleNumbers: Array.from(raw.hard).sort((a, b) => a - b),
      suspectedWeakNumbers: weak,
      suspectedStrongNumbers: strong,
      numberSupportScores: raw.support.slice(),
      numberSupportConfidence: confidence,
      passHistory: raw.passHistory.map((pass) => ({
        ends: pass.ends.slice(),
        invalidated: !!pass.invalidated
      })),
      remainingTileCount: raw.handCount,
      recent: recent,
      _hard: raw.hard
    };
  });
  return out;
}

function hardVoid(beliefs, playerId) {
  const belief = beliefs && beliefs[playerId];
  if (!belief) return new Set();
  if (belief._hard) return belief._hard;
  return new Set(belief.knownImpossibleNumbers || []);
}

function suitAffinity(beliefs, playerId, left, right) {
  const belief = beliefs && beliefs[playerId];
  if (!belief) return 0;
  const support = belief.numberSupportScores || [];
  const scores = belief.numberSupportConfidence || [];
  let best = 0;
  [left, right].forEach((pip) => {
    if (pip == null || support[pip] < 2) return;
    const value = scores[pip] * Math.min(1, support[pip] / 3);
    if (value > best) best = value;
  });
  return best;
}

function tileAllowed(tile, beliefs, playerId) {
  return !violates(tile, hardVoid(beliefs, playerId));
}

module.exports = {
  emptyBelief,
  buildBeliefs,
  hardVoid,
  suitAffinity,
  tileAllowed
};
