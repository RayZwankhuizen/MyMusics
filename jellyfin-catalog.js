const itemFields = "Genres,AlbumArtist,Artists,AlbumId,RunTimeTicks,ProductionYear,Container";

module.exports = function createJellyfinCatalog({ getJson }) {
  const genreCountCache = new Map();

  function toTrack(item) {
    const ticks = Number(item?.RunTimeTicks) || 0;
    const albumId = item?.AlbumId || item?.Id;
    return {
      kind: "track",
      id: item?.Id,
      title: item?.Name || "Unknown track",
      artist: item?.Artists?.[0] || item?.AlbumArtist || "",
      artistId: item?.ArtistItems?.[0]?.Id || "",
      album: item?.Album || "",
      albumId,
      genre: item?.Genres?.[0] || "",
      year: item?.ProductionYear || null,
      durationMs: ticks ? Math.round(ticks / 10000) : null,
      // Some items list several sources ("flac,m4a"); the first one is played.
      container: String(item?.Container || "").split(",")[0].trim().toLocaleLowerCase(),
      art: `/library/art/${albumId}`
    };
  }

  function toAlbum(item) {
    return {
      kind: "album",
      id: item?.Id,
      title: item?.Name || "Unknown album",
      artist: item?.AlbumArtist || item?.Artists?.[0] || "",
      genre: item?.Genres?.[0] || "",
      year: item?.ProductionYear || null,
      trackCount: Number(item?.ChildCount) || null,
      art: `/library/art/${item?.Id}`
    };
  }

  function toArtist(item) {
    return {
      kind: "artist",
      id: item?.Id,
      title: item?.Name || "Unknown artist",
      albumCount: Number(item?.AlbumCount) || Number(item?.ChildCount) || null
    };
  }

  async function filterArtistFolders(items) {
    return Promise.all(items.map(async (item) => {
      if (item.IsFolder === true) return null;
      if (Number(item.AlbumCount) || !Number(item.ChildCount)) return item;
      try {
        const children = await getJson("/Items", {
          ParentId: item.Id,
          IncludeItemTypes: "MusicArtist",
          Recursive: "false",
          Limit: "1"
        });
        return children?.Items?.length ? null : item;
      } catch {
        return item;
      }
    })).then((artists) => artists.filter(Boolean).map(toArtist));
  }

  function toGenre(item) {
    return { kind: "genre", id: item?.Id || item?.Name, title: item?.Name || "Unknown genre" };
  }

  function toTracks(result) {
    return (result?.Items || []).map(toTrack).filter((track) => track.id);
  }

  async function searchTracks(term, limit = 30) {
    return toTracks(await getJson("/Items", {
      searchTerm: term,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "SortName",
      Limit: String(limit)
    }));
  }

  async function searchAlbums(term, limit = 20) {
    const result = await getJson("/Items", {
      searchTerm: term,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Fields: "Genres,AlbumArtist,Artists,ProductionYear,ChildCount",
      SortBy: "SortName",
      Limit: String(limit)
    });
    const albums = (result?.Items || []).map(toAlbum).filter((album) => album.id);
    const playable = await Promise.all(albums.map(async (album) => {
      try {
        const tracks = await getJson("/Items", {
          ParentId: album.id,
          IncludeItemTypes: "Audio",
          Recursive: "false",
          Limit: "1"
        });
        return Boolean(tracks?.Items?.length);
      } catch {
        return true;
      }
    }));
    return albums.filter((_, index) => playable[index]);
  }

  async function searchArtists(term, limit = 15) {
    const result = await getJson("/Items", {
      searchTerm: term,
      IncludeItemTypes: "MusicArtist",
      Recursive: "true",
      SortBy: "SortName",
      Fields: "AlbumCount,ChildCount",
      Limit: String(limit)
    });
    return filterArtistFolders((result?.Items || []).filter((item) => item?.Id));
  }

  // /MusicGenres has no search parameter, so fetch the list once per request and
  // filter it here. Falls back to the generic item query when that endpoint is
  // unavailable.
  async function genreItems() {
    try {
      const result = await getJson("/MusicGenres", {});
      const items = Array.isArray(result) ? result : result?.Items;
      if (items) return items.map(toGenre).filter((genre) => genre.title);
    } catch { /* fall through to the item query */ }
    const result = await getJson("/Items", { IncludeItemTypes: "MusicGenre", Recursive: "true", Limit: "500" });
    return (result?.Items || []).map(toGenre).filter((genre) => genre.title);
  }

  async function searchGenres(term, limit = 10) {
    const needle = term.toLocaleLowerCase();
    const genres = (await genreItems())
      .filter((genre) => genre.title.toLocaleLowerCase().includes(needle))
      .slice(0, limit);
    return genresWithCounts(genres);
  }

  async function allGenres(limit = 300) {
    return genresWithCounts((await genreItems()).slice(0, limit));
  }

  async function genresWithCounts(genres) {
    const results = new Array(genres.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, genres.length) }, async () => {
      while (next < genres.length) {
        const index = next++;
        const genre = genres[index];
        let counts = genreCountCache.get(genre.title);
        if (!counts) {
          counts = Promise.all([
            countAlbumsByGenre(genre.title).catch(() => null),
            countByGenre(genre.title).catch(() => null)
          ]).then(([albumCount, trackCount]) => ({ albumCount, trackCount }));
          genreCountCache.set(genre.title, counts);
        }
        results[index] = { ...genre, ...await counts };
      }
    }));
    return results;
  }

  async function allArtists(limit = 300) {
    const result = await getJson("/Items", {
      IncludeItemTypes: "MusicArtist",
      Recursive: "true",
      SortBy: "SortName",
      Fields: "AlbumCount,ChildCount",
      Limit: String(limit)
    });
    return filterArtistFolders((result?.Items || []).filter((item) => item?.Id));
  }

  async function allAlbums(limit = 300) {
    const result = await getJson("/Items", {
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Fields: "Genres,AlbumArtist,Artists,ProductionYear,ChildCount",
      SortBy: "SortName",
      Limit: String(limit)
    });
    return (result?.Items || []).map(toAlbum).filter((album) => album.id);
  }

  async function search(term, type) {
    if (type === "track") return searchTracks(term, 40);
    if (type === "artist") return searchArtists(term, 20);
    if (type === "album") return searchAlbums(term, 20);
    if (type === "genre") return searchGenres(term, 15);
    return searchAll(term);
  }

  // "All" keeps tracks first because they are the most direct way to start a DJ.
  async function searchAll(term) {
    const settled = await Promise.allSettled([
      searchTracks(term, 12),
      searchAlbums(term, 8),
      searchArtists(term, 6),
      searchGenres(term, 5)
    ]);
    const [tracks, albums, artists, genres] = settled.map((result) => result.status === "fulfilled" ? result.value : []);
    // Surface a real failure instead of an empty search when every query died.
    if (settled.every((result) => result.status === "rejected")) throw settled[0].reason;
    // A genre that matches the term exactly ("r&b", "jazz") is what the user
    // meant, even though the track search will return noise for such a term.
    const needle = term.toLocaleLowerCase();
    const exactGenres = genres.filter((genre) => genre.title.toLocaleLowerCase() === needle);
    const otherGenres = genres.filter((genre) => !exactGenres.includes(genre));
    return [...exactGenres, ...tracks, ...albums, ...artists, ...otherGenres];
  }

  async function artistAlbums(artistId, limit = 30) {
    const result = await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Fields: "Genres,AlbumArtist,Artists,ProductionYear,ChildCount",
      SortBy: "ProductionYear,SortName",
      Limit: String(limit)
    });
    return (result?.Items || []).map(toAlbum).filter((album) => album.id);
  }

  async function artistTracks(artistId, limit = 25) {
    const result = await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "SortName",
      Limit: String(limit)
    });
    return toTracks(result);
  }

  async function randomTracksByArtist(artistId, limit = 30) {
    return toTracks(await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "Random",
      Limit: String(limit)
    }));
  }

  async function itemInfo(id) {
    return getJson(`/Items/${encodeURIComponent(id)}`, {
      Fields: "Genres,AlbumArtist,Artists,Album,RunTimeTicks,ProductionYear,ChildCount,AlbumCount,Overview"
    });
  }

  // Artist items carry ChildCount and RunTimeTicks that do not describe their
  // tracks (ChildCount can exceed the track list, RunTimeTicks is one item), so
  // count with dedicated queries.
  async function countByArtist(artistId) {
    const result = await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Limit: "1"
    });
    return Number(result?.TotalRecordCount) || 0;
  }

  async function countAlbumsByArtist(artistId) {
    const result = await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Limit: "1"
    });
    return Number(result?.TotalRecordCount) || 0;
  }

  async function countByGenre(genre) {
    const result = await getJson("/Items", {
      Genres: genre,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Limit: "1"
    });
    return Number(result?.TotalRecordCount) || 0;
  }

  async function countAlbumsByGenre(genre) {
    const result = await getJson("/Items", {
      Genres: genre,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Limit: "1"
    });
    return Number(result?.TotalRecordCount) || 0;
  }

  async function albumsByGenre(genre, limit = 40) {
    const result = await getJson("/Items", {
      Genres: genre,
      IncludeItemTypes: "MusicAlbum",
      Recursive: "true",
      Fields: "Genres,AlbumArtist,Artists,ProductionYear,ChildCount",
      SortBy: "SortName",
      Limit: String(limit)
    });
    return (result?.Items || []).map(toAlbum).filter((album) => album.id);
  }

  async function albumTracks(albumId, limit = 300) {
    return toTracks(await getJson("/Items", {
      ParentId: albumId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "ParentIndexNumber,IndexNumber",
      Limit: String(limit)
    }));
  }

  async function randomTrackByArtist(artistId) {
    const tracks = toTracks(await getJson("/Items", {
      ArtistIds: artistId,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "Random",
      Limit: "1"
    }));
    return tracks[0] || null;
  }

  async function randomTracks(limit = 30) {
    return toTracks(await getJson("/Items", {
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "Random",
      Limit: String(limit)
    }));
  }

  async function tracksByGenre(genre, limit = 30) {
    return toTracks(await getJson("/Items", {
      Genres: genre,
      IncludeItemTypes: "Audio",
      Recursive: "true",
      Fields: itemFields,
      SortBy: "Random",
      Limit: String(limit)
    }));
  }

  async function randomTrackByGenre(genre) {
    const tracks = await tracksByGenre(genre, 1);
    return tracks[0] || null;
  }

  async function getTrack(id) {
    const item = await getJson(`/Items/${encodeURIComponent(id)}`, { Fields: itemFields });
    const track = toTrack(item);
    return track.id ? track : null;
  }

  async function instantMix(id, limit = 30) {
    return toTracks(await getJson(`/Items/${encodeURIComponent(id)}/InstantMix`, {
      Fields: itemFields,
      Limit: String(limit)
    }));
  }

  return {
    clearCache: () => genreCountCache.clear(),
    api: {
      search, searchAll, searchTracks, searchAlbums, searchArtists, searchGenres,
      allGenres, listGenres: genreItems, allArtists, allAlbums, itemInfo, countByGenre, countAlbumsByGenre,
      albumsByGenre, countByArtist, countAlbumsByArtist, artistAlbums, artistTracks,
      tracksByGenre, albumTracks, randomTrackByArtist, randomTrackByGenre, randomTracks, getTrack
    },
    autoDj: { getTrack, randomTracksByArtist, albumTracks, tracksByGenre, instantMix, randomTracks }
  };
};
