export function createMusicQueueOperations({ state, deckState, el, renderQueue, renderJukeboxNow, recentArtists, setStatus, emptyRow, startFreshSequence, saveSeed }) {
  const albumLoads = new Set();

  function enqueueTracks(tracks, label = "tracks") {
    const queued = new Set(state.queue.map((track) => track.id));
    const additions = tracks.filter((track) => track?.id && !queued.has(track.id) && queued.add(track.id));
    if (!additions.length) return false;
    state.queue = [...state.queue, ...additions];
    renderQueue();
    const message = `${additions.length} ${label} added to the queue.`;
    if (el("#jb-search-dialog")?.open) el("#jb-search-feedback").textContent = message;
    else el("#music-search-status").textContent = message;
    return true;
  }

  async function addAlbumToQueue(album) {
    const feedback = el("#jb-search-dialog")?.open ? el("#jb-search-feedback") : el("#music-search-status");
    if (albumLoads.has(album.id)) return false;
    albumLoads.add(album.id);
    feedback.textContent = `Loading “${album.title}”…`;
    try {
      const response = await fetch(`/api/music/album/${encodeURIComponent(album.id)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this album.");
      const tracks = result.tracks || [];
      if (!tracks.length) throw new Error("This album has no playable tracks.");
      if (!enqueueTracks(tracks, `tracks from “${album.title}”`)) {
        feedback.textContent = `All tracks from “${album.title}” are already in the queue.`;
        return false;
      }
      return true;
    } catch (error) {
      feedback.textContent = error.message;
      return false;
    } finally {
      albumLoads.delete(album.id);
    }
  }

  async function loadCollectionToQueue(collection) {
    try {
      el("#music-search-status").textContent = `Loading tracks from ${collection.title}...`;
      const response = await fetch(`/api/music/info?${new URLSearchParams({ kind: collection.kind, id: collection.id })}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load tracks.");
      const tracks = Array.isArray(result.info?.tracks) ? result.info.tracks : [];
      if (!tracks.length) {
        el("#music-search-status").textContent = `No tracks found for ${collection.title}.`;
        return;
      }
      state.queue = [...tracks, ...state.queue];
      renderQueue();
      el("#music-search-status").textContent = `${tracks.length} tracks from ${collection.title} added to queue.`;
    } catch (error) {
      el("#music-search-status").textContent = error.message;
    }
  }

  function setPlaylistStatus(message) {
    const target = el("#jb-search-dialog")?.open ? el("#jb-search-feedback") : el("#music-search-status");
    if (target) target.textContent = message || "";
  }

  async function queuePlaylist(id, { shuffle = false } = {}) {
    try {
      const response = await fetch(`/api/music/playlists/${encodeURIComponent(id)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open this playlist.");
      let tracks = Array.isArray(result.playlist.tracks) ? result.playlist.tracks : [];
      if (!tracks.length) {
        setPlaylistStatus("This playlist is empty.");
        return false;
      }
      const randomized = shuffle || state.shuffle;
      if (randomized) tracks = shuffleTracks(tracks);
      if (shuffle || !state.current) {
        const [first, ...rest] = tracks;
        state.seed = first;
        saveSeed(first);
        await startFreshSequence(first, shuffle ? rest : [...rest, ...state.queue]);
        if (!shuffle) el("#music-results").replaceChildren();
        renderQueue();
      } else {
        state.queue = [...state.queue, ...tracks];
        renderQueue();
      }
      setPlaylistStatus(`${tracks.length} track${tracks.length === 1 ? "" : "s"} ${randomized ? "shuffled and " : ""}queued from “${result.playlist.name}”.`);
      return true;
    } catch (error) {
      setPlaylistStatus(error.message);
      return false;
    }
  }

  function emptyQueue() {
    state.queue = [];
    const inactiveKey = deckState.activeDeck === "a" ? "b" : "a";
    if (!deckState.decks[inactiveKey].paused || deckState.deckTracks[inactiveKey]?.id !== state.current?.id) {
      deckState.decks[inactiveKey].pause();
      deckState.decks[inactiveKey].removeAttribute("src");
      deckState.deckTracks[inactiveKey] = null;
      deckState.armDropped[inactiveKey] = false;
      try { deckState.decks[inactiveKey].load(); } catch {}
    }
    renderQueue();
    renderJukeboxNow();
    el("#music-search-status").textContent = "Up next is empty. Current playback continues.";
  }

  function shuffleTracks(tracks) {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function shuffleQueue() {
    if (state.queue.length > 1) {
      const activeDeck = deckState.activeDeck;
      const loadedKey = state.current ? (activeDeck === "a" ? "b" : "a") : activeDeck;
      const loadedNext = deckState.deckTracks[loadedKey];
      const loadedIndex = loadedNext ? state.queue.findIndex((track) => track.id === loadedNext.id) : -1;
      if (loadedIndex >= 0) {
        const [keepNext] = state.queue.splice(loadedIndex, 1);
        state.queue = [keepNext, ...shuffleTracks(state.queue)];
      } else state.queue = shuffleTracks(state.queue);
      renderQueue();
    }
  }

  function updateShuffleButton(button, enabled) {
    button?.setAttribute("aria-pressed", String(enabled));
    if (button) button.textContent = `Shuffle: ${enabled ? "ON" : "OFF"}`;
  }

  function setShuffleMode(enabled) {
    state.shuffle = enabled;
    updateShuffleButton(el("#jb-shuffle-toggle"), enabled);
    if (enabled) shuffleQueue();
  }

  async function fillQueue(force = false) {
    if (state.filling || !state.configured) return;
    if (!force && state.queue.length >= 3) return;
    if (!state.autoDj?.seed?.id) return;
    const autoDj = state.autoDj;
    state.filling = true;
    try {
      const params = new URLSearchParams({
        seed: autoDj.seed.id,
        mode: autoDj.mode,
        exclude: [...new Set([autoDj.seed.id, ...state.recent, ...state.queue.map((track) => track.id)])].join(","),
        artists: recentArtists().join(","),
        limit: "8"
      });
      const response = await fetch(`/api/autodj/next?${params}`);
      const result = await response.json();
      if (state.autoDj !== autoDj) return;
      if (!response.ok) {
        const error = new Error(result.error || "The DJ is unavailable.");
        error.status = response.status;
        throw error;
      }
      const incoming = Array.isArray(result.tracks) ? result.tracks : [];
      const known = new Set([...(state.queue.map((track) => track.id)), ...state.recent]);
      const fresh = incoming.filter((track) => !known.has(track.id));
      state.queue = [...state.queue, ...fresh];
      renderQueue();
    } catch (error) {
      if (state.autoDj !== autoDj) return;
      if (error.status === 404) {
        state.autoDj = null;
        window.dispatchEvent(new Event("mymusics:autodj-state-change"));
        setStatus("AUTODJ SOURCE COMPLETE");
        return;
      }
      setStatus("QUEUE UNAVAILABLE");
      el("#queue-list").replaceChildren(emptyRow(error.message));
    } finally {
      state.filling = false;
      if (state.autoDj && state.autoDj !== autoDj) void fillQueue(true);
    }
  }

  function wireControls() {
    el("#queue-empty")?.addEventListener("click", emptyQueue);
    const button = el("#jb-shuffle-toggle");
    if (!button) return;
    button.addEventListener("click", () => setShuffleMode(!state.shuffle));
    updateShuffleButton(button, state.shuffle);
  }

  return Object.freeze({ enqueueTracks, addAlbumToQueue, loadCollectionToQueue, emptyQueue, shuffleTracks, setShuffleMode, updateShuffleButton, fillQueue, queuePlaylist, wireControls });
}
