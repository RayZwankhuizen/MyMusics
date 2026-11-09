export function createMusicQueueView({ state, el, emptyRow, trackRow, textButton, loadToInactiveDeck, openInfo, scrollQueueText, preloadNextToDeck }) {
  function nudgeQueue(id, delta) {
    const from = state.queue.findIndex((entry) => entry.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= state.queue.length) return;
    const [track] = state.queue.splice(from, 1);
    state.queue.splice(to, 0, track);
    render();
  }

  function queueActions(track, index) {
    const actions = document.createElement("div");
    actions.className = "station-actions";
    const up = textButton("↑", () => nudgeQueue(track.id, -1), `Move ${track.title} up`);
    const down = textButton("↓", () => nudgeQueue(track.id, 1), `Move ${track.title} down`);
    up.disabled = index === 0;
    down.disabled = index === state.queue.length - 1;
    actions.append(
      up,
      down,
      textButton("Load", () => loadToInactiveDeck(track)),
      textButton("Info", () => openInfo(track)),
      textButton("Remove", () => {
        const at = state.queue.findIndex((entry) => entry.id === track.id);
        if (at >= 0) state.queue.splice(at, 1);
        render();
      })
    );
    return actions;
  }

  function render() {
    const list = el("#queue-list");
    list.replaceChildren();
    el("#queue-count").textContent = state.queue.length ? `${state.queue.length} tracks` : "";
    const emptyButton = el("#queue-empty");
    if (emptyButton) emptyButton.disabled = state.queue.length === 0;
    if (!state.queue.length) {
      list.append(emptyRow("Nothing queued yet. Pick a record in the jukebox."));
      return;
    }
    state.queue.forEach((track, index) => {
      const row = trackRow(track, { stacked: true });
      row.append(queueActions(track, index));
      list.append(row);
    });
    requestAnimationFrame(() => scrollQueueText());
    // Keep the next track ready on the inactive deck.
    preloadNextToDeck();
  }

  return Object.freeze({ render });
}
