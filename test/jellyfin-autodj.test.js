const assert = require("node:assert/strict");
const test = require("node:test");

let activeHandler;
let activeRequests = [];

async function mockFetch(input) {
  const url = new URL(input);
  activeRequests.push(url);
  const result = activeHandler(url) || { body: { Items: [] } };
  const status = result.status || 200;
  return { status, ok: status >= 200 && status < 300, json: async () => result.body };
}

const fetchPath = require.resolve("node-fetch");
require(fetchPath);
const originalFetch = require.cache[fetchPath].exports;
require.cache[fetchPath].exports = mockFetch;
const jellyfin = require("../jellyfin");
require.cache[fetchPath].exports = originalFetch;

function track(id, { artist = `Artist ${id}`, artistId = `artist-${id}`, albumId = "album-1", genre = "Rock" } = {}) {
  return {
    Id: id,
    Name: id,
    Artists: [artist],
    ArtistItems: [{ Id: artistId }],
    AlbumArtist: artist,
    AlbumId: albumId,
    Genres: [genre],
    RunTimeTicks: 1800000000,
    Container: "mp3"
  };
}

async function withJellyfin(handler, run) {
  const previous = {
    url: process.env.JELLYFIN_URL,
    key: process.env.JELLYFIN_API_KEY,
    userId: process.env.JELLYFIN_USER_ID
  };
  activeHandler = handler;
  activeRequests = [];
  process.env.JELLYFIN_URL = "http://jellyfin.test";
  process.env.JELLYFIN_API_KEY = "test-key";
  process.env.JELLYFIN_USER_ID = "test-user";
  jellyfin.clearCache();

  try {
    await run(activeRequests);
  } finally {
    jellyfin.clearCache();
    activeHandler = null;
    for (const [key, value] of Object.entries({
      JELLYFIN_URL: previous.url,
      JELLYFIN_API_KEY: previous.key,
      JELLYFIN_USER_ID: previous.userId
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function items(...tracks) {
  return { body: { Items: tracks } };
}

test("AutoDJ unscoped lookup uses InstantMix, genre, then random fallback and filters repeats", async () => {
  await withJellyfin((url) => {
    if (url.pathname === "/Items/seed") return { body: track("seed", { artist: "Seed Artist", genre: "Rock" }) };
    if (url.pathname === "/Items/seed/InstantMix") {
      return items(
        track("seed", { artist: "Seed Artist" }),
        track("recent", { artist: "Recent Artist" }),
        track("mix-1", { artist: "Mix Artist" })
      );
    }
    if (url.pathname === "/Items" && url.searchParams.get("Genres") === "Rock") {
      return items(track("mix-1"), track("genre-1"));
    }
    if (url.pathname === "/Items" && url.searchParams.get("SortBy") === "Random") {
      return items(track("genre-1"), track("random-1"));
    }
    return { status: 404, body: { error: `Unexpected request: ${url.pathname}${url.search}` } };
  }, async (requests) => {
    const result = await jellyfin.nextTracks({
      seed: "seed",
      excludeIds: ["seed", "played"],
      excludeArtists: [" recent artist "],
      limit: 3
    });

    assert.equal(result.seed.id, "seed");
    assert.deepEqual(result.tracks.map((item) => item.id), ["mix-1", "genre-1", "random-1"]);
    assert.deepEqual(requests.map((url) => url.pathname), [
      "/Items/seed",
      "/Items/seed/InstantMix",
      "/Items",
      "/Items"
    ]);
  });
});

test("AutoDJ artist mode uses the seed artist and does not exclude that artist", async () => {
  await withJellyfin((url) => {
    if (url.pathname === "/Items/seed") return { body: track("seed", { artist: "Seed Artist", artistId: "artist-seed" }) };
    if (url.pathname === "/Items") return items(track("artist-track", { artist: "Seed Artist", artistId: "artist-seed" }));
    return { status: 404, body: { error: "Unexpected request" } };
  }, async (requests) => {
    const result = await jellyfin.nextTracks({ seed: "seed", mode: "artist", excludeArtists: ["Seed Artist"], limit: 1 });

    assert.deepEqual(result.tracks.map((item) => item.id), ["artist-track"]);
    assert.equal(requests[1].searchParams.get("ArtistIds"), "artist-seed");
    assert.equal(requests[1].searchParams.get("SortBy"), "Random");
  });
});

test("AutoDJ album mode selects tracks from the seed album", async () => {
  await withJellyfin((url) => {
    if (url.pathname === "/Items/seed") return { body: track("seed", { albumId: "album-seed" }) };
    if (url.pathname === "/Items") return items(track("album-track", { albumId: "album-seed" }));
    return { status: 404, body: { error: "Unexpected request" } };
  }, async (requests) => {
    const result = await jellyfin.nextTracks({ seed: "seed", mode: "album", limit: 1 });

    assert.deepEqual(result.tracks.map((item) => item.id), ["album-track"]);
    assert.equal(requests[1].searchParams.get("ParentId"), "album-seed");
  });
});

test("AutoDJ genre mode uses the seed genre and excludes recent artists", async () => {
  await withJellyfin((url) => {
    if (url.pathname === "/Items/seed") return { body: track("seed", { genre: "Jazz" }) };
    if (url.pathname === "/Items") return items(
      track("recent", { artist: "Recent Artist", genre: "Jazz" }),
      track("jazz-track", { artist: "Other Artist", genre: "Jazz" })
    );
    return { status: 404, body: { error: "Unexpected request" } };
  }, async () => {
    const result = await jellyfin.nextTracks({ seed: "seed", mode: "genre", excludeArtists: ["Recent Artist"], limit: 2 });

    assert.deepEqual(result.tracks.map((item) => item.id), ["jazz-track"]);
  });
});

test("AutoDJ preserves the first lookup error when every source fails", async () => {
  await withJellyfin(() => ({ status: 503, body: { error: "Unavailable" } }), async () => {
    await assert.rejects(
      jellyfin.nextTracks({ seed: "seed" }),
      /Jellyfin returned HTTP 503/
    );
  });
});
