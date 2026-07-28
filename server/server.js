const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

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

/* ============================================================
   CARD SYSTEM
   ============================================================
   The server is the ONLY source of cards. Clients never generate
   cards locally — they only render what the server sends them.
*/

// Framework of card categories. Only "Scan Row" and "Attack" are
// playable today; the other entries are registered placeholders so
// future cards slot into the same pipeline (deck -> hand -> playCard
// -> resolve -> discard -> pass turn).
const CARD_LIBRARY = {
  scanRow:    { id: "scanRow",    name: "Scan Row",    category: "Scanning", implemented: true  },
  scanColumn: { id: "scanColumn", name: "Scan Column", category: "Scanning", implemented: false },
  move:       { id: "move",       name: "Move",        category: "Movement", implemented: false },
  attack:     { id: "attack",     name: "Attack",      category: "Attack",   implemented: true  },
  trap:       { id: "trap",       name: "Trap",        category: "Trap",     implemented: false },
  decoy:      { id: "decoy",      name: "Decoy",       category: "Special",  implemented: false }
};

// Deck recipe: each player's personal deck is built from multiple
// copies of the implemented cards, then shuffled.
const DECK_COMPOSITION = [
  { cardId: "scanRow", copies: 8 },
  { cardId: "attack",  copies: 7 }
];

const MAX_HAND_SIZE = 5;
const STARTING_HAND_SIZE = 3;

// Every physical card instance gets a unique id so the server can
// verify that a played card really sits in the sender's hand.
let nextCardUid = 1;

function buildShuffledDeck() {
  const deck = [];
  for (const { cardId, copies } of DECK_COMPOSITION) {
    for (let i = 0; i < copies; i++) {
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
    name: CARD_LIBRARY[card.id].name,
    category: CARD_LIBRARY[card.id].category,
    implemented: CARD_LIBRARY[card.id].implemented
  }));
}

/*
 * Authoritative in-memory game state, keyed by room code:
 *
 * rooms = {
 *   ABC123: {
 *     players:   [{ id, name, character }, ...],
 *     positions: { <socketId>: { row, col }, ... },  // hidden squares
 *     ready:     { <socketId>: true/false, ... },    // confirmed placement
 *     currentTurn: <socketId> | null,                // whose turn it is
 *     game: {                                        // created at game start
 *       decks:    { <socketId>: [card, ...] },       // face-down draw piles
 *       hands:    { <socketId>: [card, ...] },       // private hands
 *       discards: { <socketId>: [card, ...] },       // face-up discard piles
 *       scannedRows: [row, ...],                     // public information
 *       attackedSquares: [{ row, col }, ...],        // public information
 *       over: false
 *     }
 *   }
 * }
 *
 * Positions and hands are NEVER sent to the opposing client — the
 * server keeps them private and validates every action itself.
 */
const rooms = {};

// Generate a unique 6-character lobby code.
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let roomCode;
  do {
    roomCode = "";
    for (let i = 0; i < 6; i++) {
      roomCode += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[roomCode]);
  return roomCode;
}

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

