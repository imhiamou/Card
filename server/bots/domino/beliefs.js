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

function openingCounts(view) {
  const counts = {};
  (view.players || []).forEach((player) => {
    let plays = 0;
    let draws = 0;
    (view.log || []).forEach((event) => {
      if (!event || event.playerId !== player.id) return;
      if (event.type === "play") plays += 1;
      if (event.type === "draw") draws += 1;
    });
    counts[player.id] = (player.handCount || 0) + plays - draws;
  });
  return counts;
}

function buildBeliefs(view, options) {
  const ignorePasses = !!(options && options.ignorePasses);
  const players = {};
  const running = openingCounts(view || {});
  (view.players || []).forEach((player) => {
    players[player.id] = {
      hard: new Set(),
      weak: {},
      support: [0, 0, 0, 0, 0, 0, 0],
      passHistory: [],
      contradictions: [],
      recent: [],
      handCount: player.handCount || 0
    };
  });

  (view.log || []).forEach((event, index) => {
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
      running[event.playerId] = (running[event.playerId] || 0) + 1;
      return;
    }
    if (event.type === "pass") {
      const ends = [];
      [event.leftEnd, event.rightEnd].forEach((pip) => {
        if (pip == null || ends.indexOf(pip) >= 0) return;
        ends.push(pip);
      });
      const pass = {
        ends: ends.slice(),
        invalidated: false,
        index: index,
        handCount: running[event.playerId] || 0
      };
      belief.passHistory.push(pass);
      if (!ignorePasses) ends.forEach((pip) => belief.hard.add(pip));
      belief.recent.push({ type: "pass", ends: ends.slice() });
      return;
    }
    if (event.type === "play" && event.tile) {
      const tile = event.tile;

      // The server records legalAlternatives as the number of other legal
      // placements available before this play. Zero means this was the
      // player's only legal move. Once that tile leaves their hand, neither
      // pre-play open end can remain in their hand: if another tile matched
      // either end, it would have been another legal move. Treat this as a
      // hard, public-information void, just like a pass with an empty boneyard.
      // A later draw clears these hard voids in the draw handler above.
      if (event.legalAlternatives === 0) {
        const beforeLeft = event.boardLeftBefore != null
          ? event.boardLeftBefore : event.leftEndBefore;
        const beforeRight = event.boardRightBefore != null
          ? event.boardRightBefore : event.rightEndBefore;
        [beforeLeft, beforeRight].forEach((pip) => {
          if (pip != null) belief.hard.add(pip);
        });
      }

      belief.support[tile.a] += 1;
      if (tile.b !== tile.a) belief.support[tile.b] += 1;
      const exposed = exposedPip(event);
      if (exposed != null) belief.support[exposed] += 0.5;
      [tile.a, tile.b].forEach((pip) => {
        if (!belief.hard.has(pip)) return;
        // A play contradicting a no-draw pass is inconsistent history. Do not
        // silently erase the historical constraint; record the conflict and
        // let constrained sampling fall back safely if no allocation remains.
        belief.contradictions.push({ pip: pip, tileId: tile.id, index: index });
      });
      belief.recent.push({ type: "play", tileId: tile.id });
      running[event.playerId] = Math.max(0, (running[event.playerId] || 0) - 1);
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
        invalidated: !!pass.invalidated,
        index: pass.index,
        handCount: pass.handCount
      })),
      contradictions: raw.contradictions.map((item) => ({
        pip: item.pip,
        tileId: item.tileId,
        index: item.index
      })),
      remainingTileCount: raw.handCount,
      recent: recent,
      _hard: raw.hard
    };
  });
  if (!(options && options.ignoreIntent)) {
    try {
      require("./intent").annotateIntentions(view, out);
    } catch (err) {
      /* A belief failure must not stop the bot from playing a legal tile. */
    }
  }
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
