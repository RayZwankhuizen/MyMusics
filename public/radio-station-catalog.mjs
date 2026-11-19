export function createRadioStationCatalog({ onChange, onFavoriteStatus }) {
  let stations = {};
  let activeGenre = "";
  let showingFavorites = false;
  let favoriteWrites = Promise.resolve();
  const favoritesViewKey = "mymusics:radio-favorites-view";

  function setStations(value) { stations = value; }

  function chooseGenre(genre) {
    showingFavorites = false;
    try { sessionStorage.removeItem(favoritesViewKey); } catch {}
    activeGenre = genre;
    onChange();
  }

  function chooseFavorites() {
    showingFavorites = true;
    try { sessionStorage.setItem(favoritesViewKey, "true"); } catch {}
    onChange();
  }

  function restoreView() {
    let favoritesSelected = false;
    try { favoritesSelected = sessionStorage.getItem(favoritesViewKey) === "true"; } catch {}
    if (favoritesSelected) chooseFavorites();
    else chooseGenre(Object.keys(stations)[0] || "");
  }

  async function load() {
    const response = await fetch("/stations", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load stations (HTTP ${response.status})`);
    stations = await response.json();
    return stations;
  }

  function toggleFavorite(genre, index, favorite) {
    const station = stations[genre]?.[index];
    if (!station) return Promise.reject(new Error("Station not found."));
    const pending = favoriteWrites.then(async () => {
      const currentIndex = stations[genre]?.findIndex(({ name, url }) => name === station.name && url === station.url) ?? -1;
      if (currentIndex < 0) throw new Error("Station not found. Refresh the station list and try again.");
      const response = await fetch(`/api/genres/${encodeURIComponent(genre)}/stations/${currentIndex}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite, name: station.name, url: station.url })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update favorite.");
      stations = result;
      onChange();
      onFavoriteStatus(favorite ? `${station.name} added to Favorites.` : `${station.name} removed from Favorites.`);
    });
    favoriteWrites = pending.catch(() => {});
    return pending;
  }

  return Object.freeze({
    load,
    restoreView,
    chooseGenre,
    chooseFavorites,
    toggleFavorite,
    setStations,
    get stations() { return stations; },
    get activeGenre() { return activeGenre; },
    get showingFavorites() { return showingFavorites; }
  });
}
