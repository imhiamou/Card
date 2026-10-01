/*
 * Hidden Hunter — isolated 2-player coop (server-authoritative).
 *
 * Loaded by server.js only as a lobby router target. Does not alter
 * Hidden Hunt, Dominoes, or UNO.
 * Monster positions, facing, animation, and alive state are sent only to
 * the Tracker. The Hunter does not receive monster coordinates, AI,
 * last-seen positions, or taser data.
 */

const { randomInt } = require("crypto");
const hhMaps = require("./hhMapStore");

const DEFAULT_SNAP = hhMaps.snapshot("default");
const DEFAULT_NAV = hhMaps.buildNav(DEFAULT_SNAP);
const MAP_W = DEFAULT_SNAP.width;
const MAP_H = DEFAULT_SNAP.height;
const OBSTACLES = DEFAULT_SNAP.objects;
const HUNTER_R = 22;
const PLAYER_R = HUNTER_R;
// Lux's picture is smaller than the hunter. Her body radius is the same.
const TRACKER_R = HUNTER_R;
const MONSTER_BODY_R = 18;
const MONSTER_R = MONSTER_BODY_R;
// Previous body was 26. Taser impact stays at that old reach (26 + 10).
const MONSTER_TASER_HIT_R = 36;
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
const DAMAGE = 25;
// Three hunter bullets (DAMAGE each) reduce one monster from full to 0.
const MONSTER_HP = DAMAGE * 3;
// Easy lobby difficulty. Normal is 6, Hard is 10. A room may still set hhMonsterCount.
const INITIAL_MONSTER_COUNT = 3;
const MONSTER_DIFFICULTY_COUNTS = { easy: 3, normal: 6, hard: 10 };
const MONSTER_COUNT_CAP = 16;
const MAGAZINE_SIZE = 3;
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
const MONSTER_DETECTION_RANGE = 560;
const MONSTER_LAST_SEEN_SEARCH_RADIUS = 200;
const MONSTER_SEARCH_DURATION = 6500;
const MONSTER_AI_INTERVAL = 150;
const MONSTER_LOS_RADIUS = 8;
const MONSTER_SEARCH_STOPS = 4;
const MONSTER_SIDESTEP_MS = 700;

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

function tryMove(ent, dx, dy, r, blockedExtra) {
  const ox = ent.x;
  const oy = ent.y;
  function hit(x, y) {
    return blocked(x, y, r) || (blockedExtra ? blockedExtra(x, y) : false);
  }
  const nx = ent.x + dx;
  const ny = ent.y + dy;
  if (!hit(nx, ny)) {
    ent.x = nx;
    ent.y = ny;
    return true;
  }
  if (!hit(nx, ent.y)) {
    ent.x = nx;
    return true;
  }
  if (!hit(ent.x, ny)) {
    ent.y = ny;
    return true;
  }
  const speed = len(dx, dy);
  if (speed > 0.01) {
    const px = -dy / speed;
    const py = dx / speed;
    if (!hit(ent.x + px * speed, ent.y + py * speed)) {
      ent.x += px * speed;
      ent.y += py * speed;
      return true;
    }
    if (!hit(ent.x - px * speed, ent.y - py * speed)) {
      ent.x -= px * speed;
      ent.y -= py * speed;
      return true;
    }
  }
  return ent.x !== ox || ent.y !== oy;
}

function bodyRadius(p) {
  return p && p.role === "tracker" ? TRACKER_R : HUNTER_R;
}

function circlesOverlap(x, y, r, ox, oy, or) {
  return len(x - ox, y - oy) < r + or;
}

function hitsPlayerBody(hh, x, y, r) {
  const players = hh && hh.players ? Object.values(hh.players) : [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.dead) continue;
    if (circlesOverlap(x, y, r, p.x, p.y, bodyRadius(p))) return true;
  }
  return false;
}

function monsterIsDown(m) {
  return !m || !!m.dead || m.hp <= 0;
}

function monsterList(hh) {
  return (hh && hh.monsters) || [];
}

function allMonstersDown(hh) {
  const list = monsterList(hh);
  return list.length > 0 && list.every(monsterIsDown);
}

