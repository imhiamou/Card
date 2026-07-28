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

/*
 * Authoritative in-memory game state, keyed by room code:
 *
 * rooms = {
 *   ABC123: {
 *     players:   [{ id, name, character }, ...],
 *     positions: { <socketId>: { row, col }, ... },  // hidden squares
 *     ready:     { <socketId>: true/false, ... },    // confirmed placement
 *     currentTurn: <socketId> | null                 // whose turn it is
 *   }
 * }
 *
 * Positions are NEVER sent to the opposing client — the server keeps
 * them private and validates every action itself.
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

// Validate a placement payload: integer row/col within the 8x8 board.
function isValidPosition(position) {
  return (
    position &&
    Number.isInteger(position.row) &&
    Number.isInteger(position.col) &&
    position.row >= 0 && position.row < BOARD_SIZE &&
    position.col >= 0 && position.col < BOARD_SIZE
  );
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
      currentTurn: null
    };

    socket.join(roomCode);
    socket.emit("lobbyCreated", { room: roomCode });
  });

  /*
   * "joinLobby" — a second player joins an existing lobby.
   * Payload: { name, character, room }
   * On success emits "gameStart" { room } to both players in the room,
   * which moves both clients into the character placement phase.
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
    io.to(roomCode).emit("gameStart", { room: roomCode });
  });

  /*
   * "placeCharacter" — a player confirms their hidden square.
   * Payload: { roomCode, position: { row, col } }
   *
   * The server stores the position privately, marks the player ready
   * and then either:
   *   - emits "waitingOpponent" ONLY to this player (opponent not
   *     ready yet), or
   *   - emits "bothPlayersReady" to the whole room, randomly picks a
   *     starting player, and emits "gameStarted" { yourTurn } to each
   *     player individually.
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

    // Randomly choose which player starts. The server is the single
    // source of truth for whose turn it is.
    const startingPlayer = room.players[Math.floor(Math.random() * room.players.length)];
    room.currentTurn = startingPlayer.id;

    // "gameStarted" — sent to each player individually so each client
    // only learns whether it is THEIR turn (no opponent info leaks).
    room.players.forEach((player) => {
      io.to(player.id).emit("gameStarted", {
        yourTurn: player.id === room.currentTurn
      });
    });
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
