const { getGameMode, isValidGameMode } = require("./registry");

const MAX_PLAYERS = 2;
const PLAYER_NAMES = ["Wolf", "Mermaid"];
const CHARACTERS = ["Knight", "Mage", "Hunter", "Rogue"];
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,8}$/;

/*
 * Shared lobby state. Each room stores its gameMode; game-specific
 * data lives on the room object but is only touched by that game's
 * module (Hidden Hunt: positions/ready/game, Word Chain: wc).
 */
const rooms = {};

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

function registerLobbyHandlers(socket, io) {

  /*
   * "createLobby" — host creates a lobby with a chosen code and game mode.
   * Payload: { name, character, room, gameMode }
   *   - character is required only when gameMode is Hidden Hunt
   * Replies with "lobbyCreated" { room, gameMode }.
   */
  socket.on("createLobby", (data) => {
    const name = data && typeof data.name === "string" ? data.name.trim() : "";
    const character = data && typeof data.character === "string" ? data.character : "";
    const roomCode = data && typeof data.room === "string" ? data.room.trim().toUpperCase() : "";
    const gameModeRaw = data && typeof data.gameMode === "string" ? data.gameMode.trim() : "";
    // Default to Hidden Hunt when the client omits gameMode (e.g. cached
    // frontend from before the multi-game platform update).
    const gameMode = gameModeRaw || "hidden-hunt";

    if (!PLAYER_NAMES.includes(name)) {
      socket.emit("errorMessage", "Choose a valid name.");
      return;
    }
    if (!isValidGameMode(gameMode)) {
      socket.emit("errorMessage", "Choose a valid game mode.");
      return;
    }
    const mode = getGameMode(gameMode);
    if (mode.requiresCharacter && !CHARACTERS.includes(character)) {
      socket.emit("errorMessage", "Choose a valid character.");
      return;
    }
    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      socket.emit("errorMessage", "Lobby code must be 4-8 letters or numbers.");
      return;
    }
    if (rooms[roomCode]) {
      socket.emit("errorMessage", "That lobby code is already taken.");
      return;
    }

    rooms[roomCode] = {
      gameMode,
      players: [{ id: socket.id, name, character: mode.requiresCharacter ? character : null }]
    };

    socket.join(roomCode);
    socket.emit("lobbyCreated", { room: roomCode, gameMode });
  });

  /*
   * "joinLobby" — second player joins. Payload: { name, character, room }
   * Character is validated only for Hidden Hunt lobbies.
   * When both players are in, emits "gameStart" { room, gameMode, players }
   * and delegates to the selected game module to begin play.
   */
  socket.on("joinLobby", (data) => {
    const name = data && typeof data.name === "string" ? data.name.trim() : "";
    const character = data && typeof data.character === "string" ? data.character : "";
    const roomCode = data && typeof data.room === "string" ? data.room.trim().toUpperCase() : "";

    if (!PLAYER_NAMES.includes(name)) {
      socket.emit("errorMessage", "Choose a valid name.");
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

    const mode = getGameMode(room.gameMode);
    if (mode.requiresCharacter && !CHARACTERS.includes(character)) {
      socket.emit("errorMessage", "Choose a valid character.");
      return;
    }

    room.players.push({
      id: socket.id,
      name,
      character: mode.requiresCharacter ? character : null
    });
    socket.join(roomCode);

    const payload = {
      room: roomCode,
      gameMode: room.gameMode,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character
      }))
    };

    io.to(roomCode).emit("gameStart", payload);

    // Let the game module initialise server-side state and emit any
    // extra start events (e.g. Word Chain starts immediately).
    if (typeof mode.onBothPlayersJoined === "function") {
      mode.onBothPlayersJoined(room, io, { getOpponent });
    }
  });

  /*
   * Disconnect — notify the opponent and remove the room.
   */
  socket.on("disconnect", () => {
    const roomCode = findRoomOfSocket(socket.id);
    if (!roomCode) return;
    socket.to(roomCode).emit("playerLeft");
    delete rooms[roomCode];
  });
}

module.exports = {
  rooms,
  findRoomOfSocket,
  getOpponent,
  registerLobbyHandlers,
  PLAYER_NAMES,
  CHARACTERS
};
