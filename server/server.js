const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { registerLobbyHandlers, rooms, getOpponent } = require("./lobby");
const { GAME_MODES } = require("./registry");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.get("/", (req, res) => {
  res.send("Multi-game platform server is running.");
});

// Pre-load the dictionary so the first Word Chain word is instant.
require("./dictionary");

io.on("connection", (socket) => {
  registerLobbyHandlers(socket, io);

  // Each registered game module attaches its own Socket.IO handlers.
  Object.values(GAME_MODES).forEach((game) => {
    game.registerSocket(socket, io, { rooms, getOpponent });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Multi-game server listening on port " + PORT);
  console.log("Game modes:", Object.values(GAME_MODES).map((g) => g.name).join(", "));
});
