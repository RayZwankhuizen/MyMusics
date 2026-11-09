const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { Readable } = require("node:stream");
const { createStorage } = require("../storage");
const registerUpdateRoutes = require("../routes/updates");
const registerStationRoutes = require("../routes/stations");
const registerMusicRoutes = require("../routes/music");
const registerHostPlayerRoutes = require("../routes/host-player");
const registerMetadataRoutes = require("../routes/metadata");
const registerMetadataProviderRoutes = require("../routes/metadata-providers");
const registerHealthRoute = require("../routes/health");
const { apiRequest, apiNotFound, apiError } = require("../middleware/api");

function createPlaylists() {
  const playlists = [{ id: "local-list", name: "Favorites", tracks: [], updatedAt: "2026-11-08T00:00:00.000Z" }];
  let nextId = 0;
  const summary = ({ id, name, tracks, updatedAt }) => ({ id, name, trackCount: tracks.length, updatedAt: updatedAt || null });
  return {
    list: () => playlists.map(summary),
    search: (term, limit) => playlists.filter(({ name }) => name.toLowerCase().includes(String(term).toLowerCase())).slice(0, limit).map(summary),
    get: (id) => playlists.find((playlist) => playlist.id === id) || null,
    create: (name) => {
      if (!String(name || "").trim()) return { error: "Enter a playlist name." };
      const playlist = { id: `created-${++nextId}`, name: String(name).trim(), tracks: [] };
      playlists.push(playlist);
      return { playlist };
    },
    rename: (id, name) => {
      const playlist = playlists.find((entry) => entry.id === id);
      if (!playlist) return { error: "Playlist not found.", status: 404 };
      playlist.name = String(name || "").trim();
      return { playlist };
    },
    remove: (id) => {
      const index = playlists.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      playlists.splice(index, 1);
      return true;
    },
    addTrack: (id, track) => {
      const playlist = playlists.find((entry) => entry.id === id);
      if (!playlist) return { error: "Playlist not found.", status: 404 };
      playlist.tracks.push(track);
      return { playlist };
    },
    removeTrack: (id, index) => {
      const playlist = playlists.find((entry) => entry.id === id);
      if (!playlist || !Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
        return { error: "Track not found in this playlist.", status: 404 };
      }
      playlist.tracks.splice(index, 1);
      return { playlist };
    }
  };
}

async function testServer(t, { jellyfin = { configured: () => false, serverUrl: () => "" }, playlists = createPlaylists(), hostPlayer } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mymusics-routes-"));
  const storage = createStorage({ dataDir: path.join(root, "data"), rootDir: root });
  storage.writeStations({ Jazz: [] });

  const app = express();
  app.use(apiRequest);
  app.use(express.json({ limit: "1mb" }));
  registerHealthRoute(app, "v1.0.0");
  registerUpdateRoutes(app, { storage, appVersion: "v1.0.0", appBuildDate: "", updateScript: path.join(root, "updater") });
  const getStations = registerStationRoutes(app, { storage });
  registerMusicRoutes(app, { jellyfin, playlists });
  registerHostPlayerRoutes(app, { hostPlayer: hostPlayer || {
    status: async () => ({ playing: false }), playRadio: async () => {}, playMusic: async () => {}, control: async () => {}, stop: async () => {}
  }, getStations });
  registerMetadataRoutes(app, { getStations });
  registerMetadataProviderRoutes(app);
  app.use(apiNotFound);
  app.use(apiError);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, route, { method = "GET", body, raw, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body === undefined && raw === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: response.status, body: parsed, cacheControl: response.headers.get("cache-control"), headers: response.headers };
}

