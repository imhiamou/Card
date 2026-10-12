"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const uno = require("./uno");
const fit = require("../assets/uno-hand-fit");

function fakeIo() {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(name, data) {
          events.push({ room, name, data });
        }
      };
    }
  };
}

function fakeSocket(id) {
  const handlers = {};
  const emitted = [];
  return {
    id,
    handlers,
    emitted,
    on(name, fn) { handlers[name] = fn; },
    emit(name, data) { emitted.push({ name, data }); },
    leave() { this.left = true; }
  };
}

function makeRoom(ids) {
  return {
    gameMode: "uno",
    maxPlayers: ids.length,
    players: ids.map((id) => ({ id, name: id.toUpperCase(), isBot: false })),
    unoBotTimer: null,
    unoAway: {},
    unoRematch: {}
  };
}

function otherThan(room, id) {
  return room.players.find((player) => player.id !== id).id;
}

test("returning to the lobby on your turn ends a two-player round", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = room.uno.currentTurn;
  const winner = otherThan(room, leaver);
  let fired = false;
  room.unoBotTimer = setTimeout(() => { fired = true; }, 5000);
  const io = fakeIo();
  const result = uno.leaveTable(room, io, "ROOM", leaver);
  assert.equal(result.ok, true);
  assert.equal(result.ended, true);
  assert.equal(room.uno.over, true);
  assert.equal(room.uno.winnerId, winner);
  assert.equal(room.unoBotTimer, null);
  assert.equal(fired, false);
  assert.equal(uno.isAway(room, leaver), true);
  assert.equal(room.players.some((player) => player.id === leaver), true);
  const over = io.events.find((event) => event.name === "unoOver");
  assert.match(over.data.message, /left the table/);
  assert.equal(over.data.winnerId, winner);
  clearTimeout(room.unoBotTimer);
});

test("returning to the lobby during the opponent's turn still ends the round", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = "a";
  const opponent = "b";
  room.uno.currentTurn = opponent;
  room.uno.turnIndex = room.players.findIndex((player) => player.id === opponent);
  const io = fakeIo();
  const result = uno.leaveTable(room, io, "ROOM", leaver);
  assert.equal(result.ended, true);
  assert.equal(room.uno.over, true);
  assert.equal(room.uno.winnerId, opponent);
  assert.notEqual(room.uno.currentTurn, leaver);
});

test("a third player keeps playing when one person returns to the lobby", () => {
  const room = makeRoom(["a", "b", "c"]);
  uno.initRound(room);
  room.uno.currentTurn = "a";
  room.uno.turnIndex = 0;
  room.uno.pendingColorChooser = "a";
  room.uno.pendingWildCardId = "wild-staged";
  room.uno.awaitingDrawnPlay = { cardId: "drawn" };
  const before = (room.uno.hands.b || []).length;
  const io = fakeIo();
  const result = uno.leaveTable(room, io, "ROOM", "a");
  assert.equal(result.ended, false);
  assert.equal(room.uno.over, false);
  assert.notEqual(room.uno.currentTurn, "a");
  assert.equal(uno.isAway(room, "a"), true);
  assert.equal(room.uno.pendingColorChooser, null);
  assert.equal(room.uno.pendingWildCardId, null);
  assert.equal(room.uno.awaitingDrawnPlay, null);
  assert.equal(room.uno.hands.b.length, before);
  assert.equal(room.players.length, 3);
});

test("leaving the room removes membership and does not wait on that turn", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = room.uno.currentTurn;
  const winner = otherThan(room, leaver);
  const io = fakeIo();
  const socket = { left: false, leave() { this.left = true; } };
  const result = uno.leaveRoom(room, io, "ROOM", leaver, socket);
  assert.equal(result.ok, true);
  assert.equal(socket.left, true);
  assert.equal(room.players.some((player) => player.id === leaver), false);
  assert.equal(room.uno.hands[leaver], undefined);
  assert.equal(room.uno.over, true);
  assert.equal(room.uno.winnerId, winner);
  const over = io.events.find((event) => event.name === "unoOver");
  assert.match(over.data.message, /left the room/);
});

test("leaving a full room keeps the current turn when someone else exits", () => {
  const room = makeRoom(["a", "b", "c"]);
  uno.initRound(room);
  room.uno.currentTurn = "c";
  room.uno.turnIndex = 2;
  room.uno.direction = 1;
  const io = fakeIo();
  uno.leaveRoom(room, io, "ROOM", "a", { leave() {} });
  assert.equal(room.uno.over, false);
  assert.equal(room.uno.currentTurn, "c");
  assert.equal(room.uno.turnIndex, room.players.findIndex((player) => player.id === "c"));
  assert.deepEqual(room.players.map((player) => player.id), ["b", "c"]);
});

test("the next seated player takes the turn when the current player leaves the room", () => {
  const room = makeRoom(["a", "b", "c"]);
  uno.initRound(room);
  room.uno.currentTurn = "b";
  room.uno.turnIndex = 1;
  room.uno.direction = 1;
  const io = fakeIo();
  uno.leaveRoom(room, io, "ROOM", "b", { leave() {} });
  assert.equal(room.uno.over, false);
  assert.equal(room.uno.currentTurn, "c");
  assert.equal(room.players.some((player) => player.id === "b"), false);
});

test("the last human leaving deletes the room", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const rooms = { ROOM: room };
  uno.rememberRooms(rooms);
  const io = fakeIo();
  uno.leaveRoom(room, io, "ROOM", "a", { leave() {} });
  assert.equal(rooms.ROOM, room);
  uno.leaveRoom(room, io, "ROOM", "b", { leave() {} });
  assert.equal(rooms.ROOM, undefined);
});

