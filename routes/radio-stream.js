const fetch = require("node-fetch");

module.exports = function registerRadioStreamRoute(app, { getStations }) {
  app.get("/api/radio-stream", async (req, res) => {
    const url = String(req.query.url || "").trim();
    let parsed;
    try { parsed = new URL(url); } catch {}
    const station = Object.values(getStations()).flat().find((item) => item.url === url);
    if (!station || !parsed || !["http:", "https:"].includes(parsed.protocol) || station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(url)) {
      return res.status(400).json({ error: "Choose a configured MP3 radio stream." });
    }

    const controller = new AbortController();
    res.on("close", () => controller.abort());
    try {
      const upstream = await fetch(url, {
        headers: { "Accept-Encoding": "identity", "Icy-MetaData": "0", "User-Agent": "MyMusics/1.0" },
        signal: controller.signal
      });
      if (!upstream.ok || !upstream.body) {
        upstream.body?.destroy();
        return res.status(upstream.status || 502).end();
      }
      res.status(upstream.status).set({
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no"
      });
      upstream.body.on("error", () => res.destroy());
      upstream.body.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).json({ error: "Radio stream unavailable." });
      else res.destroy();
    }
  });
};
