const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const nativeFetch = globalThis.fetch;
const upstreamCalls = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  upstreamCalls.push({ url, options });
  if (url.pathname.endsWith("/videos")) return new Response(JSON.stringify({ items: [{ id: "abcdefghijk", snippet: { title: "A result", channelTitle: "An artist" }, contentDetails: { duration: "PT1H2M3S" } }] }));
  return new Response(JSON.stringify({ nextPageToken: "PAGE_TWO=", items: [
    { id: url.searchParams.get("type") === "video" ? { videoId: "abcdefghijk" } : { playlistId: "PLabcdefghijk" },
      snippet: { title: "A result", channelTitle: "An artist" } }
  ] }), { headers: { "Content-Type": "application/json" } });
};
let registerVideoRoutes;
try { registerVideoRoutes = require("../routes/videos"); }
finally { globalThis.fetch = nativeFetch; }

test("video and playlist search APIs forward opaque page tokens and return the next page", async (t) => {
  const app = express();
  registerVideoRoutes(app, { storage: { readYouTubeSettings: () => ({ apiKey: "test" }) } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [endpoint, kind] of [["search", "video"], ["search-playlists", "playlist"]]) {
    const response = await nativeFetch(`${base}/api/videos/${endpoint}?q=artist&pageToken=PAGE_ONE%3D`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.nextPageToken, "PAGE_TWO=");
    assert.equal(data.results.length, 1);
    assert.equal(upstreamCalls.at(-1).url.searchParams.get("pageToken"), "PAGE_ONE=");
    assert.equal(upstreamCalls.at(-1).url.searchParams.get("type"), kind);
    assert.ok(upstreamCalls.at(-1).options.signal instanceof AbortSignal);
    const invalid = await nativeFetch(`${base}/api/videos/${endpoint}?q=artist&pageToken=${"a".repeat(513)}`);
    assert.equal(invalid.status, 400);
    await invalid.body.cancel();
  }
  assert.equal(upstreamCalls.length, 2);
  const details = await nativeFetch(`${base}/api/videos/details?ids=abcdefghijk`);
  assert.equal(details.status, 200);
  assert.equal((await details.json()).videos[0].durationSeconds, 3723);
  assert.equal(upstreamCalls.at(-1).url.searchParams.get("part"), "snippet,contentDetails");
});
