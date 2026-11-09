const fetch = require("node-fetch");
const fs = require("node:fs");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);

module.exports = function registerUpdateRoutes(app, { storage, appVersion, appBuildDate, updateScript }) {
  let releaseCache;
  let releaseCacheAt = 0;

  function readUpdateStatus() {
    return storage.readUpdateStatus();
  }

  async function getLatestRelease() {
    if (releaseCache && Date.now() - releaseCacheAt < 300_000) return releaseCache;
    const response = await fetch("https://api.github.com/repos/RayZwankhuizen/MyMusics/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json", "User-Agent": "MyMusics",
        ...(process.env.GITHUB_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_ACCESS_TOKEN}` } : {})
      }, timeout: 10000
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const release = await response.json();
    if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name || "")) throw new Error("Latest GitHub release has no valid version tag.");
    releaseCache = { version: release.tag_name, date: release.published_at || "", url: release.html_url || "" };
    releaseCacheAt = Date.now();
    return releaseCache;
  }

  app.get("/api/update", async (_req, res) => {
    try {
      const latest = await getLatestRelease();
      res.json({
        currentVersion: appVersion, buildDate: appBuildDate, latestVersion: latest.version, latestDate: latest.date,
        releaseUrl: latest.url, updateAvailable: latest.version !== appVersion,
        canInstall: process.env.MYMUSICS_UPDATE_ENABLED === "true" && fs.existsSync(updateScript)
          && fs.existsSync("/etc/sudoers.d/mymusics-update") && fs.existsSync("/etc/systemd/system/mymusics-update.service")
      });
    } catch (error) {
      res.status(502).json({ error: `Could not check GitHub releases: ${error.message}` });
    }
  });

  app.get("/api/update/status", (_req, res) => res.json(readUpdateStatus()));

  app.post("/api/update", async (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Update requests must use JSON." });
    if (req.get("origin") && req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Cross-origin update requests are not allowed." });
    if (process.env.MYMUSICS_UPDATE_ENABLED !== "true" || !fs.existsSync(updateScript)
      || !fs.existsSync("/etc/sudoers.d/mymusics-update") || !fs.existsSync("/etc/systemd/system/mymusics-update.service")) {
      return res.status(503).json({ error: "Automatic updates are not configured on this server." });
    }
    if (["checking", "downloading", "installing", "restarting"].includes(readUpdateStatus().state)) {
      return res.status(409).json({ error: "An update is already running." });
    }
    try {
      const latest = await getLatestRelease();
      if (latest.version === appVersion) return res.status(409).json({ error: "MyMusics is already up to date." });
      await execFile("/usr/bin/sudo", ["-n", "/usr/bin/systemctl", "--no-block", "start", "mymusics-update.service"], { timeout: 5000 });
      res.status(202).json({ state: "checking", version: latest.version });
    } catch (error) {
      res.status(503).json({ error: `Could not start the updater: ${error.message}` });
    }
  });
};
