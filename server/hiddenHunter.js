/*
 * Hidden Hunter — isolated 2-player coop (server-authoritative).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Word Chain, Code Breaker, Dominoes, UNO, or Dodge Ball.
 * Monster coordinates are emitted only to the Tracker.
 */

const { randomInt } = require("crypto");
const hhMaps = require("./hhMapStore");

const DEFAULT_SNAP = hhMaps.snapshot("default");
const DEFAULT_NAV = hhMaps.buildNav(DEFAULT_SNAP);
const MAP_W = DEFAULT_SNAP.width;
const MAP_H = DEFAULT_SNAP.height;
const OBSTACLES = DEFAULT_SNAP.objects;
const PLAYER_R = 22;
const MONSTER_R = 26;
const BULLET_R = 5;
const PLAYER_SPEED = 210;
const MONSTER_BASE_SPEED = 138;
const MONSTER_NORMAL_SPEED = MONSTER_BASE_SPEED;
const MONSTER_SPEED = MONSTER_NORMAL_SPEED;
const MONSTER_ANGRY_SPEED = 228;
const MONSTER_ANGRY_DURATION = 5000;
const MONSTER_ESCAPE_DIST = 380;
const MONSTER_RUSH_RANGE = 320;
const MONSTER_RUSH_SPEED = 276;
const MONSTER_RUSH_DURATION = 1000;
const MONSTER_RUSH_COOLDOWN = 10000;
const MONSTER_RUSH_WINDUP = 650;
const MONSTER_RUSH_RECOVER = 700;
const MONSTER_RUSH_DAMAGE = 25;
const BULLET_SPEED = 640;
const TICK_MS = 50;
const MATCH_MS = 5 * 60 * 1000;
const MONSTER_HP = 100 * 3;
const DAMAGE = 25;
const MAGAZINE_SIZE = 6;
const FIRE_COOLDOWN_MS = 500;
const RELOAD_MS = 1500;
const INPUT_STALE_MS = 350;
const COUNTDOWN_SEC = 3;
const TASER_COOLDOWN = 10000;
const TASER_RANGE = 500;
const STUN_MS = 2000;
const PLAYER_MAX_HEALTH = 100;
const MONSTER_ATTACK_RANGE = 75;
const MONSTER_DAMAGE = 25;
const MONSTER_ATTACK_COOLDOWN = 1000;
const STUCK_MS = 900;
const STUCK_DIST = 5;
const RETARGET_MS = 3800;
const PAUSE_MIN_MS = 280;
const PAUSE_MAX_MS = 720;

const SPAWNS = {
  hunter: { x: DEFAULT_SNAP.spawns.hunter.x, y: DEFAULT_SNAP.spawns.hunter.y },
  tracker: { x: DEFAULT_SNAP.spawns.tracker.x, y: DEFAULT_SNAP.spawns.tracker.y },
  monster: { x: DEFAULT_SNAP.spawns.monster.x, y: DEFAULT_SNAP.spawns.monster.y }
};
let activeNav = null;

function navNow() {
  return activeNav || DEFAULT_NAV;
}

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

function inBounds(cx, cy, r) {
  const nav = navNow();
  return cx >= r + 18 && cy >= r + 18 && cx <= nav.w - r - 18 && cy <= nav.h - r - 18;
}

function blocked(cx, cy, r) {
  return hhMaps.pointBlocked(navNow(), cx, cy, r);
}

function tryMove(ent, dx, dy, r) {
  const ox = ent.x;
  const oy = ent.y;
  const nx = ent.x + dx;
  const ny = ent.y + dy;
  if (!blocked(nx, ny, r)) {
    ent.x = nx;
    ent.y = ny;
    return true;
  }
  if (!blocked(nx, ent.y, r)) {
    ent.x = nx;
    return true;
  }
  if (!blocked(ent.x, ny, r)) {
    ent.y = ny;
    return true;
  }
  const speed = len(dx, dy);
  if (speed > 0.01) {
    const px = -dy / speed;
    const py = dx / speed;
    if (!blocked(ent.x + px * speed, ent.y + py * speed, r)) {
      ent.x += px * speed;
      ent.y += py * speed;
      return true;
    }
    if (!blocked(ent.x - px * speed, ent.y - py * speed, r)) {
      ent.x -= px * speed;
      ent.y -= py * speed;
      return true;
    }
  }
  return ent.x !== ox || ent.y !== oy;
}

function unstick(ent, r) {
  if (!blocked(ent.x, ent.y, r)) return false;
  const dists = [8, 16, 28, 44, 64];
  for (let d = 0; d < dists.length; d++) {
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const x = ent.x + Math.cos(ang) * dists[d];
      const y = ent.y + Math.sin(ang) * dists[d];
      if (!blocked(x, y, r)) {
        ent.x = x;
        ent.y = y;
        return true;
      }
    }
  }
  return false;
}

