const crypto = require("node:crypto");
const fetch = require("node-fetch");

const videoIdPattern = /^[\w-]{11}$/;

function validPlaylist(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item.id === "string"
    && /^[a-f\d-]{36}$/.test(item.id) && typeof item.name === "string" && Array.isArray(item.items)
    && item.items.length <= 500 && item.items.every((video) => video && videoIdPattern.test(video.id)
      && typeof video.title === "string"));
}

module.exports = function registerVideoRoutes(app, { storage }) {
  const getApiKey = () => storage.readYouTubeSettings().apiKey || process.env.YOUTUBE_API_KEY || "";
  const readPlaylists = () => storage.readJson(storage.paths.videoPlaylists, [], validPlaylist);
  const writePlaylists = (value) => storage.writeJson(storage.paths.videoPlaylists, value);

  app.get("/api/videos/status", (_req, res) => {
    const configured = Boolean(getApiKey());
    res.json({ provider: "youtube-iframe", searchAvailable: configured, metadataAvailable: configured });
  });

  app.get("/api/videos/search", async (req, res) => {
    const query = String(req.query.q || "").trim().slice(0, 120);
    if (query.length < 2) return res.status(400).json({ error: "Enter at least two characters to search." });
    const apiKey = getApiKey();
    if (!apiKey) return res.status(503).json({ error: "Configure a YouTube API key in Manage → Jellyfin/YouTube." });
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.search = new URLSearchParams({ part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "10", q: query, key: apiKey });
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!response.ok) return res.status(502).json({ error: `YouTube search failed: ${data.error?.message || response.statusText}` });
      const results = (data.items || []).flatMap((item) => {
        const id = item.id?.videoId;
        if (typeof id !== "string" || !videoIdPattern.test(id)) return [];
        return [{
          id,
          title: String(item.snippet?.title || "Untitled video").slice(0, 300),
          artist: String(item.snippet?.channelTitle || "").slice(0, 160),
          thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null
        }];
      });
      res.json({ results });
    } catch (error) { res.status(502).json({ error: `YouTube search is unavailable: ${error.message}` }); }
  });

  app.get("/api/videos/search-playlists", async (req, res) => {
    const query = String(req.query.q || "").trim().slice(0, 120);
    if (query.length < 2) return res.status(400).json({ error: "Enter at least two characters to search." });
    const apiKey = getApiKey();
    if (!apiKey) return res.status(503).json({ error: "Configure a YouTube API key in Manage → Jellyfin/YouTube." });
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.search = new URLSearchParams({ part: "snippet", type: "playlist", maxResults: "10", q: query, key: apiKey });
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!response.ok) return res.status(502).json({ error: `YouTube playlist search failed: ${data.error?.message || response.statusText}` });
      const results = (data.items || []).flatMap((item) => {
        const id = item.id?.playlistId;
        if (typeof id !== "string") return [];
        return [{ id, title: String(item.snippet?.title || "Untitled playlist").slice(0, 300), artist: String(item.snippet?.channelTitle || "").slice(0, 160), thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null }];
      });
      res.json({ results });
    } catch (error) { res.status(502).json({ error: `YouTube playlist search is unavailable: ${error.message}` }); }
  });

  app.get("/api/videos/playlist-items", async (req, res) => {
    const playlist = String(req.query.id || "").trim();
    if (!/^[\w-]{10,80}$/.test(playlist)) return res.status(400).json({ error: "Enter a valid YouTube playlist ID." });
    const apiKey = getApiKey();
    if (!apiKey) return res.status(503).json({ error: "Configure a YouTube API key in Manage → Jellyfin/YouTube." });
    try {
      const items = [];
      let pageToken = "";
      do {
        const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
        url.search = new URLSearchParams({ part: "snippet", playlistId: playlist, maxResults: "50", key: apiKey, ...(pageToken ? { pageToken } : {}) });
        const response = await fetch(url.toString());
        const data = await response.json();
        if (!response.ok) return res.status(502).json({ error: `Could not load YouTube playlist tracks: ${data.error?.message || response.statusText}` });
        for (const entry of data.items || []) {
          const video = entry.snippet?.resourceId?.videoId;
          if (!videoIdPattern.test(video || "")) continue;
          items.push({
            id: video,
            title: String(entry.snippet?.title || "Video title unavailable").slice(0, 300),
            artist: String(entry.snippet?.videoOwnerChannelTitle || entry.snippet?.channelTitle || "Artist unavailable").slice(0, 160),
            thumbnail: entry.snippet?.thumbnails?.medium?.url || entry.snippet?.thumbnails?.default?.url || null
          });
        }
        pageToken = data.nextPageToken || "";
      } while (pageToken);
      res.json({ items });
    } catch (error) { res.status(502).json({ error: `YouTube playlist tracks are unavailable: ${error.message}` }); }
  });

  app.get("/api/videos/details", async (req, res) => {
    const ids = [...new Set(String(req.query.ids || "").split(",").filter((id) => videoIdPattern.test(id)))].slice(0, 50);
    if (!ids.length) return res.status(400).json({ error: "Provide valid video IDs." });
    const apiKey = getApiKey();
    if (!apiKey) return res.status(503).json({ error: "Configure a YouTube API key in Manage → Jellyfin/YouTube." });
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.search = new URLSearchParams({ part: "snippet", id: ids.join(","), key: apiKey });
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!response.ok) return res.status(502).json({ error: `YouTube video details failed: ${data.error?.message || response.statusText}` });
      res.json({ videos: (data.items || []).map((item) => ({
        id: item.id,
        title: String(item.snippet?.title || "Video title unavailable").slice(0, 300),
        artist: String(item.snippet?.channelTitle || "Artist unavailable").slice(0, 160),
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null
      })) });
    } catch (error) { res.status(502).json({ error: `YouTube video details are unavailable: ${error.message}` }); }
  });

  app.get("/api/videos/playlists", (_req, res) => res.json({ playlists: readPlaylists() }));

  app.post("/api/videos/playlists", (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Enter a playlist name." });
    const playlists = readPlaylists();
    const playlist = { id: crypto.randomUUID(), name, items: [], updatedAt: new Date().toISOString() };
    playlists.push(playlist);
    writePlaylists(playlists);
    res.status(201).json({ playlist });
  });

  app.patch("/api/videos/playlists/:id", (req, res) => {
    const playlists = readPlaylists();
    const playlist = playlists.find((item) => item.id === req.params.id);
    if (!playlist) return res.status(404).json({ error: "Playlist not found." });
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim().slice(0, 100);
      if (!name) return res.status(400).json({ error: "Enter a playlist name." });
      playlist.name = name;
    }
    if (Array.isArray(req.body?.items)) {
      if (req.body.items.length > 500 || req.body.items.some((item) => !item || !videoIdPattern.test(item.id) || typeof item.title !== "string")) {
        return res.status(400).json({ error: "Playlist items are invalid." });
      }
      playlist.items = req.body.items.map((item) => ({
        id: item.id,
        title: String(item.title).slice(0, 300),
        artist: String(item.artist || item.author || "").slice(0, 160),
        thumbnail: typeof item.thumbnail === "string" && item.thumbnail.startsWith("https://") ? item.thumbnail : null
      }));
    }
    playlist.updatedAt = new Date().toISOString();
    writePlaylists(playlists);
    res.json({ playlist });
  });

  app.delete("/api/videos/playlists/:id", (req, res) => {
    const playlists = readPlaylists();
    const remaining = playlists.filter((item) => item.id !== req.params.id);
    if (remaining.length === playlists.length) return res.status(404).json({ error: "Playlist not found." });
    writePlaylists(remaining);
    res.json({ ok: true });
  });
};
