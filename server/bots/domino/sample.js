"use strict";

const { api, cloneTile, violates } = require("./engine");
const { hardVoid } = require("./beliefs");

function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}

function unseenTiles(view) {
  const gone = new Set();
  (view.hand || []).forEach((tile) => gone.add(tile.id));
  (view.chain || []).forEach((tile) => gone.add(tile.id));
  (view.log || []).forEach((event) => {
    if (event && event.type === "play" && event.tile) gone.add(event.tile.id);
  });
  return api().buildDoubleSixSet().filter((tile) => !gone.has(tile.id));
}

function groupsFor(view, beliefs, options) {
  const ignoreHands = !!(options && options.ignoreHands);
  const groups = [];
  (view.players || []).forEach((player) => {
    if (player.id === view.selfId) return;
    groups.push({
      id: player.id,
      count: player.handCount || 0,
      voids: ignoreHands ? new Set() : hardVoid(beliefs, player.id)
    });
  });
  groups.push({
    id: "boneyard",
    count: view.boneyardCount || 0,
    voids: new Set()
  });
  return groups;
}

function diagnose(unseen, groups) {
  const notes = [];
  const need = groups.reduce((sum, group) => sum + group.count, 0);
  if (need !== unseen.length) {
    notes.push("counts " + need + " do not match " + unseen.length + " unseen tiles");
  }
  groups.forEach((group) => {
    if (!group.count) return;
    const legal = unseen.filter((tile) => !violates(tile, group.voids)).length;
    if (legal < group.count) {
      notes.push(group.id + " needs " + group.count + " tiles but only " + legal + " satisfy the pass record");
    }
  });
  return notes.join("; ");
}

/*
 * Constrained players pick first. Each attempt shuffles, then takes the
 * first legal tiles. A short player means this shuffle boxed someone in;
 * another shuffle usually frees the scarce tile. If every attempt fails,
 * the caller must not pretend the last partial deal was real.
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Soft evidence for a hidden-hand hypothesis. A player's repeated choices
 * increase the likelihood of holding related suits, but one play alone is
 * weak evidence. Only public-log-derived beliefs are used.
 */
function allocationEvidenceScore(allocation, beliefs, groups) {
  let score = 0;
  groups.forEach((group) => {
    if (group.id === "boneyard") return;
    const belief = beliefs && beliefs[group.id];
    if (!belief) return;
    const support = belief.numberSupportConfidence || [];
    const intention = belief.intention && belief.intention.byPip;
    (allocation[group.id] || []).forEach((tile) => {
      const pips = tile.a === tile.b ? [tile.a] : [tile.a, tile.b];
      pips.forEach((pip) => {
        const supportConfidence = clamp01(support[pip] || 0);
        const intentInfo = intention && intention[pip];
        const intentConfidence = clamp01(intentInfo && intentInfo.confidence || 0);
        // Log-likelihood style terms keep the score additive and bounded.
        score += Math.log(1 + 1.4 * supportConfidence);
        score += Math.log(1 + 0.9 * intentConfidence);
      });
    });
  });
  return score;
}

function sampleAllocation(view, beliefs, rng, options) {
  const unseen = unseenTiles(view);
  const groups = groupsFor(view, beliefs, options).filter((group) => group.count > 0);
  const need = groups.reduce((sum, group) => sum + group.count, 0);
  if (need !== unseen.length) {
    return { allocation: null, conflict: diagnose(unseen, groupsFor(view, beliefs, options)) };
  }
  if (!groups.length) return { allocation: { boneyard: [] }, conflict: "" };

  const ordered = groups.slice().sort((a, b) => b.voids.size - a.voids.size);
  const conflict = diagnose(unseen, ordered);
  if (conflict && /only /.test(conflict)) {
    return { allocation: null, conflict: conflict };
  }

  for (let attempt = 0; attempt < 28; attempt++) {
    const pool = shuffleInPlace(unseen.map(cloneTile), rng);
    const allocation = { boneyard: [] };
    let failed = false;
    for (let g = 0; g < ordered.length; g++) {
      const group = ordered[g];
      const picked = [];
      const keep = [];
      for (let i = 0; i < pool.length; i++) {
        const tile = pool[i];
        if (picked.length < group.count && !violates(tile, group.voids)) picked.push(tile);
        else keep.push(tile);
      }
      if (picked.length !== group.count) {
        failed = true;
        break;
      }
      allocation[group.id] = picked;
      pool.length = 0;
      for (let i = 0; i < keep.length; i++) pool.push(keep[i]);
    }
    if (!failed && pool.length === 0) {
      if (!allocation.boneyard) allocation.boneyard = [];
      return { allocation: allocation, conflict: "" };
    }
  }
  return { allocation: null, conflict: conflict || "no deal satisfied the pass record" };
}

function allocationIds(allocation) {
  const ids = [];
  Object.keys(allocation || {}).forEach((key) => {
    (allocation[key] || []).forEach((tile) => ids.push(tile.id));
  });
  return ids;
}

module.exports = {
  mulberry32,
  hashString,
  unseenTiles,
  sampleAllocation,
  allocationIds,
  diagnose
};
