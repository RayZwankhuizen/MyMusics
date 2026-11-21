const { validateEqualizer } = require("../host-equalizer");
const fs = require("node:fs");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const execFile = promisify(require("node:child_process").execFile);

module.exports = function registerHostPlayerRoutes(app, { hostPlayer, getStations, storage }) {
  const port = Number(process.env.PORT) || 6565;
  const validDeck = (value) => value === "a" || value === "b";
  const allStations = () => Object.values(getStations()).flat();
  let mpvInstallQueued = false;
  let hostPlaybackSession = "";
  let hostPlaybackLease;

  function clearHostPlaybackLease() {
    clearTimeout(hostPlaybackLease);
    hostPlaybackLease = null;
    hostPlaybackSession = "";
    hostPlayer.stopRadioAnalysis?.();
  }

  function renewHostPlaybackLease(sessionId) {
    clearTimeout(hostPlaybackLease);
    hostPlaybackLease = setTimeout(async () => {
      if (hostPlaybackSession !== sessionId) return;
      clearHostPlaybackLease();
      await hostPlayer.stop();
    }, 15_000);
    hostPlaybackLease.unref?.();
  }

  function startHostPlaybackLease() {
    hostPlaybackSession ||= randomUUID();
    renewHostPlaybackLease(hostPlaybackSession);
    return hostPlaybackSession;
  }

  function canInstallMpv() {
    return process.env.MYMUSICS_MPV_INSTALL_ENABLED === "true"
      && fs.existsSync("/opt/mymusics/deploy/mymusics-install-mpv.sh")
      && fs.existsSync("/etc/sudoers.d/mymusics-update");
  }

  app.get("/api/host-player/mpv", async (_req, res) => {
    const status = await hostPlayer.mpvStatus();
    const { installed, version, error } = status;
    if (status.installed && status.youtubeResolverInstalled) mpvInstallQueued = false;
    res.json({
      ...status,
      installed, version: version || "", error: error || "",
      installing: mpvInstallQueued && !(status.installed && status.youtubeResolverInstalled),
      canInstall: canInstallMpv()
    });
  });

  app.post("/api/host-player/mpv/install", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "MPV installation requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "MPV installation can only be started from this MyMusics page." });
    }
    const status = await hostPlayer.mpvStatus();
    if (status.installed && status.youtubeResolverInstalled) return res.status(409).json({ error: "MPV and yt-dlp are already installed on the MyMusics host." });
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
      res.status(503).json({ error: "Could not install MPV and yt-dlp. Check the MyMusics system service setup." });
    }
  });

  app.get("/api/host-player/status", async (_req, res) => {
    res.json(await hostPlayer.status());
  });

  app.post("/api/host-player/video", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Video playback requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Video playback can only be started from this MyMusics page." });
    const videoId = String(req.body?.videoId || "");
    if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: "Choose a valid YouTube video." });
    const startSeconds = Number(req.body?.startSeconds ?? 0);
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86_400) return res.status(400).json({ error: "Choose a valid video position." });
    try {
      await hostPlayer.playVideo(videoId, startSeconds, { paused: req.body?.paused === true });
      clearHostPlaybackLease();
      res.json({ ok: true, sessionId: startHostPlaybackLease() });
    } catch (error) {
      res.status(503).json({ error: error.message || "Host MPV could not play this YouTube video." });
    }
  });

  app.post("/api/host-player/heartbeat", (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Host playback heartbeat must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Host playback heartbeat must come from this MyMusics page." });
    if (!hostPlaybackSession || req.body?.sessionId !== hostPlaybackSession) return res.status(409).json({ error: "Host playback session has ended." });
    renewHostPlaybackLease(hostPlaybackSession);
    res.json({ ok: true });
  });

  app.get("/api/host-player/radio-level", async (_req, res) => {
    try { res.json({ levels: await hostPlayer.radioLevel() || [] }); }
    catch { res.json({ levels: [] }); }
  });

  app.post("/api/host-player/radio-analysis", (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Radio analysis requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Radio analysis must come from this MyMusics page." });
    const url = String(req.body?.url || "");
    const station = allStations().find((item) => item.url === url);
    if (req.body?.action !== "stop" && !station) return res.status(400).json({ error: "Choose a saved radio station." });
    if (req.body?.action !== "stop" && (station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(url))) return res.status(415).json({ error: "Host analysis for HLS streams is not available yet." });
    try {
      if (req.body?.action === "stop") hostPlayer.stopRadioAnalysis();
      else hostPlayer.startRadioAnalysis(url, { classify: req.body?.classify === true });
      res.json(hostPlayer.radioAnalysisStatus());
    } catch (error) { res.status(503).json({ error: error.message || "Could not start host audio analysis." }); }
  });

  app.get("/api/host-player/radio-analysis", (_req, res) => res.json(hostPlayer.radioAnalysisStatus()));

  app.get("/api/host-player/music-level", async (_req, res) => {
    try { res.json({ levels: await hostPlayer.musicLevel() || [] }); }
    catch { res.json({ levels: [] }); }
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

  app.put("/api/host-player/equalizer", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Equalizer updates must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Change the equalizer from this MyMusics page." });
    let equalizer;
    try { equalizer = validateEqualizer(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { res.json(await hostPlayer.setEqualizer(equalizer)); }
    catch (error) { res.status(503).json({ error: error.message || "Could not update host equalizer." }); }
  });

  app.post("/api/host-player/radio", async (req, res) => {
    const url = String(req.body?.url || "");
    const station = allStations().find((item) => item.url === url);
    if (!station) return res.status(400).json({ error: "Choose a saved radio station." });
    const volume = Number(req.body?.volume ?? 100);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) return res.status(400).json({ error: "Radio volume must be a whole percentage from 0 to 100." });
    let equalizer;
    try { if (req.body?.equalizer !== undefined) equalizer = validateEqualizer(req.body.equalizer); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const isHls = station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(url);
      const streamUrl = isHls ? url : `http://127.0.0.1:${port}/api/radio-stream?url=${encodeURIComponent(url)}`;
      await hostPlayer.playRadio(streamUrl, volume, equalizer);
      res.json({ ok: true, sessionId: startHostPlaybackLease() });
    } catch (error) {
      res.status(503).json({ error: error.message || "Could not start host audio." });
    }
  });

  app.post("/api/host-player/radio/stop", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Radio stop requests must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Radio playback can only be stopped from this MyMusics page." });
    if (!hostPlaybackSession || req.body?.sessionId !== hostPlaybackSession) return res.status(409).json({ error: "Radio playback session has ended." });
    if (hostPlayer.activeType !== "radio") return res.json({ stopped: false });
    clearHostPlaybackLease();
    await hostPlayer.stop();
    res.json({ stopped: true });
  });

  app.post("/api/host-player/music", async (req, res) => {
    const id = String(req.body?.id || "");
    const deck = String(req.body?.deck || "");
    const volume = req.body?.volume;
    if (!/^[0-9a-z]{8,64}$/i.test(id)) return res.status(400).json({ error: "Choose a valid Jellyfin track." });
    if (!validDeck(deck)) return res.status(400).json({ error: "Choose deck A or B." });
    if (volume !== undefined && (!Number.isInteger(volume) || volume < 0 || volume > 100)) {
      return res.status(400).json({ error: "Music volume must be a whole percentage from 0 to 100." });
    }
    let equalizer;
    try { if (req.body?.equalizer !== undefined) equalizer = validateEqualizer(req.body.equalizer); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      await hostPlayer.playMusic({
        id, deck, port, ...(equalizer === undefined ? {} : { equalizer }),
        crossfade: req.body?.crossfade === true,
        fadeSeconds: req.body?.fadeSeconds,
        naturalFadeIn: req.body?.naturalFadeIn === true,
        ...(volume === undefined ? {} : { volume })
      });
      res.json({ ok: true, sessionId: startHostPlaybackLease() });
    } catch (error) {
      res.status(503).json({ error: error.message || "Could not start host audio." });
    }
  });

  app.post("/api/host-player/music-volume", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Music volume updates must use JSON." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "Music volume can only be changed from this MyMusics page." });
    }
    const volume = Number(req.body?.volume);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      return res.status(400).json({ error: "Music volume must be a whole percentage from 0 to 100." });
    }
    try { res.json({ volume: await hostPlayer.setMusicVolume(volume) }); }
    catch (error) { res.status(503).json({ error: error.message || "Could not change Music volume." }); }
  });

  app.post("/api/host-player/control", async (req, res) => {
    const deck = String(req.body?.deck || "");
    if (req.body?.sessionId !== undefined && (!hostPlaybackSession || req.body.sessionId !== hostPlaybackSession
      || hostPlayer.activeType !== "video" || req.body.videoId !== hostPlayer.videoId)) {
      return res.status(409).json({ error: "Host video session has ended." });
    }
    if (req.body?.action === "stop") {
      clearHostPlaybackLease();
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
