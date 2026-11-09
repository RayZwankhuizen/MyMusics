const enumerableTypes = ["all", "artist", "genre", "playlist"];

export function createMusicSearch({ el, kindLabels, renderResults, fetchSearch }) {
  return async function search(term, type = el("#music-search-type").value) {
    const query = term.trim();
    // Empty input is meaningful for artists, genres, playlists and All, where the
    // library itself is the answer.
    if ((!query && !enumerableTypes.includes(type)) || query.length === 1) {
      el("#music-search-status").textContent = query.length === 1 ? "Enter at least two characters." : "Type something to search.";
      el("#music-results").replaceChildren();
      return;
    }
    el("#music-search-status").textContent = "Searching…";
    try {
      const response = await fetchSearch(`/api/music/search?${new URLSearchParams({ q: query, type })}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Search is unavailable.");
      // Accept both response shapes: a server process started before the typed
      // search shipped still answers with { tracks }.
      let results = [];
      if (Array.isArray(result.results)) results = result.results;
      else if (Array.isArray(result.tracks)) results = result.tracks;
      let scope;
      if (!query) {
        if (type === "playlist") scope = "playlists";
        else if (type === "genre") scope = "genres";
        else scope = "artists";
      } else if (result.type && result.type !== "all" && kindLabels[result.type]) {
        scope = `${kindLabels[result.type].toLowerCase()}s`;
      } else {
        scope = "everything";
      }
      el("#music-search-status").textContent = results.length
        ? `${results.length} result${results.length === 1 ? "" : "s"}${!query ? ` in ${scope}` : ""}`
        : "Nothing matched.";
      renderResults(results, query);
    } catch (error) {
      el("#music-search-status").textContent = error.message || "Search failed.";
      el("#music-results").replaceChildren();
    }
  };
}

export function wireMusicSearchEvents({ el, search }) {
  const searchCurrentInput = () => {
    const input = el("#music-search");
    if (input) search(input.value);
  };
  const searchEmptyInput = () => search("", el("#music-search-type")?.value || "all");
  const form = el("#music-search-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      searchCurrentInput();
    });
  }

  const type = el("#music-search-type");
  if (type) type.addEventListener("change", searchCurrentInput);

  const clearButton = el("#music-search-clear");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      const input = el("#music-search");
      if (!input) return;
      input.value = "";
      searchEmptyInput();
      input.focus();
    });
  }

  const input = el("#music-search");
  if (input) input.addEventListener("input", (event) => {
    if (!event.currentTarget.value) searchEmptyInput();
  });
}
