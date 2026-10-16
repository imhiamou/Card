"use strict";

const { api } = require("./engine");
const { unseenTiles } = require("./sample");

/*
 * Double-six inventory. Each number 0-6 sits on exactly seven tiles.
 * A double is one of those tiles, not two.
 * Four players are dealt seven tiles each, so that table has no boneyard.
 * Two-player tables still keep a boneyard; this count does not invent draws.
 */

function tilesWith(tiles, pip) {
  let count = 0;
  (tiles || []).forEach((tile) => {
    if (tile && (tile.a === pip || tile.b === pip)) count += 1;
  });
  return count;
}

function playedTiles(view) {
  const seen = new Set();
  const tiles = [];
  const add = (tile) => {
    if (!tile || tile.id == null || seen.has(tile.id)) return;
    if (typeof tile.id === "string" && tile.id.indexOf("board-") === 0) return;
    if (typeof tile.id === "string" && tile.id.indexOf("plan-") === 0) return;
    seen.add(tile.id);
    tiles.push(tile);
  };
  (view.chain || []).forEach(add);
  (view.log || []).forEach((event) => {
    if (event && event.type === "play") add(event.tile);
  });
  return tiles;
}

function buildInventory(view) {
  const full = api().buildDoubleSixSet();
  const hand = view && view.hand ? view.hand : [];
  const played = playedTiles(view || {});
  const unseen = unseenTiles(view || {});
  const byPip = [];
  for (let pip = 0; pip <= 6; pip++) {
    byPip.push({
      pip: pip,
      total: tilesWith(full, pip),
      inHand: tilesWith(hand, pip),
      played: tilesWith(played, pip),
      unseen: tilesWith(unseen, pip)
    });
  }
  const seats = (view && view.players ? view.players : []).reduce((sum, player) => {
    if (!player || player.id === view.selfId) return sum + hand.length;
    return sum + (player.handCount || 0);
  }, 0);
  return {
    byPip: byPip,
    unseenCount: unseen.length,
    boneyardCount: view && view.boneyardCount ? view.boneyardCount : 0,
    allDealt: (view && view.boneyardCount ? view.boneyardCount : 0) === 0 &&
      seats + played.length === full.length
  };
}

module.exports = {
  tilesWith,
  buildInventory
};
