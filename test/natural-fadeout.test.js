const assert = require("node:assert/strict");
const test = require("node:test");

test("natural fadeout seconds accept the inclusive 2–60 second range", async () => {
  const { naturalFadeoutSeconds } = await import("../public/natural-fadeout.mjs");
  for (const [value, expected] of [[2, 2], ["5", 5], [60, 60], [1, 0], [61, 0], ["bad", 0], [Infinity, 0], [null, 0]]) {
    assert.equal(naturalFadeoutSeconds(value), expected);
  }
});