test("station routes validate, persist, and expose edits", async (t) => {
  const base = await testServer(t);
  assert.deepEqual((await request(base, "/stations")).body, { Jazz: [] });

  const added = await request(base, "/api/genres/Jazz/stations", {
    method: "POST", body: { name: "Local FM", url: "https://radio.example/stream", type: "mp3" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.Jazz[0].name, "Local FM");
  assert.equal(added.body.Jazz[0].speechVolumePercent, 30);

  const invalid = await request(base, "/api/genres/Jazz/stations", {
    method: "POST", body: { name: "Bad", url: "file:///etc/passwd", type: "mp3" }
  });
  assert.equal(invalid.status, 400);

  const favorite = await request(base, "/api/genres/Jazz/stations/0/favorite", {
    method: "PATCH", body: { favorite: true }
  });
  assert.equal(favorite.body.Jazz[0].favorite, true);
  assert.equal((await request(base, "/stations")).body.Jazz[0].favorite, true);
});

test("station image routes validate uploads, persist references, and reject unsupported sources", async (t) => {
  const base = await testServer(t);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const uploaded = await request(base, "/api/station-images", {
    method: "POST", raw: png, headers: { "Content-Type": "image/png" }
  });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.image, /^\/station-images\/[\da-f-]+\.png$/);

  const station = await request(base, "/api/genres/Jazz/stations", {
    method: "POST", body: { name: "Logo Radio", url: "https://radio.example/live", type: "mp3", image: uploaded.body.image }
  });
  assert.equal(station.status, 200);
  assert.equal(station.body.Jazz[0].image, uploaded.body.image);

  const invalidImage = await request(base, "/api/station-images", {
    method: "POST", raw: Buffer.from("not an image"), headers: { "Content-Type": "image/png" }
  });
  assert.equal(invalidImage.status, 400);
  assert.deepEqual(invalidImage.body, { error: "Upload a valid PNG, JPEG, or WebP image." });

  const unsupportedImage = await request(base, "/api/station-images", {
    method: "POST", raw: Buffer.from("gif"), headers: { "Content-Type": "image/gif" }
  });
  assert.equal(unsupportedImage.status, 400);

  const missingSource = await request(base, "/api/station-images/find", { method: "POST", body: {} });
  assert.equal(missingSource.status, 400);
  const unsupportedSource = await request(base, "/api/station-images/find", {
    method: "POST", body: { imageUrl: "file:///etc/passwd" }
  });
  assert.equal(unsupportedSource.status, 422);
  assert.deepEqual(unsupportedSource.body, { error: "Only public HTTP or HTTPS URLs are supported." });
});

test("music, updater, and metadata routes register with their expected guards", async (t) => {
  const base = await testServer(t);
  assert.deepEqual((await request(base, "/health")).body, { status: "ok", version: "v1.0.0" });
  assert.deepEqual((await request(base, "/api/music/status")).body, { configured: false, server: "" });
  assert.equal((await request(base, "/api/music/playlists")).body.playlists[0].name, "Favorites");
  assert.deepEqual((await request(base, "/api/music/search?type=playlist")).body.results[0].id, "local-list");
  assert.equal((await request(base, "/api/update/status")).body.state, "idle");
  assert.equal((await request(base, "/nowplaying?url=https%3A%2F%2Fexample.test%2Fstream")).status, 400);
  assert.equal((await request(base, "/nowplaying/events?url=https%3A%2F%2Fexample.test%2Fstream")).status, 400);
  assert.equal((await request(base, "/metadata")).status, 400);
  const missing = await request(base, "/api/no-such-route");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "API endpoint not found." });
  assert.match(missing.cacheControl, /no-store/);
  const longUrl = await request(base, `/api/no-such-route?q=${"x".repeat(9000)}`);
  assert.equal(longUrl.status, 414);
  assert.deepEqual(longUrl.body, { error: "API request URL is too long." });
  const malformed = await request(base, "/api/genres", { method: "POST", raw: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: "Request body must be valid JSON." });
  const oversized = await request(base, "/api/genres", { method: "POST", raw: "x".repeat(1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { error: "Request body is too large." });
  const invalidEvent = await request(base, "/nowplaying/events?url=https%3A%2F%2Fexample.test%2Fstream");
  assert.equal(invalidEvent.status, 400);
  assert.deepEqual(invalidEvent.body, { error: "Choose a configured stream URL." });
  const missingArt = await request(base, "/library/art/0123456789abcdef");
  assert.equal(missingArt.status, 404);
  assert.deepEqual(missingArt.body, { error: "Music library is not configured." });
});

test("music status redacts credentials from the configured server URL", async (t) => {
  const base = await testServer(t, {
    jellyfin: {
      configured: () => true,
      serverUrl: () => "https://audit-user:audit-password@jellyfin.test"
    }
  });
  assert.deepEqual((await request(base, "/api/music/status")).body, {
    configured: true,
    server: "https://jellyfin.test/"
  });
});

test("playlist API supports CRUD and track edits", async (t) => {
  const base = await testServer(t);
  const invalid = await request(base, "/api/music/playlists", { method: "POST", body: {} });
  assert.equal(invalid.status, 400);

  const created = await request(base, "/api/music/playlists", { method: "POST", body: { name: " Road Mix " } });
  assert.equal(created.status, 201);
  assert.equal(created.body.playlist.id, "created-1");
  assert.equal(created.body.playlist.name, "Road Mix");
  const id = created.body.playlist.id;

  const missing = await request(base, "/api/music/playlists/missing");
  assert.equal(missing.status, 404);
  const track = { id: "0123456789abcdef", title: "Night Drive", artist: "Example" };
  const added = await request(base, `/api/music/playlists/${id}/tracks`, { method: "POST", body: { track } });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.playlist.tracks, [track]);
  const info = await request(base, `/api/music/info?kind=playlist&id=${id}`);
  assert.deepEqual(info.body.info.tracks, [track]);

  const removedTrack = await request(base, `/api/music/playlists/${id}/tracks/0`, { method: "DELETE" });
  assert.deepEqual(removedTrack.body.playlist.tracks, []);
  const renamed = await request(base, `/api/music/playlists/${id}`, { method: "PATCH", body: { name: "Road Mix 2" } });
  assert.equal(renamed.body.playlist.name, "Road Mix 2");
  assert.equal((await request(base, "/api/music/playlists")).body.playlists.some(({ id: value }) => value === id), true);
  assert.equal((await request(base, `/api/music/playlists/${id}`, { method: "DELETE" })).status, 204);
  assert.equal((await request(base, `/api/music/playlists/${id}`)).status, 404);
});

