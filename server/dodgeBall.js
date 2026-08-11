/*
 * Dodge Ball — isolated realtime 1v1 (server-authoritative).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Word Chain, Code Breaker, Dominoes, or UNO handlers.
 * Uses its own Socket.IO events so it cannot collide with existing traffic.
 *
 * Arena: logical 800x450. Center line at x=400.
 * Player 1 (lobby creator) left half; Player 2 right half.
 * Simultaneous movement/aim/throw. Hits and HP decided only on the server.
 */

const ARENA_W = 800;
const ARENA_H = 450;
const CENTER_X = ARENA_W / 2;
const PLAYER_R = 28;
const BALL_R = 14;
const PLAYER_SPEED = 240;
const BALL_SPEED = 420;
const MAX_HP = 100;
const HIT_DAMAGE = 25;
const THROW_COOLDOWN_MS = 2000;
const TICK_MS = 50; // 20 Hz
const COUNTDOWN_SEC = 3;
const INPUT_STALE_MS = 300;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function len(x, y) {
  return Math.sqrt(x * x + y * y) || 0;
}

function norm(x, y) {
  const d = len(x, y);
  if (d < 1e-6) return { x: 0, y: 0 };
  return { x: x / d, y: y / d };
}

function stopTick(room) {
  if (!room || !room.db) return;
  if (room.db.tick) {
    clearInterval(room.db.tick);
    room.db.tick = null;
  }
}

function stopCountdown(room) {
  if (!room || !room.db) return;
  if (room.db.countdownTimer) {
    clearTimeout(room.db.countdownTimer);
    room.db.countdownTimer = null;
  }
}

function stopRoom(room) {
  stopTick(room);
  stopCountdown(room);
}