function walkableLine(x0, y0, x1, y1, r) {
  const d = len(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(d / 14));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (blocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return false;
  }
  return true;
}

function sameSpot(a, b, tol) {
  if (!a || !b) return false;
  return len(a.x - b.x, a.y - b.y) < (tol || 40);
}

function randomWalkable(r) {
  const nav = navNow();
  const spanX = Math.max(1, Math.floor(nav.w - 160));
  const spanY = Math.max(1, Math.floor(nav.h - 160));
  for (let i = 0; i < 40; i++) {
    const x = 80 + randomInt(spanX);
    const y = 80 + randomInt(spanY);
    if (!blocked(x, y, r)) return { x, y };
  }
  return { x: nav.w * 0.5, y: nav.h * 0.5 };
}

function pickMonsterTarget(m) {
  const failed = m.failedTargets || [];
  for (let i = 0; i < 28; i++) {
    const t = randomWalkable(MONSTER_R);
    if (sameSpot(t, m.target, 50)) continue;
    if (failed.some((f) => sameSpot(t, f, 55))) continue;
    if (walkableLine(m.x, m.y, t.x, t.y, MONSTER_R)) return t;
  }
  for (let i = 0; i < 20; i++) {
    const ang = (randomInt(360) * Math.PI) / 180;
    const dist = 90 + randomInt(200);
    const t = { x: m.x + Math.cos(ang) * dist, y: m.y + Math.sin(ang) * dist };
    if (blocked(t.x, t.y, MONSTER_R)) continue;
    if (failed.some((f) => sameSpot(t, f, 55))) continue;
    if (walkableLine(m.x, m.y, t.x, t.y, MONSTER_R)) return t;
  }
  return randomWalkable(MONSTER_R);
}

function rememberFailedTarget(m, target) {
  if (!target) return;
  m.failedTargets = m.failedTargets || [];
  m.failedTargets.push({ x: target.x, y: target.y });
  if (m.failedTargets.length > 8) m.failedTargets = m.failedTargets.slice(-8);
}

function stopLoop(room) {
  if (!room || !room.hh) return;
  if (room.hh.tick) {
    clearInterval(room.hh.tick);
    room.hh.tick = null;
  }
}

function stopCountdown(room) {
  if (!room || !room.hh) return;
  if (room.hh.countdownTimer) {
    clearTimeout(room.hh.countdownTimer);
    room.hh.countdownTimer = null;
  }
}

function stopRoom(room) {
  stopLoop(room);
  stopCountdown(room);
}

function makePlayer(id, name, role, spawns) {
  const table = spawns || SPAWNS;
  const spawn = table[role] || table.hunter || SPAWNS.hunter;
  return {
    id,
    name,
    role,
    x: spawn.x,
    y: spawn.y,
    aimX: 1,
    aimY: 0,
    ammo: MAGAZINE_SIZE,
    reloadingUntil: 0,
    cooldownUntil: 0,
    taserUntil: 0,
    hp: PLAYER_MAX_HEALTH,
    dead: false,
    input: { mx: 0, my: 0, aimX: 1, aimY: 0, at: 0 }
  };
}

function makeMonster(players, spawns) {
  const avoid = players ? Object.values(players) : [];
  let spawn = null;
  for (let i = 0; i < 50; i++) {
    const spot = randomWalkable(MONSTER_R);
    const clear = avoid.every((p) => len(p.x - spot.x, p.y - spot.y) > 380);
    if (clear) {
      spawn = spot;
      break;
    }
  }
  const fallback = (spawns && spawns.monster) || SPAWNS.monster;
  if (!spawn) spawn = { x: fallback.x, y: fallback.y };
  const m = {
    x: spawn.x,
    y: spawn.y,
    hp: MONSTER_HP,
    target: null,
    pauseUntil: 0,
    hitUntil: 0,
    stunned: false,
    stunEndTime: 0,
    lastX: spawn.x,
    lastY: spawn.y,
    lastMovedAt: Date.now(),
    nextRetargetAt: Date.now() + RETARGET_MS,
    attackUntil: 0,
    failedTargets: [],
    rushPhase: "idle",
    rushDir: { x: 1, y: 0 },
    rushTargetId: null,
    windupUntil: 0,
    rushUntil: 0,
    rushRecoverUntil: 0,
    rushCooldownUntil: 0,
    faceX: 1,
    faceY: 0,
    angryUntil: 0,
    escaping: false,
    escapeFromId: null
  };
  m.target = pickMonsterTarget(m);
  return m;
}