test("a second leave does not corrupt the table", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = room.uno.currentTurn;
  const io = fakeIo();
  uno.leaveTable(room, io, "ROOM", leaver);
  const again = uno.leaveTable(room, io, "ROOM", leaver);
  assert.equal(again.ok, true);
  assert.equal(room.players.length, 2);
  assert.equal(room.uno.over, true);
  assert.equal(room.uno.winnerId, otherThan(room, leaver));
  const missing = uno.leaveRoom(room, io, "ROOM", "nobody", { leave() {} });
  assert.equal(missing.ok, false);
});

test("the next round deals the player who only returned to the lobby", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = room.uno.currentTurn;
  uno.leaveTable(room, fakeIo(), "ROOM", leaver);
  assert.equal(uno.isAway(room, leaver), true);
  uno.initRound(room);
  assert.equal(uno.isAway(room, leaver), false);
  assert.ok(room.uno.hands[leaver].length >= 7);
  assert.equal(room.uno.over, false);
  assert.equal(room.players.some((player) => player.id === leaver), true);
});

test("an away player cannot play, and play again does not wait for them", () => {
  const room = makeRoom(["a", "b"]);
  uno.initRound(room);
  const leaver = room.uno.currentTurn;
  const stayer = otherThan(room, leaver);
  const io = fakeIo();
  uno.leaveTable(room, io, "ROOM", leaver);
  const rooms = { ROOM: room };
  const away = fakeSocket(leaver);
  const stay = fakeSocket(stayer);
  uno.registerSocket(away, io, rooms);
  uno.registerSocket(stay, io, rooms);
  const handSize = (room.uno.hands[leaver] || []).length;
  away.handlers.unoPlayCard({ roomCode: "ROOM", cardId: "c1" });
  assert.match(away.emitted.at(-1).data, /left the UNO table/);
  assert.equal((room.uno.hands[leaver] || []).length, handSize);
  away.handlers.unoPlayAgain({ roomCode: "ROOM" });
  assert.equal(room.uno.over, true);
  assert.equal(away.emitted.at(-1).name, "unoPlayAgainWait");
  stay.handlers.unoPlayAgain({ roomCode: "ROOM" });
  assert.equal(room.uno.over, false);
  assert.equal(uno.isAway(room, leaver), false);
  assert.ok(io.events.some((event) => event.name === "unoStarted" && event.room === leaver));
});

test("a player who left the room cannot act in it", () => {
  const room = makeRoom(["a", "b", "c"]);
  uno.initRound(room);
  const rooms = { ROOM: room };
  const io = fakeIo();
  const leaver = fakeSocket("a");
  uno.registerSocket(leaver, io, rooms);
  leaver.handlers.unoLeaveRoom({ roomCode: "ROOM" });
  assert.equal(room.players.some((player) => player.id === "a"), false);
  assert.equal(leaver.emitted.some((event) => event.name === "unoLeftRoom"), true);
  leaver.handlers.unoPlayCard({ roomCode: "ROOM", cardId: "c1" });
  assert.match(leaver.emitted.at(-1).data, /not in this lobby/);
  leaver.handlers.unoDraw({ roomCode: "ROOM" });
  assert.match(leaver.emitted.at(-1).data, /not in this lobby/);
});

test("waiting lobby updates when someone leaves before the deal", () => {
  const room = makeRoom(["a", "b"]);
  room.uno = null;
  const io = fakeIo();
  uno.leaveRoom(room, io, "ROOM", "a", { leave() {} });
  const update = io.events.find((event) => event.name === "unoLobbyUpdate");
  assert.ok(update);
  assert.deepEqual(update.data.players.map((player) => player.id), ["b"]);
  assert.equal(room.players.length, 1);
});

test("hand fit keeps every card inside the box", () => {
  const few = fit.fit(2, 360, 180);
  const many = fit.fit(15, 360, 180);
  assert.ok(few.width > many.width);
  assert.ok(few.cols * few.rows >= 2);
  assert.ok(many.cols * many.rows >= 15);
  assert.ok(many.width >= 28);
  assert.ok(many.height >= 42);
  const usedW = many.width * many.cols + many.gap * Math.max(0, many.cols - 1);
  const usedH = many.height * many.rows + many.gap * Math.max(0, many.rows - 1);
  assert.ok(usedW <= 360);
  assert.ok(usedH <= 180);
  const portrait = fit.fit(20, 340, 190);
  assert.ok(portrait.cols * portrait.rows >= 20);
  assert.ok(portrait.width >= 28);
});

test("UNO menu matches the Dominoes controls and has no hand pager", () => {
  const client = fs.readFileSync(path.join(__dirname, "../uno.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../uno.css"), "utf8");
  const appCss = fs.readFileSync(path.join(__dirname, "../assets/mobile-app.css"), "utf8");
  ["Return to Lobby", "Leave Room", "Volume −", "Volume +", "Mute", "Bot speed", "unoLeaveTable", "unoLeaveRoom", "unoBgm"].forEach((text) => {
    assert.match(client, new RegExp(text));
  });
  assert.doesNotMatch(client, /unoHandPrev|unoHandPager|unoHandNext/);
  assert.match(css, /\.unoTopTools/);
  assert.match(css, /grid-template-columns:repeat\(var\(--hand-cols/);
  assert.match(appCss, /#unoScreen\.app-menu-open \.unoTopTools/);
  assert.match(appCss, /\.unoHandPager/);
  const server = fs.readFileSync(path.join(__dirname, "uno.js"), "utf8");
  assert.match(server, /left the table/);
  assert.match(server, /left the room/);
});
