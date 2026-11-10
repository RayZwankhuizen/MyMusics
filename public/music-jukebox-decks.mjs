export function createMusicJukeboxDecks({ state, deckState, el, getHostDeckStatus, isHostOutput, getNaturalFadeStartedTrack, setNaturalFadeStartedTrack, formatDuration, naturalFadeSeconds, scrollQueueText, next }) {
  const { decks, deckTracks, armDropped } = deckState;
  const setText = (selector, value) => {
    const node = el(selector);
    if (!node) return;
    node.textContent = value;
    node.hidden = !value;
  };
  function syncPlaying() {
    const activeDeck = deckState.activeDeck;
    const hostStatus = getHostDeckStatus();
    const currentAudio = activeDeck === "b" ? decks.b : decks.a;
    const playing = isHostOutput()
      ? Boolean(hostStatus?.[activeDeck]?.playing)
      : currentAudio && !currentAudio.paused && !currentAudio.ended && currentAudio.readyState >= 2 && !currentAudio.error;
    const { fadingDeck, fadingOutDeck } = deckState;
    const playingA = (playing && activeDeck === "a") || ((fadingDeck === "a" || fadingOutDeck === "a") && (isHostOutput() ? hostStatus?.a?.playing : !decks.a.paused));
    const playingB = (playing && activeDeck === "b") || ((fadingDeck === "b" || fadingOutDeck === "b") && (isHostOutput() ? hostStatus?.b?.playing : !decks.b.paused));
    el("#jb-vinyl")?.classList.toggle("is-playing", playingA);
    el("#jb-vinyl-b")?.classList.toggle("is-playing", playingB);
    el("#jb-arm")?.classList.toggle("is-playing", playingA || armDropped.a);
    el("#jb-arm-b")?.classList.toggle("is-playing", playingB || armDropped.b);
    document.querySelectorAll(".jb-deck").forEach((deck, index) => deck.classList.toggle("is-active", (index === 0 ? "a" : "b") === activeDeck));
    el("#jb-pause-a").disabled = isHostOutput() ? !hostStatus?.a?.path : decks.a.paused || decks.a.ended;
    el("#jb-pause-b").disabled = isHostOutput() ? !hostStatus?.b?.path : decks.b.paused || decks.b.ended;
    const activeStatus = currentAudio?.error ? "THIS RECORD WILL NOT PLAY"
      : (deckTracks[activeDeck] || state.current) ? (playing ? "PLAYING" : "PAUSED") : "";
    const inactiveKey = activeDeck === "a" ? "b" : "a";
    const inactiveStatus = deckTracks[inactiveKey] ? "READY" : "";
    setText(activeDeck === "a" ? "#jb-status" : "#jb-status-b", activeStatus);
    setText(inactiveKey === "a" ? "#jb-status" : "#jb-status-b", inactiveStatus);
  }

  function renderTime(key) {
    const player = decks[key];
    const suffix = key === "a" ? "" : "-b";
    const output = el(`#jb-time${suffix}`);
    const hostStatus = getHostDeckStatus();
    const duration = isHostOutput() ? hostStatus?.[key]?.duration : player.duration;
    const progress = el(key === "a" ? "#jb-progress" : "#jb-progress-b");
    if (!Number.isFinite(duration) || duration <= 0 || !deckTracks[key]) {
      setText(`#jb-time${suffix}`, "");
      if (progress) {
        progress.value = 0;
        progress.disabled = true;
        progress.hidden = true;
        delete progress.dataset.seeking;
        progress.style.setProperty("--progress", "0%");
      }
      return;
    }
    const elapsed = Math.min(duration, Math.max(0, isHostOutput() ? hostStatus?.[key]?.time || 0 : player.currentTime || 0));
    if (progress) {
      progress.hidden = false;
      let seekable = isHostOutput();
      for (let index = 0; !seekable && index < player.seekable.length; index++) {
        seekable = player.seekable.start(index) <= 0.05 && player.seekable.end(index) >= duration - 1;
      }
      progress.disabled = !seekable;
      if (!progress.dataset.seeking) {
        progress.value = elapsed / duration;
        progress.style.setProperty("--progress", `${elapsed / duration * 100}%`);
      }
    }
    const clock = (seconds) => {
      const total = Math.floor(seconds);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    };
    setText(`#jb-time${suffix}`, `${clock(elapsed)} elapsed · −${clock(duration - elapsed)} remaining`);
    const activeDeck = deckState.activeDeck;
    const track = deckTracks[key] || (key === activeDeck ? state.current : null);
    if (key !== activeDeck || !track || !state.crossfadeEnabled || getNaturalFadeStartedTrack() === track.id) return;
    const naturalFade = naturalFadeSeconds(track);
    const remaining = duration - elapsed;
    if (naturalFade && remaining > 0 && remaining <= naturalFade) {
      setNaturalFadeStartedTrack(track.id);
      void next({ naturalFadeIn: true, naturalFadeDuration: remaining });
    } else if (state.queue.length && state.fadeSeconds > 0 && remaining > 0 && remaining <= state.fadeSeconds) {
      setNaturalFadeStartedTrack(track.id);
      void next({ crossfadeDuration: remaining });
    }
  }

  function renderNow() {
    const activeDeck = deckState.activeDeck;
    const updateDeck = (key, track) => {
      const suffix = key === "a" ? "" : "-b";
      setText(`#jb-title${suffix}`, track?.title || "");
      setText(`#jb-artist${suffix}`, track ? track.artist || "Unknown artist" : "");
      setText(`#jb-album${suffix}`, track ? [track.album, track.year].filter(Boolean).join(" · ") : "");
      setText(`#jb-meta${suffix}`, track ? formatDuration(track.durationMs) : "");
      const fadeInput = el(`[data-natural-fadeout="${key}"]`);
      fadeInput.disabled = !track?.id;
      fadeInput.value = naturalFadeSeconds(track) || "";
      fadeInput.closest(".jb-natural-fade").hidden = !track?.id;
      renderTime(key);
      const art = el(`#jb-art${suffix}`);
      if (track?.art) {
        art.onload = () => { art.hidden = false; };
        art.onerror = () => { art.hidden = true; };
        if (art.getAttribute("src") !== track.art) art.src = track.art;
      } else {
        art.hidden = true;
        art.removeAttribute("src");
      }
    };
    if (!deckTracks[activeDeck] && state.current) deckTracks[activeDeck] = state.current;
    const otherKey = activeDeck === "a" ? "b" : "a";
    if (!deckTracks[otherKey] && state.queue[0]?.id !== (deckTracks[activeDeck]?.id || state.current?.id)) deckTracks[otherKey] = state.queue[0] || null;
    updateDeck("a", deckTracks.a);
    updateDeck("b", deckTracks.b);
    for (const key of ["a", "b"]) {
      const isActive = key === activeDeck;
      el(`#jb-info-label-${key}`).textContent = `${isActive ? "Now playing" : "Next on"} · Deck ${key.toUpperCase()}`;
      el(`.jb-info-${key}`).classList.toggle("is-active", isActive);
      el(`#jb-add-playlist-${key}`).hidden = !isActive || !(deckTracks[key] || state.current)?.id;
    }
    requestAnimationFrame(() => scrollQueueText());
    syncPlaying();
  }

  function renderCurrent() {
    const track = state.current;
    const details = el("#jukebox-details");
    const jukebox = el("#jukebox");
    if (details) {
      details.hidden = false;
      if (track) {
        if (!(jukebox && jukebox.dataset.infoMode === "true")) details.open = true;
        if (jukebox) jukebox.dataset.infoMode = "";
      } else {
        details.open = true;
        if (jukebox) jukebox.dataset.infoMode = jukebox.dataset.infoMode === "true" ? "true" : "";
      }
    }
    const activeDeck = deckState.activeDeck;
    el(activeDeck === "b" ? "#jb-meta-b" : "#jb-meta").textContent = track ? [
      formatDuration(track.durationMs),
      state.transcoding ? "converted for this browser" : null,
      state.seed?.id === track.id ? "Seed track" : null
    ].filter(Boolean).join(" · ") : "";
    renderNow();
  }

  return Object.freeze({ syncPlaying, renderNow, renderTime, renderCurrent });
}