function defaultAim(side) {
  return side === "left" ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

function makePlayer(id, name, side, index) {
  const aim = defaultAim(side);
  return {
    id,
    name,
    index, // 1 or 2
    side,
    x: side === "left" ? ARENA_W * 0.22 : ARENA_W * 0.78,
    y: ARENA_H * 0.5,
    vx: 0,
    vy: 0,
    aimX: aim.x,
    aimY: aim.y,
    hp: MAX_HP,
    cooldownUntil: 0,
    hitFlashUntil: 0,
    moving: false,
    input: { mx: 0, my: 0, aimX: aim.x, aimY: aim.y, at: 0 }
  };
}

function clampPlayerPos(p) {
  const minY = PLAYER_R;
  const maxY = ARENA_H - PLAYER_R;
  p.y = clamp(p.y, minY, maxY);
  if (p.side === "left") {
    p.x = clamp(p.x, PLAYER_R, CENTER_X - PLAYER_R);
  } else {
    p.x = clamp(p.x, CENTER_X + PLAYER_R, ARENA_W - PLAYER_R);
  }
}

function initRoomState(room) {
  stopRoom(room);
  const p1 = room.players[0];
  const p2 = room.players[1];
  room.db = {
    phase: "countdown", // countdown | playing | over
    countdown: COUNTDOWN_SEC,
    players: {
      [p1.id]: makePlayer(p1.id, p1.name, "left", 1),
      [p2.id]: makePlayer(p2.id, p2.name, "right", 2)
    },
    projectiles: [],
    nextBallId: 1,
    winnerId: null,
    winnerName: null,
    tick: null,
    countdownTimer: null,
    seq: 0
  };
  room.dbRematch = {};
}

function publicPlayers(db) {
  return Object.values(db.players).map((p) => ({
    id: p.id,
    name: p.name,
    index: p.index,
    side: p.side,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    aimX: Math.round(p.aimX * 1000) / 1000,
    aimY: Math.round(p.aimY * 1000) / 1000,
    hp: p.hp,
    cooldownUntil: p.cooldownUntil,
    hitFlashUntil: p.hitFlashUntil,
    moving: !!p.moving
  }));
}

function publicProjectiles(db) {
  return db.projectiles.map((b) => ({
    id: b.id,
    ownerId: b.ownerId,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10
  }));
}

function emitState(room, io, roomCode, extra) {
  const db = room.db;
  if (!db) return;
  db.seq += 1;
  const payload = Object.assign(
    {
      room: roomCode,
      game: "dodge-ball",
      seq: db.seq,
      phase: db.phase,
      countdown: db.countdown,
      now: Date.now(),
      arena: { w: ARENA_W, h: ARENA_H, centerX: CENTER_X },
      players: publicPlayers(db),
      projectiles: publicProjectiles(db),
      winnerId: db.winnerId,
      winnerName: db.winnerName,
      maxHp: MAX_HP,
      hitDamage: HIT_DAMAGE,
      cooldownMs: THROW_COOLDOWN_MS
    },
    extra || {}
  );
  // "dodgeBallState" — Dodge Ball only. Shared authoritative snapshot.
  io.to(roomCode).emit("dodgeBallState", payload);
}

function endGame(room, io, roomCode, winner) {
  const db = room.db;
  if (!db || db.phase === "over") return;
  db.phase = "over";
  db.winnerId = winner.id;
  db.winnerName = winner.name;
  db.projectiles = [];
  stopRoom(room);
  // "dodgeBallOver" — Dodge Ball only.
  io.to(roomCode).emit("dodgeBallOver", {
    winnerId: winner.id,
    winnerName: winner.name,
    winnerIndex: winner.index,
    message: "PLAYER " + winner.index + " WINS",
    players: publicPlayers(db)
  });
  emitState(room, io, roomCode);
}

function circleHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

function simulate(room, io, roomCode, dt) {
  const db = room.db;
  if (!db || db.phase !== "playing") return;

  const now = Date.now();
  const list = Object.values(db.players);

  // Movement from latest input (server clamps to own half).
  list.forEach((p) => {
    const inp = p.input || { mx: 0, my: 0 };
    const stale = !inp.at || now - inp.at > INPUT_STALE_MS;
    let mx = stale ? 0 : clamp(Number(inp.mx) || 0, -1, 1);
    let my = stale ? 0 : clamp(Number(inp.my) || 0, -1, 1);
    const m = norm(mx, my);
    p.vx = m.x * PLAYER_SPEED;
    p.vy = m.y * PLAYER_SPEED;
    p.moving = len(p.vx, p.vy) > 1;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    clampPlayerPos(p);

    if (typeof inp.aimX === "number" && typeof inp.aimY === "number") {
      const a = norm(inp.aimX, inp.aimY);
      if (len(a.x, a.y) > 0.01) {
        p.aimX = a.x;
        p.aimY = a.y;
      }
    }
  });

  // Projectiles: move, despawn on walls, collide with opponent only.
  const remaining = [];
  for (let i = 0; i < db.projectiles.length; i++) {
    const b = db.projectiles[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (
      b.x < -BALL_R ||
      b.x > ARENA_W + BALL_R ||
      b.y < -BALL_R ||
      b.y > ARENA_H + BALL_R
    ) {
      continue; // leave arena — disappear
    }

    let hit = false;
    for (let j = 0; j < list.length; j++) {
      const target = list[j];
      if (target.id === b.ownerId) continue;
      if (circleHit(b.x, b.y, BALL_R, target.x, target.y, PLAYER_R)) {
        target.hp = Math.max(0, target.hp - HIT_DAMAGE);
        target.hitFlashUntil = now + 280;
        hit = true;
        // "dodgeBallHit" — Dodge Ball only. Server-validated collision.
        io.to(roomCode).emit("dodgeBallHit", {
          projectileId: b.id,
          ownerId: b.ownerId,
          targetId: target.id,
          damage: HIT_DAMAGE,
          hp: target.hp,
          x: target.x,
          y: target.y
        });
        if (target.hp <= 0) {
          const winner = list.find((p) => p.id !== target.id);
          if (winner) endGame(room, io, roomCode, winner);
        }
        break;
      }
    }
    if (!hit && db.phase === "playing") remaining.push(b);
  }
  db.projectiles = remaining;
}

function startLoop(room, io, roomCode) {
  // Only restart the physics/broadcast tick — do not cancel an in-flight countdown.
  stopTick(room);
  let last = Date.now();
  room.db.tick = setInterval(() => {
    if (!roomsAlive(room) || !room.db) {
      stopRoom(room);
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (room.db.phase === "playing") {
      simulate(room, io, roomCode, dt);
    }
    if (room.db && room.db.phase !== "over") {
      emitState(room, io, roomCode);
    }
  }, TICK_MS);
}

function roomsAlive(room) {
  return !!(room && room.players && room.players.length === 2);
}

function beginCountdown(room, io, roomCode) {
  const db = room.db;
  db.phase = "countdown";
  db.countdown = COUNTDOWN_SEC;
  emitState(room, io, roomCode, { event: "countdown" });
  // "dodgeBallCountdown" — Dodge Ball only.
  io.to(roomCode).emit("dodgeBallCountdown", { value: db.countdown, label: String(db.countdown) });

  const step = () => {
    if (!room.db || room.db !== db) return;
    db.countdown -= 1;
    if (db.countdown > 0) {
      io.to(roomCode).emit("dodgeBallCountdown", { value: db.countdown, label: String(db.countdown) });
      emitState(room, io, roomCode);
      db.countdownTimer = setTimeout(step, 1000);
      return;
    }
    io.to(roomCode).emit("dodgeBallCountdown", { value: 0, label: "GO!" });
    db.phase = "playing";
    db.countdown = 0;
    emitState(room, io, roomCode);
    startLoop(room, io, roomCode);
  };
  db.countdownTimer = setTimeout(step, 1000);
  // Keep light state updates during countdown for positions/UI.
  startLoop(room, io, roomCode);
}

/*
 * Called when both players have joined a lobby whose gameMode is
 * "dodge-ball". Never called for other games.
 */
function onBothPlayersJoined(room, io, roomCode) {
  initRoomState(room);
  room.players.forEach((player) => {
    const me = room.db.players[player.id];
    // "dodgeBallStarted" — Dodge Ball only. Launches the Dodge Ball UI.
    io.to(player.id).emit("dodgeBallStarted", {
      room: roomCode,
      game: "dodge-ball",
      you: { id: player.id, index: me.index, side: me.side, name: me.name },
      players: publicPlayers(room.db),
      arena: { w: ARENA_W, h: ARENA_H, centerX: CENTER_X },
      maxHp: MAX_HP,
      hitDamage: HIT_DAMAGE,
      cooldownMs: THROW_COOLDOWN_MS
    });
  });
  beginCountdown(room, io, roomCode);
}

function findPlayer(room, socketId) {
  return room.db && room.db.players ? room.db.players[socketId] : null;
}

function registerSocket(socket, io, rooms) {
  /*
   * "dodgeBallInput" — Dodge Ball only.
   * Payload: { roomCode, mx, my, aimX, aimY }
   * Movement intent and aim; server integrates and clamps.
   */
  socket.on("dodgeBallInput", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dodge-ball" || !room.db) return;
    if (!room.players.some((p) => p.id === socket.id)) return;
    const p = findPlayer(room, socket.id);
    if (!p) return;
    p.input = {
      mx: clamp(Number(data.mx) || 0, -1, 1),
      my: clamp(Number(data.my) || 0, -1, 1),
      aimX: Number(data.aimX),
      aimY: Number(data.aimY),
      at: Date.now()
    };
    if (typeof data.aimX === "number" && typeof data.aimY === "number") {
      const a = norm(data.aimX, data.aimY);
      if (len(a.x, a.y) > 0.01) {
        p.aimX = a.x;
        p.aimY = a.y;
      }
    }
  });

  /*
   * "dodgeBallThrow" — Dodge Ball only.
   * Payload: { roomCode, aimX, aimY }
   * Server spawns the projectile after cooldown/phase checks.
   * Clients never report hits.
   */
  socket.on("dodgeBallThrow", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];
    if (!room || room.gameMode !== "dodge-ball") {
      socket.emit("errorMessage", "You are not in a Dodge Ball lobby.");
      return;
    }
    if (!room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    const db = room.db;
    if (!db || db.phase !== "playing") return;
    const p = findPlayer(room, socket.id);
    if (!p) return;

    const now = Date.now();
    if (now < p.cooldownUntil) return;

    let ax = typeof data.aimX === "number" ? data.aimX : p.aimX;
    let ay = typeof data.aimY === "number" ? data.aimY : p.aimY;
    const a = norm(ax, ay);
    if (len(a.x, a.y) < 0.01) {
      const d = defaultAim(p.side);
      a.x = d.x;
      a.y = d.y;
    }
    p.aimX = a.x;
    p.aimY = a.y;
    p.cooldownUntil = now + THROW_COOLDOWN_MS;

    const spawnDist = PLAYER_R + BALL_R + 2;
    const ball = {
      id: db.nextBallId++,
      ownerId: p.id,
      x: p.x + a.x * spawnDist,
      y: p.y + a.y * spawnDist,
      vx: a.x * BALL_SPEED,
      vy: a.y * BALL_SPEED
    };
    db.projectiles.push(ball);

    // "dodgeBallThrowAck" — Dodge Ball only. Confirm spawn + cooldown.
    io.to(roomCode).emit("dodgeBallThrowAck", {
      projectile: {
        id: ball.id,
        ownerId: ball.ownerId,
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy
      },
      ownerId: p.id,
      cooldownUntil: p.cooldownUntil
    });
  });

  /*
   * "dodgeBallPlayAgain" — Dodge Ball only.
   * Both players must vote; then positions/HP/projectiles reset and countdown restarts.
   */
  socket.on("dodgeBallPlayAgain", (data) => {
    const roomCode = data && typeof data.roomCode === "string" ? data.roomCode.trim().toUpperCase() : "";
    const room = rooms[roomCode];

    if (!room || room.gameMode !== "dodge-ball" || !room.players.some((p) => p.id === socket.id)) {
      socket.emit("errorMessage", "You are not in this lobby.");
      return;
    }
    if (!room.db || room.db.phase !== "over") {
      socket.emit("errorMessage", "The round is still going.");
      return;
    }

    if (!room.dbRematch) room.dbRematch = {};
    room.dbRematch[socket.id] = true;

    if (!room.players.every((p) => room.dbRematch[p.id])) {
      // "dodgeBallPlayAgainWait" — Dodge Ball only.
      socket.emit("dodgeBallPlayAgainWait");
      return;
    }

    room.dbRematch = {};
    // "dodgeBallReset" — Dodge Ball only. Fresh round in the same lobby.
    io.to(roomCode).emit("dodgeBallReset");
    onBothPlayersJoined(room, io, roomCode);
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  stopRoom,
  ARENA_W,
  ARENA_H,
  MAX_HP,
  HIT_DAMAGE,
  THROW_COOLDOWN_MS
};
