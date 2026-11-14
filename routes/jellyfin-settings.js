const fetch = require("node-fetch");

module.exports = function registerJellyfinSettingsRoutes(app, jellyfin, storage) {
  function sameOrigin(req, res) {
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`) {
      res.status(403).json({ error: "Settings can only be changed from this MyMusics page." });
      return false;
    }
    return true;
  }

  app.get("/api/settings/jellyfin", (_req, res) => res.json(jellyfin.settingsStatus()));

  app.put("/api/settings/jellyfin", (req, res) => {
    if (!sameOrigin(req, res)) return;
    const urlValue = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (urlValue.length > 500 || apiKey.length > 512 || userId.length > 200) {
      return res.status(400).json({ error: "One or more Jellyfin settings are too long." });
    }

    let url = "";
    if (urlValue) {
      try {
        const parsed = new URL(urlValue);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search) throw new Error();
        if (parsed.pathname === "/web" || parsed.pathname === "/web/") {
          parsed.pathname = "/";
          parsed.hash = "";
        }
        if (parsed.hash) throw new Error();
        url = parsed.href.replace(/\/+$/, "");
      } catch {
        return res.status(400).json({ error: "Enter the Jellyfin server base URL, such as http://127.0.0.1:8096." });
      }
    }

    try {
      res.json(jellyfin.saveSettings({ url, apiKey, userId }));
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not save Jellyfin settings." });
    }
  });

  app.post("/api/settings/jellyfin/test", async (req, res) => {
    if (!sameOrigin(req, res)) return;
    try {
      await jellyfin.testConnection();
      res.json({ ok: true });
    } catch (error) {
      res.status(502).json({ error: error.message || "Could not connect to Jellyfin." });
    }
  });

  function youtubeStatus() {
    const savedKey = storage.readYouTubeSettings().apiKey;
    const environmentKey = process.env.YOUTUBE_API_KEY || "";
    return { configured: Boolean(savedKey || environmentKey), source: savedKey ? "Manage" : environmentKey ? "Environment" : "None" };
  }

  app.get("/api/settings/youtube", (_req, res) => res.json(youtubeStatus()));

  app.put("/api/settings/youtube", (req, res) => {
    if (!sameOrigin(req, res)) return;
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (apiKey.length > 512) return res.status(400).json({ error: "The YouTube API key is too long." });
    if (apiKey) {
      try { storage.writeYouTubeSettings({ apiKey }); }
      catch (error) { return res.status(500).json({ error: error.message || "Could not save the YouTube API key." }); }
    }
    res.json(youtubeStatus());
  });

  app.delete("/api/settings/youtube", (req, res) => {
    if (!sameOrigin(req, res)) return;
    try {
      storage.writeYouTubeSettings({ apiKey: "" });
      res.json(youtubeStatus());
    } catch (error) { res.status(500).json({ error: error.message || "Could not remove the saved YouTube API key." }); }
  });

  app.post("/api/settings/youtube/test", async (req, res) => {
    if (!sameOrigin(req, res)) return;
    const apiKey = storage.readYouTubeSettings().apiKey || process.env.YOUTUBE_API_KEY || "";
    if (!apiKey) return res.status(400).json({ error: "Save a YouTube Data API v3 key first." });
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.search = new URLSearchParams({ part: "id", id: "dQw4w9WgXcQ", key: apiKey });
      const response = await fetch(url.toString(), { timeout: 8000 });
      const result = await response.json();
      if (!response.ok) return res.status(502).json({ error: result.error?.message || `YouTube returned HTTP ${response.status}.` });
      res.json({ ok: true });
    } catch (error) { res.status(502).json({ error: `YouTube API test failed: ${error.message}` }); }
  });
};
