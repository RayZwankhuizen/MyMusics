const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
}

const storage = require("./storage");
const jellyfin = require("./jellyfin");
const playlists = require("./playlists");
const musicGenres = require("./music-genres");
const registerUpdateRoutes = require("./routes/updates");
const registerStationRoutes = require("./routes/stations");
const registerMusicRoutes = require("./routes/music");
const registerVideoRoutes = require("./routes/videos");
const registerJellyfinSettingsRoutes = require("./routes/jellyfin-settings");
const registerMetadataRoutes = require("./routes/metadata");
const registerMetadataProviderRoutes = require("./routes/metadata-providers");
const registerRadioStreamRoute = require("./routes/radio-stream");
const HostPlayer = require("./host-player");
const registerHostPlayerRoutes = require("./routes/host-player");
const registerHealthRoute = require("./routes/health");
const { apiRequest, apiNotFound, apiError } = require("./middleware/api");
const app = express();
const { images: imageDir } = storage.paths;
const readText = (file, fallback) => { try { return fs.readFileSync(file, "utf8").trim() || fallback; } catch { return fallback; } };
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "dev";
const appVersion = readText(path.join(__dirname, "VERSION"), packageVersion);
const appBuildDate = readText(path.join(__dirname, "BUILD_DATE"), "");
const updateScript = "/usr/local/sbin/mymusics-update";

app.use(apiRequest);
app.use(express.json({ limit: "1mb" }));
registerHealthRoute(app, appVersion);
registerUpdateRoutes(app, { storage, appVersion, appBuildDate, updateScript });
registerJellyfinSettingsRoutes(app, jellyfin);
const getStations = registerStationRoutes(app, { storage });
registerRadioStreamRoute(app, { getStations });
const hostPlayer = new HostPlayer(storage.readHostAudioSettings());
registerHostPlayerRoutes(app, { hostPlayer, getStations, storage });
registerMusicRoutes(app, { jellyfin, playlists, musicGenres });
registerVideoRoutes(app, { storage });
registerMetadataRoutes(app, { getStations });
registerMetadataProviderRoutes(app);
app.use(apiNotFound);
app.use(apiError);

app.use("/station-images", express.static(imageDir, { fallthrough: false, maxAge: "1d" }));
app.use(express.static(path.join(__dirname, "public")));
const port = Number(process.env.PORT) || 6565;
const host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`MyMusics listening on ${host}:${port} (also available at http://localhost:${port})`);
});
server.on("close", () => hostPlayer.close());
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

// Auto-reload in development if enabled (MYMUSICS_AUTO_RELOAD=1)
if (process.env.MYMUSICS_AUTO_RELOAD === '1') {
  const fs = require('fs');
  const path = require('path');
  const watchDirs = [__dirname, path.join(__dirname, 'public'), path.join(__dirname, 'deploy')];
  const watchSet = new Set();
  watchDirs.forEach(dir => {
    try {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);
        if (['.js', '.html', '.css', '.json'].includes(ext)) {
          const key = filename + Date.now();
          if (watchSet.has(filename)) return;
          watchSet.add(filename);
          setTimeout(() => watchSet.delete(filename), 1000);
          console.log(`[auto-reload] ${filename} changed`);
        }
      });
    } catch(e) {}
  });
}
