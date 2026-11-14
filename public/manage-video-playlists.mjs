export function wireManageVideoPlaylists({ el, request }) {
  const listEl = el("#video-playlist-list");
  const tracksEl = el("#video-playlist-tracks");
  const picker = el("#video-playlist-picker");
  const statusEl = el("#video-playlist-status");
  let playlists = [];
  let selectedId = "";

  const say = (message) => { statusEl.textContent = message; };
  const button = (label, action) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "text-button";
    control.textContent = label;
    control.addEventListener("click", action);
    return control;
  };

  function renderTracks() {
    const playlist = playlists.find((item) => item.id === selectedId);
    tracksEl.replaceChildren();
    tracksEl.hidden = !playlist;
    if (!playlist) return;
    const heading = document.createElement("div");
    heading.className = "playlist-heading";
    const title = document.createElement("strong");
    title.textContent = `${playlist.name} · ${playlist.items.length} videos`;
    heading.append(title, Object.assign(document.createElement("a"), { className: "station-edit-button", href: `/youtube.html?playlist=${encodeURIComponent(playlist.id)}`, textContent: "Add videos" }));
    tracksEl.append(heading);
    if (!playlist.items.length) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = "No videos in this playlist yet.";
      tracksEl.append(empty);
    }
    for (const video of playlist.items) {
      const row = document.createElement("div");
      row.className = "station-row";
      const details = document.createElement("div");
      details.className = "station-details";
      const name = document.createElement("strong");
      name.textContent = video.title;
      const artist = document.createElement("span");
      artist.textContent = video.artist || "Artist unavailable";
      details.append(name, artist);
      row.append(details, button("Remove", () => removeTrack(playlist, video.id)));
      tracksEl.append(row);
    }
  }

  function render() {
    picker.replaceChildren(new Option("Select playlist", ""));
    for (const playlist of playlists) picker.add(new Option(`${playlist.name} (${playlist.items.length})`, playlist.id));
    picker.value = selectedId;
    listEl.replaceChildren();
    for (const playlist of playlists) {
      const row = document.createElement("div");
      row.className = "station-row";
      row.classList.toggle("selected", selectedId === playlist.id);
      const details = document.createElement("div");
      details.className = "station-details";
      const name = document.createElement("strong");
      name.textContent = playlist.name;
      const count = document.createElement("span");
      count.textContent = `${playlist.items.length} videos`;
      details.append(name, count);
      const actions = document.createElement("div");
      actions.className = "station-actions";
      const manage = button("View tracks", () => {
        selectedId = playlist.id;
        render();
        tracksEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      manage.setAttribute("aria-pressed", String(selectedId === playlist.id));
      actions.append(
        manage,
        button("Rename", () => rename(playlist)),
        button("Delete", () => removePlaylist(playlist))
      );
      row.append(details, actions);
      listEl.append(row);
    }
    renderTracks();
  }

  async function refresh() {
    const data = await request("/api/videos/playlists");
    playlists = data.playlists;
    if (!playlists.some((item) => item.id === selectedId)) selectedId = playlists[0]?.id || "";
    render();
  }

  async function update(playlist, changes, message) {
    try {
      await request(`/api/videos/playlists/${playlist.id}`, "PATCH", changes);
      await refresh();
      say(message);
    } catch (error) { say(error.message); }
  }

  function removeTrack(playlist, id) {
    update(playlist, { items: playlist.items.filter((item) => item.id !== id) }, "Video removed from playlist.");
  }

  function rename(playlist) {
    const name = prompt("Playlist name:", playlist.name);
    if (name?.trim()) update(playlist, { name: name.trim() }, `Renamed playlist to “${name.trim()}”.`);
  }

  function removePlaylist(playlist) {
    if (!confirm(`Delete “${playlist.name}”?`)) return;
    request(`/api/videos/playlists/${playlist.id}`, "DELETE").then(async () => {
      selectedId = "";
      await refresh();
      say(`Deleted “${playlist.name}”.`);
    }).catch((error) => say(error.message));
  }

  el("#video-playlist-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = el("#video-playlist-name");
    const name = input.value.trim();
    if (!name) return;
    try {
      const data = await request("/api/videos/playlists", "POST", { name });
      selectedId = data.playlist.id;
      input.value = "";
      await refresh();
      say(`Created “${data.playlist.name}”.`);
    } catch (error) { say(error.message); }
  });

  picker.addEventListener("change", () => {
    selectedId = picker.value;
    render();
    if (selectedId) tracksEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  refresh().catch((error) => say(error.message));
}
