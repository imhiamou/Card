/*
 * Game mode registry — add a new game by creating a module under
 * server/games/<id>/ and registering it here.
 */
const hiddenHunt = require("./games/hidden-hunt");
const wordChain = require("./games/word-chain");

const GAME_MODES = {
  [hiddenHunt.id]: hiddenHunt,
  [wordChain.id]: wordChain
};

function getGameMode(id) {
  return GAME_MODES[id] || null;
}

function listGameModes() {
  return Object.values(GAME_MODES).map((g) => ({
    id: g.id,
    name: g.name,
    requiresCharacter: !!g.requiresCharacter
  }));
}

function isValidGameMode(id) {
  return !!GAME_MODES[id];
}

module.exports = { getGameMode, listGameModes, isValidGameMode, GAME_MODES };
