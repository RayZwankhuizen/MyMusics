export function wireMusicAutoDj({ el, state, fillQueue, renderQueue, setStatus }) {
  const button = el("#autodj-toggle");
  const dialog = el("#autodj-dialog");
  if (!button || !dialog) return;
  const description = el("#autodj-description");
  const sourcePicker = el("#autodj-source-picker");
  const sourceKind = el("#autodj-source-kind");
  const sourceQuery = el("#autodj-source-query");
  const sourceStatus = el("#autodj-source-status");
  const sourceResults = el("#autodj-source-results");
  const currentOptions = el("#autodj-current-options");
  let selectedTrack = null;
  let currentTrack = null;
  let selectedSource = null;
  let sourceSearch = 0;
  let sourceSelection = 0;

  currentOptions.addEventListener("change", (event) => {
    if (!event.target.matches('[name="autodj-mode"]')) return;
    selectedTrack = currentTrack;
    selectedSource = null;
    el("#autodj-start").disabled = false;
  });

  function renderButton() {
    button.setAttribute("aria-pressed", String(Boolean(state.autoDj)));
    button.setAttribute("aria-expanded", String(dialog.open));
    const mode = state.autoDj?.label
      ? `${state.autoDj.label[0].toUpperCase()}${state.autoDj.label.slice(1)}`
      : state.autoDj?.mode ? `${state.autoDj.mode[0].toUpperCase()}${state.autoDj.mode.slice(1)}` : "Mix";
    button.textContent = state.autoDj ? `AutoDJ: ${mode}` : "AutoDJ: OFF";
  }

  async function searchSources() {
    const request = ++sourceSearch;
    const type = sourceKind.value;
    const query = sourceQuery.value.trim();
    sourceResults.replaceChildren();
    sourceStatus.textContent = "Searching…";
    try {
      const params = new URLSearchParams({ q: query, type });
      const response = await fetch(`/api/music/search?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Search is unavailable.");
      if (request !== sourceSearch) return;
      const items = Array.isArray(result.results) ? result.results.slice(0, 100) : [];
      sourceStatus.textContent = items.length ? `${items.length} choices` : "No matches. Try another search.";
      for (const item of items) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "autodj-source-choice";
        choice.textContent = item.title || item.name || "Untitled";
        choice.addEventListener("click", () => { void chooseSource(item); });
        sourceResults.append(choice);
      }
    } catch (error) {
      if (request === sourceSearch) sourceStatus.textContent = error.message || "Search failed.";
    }
  }

  async function chooseSource(item) {
    const request = ++sourceSelection;
    selectedTrack = null;
    selectedSource = null;
    el("#autodj-start").disabled = true;
    sourceStatus.textContent = `Loading ${item.title || item.name}…`;
    try {
      const params = new URLSearchParams({ kind: item.kind, id: item.id });
      const response = await fetch(`/api/music/info?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this choice.");
      if (request !== sourceSelection) return;
      const info = result.info || {};
      const tracks = Array.isArray(info.tracks) ? info.tracks.filter((track) => track?.id) : [];
      if (!tracks.length) throw new Error(`No playable tracks found for ${item.title || item.name}.`);
      const seed = { ...tracks[0] };
      if (item.kind === "genre") seed.genre = item.title;
      if (item.kind === "artist") seed.artistId ||= item.id;
      if (item.kind === "album") seed.albumId ||= item.id;
      selectedSource = { kind: item.kind, title: item.title || item.name, tracks, seed };
      sourceStatus.textContent = `Selected ${selectedSource.title} · ${tracks.length} tracks`;
      el("#autodj-start").disabled = false;
    } catch (error) {
      if (request === sourceSelection) sourceStatus.textContent = error.message || "Could not load this choice.";
    }
  }

  dialog.addEventListener("close", renderButton);
  window.addEventListener("mymusics:autodj-state-change", renderButton);

  button.addEventListener("click", () => {
    if (state.autoDj) {
      state.autoDj = null;
      renderButton();
      setStatus("AUTODJ OFF · CURRENT QUEUE WILL FINISH");
      return;
    }
    const track = state.current;
    selectedSource = null;
    currentTrack = track?.id ? track : null;
    selectedTrack = currentTrack;
    sourcePicker.hidden = false;
    currentOptions.hidden = !selectedTrack;
    description.textContent = selectedTrack
      ? "Use the playing track or choose any genre, artist, album, or playlist from your library."
      : "Choose a genre, artist, album, or playlist as the starting point.";
    el("#autodj-start").disabled = !selectedTrack;
    if (selectedTrack) {
      let selected = false;
      for (const mode of ["artist", "album", "genre"]) {
        const option = dialog.querySelector(`[name="autodj-mode"][value="${mode}"]`);
        const label = dialog.querySelector(`[data-autodj-label="${mode}"]`);
        const value = mode === "artist" ? track.artist : mode === "album" ? track.album : track.genre;
        option.disabled = !value;
        option.checked = !selected && Boolean(value);
        selected ||= Boolean(value);
        label.textContent = value || `${mode[0].toUpperCase()}${mode.slice(1)} unavailable for this track`;
      }
      el("#autodj-start").disabled = !selected;
    }
    sourceStatus.textContent = "";
    sourceQuery.value = "";
    void searchSources();
    dialog.showModal();
    renderButton();
  });

  sourceKind.addEventListener("change", () => {
    selectedSource = null;
    el("#autodj-start").disabled = true;
    void searchSources();
  });
  el("#autodj-source-search-button").addEventListener("click", () => { void searchSources(); });
  sourceQuery.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void searchSources(); }
  });

  el("#autodj-close")?.addEventListener("click", () => dialog.close());
  el("#autodj-start")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (selectedTrack?.id) {
      const mode = dialog.querySelector('[name="autodj-mode"]:checked')?.value;
      if (!mode) return;
      state.autoDj = { mode, seed: selectedTrack };
    } else if (selectedSource) {
      const { kind, tracks, seed } = selectedSource;
      if (kind === "playlist") {
        const queued = new Set(state.queue.map((track) => track.id));
        state.queue = [...tracks.filter((track) => !queued.has(track.id) && queued.add(track.id)), ...state.queue];
        renderQueue();
      }
      state.autoDj = { mode: kind === "playlist" ? "" : kind, label: kind, seed };
    } else return;
    renderButton();
    dialog.close();
    setStatus(`AUTODJ · LOADING ${state.autoDj.label || state.autoDj.mode.toUpperCase()} TRACKS`);
    void fillQueue(true);
  });

  dialog.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
  renderButton();
}
