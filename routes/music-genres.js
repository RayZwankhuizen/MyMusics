module.exports = function registerMusicGenreRoutes(app, { jellyfin, musicGenres }) {
  app.put("/api/music/albums/:id/genre", async (req, res) => {
    const genre = typeof req.body?.genre === "string" ? req.body.genre.trim() : "";
    try {
      if (!jellyfin.configured()) return res.status(503).json({ error: "Configure Jellyfin to edit album genres." });
      if (!/^[0-9a-z]{8,64}$/i.test(req.params.id)) return res.status(400).json({ error: "Choose a valid album." });
      if (genre && !musicGenres.managementList(await jellyfin.listGenres(500)).some((item) => item.displayName === genre)) {
        return res.status(400).json({ error: "Choose a genre from the library." });
      }
      const item = await jellyfin.itemInfo(req.params.id);
      if (!item?.Id || item.Type !== "MusicAlbum") return res.status(404).json({ error: "Album not found." });
      const result = musicGenres.setAlbumGenre(item.Id, genre);
      if (result.error) return res.status(400).json(result);
      res.json({ ok: true, genre: musicGenres.albumGenre(item.Id, (item.Genres || []).join(", ")) });
    } catch (error) { res.status(502).json({ error: error.message || "Could not save the album genre." }); }
  });

  app.get("/api/music/genres", async (_req, res) => {
    try {
      if (!jellyfin.configured()) return res.status(503).json({ error: "Configure Jellyfin to manage music genres." });
      res.json({ genres: musicGenres.managementList(await jellyfin.listGenres(500)) });
    } catch (error) { res.status(502).json({ error: error.message || "Could not load music genres." }); }
  });

  app.put("/api/music/genres/:source", async (req, res) => {
    try {
      if (!jellyfin.configured()) return res.status(503).json({ error: "Configure Jellyfin to manage music genres." });
      const source = req.params.source;
      const genres = await jellyfin.listGenres(500);
      if (!genres.some((genre) => genre.title === source)) return res.status(404).json({ error: "Jellyfin genre not found." });
      const result = musicGenres.set(source, req.body?.displayName);
      if (result.error) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (error) { res.status(502).json({ error: error.message || "Could not save the music genre." }); }
  });

  app.delete("/api/music/genres/:source", (req, res) => {
    try {
      musicGenres.reset(req.params.source);
      res.status(204).end();
    } catch (error) { res.status(500).json({ error: error.message || "Could not reset the music genre." }); }
  });
};
