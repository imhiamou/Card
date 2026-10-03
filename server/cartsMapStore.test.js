const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carts-maps-"));
process.env.CARTS_MAP_DIR = dir;

const rows = [];
const realPersist = require("./cartsMapPersist");
const realSafe = realPersist.safeMessage;
const fake = {
  databaseUrl() { return "postgres://example"; },
  enabled() { return fake.on; },
  on: true,
  connected: false,
  async connect() { fake.connected = true; return true; },
  async loadAll() { return rows.map((row) => ({ id: row.id, document: row })); },
  async save(map) {
    if (fake.fail) {
      const err = fake.fail;
      fake.fail = null;
      throw err;
    }
    const copy = JSON.parse(JSON.stringify(map));
    const index = rows.findIndex((row) => row.id === copy.id);
    if (index >= 0) rows[index] = copy;
    else rows.push(copy);
  },
  async remove(id) {
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
  },
  safeMessage: realSafe
};
require.cache[require.resolve("./cartsMapPersist")].exports = fake;
const store = require("./cartsMapStore");

test("postgres storage initializes, saves, lists, loads, and deletes", async () => {
  const ready = await store.ready();
  assert.equal(ready.persisted, "postgres");
  assert.equal(fake.connected, true);

  const created = await store.saveMap({ name: "Dock", type: "carts", game: "carts", width: 320, height: 320 });
  assert.equal(created.ok, true);
  assert.equal(created.persisted, "postgres");
  assert.match(created.map.id, /^c[a-f0-9]{12}$/);
  assert.equal(created.map.name, "Dock");

  const listed = await store.listMaps();
  assert.equal(listed.ok, true);
  assert.equal(listed.persisted, "postgres");
  assert.equal(listed.maps.filter((item) => item.id === created.map.id && item.name === "Dock").length, 1);

  const loaded = await store.loadMap(created.map.id);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.map.name, "Dock");
  assert.equal(loaded.map.game, "carts");

  loaded.map.name = "Pier";
  const updated = await store.saveMap(loaded.map);
  assert.equal(updated.persisted, "postgres");
  assert.equal(updated.map.id, created.map.id);
  assert.equal((await store.loadMap(created.map.id)).map.name, "Pier");

  const renamed = await store.renameMap(created.map.id, "Harbor");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.persisted, "postgres");
  assert.equal((await store.loadMap(created.map.id)).map.name, "Harbor");

  const removed = await store.deleteMap(created.map.id);
  assert.equal(removed.ok, true);
  assert.equal((await store.loadMap(created.map.id)).ok, false);
  assert.equal((await store.listMaps()).maps.some((item) => item.id === created.map.id), false);
  assert.equal(fs.existsSync(path.join(dir, created.map.id + ".json")), false);
});

test("a database failure is reported without the connection string", async () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  fake.fail = new Error("insert failed postgres://user:s3cret@db.example.com/card");
  await assert.rejects(() => store.saveMap({ id: "c0123456789ab", name: "Broken", type: "carts" }));
  console.error = original;
  const text = lines.join("\n");
  assert.match(text, /database write failed/);
  assert.match(text, /postgresql:\/\/\[redacted\]/);
  assert.equal(text.includes("s3cret"), false);
});

test("editor map requests use the Render API base", () => {
  const src = fs.readFileSync(path.join(__dirname, "../assets/carts/carts-editor.js"), "utf8");
  assert.match(src, /const CARTS_API_BASE="https:\/\/cardb-2uys\.onrender\.com"/);
  assert.equal(src.includes('fetch("/api/carts-maps'), false);
  assert.equal(src.includes("fetch('/api/carts-maps"), false);
  assert.match(src, /cartsApi\("\/api\/carts-maps"\)/);
  assert.match(src, /\/rename"/);
  assert.match(src, /Saved "\+map\.name\+" to the database"/);
});
