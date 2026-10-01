const test = require("node:test");
const assert = require("node:assert/strict");
const domino = require("./domino");

function samples(speed, n) {
  const room = { dominoBotSpeed: speed };
  const values = [];
  for (let i = 0; i < n; i++) values.push(domino.botDelayMs(room));
  return values;
}

test("normal bot delay stays in the original window", () => {
  const prev = process.env.BOT_TEST_FAST;
  delete process.env.BOT_TEST_FAST;
  const values = samples("normal", 40);
  values.forEach((ms) => {
    assert.ok(ms >= 2400 && ms < 4200, "normal " + ms);
  });
  if (prev == null) delete process.env.BOT_TEST_FAST;
  else process.env.BOT_TEST_FAST = prev;
});

test("slow is longer than normal and fast is shorter but not instant", () => {
  const prev = process.env.BOT_TEST_FAST;
  delete process.env.BOT_TEST_FAST;
  samples("slow", 20).forEach((ms) => {
    assert.ok(ms >= 5200 && ms < 7000, "slow " + ms);
  });
  samples("fast", 20).forEach((ms) => {
    assert.ok(ms >= 900 && ms < 1400, "fast " + ms);
  });
  samples(undefined, 10).forEach((ms) => {
    assert.ok(ms >= 2400 && ms < 4200, "default " + ms);
  });
  if (prev == null) delete process.env.BOT_TEST_FAST;
  else process.env.BOT_TEST_FAST = prev;
});

test("BOT_TEST_FAST still skips the think time", () => {
  const prev = process.env.BOT_TEST_FAST;
  process.env.BOT_TEST_FAST = "1";
  assert.equal(domino.botDelayMs({ dominoBotSpeed: "slow" }), 5);
  assert.equal(domino.botDelayMs({ dominoBotSpeed: "fast" }), 5);
  if (prev == null) delete process.env.BOT_TEST_FAST;
  else process.env.BOT_TEST_FAST = prev;
});
