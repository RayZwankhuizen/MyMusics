const validId = /^[0-9a-f]{32}$/i;
const normalize = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");

function duplicateKey(track) {
  const title = normalize(track?.title);
  const artist = normalize(track?.artist);
  const duration = Math.round(Number(track?.durationMs) / 1000);
  return title && artist && duration > 0 ? `${title}\0${artist}\0${duration}` : "";
}

module.exports = function registerMusicManagementRoutes(app, { jellyfin }) {
  app.get("/api/music/manage/tracks", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Configure Jellyfin to manage music files." });
    const startIndex = req.query.startIndex === undefined ? 0 : Number(req.query.startIndex);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    if (!Number.isSafeInteger(startIndex) || startIndex < 0) return res.status(400).json({ error: "Invalid library position." });
    try { res.json(await jellyfin.managementTracks(startIndex, limit)); }
    catch (error) { res.status(502).json({ error: error.message || "Could not scan the Jellyfin library." }); }
  });

  app.delete("/api/music/manage/tracks/:id", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Configure Jellyfin to manage music files." });
    if (!req.is("application/json")) return res.status(415).json({ error: "File deletion requires an explicit JSON confirmation." });
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "File deletion is only allowed from this MyMusics page." });
    const id = String(req.params.id || "");
    const keepId = String(req.body?.keepId || "");
    if (req.body?.confirm !== "DELETE") return res.status(400).json({ error: "Type DELETE to confirm file removal." });
    if (!validId.test(id) || !validId.test(keepId) || id === keepId) return res.status(400).json({ error: "Choose a duplicate file and a different copy to keep." });
    try {
      const [remove, keep] = await Promise.all([jellyfin.managementTrack(id), jellyfin.managementTrack(keepId)]);
      if (!remove || !keep || !remove.path || !keep.path) return res.status(404).json({ error: "Could not verify both file locations." });
      if (!duplicateKey(remove) || duplicateKey(remove) !== duplicateKey(keep) || remove.path === keep.path) {
        return res.status(409).json({ error: "These files no longer match as duplicates. Scan the library again." });
      }
      await jellyfin.deleteItem(id);
      res.json({ deleted: true, path: remove.path });
    } catch (error) { res.status(502).json({ error: error.message || "Could not delete the duplicate file." }); }
  });
};
