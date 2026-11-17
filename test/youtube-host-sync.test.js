const assert = require("node:assert/strict");
const test = require("node:test");

async function harness({ start, prepared } = {}) {
  const { createYoutubeHostSync } = await import("../public/youtube-host-sync.mjs");
  const desired = { active: true, videoId: "video-one01", state: "cued", time: 12, rate: 1 };
  const calls = [], errors = [], sessions = [];
  let status;
  const sync = createYoutubeHostSync({
    snapshot: () => ({ ...desired }), now: () => 0,
    onSession: (id) => sessions.push(id), onError: (error) => errors.push(error),
    onPrepared: (id) => { if (prepared) prepared(desired, id); },
    request: async (path, options = {}) => {
      const body = options.body && JSON.parse(options.body);
      calls.push({ path, body, keepalive: options.keepalive });
      if (path.endsWith("/video")) {
        if (start) await start(body);
        status = { activeType: "video", videoId: body.videoId, decks: { a: { time: body.startSeconds, paused: true, playing: false } } };
        return { sessionId: `session-${body.videoId}` };
      }
      if (path.endsWith("/status")) return structuredClone(status);
      const deck = status.decks.a;
      if (body.action === "seek") deck.time = body.value;
      if (body.action === "pause") { deck.paused = true; deck.playing = false; }
      if (body.action === "resume") { deck.paused = false; deck.playing = true; }
      return { ok: true };
    }
  });
  return { sync, desired, calls, errors, sessions, status: () => status,
    controls: () => calls.filter((call) => call.body?.action).map((call) => call.body) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("video audio prepares paused, aligns position and only resumes with the image", async () => {
  const h = await harness();
  await h.sync.sync();
  assert.equal(h.calls[0].body.paused, true);
  assert.deepEqual(h.controls().map((c) => c.action), ["seek"]);
  h.desired.state = "playing";
  await h.sync.sync();
  assert.equal(h.controls().at(-1).action, "resume");
  assert.equal(h.errors.length, 0);
});

test("buffering and pause stop audio; seeking in either direction realigns before resuming", async () => {
  const h = await harness({ prepared: (desired) => { desired.state = "playing"; } });
  await h.sync.sync();
  for (const state of ["buffering", "paused"]) {
    h.desired.state = state;
    h.desired.time += 10;
    await h.sync.sync();
    assert.equal(h.status().decks.a.paused, true);
    assert.equal(h.status().decks.a.time, h.desired.time);
    h.desired.state = "playing";
    await h.sync.sync();
  }
  h.desired.time = 3;
  await h.sync.sync();
  assert.equal(h.status().decks.a.time, 3);
  assert.equal(h.status().decks.a.paused, false);
});

test("small drift is tolerated while larger drift and playback speed are corrected", async () => {
  const h = await harness({ prepared: (desired) => { desired.state = "playing"; } });
  await h.sync.sync();
  h.calls.length = 0;
  h.desired.time += 0.2;
  await h.sync.sync();
  assert.equal(h.controls().length, 0);
  h.desired.time += 1;
  h.desired.rate = 1.5;
  await h.sync.sync();
  assert.deepEqual(h.controls().map((c) => [c.action, c.value]), [["speed", 1.5], ["seek", h.desired.time]]);
});

test("switching output during a slow host load cancels the obsolete audio session", async () => {
  const load = deferred();
  const h = await harness({ start: () => load.promise });
  const pending = h.sync.sync();
  h.desired.active = false;
  const stopped = h.sync.sync({ keepalive: true });
  load.resolve();
  await Promise.all([pending, stopped]);
  assert.deepEqual(h.controls().map((c) => c.action), ["stop"]);
  assert.equal(h.calls.at(-1).keepalive, true);
  assert.equal(h.sync.videoId, "");
});

test("a newer selection waits for an old load and receives no old resume commands", async () => {
  const load = deferred();
  const h = await harness({ start: (body) => body.videoId === "video-one01" ? load.promise : undefined,
    prepared: (desired) => { desired.state = "playing"; } });
  const first = h.sync.sync();
  h.desired.videoId = "video-two02";
  const second = h.sync.sync();
  load.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.controls().filter((c) => c.videoId === "video-one01").map((c) => c.action), ["stop"]);
  assert.equal(h.sync.videoId, "video-two02");
  assert.equal(h.controls().at(-1).action, "resume");
});

test("concurrent synchronization checks share one pending host load", async () => {
  const load = deferred();
  const h = await harness({ start: () => load.promise });
  const pending = Array.from({ length: 6 }, () => h.sync.sync());
  load.resolve();
  await Promise.all(pending);
  assert.equal(h.calls.filter((c) => c.path.endsWith("/video")).length, 1);
});

test("a host taken over by another mode is left untouched", async () => {
  const h = await harness();
  await h.sync.sync();
  h.calls.length = 0;
  h.status().activeType = "radio";
  await h.sync.sync();
  assert.equal(h.controls().length, 0);
  assert.equal(h.errors[0].status, 409);
  assert.equal(h.sync.videoId, "");
});
