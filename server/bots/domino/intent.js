"use strict";

const { api, matchesEither, touches, violates } = require("./engine");
const { unseenTiles } = require("./sample");
const { buildInventory } = require("./inventory");

/*
 * Teammate intention is separate from "they once played this number."
 * A play that was likely their only legal tile gets almost no signal.
 * A repeated choice, when another tile could have fit, is the signal.
 * This uses the public log and the bot's own hand. It never sees another
 * player's tiles.
 */

function atLeastOne(pool, matches, handCount) {
  if (handCount <= 0 || matches <= 0 || pool <= 0) return 0;
  if (pool < handCount) return matches > 0 ? 1 : 0;
  if (pool - matches < handCount) return 1;
  let none = 1;
  for (let i = 0; i < handCount; i++) {
    none *= (pool - matches - i) / (pool - i);
  }
  const chance = 1 - none;
  if (chance < 0) return 0;
  if (chance > 1) return 1;
  return chance;
}

function atLeastTwo(pool, matches, handCount) {
  if (handCount < 2 || matches < 2 || pool < 2) return 0;
  const none = 1 - atLeastOne(pool, matches, handCount);
  let exactlyOne = 0;
  if (pool - matches >= handCount - 1 && matches >= 1) {
    let ways = matches / pool;
    for (let i = 0; i < handCount - 1; i++) {
      ways *= (pool - matches - i) / (pool - 1 - i);
    }
    exactlyOne = ways * handCount;
  }
  const chance = 1 - none - exactlyOne;
  if (chance < 0) return 0;
  if (chance > 1) return 1;
  return chance;
}

function blankPip() {
  return {
    expectedTiles: 0,
    pAtLeastOne: 0,
    pMultiple: 0,
    deliberate: 0,
    forced: 0,
    maintained: 0,
    changedAway: 0,
    matched: 0,
    exposedPlays: 0,
    inTile: 0,
    bridged: 0,
    continued: 0,
    absent: 0,
    missed: 0,
    strategic: 0,
    confidence: 0,
    last: ""
  };
}

function emptyIntention() {
  const byPip = [];
  for (let pip = 0; pip <= 6; pip++) byPip.push(blankPip());
  return {
    byPip: byPip,
    preferred: null,
    confidence: 0,
    lastMoveForced: false,
    lastMoveForceChance: null,
    drawsSeen: false
  };
}

function hardSet(belief) {
  if (!belief) return new Set();
  if (belief._hard) return belief._hard;
  return new Set(belief.knownImpossibleNumbers || []);
}

function voidsBefore(log, playerId, index) {
  const voids = new Set();
  for (let i = 0; i < index; i++) {
    const event = log[i];
    if (!event || event.playerId !== playerId) continue;
    if (event.type === "draw") voids.clear();
    if (event.type === "pass") {
      [event.leftEnd, event.rightEnd].forEach((pip) => {
        if (pip != null) voids.add(pip);
      });
    }
  }
  return voids;
}

function coveredPip(tile, exposed) {
  if (!tile || exposed == null) return null;
  if (tile.a === tile.b) return exposed;
  if (tile.a === exposed) return tile.b;
  if (tile.b === exposed) return tile.a;
  return null;
}

function inferBefore(event) {
  if (!event || !event.tile) return null;
  if (event.leftEndBefore != null && event.rightEndBefore != null) {
    return { left: event.leftEndBefore, right: event.rightEndBefore };
  }
  if (event.side === "left" && event.leftEnd != null) {
    return { left: coveredPip(event.tile, event.leftEnd), right: event.rightEnd };
  }
  if (event.side === "right" && event.rightEnd != null) {
    return { left: event.leftEnd, right: coveredPip(event.tile, event.rightEnd) };
  }
  return null;
}

function botTilesThen(view, index) {
  const ids = new Set((view.hand || []).map((tile) => tile.id));
  const log = view.log || [];
  for (let i = index; i < log.length; i++) {
    const event = log[i];
    if (event && event.type === "play" && event.playerId === view.selfId && event.tile) ids.add(event.tile.id);
  }
  return ids;
}

