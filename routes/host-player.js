const fs = require("node:fs");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);

module.exports = function registerHostPlayerRoutes(app, { hostPlayer, getStations, storage }) {
  const port = Number(process.env.PORT) || 6565;
  const validDeck = (value) => value === "a" || value === "b";
  const allStations = () => Object.values(getStations()).flat();
  let mpvInstallQueued = false;

  function canInstallMpv() {
    return process.env.MYMUSICS_MPV_INSTALL_ENABLED === "true"
      && fs.existsSync("/opt/mymusics/deploy/mymusics-install-mpv.sh")
      && fs.existsSync("/etc/sudoers.d/mymusics-update");
  }

  app.get("/api/host-player/mpv", async (_req, res) => {
    const { installed, version, error } = await hostPlayer.mpvStatus();
    if (installed) mpvInstallQueued = false;
    res.json({
      installed, version: version || "", error: error || "",
      installing: mpvInstallQueued && !installed,
      canInstall: canInstallMpv()
    });
  });

  app.post("/api/host-player/mpv/install", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "MPV installation requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "MPV installation can only be started from this MyMusics page." });
    }
    const status = await hostPlayer.mpvStatus();
    if (status.installed) return res.status(409).json({ error: "MPV is already installed on the MyMusics host." });
    if (mpvInstallQueued) return res.status(409).json({ error: "MPV installation is already starting." });
    if (!canInstallMpv()) {
      return res.status(503).json({ error: "Host MPV installation is not configured on this server." });
    }
    try {
      mpvInstallQueued = true;
      const resetQueued = setTimeout(() => { mpvInstallQueued = false; }, 120_000);
      resetQueued.unref?.();
      await execFile("/usr/bin/sudo", ["-n", "/usr/bin/systemctl", "--no-block", "restart", "mymusics.service"], { timeout: 5000 });
      res.status(202).json({ state: "installing", willRestart: true });
    } catch {
      mpvInstallQueued = false;
      res.status(503).json({ error: "Could not start MPV installation. Check the MyMusics system service setup." });
    }
  });

  app.get("/api/host-player/status", async (_req, res) => {
    res.json(await hostPlayer.status());
  });

  app.get("/api/host-player/audio-devices", async (_req, res) => {
    try { res.json({ devices: await hostPlayer.audioDevices() }); }
    catch (error) { res.status(503).json({ error: error.message || "Could not read MPV audio devices." }); }
  });

  app.get("/api/host-player/audio-device", (_req, res) => {
    try { res.json(storage.readHostAudioSettings()); }
    catch (error) { res.status(503).json({ error: error.message || "Could not read the saved audio output." }); }
  });

  app.put("/api/host-player/audio-device", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Audio output settings must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "Audio output settings can only be changed from this MyMusics page." });
    }
    const device = typeof req.body?.device === "string" ? req.body.device : "";
    if (!device || device.length > 500) return res.status(400).json({ error: "Choose a valid audio output device." });
    const previous = storage.readHostAudioSettings().device || "auto";
    try {
      await hostPlayer.setAudioDevice(device);
      storage.writeHostAudioSettings({ device });
      res.json({ device });
    } catch (error) {
      await hostPlayer.setAudioDevice(previous).catch(() => {});
      res.status(503).json({ error: error.message || "Could not set the host audio output." });
    }
  });

  app.post("/api/host-player/audio-test", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Audio test requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "Audio tests can only be started from this MyMusics page." });
    }
    const device = typeof req.body?.device === "string" ? req.body.device : "";
    if (!device || device.length > 500) return res.status(400).json({ error: "Choose an audio output device." });
    try {
      await hostPlayer.testAudioDevice(device);
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ error: error.message || "The MPV audio test failed." });
    }
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
