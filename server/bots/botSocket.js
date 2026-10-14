/*
 * Bot socket adapter — Dominoes & UNO bots only.
 *
 * Bots are driven through the SAME Socket.IO event handlers as human
 * players. A bot gets a fake "socket" whose registered handlers are
 * stored locally; the game modules invoke them directly. This means a
 * bot's action passes through exactly the same validation code path as
 * a human's, and a bot can never bypass game rules.
 *
 * Real Socket.IO emissions targeted at a bot id (io.to(botId)) go to a
 * non-existent room and are silently dropped, so bot-private data is
 * never delivered to any browser.
 */

function gameFromEvent(event) {
  if (typeof event === "string" && event.indexOf("uno") === 0) return "uno";
  if (typeof event === "string" && event.indexOf("domino") === 0) return "dominoes";
  return "unknown";
}

function createBotSocket(botId) {
  const handlers = {};
  const socket = {
    id: botId,
    isBotSocket: true,
    botGame: null,
    botRoom: null,
    botAction: null,
    handlers,
    // registerSocket() calls socket.on(...) — capture the handlers so the
    // bot scheduler can trigger them like incoming client events.
    on(event, fn) {
      handlers[event] = (data) => {
        socket.botAction = event;
        socket.botGame = gameFromEvent(event);
        if (data && typeof data.roomCode === "string" && data.roomCode) {
          socket.botRoom = data.roomCode;
        }
        return fn(data);
      };
    },
    // Rule rejections are logged for the server. Private hands are never
    // included. Other emits stay local to this fake socket.
    emit(event, payload) {
      if (event !== "errorMessage") return;
      const error = typeof payload === "string" ? payload : "rejected";
      console.warn(
        "[bot] action rejected game=%s room=%s bot=%s action=%s error=%s",
        socket.botGame || "unknown",
        socket.botRoom || "unknown",
        botId,
        socket.botAction || "unknown",
        error
      );
    },
    join() {},
    leave() {}
  };
  return socket;
}

module.exports = { createBotSocket };
