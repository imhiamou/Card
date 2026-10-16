"use strict";

const domino = require("../../domino");

/*
 * Offline review of a finished table. The live decision function does not
 * call this, and it does not change later moves.
 *
 * Counts that look at tiles still in a hand are hindsight. An opponent
 * holding a matching tile does not, by itself, make the earlier move wrong.
 */

function cloneTile(tile) {
  return { id: tile.id, a: tile.a, b: tile.b };
}

function handBefore(table, playerId, index) {
  const tiles = (table.hands[playerId] || []).map(cloneTile);
  const log = table.log || [];
  for (let i = log.length - 1; i >= index; i--) {
    const event = log[i];
    if (!event || event.playerId !== playerId) continue;
    if (event.type === "draw") return null;
    if (event.type === "play" && event.tile) tiles.push(cloneTile(event.tile));
  }
  return tiles;
}

function nextSeat(table, playerId) {
  const index = (table.order || []).indexOf(playerId);
  if (index < 0) return null;
  return table.order[(index + 1) % table.order.length];
}

function teammateId(table, playerId) {
  if (!table.teamMode) return null;
  const teams = [table.teamA || [], table.teamB || []];
  for (let t = 0; t < teams.length; t++) {
    if (teams[t].indexOf(playerId) < 0) continue;
    for (let i = 0; i < teams[t].length; i++) {
      if (teams[t][i] !== playerId) return teams[t][i];
    }
  }
  return null;
}

function exposedPip(event) {
  if (!event || event.type !== "play") return null;
  if (event.side === "left") return event.leftEnd;
  if (event.side === "right") return event.rightEnd;
  return null;
}

function leavesPip(event, pip) {
  return pip != null && (event.leftEnd === pip || event.rightEnd === pip);
}

function reviewTable(table) {
  const log = table && table.log ? table.log : [];
  const drew = log.some((event) => event && event.type === "draw");
  let gaveFinish = 0;
  let preserveAttempts = 0;
  let preserveHits = 0;
  let hindsightForced = 0;
  let forcedThenKept = 0;
  log.forEach((event, index) => {
    if (!event || event.type !== "play" || !event.tile) return;
    const nextId = nextSeat(table, event.playerId);
    const reply = log.slice(index + 1).find((item) => item && item.playerId === nextId && (item.type === "play" || item.type === "pass"));
    if (reply && reply.type === "play" && !drew) {
      const held = handBefore(table, nextId, log.indexOf(reply));
      if (held && held.length === 1) gaveFinish += 1;
    }
    const mateId = teammateId(table, event.playerId);
    const pip = exposedPip(event);
    if (!drew && event.leftEndBefore != null && event.rightEndBefore != null) {
      const held = handBefore(table, event.playerId, index);
      const playedBefore = log.slice(0, index).filter((item) => item && item.type === "play").length;
      if (held && playedBefore > 0) {
        const legal = domino.listValidMoves(held, event.leftEndBefore, event.rightEndBefore, playedBefore, null);
        const choices = new Set(legal.map((move) => move.tileId));
        if (choices.size <= 1) {
          hindsightForced += 1;
          const kept = log.slice(index + 1).find((item) => item && item.type === "play" && item.playerId === mateId);
          if (kept && leavesPip(kept, pip)) forcedThenKept += 1;
        }
      }
    }
    if (!mateId || drew) return;
    const earlier = log.slice(0, index).filter((item) => item && item.type === "play" && item.playerId === mateId);
    const shown = earlier.slice(-2).map(exposedPip);
    if (shown.length < 2 || shown[0] == null || shown[0] !== shown[1]) return;
    if (!leavesPip(event, shown[1])) return;
    preserveAttempts += 1;
    const later = log.slice(index + 1).find((item) => item && item.type === "play" && item.playerId === mateId);
    if (later && later.tile && (later.tile.a === shown[1] || later.tile.b === shown[1])) preserveHits += 1;
  });
  return {
    hindsight: true,
    draws: drew,
    gaveFinish: gaveFinish,
    preserveAttempts: preserveAttempts,
    preserveHits: preserveHits,
    hindsightForced: hindsightForced,
    forcedThenKept: forcedThenKept
  };
}

module.exports = {
  reviewTable,
  handBefore
};