test("music search, item info, album, seed, and AutoDJ APIs pass Jellyfin results and options", async (t) => {
  const calls = {};
  const jellyfin = {
    configured: () => true,
    serverUrl: () => "https://jellyfin.test",
    search: async (term, type) => { calls.search = [term, type]; return [{ id: "track-id", title: "Night Drive" }]; },
    itemInfo: async (id) => ({ Id: id, Name: "Blue Hour", Type: "MusicAlbum", RunTimeTicks: 123_000_000, AlbumId: id }),
    albumTracks: async (id) => { calls.albumTracks = id; return [{ id: "track-id", title: "Night Drive" }]; },
    randomTrackByArtist: async (id) => { calls.artistSeed = id; return { id: "artist-seed" }; },
    randomTrackByGenre: async (genre) => { calls.genreSeed = genre; return { id: "genre-seed" }; },
    nextTracks: async (options) => { calls.nextTracks = options; return { tracks: [{ id: "next-track" }] }; }
  };
  const base = await testServer(t, { jellyfin });

  const search = await request(base, "/api/music/search?q=night%20drive&type=track");
  assert.equal(search.status, 200);
  assert.deepEqual(calls.search, ["night drive", "track"]);
  assert.equal((await request(base, "/api/music/search?q=x&type=track")).status, 400);

  const info = await request(base, "/api/music/info?kind=album&id=album-id");
  assert.equal(info.status, 200);
  assert.equal(info.body.info.durationMs, 12300);
  assert.equal(info.body.info.art, "/library/art/album-id");
  assert.equal((await request(base, "/api/music/album/0123456789abcdef")).body.tracks[0].id, "track-id");
  assert.equal(calls.albumTracks, "0123456789abcdef");

  assert.deepEqual((await request(base, "/api/music/seed?artistId=0123456789abcdef")).body.track, { id: "artist-seed" });
  assert.deepEqual((await request(base, "/api/music/seed?genre=Jazz")).body.track, { id: "genre-seed" });
  assert.equal(calls.artistSeed, "0123456789abcdef");
  assert.equal(calls.genreSeed, "Jazz");
  assert.equal((await request(base, "/api/music/seed")).status, 400);

  const dj = await request(base, "/api/autodj/next?seed=0123456789abcdef&mode=album&exclude=a,b&artists=One,Two&limit=6");
  assert.deepEqual(dj.body.tracks, [{ id: "next-track" }]);
  assert.deepEqual(calls.nextTracks, {
    seed: "0123456789abcdef", excludeIds: ["a", "b"], excludeArtists: ["One", "Two"], limit: 6, mode: "album"
  });
  assert.equal((await request(base, "/api/autodj/next?mode=invalid")).status, 400);
});

