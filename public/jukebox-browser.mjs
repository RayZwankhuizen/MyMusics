export function createJukeboxRack({ state, searchTypes, el, empty, strip, genreCountSummary, resultDetails, openInfo, startRadio, queuePlaylist }) {
  function renderItem(item) {
    if (state.tab === "artists" || state.tab === "all") {
      const subtitle = item.albumCount ? `${item.albumCount} album${item.albumCount === 1 ? "" : "s"}` : "";
      return strip(item.title, subtitle, () => openInfo(item));
    }
    if (state.tab === "genres") return strip(item.title, genreCountSummary(item), () => openInfo(item));
    if (state.tab === "albums") {
      const subtitle = [item.artist, item.trackCount ? `${item.trackCount} tracks` : ""].filter(Boolean).join(" · ");
      return strip(item.title, subtitle, () => openInfo(item), item.art);
    }
    if (state.tab === "tracks") {
      const subtitle = resultDetails(item).filter((value) => value && value !== item.title).join(" · ");
      return strip(item.title, subtitle, () => startRadio(item), item.art);
    }
    const count = item.trackCount ?? 0;
    return strip(item.name, `${count} track${count === 1 ? "" : "s"}`, () => queuePlaylist(item, item.name));
  }

  function render() {
    const list = el("#jb-rack-list");
    if (!list) return;
    list.replaceChildren();
    const items = state.cache[state.tab];
    if (!items) {
      list.append(empty("Loading…"));
      return;
    }
    if (!items.length) {
      list.append(empty(state.tab === "playlists" ? "No playlists yet. Create one on the music page." : "Nothing to choose from here."));
      return;
    }
    items.forEach((item) => list.append(renderItem(item)));
  }

  async function fetchItems(tab) {
    const playlists = tab === "playlists";
    const url = playlists
      ? `/api/music/playlists?t=${Date.now()}`
      : `/api/music/search?${new URLSearchParams({ q: "", type: searchTypes[tab] || "genre", t: Date.now().toString() })}`;
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || (playlists ? "Playlists are unavailable." : "The library is unavailable."));
    const items = playlists ? result.playlists : result.results;
    return Array.isArray(items) ? items : [];
  }

  async function load(tab, force = false) {
    if (tab === "queue") return;
    if (tab === "tracks") {
      el("#jb-rack-list").replaceChildren(empty("Enter a track title above to search."));
      return;
    }
    if (!force && state.cache[tab]) return;
    try { state.cache[tab] = await fetchItems(tab); }
    catch (error) {
      state.cache[tab] = [];
      el("#jb-rack-list").replaceChildren(empty(error.message));
      return;
    }
    if (state.tab === tab) render();
  }

  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll("#jb-search-dialog .jb-tab").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.rack === tab));
    });
    const query = el("#jb-search")?.value.trim();
    if (query?.length >= 2) {
      el("#jb-search-btn")?.click();
      return;
    }
    render();
    void load(tab);
    const label = el(`#jb-search-dialog .jb-tab[data-rack="${tab}"]`)?.textContent.toLowerCase() || "music";
    const feedback = el("#jb-search-feedback");
    if (feedback) feedback.textContent = tab === "albums" ? "Enter an album title above to search." : `Browse ${label}, or enter at least two characters to search.`;
  }

  return Object.freeze({ render, load, selectTab });
}
function buildJukeboxTvKeyboard(keyboard, searchButton) {
  if (!keyboard || !searchButton) return;
  const searchKeys = document.createDocumentFragment();
  for (const key of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jb-tv-key";
    button.dataset.searchKey = key.toLowerCase();
    button.textContent = key;
    searchKeys.append(button);
  }
  keyboard.prepend(searchKeys);
  for (const [key, label, className] of [["delete", "Delete", "jb-tv-key jb-tv-key-delete"], ["space", "Space", "jb-tv-key jb-tv-key-space"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.searchKey = key;
    button.textContent = label;
    keyboard.insertBefore(button, searchButton);
  }
}

function wireJukeboxTvKeyboard(input, dialog) {
  for (const keyButton of document.querySelectorAll("#jb-tv-keyboard [data-search-key]")) {
    keyButton.addEventListener("click", () => {
      const key = keyButton.dataset.searchKey;
      if (key === "go") return;
      if (key === "delete") input.value = input.value.slice(0, -1);
      else if (key === "space") input.value += " ";
      else input.value += key.toLowerCase();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  document.addEventListener("keydown", (event) => {
    if (!dialog?.open || event.target === input || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[a-z0-9]$/i.test(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      input.value += event.key.toLowerCase();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, true);
}

export function createJukeboxSearch({ state, searchTypes, el, empty, strip, textButton, genreCountSummary, openInfo, enqueueTrack, addTrackToPlaylist, addAlbumToQueue, markAdded, queuePlaylist, selectTab }) {
  function appendResult(item, list, feedback) {
    switch (item.kind) {
      case "track": {
        let button;
        const subtitle = ["TRACK", item.artist, item.album].filter(Boolean).join(" · ");
        button = strip(item.title, subtitle, () => {
          if (enqueueTrack(item)) {
            markAdded(button);
            feedback.textContent = `Added “${item.title}” to the queue. Choose another track or close Search.`;
          }
        }, item.art);
        const row = document.createElement("div");
        row.className = "jb-search-result jb-search-result-track";
        row.append(button, textButton("Add to playlist", () => addTrackToPlaylist(item), `Add ${item.title} to a playlist`));
        list.append(row);
        return;
      }
      case "album": {
        const row = document.createElement("div");
        row.className = "jb-search-result jb-search-result-album";
        const browse = strip(item.title, `ALBUM · ${item.artist || "Unknown artist"} · Browse album`, () => openInfo(item, { browseOnly: true }), item.art);
        browse.setAttribute("aria-label", `Browse album “${item.title}”`);
        const add = textButton("Add album", async () => {
          if (await addAlbumToQueue(item)) markAdded(add);
        }, `Add album “${item.title}” to the queue`);
        row.append(browse, add, textButton("Info", () => openInfo(item), `Show album details for ${item.title}`));
        list.append(row);
        return;
      }
      case "artist":
      case "genre":
        list.append(strip(item.title, item.kind === "genre" ? genreCountSummary(item) : "", () => openInfo(item)));
        return;
      case "playlist":
        list.append(strip(item.title, `${item.trackCount} tracks`, () => queuePlaylist(item, item.title)));
    }
  }

  function renderResults(results, term, focusResult) {
    const list = el("#jb-rack-list");
    const feedback = el("#jb-search-feedback");
    list.replaceChildren();
    if (!results.length) {
      list.append(empty(`No results for “${term}”. Try a different search.`));
      feedback.textContent = "No matches found.";
      return;
    }
    feedback.textContent = `${Math.min(results.length, 40)} results. Choose one with Select.`;
    results.slice(0, 40).forEach((item) => appendResult(item, list, feedback));
    if (focusResult) list.querySelector(".jb-strip")?.focus();
  }

  function begin(term) {
    const requestId = ++state.searchRequest;
    state.detailRequest++;
    state.searchTerm = term;
    el("#jb-search-back").hidden = true;
    el("#jb-search-add-album").hidden = true;
    el("#jb-search-heading").textContent = "Search my music";
    return requestId;
  }

  async function run(value, { focusResult = true } = {}) {
    const term = value.trim();
    const list = el("#jb-rack-list");
    const feedback = el("#jb-search-feedback");
    const requestId = begin(term);
    if (!term) {
      selectTab(state.tab);
      return;
    }
    list.replaceChildren(empty("Searching…"));
    feedback.textContent = "Searching your music library…";
    if (term.length < 2) {
      list.replaceChildren(empty("Use at least two characters to search."));
      feedback.textContent = "Search needs at least two characters.";
      return;
    }
    try {
      const response = await fetch(`/api/music/search?${new URLSearchParams({ q: term, type: searchTypes[state.tab] || "all", t: Date.now().toString() })}`, { cache: "no-store" });
      const result = await response.json();
      if (requestId !== state.searchRequest) return;
      if (!response.ok) throw new Error(result.error || "Search failed");
      renderResults(Array.isArray(result.results) ? result.results : [], term, focusResult);
    } catch (error) {
      if (requestId !== state.searchRequest) return;
      list.replaceChildren(empty(error.message));
      feedback.textContent = "Search failed. Check the connection and try again.";
    }
  }

  function wire() {
    for (const button of document.querySelectorAll("#jb-search-dialog .jb-tab")) {
      button.addEventListener("click", () => selectTab(button.dataset.rack));
    }
    const searchButton = el("#jb-search-btn");
    const input = el("#jb-search");
    buildJukeboxTvKeyboard(el("#jb-tv-keyboard"), searchButton);
    let timer;
    const clearTimer = () => clearTimeout(timer);
    el("#jb-search-clear")?.addEventListener("click", () => {
      if (!input) return;
      clearTimer();
      input.value = "";
      run("");
      el('#jb-tv-keyboard [data-search-key="A"]')?.focus();
    });
    input?.addEventListener("input", () => {
      clearTimer();
      state.searchRequest++;
      if (!input.value.trim()) {
        run("");
        return;
      }
      const value = input.value;
      timer = setTimeout(() => run(value, { focusResult: false }), 300);
    });
    const focusKeyboard = () => el('#jb-tv-keyboard [data-search-key="A"]')?.focus();
    const dialog = el("#jb-search-dialog");
    const close = el("#jb-search-close");
    if (close && dialog) close.addEventListener("click", () => window.MyMusicsUI.closeDialog(dialog));
    const open = el("#jb-search-open");
    if (open && dialog) open.addEventListener("click", () => {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      selectTab(state.tab);
      requestAnimationFrame(focusKeyboard);
    });
    wireJukeboxTvKeyboard(input, dialog);
    const back = el("#jb-search-back");
    const addAlbumButton = el("#jb-search-add-album");
    back?.addEventListener("click", () => {
      state.detailRequest++;
      back.hidden = true;
      addAlbumButton.hidden = true;
      el("#jb-search-heading").textContent = "Search my music";
      if (state.searchTerm) {
        input.value = state.searchTerm;
        searchButton.click();
      } else selectTab(state.tab);
    });
    addAlbumButton?.addEventListener("click", async () => {
      if (state.detailItem && await addAlbumToQueue(state.detailItem)) markAdded(addAlbumButton);
    });
    if (searchButton && input) {
      searchButton.addEventListener("click", () => {
        clearTimer();
        run(input.value);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        searchButton.click();
      });
    }
  }

  return Object.freeze({ run, wire });
}