function initRoomState(room, swapRoles) {
  stopRoom(room);
  const snap = room.hhMapSnapshot || hhMaps.snapshot("default");
  activeNav = hhMaps.buildNav(snap);
  const a = room.players[0];
  const b = room.players[1];
  let hunterId;
  let trackerId;
  if (swapRoles && room.hh && room.hh.hunterId) {
    hunterId = room.hh.hunterId === a.id ? b.id : a.id;
    trackerId = hunterId === a.id ? b.id : a.id;
  } else if (randomInt(2) === 0) {
    hunterId = a.id;
    trackerId = b.id;
  } else {
    hunterId = b.id;
    trackerId = a.id;
  }
  const hunter = room.players.find((p) => p.id === hunterId);
  const tracker = room.players.find((p) => p.id === trackerId);
  const players = {
    [hunterId]: makePlayer(hunterId, hunter.name, "hunter", snap.spawns),
    [trackerId]: makePlayer(trackerId, tracker.name, "tracker", snap.spawns)
  };
  room.hh = {
    phase: "countdown",
    countdown: COUNTDOWN_SEC,
    hunterId,
    trackerId,
    players,
    monster: makeMonster(players, snap.spawns),
    nav: activeNav,
    publicMap: hhMaps.publicView(snap),
    projectiles: [],
    impacts: [],
    taserBeams: [],
    nextShotId: 1,
    endsAt: 0,
    result: null,
    tick: null,
    countdownTimer: null,
    seq: 0
  };
  room.hhRematch = {};
}

function intentMoving(p) {
  if (!p || p.dead || !p.input) return false;
  if (Date.now() - p.input.at > INPUT_STALE_MS) return false;
  return len(p.input.mx, p.input.my) > 0.12;
}

function publicPlayer(p, viewerRole) {
  // The Hunter must not receive the Tracker's aim. The Tracker's own screen
  // and the Hunter's aim (visible to the Tracker) still sync.
  const hideAim = p.role === "tracker" && viewerRole !== "tracker";
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    moving: intentMoving(p),
    aimX: hideAim ? null : Math.round(p.aimX * 1000) / 1000,
    aimY: hideAim ? null : Math.round(p.aimY * 1000) / 1000,
    ammo: p.role === "hunter" ? p.ammo : null,
    magazine: p.role === "hunter" ? MAGAZINE_SIZE : null,
    reloadingUntil: p.role === "hunter" ? p.reloadingUntil : 0,
    cooldownUntil: p.role === "hunter" ? p.cooldownUntil : 0,
    hp: p.hp,
    maxHp: PLAYER_MAX_HEALTH,
    dead: !!p.dead
  };
}

function publicProjectiles(hh) {
  return hh.projectiles.map((b) => ({
    id: b.id,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10
  }));
}

function publicImpacts(hh, now, role) {
  return hh.impacts
    .filter((i) => i.until > now)
    .map((i) => ({
      id: i.id,
      x: Math.round(i.x * 10) / 10,
      y: Math.round(i.y * 10) / 10,
      // Hunter gets a generic spark only — no "monster hit" label.
      kind: role === "hunter" && i.kind === "hit" ? "spark" : i.kind
    }));
}

function publicMonster(m) {
  const now = Date.now();
  return {
    x: Math.round(m.x * 10) / 10,
    y: Math.round(m.y * 10) / 10,
    hp: m.hp,
    maxHp: MONSTER_HP,
    hit: m.hitUntil > now,
    stunned: !!m.stunned && now < m.stunEndTime,
    moving: !!m.moving && m.hp > 0 && !(m.stunned && now < m.stunEndTime),
    windup: m.rushPhase === "windup",
    rushing: m.rushPhase === "rush",
    faceX: m.faceX || 0,
    faceY: m.faceY || 0
  };
}

function publicTaserBeams(hh, now) {
  return (hh.taserBeams || [])
    .filter((b) => b.until > now)
    .map((b) => ({
      id: b.id,
      x0: Math.round(b.x0 * 10) / 10,
      y0: Math.round(b.y0 * 10) / 10,
      x1: Math.round(b.x1 * 10) / 10,
      y1: Math.round(b.y1 * 10) / 10,
      hit: !!b.hit
    }));
}

function remainingMs(hh) {
  if (hh.phase !== "playing" || !hh.endsAt) return MATCH_MS;
  return Math.max(0, hh.endsAt - Date.now());
}

function buildStateFor(room, viewerId, roomCode, opts) {
  const hh = room.hh;
  const me = hh.players[viewerId];
  const role = me ? me.role : null;
  const payload = {
    room: roomCode,
    game: "hidden-hunter",
    seq: hh.seq,
    phase: hh.phase,
    countdown: hh.countdown,
    now: Date.now(),
    remainingMs: remainingMs(hh),
    map: hh.publicMap || { w: MAP_W, h: MAP_H, obstacles: OBSTACLES, texts: [] },
    you: me
      ? { id: me.id, name: me.name, role: me.role }
      : { id: viewerId, name: "", role: null },
    partnerRole: role === "hunter" ? "tracker" : role === "tracker" ? "hunter" : null,
    players: Object.values(hh.players).map((p) => publicPlayer(p, role)),
    projectiles: publicProjectiles(hh),
    impacts: publicImpacts(hh, Date.now(), role),
    result: hh.result,
    teamDead: !!(hh.result && hh.result !== "win"),
    weapon: {
      damage: DAMAGE,
      magazine: MAGAZINE_SIZE,
      cooldownMs: FIRE_COOLDOWN_MS,
      reloadMs: RELOAD_MS
    }
  };
  if (role === "tracker") {
    const tracker = hh.players[hh.trackerId];
    payload.monster = publicMonster(hh.monster);
    payload.taser = {
      cooldownMs: TASER_COOLDOWN,
      remainingMs: tracker ? Math.max(0, tracker.taserUntil - Date.now()) : 0,
      ready: tracker ? Date.now() >= tracker.taserUntil : false,
      range: TASER_RANGE
    };
    payload.taserBeams = publicTaserBeams(hh, Date.now());
  }
  if (opts && opts.includeMap === false) delete payload.map;
  return payload;
}

