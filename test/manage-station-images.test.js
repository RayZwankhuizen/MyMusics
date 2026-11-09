const assert = require("node:assert/strict");
const test = require("node:test");

test("station image errors explain unavailable routes and preserve server messages", async () => {
  const { stationImageApiError } = await import("../public/manage-station-images.mjs");
  const legacyRoute = await stationImageApiError({
    headers: { get: () => "text/html" }, status: 404, async text() { return "<!doctype html>"; }
  }, "Logo upload failed.");
  assert.equal(legacyRoute.message, "This MyMusics server does not have the logo import API. Restart the updated server and reload this page.");

  const rejected = await stationImageApiError({
    headers: { get: () => "application/json" }, async json() { return { error: "Image is too large." }; }
  }, "Logo upload failed.");
  assert.equal(rejected.message, "Image is too large.");
});
