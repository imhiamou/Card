/*
 * Persistent store for Hidden Hunter maps.
 *
 * Render's container disk is wiped on restart and redeploy. Postgres is the
 * copy that has to succeed. The local JSON files are only a cache.
 */

const { Pool } = require("pg");

let pool = null;
const TABLE = "hh_maps";

function redact(text) {
  return String(text || "")
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgresql://[redacted]");
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
  // Render's private database host has no dot (for example dpg-abc-a).
  // Forcing SSL against that host fails the connection.
  if (host.indexOf(".") === -1) return false;
  // Aiven sslmode=require: encrypt the connection, and do not verify the
  // certificate chain. Aiven's CA is not in the system trust store.
  return { rejectUnauthorized: false };
}

function connectionStringForPg(url) {
  // pg 8 parses sslmode=require in DATABASE_URL as verify-full, warns about
  // that alias, and then replaces any explicit ssl option. That makes Node
  // validate Aiven's certificate and fail with SELF_SIGNED_CERT_IN_CHAIN.
  // Drop sslmode so the ssl option above is the one that is used. TLS stays on.
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

function failureReason(err) {
  if (!databaseUrl()) return "DATABASE_URL is missing";
  if (!pool && !err) return "database connection is not open";
  if (!err) return "the database write did not succeed";
  return safeMessage(err);
}

function logFields(fields) {
  const lines = ["[hh-maps]"];
  Object.keys(fields).forEach((key) => {
    const value = fields[key];
    if (value === undefined || value === null || value === "") return;
    lines.push(key + ": " + redact(value));
  });
  console.error(lines.join("\n"));
}

function logFailure(action, err, map) {
  logFields({
    event: action + " failed",
    "connection status": pool ? "connected" : "not connected",
    DATABASE_URL: databaseUrl() ? "set" : "missing",
    "database host": databaseUrl() ? databaseHost(databaseUrl()) : "",
    table: TABLE,
    "map id": map && map.id,
    "map name": map && map.name,
    operation: action,
    "error message": err ? safeMessage(err) : failureReason(null),
    "error code": err && err.code ? String(err.code) : ""
  });
  if (err && err.stack) console.error(redact(err.stack));
}

function enabled() {
  return !!pool;
}

async function connect() {
  const url = databaseUrl();
  if (!url) {
    const err = new Error("DATABASE_URL is missing");
    logFields({
      event: "database initialization failed",
      DATABASE_URL: "missing",
      "connection status": "not connected",
      table: TABLE,
      "error message": err.message
    });
    throw err;
  }
  const host = databaseHost(url);
  const ssl = sslOption(url);
  console.log("[hh-maps] DATABASE_URL is set");
  console.log("[hh-maps] database host: " + host);
  console.log("[hh-maps] tls: " + (ssl ? "enabled" : "disabled"));
  console.log("[hh-maps] operation: connect");
  console.log("[hh-maps] operation: CREATE TABLE IF NOT EXISTS " + TABLE);
  pool = new Pool({
    connectionString: connectionStringForPg(url),
    ssl: ssl,
    max: 4,
    connectionTimeoutMillis: 10000
  });
  pool.on("error", (err) => {
    logFailure("idle database client", err, null);
  });
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS hh_maps (id text PRIMARY KEY, document jsonb NOT NULL)"
    );
    await pool.query("SELECT 1");
    console.log("[hh-maps] database connected");
    console.log("[hh-maps] connection status: connected");
    console.log("[hh-maps] table " + TABLE + ": ready");
    return true;
  } catch (err) {
    const failed = pool;
    pool = null;
    logFailure("connect", err, null);
    try {
      await failed.end();
    } catch (endErr) {
      /* The failed pool is discarded either way. */
    }
    throw err;
  }
}

async function loadAll() {
  if (!pool) {
    const err = new Error(failureReason(null));
    logFailure("SELECT id, document FROM hh_maps", err, null);
    throw err;
  }
  const result = await pool.query("SELECT id, document FROM hh_maps");
  return result.rows.map((row) => ({
    id: row.id,
    document: row.document
  }));
}

async function loadOne(id) {
  if (!pool) return null;
  const result = await pool.query("SELECT document FROM hh_maps WHERE id = $1", [id]);
  if (!result.rows.length) return null;
  return result.rows[0].document;
}

async function save(map) {
  if (!pool) throw new Error(failureReason(null));
  console.log("[hh-maps] operation: INSERT INTO hh_maps (id, document) ON CONFLICT (id) DO UPDATE");
  console.log("[hh-maps] map id: " + map.id);
  console.log("[hh-maps] map name: " + map.name);
  console.log("[hh-maps] connection status: connected");
  console.log("[hh-maps] table: " + TABLE);
  await pool.query(
    "INSERT INTO hh_maps (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
    [map.id, JSON.stringify(map)]
  );
  const check = await pool.query(
    "SELECT id, document->>'name' AS name FROM hh_maps WHERE id = $1",
    [map.id]
  );
  if (!check.rows.length || check.rows[0].name !== map.name) {
    throw new Error("the database did not confirm the saved map");
  }
  console.log("[hh-maps] write confirmed for map id: " + map.id);
}

module.exports = {
  connect,
  loadAll,
  loadOne,
  save,
  enabled,
  failureReason,
  logFailure,
  safeMessage,
  redact,
  TABLE
};
