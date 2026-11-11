const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fetchPublicUrl, logoCandidates, radioBrowserSearch, matchingLogoStations, stationWebsiteCandidates, dynamicLogoCandidates, logoStationSearches, sharedHomepageLogos } = require("./station-discovery");

module.exports = function registerStationRoutes(app, { storage }) {
  let stations = storage.readStations();

  app.get("/stations", (_req, res) => res.json(stations));

  function commit(next, res) {
    try {
      const oldImages = new Set(Object.values(stations).flat().map((station) => station.image).filter(Boolean));
      storage.writeStations(next);
      stations = next;
      const usedImages = new Set(Object.values(stations).flat().map((station) => station.image).filter(Boolean));
      storage.removeUnusedStationImages(oldImages, usedImages);
      res.json(stations);
    } catch (error) {
      console.error("Could not save stations:", error.message);
      res.status(500).json({ error: "Could not save station settings." });
    }
  }

  function validGenre(value) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 40 && !/[\\/]/.test(value) && !["__proto__", "constructor", "prototype"].includes(value.trim().toLowerCase());
  }

  function stationFrom(body) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    let url = typeof body?.url === "string" ? body.url.trim() : "";
    if (url && !/^https?:\/\//i.test(url)) {
      const scheme = url.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1];
      if (scheme) return { error: "Stream URLs must use HTTP or HTTPS." };
      url = `https://${url}`;
    }
    const type = typeof body?.type === "string" ? body.type.trim().toLowerCase() : "";
    let website = typeof body?.website === "string" ? body.website.trim() : "";
    if (website && !/^https?:\/\//i.test(website)) {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(website)) return { error: "Station websites must use HTTP or HTTPS." };
      website = `https://${website}`;
    }
    if (body?.favorite !== undefined && typeof body.favorite !== "boolean") return { error: "Favorite must be true or false." };
    const speechVolumePercent = body?.speechVolumePercent === undefined ? 30 : Number(body.speechVolumePercent);
    const equalizerPreset = body?.equalizerPreset;
    const image = body?.image;
    let parsedUrl;
    let parsedWebsite;
    try { parsedUrl = new URL(url); } catch {}
    try { if (website) parsedWebsite = new URL(website); } catch {}
    if (!name || name.length > 100) return { error: "Enter a station name (up to 100 characters)." };
    if (website && (website.length > 2048 || !parsedWebsite || !["http:", "https:"].includes(parsedWebsite.protocol) || parsedWebsite.username || parsedWebsite.password)) return { error: "Enter a valid HTTP or HTTPS station website." };
    if (image !== undefined && image !== "" && !storage.hasStationImage(image)) return { error: "Choose a valid station logo." };
    if (!Number.isInteger(speechVolumePercent) || speechVolumePercent < 0 || speechVolumePercent > 100) return { error: "Speech/ad volume must be a whole percentage from 0 to 100." };
    if (equalizerPreset !== undefined && !["flat", "pop", "rock", "classical", "jazz", "electronic", "spoken", "country"].includes(equalizerPreset)) return { error: "Choose a valid equalizer preset." };
    if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) return { error: "Enter a valid HTTP or HTTPS stream URL." };
    if (!["mp3", "hls"].includes(type)) return { error: "Stream type must be mp3 or hls." };
    if (type === "hls" && !parsedUrl.pathname.toLowerCase().endsWith(".m3u8")) return { error: "HLS streams must use a .m3u8 URL." };
    return { station: { name, url, type, favorite: body?.favorite === true, speechVolumePercent, ...(website ? { website } : {}), ...(equalizerPreset ? { equalizerPreset } : {}), ...(image ? { image } : {}) } };
  }

  app.post("/api/station-images/find", async (req, res) => {
    try {
      let image;
      const deadline = Date.now() + 20_000;
      if (typeof req.body?.imageUrl === "string" && req.body.imageUrl.trim()) {
        image = await fetchPublicUrl(req.body.imageUrl.trim(), 10_000_000, deadline);
      } else {
        const website = typeof req.body?.website === "string" ? req.body.website.trim().slice(0, 2048) : "";
        const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : "";
        const stream = typeof req.body?.url === "string" ? req.body.url.trim().slice(0, 2048) : "";
        if (!website && !name && !stream) return res.status(400).json({ error: "Enter a station name, stream URL, website or direct logo URL." });
        const websites = website ? [...stationWebsiteCandidates(website), website] : [];
        // Directory requests have their own bounded timeout. Start the download budget afterwards.
        let matches = [];
        let directory = [];
        if (req.body?.automatic === true && (name || stream)) {
          try {
            const filters = logoStationSearches(name, stream);
            directory = await radioBrowserSearch(filters, { limit: 100 });
            matches = matchingLogoStations(directory, name, stream);
          } catch { /* Still try the supplied station website. */ }
        }
        const downloadDeadline = Date.now() + 20_000;
        for (const station of matches) {
          if (station.homepage) websites.push(...stationWebsiteCandidates(station.homepage), station.homepage);
          if (!station.favicon) continue;
          try {
            const found = await fetchPublicUrl(station.favicon, 10_000_000, downloadDeadline);
            if (found.type.startsWith("image/")) { image = found; break; }
          } catch {}
        }
        if (!image) for (const logo of sharedHomepageLogos(matches, directory)) {
          try {
            const found = await fetchPublicUrl(logo, 10_000_000, downloadDeadline);
            if (found.type.startsWith("image/")) { image = found; break; }
          } catch {}
        }
        if (req.body?.automatic === true) websites.push(...stationWebsiteCandidates(stream));
        for (const websiteUrl of [...new Set(websites)].slice(0, 7)) {
          if (image || Date.now() >= downloadDeadline) break;
          try {
            const page = await fetchPublicUrl(websiteUrl, 1_000_000, downloadDeadline);
            if (!page.type.includes("html")) continue;
            const html = page.body.toString("utf8");
            const candidates = [...await dynamicLogoCandidates(html, page.url, downloadDeadline), ...logoCandidates(html, page.url)];
            for (const candidate of candidates) {
              if (Date.now() >= downloadDeadline) break;
              try {
                const found = await fetchPublicUrl(candidate, 10_000_000, downloadDeadline);
                if (found.type.startsWith("image/")) { image = found; break; }
              } catch {}
            }
          } catch {}
        }
        if (!image) throw new Error("No logo found. Add the station website and try again, or use a direct image URL.");
      }
      if (!image.type.startsWith("image/")) throw new Error("The URL did not return an image.");
      res.set({ "Content-Type": image.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).send(image.body);
    } catch (error) { res.status(422).json({ error: error.message || "Could not find or download a logo." }); }
  });

  app.post("/api/station-images", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "2mb" }), (req, res) => {
    const mime = req.headers["content-type"];
    const signatures = { "image/png": [0x89, 0x50, 0x4e, 0x47], "image/jpeg": [0xff, 0xd8, 0xff], "image/webp": [0x52, 0x49, 0x46, 0x46] };
    const signature = signatures[mime];
    if (!Buffer.isBuffer(req.body) || !signature || !signature.every((byte, index) => req.body[index] === byte) || (mime === "image/webp" && req.body.toString("ascii", 8, 12) !== "WEBP")) return res.status(400).json({ error: "Upload a valid PNG, JPEG, or WebP image." });
    const filename = `${crypto.randomUUID()}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime]}`;
    storage.writeStationImage(filename, req.body);
    res.json({ image: `/station-images/${filename}` });
  });

  app.get("/api/station-search", async (req, res) => {
    const countrycode = String(req.query.countrycode || "").trim().toUpperCase();
    const rawTag = String(req.query.tag || "").trim();
    const tag = /^(?:all|\*)$/i.test(rawTag) ? "" : rawTag.slice(0, 80);
    if (countrycode && !/^[A-Z]{2}$/.test(countrycode)) return res.status(400).json({ error: "Enter a two-letter country code, such as NL, US, GB, or ES." });
    if (!countrycode && !tag) return res.status(400).json({ error: "Enter a country code or a music tag." });
    try {
      const searches = tag ? [{ name: tag }, ...[...new Set([tag, ...tag.split(/\s+/)])].map((word) => ({ tag: word }))] : [{}];
      const matches = await radioBrowserSearch(searches, { countrycode, limit: 60, order: "clickcount" });
      const unique = new Map();
      for (const station of matches) {
        const url = station.url_resolved || station.url;
        if (!station.name || station.name.length > 100 || !/^https?:\/\//i.test(url)) continue;
        const type = /\.m3u8(?:$|\?)/i.test(url) ? "hls" : "mp3";
        if (type === "hls" && !new URL(url).pathname.toLowerCase().endsWith(".m3u8")) continue;
        unique.set(station.stationuuid || url, { name: station.name, url, type, website: station.homepage || "", country: station.country, tags: station.tags, codec: station.codec, bitrate: station.bitrate });
      }
      return res.json([...unique.values()].slice(0, 100));
    } catch (error) { res.status(502).json({ error: `Station search is unavailable: ${error.message}` }); }
  });

  app.get("/api/stream-search", async (req, res) => {
    const name = String(req.query.name || "").trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: "Enter at least two characters of the station name." });
    try {
      const matches = await radioBrowserSearch([{ name }], { limit: 40, order: "bitrate" });
      const unique = new Map();
      for (const station of matches) {
        const url = station.url_resolved || station.url;
        if (!station.name || station.name.length > 100 || !/^https?:\/\//i.test(url)) continue;
        const type = /\.m3u8(?:$|\?)/i.test(url) ? "hls" : "mp3";
        if (type === "hls" && !new URL(url).pathname.toLowerCase().endsWith(".m3u8")) continue;
        if (!unique.has(url)) unique.set(url, { name: station.name, url, type, website: station.homepage || "", country: station.country, codec: station.codec, bitrate: Number(station.bitrate) || 0, clickcount: Number(station.clickcount) || 0 });
      }
      const results = [...unique.values()].sort((a, b) => b.bitrate - a.bitrate || b.clickcount - a.clickcount).slice(0, 10);
      res.json(results);
    } catch (error) { res.status(502).json({ error: `Stream search is unavailable: ${error.message}` }); }
  });

  app.post("/api/stations/import", (req, res) => {
    const input = req.body;
    if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ error: "Import a JSON object grouped by genre." });
    const entries = Object.entries(input);
    if (!entries.length || entries.length > 100) return res.status(400).json({ error: "The import must contain 1 to 100 genres." });
    const imported = {};
    let total = 0;
    for (const [genre, list] of entries) {
      if (!validGenre(genre)) return res.status(400).json({ error: `Invalid genre name: ${genre}.` });
      if (Object.keys(imported).some((name) => name.toLowerCase() === genre.trim().toLowerCase())) return res.status(400).json({ error: `Duplicate genre: ${genre}.` });
      if (!Array.isArray(list)) return res.status(400).json({ error: `Genre “${genre}” must contain an array of stations.` });
      imported[genre.trim()] = [];
      for (const [index, value] of list.entries()) {
        if (++total > 10000) return res.status(400).json({ error: "The import can contain at most 10,000 stations." });
        const result = stationFrom(value);
        if (result.error) return res.status(400).json({ error: `Genre “${genre}”, station ${index + 1}: ${result.error}` });
        imported[genre.trim()].push(result.station);
      }
    }
    commit(imported, res);
  });

  app.post("/api/genres", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!validGenre(name)) return res.status(400).json({ error: "Enter a genre name (up to 40 characters)." });
    if (Object.keys(stations).some((genre) => genre.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "That genre already exists." });
    commit({ ...stations, [name]: [] }, res);
  });

  app.put("/api/genres/:genre", (req, res) => {
    const oldName = req.params.genre;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!(oldName in stations)) return res.status(404).json({ error: "Genre not found." });
    if (!validGenre(name)) return res.status(400).json({ error: "Enter a genre name (up to 40 characters)." });
    if (name.toLowerCase() !== oldName.toLowerCase() && Object.keys(stations).some((genre) => genre.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "That genre already exists." });
    const next = {};
    for (const [genre, list] of Object.entries(stations)) next[genre === oldName ? name : genre] = list;
    commit(next, res);
  });

  app.delete("/api/genres/:genre", (req, res) => {
    if (!(req.params.genre in stations)) return res.status(404).json({ error: "Genre not found." });
    const next = { ...stations };
    delete next[req.params.genre];
    commit(next, res);
  });

  app.post("/api/genres/:genre/stations", (req, res) => {
    const genre = req.params.genre;
    if (!(genre in stations)) return res.status(404).json({ error: "Genre not found." });
    const result = stationFrom(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    commit({ ...stations, [genre]: [...stations[genre], result.station] }, res);
  });

  app.put("/api/genres/:genre/stations/:index", (req, res) => {
    const { genre } = req.params;
    const targetGenre = typeof req.body?.genre === "string" ? req.body.genre.trim() : genre;
    const index = Number(req.params.index);
    if (!(genre in stations)) return res.status(404).json({ error: "Genre not found." });
    if (!(targetGenre in stations)) return res.status(400).json({ error: "Choose an existing destination genre." });
    if (!Number.isInteger(index) || index < 0 || index >= stations[genre].length) return res.status(404).json({ error: "Station not found." });
    const result = stationFrom(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    if (req.body?.favorite === undefined) result.station.favorite = stations[genre][index].favorite === true;
    if (targetGenre === genre) {
      const list = [...stations[genre]];
      list[index] = result.station;
      return commit({ ...stations, [genre]: list }, res);
    }
    commit({
      ...stations,
      [genre]: stations[genre].filter((_station, i) => i !== index),
      [targetGenre]: [...stations[targetGenre], result.station]
    }, res);
  });

  app.delete("/api/genres/:genre/stations/:index", (req, res) => {
    const { genre } = req.params;
    const index = Number(req.params.index);
    if (!(genre in stations)) return res.status(404).json({ error: "Genre not found." });
    if (!Number.isInteger(index) || index < 0 || index >= stations[genre].length) return res.status(404).json({ error: "Station not found." });
    commit({ ...stations, [genre]: stations[genre].filter((_station, i) => i !== index) }, res);
  });

  app.patch("/api/genres/:genre/stations/:index/favorite", (req, res) => {
    const { genre } = req.params;
    const index = Number(req.params.index);
    if (!(genre in stations)) return res.status(404).json({ error: "Genre not found." });
    if (!Number.isInteger(index) || index < 0 || index >= stations[genre].length) return res.status(404).json({ error: "Station not found." });
    if (typeof req.body?.favorite !== "boolean") return res.status(400).json({ error: "Favorite must be true or false." });
    const list = [...stations[genre]];
    list[index] = { ...list[index], favorite: req.body.favorite };
    commit({ ...stations, [genre]: list }, res);
  });
  return () => stations;
};
