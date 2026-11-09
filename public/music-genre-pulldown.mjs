export function wireMusicGenrePulldown({ el, emptyRow, resultRow }) {
  async function load(force = false) {
    const list = el("#genre-list");
    if (!force && list.dataset.loaded === "true") return;
    list.replaceChildren(emptyRow("Loading genres…"));
    try {
      const response = await fetch(`/api/music/search?q=&type=genre&t=${Date.now()}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Genres are unavailable.");
      list.replaceChildren();
      if (!result.results.length) {
        list.append(emptyRow("No genres found."));
        return;
      }
      for (const genre of result.results) list.append(resultRow(genre));
      list.dataset.loaded = "true";
    } catch (error) {
      list.replaceChildren(emptyRow(error.message));
    }
  }

  el("#genre-pulldown")?.addEventListener("toggle", (event) => {
    if (event.target.open) load();
  });
}