function unseenThen(view, index, botIds) {
  const gone = new Set(botIds);
  const logged = new Set();
  const log = view.log || [];
  log.forEach((event) => {
    if (event && event.type === "play" && event.tile) logged.add(event.tile.id);
  });
  // Tiles already on the board but missing from the log were played before
  // this window. Tiles logged later were still unseen at this index.
  (view.chain || []).forEach((tile) => {
    if (tile && tile.id != null && !logged.has(tile.id)) gone.add(tile.id);
  });
  for (let i = 0; i < index; i++) {
    const event = log[i];
    if (event && event.type === "play" && event.tile) gone.add(event.tile.id);
  }
  return api().buildDoubleSixSet().filter((tile) => !gone.has(tile.id));
}

function handSizeThen(view, playerId, index) {
  const player = (view.players || []).find((seat) => seat.id === playerId);
  const now = player ? player.handCount || 0 : 0;
  let later = 0;
  const log = view.log || [];
  for (let i = index; i < log.length; i++) {
    const event = log[i];
    if (!event || event.playerId !== playerId) continue;
    if (event.type === "play") later += 1;
    if (event.type === "draw") later -= 1;
  }
  // Reconstruct the hand size immediately after this historical play. A later
  // draw is not a reason to discard every earlier observation.
  return Math.max(0, now + later);
}

function signalWeight(forceChance) {
  // Missing historical board data is not evidence that a choice was deliberate.
  // Valid plays are still scored after draws because forceChance is computed
  // per event rather than disabled globally for the entire round.
  if (forceChance == null) return 0.35;
  if (forceChance >= 0.65) return 0.15;
  if (forceChance <= 0.35) return 1;
  return 0.45;
}

function tilePips(tile) {
  if (!tile) return [];
  if (tile.a === tile.b) return [tile.a];
  return [tile.a, tile.b];
}

function readPlays(view, playerId, row) {
  const log = view.log || [];
  let previous = null;
  log.forEach((event, index) => {
    if (!event || event.playerId !== playerId) return;
    // A draw or pass breaks consecutive-play evidence for this player. A
    // forced play also breaks the sequence below; none should be treated as
    // a deliberate continuation of an earlier tile pattern.
    if (event.type !== "play" || !event.tile) {
      previous = null;
      return;
    }
    const before = inferBefore(event);
    const handSize = handSizeThen(view, playerId, index);
    let forceChance = null;
    let unseen = [];
    let voids = new Set();
    if (before && handSize != null && handSize > 0) {
      const botIds = botTilesThen(view, index);
      unseen = unseenThen(view, index, botIds).filter((tile) => tile.id !== event.tile.id);
      voids = voidsBefore(log, playerId, index);
      const alternatives = unseen.filter((tile) => matchesEither(tile, before.left, before.right) && !violates(tile, voids));
      forceChance = 1 - atLeastOne(unseen.length, alternatives.length, Math.max(0, handSize - 1));
    }
    const weight = signalWeight(forceChance);
    const matched = before ? (event.side === "left" ? before.left : before.right) : null;
    const exposed = event.side === "left" ? event.leftEnd : event.side === "right" ? event.rightEnd : null;
    const otherEnd = before ? (event.side === "left" ? before.right : before.left) : null;
    if (matched != null) row.byPip[matched].matched += 1;
    if (exposed != null) row.byPip[exposed].exposedPlays += 1;
    const pips = tilePips(event.tile);
    // A tile that matches an end always contains that end. Sharing that pip
    // with the previous chosen tile is the pattern. The new open end is only
    // the other half of the tile unless they keep choosing it.
    const spending = !!(previous && matched != null && tilePips(previous).indexOf(matched) >= 0 && exposed !== matched);
    if (weight >= 0.45) {
      pips.forEach((pip) => {
        row.byPip[pip].inTile += weight;
      });
      if (previous) {
        const prev = tilePips(previous);
        pips.forEach((pip) => {
          if (prev.indexOf(pip) >= 0) row.byPip[pip].bridged += weight;
        });
        prev.forEach((pip) => {
          if (pips.indexOf(pip) < 0) {
            row.byPip[pip].absent += weight;
            row.byPip[pip].last = "absent";
          }
        });
      }
      if (exposed != null && spending) {
        row.byPip[exposed].deliberate += weight * 0.4;
        row.byPip[matched].continued += weight;
        row.byPip[matched].changedAway += weight * 0.5;
        if (row.byPip[matched].last !== "absent") row.byPip[matched].last = "continued";
      } else if (exposed != null) {
        row.byPip[exposed].deliberate += weight;
        row.byPip[exposed].last = "deliberate";
      }
      if (!spending && before && matched != null && exposed != null && exposed !== matched) {
        row.byPip[matched].changedAway += weight;
        row.byPip[matched].last = "changed";
      }
      if (before && exposed != null && ((event.side === "right" && exposed === before.right) || (event.side === "left" && exposed === before.left))) {
        row.byPip[exposed].maintained += weight;
        row.byPip[exposed].last = "maintained";
      }
      previous = event.tile;
    } else {
      if (exposed != null) {
        row.byPip[exposed].forced += 1;
        row.byPip[exposed].last = "forced";
      }
      previous = null;
    }
    if (otherEnd != null && !touches(event.tile, otherEnd) && unseen.length && handSize != null) {
      const otherChoices = unseen.filter((tile) => touches(tile, otherEnd) && !violates(tile, voids));
      const chance = atLeastOne(unseen.length, otherChoices.length, Math.max(0, handSize - 1));
      if (chance <= 0.4) row.byPip[otherEnd].missed += 1 - chance;
    }
    row.lastMoveForceChance = forceChance;
    row.lastMoveForced = forceChance != null && forceChance >= 0.65;
  });
}

