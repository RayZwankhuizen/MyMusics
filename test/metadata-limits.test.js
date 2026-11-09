const assert = require("node:assert/strict");
const test = require("node:test");
const { MAX_PENDING_LOOKUPS, canStartLookup, readCache, rememberBounded, writeCache } = require("../routes/metadata-limits");

test("metadata cache expires entries and refreshes least-recently-used order", () => {
  const cache = new Map();
  writeCache(cache, "a", { title: "A" }, 100, 0);
  writeCache(cache, "b", { title: "B" }, 100, 0);
  assert.deepEqual(readCache(cache, "a", 1), { title: "A" });
  for (let index = 0; index < 499; index++) writeCache(cache, `entry-${index}`, index, 100, 1);
  assert.equal(cache.has("b"), false);
  assert.deepEqual(readCache(cache, "a", 2), { title: "A" });
  assert.equal(readCache(cache, "a", 101), undefined);
});

test("bounded maps evict the oldest entry and pending lookups have a cap", () => {
  const cache = new Map();
  rememberBounded(cache, "a", 1, 2);
  rememberBounded(cache, "b", 2, 2);
  rememberBounded(cache, "c", 3, 2);
  assert.deepEqual([...cache.keys()], ["b", "c"]);

  const pending = new Map(Array.from({ length: MAX_PENDING_LOOKUPS }, (_, index) => [`request-${index}`, Promise.resolve()]));
  assert.equal(canStartLookup(pending, "request-0"), true);
  assert.equal(canStartLookup(pending, "new-request"), false);
});
