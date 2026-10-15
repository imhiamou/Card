"use strict";

/* Lazy require so this package can load while server/domino.js is still starting. */
function api() {
  return require("../../domino");
}

function cloneTile(tile) {
  return { id: tile.id, a: tile.a, b: tile.b };
}

function pips(tile) {
  return tile.a + tile.b;
}

function touches(tile, pip) {
  return pip != null && (tile.a === pip || tile.b === pip);
}

function matchesEither(tile, left, right) {
  return touches(tile, left) || touches(tile, right);
}

function violates(tile, voids) {
  if (!voids) return false;
  return voids.has(tile.a) || voids.has(tile.b);
}

module.exports = {
  api,
  cloneTile,
  pips,
  touches,
  matchesEither,
  violates
};
