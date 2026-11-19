export function wireStationSearch({ el, request, getStations, openAddStation }) {
  const results = el("#station-search-results");

  function updateAddedStations() {
    const genresByUrl = new Map();
    for (const [genre, stations] of Object.entries(getStations())) {
      for (const station of stations) {
        const url = station.url.toLowerCase();
        if (!genresByUrl.has(url)) genresByUrl.set(url, genre);
      }
    }
    results.querySelectorAll("[data-station-url]").forEach((button) => {
      const genre = genresByUrl.get(button.dataset.stationUrl);
      button.disabled = Boolean(genre);
      button.textContent = genre ? `In ${genre}` : "Add station";
    });
  }

  el("#station-dialog").addEventListener("close", updateAddedStations);
  el("#station-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const countrycode = String(form.get("countrycode")).trim().toUpperCase();
    const enteredTag = String(form.get("tag")).trim();
    const tag = /^(?:all|\*)$/i.test(enteredTag) ? "" : enteredTag;
    if (!countrycode && !tag) { results.textContent = "Enter a country code or a music tag."; return; }
    results.textContent = "Searching…";
    try {
      const query = new URLSearchParams({ countrycode, tag });
      const found = await request(`/api/station-search?${query}`);
      results.replaceChildren();
      if (!found.length) { results.textContent = "No stations found."; return; }
      for (const station of found) {
        const row = document.createElement("article");
        row.className = "search-result";
        const details = document.createElement("span");
        details.textContent = [station.name, station.country, station.tags].filter(Boolean).join(" · ");
        const add = document.createElement("button");
        add.type = "button";
        add.className = "small-button";
        add.dataset.stationUrl = station.url.toLowerCase();
        add.addEventListener("click", () => {
          updateAddedStations();
          if (!add.disabled) openAddStation(station);
        });
        row.append(details, add);
        results.append(row);
      }
      updateAddedStations();
    } catch (error) { results.textContent = error.message; }
  });
}
