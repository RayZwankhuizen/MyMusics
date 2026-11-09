const registerMusicPlaylistRoutes = require("./music-playlists");
const registerMusicMediaRoutes = require("./music-media");
const registerMusicGenreRoutes = require("./music-genres");

module.exports = function registerMusicRoutes(app, { jellyfin, playlists, musicGenres = require("../music-genres") }) {

  app.get("/api/music/status", (_req, res) => {
    res.json({ configured: jellyfin.configured(), server: serverUrlForClient(jellyfin.serverUrl()) });
  });


  app.post("/api/music/refresh", async (_req, res) => {
    try {
      if (typeof jellyfin.clearCache === "function") jellyfin.clearCache();
      if (typeof jellyfin.refreshLibrary === "function") {
        await jellyfin.refreshLibrary();
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(502).json({ error: error.message || "Could not request a Jellyfin library refresh." });
    }
  });

  app.get("/api/music/refresh/status", async (_req, res) => {
    try {
      if (typeof jellyfin.libraryRefreshStatus !== "function") return res.json({ available: false, running: false, progress: null });
      res.json(await jellyfin.libraryRefreshStatus());
    } catch (error) {
      res.status(502).json({ error: error.message || "Could not read Jellyfin refresh status." });
    }
  });


  app.get("/api/music/search", async (req, res) => {
    const term = String(req.query.q || "").trim().slice(0, 80);
    const requested = String(req.query.type || "all").trim().toLowerCase();
    const type = ["all", "track", "artist", "album", "genre", "playlist"].includes(requested) ? requested : "all";
    // Library categories can be listed without a term; tracks need one.
    const canEnumerate = ["all", "artist", "album", "genre", "playlist"].includes(type);
    if (term.length === 1 || (!term && !canEnumerate)) {
      return res.status(400).json({ error: "Enter at least two characters to search your music." });
    }
    const localPlaylists = () => playlists.search(term, 20).map((playlist) => ({
      kind: "playlist",
      id: playlist.id,
      title: playlist.name,
      trackCount: playlist.trackCount
    }));
    try {
      if (type === "playlist") return res.json({ type, results: localPlaylists() });
      if (!jellyfin.configured()) return res.json({ type, results: ["all", "playlist"].includes(type) ? localPlaylists() : [] });
      let results;
      if (!term) results = type === "album" ? await jellyfin.allAlbums(300) : type === "genre" ? await musicGenres.list(jellyfin) : await jellyfin.allArtists(300);
      else if (type === "genre") results = typeof jellyfin.listGenres === "function"
        ? await musicGenres.search(term, jellyfin) : await jellyfin.search(term, type);
      else if (type === "all") {
        const found = await jellyfin.searchAll(term);
        const genres = typeof jellyfin.listGenres === "function"
          ? await musicGenres.search(term, jellyfin) : found.filter((item) => item.kind === "genre");
        const exact = genres.filter((genre) => genre.title.toLocaleLowerCase() === term.toLocaleLowerCase());
        results = [...localPlaylists(), ...exact, ...found.filter((item) => item.kind !== "genre"), ...genres.filter((genre) => !exact.includes(genre))];
      }
      else results = await jellyfin.search(term, type);
      res.json({ type, results: results.map((item) => item.kind === "album"
        ? { ...item, genre: musicGenres.albumGenre(item.id, item.genre) } : item) });
    } catch (error) {
      res.status(502).json({ error: `Music search is unavailable: ${error.message}` });
    }
  });


  app.get("/api/music/info", async (req, res) => {
    const kind = String(req.query.kind || "").trim().toLowerCase();
    const id = String(req.query.id || "").trim().slice(0, 200);
    if (!["track", "album", "artist", "genre", "playlist"].includes(kind)) return res.status(400).json({ error: "Unknown item kind." });
    if (!id) return res.status(400).json({ error: "Choose an item." });
    try {
      if (kind === "playlist") {
        const playlist = playlists.get(id);
        if (!playlist) return res.status(404).json({ error: "Playlist not found." });
        return res.json({ info: {
          kind, id: playlist.id, title: playlist.name,
          trackCount: playlist.tracks.length, updatedAt: playlist.updatedAt || null,
          tracks: playlist.tracks.slice(0, 100)
        } });
      }
      if (kind === "genre") {
        if (!jellyfin.configured()) return res.json({ info: { kind, id, title: id, albumCount: 0, trackCount: 0, albums: [], tracks: [] } });
        const info = typeof jellyfin.listGenres === "function" ? await musicGenres.info(id, jellyfin) : null;
        if (!info && typeof jellyfin.listGenres !== "function") {
          const [albumCount, trackCount, albums, tracks] = await Promise.all([
            jellyfin.countAlbumsByGenre(id).catch(() => 0), jellyfin.countByGenre(id).catch(() => 0),
            jellyfin.albumsByGenre(id, 40).catch(() => []), jellyfin.tracksByGenre(id, 20).catch(() => [])
          ]);
          return res.json({ info: { kind, id, title: id, albumCount, trackCount, albums, tracks } });
        }
        if (!info) return res.status(404).json({ error: "Genre not found." });
        return res.json({ info });
      }
      if (!jellyfin.configured()) return res.status(503).json({ error: "Set JELLYFIN_URL and JELLYFIN_API_KEY to inspect your library." });
      const item = await jellyfin.itemInfo(id);
      // Jellyfin answers an all-zero id with the library root, so check the type.
      const expectedType = { track: "Audio", album: "MusicAlbum", artist: "MusicArtist" }[kind];
      if (!item?.Id || !item.Name || (expectedType && item.Type && item.Type !== expectedType) || (kind === "artist" && item.IsFolder === true)) {
        return res.status(404).json({ error: "Item not found." });
      }
      const ticks = Number(item.RunTimeTicks) || 0;
      const info = {
        kind,
        id: item.Id,
        title: item.Name || "",
        artist: item.Artists?.[0] || item.AlbumArtist || "",
        album: item.Album || "",
        genre: kind === "album" ? musicGenres.albumGenre(item.Id, (item.Genres || []).join(", ")) : (item.Genres || []).join(", "),
        year: item.ProductionYear || null,
        durationMs: ticks ? Math.round(ticks / 10000) : null,
        trackCount: Number(item.ChildCount) || null,
        albumCount: Number(item.AlbumCount) || null,
        overview: item.Overview || "",
        art: `/library/art/${item.AlbumId || item.Id}`
      };
      // Counts alone are not very useful, so include what they count.
      if (kind === "album") info.tracks = await jellyfin.albumTracks(item.Id).catch(() => []);
      if (kind === "artist") {
      [info.albums, info.tracks, info.trackCount, info.albumCount] = await Promise.all([
        jellyfin.artistAlbums(item.Id).catch(() => []),
        jellyfin.artistTracks(item.Id).catch(() => []),
        jellyfin.countByArtist(item.Id).catch(() => null),
        jellyfin.countAlbumsByArtist(item.Id).catch(() => null)
      ]);
      info.trackCount ??= info.tracks.length;
      info.albumCount ??= info.albums.length;
        // RunTimeTicks on an artist describes a single item, not the whole artist.
        info.durationMs = null;
      }
      res.json({ info });
    } catch (error) {
      res.status(502).json({ error: `Could not load details: ${error.message}` });
    }
  });


  registerMusicPlaylistRoutes(app, { playlists });
  registerMusicGenreRoutes(app, { jellyfin, musicGenres });

  app.get("/api/music/album/:id", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Set JELLYFIN_URL and JELLYFIN_API_KEY to play an album." });
    if (!/^[0-9a-z]{8,64}$/i.test(req.params.id)) return res.status(400).json({ error: "Unknown album id." });
    try {
      const tracks = await jellyfin.albumTracks(req.params.id);
      if (!tracks.length) return res.status(404).json({ error: "This album has no playable tracks." });
      res.json({ tracks });
    } catch (error) {
      res.status(502).json({ error: `Could not load this album: ${error.message}` });
    }
  });


  app.get("/api/music/seed", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Set JELLYFIN_URL and JELLYFIN_API_KEY to start the DJ." });
    const artistId = String(req.query.artistId || "").trim();
    const genre = String(req.query.genre || "").trim().slice(0, 80);
    if (!artistId && !genre) return res.status(400).json({ error: "Choose an artist or a genre." });
    if (artistId && !/^[0-9a-z]{8,64}$/i.test(artistId)) return res.status(400).json({ error: "Unknown artist id." });
    try {
      const track = artistId ? await jellyfin.randomTrackByArtist(artistId) : await jellyfin.randomTrackByGenre(genre);
      if (!track) return res.status(404).json({ error: "No tracks found for this choice." });
      res.json({ track });
    } catch (error) {
      res.status(502).json({ error: `Could not start this radio: ${error.message}` });
    }
  });


  app.get("/api/autodj/next", async (req, res) => {
    if (!jellyfin.configured()) return res.status(503).json({ error: "Set JELLYFIN_URL and JELLYFIN_API_KEY to start the DJ." });
    const seed = String(req.query.seed || "").trim();
    if (seed && !/^[0-9a-z]{8,64}$/i.test(seed)) return res.status(400).json({ error: "Choose a valid seed track." });
    const mode = String(req.query.mode || "").trim().toLowerCase();
    if (mode && !["artist", "album", "genre"].includes(mode)) return res.status(400).json({ error: "Choose artist, album, or genre AutoDJ." });
    const list = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 100);
    try {
      const options = {
        seed,
        excludeIds: list(req.query.exclude),
        excludeArtists: list(req.query.artists),
        limit: Number(req.query.limit) || 8
      };
      if (mode) options.mode = mode;
      const result = await jellyfin.nextTracks(options);
      if (!result.tracks.length) return res.status(404).json({ error: "No tracks matched. Try another seed or add music to Jellyfin." });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: `The DJ is unavailable: ${error.message}` });
    }
  });


  registerMusicMediaRoutes(app, { jellyfin });
};

function serverUrlForClient(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}
