const assert = require("node:assert/strict");
const test = require("node:test");

test("refresh outcomes preserve terminal messages and progress", async () => {
  const { refreshOutcome } = await import("../public/music-refresh-events.mjs");
  assert.deepEqual(refreshOutcome({ completed: true, progressAvailable: true }), {
    progress: null, message: "Jellyfin library refresh complete."
  });
  assert.deepEqual(refreshOutcome({ completed: false, progressAvailable: false, progressUnavailableMessage: "Scan status unavailable." }), {
    progress: null, message: "Scan status unavailable."
  });
  assert.deepEqual(refreshOutcome({ completed: false, progressAvailable: false }), {
    progress: null, message: "Refresh requested · Jellyfin does not report scan progress."
  });
  assert.deepEqual(refreshOutcome({ completed: false, progressAvailable: true, sawRunning: true, lastProgress: 42.4 }), {
    progress: 42.4, message: "Jellyfin scan is still running · 42%"
  });
  assert.deepEqual(refreshOutcome({ completed: false, progressAvailable: true, sawRunning: true, lastProgress: null }), {
    progress: null, message: "Jellyfin scan is still running."
  });
  assert.deepEqual(refreshOutcome({ completed: false, progressAvailable: true, sawRunning: false }), {
    progress: null, message: "Refresh requested · Jellyfin has not reported scan progress yet."
  });
});

test("refresh status polling tracks a running scan until completion", async () => {
  const { pollRefreshStatus } = await import("../public/music-refresh-events.mjs");
  const statuses = [
    { ok: true, async json() { return { available: true, running: true, progress: 27 }; } },
    { ok: true, async json() { return { available: true, running: false }; } }
  ];
  const progress = [];
  const messages = [];
  const waits = [];
  const result = await pollRefreshStatus({
    fetchStatus: async () => statuses.shift(),
    reportRefresh: (message) => messages.push(message),
    setRefreshProgress: (value) => progress.push(value),
    now: () => 0,
    wait: async (milliseconds) => waits.push(milliseconds)
  });
  assert.deepEqual(result, {
    completed: true, progressAvailable: true, sawRunning: true, lastProgress: 27, progressUnavailableMessage: ""
  });
  assert.deepEqual(progress, [27]);
  assert.deepEqual(messages, ["Jellyfin is scanning the library · 27%"]);
  assert.deepEqual(waits, [1500]);
});

test("refresh status polling reports an unavailable endpoint and stops", async () => {
  const { pollRefreshStatus } = await import("../public/music-refresh-events.mjs");
  let requests = 0;
  const result = await pollRefreshStatus({
    fetchStatus: async () => { requests++; return { ok: false, status: 404 }; },
    reportRefresh() {},
    setRefreshProgress() {},
    now: () => 0,
    wait: async () => assert.fail("unavailable endpoint must stop polling")
  });
  assert.equal(requests, 1);
  assert.equal(result.progressAvailable, false);
  assert.equal(result.progressUnavailableMessage, "Refresh sent · restart MyMusics to enable scan progress.");
});