function hitsMonsterBody(hh, x, y, r, ignoreId) {
  const list = monsterList(hh);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (monsterIsDown(m)) continue;
    if (ignoreId && m.id === ignoreId) continue;
    if (circlesOverlap(x, y, r, m.x, m.y, MONSTER_BODY_R)) return true;
  }
  return false;
}

function closestLivingMonster(hh, x, y, reach) {
  let best = null;
  let bestDist = reach;
  const list = monsterList(hh);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (monsterIsDown(m)) continue;
    const d = len(x - m.x, y - m.y);
    if (d <= bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
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

function normalizeMonsterDifficulty(difficulty) {
  const key = typeof difficulty === "string" ? difficulty.trim().toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(MONSTER_DIFFICULTY_COUNTS, key)) return key;
  return "easy";
}

function monsterCountForDifficulty(difficulty) {
  return MONSTER_DIFFICULTY_COUNTS[normalizeMonsterDifficulty(difficulty)];
}

function monsterCountFor(room) {
  const raw = room && room.hhMonsterCount != null ? Number(room.hhMonsterCount) : INITIAL_MONSTER_COUNT;
  const n = Math.floor(raw);
  if (!Number.isFinite(n) || n < 1) return INITIAL_MONSTER_COUNT;
  return Math.min(n, MONSTER_COUNT_CAP);
}

function createMonster(id, x, y) {
  const now = Date.now();
  const m = {
    id: id,
    x: x,
    y: y,
    vx: 0,
    vy: 0,
    hp: MONSTER_HP,
    maxHp: MONSTER_HP,
    dead: false,
    target: null,
    pauseUntil: 0,
    hitUntil: 0,
    stunned: false,
    stunEndTime: 0,
    lastX: x,
    lastY: y,
    lastMovedAt: now,
    nextRetargetAt: now + RETARGET_MS,
    attackUntil: 0,
    biteUntil: 0,
    failedTargets: [],
    rushPhase: "idle",
    rushDir: { x: 1, y: 0 },
    rushTargetId: null,
    rushPoint: null,
    windupUntil: 0,
    rushUntil: 0,
    rushRecoverUntil: 0,
    rushCooldownUntil: 0,
    faceX: 1,
    faceY: 0,
    angryUntil: 0,
    escaping: false,
    escapeFromId: null,
    huntMode: "patrol",
    lastSeen: null,
    seenPlayerId: null,
    searchUntil: 0,
    searchStops: 0,
    seekUntil: 0,
    nextPerceptionAt: 0,
    sidestepUntil: 0
  };
  m.target = pickMonsterTarget(m);
  return m;
}

function monsterSpotFree(x, y, players, placed, playerClear) {
  if (!inBounds(x, y, MONSTER_BODY_R) || blocked(x, y, MONSTER_BODY_R)) return false;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const need = playerClear != null ? playerClear : (MONSTER_BODY_R + bodyRadius(p) + 12);
    if (len(p.x - x, p.y - y) < need) return false;
  }
  for (let i = 0; i < placed.length; i++) {
    if (len(placed[i].x - x, placed[i].y - y) < MONSTER_BODY_R * 2 + 36) return false;
  }
  return true;
}

function firstMonsterSpot(players, spawns) {
  for (let i = 0; i < 50; i++) {
    const spot = randomWalkable(MONSTER_R);
    const clear = players.every((p) => len(p.x - spot.x, p.y - spot.y) > 380);
    if (clear) return spot;
  }
  const fallback = (spawns && spawns.monster) || SPAWNS.monster;
  return { x: fallback.x, y: fallback.y };
}

function extraMonsterSpot(anchor, players, placed) {
  const radii = [140, 220, 300, 420, 560, 760, 980];
  for (let pass = 0; pass < 2; pass++) {
    const playerClear = pass === 0 ? 380 : null;
    for (let ri = 0; ri < radii.length; ri++) {
      const radius = radii[ri];
      const steps = 12;
      const spin = randomInt(steps);
      for (let s = 0; s < steps; s++) {
        const ang = ((spin + s) / steps) * Math.PI * 2;
        const jitter = radius + randomInt(48);
        const spot = nearWalkable(anchor.x + Math.cos(ang) * jitter, anchor.y + Math.sin(ang) * jitter);
        if (monsterSpotFree(spot.x, spot.y, players, placed, playerClear)) return spot;
      }
    }
    for (let i = 0; i < 40; i++) {
      const spot = randomWalkable(MONSTER_BODY_R);
      if (monsterSpotFree(spot.x, spot.y, players, placed, playerClear)) return spot;
    }
  }
  return null;
}

