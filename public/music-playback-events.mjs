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

export function wirePlaybackLifecycleEvents({ deckState, handleDeckEnded, renderDeckTime, refreshHostStatus, nextHostPollDelay, syncJukeboxPlaying, state, audioUrl, setStatus, renderNow }) {
  const { decks, armDropped } = deckState;
  let hostPollTimer;
  let fastPollUntil = 0;
  let polling = false;
  let pollAgain = false;

  function scheduleHostPoll(delay) {
    clearTimeout(hostPollTimer);
    if (!window.MyMusicsPlayback?.isHost || delay == null) return;
    hostPollTimer = setTimeout(pollHostStatus, Math.max(0, delay));
  }

  async function pollHostStatus() {
    if (!window.MyMusicsPlayback?.isHost) return;
    if (polling) { pollAgain = true; return; }
    polling = true;
    try { await refreshHostStatus(); }
    finally {
      polling = false;
      const delay = nextHostPollDelay();
      scheduleHostPoll(pollAgain ? 0 : Date.now() < fastPollUntil ? Math.min(delay ?? 1000, 1000) : delay);
      pollAgain = false;
    }
  }

  function requestHostStatus() {
    if (!window.MyMusicsPlayback?.isHost) {
      clearTimeout(hostPollTimer);
      return;
    }
    fastPollUntil = Date.now() + 5_000;
    scheduleHostPoll(0);
  }

  window.addEventListener("mymusics:host-status-needed", requestHostStatus);
  window.addEventListener("mymusics:playback-target-change", requestHostStatus);
  document.addEventListener("click", (event) => {
    if (event.target.closest("#jb-play-current,#jb-pause-current,#jb-play-next,#jb-progress,#jb-progress-b")) requestHostStatus();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (window.MyMusicsPlayback?.isHost) requestHostStatus();
    else if (decks[deckState.activeDeck].ended) handleDeckEnded(deckState.activeDeck);
    else renderDeckTime(deckState.activeDeck);
  });
  setInterval(() => {
    if (!window.MyMusicsPlayback?.isHost) return;
    for (const key of ["a", "b"]) renderDeckTime(key);
  }, 1000);
  if (window.MyMusicsPlayback?.isHost) requestHostStatus();
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
    deckState.gains[key] = 1;
    player.volume = deckState.volume;
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
        }).then(() => window.dispatchEvent(new Event("mymusics:host-status-needed"))).catch(() => setStatus("SEEK FAILED"));
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
  el("#jb-play-current")?.addEventListener("click", () => playDeck(deckState.activeDeck || "a"));
  el("#jb-pause-current")?.addEventListener("click", () => pauseDeck(deckState.activeDeck || "a"));
  el("#jb-play-next")?.addEventListener("click", () => playDeck(deckState.activeDeck === "a" ? "b" : "a"));
}
