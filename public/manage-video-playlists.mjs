export function wireManageVideoPlaylists({ el, request }) {
  const listEl = el("#video-playlist-list");
  const tracksEl = el("#video-playlist-tracks");
  const picker = el("#video-playlist-picker");
  const statusEl = el("#video-playlist-status");
  const importInput = el("#video-playlist-import-input");
  const importButton = el("#video-playlist-import-submit");
  let playlists = [];
  let selectedId = "";
  let importing = false;
  let fileItems = [];

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
    importButton.disabled = !selectedId || importing;
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

  el("#video-playlist-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      fileItems = [];
      if (file.name.toLowerCase().endsWith(".json")) {
        fileItems = extractVideoItems(JSON.parse(text));
        if (fileItems.length) importInput.value = fileItems.map((item) => item.id).join("\n");
        else {
          const urls = extractBookmarkUrls(text);
          if (!urls.length) return say(`No YouTube bookmark URLs or video entries found in ${file.name}.`);
          importInput.value = urls.join("\n");
        }
      } else if (/\.html?$/i.test(file.name)) {
        const urls = extractBookmarkHtmlUrls(text);
        if (!urls.length) return say(`No YouTube bookmark URLs found in ${file.name}.`);
        importInput.value = urls.join("\n");
      } else importInput.value = text;
      say(`Loaded ${file.name}. Choose a playlist and import.`);
    } catch (error) {
      say(error instanceof SyntaxError ? `${file.name} is not valid JSON.` : `Could not read ${file.name}.`);
    } finally { event.target.value = ""; }
  });

  el("#video-playlist-import-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const playlist = playlists.find((item) => item.id === selectedId);
    if (!playlist) return say("Select a playlist first.");
    const { videos, youtubePlaylists, items } = parseYoutubeInput(importInput.value);
    if (!videos.length && !youtubePlaylists.length) return say("No YouTube IDs, links, or playlist entries found. Paste video IDs, URLs, or a playlist JSON response.");
    importing = true;
    importButton.disabled = true;
    try {
      const known = new Set(playlist.items.map((item) => item.id));
      const imported = [];
      for (const video of [...fileItems, ...items]) {
        if (videos.includes(video.id) && !known.has(video.id)) { known.add(video.id); imported.push(video); }
      }
      for (const id of youtubePlaylists) {
        const data = await request(`/api/videos/playlist-items?id=${encodeURIComponent(id)}`);
        for (const video of data.items) {
          if (!known.has(video.id)) { known.add(video.id); imported.push(video); }
        }
      }
      const newIds = videos.filter((id) => !known.has(id));
      for (let index = 0; index < newIds.length; index += 50) {
        const data = await request(`/api/videos/details?ids=${encodeURIComponent(newIds.slice(index, index + 50).join(","))}`);
        for (const video of data.videos) {
          if (!known.has(video.id)) { known.add(video.id); imported.push(video); }
        }
      }
      const room = Math.max(0, 500 - playlist.items.length);
      const accepted = imported.slice(0, room);
      if (accepted.length) await request(`/api/videos/playlists/${playlist.id}`, "PATCH", { items: [...playlist.items, ...accepted] });
      await refresh();
      importInput.value = "";
      say(accepted.length
        ? `Imported ${accepted.length} video${accepted.length === 1 ? "" : "s"} to “${playlist.name}”.${imported.length > accepted.length ? ` ${imported.length - accepted.length} skipped: playlist limit is 500 videos.` : ""}`
        : "No new videos were added; the entries were already present or unavailable.");
    } catch (error) { say(error.message); }
    finally { importing = false; render(); }
  });

  refresh().catch((error) => say(error.message));
}

function parseYoutubeInput(text) {
  try {
    const items = extractVideoItems(JSON.parse(text));
    if (items.length) return { videos: items.map((item) => item.id), youtubePlaylists: [], items };
  } catch {}
  const entries = text.match(/(?:https?:\/\/[^\s,;<>]+)?\/api\/videos\/playlist-items\?[^\s,;<>]+|(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s,;<>]+|[\w-]{11}/gi) || [];
  const videos = new Set();
  const youtubePlaylists = new Set();
  for (const entry of entries) {
    if (/^[\w-]{11}$/.test(entry)) { videos.add(entry); continue; }
    try {
      const url = new URL(entry.replace(/^[<("']+|[>)\]"',.]+$/g, ""), "https://youtube.com");
      const host = url.hostname.replace(/^www\./, "");
      if (url.pathname === "/api/videos/playlist-items") {
        const id = url.searchParams.get("id");
        if (/^[\w-]{10,80}$/.test(id || "")) youtubePlaylists.add(id);
        continue;
      }
      if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") continue;
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0]
        : url.pathname === "/watch" ? url.searchParams.get("v")
          : ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null;
      if (/^[\w-]{11}$/.test(id || "")) videos.add(id);
      const list = url.searchParams.get("list");
      if (/^[\w-]{10,80}$/.test(list || "")) youtubePlaylists.add(list);
    } catch {}
  }
  return { videos: [...videos], youtubePlaylists: [...youtubePlaylists], items: [] };
}

function extractVideoItems(value) {
  const items = Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : [];
  return items.filter((item) => item && typeof item.id === "string" && /^[\w-]{11}$/.test(item.id) && typeof item.title === "string")
    .map((item) => ({ id: item.id, title: item.title.slice(0, 300), artist: String(item.artist || item.author || "").slice(0, 160), thumbnail: typeof item.thumbnail === "string" && item.thumbnail.startsWith("https://") ? item.thumbnail : null }));
}

function extractBookmarkUrls(text) {
  const pending = [JSON.parse(text)];
  const urls = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { pending.push(...value); continue; }
    for (const key of ["url", "uri", "href"]) {
      if (typeof value[key] === "string") urls.add(value[key]);
    }
    pending.push(...Object.values(value).filter((item) => item && typeof item === "object"));
  }
  return youtubeBookmarkUrls([...urls]);
}

function extractBookmarkHtmlUrls(text) {
  const document = new DOMParser().parseFromString(text, "text/html");
  return youtubeBookmarkUrls([...new Set([...document.querySelectorAll("a[href]")].map((anchor) => anchor.getAttribute("href")))]);
}

function youtubeBookmarkUrls(urls) {
  return urls.filter((url) => {
    const { videos, youtubePlaylists } = parseYoutubeInput(url);
    return videos.length || youtubePlaylists.length;
  });
}
