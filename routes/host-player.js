module.exports = function registerHostPlayerRoutes(app, { hostPlayer, getStations }) {
  const port = Number(process.env.PORT) || 6565;
  const validDeck = (value) => value === "a" || value === "b";
  const allStations = () => Object.values(getStations()).flat();

  app.get("/api/host-player/status", async (_req, res) => {
    res.json(await hostPlayer.status());
  });

  app.post("/api/host-player/radio", async (req, res) => {
    const url = String(req.body?.url || "");
    if (!allStations().some((station) => station.url === url)) return res.status(400).json({ error: "Choose a saved radio station." });
    try {
      await hostPlayer.playRadio(url);
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ error: error.message || "Could not start host audio." });
    }
  });

  app.post("/api/host-player/music", async (req, res) => {
    const id = String(req.body?.id || "");
    const deck = String(req.body?.deck || "");
    if (!/^[0-9a-z]{8,64}$/i.test(id)) return res.status(400).json({ error: "Choose a valid Jellyfin track." });
    if (!validDeck(deck)) return res.status(400).json({ error: "Choose deck A or B." });
    try {
      await hostPlayer.playMusic({
        id, deck, port,
        crossfade: req.body?.crossfade === true,
        fadeSeconds: req.body?.fadeSeconds,
        naturalFadeIn: req.body?.naturalFadeIn === true
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ error: error.message || "Could not start host audio." });
    }
  });

  app.post("/api/host-player/control", async (req, res) => {
    const deck = String(req.body?.deck || "");
    if (req.body?.action === "stop") {
      await hostPlayer.stop();
      return res.json({ ok: true });
    }
    if (!validDeck(deck)) return res.status(400).json({ error: "Choose deck A or B." });
    try {
      await hostPlayer.control(deck, String(req.body?.action || ""), req.body?.value);
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ error: error.message || "Host playback control failed." });
    }
  });
};
