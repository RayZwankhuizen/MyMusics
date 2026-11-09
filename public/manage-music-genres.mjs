export function wireManageMusicGenres({ el, request }) {
  const list = el("#music-genre-list");
  const status = el("#music-genre-status");
  let loaded = false;
  let loading = false;

  async function save(source, displayName) {
    try {
      await request(`/api/music/genres/${encodeURIComponent(source)}`, "PUT", { displayName });
      await load(`Saved “${source}” as “${displayName.trim()}”. Matching labels are combined in Music search.`, source);
    } catch (error) { status.textContent = error.message; }
  }

  async function reset(source) {
    try {
      await request(`/api/music/genres/${encodeURIComponent(source)}`, "DELETE");
      await load(`Restored “${source}”.`, source);
    } catch (error) { status.textContent = error.message; }
  }

  async function load(message = "", focusSource = "") {
    if (loading) return;
    loading = true;
    loaded = false;
    status.textContent = "Loading Jellyfin genres…";
    list.replaceChildren();
    try {
      const result = await request("/api/music/genres");
      for (const genre of result.genres) {
        const row = document.createElement("article");
        row.className = "music-genre-row";
        row.dataset.sourceName = genre.sourceName;
        const details = document.createElement("div");
        details.className = "station-details";
        const title = document.createElement("strong");
        title.textContent = genre.sourceName;
        const kind = document.createElement("span");
        kind.textContent = "Jellyfin label";
        details.append(title, kind);
        const form = document.createElement("form");
        form.className = "music-genre-edit";
        const label = document.createElement("label");
        label.textContent = "Show as";
        const input = document.createElement("input");
        input.value = genre.displayName;
        input.maxLength = 80;
        input.setAttribute("aria-label", `Display name for ${genre.sourceName}`);
        input.required = true;
        label.append(input);
        const saveButton = document.createElement("button");
        saveButton.className = "station-edit-button";
        saveButton.textContent = "Save";
        const resetButton = document.createElement("button");
        resetButton.className = "station-edit-button";
        resetButton.type = "button";
        resetButton.textContent = "Reset";
        resetButton.hidden = genre.displayName === genre.sourceName;
        resetButton.addEventListener("click", () => void reset(genre.sourceName));
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void save(genre.sourceName, input.value);
        });
        form.append(label, saveButton, resetButton);
        row.append(details, form);
        list.append(row);
      }
      status.textContent = message || (result.genres.length
        ? `${result.genres.length} Jellyfin genres loaded. Set the same display name on labels you want grouped together.`
        : "No Jellyfin genres found.");
      if (focusSource) [...list.querySelectorAll(".music-genre-row")].find((row) => row.dataset.sourceName === focusSource)?.querySelector("input")?.focus();
      loaded = true;
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; }
  }

  document.querySelector('[data-manage-section="music-genres"]')?.addEventListener("click", () => {
    if (!loaded) void load();
  });
  void load();
}
