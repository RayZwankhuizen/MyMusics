const { canStartLookup, readCache, writeCache } = require("./metadata-limits");

module.exports = function registerMetadataProviderRoutes(app, { fetch = globalThis.fetch } = {}) {
  const geniusArtCache = new Map();
  const geniusArtRequests = new Map();
  app.get("/lyrics", async (req, res) => {
    const artist = String(req.query.artist || "").trim().slice(0, 160);
    const title = String(req.query.title || "").trim().slice(0, 160);
    if (!artist || !title) return res.status(400).json({ error: "Artist and title are required." });
    try {
      const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const normalizedArtist = normalize(artist);
      const normalizedTitle = normalize(title);
      const album = normalize(String(req.query.album || "").slice(0, 160));
      const durationMs = Number(req.query.durationMs);
      const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
      const rank = (item) => {
        const candidateArtist = normalize(item?.artistName);
        if (normalize(item?.trackName) !== normalizedTitle
            || (candidateArtist !== normalizedArtist && !candidateArtist.startsWith(`${normalizedArtist} `))) return null;
        const duration = Number(item.duration);
        const difference = hasDuration && duration > 0 ? Math.abs(duration - durationMs / 1000) : null;
        const timingMatches = difference === null || difference <= 3;
        const syncedLyrics = timingMatches && typeof item.syncedLyrics === "string"
            && /^[^\S\r\n]*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+[^\S\r\n]*[^\s[]/m.test(item.syncedLyrics)
          ? item.syncedLyrics : null;
        const plainLyrics = typeof item.plainLyrics === "string" && item.plainLyrics.trim() ? item.plainLyrics : null;
        if (!syncedLyrics && !plainLyrics) return null;
        return {
          trackName: item.trackName, albumName: item.albumName || null, duration: duration || null,
          plainLyrics, syncedLyrics, source: "LRCLIB",
          durationRank: difference === null ? 1 : timingMatches ? 2 : 0,
          albumMatch: Boolean(album && normalize(item.albumName) === album),
          exactArtist: candidateArtist === normalizedArtist,
          difference: difference ?? 0
        };
      };
      const queries = [
        new URLSearchParams({ track_name: title, artist_name: artist }),
        new URLSearchParams({ q: `${artist} ${title}` })
      ];
      const deadline = Date.now() + 20_000;
      const candidates = [];
      for (const query of queries) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        try {
          const response = await fetch(`https://lrclib.net/api/search?${query}`, {
            headers: { "User-Agent": "MyMusics/1.0 (personal radio player)" }, signal: AbortSignal.timeout(Math.min(8000, remaining))
          });
          if (!response.ok) continue;
          const results = await response.json();
          if (!Array.isArray(results)) continue;
          for (const item of results) {
            const candidate = rank(item);
            if (candidate) candidates.push(candidate);
          }
          if (candidates.some((item) => item.syncedLyrics && (!hasDuration || item.durationRank === 2)
              && (!album || item.albumMatch))) break;
        } catch {}
      }
      const match = candidates.sort((a, b) => b.durationRank - a.durationRank
        || Number(b.albumMatch) - Number(a.albumMatch)
        || Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics))
        || Number(b.exactArtist) - Number(a.exactArtist)
        || a.difference - b.difference)[0];
      if (!match && Date.now() < deadline) {
        const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
        const response = await fetch(url, { headers: { "User-Agent": "MyMusics/1.0" }, signal: AbortSignal.timeout(Math.min(8000, deadline - Date.now())) });
        if (!response.ok) return res.json(null);
        const { lyrics } = await response.json();
        return res.json(lyrics ? { trackName: title, plainLyrics: lyrics, syncedLyrics: null, source: "Lyrics.ovh" } : null);
      }
      if (!match) return res.json(null);
      const { trackName, albumName, plainLyrics, syncedLyrics, duration, source } = match;
      return res.json({ trackName, albumName, plainLyrics, syncedLyrics, duration, source });
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
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "MyMusics/1.0" }, signal: AbortSignal.timeout(8000)
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
