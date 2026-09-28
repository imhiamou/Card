/*
 * Persistent store for Hidden Hunter maps.
 *
 * Render's container disk is wiped on restart and redeploy. Postgres is the
 * copy that has to succeed. The local JSON files are only a cache.
 */

const { Pool } = require("pg");

let pool = null;

function sslOption(url) {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) return false;
  pool = new Pool({
    connectionString: String(url).trim(),
    ssl: sslOption(url),
    max: 4
  });
  await pool.query(
    "CREATE TABLE IF NOT EXISTS hh_maps (id text PRIMARY KEY, document jsonb NOT NULL)"
  );
  return true;
}

async function loadAll() {
  if (!pool) throw new Error("persistent storage is not connected");
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
  if (!pool) throw new Error("persistent storage is not connected");
  await pool.query(
    "INSERT INTO hh_maps (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
    [map.id, JSON.stringify(map)]
  );
}

function enabled() {
  return !!pool;
}

module.exports = { connect, loadAll, loadOne, save, enabled };
