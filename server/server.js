const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const wordchain = require("./wordchain");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Simple health-check route so Render can verify the service is alive.
app.get("/", (req, res) => {
  res.send("Hidden Duel server is running.");
});

const BOARD_SIZE = 8;
const MAX_PLAYERS = 2;
const MAX_HAND_SIZE = 5;
const STARTING_HAND_SIZE = 3;

// The only selectable characters. Anything else is rejected.
const CHARACTERS = ["Knight", "Mage", "Hunter", "Rogue"];

// Display names are typed by the player: 2-16 letters/numbers/spaces/-/_
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,15}$/;

// Lobby codes are chosen by the creator: 4-8 letters/numbers only.
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,8}$/;

function normalizePlayerName(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ");
}

function isValidPlayerName(name) {
  return NAME_PATTERN.test(name);
}

/* ============================================================
   MODULAR CARD SYSTEM
   ============================================================
   The server is the ONLY source of cards; clients never generate
   cards locally and only render what the server tells them.

   Adding a new card requires nothing but a new entry in
   CARD_DEFINITIONS. Each definition provides:

     name           display name
     category       Scanning | Movement | Attack | Special
     copies         how many copies go into each player's deck
     validateTarget optional (ctx) => error string | null
     resolve        (ctx) => outcome object

   The resolve context (ctx) contains:
     room, game, playerId, opponent (player object),
     myPosition, opponentPosition, target (raw client payload)

   The outcome object may contain:
     public   info EVERY player may see (broadcast via "actionPlayed",
              e.g. which row was scanned, which tile was attacked).
              Movement cards return {} here: the opponent only learns
              that a movement card was played, never the destination.
     private  info ONLY the acting player may see (sent via
              "cardResult", e.g. the YES/NO answer of a scan or the
              player's own new position).
     winner   playerId when the card ended the game (Attack hit).
     drawOne  true when the player immediately draws a replacement
              card (Rest).

   The generic "playCard" pipeline below handles everything else:
   validation, discard, hand updates, game over and turn passing.
   No card ever needs to touch that pipeline.
*/

function inBounds(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) &&
    row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

// Manhattan distance between two squares (movement validation).
function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// Build an NxN square of tiles centred as near as possible on `center`
// (clipped to the board). Odd sizes sit on the tile; even sizes bias
// toward top-left of the four near-centre tiles.
function squareAround(center, size) {
  const half = Math.floor((size - 1) / 2);
  const top = Math.max(0, Math.min(BOARD_SIZE - size, center.row - half));
  const left = Math.max(0, Math.min(BOARD_SIZE - size, center.col - half));
  const cells = [];
  for (let r = top; r < top + size; r++) {
    for (let c = left; c < left + size; c++) cells.push({ row: r, col: c });
  }
  return { top, left, size, cells };
}

