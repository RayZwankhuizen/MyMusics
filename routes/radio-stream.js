const fetch = globalThis.fetch;
const { Readable } = require("node:stream");

module.exports = function registerRadioStreamRoute(app, { getStations }) {
  const streams = new Map();

  function finish(stream, error) {
    if (stream.closed) return;
    stream.closed = true;
    clearTimeout(stream.idleTimer);
    if (streams.get(stream.url) === stream) streams.delete(stream.url);
    for (const client of stream.clients) {
      if (error && !client.headersSent) client.status(error.status || 502).end();
      else if (error) client.destroy();
      else client.end();
    }
    stream.clients.clear();
  }

  function attach(stream, res) {
    clearTimeout(stream.idleTimer);
    stream.clients.add(res);
    if (stream.headers && !res.headersSent) {
      res.status(stream.status).set(stream.headers).flushHeaders();
    }
    res.on("close", () => {
      stream.clients.delete(res);
      if (!stream.clients.size && !stream.closed) {
        stream.idleTimer = setTimeout(() => {
          stream.controller.abort();
          finish(stream);
        }, 20_000);
        stream.idleTimer.unref?.();
      }
    });
  }

  async function openStream(stream) {
    try {
      const upstream = await fetch(stream.url, {
        headers: { "Accept-Encoding": "identity", "Icy-MetaData": "0", "User-Agent": "MyMusics/1.0" },
        signal: stream.controller.signal
      });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        return finish(stream, { status: upstream.status || 502 });
      }
      stream.status = upstream.status;
      stream.headers = {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no"
      };
      for (const client of stream.clients) {
        if (!client.headersSent) client.status(stream.status).set(stream.headers).flushHeaders();
      }
      const body = Readable.fromWeb(upstream.body);
      body.on("data", (chunk) => {
        for (const client of stream.clients) if (!client.destroyed) client.write(chunk);
      });
      body.on("end", () => finish(stream));
      body.on("error", (error) => finish(stream, error));
    } catch (error) {
      if (!stream.controller.signal.aborted) finish(stream, error);
    }
  }

  app.get("/api/radio-stream", (req, res) => {
    const url = String(req.query.url || "").trim();
    let parsed;
    try { parsed = new URL(url); } catch {}
    const station = Object.values(getStations()).flat().find((item) => item.url === url);
    if (!station || !parsed || !["http:", "https:"].includes(parsed.protocol) || station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(url)) {
      return res.status(400).json({ error: "Choose a configured MP3 radio stream." });
    }

    let stream = streams.get(url);
    if (!stream || stream.closed) {
      stream = { url, clients: new Set(), controller: new AbortController(), headers: null, closed: false };
      streams.set(url, stream);
      attach(stream, res);
      void openStream(stream);
      return;
    }
    attach(stream, res);
  });
};
