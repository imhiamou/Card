const test = require("node:test");
const assert = require("node:assert/strict");

const queries = [];
const table = new Map();
const pools = [];

require.cache[require.resolve("pg")] = {
  id: require.resolve("pg"),
  filename: require.resolve("pg"),
  loaded: true,
  exports: {
    Pool: function Pool(options) {
      pools.push(options);
      return {
        on() {},
        async query(sql, params) {
          queries.push({ sql: sql, params: params || [] });
          if (sql.startsWith("CREATE TABLE")) return { rows: [] };
          if (sql === "SELECT 1") return { rows: [] };
          if (sql.startsWith("SELECT id, document")) {
            return { rows: [...table.values()].map((doc) => ({ id: doc.id, document: doc })) };
          }
          if (sql.startsWith("INSERT INTO carts_maps")) {
            table.set(params[0], JSON.parse(params[1]));
            return { rows: [] };
          }
          if (sql.startsWith("DELETE FROM carts_maps")) {
            table.delete(params[0]);
            return { rows: [] };
          }
          throw new Error("unexpected sql");
        },
        async end() {}
      };
    }
  }
};

process.env.DATABASE_URL = "postgres://user:s3cret@example.aivencloud.com:5432/defaultdb?sslmode=require";
const persist = require("./cartsMapPersist");

test("carts_maps initializes and stores a document", async () => {
  assert.equal(await persist.connect(), true);
  assert.equal(pools.length, 1);
  assert.deepEqual(pools[0].ssl, { rejectUnauthorized: false });
  assert.equal(pools[0].connectionString.includes("sslmode"), false);
  assert.equal(pools[0].connectionString.includes("s3cret"), true);
  assert.match(queries[0].sql, /CREATE TABLE IF NOT EXISTS carts_maps/);

  const map = { id: "c0123456789ab", name: "Dock", type: "carts", game: "carts" };
  await persist.save(map);
  await persist.save({ id: map.id, name: "Pier", type: "carts", game: "carts" });
  const loaded = await persist.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, map.id);
  assert.equal(loaded[0].document.name, "Pier");
  await persist.remove(map.id);
  assert.deepEqual(await persist.loadAll(), []);
});

test("database errors do not keep the connection string", () => {
  const message = persist.safeMessage(new Error("fail " + process.env.DATABASE_URL));
  assert.match(message, /postgresql:\/\/\[redacted\]/);
  assert.equal(message.includes("s3cret"), false);
});
