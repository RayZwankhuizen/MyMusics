export function wireManagePlaylists({ el, initialPlaylistId = "" }) {
const playlistState = { playlists: [], open: null };

function setPlaylistStatus(message) {
  el("#playlist-status").textContent = message || "";
}

function manageButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "station-edit-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function loadPlaylists() {
  try {
    const response = await fetch("/api/music/playlists");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load playlists.");
    playlistState.playlists = Array.isArray(result.playlists) ? result.playlists : [];
    renderPlaylists();
  } catch (error) {
    setPlaylistStatus(error.message);
  }
}

function renderPlaylists() {
  const list = el("#playlist-list");
  list.hidden = Boolean(playlistState.open);
  list.replaceChildren();
  if (!playlistState.playlists.length) {
    const p = document.createElement("p");
    p.className = "music-empty";
    p.textContent = "No playlists yet.";
    list.append(p);
    return;
  }
  for (const playlist of playlistState.playlists) {
    const row = document.createElement("div");
    row.className = "station-row";
    if (playlistState.open?.id === playlist.id) row.classList.add("queue-current");
    const details = document.createElement("div");
    details.className = "station-details";
    const title = document.createElement("strong");
    title.textContent = playlist.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = `${playlist.trackCount} track${playlist.trackCount === 1 ? "" : "s"}`;
    details.append(title, subtitle);
    const actions = document.createElement("div");
    actions.className = "station-actions";
    const queue = document.createElement("button");
    queue.type = "button";
    queue.className = "station-edit-button";
    queue.textContent = "Queue";
    queue.addEventListener("click", () => playPlaylist(playlist.id));
    const shuffle = document.createElement("button");
    shuffle.type = "button";
    shuffle.className = "station-edit-button";
    shuffle.textContent = "Shuffle";
    shuffle.addEventListener("click", () => playPlaylist(playlist.id, true));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "station-edit-button";
    btn.textContent = "Open";
    btn.addEventListener("click", () => openPlaylist(playlist.id));
    actions.append(btn, queue, shuffle);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "station-edit-button";
    del.textContent = "Delete";
    del.addEventListener("click", () => deletePlaylist(playlist));
    actions.append(del);
    row.append(details, actions);
    list.append(row);
  }
}

function renderOpenPlaylist() {
  const container = el("#playlist-tracks");
  container.replaceChildren();
  const playlist = playlistState.open;
  if (!playlist) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const heading = document.createElement("div");
  heading.className = "playlist-heading";
  const name = document.createElement("input");
  name.value = playlist.name;
  name.maxLength = 60;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "station-edit-button";
  save.textContent = "Save name";
  save.addEventListener("click", () => renamePlaylist(playlist.id, name.value));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "station-edit-button";
  close.textContent = "Back to playlists";
  close.addEventListener("click", () => { playlistState.open = null; renderPlaylists(); renderOpenPlaylist(); });
  heading.append(name, save, close);
  heading.insertBefore(manageButton("Queue", () => playPlaylist(playlist.id)), save);
  heading.insertBefore(manageButton("Shuffle", () => playPlaylist(playlist.id, true)), save);
  container.append(heading);
  if (!playlist.tracks.length) {
    const p = document.createElement("p");
    p.className = "music-empty";
    p.textContent = "This playlist is empty.";
    container.append(p);
    return;
  }
  playlist.tracks.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "station-row";
    const details = document.createElement("div");
    details.className = "station-details";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const subtitle = document.createElement("span");
    subtitle.textContent = track.album || "";
    details.append(title, subtitle);
    const actions = document.createElement("div");
    actions.className = "station-actions";
    const rem = document.createElement("button");
    rem.type = "button";
    rem.className = "station-edit-button";
    rem.textContent = "Remove";
    rem.addEventListener("click", () => removePlaylistTrack(playlist.id, index));
    actions.append(rem);
    row.append(details, actions);
    container.append(row);
  });
}

async function openPlaylist(id) {
  try {
    const response = await fetch(`/api/music/playlists/${encodeURIComponent(id)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not open this playlist.");
    playlistState.open = result.playlist;
    setPlaylistStatus("");
    renderPlaylists();
    renderOpenPlaylist();
  } catch (error) {
    setPlaylistStatus(error.message);
  }
}

async function createPlaylist(name) {
  if (!name.trim()) return false;
  try {
    const response = await fetch("/api/music/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create this playlist.");
    setPlaylistStatus(`Created "${result.playlist.name}".`);
    await loadPlaylists();
    await openPlaylist(result.playlist.id);
    return true;
  } catch (error) {
    setPlaylistStatus(error.message);
    return false;
  }
}

async function renamePlaylist(id, name) {
  try {
    const response = await fetch(`/api/music/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not rename this playlist.");
    playlistState.open = result.playlist;
    setPlaylistStatus(`Renamed to "${result.playlist.name}".`);
    await loadPlaylists();
    renderOpenPlaylist();
  } catch (error) {
    setPlaylistStatus(error.message);
  }
}

async function deletePlaylist(playlist) {
  if (!confirm(`Delete the playlist "${playlist.name}"?`)) return;
  try {
    const response = await fetch(`/api/music/playlists/${encodeURIComponent(playlist.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Could not delete this playlist.");
    }
    if (playlistState.open?.id === playlist.id) playlistState.open = null;
    setPlaylistStatus(`Deleted "${playlist.name}".`);
    await loadPlaylists();
    renderOpenPlaylist();
  } catch (error) {
    setPlaylistStatus(error.message);
  }
}

async function removePlaylistTrack(id, index) {
  try {
    const response = await fetch(`/api/music/playlists/${encodeURIComponent(id)}/tracks/${index}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not remove this track.");
    playlistState.open = result.playlist;
    await loadPlaylists();
    renderOpenPlaylist();
  } catch (error) {
    setPlaylistStatus(error.message);
  }
}

el("#playlist-create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("#playlist-name");
  if (await createPlaylist(input.value)) input.value = "";
});

function playPlaylist(id, shuffle = false) {
  const query = new URLSearchParams({ playlist: id });
  if (shuffle) query.set("shuffle", "1");
  location.href = `/music.html?${query}`;
}

async function init() {
  await loadPlaylists();
  const id = initialPlaylistId || new URLSearchParams(location.search).get("playlist");
  if (id) await openPlaylist(id);
}

void init();
}