function emitStates(room, io, roomCode) {
  const hh = room.hh;
  if (!hh) return;
  hh.seq += 1;
  room.players.forEach((player) => {
    io.to(player.id).emit("hiddenHunterState", buildStateFor(room, player.id, roomCode, { includeMap: false }));
  });
}

function addImpact(hh, x, y, kind) {
  hh.impacts.push({
    id: hh.nextShotId++,
    x,
    y,
    kind,
    until: Date.now() + 280
  });
  if (hh.impacts.length > 20) hh.impacts = hh.impacts.slice(-12);
}

function overMessage(result) {
  if (result === "win") return "MONSTER ELIMINATED — TEAM VICTORY";
  if (result === "caught") return "YOU WERE CAUGHT — TEAM DEFEAT";
  return "TIME'S UP — THE MONSTER ESCAPED";
}

function markTeamDead(hh) {
  Object.values(hh.players).forEach((p) => {
    p.hp = 0;
    p.dead = true;
  });
}

function endMatch(room, io, roomCode, result) {
  const hh = room.hh;
  if (!hh || hh.phase === "over") return;
  hh.phase = "over";
  hh.result = result;
  hh.projectiles = [];
  hh.taserBeams = [];
  if (result === "caught") markTeamDead(hh);
  if (hh.monster) {
    hh.monster.stunned = false;
    hh.monster.attackUntil = Number.MAX_SAFE_INTEGER;
  }
  stopRoom(room);
  io.to(roomCode).emit("hiddenHunterOver", {
    room: roomCode,
    result: result,
    message: overMessage(result)
  });
  emitStates(room, io, roomCode);
}

function teamDefeat(room, io, roomCode) {
  const hh = room.hh;
  if (!hh || hh.phase === "over") return;
  markTeamDead(hh);
  endMatch(room, io, roomCode, "caught");
}

function nearestLiving(hh, x, y, maxDist) {
  let closest = null;
  let closestDist = maxDist;
  Object.values(hh.players).forEach((p) => {
    if (p.dead) return;
    const d = len(p.x - x, p.y - y);
    if (d < closestDist) {
      closest = p;
      closestDist = d;
    }
  });
  return closest;
}

function endRush(m, now) {
  m.rushPhase = "recover";
  m.rushRecoverUntil = now + MONSTER_RUSH_RECOVER;
  m.moving = false;
  m.rushTargetId = null;
}

function pickEscapeTarget(m, shooter) {
  const sx = shooter ? shooter.x : m.x - 1;
  const sy = shooter ? shooter.y : m.y;
  let away = norm(m.x - sx, m.y - sy);
  if (len(away.x, away.y) < 0.01) away = { x: 1, y: 0 };
  const base = Math.atan2(away.y, away.x);
  const angles = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2];
  const dists = [MONSTER_ESCAPE_DIST, 300, 220];
  for (let ai = 0; ai < angles.length; ai++) {
    const ang = base + angles[ai];
    for (let di = 0; di < dists.length; di++) {
      const dist = dists[di];
      const t = {
        x: m.x + Math.cos(ang) * dist,
        y: m.y + Math.sin(ang) * dist
      };
      if (blocked(t.x, t.y, MONSTER_R)) continue;
      if (!walkableLine(m.x, m.y, t.x, t.y, MONSTER_R)) continue;
      if (shooter && len(t.x - sx, t.y - sy) + 40 < len(m.x - sx, m.y - sy)) continue;
      return t;
    }
  }
  for (let ai = 0; ai < angles.length; ai++) {
    const ang = base + angles[ai];
    for (let dist = 160; dist >= 70; dist -= 30) {
      const t = {
        x: m.x + Math.cos(ang) * dist,
        y: m.y + Math.sin(ang) * dist
      };
      if (blocked(t.x, t.y, MONSTER_R)) continue;
      if (shooter && len(t.x - sx, t.y - sy) + 20 < len(m.x - sx, m.y - sy)) continue;
      return t;
    }
  }
  return pickMonsterTarget(m);
}

