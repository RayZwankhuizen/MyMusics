const fetch = require("node-fetch");
const { canStartLookup, readCache, writeCache } = require("./metadata-limits");

module.exports = function registerMetadataProviderRoutes(app) {
  const geniusArtCache = new Map();
  const geniusArtRequests = new Map();
  app.get("/lyrics", async (req, res) => {
    const artist = String(req.query.artist || "").trim().slice(0, 160);
    const title = String(req.query.title || "").trim().slice(0, 160);
    if (!artist || !title) return res.status(400).json({ error: "Artist and title are required." });
    try {
      const normalize = (value) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const normalizedArtist = normalize(artist);
      const matches = (item) => {
        const candidateArtist = normalize(item.artistName);
        return normalize(item.trackName) === normalize(title) &&
          (candidateArtist === normalizedArtist || candidateArtist.startsWith(`${normalizedArtist} `));
      };
      const queries = [
        new URLSearchParams({ track_name: title, artist_name: artist }),
        new URLSearchParams({ q: `${artist} ${title}` })
      ];
      const deadline = Date.now() + 20_000;
      let match = null;
      for (const query of queries) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        try {
          const response = await fetch(`https://lrclib.net/api/search?${query}`, {
            headers: { "User-Agent": "MyMusics/1.0 (personal radio player)" }, timeout: Math.min(8000, remaining)
          });
          if (response.ok) match = (await response.json()).find(matches) || null;
        } catch {}
        if (match) break;
      }
      if (!match && Date.now() < deadline) {
        const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
        const response = await fetch(url, { headers: { "User-Agent": "MyMusics/1.0" }, timeout: Math.min(8000, deadline - Date.now()) });
        if (!response.ok) return res.json(null);
        const { lyrics } = await response.json();
        return res.json(lyrics ? { trackName: title, plainLyrics: lyrics, syncedLyrics: null, source: "Lyrics.ovh" } : null);
      }
      res.json({
        trackName: match.trackName,
        plainLyrics: match.plainLyrics || null,
        syncedLyrics: match.syncedLyrics || null,
        duration: match.duration || null
      });
    } catch {
      res.json(null);
    }
  });


  app.get("/genius-art", async (req, res) => {
    const artist = String(req.query.artist || "").trim().slice(0, 160);
    const title = String(req.query.title || "").trim().slice(0, 160);
    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!artist || !title) return res.status(400).json({ error: "Artist and title are required." });
    if (!token) return res.json({ configured: false });
    const key = `${artist.toLocaleLowerCase()}\0${title.toLocaleLowerCase()}`;
    const cached = readCache(geniusArtCache, key);
    if (cached !== undefined) return res.json(cached);
    if (geniusArtRequests.has(key)) return res.json(await geniusArtRequests.get(key));
    if (!canStartLookup(geniusArtRequests, key)) {
      return res.status(429).set("Retry-After", "1").json({ error: "Too many artwork lookups are already in progress. Try again shortly." });
    }
    const lookup = (async () => {
      try {
        const params = new URLSearchParams({ q: `${artist} ${title}` });
        const response = await fetch(`https://api.genius.com/search?${params}`, {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "MyMusics/1.0" }, timeout: 8000
        });
        if (!response.ok) return null;
        const { response: data } = await response.json();
        const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const match = (data?.hits || []).map((hit) => hit.result).find((song) =>
          normalize(song.primary_artist?.name) === normalize(artist) && normalize(song.title) === normalize(title));
        const sourceUrl = match?.url;
        const imageUrl = match?.song_art_image_url;
        return imageUrl && /^https:\/\/images\.genius\.com\//.test(imageUrl) && /^https:\/\/genius\.com\//.test(sourceUrl || "")
          ? { imageUrl, sourceUrl }
          : null;
      } catch {
        return null;
      }
    })();
    geniusArtRequests.set(key, lookup);
    const result = await lookup;
    geniusArtRequests.delete(key);
    writeCache(geniusArtCache, key, result, result ? 86_400_000 : 300_000);
    res.json(result);
  });
};
