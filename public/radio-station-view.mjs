export function createRadioStationView({ genreNav, stationList, searchInput, favoriteStatus, getStations, onChooseGenre, onChooseFavorites, onPlay, onEdit, onToggleFavorite }) {
  let editMode = false;
  let lastStationView = null;

  document.querySelector("#radio-search-open").addEventListener("click", () => {
    document.querySelector("#radio-search-dialog").showModal();
    searchInput.focus();
  });
  document.querySelector("#radio-search-close").addEventListener("click", () => document.querySelector("#radio-search-dialog").close());
  document.querySelector("#radio-search-form").addEventListener("submit", (event) => event.preventDefault());
  searchInput.addEventListener("input", () => renderSearch(getStations()));

  function renderGenres(stationsByGenre, activeGenre, showingFavorites) {
    genreNav.replaceChildren();
    const favoritesCount = Object.values(stationsByGenre).flat().filter((station) => station.favorite === true).length;
    const addButton = (name, count, onClick, selected, favoriteView = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = selected ? "selected" : "";
      if (favoriteView) button.dataset.favorites = "true";
      else button.dataset.genre = name;
      const label = document.createElement("span");
      label.textContent = name;
      const badge = document.createElement("span");
      badge.className = "genre-count";
      badge.textContent = count;
      button.setAttribute("aria-label", `${name}: ${count} stations`);
      button.setAttribute("aria-current", selected ? "page" : "false");
      button.append(label, badge);
      button.addEventListener("click", onClick);
      genreNav.append(button);
    };
    addButton("Favorites", favoritesCount, onChooseFavorites, showingFavorites, true);
    for (const genre of Object.keys(stationsByGenre)) {
      addButton(genre, stationsByGenre[genre].length, () => onChooseGenre(genre), !showingFavorites && activeGenre === genre);
    }
  }

  function renderStations(stationsByGenre, activeGenre, showingFavorites, activeStation) {
    lastStationView = { stationsByGenre, activeGenre, showingFavorites, activeStation };
    const entries = showingFavorites
      ? Object.entries(stationsByGenre).flatMap(([genre, stations]) => stations.flatMap((station, index) => station.favorite === true ? [{ station, genre, index }] : []))
      : (stationsByGenre[activeGenre] || []).map((station, index) => ({ station, genre: activeGenre, index }));
    stationList.replaceChildren();
    document.querySelector("#station-count").textContent = `${String(entries.length).padStart(2, "0")} STATIONS`;
    if (showingFavorites && !entries.length) {
      stationList.textContent = "No favorite stations yet. Add one with the star beside any station.";
      return;
    }
    entries.forEach(({ station, genre, index }) => {
      const row = document.createElement("article");
      row.className = "station-row";
      const details = document.createElement("div");
      details.className = "station-details";
      if (station.image) {
        const logo = document.createElement("img");
        logo.className = "station-logo";
        logo.src = station.image;
        logo.alt = "";
        details.append(logo);
      }
      const viewport = document.createElement("span");
      viewport.className = "station-name-viewport";
      const name = document.createElement("strong");
      name.className = "station-name";
      name.textContent = station.name;
      viewport.append(name);
      const meta = document.createElement("span");
      meta.textContent = (station.type || "mp3").toUpperCase();
      details.append(viewport, meta);

      const play = document.createElement("button");
      play.className = "play-button";
      play.type = "button";
      play.setAttribute("aria-label", `Play ${station.name}`);
      play.setAttribute("aria-pressed", String(activeStation?.url === station.url));
      play.textContent = "▶";
      play.addEventListener("click", () => onPlay(station, genre));

      const favorite = document.createElement("button");
      favorite.className = "favorite-button";
      favorite.type = "button";
      favorite.textContent = station.favorite === true ? "★" : "☆";
      favorite.setAttribute("aria-label", `${station.favorite === true ? "Remove" : "Add"} ${station.name} ${station.favorite === true ? "from" : "to"} favorites`);
      favorite.setAttribute("aria-pressed", String(station.favorite === true));
      favorite.addEventListener("click", async () => {
        favorite.disabled = true;
        try { await onToggleFavorite(genre, index, station.favorite !== true); }
        catch { favorite.disabled = false; favoriteStatus.textContent = "Could not update Favorites. Please try again."; }
      });

      const edit = document.createElement("button");
      edit.className = "station-edit-button";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", `Edit ${station.name}`);
      edit.hidden = !editMode;
      edit.addEventListener("click", () => onEdit(genre, index));
      const actions = document.createElement("div");
      actions.className = "station-actions";
      actions.append(edit, favorite, play);
      row.append(details, actions);
      stationList.append(row);
      requestAnimationFrame(() => {
        const distance = name.scrollWidth - viewport.clientWidth;
        if (distance > 2) {
          viewport.classList.add("is-overflowing");
          viewport.style.setProperty("--scroll-distance", `${distance}px`);
          viewport.style.setProperty("--scroll-duration", `${Math.max(5, distance / 14)}s`);
        }
      });
    });
  }

  document.querySelector("#edit-stations-toggle").addEventListener("click", (event) => {
    editMode = !editMode;
    event.currentTarget.textContent = editMode ? "Done" : "Edit";
    event.currentTarget.setAttribute("aria-pressed", String(editMode));
    if (lastStationView) renderStations(lastStationView.stationsByGenre, lastStationView.activeGenre, lastStationView.showingFavorites, lastStationView.activeStation);
    favoriteStatus.textContent = editMode
      ? "Editing stations: choose Edit beside a station to change it."
      : "Station editing closed.";
  });

  function renderSearch(stationsByGenre) {
    const results = document.querySelector("#radio-search-results");
    const query = searchInput.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    if (query.length < 2) {
      results.append(Object.assign(document.createElement("p"), { textContent: "Enter at least two characters to search." }));
      return;
    }
    const matches = Object.entries(stationsByGenre).flatMap(([genre, stations]) => stations
      .filter((station) => station.name.toLocaleLowerCase().includes(query))
      .map((station) => ({ station, genre }))).slice(0, 40);
    if (!matches.length) {
      results.append(Object.assign(document.createElement("p"), { textContent: "No stations match your search." }));
      return;
    }
    matches.forEach(({ station, genre }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "radio-search-result";
      if (station.image) {
        const logo = document.createElement("img");
        logo.src = station.image;
        logo.alt = "";
        button.append(logo);
      }
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = station.name;
      const meta = document.createElement("small");
      meta.textContent = `${genre} · ${(station.type || "mp3").toUpperCase()}`;
      details.append(name, meta);
      button.append(details);
      button.addEventListener("click", () => {
        document.querySelector("#radio-search-dialog").close();
        onPlay(station, genre);
      });
      results.append(button);
    });
  }

  return Object.freeze({ renderGenres, renderStations, renderSearch });
}
