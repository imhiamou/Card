/*
 * Postgres store for Carts maps only.
 * Hidden Hunter keeps its own hh_maps table.
 */

const { Pool } = require("pg");

let pool = null;
const TABLE = "carts_maps";

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

function enabled() {
  return !!pool;
}

async function connect() {
  const url = databaseUrl();
  if (!url) return false;
  if (pool) return true;
  const ssl = sslOption(url);
  pool = new Pool({
    connectionString: connectionStringForPg(url),
    ssl: ssl,
    max: 2,
    connectionTimeoutMillis: 10000
  });
  pool.on("error", (err) => {
    console.error("[carts-maps] idle client\n" + safeMessage(err));
  });
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS carts_maps (id text PRIMARY KEY, document jsonb NOT NULL)"
    );
    await pool.query("SELECT 1");
    console.log("[carts-maps] table carts_maps ready");
    return true;
  } catch (err) {
    const failed = pool;
    pool = null;
    try { await failed.end(); } catch (endErr) { /* discarded */ }
    throw err;
  }
}

async function loadAll() {
  if (!pool) return [];
  const result = await pool.query("SELECT id, document FROM carts_maps");
  return result.rows.map((row) => ({ id: row.id, document: row.document }));
}

async function save(map) {
  if (!pool) throw new Error("database connection is not open");
  await pool.query(
    "INSERT INTO carts_maps (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
    [map.id, JSON.stringify(map)]
  );
}

async function remove(id) {
  if (!pool) return;
  await pool.query("DELETE FROM carts_maps WHERE id = $1", [id]);
}

module.exports = {
  connect,
  loadAll,
  save,
  remove,
  enabled,
  safeMessage,
  databaseUrl,
  TABLE
};
