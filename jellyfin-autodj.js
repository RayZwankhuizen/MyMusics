const normalize = (value) => String(value || "").trim().toLocaleLowerCase();

module.exports = function createAutoDj({ getTrack, randomTracksByArtist, albumTracks, tracksByGenre, instantMix, randomTracks }) {
  return async function nextTracks({ seed = "", mode = "", excludeIds = [], excludeArtists = [], limit = 8 } = {}) {
    const want = Math.min(Math.max(Number(limit) || 8, 1), 25);
    const seen = new Set();
    const blockedIds = new Set(excludeIds);
    const blockedArtists = new Set((mode === "artist" || mode === "album" ? [] : excludeArtists).map(normalize).filter(Boolean));
    const picked = [];
    let lastError = null;
    // A failing lookup must not hide a broken connection: remember the first
    // error and rethrow it when every fallback came back empty.
    const attempt = async (factory, fallback) => {
      try { return await factory(); }
      catch (error) { if (!lastError) lastError = error; return fallback; }
    };
    const seedTrack = seed ? await attempt(() => getTrack(seed), null) : null;
    const seedGenre = seedTrack?.genre || "";

    const take = (tracks) => {
      for (const track of tracks) {
        if (picked.length >= want) return;
        if (blockedIds.has(track.id) || seen.has(track.id)) continue;
        if (blockedArtists.size && blockedArtists.has(normalize(track.artist))) continue;
        seen.add(track.id);
        picked.push(track);
      }
    };

    if (seedTrack && mode === "artist") {
      if (!seedTrack.artistId) throw new Error("The selected track has no linked Jellyfin artist.");
      take(await attempt(() => randomTracksByArtist(seedTrack.artistId, want * 4), []));
    } else if (seedTrack && mode === "album") {
      if (!seedTrack.albumId || seedTrack.albumId === seedTrack.id) throw new Error("The selected track has no linked Jellyfin album.");
      take(await attempt(() => albumTracks(seedTrack.albumId, 300), []));
    } else if (seedTrack && mode === "genre") {
      if (!seedGenre) throw new Error("The selected track has no genre.");
      take(await attempt(() => tracksByGenre(seedGenre, want * 4), []));
    } else if (seedTrack) {
      take(await attempt(() => instantMix(seedTrack.id, want * 3), []));
      if (picked.length < want && seedGenre) take(await attempt(() => tracksByGenre(seedGenre, want * 4), []));
    }
    if (!mode && picked.length < want) take(await attempt(() => randomTracks(want * 4), []));

    if (!picked.length && lastError) throw lastError;
    return { seed: seedTrack, tracks: picked };
  };
};
