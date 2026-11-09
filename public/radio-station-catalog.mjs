export function createRadioStationCatalog({ onChange, onFavoriteStatus }) {
  let stations = {};
  let activeGenre = "";
  let showingFavorites = false;

  function setStations(value) { stations = value; }

  function chooseGenre(genre) {
    showingFavorites = false;
    activeGenre = genre;
    onChange();
  }

  function chooseFavorites() {
    showingFavorites = true;
    onChange();
  }

  async function load() {
    const response = await fetch("/stations", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load stations (HTTP ${response.status})`);
    stations = await response.json();
    return stations;
  }

  async function toggleFavorite(genre, index, favorite) {
    const response = await fetch(`/api/genres/${encodeURIComponent(genre)}/stations/${index}/favorite`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update favorite.");
    stations = result;
    onChange();
    onFavoriteStatus(favorite ? "Added to Favorites." : "Removed from Favorites.");
  }

  return Object.freeze({
    load,
    chooseGenre,
    chooseFavorites,
    toggleFavorite,
    setStations,
    get stations() { return stations; },
    get activeGenre() { return activeGenre; },
    get showingFavorites() { return showingFavorites; }
  });
}