function choosePreferred(byPip) {
  let preferred = null;
  byPip.forEach((pipRow, pip) => {
    if (preferred == null || pipRow.confidence > byPip[preferred].confidence) {
      if (pipRow.confidence >= 0.45) preferred = pip;
    }
  });
  return preferred;
}

function fillCounts(view, beliefs, playerId, row, inventory) {
  const belief = beliefs[playerId];
  const voids = hardSet(belief);
  const player = (view.players || []).find((seat) => seat.id === playerId);
  const handCount = player ? player.handCount || 0 : 0;
  const unseen = unseenTiles(view).filter((tile) => !violates(tile, voids));
  for (let pip = 0; pip <= 6; pip++) {
    const pipRow = row.byPip[pip];
    const unseenPip = inventory.byPip[pip].unseen;
    if (voids.has(pip) || handCount <= 0) {
      pipRow.expectedTiles = 0;
      pipRow.pAtLeastOne = 0;
      pipRow.pMultiple = 0;
    } else {
      let capacity = handCount + (view.boneyardCount || 0);
      (view.players || []).forEach((seat) => {
        if (!seat || seat.id === view.selfId || seat.id === playerId || !(seat.handCount > 0)) return;
        if (!hardSet(beliefs[seat.id]).has(pip)) capacity += seat.handCount;
      });
      pipRow.expectedTiles = capacity > 0 ? unseenPip * (handCount / capacity) : 0;
      const matches = unseen.filter((tile) => tile.a === pip || tile.b === pip).length;
      pipRow.pAtLeastOne = atLeastOne(unseen.length, matches, handCount);
      pipRow.pMultiple = atLeastTwo(unseen.length, matches, handCount);
    }
    // The useful number is the pip that keeps showing up inside the tiles
    // they choose. Matching the board end, or leaving the other half open
    // once, is not that number. A later tile that no longer contains it
    // cuts the earlier reading.
    const support = pipRow.inTile + pipRow.bridged + pipRow.continued;
    let net = pipRow.inTile + pipRow.bridged * 0.8 + pipRow.continued * 0.6 +
      pipRow.deliberate * 0.45 + pipRow.maintained * 0.35 -
      pipRow.absent * 1.15 - pipRow.changedAway * 0.8 - pipRow.missed * 0.5;
    if (pipRow.last === "absent" || pipRow.last === "changed") net *= 0.4;
    pipRow.strategic = Math.round(net * 100) / 100;
    const cannotHold = pipRow.pAtLeastOne < 0.12 && pipRow.missed >= 0.6;
    pipRow.confidence = support >= 1.5 && net >= 1.5 && !cannotHold
      ? Math.max(0, Math.min(1, net / 4))
      : 0;
  }
  const preferred = choosePreferred(row.byPip);
  row.preferred = preferred;
  row.confidence = preferred == null ? 0 : row.byPip[preferred].confidence;
}

