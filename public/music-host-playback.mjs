export function createMusicHostPlayback({ state, deckState, resolveIncomingDeck, setNaturalFadeStartedTrack, getNaturalFadeStartedTrack, naturalFadeSeconds, isHostOutput, musicEqualizer, recordPlayedTrack, setStatus, refreshPlaybackAndQueue, renderDeckTime, syncJukeboxPlaying, next }) {
  let deckStatus = null;
  let deckStatusAt = 0;
  let endedTrack = "";

  function getDeckStatus() {
    if (!deckStatus) return null;
    const elapsed = (performance.now() - deckStatusAt) / 1000;
    return Object.fromEntries(Object.entries(deckStatus).map(([key, status]) => [key, {
      ...status,
      time: status.playing ? Math.min(status.duration || Infinity, status.time + elapsed) : status.time
    }]));
  }

  function nextPollDelay() {
    if (!isHostOutput()) return null;
    const active = getDeckStatus()?.[deckState.activeDeck];
    if (!active?.playing) return null;
    const track = deckState.deckTracks[deckState.activeDeck] || state.current;
    const duration = active.duration || (Number(track?.durationMs) / 1000);
    if (!duration) return 30_000;
    const naturalFade = naturalFadeSeconds(track);
    const queueFade = state.crossfadeEnabled && state.queue.length ? state.fadeSeconds : 0;
    const fade = state.crossfadeEnabled ? naturalFade || queueFade : 0;
    const secondsToCheck = duration - active.time - fade - 5;
    return Math.max(1_000, Math.min(60_000, secondsToCheck * 1000));
  }

  async function playTrack(track, { record, targetKey, naturalFadeIn, naturalFadeDuration, crossfadeDuration }) {
    const incomingKey = resolveIncomingDeck(track, targetKey);
    const outgoingKey = deckState.activeDeck;
    const crossfade = Boolean(state.current && incomingKey !== outgoingKey && state.crossfadeEnabled);
    deckState.decks.a.pause(); deckState.decks.b.pause(); deckState.decks.a.hidden = true; deckState.decks.b.hidden = true;
    const fadeSeconds = naturalFadeIn ? naturalFadeDuration : crossfadeDuration ?? state.fadeSeconds;
    const response = await fetch("/api/host-player/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: track.id, deck: incomingKey, crossfade, naturalFadeIn, fadeSeconds }) });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "HOST AUDIO UNAVAILABLE");
      window.dispatchEvent(new Event("mymusics:host-status-needed"));
      return;
    }
    deckState.activeDeck = incomingKey;
    deckState.deckTracks[incomingKey] = track;
    state.current = track;
    setNaturalFadeStartedTrack("");
    state.transcoding = false;
    if (record) recordPlayedTrack(track);
    musicEqualizer.autoPreset(track);
    setStatus("PLAYING ON MYMUSICS HOST", true);
    refreshPlaybackAndQueue();
    window.dispatchEvent(new Event("mymusics:host-status-needed"));
  }

  async function refreshStatus() {
    if (!isHostOutput()) return;
    try {
      const status = await fetch("/api/host-player/status").then((response) => response.json());
      deckStatus = status.decks;
      deckStatusAt = performance.now();
      const active = status.decks[status.activeDeck];
      if (active?.ended && state.current?.id && endedTrack !== state.current.id) {
        endedTrack = state.current.id;
        if (getNaturalFadeStartedTrack() !== state.current.id) next();
      } else if (active?.playing) endedTrack = "";
      for (const key of ["a", "b"]) renderDeckTime(key);
      syncJukeboxPlaying();
      return getDeckStatus();
    } catch { return null; }
  }

  return Object.freeze({ playTrack, refreshStatus, getDeckStatus, nextPollDelay });
}
