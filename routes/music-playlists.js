module.exports = function registerMusicPlaylistRoutes(app, { playlists }) {
  app.get("/api/music/playlists", (_req, res) => res.json({ playlists: playlists.list() }));


  app.post("/api/music/playlists", (req, res) => {
    const result = playlists.create(req.body?.name);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ playlist: result.playlist });
  });


  app.get("/api/music/playlists/:id", (req, res) => {
    const playlist = playlists.get(req.params.id);
    if (!playlist) return res.status(404).json({ error: "Playlist not found." });
    res.json({ playlist });
  });


  app.patch("/api/music/playlists/:id", (req, res) => {
    const result = playlists.rename(req.params.id, req.body?.name);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ playlist: result.playlist });
  });


  app.delete("/api/music/playlists/:id", (req, res) => {
    if (!playlists.remove(req.params.id)) return res.status(404).json({ error: "Playlist not found." });
    res.status(204).end();
  });


  app.post("/api/music/playlists/:id/tracks", (req, res) => {
    const result = playlists.addTrack(req.params.id, req.body?.track);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ playlist: result.playlist });
  });


  app.delete("/api/music/playlists/:id/tracks/:index", (req, res) => {
    const result = playlists.removeTrack(req.params.id, Number(req.params.index));
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ playlist: result.playlist });
  });


};
