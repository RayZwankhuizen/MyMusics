export function wireManageAllStations({ el, catalog, request }) {
  const panel = el("#all-stations-cleanup");
  const filter = el("#all-stations-filter");
  const list = el("#all-stations-list");
  const status = el("#all-stations-status");

  function render() {
    const query = filter.value.trim().toLocaleLowerCase();
    const stations = Object.entries(catalog.getStations()).flatMap(([genre, items]) =>
      items.map((station, index) => ({ genre, station, index })))
      .filter(({ genre, station }) => !query || `${station.name} ${genre} ${station.url}`.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    for (const { genre, station, index } of stations) {
      const row = document.createElement("article");
      row.className = "all-station-row";
      const details = document.createElement("div");
      details.className = "all-station-details";
      const name = document.createElement("strong");
      name.textContent = station.name;
      const category = document.createElement("span");
      category.textContent = genre;
      const url = document.createElement("small");
      url.textContent = station.url;
      details.append(name, category, url);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!confirm(`Delete “${station.name}” from ${genre}?`)) return;
        remove.disabled = true;
        try {
          const updated = await request(`/api/genres/${encodeURIComponent(genre)}/stations/${index}`, "DELETE");
          catalog.setStations(updated);
          catalog.render();
          status.textContent = `Deleted “${station.name}” from ${genre}.`;
          render();
        } catch (error) {
          remove.disabled = false;
          status.textContent = error.message || `Could not delete “${station.name}”.`;
        }
      });
      row.append(details, remove);
      list.append(row);
    }
    if (!stations.length) list.textContent = query ? "No stations match this search." : "No stations found.";
  }

  filter.addEventListener("input", render);
  panel.addEventListener("toggle", () => { if (panel.open) render(); });
}