function angerMonster(hh, m, now) {
  if (!m || m.hp <= 0) return;
  const shooter = hh.players[hh.hunterId];
  const from = shooter && !shooter.dead ? shooter : null;
  m.angryUntil = now + MONSTER_ANGRY_DURATION;
  m.escaping = true;
  m.escapeFromId = from ? from.id : null;
  m.rushPhase = "idle";
  m.rushTargetId = null;
  m.pauseUntil = 0;
  m.failedTargets = [];
  m.target = pickEscapeTarget(m, from);
  m.nextRetargetAt = now + MONSTER_ANGRY_DURATION;
  m.lastMovedAt = now;
  m.lastX = m.x;
  m.lastY = m.y;
}

function stepMonster(hh, dt, io) {
  const m = hh.monster;
  if (!m || m.hp <= 0) {
    if (m) m.moving = false;
    return;
  }
  const now = Date.now();
  if (m.stunned) {
    if (now < m.stunEndTime) {
      m.moving = false;
      m.rushPhase = "idle";
      m.rushTargetId = null;
      m.lastX = m.x;
      m.lastY = m.y;
      m.lastMovedAt = now;
      return;
    }
    m.stunned = false;
    m.stunEndTime = 0;
    m.pauseUntil = 0;
    m.failedTargets = [];
    if (now < (m.angryUntil || 0)) {
      const shooter = m.escapeFromId && hh.players[m.escapeFromId];
      const from = shooter && !shooter.dead ? shooter : null;
      m.target = pickEscapeTarget(m, from);
      m.escaping = true;
    } else {
      m.target = pickMonsterTarget(m);
      m.escaping = false;
    }
    m.nextRetargetAt = now + RETARGET_MS;
    m.lastMovedAt = now;
  }
  unstick(m, MONSTER_R);
  if (m.rushPhase === "windup") {
    m.moving = false;
    const target = m.rushTargetId && hh.players[m.rushTargetId];
    if (!target || target.dead) {
      endRush(m, now);
      return;
    }
    const aim = norm(target.x - m.x, target.y - m.y);
    m.faceX = aim.x;
    m.faceY = aim.y;
    if (now < m.windupUntil) return;
    m.rushDir = { x: aim.x, y: aim.y };
    m.rushPhase = "rush";
    m.rushUntil = now + MONSTER_RUSH_DURATION;
    return;
  }
  if (m.rushPhase === "rush") {
    if (now >= m.rushUntil) {
      endRush(m, now);
      return;
    }
    const step = MONSTER_RUSH_SPEED * dt;
    const nx = m.x + m.rushDir.x * step;
    const ny = m.y + m.rushDir.y * step;
    if (blocked(nx, ny, MONSTER_R)) {
      endRush(m, now);
      return;
    }
    m.x = nx;
    m.y = ny;
    m.faceX = m.rushDir.x;
    m.faceY = m.rushDir.y;
    m.moving = true;
    m.lastX = m.x;
    m.lastY = m.y;
    m.lastMovedAt = now;
    return;
  }
  if (m.rushPhase === "recover") {
    m.moving = false;
    if (now < m.rushRecoverUntil) return;
    m.rushPhase = "idle";
  }
  const angry = now < (m.angryUntil || 0);
  if (m.escaping && !angry) {
    m.escaping = false;
    m.escapeFromId = null;
    m.target = pickMonsterTarget(m);
    m.nextRetargetAt = now + RETARGET_MS;
    m.failedTargets = [];
  }
  if (m.rushPhase === "idle" && !angry && now >= (m.rushCooldownUntil || 0)) {
    const prey = nearestLiving(hh, m.x, m.y, MONSTER_RUSH_RANGE);
    if (prey) {
      m.rushPhase = "windup";
      m.rushTargetId = prey.id;
      m.windupUntil = now + MONSTER_RUSH_WINDUP;
      m.rushCooldownUntil = now + MONSTER_RUSH_COOLDOWN;
      m.moving = false;
      const aim = norm(prey.x - m.x, prey.y - m.y);
      m.faceX = aim.x;
      m.faceY = aim.y;
      if (io) io.to(prey.id).emit("hiddenHunterRushTelegraph");
      return;
    }
  }
  if (now < m.pauseUntil) {
    m.moving = false;
    m.lastX = m.x;
    m.lastY = m.y;
    m.lastMovedAt = now;
    return;
  }
  const movedDist = len(m.x - m.lastX, m.y - m.lastY);
  if (movedDist >= STUCK_DIST) {
    m.lastX = m.x;
    m.lastY = m.y;
    m.lastMovedAt = now;
  }
  const stuck = now - m.lastMovedAt >= STUCK_MS;
  const targetBad = !m.target
    || blocked(m.target.x, m.target.y, MONSTER_R)
    || !walkableLine(m.x, m.y, m.target.x, m.target.y, MONSTER_R);
  const arrived = m.target && len(m.x - m.target.x, m.y - m.target.y) < 18;
  const retargetDue = now >= (m.nextRetargetAt || 0);
  if (stuck || targetBad || arrived || retargetDue) {
    if (stuck || targetBad) rememberFailedTarget(m, m.target);
    if (angry) {
      const shooter = m.escapeFromId && hh.players[m.escapeFromId];
      const from = shooter && !shooter.dead ? shooter : null;
      const fled = from && len(m.x - from.x, m.y - from.y) >= MONSTER_ESCAPE_DIST * 0.7;
      if (arrived && fled) {
        m.angryUntil = now;
        m.escaping = false;
        m.escapeFromId = null;
        m.target = pickMonsterTarget(m);
        m.nextRetargetAt = now + RETARGET_MS;
      } else {
        m.target = pickEscapeTarget(m, from);
        m.nextRetargetAt = now + MONSTER_ANGRY_DURATION;
      }
      m.lastMovedAt = now;
      m.lastX = m.x;
      m.lastY = m.y;
    } else {
      if (arrived && !stuck && randomInt(100) < 22) {
        m.moving = false;
        m.pauseUntil = now + PAUSE_MIN_MS + randomInt(Math.max(1, PAUSE_MAX_MS - PAUSE_MIN_MS));
        m.lastMovedAt = now;
        m.nextRetargetAt = m.pauseUntil + RETARGET_MS;
        return;
      }
      m.target = pickMonsterTarget(m);
      m.nextRetargetAt = now + RETARGET_MS + randomInt(900);
      m.lastMovedAt = now;
      m.lastX = m.x;
      m.lastY = m.y;
    }
  }
  const stillAngry = now < (m.angryUntil || 0);
  const speed = stillAngry ? MONSTER_ANGRY_SPEED : MONSTER_NORMAL_SPEED;
  const n = norm(m.target.x - m.x, m.target.y - m.y);
  const beforeX = m.x;
  const beforeY = m.y;
  const moved = tryMove(m, n.x * speed * dt, n.y * speed * dt, MONSTER_R);
  m.moving = !!(moved && (m.x !== beforeX || m.y !== beforeY));
  if (moved) {
    m.lastX = m.x;
    m.lastY = m.y;
    m.lastMovedAt = now;
  }
}

