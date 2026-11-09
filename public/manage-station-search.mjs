export function wireStationSearch({ el, request, route, getStations, setStations, render, notice }) {
  el("#station-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const countrycode = String(form.get("countrycode")).trim().toUpperCase();
    const enteredTag = String(form.get("tag")).trim();
    const tag = /^(?:all|\*)$/i.test(enteredTag) ? "" : enteredTag;
    const results = el("#station-search-results");
    if (!countrycode && !tag) { results.textContent = "Enter a country code or a music tag."; return; }
    results.textContent = "Searching…";
    try {
      const query = new URLSearchParams({ countrycode, tag });
      const found = await request(`/api/station-search?${query}`);
      results.replaceChildren();
      if (!found.length) { results.textContent = "No stations found."; return; }
      const normalize = (value) => value.toLowerCase().replace(/[\s_-]+/g, "");
      const styleGenre = tag ? tag.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "All";
      const proposedGenre = countrycode ? `${countrycode} - ${styleGenre}` : styleGenre;
      const stations = getStations();
      const genres = Object.keys(stations);
      const targetGenre = genres.find((genre) => normalize(genre) === normalize(proposedGenre))
        || (tag && genres.find((genre) => {
          const match = genre.match(/^([a-z]{2})\s*[-–]\s*(.+)$/i);
          return match && match[1].toUpperCase() === countrycode && tag.toLowerCase().split(/[\s,]+/).includes(match[2].toLowerCase());
        })) || proposedGenre;
      const existing = new Set(Object.values(stations).flat().map((station) => station.url.toLowerCase()));
      found.forEach((station) => {
        const row = document.createElement("article"); row.className = "search-result";
        const details = document.createElement("span"); details.textContent = `${station.name} · ${station.country || ""}${station.tags ? ` · ${station.tags}` : ""}`;
        const add = document.createElement("button"); add.type = "button"; add.className = "small-button";
        const duplicate = existing.has(station.url.toLowerCase()); add.disabled = duplicate; add.textContent = duplicate ? "Added" : `Add to ${targetGenre}`;
        add.addEventListener("click", async () => {
          try {
            if (!(targetGenre in getStations())) setStations(await request("/api/genres", "POST", { name: targetGenre }));
            setStations(await request(route(targetGenre, "/stations"), "POST", { name: station.name, url: station.url, type: station.type, website: station.website, speechVolumePercent: 30 }));
            existing.add(station.url.toLowerCase()); add.disabled = true; add.textContent = "Added"; render(); notice(`${station.name} added to ${targetGenre}.`);
          }
          catch (error) { notice(error.message, true); }
        });
        row.append(details, add); results.append(row);
      });
    } catch (error) { results.textContent = error.message; }
  });
}