const CARD_DEFINITIONS = {

  /* ---------------- Scanning cards ---------------- */

  // Scan Row: pick a row, learn ONLY whether the opponent is in it.
  // A Mage's mirror image counts as the opponent here.
  scanRow: {
    name: "Scan Row", category: "Scanning", copies: 3,
    validateTarget: ({ target }) => inBounds(target.row, 0) ? null : "Invalid row.",
    resolve: (ctx) => ({
      public: { row: ctx.target.row },
      private: { answer: scanFinds(ctx, (b) => b.row === ctx.target.row) ? "YES" : "NO" }
    })
  },

  // Scan Column: pick a column, learn ONLY whether the opponent is in it.
  // A Mage's mirror image counts as the opponent here.
  scanColumn: {
    name: "Scan Column", category: "Scanning", copies: 3,
    validateTarget: ({ target }) => inBounds(0, target.col) ? null : "Invalid column.",
    resolve: (ctx) => ({
      public: { col: ctx.target.col },
      private: { answer: scanFinds(ctx, (b) => b.col === ctx.target.col) ? "YES" : "NO" }
    })
  },

  // Scan Area: pick one tile; learn ONLY whether the opponent is on
  // that tile or any of the 8 tiles around it (a 3x3 area, clipped at
  // the board edges). A Mage's mirror image counts as the opponent here.
  scanArea: {
    name: "Scan Area", category: "Scanning", copies: 2,
    validateTarget: ({ target }) => inBounds(target.row, target.col) ? null : "Invalid tile.",
    resolve: (ctx) => ({
      public: { row: ctx.target.row, col: ctx.target.col },
      private: {
        answer: scanFinds(ctx, (b) =>
          Math.abs(b.row - ctx.target.row) <= 1 &&
          Math.abs(b.col - ctx.target.col) <= 1) ? "YES" : "NO"
      }
    })
  },

  // Scan Cross: pick one tile; learn ONLY whether the opponent is
  // somewhere in that tile's row OR column. A Mage's mirror image
  // counts as the opponent here.
  scanCross: {
    name: "Scan Cross", category: "Scanning", copies: 2,
    validateTarget: ({ target }) => inBounds(target.row, target.col) ? null : "Invalid tile.",
    resolve: (ctx) => ({
      public: { row: ctx.target.row, col: ctx.target.col },
      private: {
        answer: scanFinds(ctx, (b) =>
          b.row === ctx.target.row || b.col === ctx.target.col) ? "YES" : "NO"
      }
    })
  },

  /* ---------------- Movement cards ----------------
     Movement resolves by updating the server-side position. The
     opponent is told WHICH movement card was played (public: {})
     but never the destination — that stays private. */

  // Move One: move exactly one tile up, down, left or right.
  moveOne: {
    name: "Move One", category: "Movement", copies: 2,
    validateTarget: ({ target, myPosition }) => {
      if (!inBounds(target.row, target.col)) return "Invalid destination.";
      return manhattan(target, myPosition) === 1 ? null : "Move One must move exactly one tile.";
    },
    resolve: ({ room, game, playerId, myPosition, target }) => {
      // Record the start tile so Reveal Trail can reconstruct the move.
      game.lastMovement[playerId] = {
        cardId: "moveOne",
        from: { row: myPosition.row, col: myPosition.col }
      };
      room.positions[playerId] = { row: target.row, col: target.col };
      return { public: {}, private: { position: { row: target.row, col: target.col } } };
    }
  },

  // Dash: move exactly two tiles (two steps of movement in total).
  dash: {
    name: "Dash", category: "Movement", copies: 1,
    validateTarget: ({ target, myPosition }) => {
      if (!inBounds(target.row, target.col)) return "Invalid destination.";
      return manhattan(target, myPosition) === 2 ? null : "Dash must move exactly two tiles.";
    },
    resolve: ({ room, game, playerId, myPosition, target }) => {
      game.lastMovement[playerId] = {
        cardId: "dash",
        from: { row: myPosition.row, col: myPosition.col }
      };
      room.positions[playerId] = { row: target.row, col: target.col };
      return { public: {}, private: { position: { row: target.row, col: target.col } } };
    }
  },

  // Teleport: move to ANY other square. Opponent only knows a
  // teleport occurred.
  teleport: {
    name: "Teleport", category: "Movement", copies: 1,
    validateTarget: ({ target, myPosition }) => {
      if (!inBounds(target.row, target.col)) return "Invalid destination.";
      return manhattan(target, myPosition) > 0 ? null : "Teleport must move you to a different square.";
    },
    resolve: ({ room, game, playerId, myPosition, target }) => {
      game.lastMovement[playerId] = {
        cardId: "teleport",
        from: { row: myPosition.row, col: myPosition.col }
      };
      room.positions[playerId] = { row: target.row, col: target.col };
      return { public: {}, private: { position: { row: target.row, col: target.col } } };
    }
  },

  /* ---------------- Attack cards ---------------- */

  // Attack: name one tile. Exact match = immediate victory; anything
  // else is a public miss. The attacked tile is public information.
  // Hitting a Mage's mirror image destroys the DECOY, not the Mage —
  // both players learn a mirror was destroyed.
  attack: {
    name: "Attack", category: "Attack", copies: 5,
    validateTarget: ({ target }) => inBounds(target.row, target.col) ? null : "Invalid attack target.",
    resolve: ({ game, opponent, target, opponentPosition, playerId }) => {
      const mirrorOutcome = tryHitMirror(game, opponent, target);
      if (mirrorOutcome) return mirrorOutcome;
      const hit = opponentPosition.row === target.row && opponentPosition.col === target.col;
      return {
        public: { row: target.row, col: target.col, hit },
        winner: hit ? playerId : null
      };
    }
  },

  /* ---------------- Special cards ---------------- */

  // Rest: skip the action and immediately draw one replacement card.
  rest: {
    name: "Rest", category: "Special", copies: 2,
    resolve: () => ({
      public: {},
      private: { answer: "You rested and drew a replacement card." },
      drawOne: true
    })
  },

  // Radar: learn whether the opponent is in the north or south half.
  radar: {
    name: "Radar", category: "Special", copies: 2,
    resolve: ({ opponentPosition }) => ({
      public: {},
      private: { answer: opponentPosition.row < BOARD_SIZE / 2 ? "North Half" : "South Half" }
    })
  },

  // Compass: learn whether the opponent is in the east or west half.
  compass: {
    name: "Compass", category: "Special", copies: 2,
    resolve: ({ opponentPosition }) => ({
      public: {},
      private: { answer: opponentPosition.col >= BOARD_SIZE / 2 ? "East Half" : "West Half" }
    })
  },

  // Heat Map: highlight a random 3x3 that ALWAYS covers the opponent
  // or their active Mage mirror (clone). Never a miss.
  heatMap: {
    name: "Heat Map", category: "Special", copies: 2,
    resolve: ({ game, opponent, opponentPosition }) => {
      const bodies = opponentBodies(game, opponent, opponentPosition);
      const body = bodies[Math.floor(Math.random() * bodies.length)];
      const maxTL = BOARD_SIZE - 3;
      const rMin = Math.max(0, body.row - 2);
      const rMax = Math.min(maxTL, body.row);
      const cMin = Math.max(0, body.col - 2);
      const cMax = Math.min(maxTL, body.col);
      const row = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
      const col = cMin + Math.floor(Math.random() * (cMax - cMin + 1));
      return { public: { row, col } };
    }
  },

  // Reveal Trail: learn the opponent's last movement card and the
  // square they left. Move One → private 3×3 ? around the start;
  // Dash → private 4×4 ? around the start; Teleport → text only.
  // Deck carries one Reveal Trail per movement card (2+1+1 = 4).
  revealTrail: {
    name: "Reveal Trail", category: "Special", copies: 4,
    resolve: ({ game, opponent }) => {
      const last = game.lastMovement[opponent.id];
      if (!last) {
        return {
          public: {},
          private: { answer: "Opponent has not moved yet.", cells: [] }
        };
      }
      const card = CARD_DEFINITIONS[last.cardId];
      const cardName = card ? card.name : last.cardId;
      const from = last.from;
      const fromLabel = String.fromCharCode(65 + from.col) + (from.row + 1);
      let cells = [];
      let size = 0;
      if (last.cardId === "moveOne") {
        ({ size, cells } = squareAround(from, 3));
      } else if (last.cardId === "dash") {
        ({ size, cells } = squareAround(from, 4));
      }
      // Teleport: no board highlight — text only.
      return {
        public: {},
        private: {
          answer: "Opponent used " + cardName + " from " + fromLabel + ".",
          cardId: last.cardId,
          cardName,
          from,
          size,
          cells
        }
      };
    }
  }
};