function hurtPlayer(room, io, roomCode, player, amount) {
  player.hp = Math.max(0, player.hp - amount);
  io.to(player.id).emit("hiddenHunterHurt", {
    hp: player.hp,
    maxHp: PLAYER_MAX_HEALTH
  });
  if (player.hp <= 0) teamDefeat(room, io, roomCode);
}

function stepMonsterAttack(room, io, roomCode) {
  const hh = room.hh;
  const m = hh.monster;
  if (!m || m.hp <= 0 || hh.phase !== "playing") return;
  const now = Date.now();
  if (m.stunned && now < m.stunEndTime) return;
  if (now < m.attackUntil) return;
  const closest = nearestLiving(hh, m.x, m.y, MONSTER_ATTACK_RANGE + 0.001);
  if (!closest) return;
  const amount = m.rushPhase === "rush" ? MONSTER_RUSH_DAMAGE : MONSTER_DAMAGE;
  m.attackUntil = now + MONSTER_ATTACK_COOLDOWN;
  hurtPlayer(room, io, roomCode, closest, amount);
}

function stepPlayers(hh, dt) {
  const now = Date.now();
  Object.values(hh.players).forEach((p) => {
    if (p.dead || hh.phase === "over") return;
    if (now - p.input.at > INPUT_STALE_MS) {
      p.input.mx = 0;
      p.input.my = 0;
    }
    const n = norm(p.input.mx, p.input.my);
    tryMove(p, n.x * PLAYER_SPEED * dt, n.y * PLAYER_SPEED * dt, PLAYER_R);
    if (p.role === "hunter" && p.reloadingUntil && now >= p.reloadingUntil && p.ammo <= 0) {
      p.ammo = MAGAZINE_SIZE;
      p.reloadingUntil = 0;
    }
  });
}

function stepProjectiles(room, io, roomCode, dt) {
  const hh = room.hh;
  const keep = [];
  hh.projectiles.forEach((b) => {
    const steps = 4;
    const sx = (b.vx * dt) / steps;
    const sy = (b.vy * dt) / steps;
    for (let i = 0; i < steps; i++) {
      const nx = b.x + sx;
      const ny = b.y + sy;
      if (blocked(nx, ny, BULLET_R)) {
        addImpact(hh, nx, ny, "wall");
        return;
      }
      b.x = nx;
      b.y = ny;
      const m = hh.monster;
      if (m && m.hp > 0 && len(b.x - m.x, b.y - m.y) <= MONSTER_R + BULLET_R) {
        const hitAt = Date.now();
        m.hp = Math.max(0, m.hp - DAMAGE);
        m.hitUntil = hitAt + 220;
        if (m.hp > 0) angerMonster(hh, m, hitAt);
        addImpact(hh, b.x, b.y, "hit");
        io.to(hh.trackerId).emit("hiddenHunterHit", {
          remainingHp: m.hp,
          maxHp: MONSTER_HP
        });
        io.to(hh.hunterId).emit("hiddenHunterImpact", {
          x: Math.round(b.x),
          y: Math.round(b.y)
        });
        if (m.hp <= 0) {
          endMatch(room, io, roomCode, "win");
        }
        return;
      }
    }
    keep.push(b);
  });
  hh.projectiles = keep;
}

