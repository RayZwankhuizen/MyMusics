const fetch = require("node-fetch");
const { canStartLookup, readCache, writeCache } = require("./metadata-limits");
const registerNowPlayingRoutes = require("./now-playing");

module.exports = function registerMetadataRoutes(app, { getStations }) {
  const metadataCache = new Map();
  const metadataRequests = new Map();
  let nextMusicBrainzRequest = 0;
  registerNowPlayingRoutes(app, { getStations });

  app.get("/metadata", async (req, res) => {
    const artist = String(req.query.artist || "").trim().slice(0, 160);
    const title = String(req.query.title || "").trim().slice(0, 160);
    if (!artist || !title) return res.status(400).json({ error: "Artist and title are required." });
    const escapeForQuery = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const query = `artist:"${escapeForQuery(artist)}" AND recording:"${escapeForQuery(title)}"`;
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.search = new URLSearchParams({ query, fmt: "json", limit: "5", inc: "releases+tags" });
    const key = `${artist.toLocaleLowerCase()}\0${title.toLocaleLowerCase()}`;
    const cached = readCache(metadataCache, key);
    if (cached !== undefined) return res.json(cached);
    if (metadataRequests.has(key)) return res.json(await metadataRequests.get(key));
    if (!canStartLookup(metadataRequests, key)) {
      return res.status(429).set("Retry-After", "1").json({ error: "Too many metadata lookups are already in progress. Try again shortly." });
    }
    const fallback = { artist, title, trackTitle: title, album: null, year: null, coverArt: null, tags: [], durationMs: null };
    const result = (async () => {
      try {
        const wait = Math.max(0, nextMusicBrainzRequest - Date.now());
        nextMusicBrainzRequest = Date.now() + wait + 1100;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        const response = await fetch(url, { headers: { "User-Agent": "MyMusics/1.0 (http://localhost:6565)" }, timeout: 8000 });
        if (!response.ok) return fallback;
        const { recordings = [] } = await response.json();
        const recording = recordings[0];
        const releases = (recording?.releases || []).filter((release) => release.id);
        const release = releases.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))[0];
        const tags = (recording?.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 4).map(({ name, count }) => ({ name, count }));
        return { artist, title, trackTitle: recording?.title || title, album: release?.title || null, year: release?.date?.match(/^\d{4}/)?.[0] || null, coverArt: release ? `https://coverartarchive.org/release/${release.id}/front` : null, tags, durationMs: recording?.length || null };
      } catch {
        return fallback;
      }
    })();
    metadataRequests.set(key, result);
    const data = await result;
    metadataRequests.delete(key);
    writeCache(metadataCache, key, data, data.album ? 86_400_000 : 60_000);
    res.json(data);
  });


};
