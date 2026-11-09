export function createMusicDeckTransport({ state, deckState, isHostOutput, getHostDeckStatus, renderQueue, syncJukeboxPlaying, playTrack }) {
  const { decks, deckTracks, armDropped } = deckState;
  async function playDeck(key) {
    let track = deckTracks[key] || (key === deckState.activeDeck ? state.current : null);
    if (!track && state.queue.length) {
      track = state.queue.shift();
      armDropped[key] = false;
      deckTracks[key] = track;
      renderQueue();
    }
    if (!track?.id) return;
    const queuedIndex = state.queue.findIndex((queued) => queued.id === track.id);
    if (queuedIndex >= 0) state.queue.splice(queuedIndex, 1);
    await playTrack(track, { record: false, targetKey: key });
  }

  function pauseDeck(key) {
    if (isHostOutput()) {
      const paused = getHostDeckStatus()?.[key]?.paused;
      fetch("/api/host-player/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: key, action: paused ? "resume" : "pause" }) })
        .finally(() => window.dispatchEvent(new Event("mymusics:host-status-needed"))).catch(() => {});
      return;
    }
    decks[key].pause();
    if (deckTracks[key]?.id) armDropped[key] = true;
    syncJukeboxPlaying();
  }

  return Object.freeze({ playDeck, pauseDeck });
}
