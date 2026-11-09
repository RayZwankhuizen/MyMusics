function handleDeckError({ deck, player, reportUnavailable, syncJukeboxPlaying, state, deckState, audioUrl, setStatus, renderNow }) {
  syncJukeboxPlaying();
  if (deckState.activeDeck !== deck) return;
  if (state.transcoding || !state.current?.id) {
    if (reportUnavailable) setStatus("TRACK UNAVAILABLE");
    return;
  }
  state.transcoding = true;
  player.src = audioUrl(state.current, { transcode: true });
  setStatus("CONVERTING");
  player.play().catch(() => setStatus("PRESS PLAY TO LISTEN"));
  renderNow();
}

function wireDeckEvents(player, deck, reportUnavailable, handlers) {
  const { syncDeck, syncJukeboxPlaying, state, deckState, audioUrl, setStatus, renderNow, handleDeckEnded } = handlers;
  player.addEventListener("playing", () => syncDeck(deck, "PLAYING", true));
  player.addEventListener("waiting", () => syncDeck(deck, "BUFFERING"));
  player.addEventListener("pause", () => syncDeck(deck, "PAUSED"));
  player.addEventListener("error", () => handleDeckError({
    deck, player, reportUnavailable, syncJukeboxPlaying, state, deckState, audioUrl, setStatus, renderNow
  }));
  player.addEventListener("ended", () => handleDeckEnded(deck));
}

export function wireAudioDeckEvents({ deckState, ...handlers }) {
  const deckHandlers = { ...handlers, deckState };
  for (const [key, player] of Object.entries(deckState.decks)) {
    wireDeckEvents(player, key, key === "a", deckHandlers);
  }
}

export function wirePlaybackLifecycleEvents({ deckState, handleDeckEnded, renderDeckTime, refreshHostStatus, syncJukeboxPlaying, state, audioUrl, setStatus, renderNow }) {
  const { decks, armDropped } = deckState;
  setInterval(refreshHostStatus, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (window.MyMusicsPlayback?.isHost) void refreshHostStatus();
    else if (decks[deckState.activeDeck].ended) handleDeckEnded(deckState.activeDeck);
    else renderDeckTime(deckState.activeDeck);
  });
  const syncDeck = (deck, status, live = false) => {
    if (status === "PLAYING") armDropped[deck] = true;
    syncJukeboxPlaying();
    if (deckState.activeDeck === deck && status) setStatus(status, live);
  };
  wireAudioDeckEvents({
    deckState, syncDeck, syncJukeboxPlaying, state,
    audioUrl, setStatus, renderNow, handleDeckEnded
  });
}

