module.exports = function registerMusicMediaRoutes(app, { jellyfin }) {
  app.get("/library/audio/:id", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Set JELLYFIN_URL and JELLYFIN_API_KEY to stream your music library." });
    if (!/^[0-9a-z]{8,64}$/i.test(req.params.id)) return res.status(400).json({ error: "Unknown track id." });
    // A browser that cannot decode the original format asks for this; the
    // response is MP3 and cannot be seeked.
    const transcode = req.query.transcode === "1";
    try {
      const upstream = await jellyfin.streamAudio(req.params.id, req.headers.range, { transcode });
      res.status(upstream.status);
      for (const header of ["content-type", "content-length", "accept-ranges", "content-range"]) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      if (!res.get("Content-Type")) res.set("Content-Type", "audio/mpeg");
      res.set("Cache-Control", "no-store");
      upstream.body.on("error", () => res.destroy());
      req.on("close", () => upstream.body.destroy());
      upstream.body.pipe(res);
    } catch (error) {
      res.status(502).json({ error: `Could not stream this track: ${error.message}` });
    }
  });


  app.get("/library/art/:id", async (req, res) => {
    if (!jellyfin.configured()) return res.status(404).json({ error: "Music library is not configured." });
    if (!/^[0-9a-z]{8,64}$/i.test(req.params.id)) return res.status(400).json({ error: "Unknown artwork id." });
    try {
      const upstream = await jellyfin.image(req.params.id);
      if (!upstream.ok) return res.status(404).json({ error: "Artwork not found." });
      res.set({
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      });
      upstream.body.pipe(res);
    } catch {
      res.status(502).json({ error: "Could not load artwork." });
    }
  });
};
