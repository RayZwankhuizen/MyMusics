const fs = require("node:fs");
const path = require("node:path");

function createStorage({ dataDir: configuredDir = process.env.MYMUSICS_DATA_DIR, rootDir = __dirname } = {}) {
  const root = path.resolve(rootDir);
  const dataDir = configuredDir ? path.resolve(configuredDir) : null;
  const paths = {
    stations: dataDir ? path.join(dataDir, "stations.json") : path.join(root, "stations.json"),
    images: dataDir ? path.join(dataDir, "station-images") : path.join(root, "data", "station-images"),
    playlists: path.join(dataDir || root, "music-playlists.json"),
    musicGenres: path.join(dataDir || root, "music-genre-mappings.json"),
    jellyfinSettings: path.join(dataDir || root, "jellyfin-settings.json"),
    hostAudioSettings: path.join(dataDir || root, "host-audio-settings.json"),
    updateStatus: path.join(dataDir || path.join(root, "data"), "update-status.json")
  };

  function initialize() {
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      const bundledStations = path.join(root, "stations.json");
      if (paths.stations !== bundledStations && !fs.existsSync(paths.stations) && fs.existsSync(bundledStations)) {
        fs.copyFileSync(bundledStations, paths.stations, fs.constants.COPYFILE_EXCL);
      }
      const legacyImages = path.join(root, "data", "station-images");
      if (!fs.existsSync(paths.images) && fs.existsSync(legacyImages)) {
        fs.cpSync(legacyImages, paths.images, { recursive: true, errorOnExist: true });
      }
    }
    fs.mkdirSync(paths.images, { recursive: true });
  }

  function readJson(file, fallback, validate = () => true) {
    let contents;
    try { contents = fs.readFileSync(file, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
    let value;
    try { value = JSON.parse(contents); }
    catch (error) { throw new Error(`Cannot parse ${path.basename(file)}; the original file was left untouched.`, { cause: error }); }
    if (!validate(value)) throw new Error(`${path.basename(file)} has an invalid data structure; the original file was left untouched.`);
    return value;
  }

  function writeAtomically(file, contents, mode = 0o644) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      fs.writeFileSync(temporary, contents, { flag: "wx", mode });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
  }

  function writeJson(file, value, mode) {
    writeAtomically(file, `${JSON.stringify(value, null, 2)}\n`, mode);
  }

  function validStations(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
      && Object.values(value).every(Array.isArray));
  }

  function readStations() {
    return readJson(paths.stations, {}, validStations);
  }

  function writeStations(value) {
    if (!validStations(value)) throw new Error("Station data must be an object of station lists.");
    writeJson(paths.stations, value);
  }

  function readUpdateStatus() {
    try { return readJson(paths.updateStatus, { state: "idle", version: "", message: "" }); }
    catch { return { state: "idle", version: "", message: "" }; }
  }

  function validJellyfinSettings(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
      && typeof value.url === "string" && typeof value.apiKey === "string" && typeof value.userId === "string");
  }

  function readJellyfinSettings() {
    return readJson(paths.jellyfinSettings, null, validJellyfinSettings);
  }

  function writeJellyfinSettings(value) {
    if (!validJellyfinSettings(value)) throw new Error("Jellyfin settings have an invalid structure.");
    writeJson(paths.jellyfinSettings, value, 0o600);
  }

  function validHostAudioSettings(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
      && typeof value.device === "string" && value.device.length > 0 && value.device.length <= 500);
  }

  function readHostAudioSettings() {
    try { return readJson(paths.hostAudioSettings, { device: "auto" }, validHostAudioSettings); }
    catch { return { device: "auto" }; }
  }

  function writeHostAudioSettings(value) {
    if (!validHostAudioSettings(value)) throw new Error("Host audio settings have an invalid structure.");
    writeJson(paths.hostAudioSettings, value, 0o600);
    return value;
  }

  function hasStationImage(image) {
    return typeof image === "string" && /^\/station-images\/[\da-f-]+\.(?:png|jpg|webp)$/.test(image)
      && fs.existsSync(path.join(paths.images, path.basename(image)));
  }

  function writeStationImage(filename, contents) {
    if (!/^[\da-f-]+\.(?:png|jpg|webp)$/.test(filename)) throw new Error("Invalid station image filename.");
    writeAtomically(path.join(paths.images, filename), contents);
  }

  function removeUnusedStationImages(previous, current) {
    const used = new Set(current);
    for (const image of previous) {
      if (/^\/station-images\/[\da-f-]+\.(?:png|jpg|webp)$/.test(image) && !used.has(image)) {
        fs.rmSync(path.join(paths.images, path.basename(image)), { force: true });
      }
    }
  }

  initialize();
  return { paths, readJson, writeJson, readStations, writeStations, readUpdateStatus,
    readJellyfinSettings, writeJellyfinSettings, readHostAudioSettings, writeHostAudioSettings,
    hasStationImage, writeStationImage, removeUnusedStationImages };
}

module.exports = { ...createStorage(), createStorage };
