export function createMusicPlaylistActions({ el, textButton }) {
  const dialog = el("#playlist-picker-dialog");
  const list = el("#playlist-picker-list");
  const status = el("#playlist-picker-status");
  let requestId = 0;

  async function addTrack(track, playlist, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/music/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add this track.");
      button.textContent = "Added";
      status.textContent = `Added “${track.title}” to “${result.playlist.name}”.`;
    } catch (error) {
      button.disabled = false;
      status.textContent = error.message;
    }
  }

  async function addTrackToPlaylist(track) {
    if (!track?.id || !track.title) return;
    const currentRequest = ++requestId;
    el("#playlist-picker-track").textContent = [track.title, track.artist].filter(Boolean).join(" · ");
    status.textContent = "Loading playlists…";
    list.replaceChildren();
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch("/api/music/playlists");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load playlists.");
      if (currentRequest !== requestId) return;
      const playlists = Array.isArray(result.playlists) ? result.playlists : [];
      if (!playlists.length) {
        status.textContent = "Create a playlist before adding tracks.";
        return;
      }
      status.textContent = "Choose a playlist.";
      for (const playlist of playlists) {
        const row = document.createElement("div");
        row.className = "playlist-picker-row";
        const name = document.createElement("span");
        name.textContent = `${playlist.name} · ${playlist.trackCount} tracks`;
        const button = textButton("Add", () => void addTrack(track, playlist, button));
        row.append(name, button);
        list.append(row);
      }
    } catch (error) {
      if (currentRequest === requestId) status.textContent = error.message;
    }
  }

  el("#playlist-picker-close").addEventListener("click", () => dialog.close());
  return Object.freeze({
    addTrackToPlaylist
  });
}
