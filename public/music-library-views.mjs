export function createMusicResultView({ el, emptyRow, textButton, scrollQueueText, addAlbumToQueue, loadCollectionToQueue, queuePlaylist, enqueueTracks, markAdded, openInfo, addTrackToPlaylist, getMusicGenres, saveAlbumGenre }) {
  function details(item, showAlbum = true) {
    if (item.kind === "track") return [showAlbum ? item.album : ""];
    if (item.kind === "playlist") return [`${item.trackCount ?? 0} track${item.trackCount === 1 ? "" : "s"}`];
    return [];
  }

  function action(item) {
    if (item.kind === "album") return { label: "Add album to queue", run: () => addAlbumToQueue(item) };
    if (item.kind === "artist" || item.kind === "genre") return { label: "Add tracks to queue", run: () => loadCollectionToQueue(item) };
    if (item.kind === "playlist") return { label: "Queue", run: () => queuePlaylist(item.id) };
    return { label: "Add to queue", run: () => enqueueTracks([item], "track") };
  }

  function row(item, { showAlbum = true } = {}) {
    const result = document.createElement("div");
    result.className = "station-row music-result-row";
    if (item.kind === "album" && item.art) {
      result.classList.add("has-art");
      const cover = document.createElement("img");
      cover.className = "music-result-art";
      cover.src = item.art;
      cover.alt = `Album cover: ${item.title}`;
      cover.loading = "lazy";
      result.append(cover);
    }
    const body = document.createElement("div");
    body.className = "station-details music-result-details";
    const title = document.createElement("strong");
    title.textContent = item.title;
    body.append(title);
    if (item.kind === "album") {
      const genre = document.createElement("span");
      genre.className = "music-album-genre";
      genre.textContent = `Genre: ${item.genre || "Not assigned"}`;
      body.append(genre);
      const editor = document.createElement("div");
      editor.className = "music-album-genre-editor";
      editor.hidden = true;
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Genre for ${item.title}`);
      const save = textButton("Save genre", async () => {
        save.disabled = true;
        try {
          const result = await saveAlbumGenre(item.id, select.value);
          item.genre = result.genre;
          genre.textContent = `Genre: ${item.genre || "Not assigned"}`;
          editor.hidden = true;
        } catch (error) { status.textContent = error.message; }
        finally { save.disabled = false; }
      });
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      editor.append(select, save, status);
      const change = textButton("Change genre", async () => {
        try {
          const genres = await getMusicGenres();
          select.replaceChildren(new Option("Use Jellyfin genre", ""), ...genres.map((entry) => new Option(entry.displayName, entry.displayName)));
          select.value = item.genre || "";
          editor.hidden = false;
          select.focus();
        } catch (error) { status.textContent = error.message; editor.hidden = false; }
      });
      body.append(change, editor);
    }
    for (const line of details(item, showAlbum).filter((value) => value && value !== item.title)) {
      const subtitle = document.createElement("span");
      subtitle.textContent = line;
      body.append(subtitle);
    }
    const actions = document.createElement("div");
    actions.className = "station-actions";
    if (item.kind === "track") {
      const button = textButton("Add to queue", () => {
        if (enqueueTracks([item], "track")) markAdded(button);
      });
      actions.append(button, textButton("Add to playlist", () => addTrackToPlaylist(item)));
    } else {
      const itemAction = action(item);
      actions.append(textButton(itemAction.label, () => {
        const dialog = el("#info-dialog");
        if (dialog.open) dialog.close();
        itemAction.run();
      }));
    }
    if (item.kind === "playlist") {
      actions.append(textButton("Manage", () => { location.href = `/manage.html?playlist=${encodeURIComponent(item.id)}#playlists`; }));
      actions.append(textButton("Shuffle", () => queuePlaylist(item.id, { shuffle: true })));
    }
    if (item.kind === "artist") actions.append(textButton("Albums & tracks", () => openInfo(item, { browseOnly: true })));
    if (item.kind === "album") actions.append(textButton("Tracks", () => openInfo(item, { browseOnly: true })));
    if (item.kind !== "playlist") actions.append(textButton("Info", () => openInfo(item)));
    result.append(body, actions);
    requestAnimationFrame(() => scrollQueueText(result));
    return result;
  }

  function render(results, searchTerm = "") {
    const list = el("#music-results");
    list.replaceChildren();
    if (!Array.isArray(results) || !results.length) {
      list.append(emptyRow("Nothing matched. Try another word or search type."));
      return;
    }
    const needle = searchTerm.trim().toLocaleLowerCase();
    for (const item of results) list.append(row(item, { showAlbum: !needle || item.album?.toLocaleLowerCase() !== needle }));
    requestAnimationFrame(() => scrollQueueText());
  }

  return Object.freeze({ details, action, row, render });
}
export function createMusicInfoView({ kindLabels, formatDuration, scrollQueueText, emptyRow, resultRow, resultAction, textButton, enqueueTrack, addTrackToPlaylist, markAdded, jbEmpty, jbStrip, resultDetails, openInfo, getMusicGenres, saveAlbumGenre }) {
  const el = (selector) => document.querySelector(selector);

  function groupTitle(text) {
    const heading = document.createElement("p");
    heading.className = "info-group-title";
    heading.textContent = text;
    return heading;
  }

  function renderError(item, browseOnly, error) {
    el("#info-title").textContent = item.title || "Details";
    el("#info-fields").replaceChildren();
    el("#info-lists").replaceChildren();
    el("#info-actions").replaceChildren();
    el("#info-body").hidden = browseOnly;
    el("#info-status").textContent = error.message;
  }

  function renderFields(info) {
    const fields = [
      ["Type", kindLabels[info.kind] || info.kind],
      ["Artist", info.artist],
      ["Album", info.album],
      ["Genre", info.genre],
      ["Year", info.year],
      [info.kind === "track" ? "Length" : "Runtime", formatDuration(info.durationMs)],
      ["Tracks", info.trackCount],
      ["Albums", info.albumCount],
      ["Updated", info.updatedAt ? new Date(info.updatedAt).toLocaleString() : null],
      ["About", info.overview]
    ].filter(([, value]) => value !== null && value !== undefined && value !== "");
    const list = el("#info-fields");
    list.replaceChildren();
    for (const [label, value] of fields) {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = String(value);
      if (label !== "About") detail.classList.add("scroll-line");
      list.append(term, detail);
    }
    requestAnimationFrame(() => scrollQueueText());
  }

  function renderActions(info) {
    const actions = el("#info-actions");
    actions.replaceChildren();
    if (info.kind === "track") {
      const button = textButton("Add to queue", () => {
        el("#info-dialog").close();
        if (enqueueTrack(info)) markAdded(button);
      });
      actions.append(button, textButton("Add to playlist", () => addTrackToPlaylist(info)));
    } else {
      const action = resultAction(info);
      actions.append(textButton(action.label, () => { el("#info-dialog").close(); action.run(); }));
    }
  }

  function renderArtwork(info) {
    const art = el("#info-art");
    if (info.art) {
      art.onload = () => { art.hidden = false; };
      art.onerror = () => { art.hidden = true; };
      art.src = info.art;
    } else {
      art.hidden = true;
      art.removeAttribute("src");
    }
  }

  function renderInfo(info) {
    el("#info-title").textContent = info.title || "Details";
    renderFields(info);
    renderArtwork(info);
    el("#info-lists").replaceChildren();
    el("#info-body").hidden = false;
    renderActions(info);
  }

  function renderBrowse(info) {
    const artist = info.kind === "artist";
    el("#info-title").textContent = info.title || "Tracks";
    el("#info-body").hidden = true;
    el("#info-actions").replaceChildren();
    const lists = el("#info-lists");
    lists.replaceChildren();
    const groups = artist
      ? [["Albums", info.albums], ["Tracks", info.tracks]]
      : [["Tracks", info.tracks]];
    const available = groups.filter(([, items]) => items?.length);
    if (!available.length) {
      lists.append(emptyRow(`No ${artist ? "albums" : "tracks"} found.`));
      return;
    }
    for (const [label, items] of available) {
      lists.append(groupTitle(`${label} · ${items.length}`));
      items.forEach((entry) => { lists.append(resultRow(entry, { showAlbum: artist })); });
    }
  }

  function renderJukeboxSearchRack(info, rackList) {
    rackList.replaceChildren();
    if (info.albums?.length) {
      rackList.append(jbEmpty(`Albums · ${info.albums.length}`));
      info.albums.forEach((album) => { rackList.append(jbStrip(album.title, "", () => openInfo(album), album.art)); });
    }
    if (info.tracks?.length) {
      rackList.append(jbEmpty(`Tracks · ${info.tracks.length}`));
        info.tracks.slice(0, 50).forEach((track) => {
        let strip;
        const subtitle = resultDetails(track, info.kind === "artist").filter((value) => value && value !== track.title).join(" · ");
        strip = jbStrip(track.title, subtitle, () => {
          if (enqueueTrack(track)) markAdded(strip);
        }, track.art);
          const row = document.createElement("div");
          row.className = "jb-search-track-row";
          row.append(strip, textButton("Add to playlist", () => addTrackToPlaylist(track)));
          rackList.append(row);
      });
    }
    if (!info.albums?.length && !info.tracks?.length) rackList.append(jbEmpty("No details available."));
  }

  function renderJukeboxSearchInfo(item, info, rackList) {
    renderJukeboxSearchRack(info, rackList);
    const genrePanel = el("#jb-search-album-genre");
    genrePanel.hidden = item.kind !== "album";
    if (item.kind === "album") {
      const label = el("#jb-search-album-genre-label");
      const select = el("#jb-search-genre-select");
      const editor = el("#jb-search-genre-editor");
      const status = el("#jb-search-genre-status");
      const change = el("#jb-search-change-genre");
      const save = el("#jb-search-save-genre");
      label.textContent = `Genre: ${info.genre || "Not assigned"}`;
      status.textContent = "";
      editor.hidden = true;
      change.onclick = async () => {
        try {
          const genres = await getMusicGenres();
          select.replaceChildren(new Option("Use Jellyfin genre", ""), ...genres.map((entry) => new Option(entry.displayName, entry.displayName)));
          select.value = info.genre || "";
          editor.hidden = false;
          select.focus();
        } catch (error) { status.textContent = error.message; }
      };
      save.onclick = async () => {
        save.disabled = true;
        try {
          const result = await saveAlbumGenre(info.id, select.value);
          info.genre = result.genre;
          label.textContent = `Genre: ${info.genre || "Not assigned"}`;
          editor.hidden = true;
        } catch (error) { status.textContent = error.message; }
        finally { save.disabled = false; }
      };
    }
    let choices;
    if (item.kind === "genre") choices = `${info.albumCount} albums · ${info.trackCount} tracks`;
    else choices = [info.albums?.length && `${info.albums.length} albums`, info.tracks?.length && `${info.tracks.length} tracks`].filter(Boolean).join(" · ");

    let feedback;
    if (item.kind === "album") {
      feedback = info.tracks?.length
        ? `${info.tracks.length} tracks. Select one below or add the album to Up next.`
        : "No playable tracks found on this album.";
    } else if (item.kind === "genre") feedback = `${choices}. Showing up to 40 albums and 20 tracks.`;
    else if (choices) feedback = `${choices}. Select an album or track below.`;
    else feedback = "No albums or tracks found for this item.";
    el("#jb-search-feedback").textContent = feedback;
  }

  function prepareJukeboxSearchInfo(item) {
    el("#jb-search-heading").textContent = `${kindLabels[item.kind] || "Details"} · ${item.title || ""}`;
    el("#jb-search-back").hidden = false;
    el("#jb-search-add-album").hidden = item.kind !== "album";
    el("#jb-search-album-genre").hidden = item.kind !== "album";
    if (item.kind === "album") el("#jb-search-album-genre-label").textContent = "Genre: Loading…";
    let feedback;
    if (item.kind === "artist") feedback = "Choose an album to browse its tracks, or choose a track to play it.";
    else if (item.kind === "album") feedback = "Choose a track below or add the album to Up next.";
    else feedback = "Choose a track below to play it.";
    el("#jb-search-feedback").textContent = feedback;
    const rackList = el("#jb-rack-list");
    if (rackList) rackList.replaceChildren(jbEmpty("Loading details…"));
    return rackList;
  }

  return Object.freeze({ renderError, renderInfo, renderBrowse, renderJukeboxSearchInfo, prepareJukeboxSearchInfo });
}