/* ============================================================
   CHARACTER ABILITIES
   ============================================================
   Every character has one ability. Active abilities are used ON TOP
   of the normal card turn — they never consume it — and are limited
   by a cooldown counted in the player's OWN turns (plus at most one
   ability use per turn). Rogue's ability is a passive that triggers
   automatically.
*/
const CHARACTER_ABILITIES = {
  // Knight: a free attack that does not use up the card turn,
  // available every 3 of his turns.
  Knight: {
    id: "knightStrike", name: "Power Strike", type: "active", cooldown: 3,
    desc: "Free attack on one tile that does NOT use up your card turn. Available every 3 turns."
  },
  // Mage: place a mirror image decoy anywhere — once per game.
  // Attacks that hit the mirror destroy the decoy instead of the Mage,
  // and every scan reports it as if it were you. After it is destroyed
  // it cannot be recreated.
  Mage: {
    id: "mirrorImage", name: "Mirror Image", type: "active", cooldown: 0,
    desc: "Once per game: create a mirror image decoy on any tile. Attacks that hit it destroy the decoy instead of you, and every scan reports it as if it were you. Cannot be used again after it is destroyed."
  },
  // Hunter: a free 3x3 scan around a chosen centre tile, available
  // every 5 of his turns.
  Hunter: {
    id: "eagleEye", name: "Eagle Eye", type: "active", cooldown: 5,
    desc: "Free 3x3 scan around a chosen tile that does NOT use up your card turn. Available every 5 turns."
  },
  // Rogue: passive — the first time an enemy scan finds him (a YES
  // answer), he automatically teleports to a random square. Once per
  // game. Both players see that Shadow Step fired; only the Rogue
  // learns the new position.
  Rogue: {
    id: "shadowStep", name: "Shadow Step", type: "passive", cooldown: 0,
    desc: "Passive: the first time an enemy scan finds you, you instantly teleport to a random square. Once per game."
  }
};

// Every position a scan can find the opponent at: their real square
// plus a Mage's active mirror image. Any scan that touches the decoy
// reports YES exactly as if it had found the real character — that is
// the whole point of the mirror.
function opponentBodies(game, opponent, opponentPosition) {
  const bodies = [opponentPosition];
  const state = game.abilityState[opponent.id];
  if (opponent.character === "Mage" && state.mirror) {
    bodies.push(state.mirror);
  }
  return bodies;
}

// True when any of the opponent's bodies satisfies the scan predicate.
function scanFinds(ctx, predicate) {
  return opponentBodies(ctx.game, ctx.opponent, ctx.opponentPosition).some(predicate);
}

// Shared by the Attack card and Knight's Power Strike: if the target
// square holds the opponent's mirror image, the decoy is destroyed
// (publicly) and the Mage survives. Returns the outcome or null.
function tryHitMirror(game, opponent, target) {
  const state = game.abilityState[opponent.id];
  if (opponent.character === "Mage" && state.mirror &&
      state.mirror.row === target.row && state.mirror.col === target.col) {
    state.mirror = null;
    return {
      public: { row: target.row, col: target.col, hit: false, mirror: true },
      mirrorDestroyed: true
    };
  }
  return null;
}

// Every physical card instance gets a unique id so the server can
// verify that a played card really sits in the sender's hand.
let nextCardUid = 1;

