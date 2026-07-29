/*
 * Hidden Hunt — Game Mode 1 (existing hide-and-seek card game).
 * All game logic lives in this module; the shared lobby only routes
 * players here when room.gameMode === "hidden-hunt".
 */

const BOARD_SIZE = 8;
const MAX_PLAYERS = 2;
const MAX_HAND_SIZE = 5;
const STARTING_HAND_SIZE = 3;

// Lobby codes / player names are validated by server/lobby.js.

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

const CARD_DEFINITIONS = {

  /* ---------------- Scanning cards ---------------- */

  // Scan Row: pick a row, learn ONLY whether the opponent is in it.
  scanRow: {
    name: "Scan Row", category: "Scanning", copies: 3,
    validateTarget: ({ target }) => inBounds(target.row, 0) ? null : "Invalid row.",
    resolve: ({ target, opponentPosition }) => ({
      public: { row: target.row },
      private: { answer: opponentPosition.row === target.row ? "YES" : "NO" }
    })
  },

  // Scan Column: pick a column, learn ONLY whether the opponent is in it.
  scanColumn: {
    name: "Scan Column", category: "Scanning", copies: 3,
    validateTarget: ({ target }) => inBounds(0, target.col) ? null : "Invalid column.",
    resolve: ({ target, opponentPosition }) => ({
      public: { col: target.col },
      private: { answer: opponentPosition.col === target.col ? "YES" : "NO" }
    })
  },

  // Scan Area: pick one tile; learn ONLY whether the opponent is on
  // that tile or any of the 8 tiles around it (a 3x3 area, clipped at
  // the board edges). If the opponent is a Mage with an active mirror
  // image, there is a 50% chance the scan checks the MIRROR's tile
  // instead of the real position.
  scanArea: {
    name: "Scan Area", category: "Scanning", copies: 2,
    validateTarget: ({ target }) => inBounds(target.row, target.col) ? null : "Invalid tile.",
    resolve: (ctx) => {
      const checked = areaScanCheckPosition(ctx.game, ctx.opponent, ctx.opponentPosition);
      const inside =
        Math.abs(checked.row - ctx.target.row) <= 1 &&
        Math.abs(checked.col - ctx.target.col) <= 1;
      return {
        public: { row: ctx.target.row, col: ctx.target.col },
        private: { answer: inside ? "YES" : "NO" }
      };
    }
  },

  // Scan Cross: pick one tile; learn ONLY whether the opponent is
  // somewhere in that tile's row OR column.
  scanCross: {
    name: "Scan Cross", category: "Scanning", copies: 2,
    validateTarget: ({ target }) => inBounds(target.row, target.col) ? null : "Invalid tile.",
    resolve: ({ target, opponentPosition }) => ({
      public: { row: target.row, col: target.col },
      private: {
        answer: (opponentPosition.row === target.row || opponentPosition.col === target.col) ? "YES" : "NO"
      }
    })
  },

  /* ---------------- Movement cards ----------------
     Movement resolves by updating the server-side position. The
     opponent is told WHICH movement card was played (public: {})
     but never the destination — that stays private. */

  // Move One: move exactly one tile up, down, left or right.
  moveOne: {
    name: "Move One", category: "Movement", copies: 3,
    validateTarget: ({ target, myPosition }) => {
      if (!inBounds(target.row, target.col)) return "Invalid destination.";
      return manhattan(target, myPosition) === 1 ? null : "Move One must move exactly one tile.";
    },
    resolve: ({ room, playerId, target }) => {
      room.positions[playerId] = { row: target.row, col: target.col };
      return { public: {}, private: { position: { row: target.row, col: target.col } } };
    }
  },

  // Dash: move exactly two tiles (two steps of movement in total).
  dash: {
    name: "Dash", category: "Movement", copies: 2,
    validateTarget: ({ target, myPosition }) => {
      if (!inBounds(target.row, target.col)) return "Invalid destination.";
      return manhattan(target, myPosition) === 2 ? null : "Dash must move exactly two tiles.";
    },
    resolve: ({ room, playerId, target }) => {
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
    resolve: ({ room, playerId, target }) => {
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

  // Reveal Trail: learn whether the opponent played a movement card
  // during their last two turns.
  revealTrail: {
    name: "Reveal Trail", category: "Special", copies: 1,
    resolve: ({ game, opponent }) => {
      const moved = game.moveHistory[opponent.id].slice(-2).some(Boolean);
      return {
        public: {},
        private: {
          answer: moved ? "The opponent moved during the last two turns." : "The opponent has not moved."
        }
      };
    }
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

  // Heat Map: the server highlights a random 3x3 region that is
  // MORE LIKELY (70%) to contain the opponent — intentionally
  // imprecise, so a highlight is a hint, never a guarantee.
  heatMap: {
    name: "Heat Map", category: "Special", copies: 2,
    resolve: ({ opponentPosition }) => {
      const maxTL = BOARD_SIZE - 3; // top-left range so the 3x3 fits
      let row, col;
      if (Math.random() < 0.7) {
        // Pick a region that covers the opponent's square.
        const rMin = Math.max(0, opponentPosition.row - 2);
        const rMax = Math.min(maxTL, opponentPosition.row);
        const cMin = Math.max(0, opponentPosition.col - 2);
        const cMax = Math.min(maxTL, opponentPosition.col);
        row = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
        col = cMin + Math.floor(Math.random() * (cMax - cMin + 1));
      } else {
        // Pick a fully random region as noise.
        row = Math.floor(Math.random() * (maxTL + 1));
        col = Math.floor(Math.random() * (maxTL + 1));
      }
      // The highlighted region is public for both players.
      return { public: { row, col } };
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
  // Mage: place a mirror image decoy anywhere. Attacks that hit the
  // mirror destroy the decoy instead of the Mage, and area scans have
  // a 50% chance of checking the mirror instead of the real position.
  // A new mirror can be created once the old one is destroyed.
  Mage: {
    id: "mirrorImage", name: "Mirror Image", type: "active", cooldown: 0,
    desc: "Create a mirror image decoy on any tile. Attacks that hit it destroy the decoy instead of you, and area scans may be fooled by it."
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

// Area scans (Scan Area card and Hunter's Eagle Eye) can be fooled by
// a Mage's mirror image: with an active mirror there is a 50% chance
// the scan checks the mirror's tile instead of the real position.
function areaScanCheckPosition(game, opponent, opponentPosition) {
  const state = game.abilityState[opponent.id];
  if (opponent.character === "Mage" && state.mirror && Math.random() < 0.5) {
    return state.mirror;
  }
  return opponentPosition;
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
 *       moveHistory: { <socketId>: [bool, ...] },    // one entry per turn:
 *                                                    // did that turn move?
 *       over: false
 *     }
 *   }
 * }
 *
 * Positions and hands are NEVER sent to the opposing client — the
 * server keeps them private and validates every action itself.
 */

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
    passiveUsed: state.passiveUsed,
    ready: def.type === "active" && state.cooldownLeft === 0 && !state.usedThisTurn &&
      !(def.id === "mirrorImage" && state.mirror)
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
// individually: { youWin }.
function endGame(room, winnerId) {
  room.game.over = true;
  room.players.forEach((player) => {
    io.to(player.id).emit("gameOver", { youWin: player.id === winnerId });
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
    moveHistory: {},
    abilityState: {},
    over: false
  };

  room.players.forEach((player) => {
    room.game.decks[player.id] = buildShuffledDeck();
    room.game.hands[player.id] = [];
    room.game.discards[player.id] = [];
    room.game.moveHistory[player.id] = [];
    room.game.abilityState[player.id] = {
      cooldownLeft: 0,
      usedThisTurn: false,
      mirror: null,      // Mage's mirror image position
      passiveUsed: false // Rogue's once-per-game Shadow Step
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

function onBothPlayersJoined(room) {
  room.positions = {};
  room.ready = {};
  room.rematch = {};
  room.currentTurn = null;
  room.game = null;
}

function registerSocket(socket, io, { rooms, getOpponent }) {

  /*
   * "placeCharacter" — a player confirms their hidden square.
   * Payload: { roomCode, position: { row, col } }
   *
   * The server stores the position privately, marks the player ready
   * and then either:
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

    if (!room || room.gameMode !== "hidden-hunt" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
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

    // Store the hidden position server-side only.
    room.positions[socket.id] = { row: position.row, col: position.col };
    room.ready[socket.id] = true;

    const everyoneReady = room.players.every((p) => room.ready[p.id]);

    if (!everyoneReady) {
      // "waitingOpponent" — tells ONLY the confirmed player that the
      // opponent has not locked in a position yet.
      socket.emit("waitingOpponent");
      return;
    }

    // "bothPlayersReady" — both positions are locked in; both clients
    // hide the placement UI and transition to the game screen.
    io.to(roomCode).emit("bothPlayersReady");

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

    if (!room || room.gameMode !== "hidden-hunt" || !room.players.some((p) => p.id === socket.id)) {
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

    // Track movement per turn so Reveal Trail can answer honestly.
    game.moveHistory[socket.id].push(definition.category === "Movement");

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

    if (!room || room.gameMode !== "hidden-hunt" || !room.players.some((p) => p.id === socket.id)) {
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

    // Mage — Mirror Image: place a decoy on any tile except your own.
    if (def.id === "mirrorImage") {
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

    // Hunter — Eagle Eye: a free 3x3 scan (mirror rules apply).
    if (def.id === "eagleEye") {
      state.usedThisTurn = true;
      state.cooldownLeft = def.cooldown;
      const checked = areaScanCheckPosition(game, opponent, room.positions[opponent.id]);
      const inside =
        Math.abs(checked.row - target.row) <= 1 &&
        Math.abs(checked.col - target.col) <= 1;
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

    if (!room || room.gameMode !== "hidden-hunt" || !room.players.some((p) => p.id === socket.id)) {
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
    room.positions = {};
    room.ready = {};
    room.rematch = {};
    room.currentTurn = null;
    room.game = null;

    io.to(roomCode).emit("gameReset");
  });
}

module.exports = {
  id: "hidden-hunt",
  name: "Hidden Hunt",
  requiresCharacter: true,
  onBothPlayersJoined,
  registerSocket
};
