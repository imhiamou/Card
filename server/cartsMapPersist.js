/*
 * Postgres store for Carts maps only.
 * Hidden Hunter keeps its own hh_maps table.
 */

const { Pool } = require("pg");

let pool = null;
let lastError = null;
let connecting = null;
let lastAttemptAt = 0;
const TABLE = "carts_maps";
const RETRY_FALLBACK_MS = 15000;

function redact(text) {
  return String(text || "").replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgresql://[redacted]");
}

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) return "";
  return String(url).trim();
}

function databaseHost(url) {
  try {
    return new URL(url).hostname || "unknown";
  } catch (err) {
    return "unparsed";
  }
}

function sslOption(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (err) {
    return { rejectUnauthorized: false };
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  if (host.indexOf(".") === -1) return false;
  return { rejectUnauthorized: false };
}

function connectionStringForPg(url) {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return url;
  const kept = beforeHash.slice(queryAt + 1).split("&").filter((part) => {
    if (!part) return false;
    const key = part.split("=")[0].toLowerCase();
    return key !== "sslmode" && key !== "uselibpqcompat";
  });
  return beforeHash.slice(0, queryAt) + (kept.length ? "?" + kept.join("&") : "") + fragment;
}

function safeMessage(err) {
  if (!err) return "unknown database error";
  const code = err.code ? String(err.code) + " " : "";
  let message = err.message ? String(err.message) : "unknown database error";
  message = redact(message);
  if (message.length > 400) message = message.slice(0, 400);
  return (code + message).trim();
}

function retryDelayMs() {
  const raw = process.env.MAP_DB_RETRY_MS;
  if (raw == null || String(raw).trim() === "") return RETRY_FALLBACK_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return RETRY_FALLBACK_MS;
  return parsed;
}

function failureReason(err) {
  if (!databaseUrl()) return "DATABASE_URL is missing";
  const reason = err || lastError;
  if (!pool && !reason) return "database connection is not open";
  if (!reason) return "the database write did not succeed";
  return safeMessage(reason);
}

function enabled() {
  return !!pool;
}

async function openPool() {
  const url = databaseUrl();
  const ssl = sslOption(url);
  const created = new Pool({
    connectionString: connectionStringForPg(url),
    ssl: ssl,
    max: 2,
    connectionTimeoutMillis: 10000
  });
  created.on("error", (err) => {
    console.error("[carts-maps] idle client\n" + safeMessage(err));
  });
  try {
    await created.query(
      "CREATE TABLE IF NOT EXISTS carts_maps (id text PRIMARY KEY, document jsonb NOT NULL)"
    );
    await created.query("SELECT 1");
    pool = created;
    lastError = null;
    console.log("[carts-maps] table carts_maps ready");
    return true;
  } catch (err) {
    lastError = err;
    console.error("[carts-maps] connect failed");
    console.error(safeMessage(err));
    try { await created.end(); } catch (endErr) { /* discarded */ }
    throw err;
  }
}

async function connect() {
  if (!databaseUrl()) return false;
  if (pool) return true;
  if (connecting) return connecting;
  lastAttemptAt = Date.now();
  connecting = openPool().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function ensure() {
  if (pool) return true;
  if (!databaseUrl()) return false;
  if (connecting) {
    try {
      return await connecting;
    } catch (err) {
      return false;
    }
  }
  if (lastError && (Date.now() - lastAttemptAt) < retryDelayMs()) return false;
  try {
    return await connect();
  } catch (err) {
    return false;
  }
}

async function loadAll() {
  if (!pool && !(await ensure())) return [];
  const result = await pool.query("SELECT id, document FROM carts_maps");
  return result.rows.map((row) => ({ id: row.id, document: row.document }));
}

async function save(map) {
  if (!pool) await ensure();
  if (!pool) throw new Error(failureReason(null));
  await pool.query(
    "INSERT INTO carts_maps (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
    [map.id, JSON.stringify(map)]
  );
}

async function remove(id) {
  if (!pool) await ensure();
  if (!pool) throw new Error(failureReason(null));
  await pool.query("DELETE FROM carts_maps WHERE id = $1", [id]);
}

module.exports = {
  connect,
  ensure,
  loadAll,
  save,
  remove,
  enabled,
  failureReason,
  safeMessage,
  databaseUrl,
  TABLE
};