test("music audio and artwork proxy headers, range, and transcode options", async (t) => {
  const calls = [];
  const jellyfin = {
    configured: () => true,
    serverUrl: () => "https://jellyfin.test",
    streamAudio: async (...args) => {
      calls.push(args);
      return {
        status: args[2].transcode ? 200 : 206,
        headers: { get: (name) => ({ "content-type": args[2].transcode ? "audio/mpeg" : "audio/flac", "content-length": "3", "accept-ranges": args[2].transcode ? null : "bytes", "content-range": args[2].transcode ? null : "bytes 0-2/10" }[name]) },
        body: Readable.from([Buffer.from("abc")])
      };
    },
    image: async () => ({ ok: true, headers: { get: () => "image/webp" }, body: Readable.from([Buffer.from("art")]) })
  };
  const base = await testServer(t, { jellyfin });

  const ranged = await request(base, "/library/audio/0123456789abcdef", { headers: { Range: "bytes=0-2" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.body, "abc");
  assert.equal(ranged.headers.get("content-range"), "bytes 0-2/10");
  assert.deepEqual(calls[0], ["0123456789abcdef", "bytes=0-2", { transcode: false }]);

  const transcoded = await request(base, "/library/audio/0123456789abcdef?transcode=1");
  assert.equal(transcoded.status, 200);
  assert.equal(transcoded.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(calls[1], ["0123456789abcdef", undefined, { transcode: true }]);

  const art = await request(base, "/library/art/0123456789abcdef");
  assert.equal(art.status, 200);
  assert.equal(art.body, "art");
  assert.equal(art.headers.get("content-type"), "image/webp");
});

test("host-player APIs validate inputs and pass playback commands to the host", async (t) => {
  const calls = [];
  const hostPlayer = {
    status: async () => ({ activeDeck: "a", decks: { a: { playing: true }, b: { playing: false } } }),
    playRadio: async (url) => calls.push(["radio", url]),
    playMusic: async (options) => calls.push(["music", options]),
    control: async (...args) => calls.push(["control", ...args]),
    stop: async () => calls.push(["stop"]),
    audioDevices: async () => [{ name: "alsa/plughw:1,0", description: "Analog", isDefault: true }],
    testAudioDevice: async (device) => calls.push(["audio-test", device])
  };
  const base = await testServer(t, { hostPlayer });
  const station = await request(base, "/api/genres/Jazz/stations", {
    method: "POST", body: { name: "Local FM", url: "https://radio.example/stream", type: "mp3" }
  });
  assert.equal(station.status, 200);

  assert.deepEqual((await request(base, "/api/host-player/status")).body.activeDeck, "a");
  assert.deepEqual((await request(base, "/api/host-player/audio-devices")).body.devices, [
    { name: "alsa/plughw:1,0", description: "Analog", isDefault: true }
  ]);
  assert.equal((await request(base, "/api/host-player/audio-test", {
    method: "POST", body: { device: "alsa/plughw:1,0" }, headers: { Origin: base }
  })).status, 200);
  assert.deepEqual(calls[0], ["audio-test", "alsa/plughw:1,0"]);
  assert.equal((await request(base, "/api/host-player/radio", { method: "POST", body: { url: "https://unknown.test/stream" } })).status, 400);
  assert.equal((await request(base, "/api/host-player/radio", { method: "POST", body: { url: "https://radio.example/stream" } })).status, 200);
  assert.deepEqual(calls[1], ["radio", "https://radio.example/stream"]);

  assert.equal((await request(base, "/api/host-player/music", { method: "POST", body: { id: "bad", deck: "a" } })).status, 400);
  assert.equal((await request(base, "/api/host-player/music", {
    method: "POST", body: { id: "0123456789abcdef", deck: "b", crossfade: true, fadeSeconds: 4, naturalFadeIn: true }
  })).status, 200);
  assert.deepEqual(calls[2], ["music", {
    id: "0123456789abcdef", deck: "b", port: Number(process.env.PORT) || 6565,
    crossfade: true, fadeSeconds: 4, naturalFadeIn: true
  }]);

  assert.equal((await request(base, "/api/host-player/control", { method: "POST", body: { deck: "x", action: "pause" } })).status, 400);
  assert.equal((await request(base, "/api/host-player/control", { method: "POST", body: { deck: "b", action: "seek", value: 42 } })).status, 200);
  assert.deepEqual(calls[3], ["control", "b", "seek", 42]);
  assert.equal((await request(base, "/api/host-player/control", { method: "POST", body: { action: "stop" } })).status, 200);
  assert.deepEqual(calls[4], ["stop"]);
});