// Build one player's personal deck from the card definitions.
function buildShuffledDeck() {
  const deck = [];
  for (const cardId of Object.keys(CARD_DEFINITIONS)) {
    for (let i = 0; i < CARD_DEFINITIONS[cardId].copies; i++) {
      deck.push({ uid: nextCardUid++, id: cardId });
    }
  }
  // Fisher-Yates shuffle.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// What a client is allowed to know about a card in its own hand.
function serializeHand(hand) {
  return hand.map((card) => ({
    uid: card.uid,
    id: card.id,
    name: CARD_DEFINITIONS[card.id].name,
    category: CARD_DEFINITIONS[card.id].category
  }));
}

/*
 * Authoritative in-memory game state, keyed by room code:
 *
 * rooms = {
 *   DUEL42: {
 *     players:   [{ id, name, character }, ...],
 *     positions: { <socketId>: { row, col }, ... },  // hidden squares
 *     ready:     { <socketId>: true/false, ... },    // confirmed placement
 *     rematch:   { <socketId>: true, ... },          // Play Again votes
 *     currentTurn: <socketId> | null,
 *     game: {                                        // created at game start
 *       decks:       { <socketId>: [card, ...] },    // face-down draw piles
 *       hands:       { <socketId>: [card, ...] },    // private hands
 *       discards:    { <socketId>: [card, ...] },    // discard piles
 *       over: false
 *     }
 *   }
 * }
 *
 * Positions and hands are NEVER sent to the opposing client — the
 * server keeps them private and validates every action itself.
 */
const rooms = {};

// Find the room a given socket belongs to (or null).
function findRoomOfSocket(socketId) {
  for (const roomCode of Object.keys(rooms)) {
    if (rooms[roomCode].players.some((p) => p.id === socketId)) {
      return roomCode;
    }
  }
  return null;
}

function getOpponent(room, socketId) {
  return room.players.find((p) => p.id !== socketId) || null;
}

/* ============================================================
   GAMEPLAY HELPERS (all state changes happen server-side)
   ============================================================ */

// Draw up to `count` cards for a player, respecting the hand limit.
// If the deck runs dry the discard pile is shuffled back in so the
// game can always continue; if both are empty the draw is skipped.
function drawCards(game, playerId, count) {
  for (let i = 0; i < count; i++) {
    if (game.hands[playerId].length >= MAX_HAND_SIZE) break; // hand full: skip drawing
    if (game.decks[playerId].length === 0 && game.discards[playerId].length > 0) {
      game.decks[playerId] = game.discards[playerId];
      game.discards[playerId] = [];
      for (let k = game.decks[playerId].length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [game.decks[playerId][k], game.decks[playerId][j]] = [game.decks[playerId][j], game.decks[playerId][k]];
      }
    }
    if (game.decks[playerId].length === 0) break;
    game.hands[playerId].push(game.decks[playerId].pop());
  }
}

/*
 * "abilityUpdate" — sent to ONE player only, describing their own
 * ability: readiness, cooldown, mirror position (Mage) and whether
 * the passive has been consumed (Rogue). Never sent to the opponent.
 */
function sendAbilityUpdate(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  const def = CHARACTER_ABILITIES[player.character];
  const state = room.game.abilityState[playerId];
  io.to(playerId).emit("abilityUpdate", {
    id: def.id,
    name: def.name,
    desc: def.desc,
    type: def.type,
    cooldown: def.cooldown,
    cooldownLeft: state.cooldownLeft,
    usedThisTurn: state.usedThisTurn,
    mirror: state.mirror,
    mirrorUsed: !!state.mirrorUsed,
    passiveUsed: state.passiveUsed,
    ready: def.type === "active" && state.cooldownLeft === 0 && !state.usedThisTurn &&
      !(def.id === "mirrorImage" && (state.mirror || state.mirrorUsed))
  });
}

// Called whenever a player's turn begins: tick their ability cooldown
// down and allow one ability use this turn.
function beginTurnAbilityTick(room, playerId) {
  const state = room.game.abilityState[playerId];
  if (state.cooldownLeft > 0) state.cooldownLeft--;
  state.usedThisTurn = false;
  sendAbilityUpdate(room, playerId);
}

// End the game with a winner. "gameOver" is sent to each player
// individually with a full reveal of both hiding spots (and mirrors)
// so both clients can show an end-game board. Deduction maps are
// shared separately via "endgameKnowledge" from each client.
function endGame(room, winnerId) {
  room.game.over = true;
  room.players.forEach((player) => {
    const opponent = getOpponent(room, player.id);
    const myAbility = room.game.abilityState[player.id] || {};
    const oppAbility = room.game.abilityState[opponent.id] || {};
    io.to(player.id).emit("gameOver", {
      youWin: player.id === winnerId,
      yourPosition: room.positions[player.id]
        ? { row: room.positions[player.id].row, col: room.positions[player.id].col }
        : null,
      opponentPosition: room.positions[opponent.id]
        ? { row: room.positions[opponent.id].row, col: room.positions[opponent.id].col }
        : null,
      yourMirror: myAbility.mirror
        ? { row: myAbility.mirror.row, col: myAbility.mirror.col }
        : null,
      opponentMirror: oppAbility.mirror
        ? { row: oppAbility.mirror.row, col: oppAbility.mirror.col }
        : null,
      yourCharacter: player.character,
      opponentCharacter: opponent.character,
      opponentName: opponent.name
    });
  });
}

/*
 * Rogue's Shadow Step passive: the first time an enemy scan FINDS the
 * Rogue (a YES answer), he teleports to a random different square.
 * Both players are told the passive fired (via "actionPlayed", so the
 * scanner knows their information is now stale) but ONLY the Rogue
 * receives the new position (via "cardResult").
 */
function maybeTriggerRogueEscape(room, roomCode, player) {
  const state = room.game.abilityState[player.id];
  if (player.character !== "Rogue" || state.passiveUsed) return;
  state.passiveUsed = true;

  const current = room.positions[player.id];
  let row, col;
  do {
    row = Math.floor(Math.random() * BOARD_SIZE);
    col = Math.floor(Math.random() * BOARD_SIZE);
  } while (row === current.row && col === current.col);
  room.positions[player.id] = { row, col };

  io.to(roomCode).emit("actionPlayed", {
    by: player.id,
    name: player.name,
    character: player.character,
    cardId: "shadowStep",
    cardName: "Shadow Step",
    category: "Ability",
    public: {}
  });
  io.to(player.id).emit("cardResult", {
    cardId: "shadowStep",
    cardName: "Shadow Step",
    result: { position: { row, col } }
  });
  sendAbilityUpdate(room, player.id);
}

/*
 * "handUpdate" — sent to ONE player only, with their own private hand
 * and their own pile counts. The opponent never receives this data.
 */
function sendHandUpdate(room, playerId) {
  const game = room.game;
  io.to(playerId).emit("handUpdate", {
    hand: serializeHand(game.hands[playerId]),
    deckCount: game.decks[playerId].length,
    discardCount: game.discards[playerId].length
  });
}

/*
 * Pass the turn to the opponent. There is no "End Turn" action a
 * client can send — the turn ONLY changes here, automatically, after
 * a card has fully resolved.
 *
 * "turnChanged" — sent to each player individually with { yourTurn }
 * so each client only learns whether it is now THEIR turn.
 */
function passTurn(room) {
  const next = getOpponent(room, room.currentTurn);
  room.currentTurn = next.id;

  // Beginning of a turn: the new active player draws one card and
  // their ability cooldown ticks down.
  drawCards(room.game, next.id, 1);
  sendHandUpdate(room, next.id);
  beginTurnAbilityTick(room, next.id);

  room.players.forEach((player) => {
    io.to(player.id).emit("turnChanged", {
      yourTurn: player.id === room.currentTurn
    });
  });
}

/*
 * Initialise the card game once both hidden positions are locked in:
 * build a shuffled deck per player, deal the starting hands, pick a
 * random starting player and give them their turn-start draw.
 *
 * "gameStarted" — sent to each player individually with ONLY their
 * own hand/pile counts plus whether it is their turn.
 */
function startGame(room) {
  room.game = {
    decks: {},
    hands: {},
    discards: {},
    abilityState: {},
    // Last movement card each player played, for Reveal Trail.
    lastMovement: {},
    over: false
  };

  room.players.forEach((player) => {
    room.game.decks[player.id] = buildShuffledDeck();
    room.game.hands[player.id] = [];
    room.game.discards[player.id] = [];
    room.game.abilityState[player.id] = {
      cooldownLeft: 0,
      usedThisTurn: false,
      mirror: null,       // Mage's mirror image position (while active)
      mirrorUsed: false,  // Mage: Mirror Image is once per game
      passiveUsed: false  // Rogue's once-per-game Shadow Step
    };
    drawCards(room.game, player.id, STARTING_HAND_SIZE);
  });

  // Randomly choose which player starts. The server is the single
  // source of truth for whose turn it is.
  const startingPlayer = room.players[Math.floor(Math.random() * room.players.length)];
  room.currentTurn = startingPlayer.id;

  // The active player draws one card at the beginning of their turn.
  drawCards(room.game, startingPlayer.id, 1);

  room.players.forEach((player) => {
    io.to(player.id).emit("gameStarted", {
      yourTurn: player.id === room.currentTurn,
      hand: serializeHand(room.game.hands[player.id]),
      deckCount: room.game.decks[player.id].length,
      discardCount: room.game.discards[player.id].length
    });
    // Each player also learns their own ability status.
    sendAbilityUpdate(room, player.id);
  });
}

// Move a played card from the player's hand to their discard pile.
function discardCard(game, playerId, cardIndex) {
  const [card] = game.hands[playerId].splice(cardIndex, 1);
  game.discards[playerId].push(card);
}

io.on("connection", (socket) => {

  // Word Chain socket handlers (no-ops unless the lobby gameMode is word-chain).
  wordchain.registerSocket(socket, io, rooms);

  /*
   * "createLobby" — a player creates a new lobby with a code THEY
   * chose (4-8 letters/numbers, auto-uppercased, must be unique).
   * Payload: { name, room, game }
   * Character is chosen later during Hidden Hunt placement.
   * Replies with "lobbyCreated" { room } to the creator.
   */
  socket.on("createLobby", (data) => {
    const name = normalizePlayerName(data && data.name);
    const roomCode = data && typeof data.room === "string" ? data.room.trim().toUpperCase() : "";
    // Lobby game mode: default Hidden Hunt. "word-chain" launches Word Chain only.
    const gameMode = data && data.game === "word-chain" ? "word-chain" : "hidden-hunt";

    if (!isValidPlayerName(name)) {
      socket.emit("errorMessage", "Enter a name (2-16 letters, numbers, spaces, - or _).");
      return;
    }
    // Validate: 4-8 characters, letters and numbers only.
    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      socket.emit("errorMessage", "Lobby code must be 4-8 letters or numbers.");
      return;
    }
    // Validate: reject duplicate room codes.
    if (rooms[roomCode]) {
      socket.emit("errorMessage", "That lobby code is already taken.");
      return;
    }

    rooms[roomCode] = {
      // Which game this lobby runs. Stored separately from room.game
      // (Hidden Hunt's card-match state) so existing HH logic is untouched.
      gameMode,
      // character is filled in during Hidden Hunt placement (null until then).
      players: [{ id: socket.id, name, character: null }],
      positions: {},
      ready: {},
      rematch: {},
      currentTurn: null,
      game: null
    };

    socket.join(roomCode);
    socket.emit("lobbyCreated", { room: roomCode, game: gameMode });
  });

  /*
   * "joinLobby" — a second player joins an existing lobby.
   * Payload: { name, room }
   * On success emits "gameStart" { room, players } for Hidden Hunt
   * (placement next), or starts Word Chain. Character is still null
   * for Hidden Hunt until placeCharacter.
   */
  socket.on("joinLobby", (data) => {
    const name = normalizePlayerName(data && data.name);
    const roomCode = data && typeof data.room === "string" ? data.room.trim().toUpperCase() : "";

    if (!isValidPlayerName(name)) {
      socket.emit("errorMessage", "Enter a name (2-16 letters, numbers, spaces, - or _).");
      return;
    }
    if (!roomCode) {
      socket.emit("errorMessage", "Enter a valid lobby code.");
      return;
    }

    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMessage", "Lobby not found.");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("errorMessage", "Lobby is full.");
      return;
    }
    if (room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are already in this lobby.");
      return;
    }

    room.players.push({ id: socket.id, name, character: null });
    socket.join(roomCode);

    // Router: Word Chain lobbies never enter Hidden Hunt placement.
    if (room.gameMode === "word-chain") {
      wordchain.onBothPlayersJoined(room, io, roomCode);
      return;
    }

    // Both players are in — start the placement phase on both clients.
    io.to(roomCode).emit("gameStart", {
      room: roomCode,
      players: room.players.map((p) => ({ id: p.id, name: p.name, character: p.character }))
    });
  });

  /*
   * "placeCharacter" — a player confirms their hidden square AND
   * their class character (Knight / Mage / Hunter / Rogue).
   * Payload: { roomCode, position: { row, col }, character }
   *
   * The server stores the position privately, locks in the character,
   * marks the player ready and then either:
   *   - emits "waitingOpponent" ONLY to this player (opponent not
   *     ready yet), or
   *   - emits "bothPlayersReady" to the whole room and starts the
   *     card game (see startGame above).
   *
   * A player's position is never revealed to the opponent.
   */
  socket.on("placeCharacter", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (room.gameMode === "word-chain") {
      socket.emit("errorMessage", "This lobby is not a Hidden Hunt game.");
      return;
    }
    if (room.players.length < MAX_PLAYERS) {
      socket.emit("errorMessage", "Waiting for a second player before placement.");
      return;
    }
    if (room.ready[socket.id]) {
      socket.emit("errorMessage", "You have already confirmed your position.");
      return;
    }
    const position = data && data.position;
    if (!position || !inBounds(position.row, position.col)) {
      socket.emit("errorMessage", "Invalid board position.");
      return;
    }
    const character = data && typeof data.character === "string" ? data.character : "";
    if (!CHARACTERS.includes(character)) {
      socket.emit("errorMessage", "Choose a valid character.");
      return;
    }

    // Store the hidden position server-side only; lock in character now.
    room.positions[socket.id] = { row: position.row, col: position.col };
    const me = room.players.find((p) => p.id === socket.id);
    me.character = character;
    room.ready[socket.id] = true;

    const everyoneReady = room.players.every((p) => room.ready[p.id]);

    if (!everyoneReady) {
      // "waitingOpponent" — tells ONLY the confirmed player that the
      // opponent has not locked in a position yet.
      socket.emit("waitingOpponent");
      return;
    }

    // "bothPlayersReady" — both hid and picked a character; include the
    // final public player list so clients can render the player panel.
    io.to(roomCode).emit("bothPlayersReady", {
      players: room.players.map((p) => ({ id: p.id, name: p.name, character: p.character }))
    });

    // Deal hands, pick the starting player and begin the card game.
    startGame(room);
  });

  /*
   * "playCard" — the active player plays exactly ONE card, which IS
   * their whole turn. There is no End Turn event; after the card
   * resolves it is discarded and the turn passes automatically.
   *
   * Payload: { roomCode, cardUid, target }
   *   - cardUid: unique id of a card instance in the sender's hand
   *   - target:  card-specific, validated by the card definition
   *
   * The generic pipeline: validate -> resolve -> broadcast the PUBLIC
   * part to both players ("actionPlayed") -> send the PRIVATE result
   * to the acting player only ("cardResult") -> discard -> game over
   * or automatic turn pass. Cards plug into this pipeline purely via
   * their definition object.
   */
  socket.on("playCard", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const game = room.game;
    if (!game || game.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (room.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    const cardIndex = game.hands[socket.id].findIndex((c) => c.uid === data.cardUid);
    if (cardIndex === -1) {
      socket.emit("errorMessage", "That card is not in your hand.");
      return;
    }

    const card = game.hands[socket.id][cardIndex];
    const definition = CARD_DEFINITIONS[card.id];
    const me = room.players.find((p) => p.id === socket.id);
    const opponent = getOpponent(room, socket.id);

    const ctx = {
      room,
      game,
      playerId: socket.id,
      opponent,
      myPosition: room.positions[socket.id],
      opponentPosition: room.positions[opponent.id],
      target: (data.target && typeof data.target === "object") ? data.target : {}
    };

    // Card-specific target validation.
    if (definition.validateTarget) {
      const error = definition.validateTarget(ctx);
      if (error) {
        socket.emit("errorMessage", error);
        return;
      }
    }

    const outcome = definition.resolve(ctx);

    /*
     * "actionPlayed" — broadcast to BOTH players: who played which
     * card plus the card's public target info (scanned row/column/
     * area, attacked tile, heat map region). Movement and information
     * cards publish an empty target — the opponent learns WHAT was
     * played but never destinations or private answers. Clients use
     * this event for the game log and the board animations.
     */
    io.to(roomCode).emit("actionPlayed", {
      by: socket.id,
      name: me.name,
      character: me.character,
      cardId: card.id,
      cardName: definition.name,
      category: definition.category,
      public: outcome.public || {}
    });

    /*
     * "cardResult" — sent ONLY to the acting player: the private part
     * of the resolution (scan YES/NO answers, radar/compass halves,
     * the player's own new position after moving, ...).
     */
    if (outcome.private) {
      socket.emit("cardResult", {
        cardId: card.id,
        cardName: definition.name,
        result: outcome.private
      });
    }

    discardCard(game, socket.id, cardIndex);
    sendHandUpdate(room, socket.id);

    // A Mage whose mirror was destroyed learns it via abilityUpdate.
    if (outcome.mirrorDestroyed) {
      sendAbilityUpdate(room, opponent.id);
    }

    if (outcome.winner) {
      // "gameOver" — the attack hit the opponent's exact square.
      endGame(room, outcome.winner);
      return;
    }

    // A scan that FOUND the opponent may trigger Rogue's Shadow Step.
    if (definition.category === "Scanning" && outcome.private && outcome.private.answer === "YES") {
      maybeTriggerRogueEscape(room, roomCode, opponent);
    }

    // Rest: immediately draw one replacement card before passing.
    if (outcome.drawOne) {
      drawCards(game, socket.id, 1);
      sendHandUpdate(room, socket.id);
    }

    passTurn(room); // playing a card IS the turn
  });

  /*
   * "useAbility" — the active player uses their character's ability.
   * Payload: { roomCode, target: { row, col } }
   *
   * Abilities do NOT consume the card turn: after using one, the
   * player still plays their card as normal. Limits enforced here:
   * it must be your turn, at most one ability use per turn, and the
   * ability must be off cooldown (cooldowns tick down at the start of
   * each of your turns). Rogue's ability is passive and cannot be
   * activated manually.
   */
  socket.on("useAbility", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const game = room.game;
    if (!game || game.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    if (room.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const me = room.players.find((p) => p.id === socket.id);
    const opponent = getOpponent(room, socket.id);
    const def = CHARACTER_ABILITIES[me.character];
    const state = game.abilityState[socket.id];

    if (def.type !== "active") {
      socket.emit("errorMessage", "Your ability is passive and triggers automatically.");
      return;
    }
    if (state.usedThisTurn) {
      socket.emit("errorMessage", "You already used your ability this turn.");
      return;
    }
    if (state.cooldownLeft > 0) {
      socket.emit("errorMessage", "Your ability is on cooldown (" + state.cooldownLeft + " more turn" + (state.cooldownLeft === 1 ? "" : "s") + ").");
      return;
    }

    const target = (data.target && typeof data.target === "object") ? data.target : {};
    if (!inBounds(target.row, target.col)) {
      socket.emit("errorMessage", "Invalid target.");
      return;
    }

    // Shared broadcast for the public part of an ability use.
    const announce = (publicInfo) => {
      io.to(roomCode).emit("actionPlayed", {
        by: socket.id,
        name: me.name,
        character: me.character,
        cardId: def.id,
        cardName: def.name,
        category: "Ability",
        public: publicInfo
      });
    };

    // Knight — Power Strike: a free attack (mirror rules apply).
    if (def.id === "knightStrike") {
      state.usedThisTurn = true;
      state.cooldownLeft = def.cooldown;
      const mirrorOutcome = tryHitMirror(game, opponent, target);
      if (mirrorOutcome) {
        announce(mirrorOutcome.public);
        sendAbilityUpdate(room, opponent.id); // Mage learns the mirror is gone
        sendAbilityUpdate(room, socket.id);
        return;
      }
      const oppPos = room.positions[opponent.id];
      const hit = oppPos.row === target.row && oppPos.col === target.col;
      announce({ row: target.row, col: target.col, hit });
      sendAbilityUpdate(room, socket.id);
      if (hit) endGame(room, socket.id);
      return; // the turn continues — the Knight still plays a card
    }

    // Mage — Mirror Image: once per game, place a decoy on any tile
    // except your own. Destroyed decoys cannot be replaced.
    if (def.id === "mirrorImage") {
      if (state.mirrorUsed) {
        socket.emit("errorMessage", "Mirror Image can only be used once per game.");
        return;
      }
      if (state.mirror) {
        socket.emit("errorMessage", "Your mirror image is still active.");
        return;
      }
      const myPos = room.positions[socket.id];
      if (myPos.row === target.row && myPos.col === target.col) {
        socket.emit("errorMessage", "The mirror image cannot be placed on your own tile.");
        return;
      }
      state.usedThisTurn = true;
      state.mirrorUsed = true;
      state.mirror = { row: target.row, col: target.col };
      announce({}); // the opponent learns a mirror exists, not where
      socket.emit("cardResult", {
        cardId: def.id,
        cardName: def.name,
        result: { mirror: { row: target.row, col: target.col } }
      });
      sendAbilityUpdate(room, socket.id);
      return;
    }

    // Hunter — Eagle Eye: a free 3x3 scan (a Mage's mirror counts too).
    if (def.id === "eagleEye") {
      state.usedThisTurn = true;
      state.cooldownLeft = def.cooldown;
      const inside = opponentBodies(game, opponent, room.positions[opponent.id]).some((b) =>
        Math.abs(b.row - target.row) <= 1 &&
        Math.abs(b.col - target.col) <= 1);
      announce({ row: target.row, col: target.col });
      socket.emit("cardResult", {
        cardId: def.id,
        cardName: def.name,
        result: { answer: inside ? "YES" : "NO" }
      });
      sendAbilityUpdate(room, socket.id);
      if (inside) maybeTriggerRogueEscape(room, roomCode, opponent);
      return;
    }
  });

  /*
   * "endgameKnowledge" — after Hidden Hunt ends, each client shares
   * their private deduction map so the opponent can see how they were
   * reasoning. Only accepted when the match is over; relayed to the
   * other player as "opponentEndgameKnowledge".
   */
  socket.on("endgameKnowledge", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || !room.players.some((p) => p.id === socket.id)) return;
    if (!room.game || !room.game.over) return;
    if (room.gameMode === "word-chain") return;

    const opponent = getOpponent(room, socket.id);
    if (!opponent) return;

    const asKeys = (value) => Array.isArray(value)
      ? value.filter((k) => typeof k === "string" && /^\d+,\d+$/.test(k)).slice(0, BOARD_SIZE * BOARD_SIZE)
      : [];

    io.to(opponent.id).emit("opponentEndgameKnowledge", {
      eliminated: asKeys(data.eliminated),
      confined: data.confined === null ? null : asKeys(data.confined),
      hinted: asKeys(data.hinted),
      oppScanned: asKeys(data.oppScanned)
    });
  });

  /*
   * "playAgain" — after a game ends, either player can vote for a
   * rematch. When BOTH players have voted the server resets the whole
   * match state (positions, ready flags, decks, hands, discards, turn
   * order) and sends "gameReset" to both clients, which return to the
   * placement phase while staying in the same lobby.
   *
   * "playAgainWait" — sent ONLY to a player whose vote is in while
   * the opponent has not voted yet.
   */
  socket.on("playAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    // A rematch can only be requested once a game has finished.
    if (!room.game || !room.game.over) {
      socket.emit("errorMessage", "The game is still running.");
      return;
    }

    room.rematch[socket.id] = true;

    const everyoneAgreed = room.players.every((p) => room.rematch[p.id]);
    if (!everyoneAgreed) {
      socket.emit("playAgainWait");
      return;
    }

    // Full reset: back to the hidden placement phase, same lobby.
    // Characters are chosen again with the new hiding spots.
    room.positions = {};
    room.ready = {};
    room.rematch = {};
    room.currentTurn = null;
    room.game = null;
    room.players.forEach((p) => { p.character = null; });

    io.to(roomCode).emit("gameReset");
  });

  /*
   * Disconnect — remove the player from their room, notify the
   * remaining player with "playerLeft" and delete the room's state.
   */
  socket.on("disconnect", () => {
    const roomCode = findRoomOfSocket(socket.id);
    if (!roomCode) return;

    socket.to(roomCode).emit("playerLeft");
    delete rooms[roomCode];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Hidden Duel server listening on port " + PORT);
});
