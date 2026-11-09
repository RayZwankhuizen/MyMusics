export function createMusicHostPlayback({ state, deckState, resolveIncomingDeck, setNaturalFadeStartedTrack, getNaturalFadeStartedTrack, isHostOutput, musicEqualizer, recordPlayedTrack, setStatus, refreshPlaybackAndQueue, renderDeckTime, syncJukeboxPlaying, next }) {
  let deckStatus = null;
  let endedTrack = "";

  async function playTrack(track, { record, targetKey, naturalFadeIn, naturalFadeDuration, crossfadeDuration }) {
    const incomingKey = resolveIncomingDeck(track, targetKey);
    const outgoingKey = deckState.activeDeck;
    const crossfade = Boolean(state.current && incomingKey !== outgoingKey && state.crossfadeEnabled);
    deckState.decks.a.pause(); deckState.decks.b.pause(); deckState.decks.a.hidden = true; deckState.decks.b.hidden = true;
    const fadeSeconds = naturalFadeIn ? naturalFadeDuration : crossfadeDuration ?? state.fadeSeconds;
    const response = await fetch("/api/host-player/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: track.id, deck: incomingKey, crossfade, naturalFadeIn, fadeSeconds }) });
    const result = await response.json();
    if (!response.ok) { setStatus(result.error || "HOST AUDIO UNAVAILABLE"); return; }
    deckState.activeDeck = incomingKey;
    deckState.deckTracks[incomingKey] = track;
    state.current = track;
    setNaturalFadeStartedTrack("");
    state.transcoding = false;
    if (record) recordPlayedTrack(track);
    musicEqualizer.autoPreset(track);
    setStatus("PLAYING ON MYMUSICS HOST", true);
    refreshPlaybackAndQueue();
  }

  async function refreshStatus() {
    if (!isHostOutput()) return;
    try {
      const status = await fetch("/api/host-player/status").then((response) => response.json());
      deckStatus = status.decks;
      const active = status.decks[status.activeDeck];
      if (active?.ended && state.current?.id && endedTrack !== state.current.id) {
        endedTrack = state.current.id;
        if (getNaturalFadeStartedTrack() !== state.current.id) next();
      } else if (active?.playing) endedTrack = "";
      for (const key of ["a", "b"]) renderDeckTime(key);
      syncJukeboxPlaying();
    } catch {}
  }

  return Object.freeze({ playTrack, refreshStatus, getDeckStatus: () => deckStatus });
}