function behaviorProfile(intention) {
  const rows = intention && intention.byPip || [];
  const total = (key) => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
  const deliberate = total("deliberate");
  const forced = total("forced");
  const changedAway = total("changedAway");
  const observed = deliberate + forced;
  const preferred = intention && intention.preferred != null ? rows[intention.preferred] : null;
  const persistence = preferred
    ? (preferred.inTile + preferred.bridged + preferred.continued + preferred.maintained)
    : 0;
  let style = "insufficient-evidence";
  if (observed >= 2 && forced / observed >= 0.6) style = "mostly-forced";
  else if (intention && intention.confidence >= 0.45 && persistence >= 1.5 &&
      persistence >= changedAway * 1.25) style = "consistent-number-control";
  else if (observed >= 3 && changedAway >= deliberate * 0.6) style = "flexible-or-changing";
  else if (observed >= 2) style = "mixed";
  return {
    style: style,
    weightedPlaySignal: Math.round(observed * 100) / 100,
    deliberateSignal: Math.round(deliberate * 100) / 100,
    forcedSignal: Math.round(forced * 100) / 100,
    persistence: Math.round(persistence * 100) / 100,
    changesAway: Math.round(changedAway * 100) / 100
  };
}

function predictNextMove(view, intention, playerId) {
  const player = (view.players || []).find((seat) => seat.id === playerId);
  const handCount = player ? Math.max(0, player.handCount || 0) : 0;
  const left = view.leftEnd;
  const right = view.rightEnd;
  if (!player || handCount <= 0 || left == null || right == null) {
    return { likelyEnd: null, confidence: 0, leftProbability: 0, rightProbability: 0, basis: "unavailable" };
  }
  const rows = intention && intention.byPip || [];
  const leftAvailability = rows[left] ? Math.max(0, Math.min(1, rows[left].pAtLeastOne || 0)) : 0;
  const rightAvailability = rows[right] ? Math.max(0, Math.min(1, rows[right].pAtLeastOne || 0)) : 0;
  if (left === right) {
    const hasEvidence = leftAvailability > 0;
    return {
      likelyEnd: hasEvidence ? left : null,
      confidence: 0,
      leftProbability: 0.5,
      rightProbability: 0.5,
      baselineLeftProbability: 0.5,
      baselineRightProbability: 0.5,
      basis: hasEvidence ? "same-open-number" : "no-public-evidence",
      interpretation: "heuristic-score-share-not-calibrated"
    };
  }
  const scoreFor = (pip) => {
    if (pip == null || !rows[pip] || rows[pip].pAtLeastOne <= 0) return 0;
    const row = rows[pip];
    const preferenceBoost = intention && intention.preferred === pip
      ? 1 + Math.max(0, Math.min(1, intention.confidence)) * 1.25
      : 1 + Math.max(0, Math.min(1, row.confidence || 0)) * 0.25;
    return Math.max(0, Math.min(1, row.pAtLeastOne)) * preferenceBoost;
  };
  const rightAvailability = rows[right] ? Math.max(0, Math.min(1, rows[right].pAtLeastOne || 0)) : 0;
  const baselineTotal = leftAvailability + rightAvailability;
  const baselineLeftProbability = baselineTotal > 0 ? leftAvailability / baselineTotal : 0;
  const baselineRightProbability = baselineTotal > 0 ? rightAvailability / baselineTotal : 0;
  const leftScore = scoreFor(left);
  const rightScore = right === left ? 0 : scoreFor(right);
  const total = leftScore + rightScore;
  if (total <= 0) {
    return {
      likelyEnd: null, confidence: 0, leftProbability: 0, rightProbability: 0,
      baselineLeftProbability: 0.5, baselineRightProbability: 0.5, basis: "no-public-evidence",
      interpretation: "heuristic-score-share-not-calibrated"
    };
  }
  const leftProbability = leftScore / total;
  const rightProbability = rightScore / total;
  const likelyEnd = leftProbability === rightProbability ? null : leftProbability > rightProbability ? left : right;
  return {
    likelyEnd: likelyEnd,
    confidence: Math.round(Math.abs(leftProbability - rightProbability) * 100) / 100,
    leftProbability: Math.round(leftProbability * 100) / 100,
    rightProbability: Math.round(rightProbability * 100) / 100,
    baselineLeftProbability: Math.round(baselineLeftProbability * 100) / 100,
    baselineRightProbability: Math.round(baselineRightProbability * 100) / 100,
    basis: intention && intention.preferred != null ? "tile-availability-plus-behavior" : "tile-availability",
    interpretation: "heuristic-score-share-not-calibrated"
  };
}