function spawnMonsters(players, spawns, count) {
  const avoid = players ? Object.values(players) : [];
  const list = [];
  const first = firstMonsterSpot(avoid, spawns);
  list.push(createMonster("monster-1", first.x, first.y));
  const anchor = (spawns && spawns.monster) || first;
  for (let n = 2; n <= count; n++) {
    const spot = extraMonsterSpot(anchor, avoid, list) || extraMonsterSpot(first, avoid, list);
    if (!spot) break;
    list.push(createMonster("monster-" + n, spot.x, spot.y));
  }
  return list;
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
    monsters: spawnMonsters(players, snap.spawns, monsterCountFor(room)),
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
  // The Hunter must not receive the Tracker's aim payload. Facing is a
  // separate unit direction so the Hunter can draw which way Lux looks.
  const hideAim = p.role === "tracker" && viewerRole !== "tracker";
  const row = {
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
  if (p.role === "tracker") {
    const face = norm(p.aimX || 0, p.aimY || 0);
    if (len(face.x, face.y) > 0.01) {
      row.facingX = Math.round(face.x * 1000) / 1000;
      row.facingY = Math.round(face.y * 1000) / 1000;
    }
  }
  return row;
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
  const down = monsterIsDown(m);
  return {
    id: m.id,
    x: Math.round(m.x * 10) / 10,
    y: Math.round(m.y * 10) / 10,
    hp: m.hp,
    maxHp: m.maxHp || MONSTER_HP,
    hit: !down && m.hitUntil > now,
    stunned: !down && !!m.stunned && now < m.stunEndTime,
    moving: !down && !!m.moving && !(m.stunned && now < m.stunEndTime),
    windup: !down && m.rushPhase === "windup",
    rushing: !down && m.rushPhase === "rush",
    faceX: m.faceX || 0,
    faceY: m.faceY || 0,
    dead: down,
    biting: !down && m.biteUntil > now
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
    payload.monsters = monsterList(hh).map(publicMonster);
    const tracker = hh.players[hh.trackerId];
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
  monsterList(hh).forEach((m) => {
    if (!m) return;
    m.stunned = false;
    m.moving = false;
    m.vx = 0;
    m.vy = 0;
    m.rushPhase = "idle";
    m.rushTargetId = null;
    m.rushPoint = null;
    m.attackUntil = Number.MAX_SAFE_INTEGER;
  });
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
  m.rushPoint = null;
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

function livingPlayers(hh) {
  return Object.values(hh.players).filter((p) => p && !p.dead);
}

function seesPlayer(m, player) {
  if (!player || player.dead) return false;
  if (len(player.x - m.x, player.y - m.y) > MONSTER_DETECTION_RANGE) return false;
  return walkableLine(m.x, m.y, player.x, player.y, MONSTER_LOS_RADIUS);
}

function nearestVisiblePrey(hh, m, maxDist) {
  let best = null;
  let bestDist = maxDist;
  Object.values(hh.players).forEach((p) => {
    if (!seesPlayer(m, p)) return;
    const d = len(p.x - m.x, p.y - m.y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  });
  return best;
}

function standable(x, y) {
  if (!inBounds(x, y, MONSTER_R) || blocked(x, y, MONSTER_R)) return null;
  return { x: x, y: y };
}

function nearWalkable(x, y) {
  const direct = standable(x, y);
  if (direct) return direct;
  for (let dist = 28; dist <= 168; dist += 28) {
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const spot = standable(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist);
      if (spot) return spot;
    }
  }
  return randomWalkable(MONSTER_R);
}

function searchPoint(origin) {
  const radius = MONSTER_LAST_SEEN_SEARCH_RADIUS;
  for (let i = 0; i < 12; i++) {
    const ang = (randomInt(360) * Math.PI) / 180;
    const dist = 48 + randomInt(Math.max(1, radius - 48));
    const spot = standable(origin.x + Math.cos(ang) * dist, origin.y + Math.sin(ang) * dist);
    if (!spot) continue;
    if (!walkableLine(origin.x, origin.y, spot.x, spot.y, MONSTER_R)) continue;
    return spot;
  }
  return nearWalkable(origin.x, origin.y);
}

function forgetSeen(m) {
  m.huntMode = "patrol";
  m.lastSeen = null;
  m.seenPlayerId = null;
  m.searchUntil = 0;
  m.searchStops = 0;
  m.seekUntil = 0;
}

function beginSearch(m, now) {
  m.huntMode = "search";
  m.searchUntil = now + MONSTER_SEARCH_DURATION;
  m.searchStops = MONSTER_SEARCH_STOPS;
  m.target = searchPoint(m.lastSeen);
}

function updateMonsterPerception(hh, m, now) {
  const players = livingPlayers(hh);
  let seen = null;
  let seenDist = Infinity;
  players.forEach((player) => {
    if (!seesPlayer(m, player)) return;
    const dist = len(player.x - m.x, player.y - m.y);
    if (dist < seenDist) {
      seen = player;
      seenDist = dist;
    }
  });
  if (seen) {
    m.huntMode = "chase";
    m.seenPlayerId = seen.id;
    m.lastSeen = { x: seen.x, y: seen.y };
    m.target = { x: seen.x, y: seen.y };
    m.searchUntil = 0;
    m.searchStops = 0;
    m.seekUntil = 0;
    return;
  }
  if ((m.huntMode === "chase" || m.huntMode === "seek") && m.lastSeen) {
    if (m.huntMode === "chase") {
      m.huntMode = "seek";
      m.seekUntil = now + MONSTER_SEARCH_DURATION + 4000;
      m.target = nearWalkable(m.lastSeen.x, m.lastSeen.y);
    }
    const arrived = len(m.x - m.lastSeen.x, m.y - m.lastSeen.y) < 52
      || (m.target && len(m.x - m.target.x, m.y - m.target.y) < 28);
    if (now >= (m.seekUntil || 0)) {
      forgetSeen(m);
    } else if (arrived) {
      beginSearch(m, now);
    }
    return;
  }
  if (m.huntMode === "search" && m.lastSeen) {
    const arrived = m.target && len(m.x - m.target.x, m.y - m.target.y) < 28;
    if (now >= (m.searchUntil || 0) || (m.searchStops || 0) <= 0) {
      forgetSeen(m);
    } else if (arrived) {
      m.searchStops -= 1;
      if (m.searchStops <= 0) forgetSeen(m);
      else m.target = searchPoint(m.lastSeen);
    }
    if (m.huntMode === "search") return;
  }
  // No line of sight and no last-seen search. Do not read live coordinates.
  m.huntMode = "patrol";
  if (!m.target || len(m.x - m.target.x, m.y - m.target.y) < 36) {
    m.target = pickMonsterTarget(m);
  }
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
  m.rushPoint = null;
  m.pauseUntil = 0;
  m.failedTargets = [];
  m.target = pickEscapeTarget(m, from);
  m.nextRetargetAt = now + MONSTER_ANGRY_DURATION;
  m.lastMovedAt = now;
  m.lastX = m.x;
  m.lastY = m.y;
}

function killMonster(m) {
  if (!m) return;
  m.hp = 0;
  m.dead = true;
  m.moving = false;
  m.vx = 0;
  m.vy = 0;
  m.stunned = false;
  m.rushPhase = "idle";
  m.rushTargetId = null;
  m.rushPoint = null;
  m.attackUntil = Number.MAX_SAFE_INTEGER;
}

function stepMonster(hh, dt, io) {
  const list = monsterList(hh);
  for (let i = 0; i < list.length; i++) stepOneMonster(hh, list[i], dt, io);
}

function stepOneMonster(hh, m, dt, io) {
  if (!m || monsterIsDown(m)) {
    if (m) {
      m.dead = true;
      m.moving = false;
      m.vx = 0;
      m.vy = 0;
    }
    return;
  }
  const originX = m.x;
  const originY = m.y;
  stepOneMonsterBody(hh, m, dt, io);
  if (dt > 0) {
    m.vx = (m.x - originX) / dt;
    m.vy = (m.y - originY) / dt;
  }
}

function stepOneMonsterBody(hh, m, dt, io) {
  const now = Date.now();
  if (m.stunned) {
    if (now < m.stunEndTime) {
      m.moving = false;
      m.rushPhase = "idle";
      m.rushTargetId = null;
      m.rushPoint = null;
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
      m.nextRetargetAt = now + RETARGET_MS;
    } else {
      m.escaping = false;
      m.nextPerceptionAt = 0;
      updateMonsterPerception(hh, m, now);
      m.nextPerceptionAt = now + MONSTER_AI_INTERVAL;
    }
    m.lastMovedAt = now;
  }
  unstick(m, MONSTER_R);
  if (m.rushPhase === "windup") {
    m.moving = false;
    const target = m.rushTargetId && hh.players[m.rushTargetId];
    if (!target || target.dead || !m.rushPoint) {
      endRush(m, now);
      return;
    }
    if (seesPlayer(m, target)) m.rushPoint = { x: target.x, y: target.y };
    const aim = norm(m.rushPoint.x - m.x, m.rushPoint.y - m.y);
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
    if (
      blocked(nx, ny, MONSTER_R)
      || hitsPlayerBody(hh, nx, ny, MONSTER_BODY_R)
      || hitsMonsterBody(hh, nx, ny, MONSTER_BODY_R, m.id)
    ) {
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
    m.failedTargets = [];
    m.nextPerceptionAt = 0;
    updateMonsterPerception(hh, m, now);
    m.nextPerceptionAt = now + MONSTER_AI_INTERVAL;
  }
  if (m.rushPhase === "idle" && !angry && now >= (m.rushCooldownUntil || 0)) {
    const prey = nearestVisiblePrey(hh, m, MONSTER_RUSH_RANGE);
    if (prey) {
      m.rushPhase = "windup";
      m.rushTargetId = prey.id;
      m.rushPoint = { x: prey.x, y: prey.y };
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
  const movedDist = len(m.x - m.lastX, m.y - m.lastY);
  if (movedDist >= STUCK_DIST) {
    m.lastX = m.x;
    m.lastY = m.y;
    m.lastMovedAt = now;
  }
  const stuck = now - m.lastMovedAt >= STUCK_MS;
  if (angry) {
    if (now < m.pauseUntil) {
      m.moving = false;
      m.lastX = m.x;
      m.lastY = m.y;
      m.lastMovedAt = now;
      return;
    }
    const targetBad = !m.target
      || blocked(m.target.x, m.target.y, MONSTER_R)
      || !walkableLine(m.x, m.y, m.target.x, m.target.y, MONSTER_R);
    const arrived = m.target && len(m.x - m.target.x, m.y - m.target.y) < 18;
    const retargetDue = now >= (m.nextRetargetAt || 0);
    if (stuck || targetBad || arrived || retargetDue) {
      if (stuck || targetBad) rememberFailedTarget(m, m.target);
      const shooter = m.escapeFromId && hh.players[m.escapeFromId];
      const from = shooter && !shooter.dead ? shooter : null;
      const fled = from && len(m.x - from.x, m.y - from.y) >= MONSTER_ESCAPE_DIST * 0.7;
      if (arrived && fled) {
        m.angryUntil = now;
        m.escaping = false;
        m.escapeFromId = null;
        m.nextPerceptionAt = 0;
        updateMonsterPerception(hh, m, now);
        m.nextPerceptionAt = now + MONSTER_AI_INTERVAL;
      } else {
        m.target = pickEscapeTarget(m, from);
        m.nextRetargetAt = now + MONSTER_ANGRY_DURATION;
      }
      m.lastMovedAt = now;
      m.lastX = m.x;
      m.lastY = m.y;
    }
  } else if (now < (m.sidestepUntil || 0)) {
    /* Keep the sidestep chosen by stuck recovery, then resume the hunt. */
  } else if (stuck) {
    rememberFailedTarget(m, m.target);
    m.target = pickMonsterTarget(m);
    m.sidestepUntil = now + MONSTER_SIDESTEP_MS;
    m.lastMovedAt = now;
    m.lastX = m.x;
    m.lastY = m.y;
  } else {
    if (now >= (m.nextPerceptionAt || 0)) {
      updateMonsterPerception(hh, m, now);
      m.nextPerceptionAt = now + MONSTER_AI_INTERVAL;
    }
    if (m.huntMode === "chase") m.pauseUntil = 0;
    if (m.huntMode === "patrol" && m.target && len(m.x - m.target.x, m.y - m.target.y) < 18 && randomInt(100) < 22) {
      m.moving = false;
      m.pauseUntil = now + PAUSE_MIN_MS + randomInt(Math.max(1, PAUSE_MAX_MS - PAUSE_MIN_MS));
      m.lastMovedAt = now;
      return;
    }
    if (now < m.pauseUntil) {
      m.moving = false;
      m.lastX = m.x;
      m.lastY = m.y;
      m.lastMovedAt = now;
      return;
    }
  }
  if (!m.target) m.target = pickMonsterTarget(m);
  const stillAngry = now < (m.angryUntil || 0);
  const speed = stillAngry ? MONSTER_ANGRY_SPEED : MONSTER_NORMAL_SPEED;
  const n = norm(m.target.x - m.x, m.target.y - m.y);
  const beforeX = m.x;
  const beforeY = m.y;
  const moved = tryMove(
    m,
    n.x * speed * dt,
    n.y * speed * dt,
    MONSTER_BODY_R,
    (x, y) => hitsPlayerBody(hh, x, y, MONSTER_BODY_R) || hitsMonsterBody(hh, x, y, MONSTER_BODY_R, m.id)
  );
  m.moving = !!(moved && (m.x !== beforeX || m.y !== beforeY));
  if (m.moving) {
    const face = norm(m.x - beforeX, m.y - beforeY);
    if (len(face.x, face.y) > 0.01) {
      m.faceX = face.x;
      m.faceY = face.y;
    }
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
  if (!hh || hh.phase !== "playing") return;
  const now = Date.now();
  const list = monsterList(hh);
  for (let i = 0; i < list.length; i++) {
    if (hh.phase !== "playing") return;
    const m = list[i];
    if (monsterIsDown(m)) continue;
    if (m.stunned && now < m.stunEndTime) continue;
    if (now < m.attackUntil) continue;
    const closest = nearestLiving(hh, m.x, m.y, MONSTER_ATTACK_RANGE + 0.001);
    if (!closest) continue;
    const amount = m.rushPhase === "rush" ? MONSTER_RUSH_DAMAGE : MONSTER_DAMAGE;
    m.attackUntil = now + MONSTER_ATTACK_COOLDOWN;
    m.biteUntil = now + 380;
    hurtPlayer(room, io, roomCode, closest, amount);
  }
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
    const radius = bodyRadius(p);
    tryMove(p, n.x * PLAYER_SPEED * dt, n.y * PLAYER_SPEED * dt, radius, (x, y) => hitsMonsterBody(hh, x, y, radius));
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
      const m = closestLivingMonster(hh, b.x, b.y, MONSTER_BODY_R + BULLET_R);
      if (m) {
        const hitAt = Date.now();
        m.hp = Math.max(0, m.hp - DAMAGE);
        m.hitUntil = hitAt + 220;
        if (m.hp > 0) angerMonster(hh, m, hitAt);
        else killMonster(m);
        addImpact(hh, b.x, b.y, "hit");
        io.to(hh.trackerId).emit("hiddenHunterHit", {
          monsterId: m.id,
          remainingHp: m.hp,
          maxHp: m.maxHp || MONSTER_HP
        });
        io.to(hh.hunterId).emit("hiddenHunterImpact", {
          x: Math.round(b.x),
          y: Math.round(b.y)
        });
        if (m.hp <= 0 && allMonstersDown(hh)) endMatch(room, io, roomCode, "win");
        return;
      }
    }
    keep.push(b);
  });
  if (hh.phase !== "over") hh.projectiles = keep;
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
    for (let i = 1; i <= steps; i++) {
      const x = origin.x + a.x * (TASER_RANGE * i / steps);
      const y = origin.y + a.y * (TASER_RANGE * i / steps);
      if (blocked(x, y, 3)) {
        endX = x;
        endY = y;
        break;
      }
      const m = closestLivingMonster(hh, x, y, MONSTER_TASER_HIT_R);
      if (m) {
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
  INITIAL_MONSTER_COUNT,
  normalizeMonsterDifficulty,
  monsterCountForDifficulty,
  MAGAZINE_SIZE,
  MATCH_MS,
  OBSTACLES,
  TASER_COOLDOWN,
  TASER_RANGE,
  STUN_MS,
  PLAYER_MAX_HEALTH,
  HUNTER_R,
  TRACKER_R,
  MONSTER_BODY_R,
  MONSTER_TASER_HIT_R,
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
