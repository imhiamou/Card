const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MAP_DB_RETRY_MS = "500";
process.env.DATABASE_URL = "postgres://user:s3cret@pg-19f1f72f-card-pip.b.aivencloud.com:5432/defaultdb?sslmode=require";

let hhFailures = 1;
let cartsFailures = 1;
const pools = [];

require.cache[require.resolve("pg")] = {
  id: require.resolve("pg"),
  filename: require.resolve("pg"),
  loaded: true,
  exports: {
    Pool: function Pool(options) {
      pools.push(options);
      const hiddenHunter = options.max === 4;
      return {
        on() {},
        async query(sql) {
          const opening = sql.startsWith("CREATE TABLE") || sql === "SELECT 1";
          if (opening && hiddenHunter && hhFailures > 0) {
            hhFailures -= 1;
            const err = new Error("getaddrinfo ENOTFOUND pg-19f1f72f-card-pip.b.aivencloud.com");
            err.code = "ENOTFOUND";
            throw err;
          }
          if (opening && !hiddenHunter && cartsFailures > 0) {
            cartsFailures -= 1;
            const err = new Error("getaddrinfo ENOTFOUND pg-19f1f72f-card-pip.b.aivencloud.com");
            err.code = "ENOTFOUND";
            throw err;
          }
          if (opening || sql.startsWith("SELECT id, document")) return { rows: [] };
          throw new Error("unexpected sql");
        },
        async end() {}
      };
    }
  }
};

const hh = require("./hhMapPersist");
const carts = require("./cartsMapPersist");

test("hidden hunter reports the connection error and opens a new pool on retry", async () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  await assert.rejects(() => hh.connect());
  console.error = original;
  const text = lines.join("\n");
  assert.match(text, /connect failed/);
  assert.match(text, /ENOTFOUND/);
  assert.equal(text.includes("s3cret"), false);
  assert.equal(text.includes("postgres://"), false);
  assert.equal(text.includes("postgresql://user"), false);

  const reason = hh.failureReason(null);
  assert.match(reason, /ENOTFOUND/);
  assert.equal(reason.includes("database connection is not open"), false);
  assert.equal(reason.includes("s3cret"), false);

  const afterFailure = pools.length;
  await assert.rejects(() => hh.loadAll(), (err) => {
    assert.match(err.message, /ENOTFOUND/);
    assert.equal(err.message.includes("s3cret"), false);
    assert.equal(err.message.includes("database connection is not open"), false);
    return true;
  });
  assert.equal(pools.length, afterFailure);

  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(await hh.ensure(), true);
  assert.equal(hh.enabled(), true);
  assert.equal(pools.length, afterFailure + 1);
  assert.deepEqual(await hh.loadAll(), []);
  assert.deepEqual(pools[0].ssl, { rejectUnauthorized: false });
  assert.equal(pools[0].connectionString.includes("sslmode"), false);
  assert.equal(pools[0].connectionString.includes("s3cret"), true);
});

test("carts uses the same retry and does not hide a connection failure", async () => {
  await assert.rejects(() => carts.connect());
  const reason = carts.failureReason(null);
  assert.match(reason, /ENOTFOUND/);
  assert.equal(reason.includes("database connection is not open"), false);
  assert.equal(reason.includes("DATABASE_URL is missing"), false);
  const afterFailure = pools.length;
  assert.equal(await carts.ensure(), false);
  assert.equal(pools.length, afterFailure);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(await carts.ensure(), true);
  assert.equal(carts.enabled(), true);
  assert.equal(await carts.loadAll().then((rows) => rows.length), 0);
});
