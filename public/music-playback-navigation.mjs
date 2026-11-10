export function createMusicPlaybackNavigation({ state, deckState, deckTransition, setNaturalFadeStartedTrack, playTrack, fillQueue, saveSeed, el, setStatus }) {
  async function startFreshSequence(first, rest) {
    deckTransition.invalidate();
    for (const key of ["a", "b"]) {
      deckState.decks[key].pause();
      deckState.decks[key].removeAttribute("src");
      deckState.gains[key] = 1;
      deckState.decks[key].volume = deckState.volume;
      deckState.deckTracks[key] = null;
      deckState.armDropped[key] = false;
      try { deckState.decks[key].load(); } catch {}
    }
    state.current = null;
    state.transcoding = false;
    state.history = [];
    state.queue = rest;
    deckState.activeDeck = "a";
    await playTrack(first);
  }

  async function startRadio(track) {
    if (!track?.id) return;
    state.seed = track;
    saveSeed(track);
    state.queue = [];
    state.history = [];
    el("#music-results").replaceChildren();
    el("#music-search-status").textContent = `DJ started from “${track.title}”.`;
    await playTrack(track);
  }

  async function next({ naturalFadeIn = false, naturalFadeDuration = 0, crossfadeDuration = null } = {}) {
    const transition = { naturalFadeIn, naturalFadeDuration, crossfadeDuration };
    if (state.queue.length) return playTrack(state.queue.shift(), transition);
    await fillQueue(true);
    if (state.queue.length) return playTrack(state.queue.shift(), transition);
    if (naturalFadeIn || crossfadeDuration !== null) setNaturalFadeStartedTrack("");
    setStatus("QUEUE EMPTY");
  }

  return Object.freeze({ startFreshSequence, startRadio, next });
}