function annotateIntentions(view, beliefs) {
  const inventory = buildInventory(view || {});
  const drew = (view.log || []).some((event) => event && event.type === "draw");
  Object.keys(beliefs || {}).forEach((id) => {
    const row = emptyIntention();
    row.drawsSeen = drew;
    if (id !== view.selfId) readPlays(view, id, row);
    fillCounts(view, beliefs, id, row, inventory);
    row.behavior = behaviorProfile(row);
    row.nextMovePrediction = id === view.selfId ? null : predictNextMove(view, row, id);
    beliefs[id].intention = row;
  });
  inventory.byPip.forEach((pipRow) => {
    pipRow.holders = [];
  });
  (view.players || []).forEach((player) => {
    if (!player || player.id === view.selfId) return;
    const intention = beliefs[player.id] && beliefs[player.id].intention;
    const voids = hardSet(beliefs[player.id]);
    for (let pip = 0; pip <= 6; pip++) {
      const info = intention && intention.byPip[pip];
      inventory.byPip[pip].holders.push({
        id: player.id,
        expected: info ? info.expectedTiles : 0,
        pAtLeastOne: info ? info.pAtLeastOne : 0,
        void: voids.has(pip)
      });
    }
  });
  beliefs._inventory = inventory;
  return beliefs;
}

function publicIntention(intention) {
  if (!intention) return null;
  return {
    preferred: intention.preferred,
    confidence: intention.confidence,
    lastMoveForced: !!intention.lastMoveForced,
    lastMoveForceChance: intention.lastMoveForceChance,
    drawsSeen: !!intention.drawsSeen,
    behavior: intention.behavior ? Object.assign({}, intention.behavior) : null,
    nextMovePrediction: intention.nextMovePrediction ? Object.assign({}, intention.nextMovePrediction) : null,
    byPip: (intention.byPip || []).map((row) => ({
      expectedTiles: Math.round(row.expectedTiles * 100) / 100,
      pAtLeastOne: Math.round(row.pAtLeastOne * 100) / 100,
      pMultiple: Math.round(row.pMultiple * 100) / 100,
      deliberate: Math.round(row.deliberate * 100) / 100,
      forced: row.forced,
      maintained: Math.round(row.maintained * 100) / 100,
      changedAway: Math.round(row.changedAway * 100) / 100,
      matched: row.matched,
      exposedPlays: row.exposedPlays,
      inTile: Math.round(row.inTile * 100) / 100,
      bridged: Math.round(row.bridged * 100) / 100,
      continued: Math.round(row.continued * 100) / 100,
      absent: Math.round(row.absent * 100) / 100,
      missed: Math.round(row.missed * 100) / 100,
      strategic: row.strategic,
      confidence: Math.round(row.confidence * 100) / 100,
      last: row.last
    }))
  };
}

module.exports = {
  annotateIntentions,
  publicIntention,
  atLeastOne,
  choosePreferred,
  behaviorProfile,
  predictNextMove
};
