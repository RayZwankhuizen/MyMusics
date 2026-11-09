const fetch = require("node-fetch");
const { TextDecoder } = require("node:util");
const { MAX_STREAM_ERROR_KEYS, rememberBounded } = require("./metadata-limits");
const { writeBoundedSse } = require("./bounded-sse-write");

module.exports = function registerNowPlayingRoutes(app, { getStations }) {
  const streamErrorLog = new Map();
  let metadataMonitor = null;

  function parseTrackTitle(streamTitle) {
    const clean = streamTitle.trim().replace(/\0/g, "");
    const divider = clean.indexOf(" - ");
    if (divider < 0) return clean ? { artist: null, title: clean } : null;
    return { artist: clean.slice(0, divider).trim() || null, title: clean.slice(divider + 3).trim() || null };
  }

  function decodeIcyMetadata(buffer) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { return new TextDecoder("windows-1252").decode(buffer); }
  }

  function parseIcyFields(value) {
    return Object.fromEntries([...value.matchAll(/([A-Za-z0-9_-]+)='([\s\S]*?)';/g)].map((match) => [match[1], match[2].trim()]));
  }

  function getTrackStartTime(fields) {
    const entry = Object.entries(fields).find(([key, value]) => value && /^(?:(?:track|song|stream))?(?:start|started)(?:time|timestamp|at)?$/i.test(key.replace(/[_-]/g, "")));
    if (!entry) return { sent: false, value: null };
    const raw = entry[1];
    const numeric = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
    const timestamp = numeric === null ? Date.parse(raw) : numeric < 1e12 ? numeric * 1000 : numeric;
    return { sent: true, value: Number.isFinite(timestamp) && timestamp >= 946684800000 && timestamp <= Date.now() + 300000 ? new Date(timestamp).toISOString() : null };
  }

  async function readIcy(streamUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(streamUrl, { headers: { "Icy-MetaData": "1", "Accept-Encoding": "identity", "User-Agent": "MyMusics/1.0" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Stream returned ${response.status}`);
      const interval = Number(response.headers.get("icy-metaint"));
      if (!Number.isSafeInteger(interval) || interval < 1 || interval > 1_000_000) return null;
      const reader = response.body[Symbol.asyncIterator]();
      let pending = Buffer.alloc(0);
      async function take(size) {
        while (pending.length < size) {
          const { value, done } = await reader.next();
          if (done) return null;
          pending = Buffer.concat([pending, value]);
        }
        const result = pending.subarray(0, size);
        pending = pending.subarray(size);
        return result;
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!await take(interval)) return null;
        const size = await take(1);
        if (!size) return null;
        if (size[0] === 0) continue;
        const block = await take(size[0] * 16);
        if (!block) return null;
        // Match the quote that closes the ICY field (`';`), not apostrophes within song titles.
        const fields = parseIcyFields(decodeIcyMetadata(block));
        const track = fields.StreamTitle && parseTrackTitle(fields.StreamTitle);
        if (track?.title) {
          const start = getTrackStartTime(fields);
          return { ...track, startTime: start.value, startTimeSent: start.sent };
        }
      }
      return null;
    } finally {
      clearTimeout(timeout);
      controller.abort();
      response?.body?.destroy();
    }
  }

  function sendMonitorEvent(monitor, event, data) {
    for (const client of monitor.clients) {
      if (!writeBoundedSse(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) monitor.clients.delete(client);
    }
  }

  function stopMetadataMonitor(monitor) {
    monitor.controller.abort();
    monitor.response?.body?.destroy();
    for (const client of monitor.clients) client.end();
    monitor.clients.clear();
    if (metadataMonitor === monitor) metadataMonitor = null;
  }

  async function monitorIcyStream(monitor) {
    while (metadataMonitor === monitor && !monitor.controller.signal.aborted) {
      const connection = new AbortController();
      const abortConnection = () => connection.abort();
      const connectionTimeout = setTimeout(abortConnection, 10_000);
      monitor.controller.signal.addEventListener("abort", abortConnection, { once: true });
      try {
        const response = await fetch(monitor.url, {
          headers: { "Icy-MetaData": "1", "Accept-Encoding": "identity", "User-Agent": "MyMusics/1.0" },
          signal: connection.signal
        });
        clearTimeout(connectionTimeout);
        monitor.response = response;
        if (!response.ok) throw new Error(`Stream returned ${response.status}`);
        const interval = Number(response.headers.get("icy-metaint"));
        if (!Number.isSafeInteger(interval) || interval < 1 || interval > 1_000_000) throw new Error("Stream does not expose ICY metadata");
        sendMonitorEvent(monitor, "monitor-status", {
          connected: true,
          receivedAt: new Date().toISOString(),
          interval,
          headers: Object.fromEntries(["content-type", "icy-name", "icy-genre", "icy-br", "icy-url"].map((name) => [name, response.headers.get(name)]).filter(([, value]) => value))
        });
        let pending = Buffer.alloc(0), audioLeft = interval, metadataLeft = null, blocks = [];
        for await (const chunk of response.body) {
          if (metadataMonitor !== monitor || monitor.controller.signal.aborted) return;
          pending = Buffer.concat([pending, chunk]);
          let offset = 0;
          while (offset < pending.length) {
            if (audioLeft) {
              const count = Math.min(audioLeft, pending.length - offset);
              audioLeft -= count;
              offset += count;
            } else if (metadataLeft === null) {
              metadataLeft = pending[offset++] * 16;
              if (!metadataLeft) {
                sendMonitorEvent(monitor, "metadata", { receivedAt: new Date().toISOString(), raw: "", fields: {}, blockBytes: 0 });
                metadataLeft = null;
                audioLeft = interval;
              }
              else blocks = [];
            } else {
              const count = Math.min(metadataLeft, pending.length - offset);
              blocks.push(pending.subarray(offset, offset + count));
              metadataLeft -= count;
              offset += count;
              if (!metadataLeft) {
                const metadataBlock = Buffer.concat(blocks);
                const raw = decodeIcyMetadata(metadataBlock).replace(/\0+$/g, "").trim();
                const fields = parseIcyFields(raw);
                sendMonitorEvent(monitor, "metadata", { receivedAt: new Date().toISOString(), raw, fields, blockBytes: metadataBlock.length });
                const start = getTrackStartTime(fields);
                if (fields.StreamTitle) {
                  const track = parseTrackTitle(fields.StreamTitle);
                  if (track?.title) monitor.track = { ...track, startTime: start.value, startTimeSent: start.sent };
                } else if (start.sent && monitor.track) {
                  monitor.track = { ...monitor.track, startTime: start.value, startTimeSent: true };
                }
                if (monitor.track && (fields.StreamTitle || start.sent)) sendMonitorEvent(monitor, "track", monitor.track);
                metadataLeft = null;
                audioLeft = interval;
              }
            }
          }
          pending = pending.subarray(offset);
        }
        throw new Error("Stream connection ended");
      } catch (error) {
        if (monitor.controller.signal.aborted || metadataMonitor !== monitor) return;
        sendMonitorEvent(monitor, "monitor-status", { connected: false, message: error.message });
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } finally {
        clearTimeout(connectionTimeout);
        monitor.controller.signal.removeEventListener("abort", abortConnection);
        connection.abort();
        monitor.response?.body?.destroy();
        monitor.response = null;
      }
    }
  }

  function getMetadataMonitor(streamUrl) {
    if (metadataMonitor?.url === streamUrl) return metadataMonitor;
    if (metadataMonitor) stopMetadataMonitor(metadataMonitor);
    const monitor = { url: streamUrl, clients: new Set(), controller: new AbortController(), response: null, track: null };
    metadataMonitor = monitor;
    monitorIcyStream(monitor);
    return monitor;
  }

  app.get("/nowplaying/events", (req, res) => {
    const streamUrl = String(req.query.url || "").trim();
    let parsedUrl;
    try { parsedUrl = new URL(streamUrl); } catch {}
    const configured = Object.values(getStations()).flat().some((station) => station.url === streamUrl);
    if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol) || !configured) return res.status(400).json({ error: "Choose a configured stream URL." });
    if (parsedUrl.pathname.toLowerCase().endsWith(".m3u8")) return res.status(501).json({ error: "Continuous metadata monitoring is not available for HLS streams." });
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const monitor = getMetadataMonitor(streamUrl);
    monitor.clients.add(res);
    if (monitor.track) sendMonitorEvent({ clients: new Set([res]) }, "track", monitor.track);
    const keepAlive = setInterval(() => {
      if (!writeBoundedSse(res, ": keep-alive\n\n")) monitor.clients.delete(res);
    }, 15000);
    req.on("close", () => {
      clearInterval(keepAlive);
      monitor.clients.delete(res);
      if (!monitor.clients.size && metadataMonitor === monitor) stopMetadataMonitor(monitor);
    });
  });

  async function readHls(streamUrl) {
    const response = await fetch(streamUrl, { headers: { "User-Agent": "MyMusics/1.0" }, timeout: 8000 });
    if (!response.ok) throw new Error(`Playlist returned ${response.status}`);
    const playlist = await response.text();
    for (const line of playlist.split(/\r?\n/)) {
      const match = line.match(/^#EXTINF:[^,]*,(.+)$/i);
      if (match?.[1]?.trim()) return parseTrackTitle(match[1]);
    }
    return null;
  }

  app.get("/nowplaying", async (req, res) => {
    const streamUrl = String(req.query.url || "").trim();
    let parsedUrl;
    try { parsedUrl = new URL(streamUrl); } catch {}
    const configured = Object.values(getStations()).flat().some((station) => station.url === streamUrl);
    if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol) || !configured) return res.status(400).json({ error: "Choose a configured stream URL." });
    try {
      const track = parsedUrl.pathname.toLowerCase().endsWith(".m3u8") ? await readHls(streamUrl) : await readIcy(streamUrl);
      res.json(track);
    } catch (error) {
      const lastLogged = streamErrorLog.get(streamUrl) || 0;
      if (!/returned 404|returned 410/.test(error.message) && Date.now() - lastLogged > 300_000) {
        console.warn(`Now-playing metadata unavailable for ${parsedUrl.hostname}: ${error.message}`);
        rememberBounded(streamErrorLog, streamUrl, Date.now(), MAX_STREAM_ERROR_KEYS);
      }
      // Playback and station browsing should continue when an external metadata endpoint is down.
      res.json(null);
    }
  });

};
