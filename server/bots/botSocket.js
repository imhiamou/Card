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

function createBotSocket(botId) {
  const handlers = {};
  return {
    id: botId,
    isBotSocket: true,
    handlers,
    // registerSocket() calls socket.on(...) — capture the handlers so the
    // bot scheduler can trigger them like incoming client events.
    on(event, fn) {
      handlers[event] = fn;
    },
    // Direct replies (e.g. errorMessage) are no-ops for bots.
    emit() {},
    join() {},
    leave() {}
  };
}

module.exports = { createBotSocket };
