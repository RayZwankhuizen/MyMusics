const assert = require("node:assert/strict");
const test = require("node:test");

let activeHandler;
let activeRequests = [];

async function mockFetch(input) {
  const url = new URL(input);
  activeRequests.push(url);
  const result = activeHandler(url) || { body: {} };
  const status = result.status || 200;
  return { status, ok: status >= 200 && status < 300, json: async () => result.body };
}

const fetchPath = require.resolve("node-fetch");
require(fetchPath);
const originalFetch = require.cache[fetchPath].exports;
require.cache[fetchPath].exports = mockFetch;
const jellyfin = require("../jellyfin");
require.cache[fetchPath].exports = originalFetch;

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
    activeHandler = null;
    jellyfin.clearCache();
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

const items = (...values) => ({ body: { Items: values } });

test("track search maps Jellyfin metadata and sends the expected query", async () => {
  await withJellyfin((url) => url.pathname === "/Items" && url.searchParams.get("searchTerm") === "night"
    ? items({
      Id: "track-1",
      Name: "Night Drive",
      Artists: ["Artist One"],
      ArtistItems: [{ Id: "artist-1" }],
      Album: "After Dark",
      AlbumId: "album-1",
      Genres: ["Electronic", "Ambient"],
      ProductionYear: 2024,
      RunTimeTicks: 1234567890,
      Container: "FLAC,M4A"
    })
    : { status: 404, body: { error: "Unexpected request" } }, async (requests) => {
    const result = await jellyfin.searchTracks("night", 7);

    assert.deepEqual(result, [{
      kind: "track",
      id: "track-1",
      title: "Night Drive",
      artist: "Artist One",
      artistId: "artist-1",
      album: "After Dark",
      albumId: "album-1",
      genre: "Electronic",
      year: 2024,
      durationMs: 123457,
      container: "flac",
      art: "/library/art/album-1"
    }]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("IncludeItemTypes"), "Audio");
    assert.equal(requests[0].searchParams.get("Recursive"), "true");
    assert.equal(requests[0].searchParams.get("SortBy"), "SortName");
    assert.equal(requests[0].searchParams.get("Limit"), "7");
    assert.equal(requests[0].searchParams.get("Fields"), "Genres,AlbumArtist,Artists,AlbumId,RunTimeTicks,ProductionYear,Container");
  });
});

test("album search keeps playable albums and tolerates failed playability checks", async () => {
  await withJellyfin((url) => {
    if (url.pathname !== "/Items") return { status: 404, body: {} };
    if (url.searchParams.has("searchTerm")) return items(
      { Id: "album-1", Name: "One", AlbumArtist: "A", ProductionYear: 2001, ChildCount: 10 },
      { Id: "album-2", Name: "Two", AlbumArtist: "B", ChildCount: 8 },
      { Id: "album-3", Name: "Three", AlbumArtist: "C" }
    );
    if (url.searchParams.get("ParentId") === "album-1") return items({ Id: "track-1" });
    if (url.searchParams.get("ParentId") === "album-2") return items();
    if (url.searchParams.get("ParentId") === "album-3") return { status: 503, body: { error: "Unavailable" } };
    return { status: 404, body: {} };
  }, async (requests) => {
    const result = await jellyfin.searchAlbums("one", 9);

    assert.deepEqual(result.map((album) => album.id), ["album-1", "album-3"]);
    assert.deepEqual(result[0], {
      kind: "album", id: "album-1", title: "One", artist: "A", genre: "", year: 2001, trackCount: 10, art: "/library/art/album-1"
    });
    const listing = requests.find((url) => url.searchParams.has("searchTerm"));
    assert.equal(listing.searchParams.get("IncludeItemTypes"), "MusicAlbum");
    assert.equal(listing.searchParams.get("Limit"), "9");
    assert.equal(requests.filter((url) => url.searchParams.has("ParentId")).length, 3);
  });
});

test("artist listing removes folders and nested artist folders", async () => {
  await withJellyfin((url) => {
    if (url.pathname !== "/Items") return { status: 404, body: {} };
    const parent = url.searchParams.get("ParentId");
    if (parent === "parent") return items({ Id: "nested-artist" });
    if (parent === "artist") return items();
    if (parent) return items();
    return items(
      { Id: "folder", Name: "Folder", IsFolder: true },
      { Id: "parent", Name: "Parent", ChildCount: 2 },
      { Id: "artist", Name: "Solo Artist", ChildCount: 1 },
      { Id: "album-artist", Name: "Album Artist", AlbumCount: 2, ChildCount: 2 }
    );
  }, async (requests) => {
    const result = await jellyfin.allArtists(12);

    assert.deepEqual(result, [
      { kind: "artist", id: "artist", title: "Solo Artist", albumCount: 1 },
      { kind: "artist", id: "album-artist", title: "Album Artist", albumCount: 2 }
    ]);
    assert.equal(requests[0].searchParams.get("IncludeItemTypes"), "MusicArtist");
    assert.equal(requests[0].searchParams.get("Limit"), "12");
    assert.deepEqual(new Set(requests.slice(1).map((url) => url.searchParams.get("ParentId"))), new Set(["parent", "artist"]));
  });
});

test("combined search prioritizes an exact genre and tolerates a failed category", async () => {
  await withJellyfin((url) => {
    if (url.pathname === "/MusicGenres") return { body: [
      { Id: "genre-jazz", Name: "Jazz" },
      { Id: "genre-fusion", Name: "Jazz Fusion" }
    ] };
    if (url.pathname !== "/Items") return { status: 404, body: {} };
    const type = url.searchParams.get("IncludeItemTypes");
    if (url.searchParams.has("searchTerm") && type === "Audio") return items({ Id: "track-1", Name: "Jazz at Night", Artists: ["A"] });
    if (url.searchParams.has("searchTerm") && type === "MusicAlbum") return items();
    if (url.searchParams.has("searchTerm") && type === "MusicArtist") return { status: 503, body: { error: "Unavailable" } };
    const genre = url.searchParams.get("Genres");
    if (genre && type === "MusicAlbum") return { body: { TotalRecordCount: genre === "Jazz" ? 3 : 1 } };
    if (genre && type === "Audio") return { body: { TotalRecordCount: genre === "Jazz" ? 20 : 4 } };
    return { status: 404, body: { error: "Unexpected request" } };
  }, async () => {
    const result = await jellyfin.searchAll("Jazz");

    assert.deepEqual(result.map((item) => item.id), ["genre-jazz", "track-1", "genre-fusion"]);
    assert.deepEqual(result[0], { kind: "genre", id: "genre-jazz", title: "Jazz", albumCount: 3, trackCount: 20 });
    assert.deepEqual(result[2], { kind: "genre", id: "genre-fusion", title: "Jazz Fusion", albumCount: 1, trackCount: 4 });
  });
});
