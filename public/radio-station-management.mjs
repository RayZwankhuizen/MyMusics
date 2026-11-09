export function createRadioStationManagement({ getStations, setStations, getActiveStation, getActiveGenre, setActiveStation, playStation, renderGenres, renderStations }) {
  const dialog = document.querySelector("#station-edit-dialog");
  const nameInput = document.querySelector("#station-edit-name");
  const urlInput = document.querySelector("#station-edit-url");
  const typeInput = document.querySelector("#station-edit-type");
  const genreInput = document.querySelector("#station-edit-genre");
  const message = document.querySelector("#station-edit-message");
  let editing = null;

  async function request(genre, index, method, body) {
    const response = await fetch(`/api/genres/${encodeURIComponent(genre)}/stations/${index}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Station update failed.");
    return result;
  }

  function open(genre, index) {
    const station = getStations()[genre]?.[index];
    if (!station) return;
    editing = { genre, index, url: station.url };
    nameInput.value = station.name;
    urlInput.value = station.url;
    typeInput.value = station.type || "mp3";
    genreInput.replaceChildren(...Object.keys(getStations()).map((name) => new Option(name, name)));
    genreInput.value = genre;
    message.textContent = "";
    dialog.showModal();
    nameInput.focus();
  }

  function refreshStations() {
    renderGenres();
    renderStations();
  }

  document.querySelector("#station-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editing) return;
    const { genre, index } = editing;
    const station = getStations()[genre]?.[index];
    if (!station) return;
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const type = typeInput.value;
    const targetGenre = genreInput.value;
    try {
      const updated = await request(genre, index, "PUT", { ...station, name, url, type, genre: targetGenre });
      setStations(updated);
      if (getActiveGenre() === genre && getActiveStation()?.url === editing.url) {
        const activeStation = getStations()[targetGenre].find((item) => item.url === url && item.name === name) || getActiveStation();
        setActiveStation(activeStation, targetGenre);
        document.querySelector("#now-heading").textContent = name;
        if (url !== editing.url || type !== station.type) playStation(activeStation, targetGenre);
      }
      refreshStations();
      dialog.close();
      document.querySelector("#favorite-status").textContent = `“${name}” saved.`;
    } catch (error) { message.textContent = error.message; }
  });

  document.querySelector("#station-edit-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { editing = null; });
  document.querySelector("#station-edit-delete").addEventListener("click", async () => {
    if (!editing) return;
    const { genre, index } = editing;
    const station = getStations()[genre]?.[index];
    if (!station || !confirm(`Delete “${station.name}”? This cannot be undone.`)) return;
    try {
      const updated = await request(genre, index, "DELETE");
      setStations(updated);
      refreshStations();
      dialog.close();
      document.querySelector("#favorite-status").textContent = `“${station.name}” deleted.`;
    } catch (error) { message.textContent = error.message; }
  });

  return Object.freeze({ open });
}