// Validate a board coordinate pair: integer row/col within the 8x8 board.
function isValidPosition(position) {
  return (
    position &&
    Number.isInteger(position.row) &&
    Number.isInteger(position.col) &&
    position.row >= 0 && position.row < BOARD_SIZE &&
    position.col >= 0 && position.col < BOARD_SIZE
  );
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
function passTurn(room, roomCode) {
  const game = room.game;
  const next = getOpponent(room, room.currentTurn);
  room.currentTurn = next.id;

  // Beginning of a turn: the new active player draws one card.
  drawCards(game, next.id, 1);
  sendHandUpdate(room, next.id);

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
function startGame(room, roomCode) {
  room.game = {
    decks: {},
    hands: {},
    discards: {},
    scannedRows: [],
    attackedSquares: [],
    over: false
  };

  room.players.forEach((player) => {
    room.game.decks[player.id] = buildShuffledDeck();
    room.game.hands[player.id] = [];
    room.game.discards[player.id] = [];
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
  });
}

// Move a played card from the player's hand to their discard pile.
function discardCard(game, playerId, cardIndex) {
  const [card] = game.hands[playerId].splice(cardIndex, 1);
  game.discards[playerId].push(card);
}

/* ============================================================
   CARD RESOLUTION
   ============================================================ */

/*
 * Resolve "Scan Row": the server checks the opponent's hidden row and
 * answers ONLY yes/no. The exact position is never transmitted.
 *
 * "scanResult"      — sent ONLY to the scanning player: { row, hit }.
 * "opponentScanned" — sent ONLY to the scanned player: { row }, so
 *                     they can see which row was scanned (the scan
 *                     itself is public information, the answer tells
 *                     them nothing they don't already know).
 */
function resolveScanRow(room, roomCode, socket, target) {
  const game = room.game;
  const opponent = getOpponent(room, socket.id);
  const opponentPosition = room.positions[opponent.id];

  const hit = opponentPosition.row === target.row;
  game.scannedRows.push(target.row);

  socket.emit("scanResult", { row: target.row, hit });
  io.to(opponent.id).emit("opponentScanned", { row: target.row });
}

/*
 * Resolve "Attack": the attacker names one square. On an exact match
 * the game ends and the attacker wins; otherwise the attack misses.
 *
 * "attackResult" — sent to BOTH players: { row, col, hit }. Attacked
 *                  squares are public information for both boards.
 * "gameOver"     — sent to each player individually: { youWin }.
 *
 * Returns true when the attack ended the game.
 */
function resolveAttack(room, roomCode, socket, target) {
  const game = room.game;
  const opponent = getOpponent(room, socket.id);
  const opponentPosition = room.positions[opponent.id];

  const hit = opponentPosition.row === target.row && opponentPosition.col === target.col;
  game.attackedSquares.push({ row: target.row, col: target.col });

  io.to(roomCode).emit("attackResult", { row: target.row, col: target.col, hit });

  if (hit) {
    game.over = true;
    room.players.forEach((player) => {
      io.to(player.id).emit("gameOver", { youWin: player.id === socket.id });
    });
  }
  return hit;
}

io.on("connection", (socket) => {

  /*
   * "createLobby" — a player creates a new lobby.
   * Payload: { name, character }
   * Replies with "lobbyCreated" { room } to the creator.
   */
  socket.on("createLobby", (data) => {
    const name = data && typeof data.name === "string" ? data.name.trim() : "";
    const character = data && typeof data.character === "string" ? data.character : "";
    if (!name) {
      socket.emit("errorMessage", "Enter a valid name.");
      return;
    }

    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [{ id: socket.id, name, character }],
      positions: {},
      ready: {},
      currentTurn: null,
      game: null
    };

    socket.join(roomCode);
    socket.emit("lobbyCreated", { room: roomCode });
  });

  /*
   * "joinLobby" — a second player joins an existing lobby.
   * Payload: { name, character, room }
   * On success emits "gameStart" { room, players } to both players in
   * the room (players carries only public info: id, name, character —
   * used by clients to render both character portraits).
   */
  socket.on("joinLobby", (data) => {
    const name = data && typeof data.name === "string" ? data.name.trim() : "";
    const character = data && typeof data.character === "string" ? data.character : "";
    const roomCode = data && typeof data.room === "string" ? data.room.trim().toUpperCase() : "";

    if (!name || !roomCode) {
      socket.emit("errorMessage", "Enter a valid name and lobby code.");
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

    room.players.push({ id: socket.id, name, character });
    socket.join(roomCode);

    // Both players are in — start the placement phase on both clients.
    io.to(roomCode).emit("gameStart", {
      room: roomCode,
      players: room.players.map((p) => ({ id: p.id, name: p.name, character: p.character }))
    });
  });

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

    // Validate: room exists and this socket is one of its players.
    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    // Validate: placement only happens once both players have joined.
    if (room.players.length < MAX_PLAYERS) {
      socket.emit("errorMessage", "Waiting for a second player before placement.");
      return;
    }
    // Validate: a confirmed placement cannot be changed.
    if (room.ready[socket.id]) {
      socket.emit("errorMessage", "You have already confirmed your position.");
      return;
    }
    // Validate: the square must be inside the 8x8 board.
    if (!isValidPosition(data.position)) {
      socket.emit("errorMessage", "Invalid board position.");
      return;
    }

    // Store the hidden position server-side only.
    room.positions[socket.id] = {
      row: data.position.row,
      col: data.position.col
    };
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
    startGame(room, roomCode);
  });

  /*
   * "playCard" — the active player plays exactly ONE card, which IS
   * their whole turn. There is no End Turn event; after the card
   * resolves it is discarded and the turn passes automatically.
   *
   * Payload: { roomCode, cardUid, target }
   *   - cardUid: unique id of a card instance in the sender's hand
   *   - target:  card-specific, validated per card:
   *       Scan Row -> { row }
   *       Attack   -> { row, col }
   *
   * The server validates everything: room membership, game running,
   * turn ownership, card ownership, card availability and target.
   */
  socket.on("playCard", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    // Validate: room exists and this socket is one of its players.
    if (!room || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const game = room.game;
    // Validate: the card game has started and is still running.
    if (!game || game.over) {
      socket.emit("errorMessage", "The game is not running.");
      return;
    }
    // Validate: only the active player may act.
    if (room.currentTurn !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }
    // Validate: the card must actually be in the sender's hand.
    const cardIndex = game.hands[socket.id].findIndex((c) => c.uid === data.cardUid);
    if (cardIndex === -1) {
      socket.emit("errorMessage", "That card is not in your hand.");
      return;
    }
    const card = game.hands[socket.id][cardIndex];
    // Validate: placeholder categories cannot be played yet.
    if (!CARD_LIBRARY[card.id].implemented) {
      socket.emit("errorMessage", "That card is not available yet.");
      return;
    }

    const target = data.target || {};

    if (card.id === "scanRow") {
      // Validate: the scanned row must be inside the board.
      if (!Number.isInteger(target.row) || target.row < 0 || target.row >= BOARD_SIZE) {
        socket.emit("errorMessage", "Invalid row.");
        return;
      }
      resolveScanRow(room, roomCode, socket, target);
      discardCard(game, socket.id, cardIndex);
      sendHandUpdate(room, socket.id);
      passTurn(room, roomCode); // playing a card IS the turn
      return;
    }

    if (card.id === "attack") {
      // Validate: the attacked square must be inside the board.
      if (!isValidPosition(target)) {
        socket.emit("errorMessage", "Invalid attack target.");
        return;
      }
      const won = resolveAttack(room, roomCode, socket, target);
      discardCard(game, socket.id, cardIndex);
      sendHandUpdate(room, socket.id);
      if (!won) {
        passTurn(room, roomCode); // miss: turn passes automatically
      }
      return;
    }
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
