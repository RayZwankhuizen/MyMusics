import { createManageCatalogView } from "./manage-catalog-view.mjs";

export function createManageCatalog({ el, request, notice, stationImages, streamFinder, stationPreview }) {
  let stations = {};
  let selectedGenre = "";
  const route = (genre, suffix = "") => `/api/genres/${encodeURIComponent(genre)}${suffix}`;
  const genres = () => Object.keys(stations);

  const view = createManageCatalogView({ el });
  const render = () => {
    stationPreview.stop();
    return view.render({
    stations,
    selectedGenre,
    query: el("#managed-station-filter").value.trim().toLocaleLowerCase(),
    onSelectGenre: (genre) => {
      selectedGenre = genre;
      resetForm();
      render();
      el('#manage-genres [aria-current="true"]')?.focus();
    },
    onFavorite: async (index, station, button) => {
      button.disabled = true;
      try {
        stations = await request(`${route(selectedGenre)}/stations/${index}/favorite`, "PATCH", { favorite: station.favorite !== true });
        notice(station.favorite === true ? `${station.name} removed from Favorites.` : `${station.name} added to Favorites.`);
        render();
      } catch (error) { button.disabled = false; notice(error.message, true); }
    },
    onEdit: editStation,
    onTest: stationPreview.play,
    onDelete: deleteStation
    });
  };

  function resetForm() {
    el("#station-dialog").close();
    el("#station-form-error").hidden = true;
    streamFinder.reset();
    el("#station-form").reset();
    stationImages.reset();
    el("#station-index").value = "";
    el("#add-station-heading").textContent = "Add a station";
    el("#station-form .save-button").textContent = "Add station";
    el("#station-genre").value = selectedGenre;
    el("#station-genre").hidden = true;
    el("#station-genre-edit-label").hidden = true;
    el("#station-genre-label").hidden = false;
    el("#cancel-edit").hidden = false;
  }

  function editStation(index) {
    resetForm();
    const station = stations[selectedGenre][index];
    el("#station-index").value = index;
    el("#station-name").value = station.name;
    el("#station-genre").value = selectedGenre;
    el("#station-website").value = station.website || "";
    el("#station-url").value = station.url;
    el("#station-type").value = station.type || "mp3";
    el("#speech-volume-percent").value = station.speechVolumePercent ?? 30;
    stationImages.edit(station.image);
    el("#add-station-heading").textContent = `Edit ${station.name}`;
    el("#station-form .save-button").textContent = "Save changes";
    el("#station-genre").hidden = false;
    el("#station-genre-edit-label").hidden = false;
    el("#station-genre-label").hidden = true;
    el("#cancel-edit").hidden = false;
    el("#station-dialog").showModal();
    el("#station-name").focus({ preventScroll: true });
  }

  async function refresh() {
    stations = await request("/stations");
    if (!(selectedGenre in stations)) selectedGenre = genres()[0] || "";
    render();
  }

  el("#new-genre-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = el("#new-genre").value.trim();
    try {
      stations = await request("/api/genres", "POST", { name });
      selectedGenre = name;
      event.target.reset();
      notice(`Genre “${name}” added.`);
      render();
      el(`#manage-genres [aria-current="true"]`)?.focus();
    } catch (error) { notice(error.message, true); }
  });

  el("#rename-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = el("#rename-genre").value.trim();
    try {
      stations = await request(route(selectedGenre), "PUT", { name });
      selectedGenre = name;
      notice(`Genre renamed to “${name}”.`);
      render();
      el(`#manage-genres [aria-current="true"]`)?.focus();
    } catch (error) { notice(error.message, true); }
  });

  el("#delete-genre").addEventListener("click", () => {
    if (!(selectedGenre in stations)) return;
    el("#genre-delete-description").textContent = `This will permanently delete “${selectedGenre}” and its ${stations[selectedGenre].length} stations.`;
    el("#genre-delete-confirm-name").value = "";
    el("#genre-delete-confirm").disabled = true;
    el("#genre-delete-dialog").showModal();
    el("#genre-delete-cancel").focus();
  });
  el("#genre-delete-confirm-name").addEventListener("input", (event) => {
    el("#genre-delete-confirm").disabled = event.target.value.trim() !== selectedGenre;
  });
  el("#genre-delete-cancel").addEventListener("click", () => el("#genre-delete-dialog").close());
  el("#genre-delete-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (el("#genre-delete-confirm-name").value.trim() !== selectedGenre) return;
    const name = selectedGenre;
    el("#genre-delete-confirm").disabled = true;
    try {
      stations = await request(route(name), "DELETE");
      selectedGenre = genres()[0] || "";
      el("#genre-delete-dialog").close();
      notice(`Genre “${name}” deleted.`);
      resetForm();
      render();
    } catch (error) { el("#genre-delete-confirm").disabled = false; notice(error.message, true); }
  });

  el("#managed-station-filter").addEventListener("input", render);
  el("#station-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    el("#station-form-error").hidden = true;
    const index = el("#station-index").value;
    let url = el("#station-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const body = {
      name: el("#station-name").value.trim(), url,
      website: el("#station-website").value.trim(),
      type: el("#station-type").value,
      speechVolumePercent: Number(el("#speech-volume-percent").value),
      genre: index === "" ? selectedGenre : el("#station-genre").value,
      image: stationImages.image()
    };
    const sourceGenre = selectedGenre;
    const destinationGenre = body.genre;
    const suffix = `/stations${index === "" ? "" : `/${index}`}`;
    const submit = el("#station-form .save-button");
    submit.disabled = true;
    try {
      const file = el("#station-image").files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP logo up to 2 MB.");
        body.image = await stationImages.uploadFile(file);
      }
      stations = await request(route(index === "" ? destinationGenre : sourceGenre, suffix), index === "" ? "POST" : "PUT", body);
      selectedGenre = destinationGenre;
      notice(index === "" ? "Station added." : "Station updated.");
      resetForm();
      render();
      const row = sourceGenre === destinationGenre && index !== "" ? el(`#station-list [data-station-index="${Number(index)}"]`) : null;
      (row?.querySelector(".actions button:nth-child(3)") || el("#add-station")).focus({ preventScroll: true });
    } catch (error) {
      el("#station-form-error").textContent = error.message;
      el("#station-form-error").hidden = false;
    }
    finally { submit.disabled = false; }
  });

  el("#add-station").addEventListener("click", () => {
    resetForm();
    el("#station-dialog").showModal();
    el("#station-name").focus({ preventScroll: true });
  });
  el("#cancel-edit").addEventListener("click", resetForm);
  el("#close-station-dialog").addEventListener("click", resetForm);
  el("#station-dialog").addEventListener("cancel", (event) => { event.preventDefault(); resetForm(); });
  el("#station-dialog").addEventListener("close", () => streamFinder.reset());

  async function deleteStation(index, name) {
    if (!confirm(`Delete “${name}”?`)) return;
    try {
      stations = await request(route(selectedGenre, `/stations/${index}`), "DELETE");
      notice(`“${name}” deleted.`);
      render();
    } catch (error) { notice(error.message, true); }
  }

  return Object.freeze({ route, getStations: () => stations, setStations: (value) => { stations = value; }, render, refresh });
}
