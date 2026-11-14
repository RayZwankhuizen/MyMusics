export function createManageCatalogView({ el }) {
  function render({ stations, selectedGenre, query, onSelectGenre, onFavorite, onEdit, onTest, onDelete }) {
    const names = Object.keys(stations);
    const genreSelect = el("#station-genre");
    genreSelect.replaceChildren(...names.map((genre) => new Option(genre, genre)));
    genreSelect.value = selectedGenre;
    el("#genre-count").textContent = `${names.length} ${names.length === 1 ? "genre" : "genres"}`;
    const genreNav = el("#manage-genres");
    genreNav.replaceChildren();
    names.forEach((genre) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "manage-genre";
      button.setAttribute("aria-current", String(genre === selectedGenre));
      button.setAttribute("aria-label", `${genre}: ${stations[genre].length} stations`);
      const label = document.createElement("span");
      label.textContent = genre;
      const count = document.createElement("span");
      count.className = "genre-count";
      count.textContent = stations[genre].length;
      button.append(label, count);
      button.addEventListener("click", () => onSelectGenre(genre));
      genreNav.append(button);
    });

    const hasGenre = selectedGenre in stations;
    const allStations = hasGenre ? stations[selectedGenre] : [];
    const entries = allStations.map((station, index) => ({ station, index }))
      .filter(({ station }) => !query || station.name.toLocaleLowerCase().includes(query));
    el("#stations-heading").textContent = hasGenre ? selectedGenre : "Choose a genre";
    el("#rename-form").hidden = !hasGenre;
    el("#rename-genre").value = hasGenre ? selectedGenre : "";
    el("#managed-station-filter-wrap").hidden = !hasGenre;
    el("#station-count").textContent = hasGenre ? query ? `${entries.length} of ${allStations.length} stations` : `${allStations.length} stations` : "";
    el("#add-station-genre").textContent = hasGenre ? `Adding to ${selectedGenre}` : "Select a genre first";
    el("#station-genre-label").textContent = selectedGenre;
    el("#add-station").disabled = !hasGenre;
    el("#station-form").hidden = !hasGenre;
    el("#genre-detail").classList.toggle("is-empty", !hasGenre);
    el("#delete-genre").disabled = !hasGenre;
    el("#genre-delete-hint").textContent = hasGenre
      ? `Deleting “${selectedGenre}” also deletes ${allStations.length} ${allStations.length === 1 ? "station" : "stations"}. This cannot be undone.`
      : "Select a genre to view its removal options.";

    const list = el("#station-list");
    list.replaceChildren();
    if (!hasGenre) { list.textContent = "Select a genre to view its stations."; return; }
    if (!entries.length) { list.textContent = query ? "No stations match your search." : "This genre has no stations yet."; return; }
    entries.forEach(({ station, index }) => { list.append(createStationRow(station, index, { onFavorite, onEdit, onTest, onDelete })); });
  }

  function createStationRow(station, index, { onFavorite, onEdit, onTest, onDelete }) {
    const row = document.createElement("article");
    row.className = "managed-station";
    row.dataset.stationIndex = index;
    const details = document.createElement("div");
    details.className = "station-details";
    const logo = document.createElement("div");
    logo.className = "managed-station-logo";
    logo.setAttribute("aria-hidden", "true");
    const fallback = document.createElement("span");
    fallback.textContent = station.name.trim().slice(0, 1).toLocaleUpperCase() || "M";
    logo.append(fallback);
    if (station.image) {
      const image = document.createElement("img");
      image.className = "station-logo";
      image.src = station.image;
      image.alt = "";
      image.addEventListener("error", () => image.remove());
      logo.append(image);
    }
    const name = document.createElement("strong");
    name.textContent = station.name;
    const stream = document.createElement("span");
    stream.className = "managed-station-url";
    stream.textContent = station.url;
    const metadata = document.createElement("small");
    metadata.textContent = `${(station.type || "mp3").toUpperCase()}${station.bitrate ? ` · ${station.bitrate} kbps` : ""} · Speech volume ${station.speechVolumePercent ?? 30}%`;
    details.append(logo, name, stream, metadata);

    const actions = document.createElement("div");
    actions.className = "actions";
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "favorite-toggle";
    favorite.textContent = station.favorite === true ? "★ Favorite" : "☆ Favorite";
    favorite.setAttribute("aria-label", `${station.favorite === true ? "Remove" : "Add"} ${station.name} ${station.favorite === true ? "from" : "to"} favorites`);
    favorite.setAttribute("aria-pressed", String(station.favorite === true));
    favorite.addEventListener("click", () => onFavorite(index, station, favorite));
    const test = document.createElement("button");
    test.type = "button";
    test.textContent = "Test";
    test.setAttribute("aria-expanded", "false");
    test.addEventListener("click", () => onTest(station, test, row));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => onEdit(index));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => onDelete(index, station.name));
    actions.append(favorite, test, edit, remove);
    const preview = document.createElement("audio");
    preview.controls = true;
    preview.preload = "none";
    preview.hidden = true;
    preview.setAttribute("aria-label", `Test ${station.name} stream`);
    const status = document.createElement("span");
    status.dataset.previewStatus = "true";
    status.className = "station-preview-status";
    status.setAttribute("role", "status");
    row.append(details, actions, preview, status);
    return row;
  }

  return Object.freeze({ render });
}