function tick(room, io, roomCode) {
  const hh = room.hh;
  if (!hh || hh.phase === "over") return;
  activeNav = hh.nav || DEFAULT_NAV;
  const dt = TICK_MS / 1000;
  if (hh.phase === "playing") {
    if (Date.now() >= hh.endsAt) {
      endMatch(room, io, roomCode, "lose");
      return;
    }
    stepPlayers(hh, dt);
    stepMonster(hh, dt, io);
    stepMonsterAttack(room, io, roomCode);
    if (hh.phase === "over") return;
    stepProjectiles(room, io, roomCode, dt);
    if (hh.phase === "over") return;
  } else if (hh.phase === "countdown") {
    stepPlayers(hh, dt);
  }
  emitStates(room, io, roomCode);
}

function startLoop(room, io, roomCode) {
  stopLoop(room);
  room.hh.tick = setInterval(() => tick(room, io, roomCode), TICK_MS);
}

function beginCountdown(room, io, roomCode) {
  const hh = room.hh;
  const step = () => {
    if (!room.hh || room.hh !== hh) return;
    if (hh.countdown > 1) {
      hh.countdown -= 1;
      emitStates(room, io, roomCode);
      hh.countdownTimer = setTimeout(step, 1000);
      return;
    }
    hh.phase = "playing";
    hh.countdown = 0;
    hh.endsAt = Date.now() + MATCH_MS;
    emitStates(room, io, roomCode);
  };
  hh.countdownTimer = setTimeout(step, 1000);
  startLoop(room, io, roomCode);
}

function onBothPlayersJoined(room, io, roomCode, opts) {
  initRoomState(room, !!(opts && opts.swapRoles));
  room.players.forEach((player) => {
    io.to(player.id).emit("hiddenHunterStarted", buildStateFor(room, player.id, roomCode));
  });
  emitStates(room, io, roomCode);
  beginCountdown(room, io, roomCode);
}

function findRoom(socket, rooms, data) {
  const roomCode = data && typeof data.roomCode === "string"
    ? data.roomCode.trim().toUpperCase()
    : "";
  const room = rooms[roomCode];
  if (!room || room.gameMode !== "hidden-hunter") {
    socket.emit("errorMessage", "You are not in a Hidden Hunter lobby.");
    return null;
  }
  if (!room.players.some((p) => p.id === socket.id)) {
    socket.emit("errorMessage", "You are not in this lobby.");
    return null;
  }
  return { room, roomCode };
}

