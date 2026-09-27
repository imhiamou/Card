/*
 * Persistent copy of saved Hidden Hunter maps.
 *
 * Render's container disk is wiped on redeploy. When DATABASE_URL is set,
 * Postgres is the copy that survives restarts and new builds. The local JSON
 * files remain a cache so map reads stay synchronous during a match.
 */

const { Client } = require("pg");

let client = null;

function sslOption(url) {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) return false;
  client = new Client({
    connectionString: url,
    ssl: sslOption(url)
  });
  await client.connect();
  await client.query(
    "CREATE TABLE IF NOT EXISTS hh_maps (id text PRIMARY KEY, document jsonb NOT NULL)"
  );
  return true;
}

async function loadAll() {
  if (!client) return [];
  const result = await client.query("SELECT id, document FROM hh_maps");
  return result.rows.map((row) => ({
    id: row.id,
    document: row.document
  }));
}

async function save(map) {
  if (!client) return;
  await client.query(
    "INSERT INTO hh_maps (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
    [map.id, JSON.stringify(map)]
  );
}

function enabled() {
  return !!client;
}

module.exports = { connect, loadAll, save, enabled };
