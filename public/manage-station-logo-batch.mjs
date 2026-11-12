export function wireManageStationLogoBatch({ el, catalog, request, stationImages }) {
  const start = el("#fetch-station-logos");
  const cancel = el("#cancel-station-logo-batch");
  const replaceExisting = el("#replace-station-logos");
  const progress = el("#station-logo-batch-progress");
  const status = el("#station-logo-batch-status");
  const failures = el("#station-logo-batch-failures");
  let controller = null;

  function updateButton() {
    start.textContent = replaceExisting.checked ? "Fetch logos for all stations" : "Fetch missing logos";
  }

  replaceExisting.addEventListener("change", updateButton);
  cancel.addEventListener("click", () => {
    controller?.abort();
    status.textContent = "Stopping after the current station…";
  });
  start.addEventListener("click", async () => {
    const replace = replaceExisting.checked;
    const targets = Object.entries(catalog.getStations()).flatMap(([genre, stations]) =>
      stations.flatMap((station, index) => replace || !station.image ? [{ genre, station, index }] : []));
    failures.replaceChildren();
    if (!targets.length) {
      status.textContent = replace ? "No stations found." : "Every station already has a logo.";
      return;
    }

    controller = new AbortController();
    const { signal } = controller;
    let imported = 0;
    start.disabled = true;
    replaceExisting.disabled = true;
    cancel.hidden = false;
    progress.hidden = false;
    progress.max = targets.length;
    progress.value = 0;

    for (const [position, { genre, station, index }] of targets.entries()) {
      if (signal.aborted) break;
      status.textContent = `${position + 1} of ${targets.length} · ${station.name}`;
      try {
        const image = await stationImages.findAndUpload({ name: station.name, url: station.url, website: station.website || "" }, signal);
        const updated = await request(`/api/genres/${encodeURIComponent(genre)}/stations/${index}`, "PUT", { ...station, image });
        catalog.setStations(updated);
        imported++;
      } catch (error) {
        if (signal.aborted) break;
        const item = document.createElement("li");
        item.textContent = `${station.name}: ${error.message}`;
        failures.append(item);
      }
      progress.value = position + 1;
    }

    const stopped = signal.aborted;
    catalog.render();
    controller = null;
    start.disabled = false;
    replaceExisting.disabled = false;
    cancel.hidden = true;
    status.textContent = `${stopped ? "Stopped" : "Finished"}: ${imported} of ${targets.length} logos saved; ${failures.childElementCount} failed.`;
  });

  updateButton();
}