function registerSocket(socket, io, rooms) {
  socket.on("hiddenHunterInput", (data) => {
    const found = findRoom(socket, rooms, data);
    if (!found || !found.room.hh) return;
    const p = found.room.hh.players[socket.id];
    if (!p || p.dead || found.room.hh.phase === "over") return;
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

  socket.on("hiddenHunterShoot", (data) => {
    const found = findRoom(socket, rooms, data);
    if (!found) return;
    const { room, roomCode } = found;
    const hh = room.hh;
    if (!hh || hh.phase !== "playing") return;
    const p = hh.players[socket.id];
    if (!p || p.dead) return;
    if (p.role !== "hunter") {
      socket.emit("errorMessage", "Only the Hunter can shoot.");
      return;
    }
    const now = Date.now();
    if (p.reloadingUntil && now < p.reloadingUntil) return;
    if (now < p.cooldownUntil) return;
    if (p.ammo <= 0) return;
    let ax = typeof data.aimX === "number" ? data.aimX : p.aimX;
    let ay = typeof data.aimY === "number" ? data.aimY : p.aimY;
    const a = norm(ax, ay);
    if (len(a.x, a.y) < 0.01) return;
    p.aimX = a.x;
    p.aimY = a.y;
    p.ammo -= 1;
    p.cooldownUntil = now + FIRE_COOLDOWN_MS;
    if (p.ammo <= 0) p.reloadingUntil = now + RELOAD_MS;
    const spawn = PLAYER_R + BULLET_R + 4;
    hh.projectiles.push({
      id: hh.nextShotId++,
      x: p.x + a.x * spawn,
      y: p.y + a.y * spawn,
      vx: a.x * BULLET_SPEED,
      vy: a.y * BULLET_SPEED
    });
    io.to(roomCode).emit("hiddenHunterShot", {
      ownerId: p.id,
      ammo: p.ammo,
      cooldownUntil: p.cooldownUntil,
      reloadingUntil: p.reloadingUntil
    });
  });

  socket.on("hiddenHunterReload", (data) => {
    const found = findRoom(socket, rooms, data);
    if (!found || !found.room.hh) return;
    const p = found.room.hh.players[socket.id];
    if (!p || p.role !== "hunter" || p.dead || found.room.hh.phase === "over") return;
    const now = Date.now();
    if (p.ammo >= MAGAZINE_SIZE) return;
    if (p.reloadingUntil && now < p.reloadingUntil) return;
    p.reloadingUntil = now + RELOAD_MS;
    p.ammo = 0;
  });

  socket.on("hiddenHunterTaser", (data) => {
    const found = findRoom(socket, rooms, data);
    if (!found) return;
    const { room, roomCode } = found;
    const hh = room.hh;
    if (!hh || hh.phase !== "playing") return;
    const p = hh.players[socket.id];
    if (!p || p.dead) return;
    if (p.role !== "tracker") {
      socket.emit("errorMessage", "Only the Tracker can use the taser.");
      return;
    }
    const now = Date.now();
    if (now < p.taserUntil) return;
    let ax = typeof data.aimX === "number" ? data.aimX : p.aimX;
    let ay = typeof data.aimY === "number" ? data.aimY : p.aimY;
    const a = norm(ax, ay);
    if (len(a.x, a.y) < 0.01) return;
    p.aimX = a.x;
    p.aimY = a.y;
    p.taserUntil = now + TASER_COOLDOWN;
    activeNav = hh.nav || DEFAULT_NAV;
    const origin = { x: p.x + a.x * (PLAYER_R + 6), y: p.y + a.y * (PLAYER_R + 6) };
    const steps = Math.max(8, Math.ceil(TASER_RANGE / 8));
    let endX = origin.x + a.x * TASER_RANGE;
    let endY = origin.y + a.y * TASER_RANGE;
    let hit = false;
    const m = hh.monster;
    for (let i = 1; i <= steps; i++) {
      const x = origin.x + a.x * (TASER_RANGE * i / steps);
      const y = origin.y + a.y * (TASER_RANGE * i / steps);
      if (blocked(x, y, 3)) {
        endX = x;
        endY = y;
        break;
      }
      if (m && m.hp > 0 && len(x - m.x, y - m.y) <= MONSTER_R + 10) {
        endX = m.x;
        endY = m.y;
        hit = true;
        m.stunned = true;
        m.stunEndTime = now + STUN_MS;
        m.pauseUntil = 0;
        m.lastMovedAt = now;
        m.lastX = m.x;
        m.lastY = m.y;
        break;
      }
      endX = x;
      endY = y;
    }
    hh.taserBeams = hh.taserBeams || [];
    hh.taserBeams.push({
      id: hh.nextShotId++,
      x0: origin.x,
      y0: origin.y,
      x1: endX,
      y1: endY,
      hit,
      until: now + 220
    });
    if (hh.taserBeams.length > 8) hh.taserBeams = hh.taserBeams.slice(-4);
    // Tracker-only: hunter must never see the beam or aim.
    io.to(hh.trackerId).emit("hiddenHunterTaserFired", {
      remainingMs: TASER_COOLDOWN,
      hit
    });
    emitStates(room, io, roomCode);
  });

  socket.on("hiddenHunterPlayAgain", (data) => {
    const found = findRoom(socket, rooms, data);
    if (!found) return;
    const { room, roomCode } = found;
    if (!room.hh || room.hh.phase !== "over") {
      socket.emit("errorMessage", "The match is still going.");
      return;
    }
    if (!room.hhRematch) room.hhRematch = {};
    room.hhRematch[socket.id] = true;
    if (!room.players.every((p) => room.hhRematch[p.id])) {
      socket.emit("hiddenHunterPlayAgainWait");
      return;
    }
    room.hhRematch = {};
    io.to(roomCode).emit("hiddenHunterReset");
    onBothPlayersJoined(room, io, roomCode, { swapRoles: true });
  });
}

module.exports = {
  onBothPlayersJoined,
  registerSocket,
  stopRoom,
  buildStateFor,
  MAP_W,
  MAP_H,
  MONSTER_HP,
  DAMAGE,
  MAGAZINE_SIZE,
  MATCH_MS,
  OBSTACLES,
  TASER_COOLDOWN,
  TASER_RANGE,
  STUN_MS,
  PLAYER_MAX_HEALTH,
  MONSTER_ATTACK_RANGE,
  MONSTER_DAMAGE,
  MONSTER_ATTACK_COOLDOWN,
  MONSTER_BASE_SPEED,
  MONSTER_NORMAL_SPEED,
  MONSTER_ANGRY_SPEED,
  MONSTER_ANGRY_DURATION,
  MONSTER_ESCAPE_DIST,
  MONSTER_RUSH_RANGE,
  MONSTER_RUSH_SPEED,
  MONSTER_RUSH_DURATION,
  MONSTER_RUSH_COOLDOWN,
  MONSTER_RUSH_WINDUP,
  MONSTER_RUSH_DAMAGE,
  STUCK_MS,
  blocked
};
