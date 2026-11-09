module.exports = function registerJellyfinSettingsRoutes(app, jellyfin) {
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
};