export function wireMusicPlaybackTargetChange({ state, deckState, playTrack }) {
  window.addEventListener("mymusics:playback-target-change", async () => {
    const track = state.current;
    deckState.decks.a.hidden = window.MyMusicsPlayback.isHost;
    deckState.decks.b.hidden = window.MyMusicsPlayback.isHost;
    if (!track) return;
    if (window.MyMusicsPlayback.isHost) await playTrack(track, { record: false, targetKey: deckState.activeDeck });
    else {
      await fetch("/api/host-player/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) }).catch(() => {});
      await playTrack(track, { record: false, targetKey: deckState.activeDeck });
    }
  });
}

export function createDeckEndedHandler({ state, deckState, getNaturalFadeStartedTrack, next, syncJukeboxPlaying, renderJukeboxNow, renderQueue }) {
  const { decks, deckTracks, armDropped } = deckState;
  return function handleDeckEnded(key) {
    syncJukeboxPlaying();
    if (deckState.activeDeck === key) {
      if (getNaturalFadeStartedTrack() !== state.current?.id) return next();
      return;
    }
    const player = decks[key];
    player.pause();
    player.currentTime = 0;
    player.volume = 1;
    player.removeAttribute("src");
    deckTracks[key] = null;
    armDropped[key] = false;
    if (deckState.fadingOutDeck === key) deckState.fadingOutDeck = null;
    if (deckState.fadingDeck === key) deckState.fadingDeck = null;
    try { player.load(); } catch {}
    syncJukeboxPlaying();
    renderJukeboxNow();
    renderQueue();
  };
}

export function wireJukeboxPlayerEvents({ deckState, syncJukeboxPlaying, renderDeckTime }) {
  for (const [key, player] of Object.entries(deckState.decks)) {
    for (const event of ["play", "pause", "ended", "error", "loadedmetadata"]) {
      player.addEventListener(event, syncJukeboxPlaying);
    }
    player.addEventListener("timeupdate", () => renderDeckTime(key));
  }
}

export function wireDeckSeekEvents({ deckState, getHostDeckStatus, isHostOutput, setStatus }) {
  for (const key of ["a", "b"]) {
    const slider = document.querySelector(key === "a" ? "#jb-progress" : "#jb-progress-b");
    if (!slider) continue;
    slider.addEventListener("input", () => {
      slider.dataset.seeking = "true";
      slider.style.setProperty("--progress", `${Number(slider.value) * 100}%`);
    });
    slider.addEventListener("change", () => {
      const duration = isHostOutput() ? getHostDeckStatus()?.[key]?.duration : deckState.decks[key].duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        delete slider.dataset.seeking;
        return;
      }
      const time = Math.max(0, Math.min(1, Number(slider.value))) * duration;
      delete slider.dataset.seeking;
      if (isHostOutput()) {
        void fetch("/api/host-player/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deck: key, action: "seek", value: time })
        }).then((response) => {
          if (!response.ok) throw new Error("Seek failed.");
        }).catch(() => setStatus("SEEK FAILED"));
      } else {
        try {
          const ranges = deckState.decks[key].seekable;
          const canSeek = Array.from({ length: ranges.length }, (_, index) => [ranges.start(index), ranges.end(index)])
            .some(([start, end]) => time >= start && time <= end);
          if (!canSeek) return setStatus("SEEK NOT AVAILABLE FOR THIS TRACK");
          deckState.decks[key].currentTime = time;
        }
        catch { setStatus("SEEK FAILED"); }
      }
    });
    slider.addEventListener("pointercancel", () => { delete slider.dataset.seeking; });
  }
}

export function wireDeckPlaybackControls({ el, state, deckState, saveNaturalFadeout, naturalFadeSeconds, setStatus, playDeck, pauseDeck }) {
  const fadeSlider = el("#fade-seconds");
  const fadeOutput = el("#fade-seconds-value");
  fadeSlider?.addEventListener("input", (event) => {
    state.fadeSeconds = Number(event.target.value);
    if (fadeOutput) fadeOutput.textContent = `${state.fadeSeconds}s`;
  });
  const crossfadeButton = el("#jb-crossfade");
  if (crossfadeButton) {
    crossfadeButton.textContent = state.crossfadeEnabled ? "Crossfade: ON" : "Crossfade: OFF";
    crossfadeButton.addEventListener("click", () => {
      state.crossfadeEnabled = !state.crossfadeEnabled;
      crossfadeButton.textContent = state.crossfadeEnabled ? "Crossfade: ON" : "Crossfade: OFF";
    });
  }
  document.querySelectorAll("[data-natural-fadeout]").forEach((input) => input.addEventListener("change", () => {
    const track = deckState.deckTracks[input.dataset.naturalFadeout];
    saveNaturalFadeout(track, input.value);
    input.value = naturalFadeSeconds(track) || "";
    if (track) setStatus(input.value ? `NATURAL OUTRO SAVED · ${input.value}s` : "NATURAL OUTRO CLEARED");
  }));
  el("#jb-play-a")?.addEventListener("click", () => playDeck("a"));
  el("#jb-play-b")?.addEventListener("click", () => playDeck("b"));
  el("#jb-pause-a")?.addEventListener("click", () => pauseDeck("a"));
  el("#jb-pause-b")?.addEventListener("click", () => pauseDeck("b"));
}
