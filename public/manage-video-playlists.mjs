export function wireManageVideoPlaylists({ el, request }) {
  const listEl = el("#video-playlist-list");
  const tracksEl = el("#video-playlist-tracks");
  const picker = el("#video-playlist-picker");
  const moveDialog = el("#video-move-dialog");
  const moveForm = el("#video-move-form");
  const moveTarget = el("#video-move-target");
  const moveDescription = el("#video-move-description");
  const statusEl = el("#video-playlist-status");
  const importInput = el("#video-playlist-import-input");
  const previewButton = el("#video-playlist-preview-button");
  const previewPanel = el("#video-playlist-preview");
  const previewList = el("#video-playlist-preview-list");
  const previewCount = el("#video-playlist-preview-count");
  const importButton = el("#video-playlist-import-submit");
  let playlists = [];
  let selectedId = "";
  let pendingMove = null;
  let infoVideoId = "";
  let importing = false;
  let loadingPreview = false;
  let previewReady = false;
  let previewItems = [];
  let fileItems = [];

  const say = (message) => { statusEl.textContent = message; };
  function updatePreviewControls() {
    const selected = previewItems.filter((item) => item.selected).length;
    previewPanel.hidden = !previewReady;
    previewCount.textContent = `${selected} of ${previewItems.length} selected`;
    importButton.hidden = !previewReady;
    importButton.disabled = !selectedId || !selected || importing;
    previewButton.disabled = loadingPreview || importing;
  }

  function renderPreview() {
    previewList.replaceChildren();
    for (const item of previewItems) {
      const row = document.createElement("label");
      row.className = "video-import-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.selected;
      checkbox.setAttribute("aria-label", `Select ${item.title}`);
      checkbox.addEventListener("change", () => {
        item.selected = checkbox.checked;
        updatePreviewControls();
      });
      const details = document.createElement("span");
      details.className = "video-import-details";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const artist = document.createElement("span");
      artist.textContent = item.artist || "Artist unavailable";
      const id = document.createElement("code");
      id.textContent = item.id;
      details.append(title, artist, id);
      row.append(checkbox);
      if (item.thumbnail) {
        const image = document.createElement("img");
        image.src = item.thumbnail;
        image.alt = "";
        image.loading = "lazy";
        row.append(image);
      } else row.append(Object.assign(document.createElement("span"), { className: "video-import-thumbnail-placeholder", "aria-hidden": "true" }));
      row.append(details);
      previewList.append(row);
    }
    updatePreviewControls();
  }
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
    const list = document.createElement("div");
    list.className = "video-track-list";
    for (const video of playlist.items) {
      const entry = document.createElement("div");
      entry.className = "video-track-entry";
      const row = document.createElement("div");
      row.className = "station-row video-track-row";
      const image = document.createElement("img");
      image.className = "video-track-thumbnail";
      image.src = video.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`;
      image.alt = "";
      image.loading = "lazy";
      const details = document.createElement("div");
      details.className = "station-details video-track-details";
      const name = document.createElement("strong");
      name.textContent = video.title;
      const artist = document.createElement("span");
      artist.textContent = video.artist || "Artist unavailable";
      const genre = document.createElement("span");
      genre.textContent = video.genre ? `Genre: ${video.genre}` : "Genre: —";
      details.append(name, artist, genre);
      const actions = document.createElement("div");
      actions.className = "station-actions video-track-actions";
      const move = button("Move", () => openMoveDialog(playlist, video));
      actions.append(
        button(infoVideoId === video.id ? "Hide info" : "Info", () => {
          infoVideoId = infoVideoId === video.id ? "" : video.id;
          renderTracks();
        }),
        button("Edit", () => entry.querySelector(".video-track-edit").open = !entry.querySelector(".video-track-edit").open),
        move,
        button("Remove", () => removeTrack(playlist, video.id))
      );
      row.append(image, details, actions);
      entry.append(row);

      const edit = document.createElement("details");
      edit.className = "video-track-edit";
      const summary = document.createElement("summary");
      summary.textContent = "Edit title, artist and genre";
      const form = document.createElement("form");
      form.className = "video-track-edit-form";
      for (const [field, label, value, maxLength] of [
        ["title", "Title", video.title, 300],
        ["artist", "Artist", video.artist || "", 160],
        ["genre", "Genre", video.genre || "", 80]
      ]) {
        const wrapper = document.createElement("label");
        wrapper.textContent = label;
        const input = document.createElement("input");
        input.name = field;
        input.value = value;
        input.maxLength = maxLength;
        input.required = field === "title";
        wrapper.append(input);
        form.append(wrapper);
      }
      const save = document.createElement("button");
      save.className = "station-edit-button";
      save.textContent = "Save details";
      form.append(save);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        update(playlist, { items: playlist.items.map((item) => item.id === video.id ? { ...item, ...values } : item) }, "Video details saved.");
      });
      edit.append(summary, form);
      entry.append(edit);

      if (infoVideoId === video.id) {
        const info = document.createElement("div");
        info.className = "video-track-info";
        const player = document.createElement("iframe");
        player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?rel=0`;
        player.title = `Video information: ${video.title}`;
        player.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
        player.allowFullscreen = true;
        const meta = document.createElement("div");
        meta.className = "video-track-info-copy";
        for (const [label, value] of [["ID", video.id], ["Title", video.title], ["Artist", video.artist || "Artist unavailable"], ["Genre", video.genre || "Genre unavailable"]]) {
          const line = document.createElement("p");
          line.textContent = `${label}: ${value}`;
          meta.append(line);
        }
        info.append(player, meta);
        entry.append(info);
      }
      list.append(entry);
    }
    tracksEl.append(list);
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
    updatePreviewControls();
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

  function openMoveDialog(playlist, video) {
    const destinations = playlists.filter((item) => item.id !== playlist.id);
    if (!destinations.length) return say("Create another playlist before moving this video.");
    pendingMove = { playlist, video };
    moveDescription.textContent = `Move “${video.title}” from “${playlist.name}” to:`;
    moveTarget.replaceChildren(new Option("Select playlist", ""));
    for (const item of destinations) moveTarget.add(new Option(`${item.name} (${item.items.length})`, item.id));
    moveForm.querySelector('[type="submit"]').disabled = true;
    moveDialog.showModal();
    moveTarget.focus();
  }

  async function moveTrack(playlist, video, destinationId) {
    if (!destinationId || destinationId === playlist.id) { say("Choose another playlist first."); return false; }
    const destination = playlists.find((item) => item.id === destinationId);
    if (!destination) { say("Choose a valid destination playlist."); return false; }
    try {
      const result = await request(`/api/videos/playlists/${playlist.id}/move`, "POST", { videoId: video.id, targetPlaylistId: destination.id });
      infoVideoId = "";
      await refresh(playlist.id);
      say(result.alreadyPresent
        ? `Moved “${video.title}” to “${destination.name}”; it was already there.`
        : `Moved “${video.title}” to “${destination.name}”.`);
      return true;
    } catch (error) { say(error.message); return false; }
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

  moveTarget.addEventListener("change", () => { moveForm.querySelector('[type="submit"]').disabled = !moveTarget.value; });
  el("#video-move-cancel").addEventListener("click", () => moveDialog.close());
  moveDialog.addEventListener("close", () => { pendingMove = null; });
  moveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pendingMove) return;
    const { playlist, video } = pendingMove;
    const submit = moveForm.querySelector('[type="submit"]');
    submit.disabled = true;
    if (await moveTrack(playlist, video, moveTarget.value)) moveDialog.close();
    else submit.disabled = !moveTarget.value;
  });

  async function loadPreview() {
    previewReady = false;
    previewItems = [];
    loadingPreview = true;
    renderPreview();
    const { videos, youtubePlaylists, items } = parseYoutubeInput(importInput.value);
    if (!videos.length && !youtubePlaylists.length) {
      loadingPreview = false;
      renderPreview();
      return say("No YouTube IDs, links, or playlist entries found.");
    }
    say("Loading video details…");
    try {
      const found = new Map();
      for (const video of [...fileItems, ...items]) {
        if (videos.includes(video.id) && !found.has(video.id)) found.set(video.id, video);
      }
      for (const id of youtubePlaylists) {
        const data = await request(`/api/videos/playlist-items?id=${encodeURIComponent(id)}`);
        for (const video of data.items) if (!found.has(video.id)) found.set(video.id, video);
      }
      const newIds = videos.filter((id) => !found.has(id));
      for (let index = 0; index < newIds.length; index += 50) {
        const data = await request(`/api/videos/details?ids=${encodeURIComponent(newIds.slice(index, index + 50).join(","))}`);
        for (const video of data.videos) if (!found.has(video.id)) found.set(video.id, video);
      }
      previewItems = [...found.values()].map((video) => ({ ...video, selected: true }));
      previewReady = true;
      renderPreview();
      say(previewItems.length ? `Loaded ${previewItems.length} videos. Review and select what to import.` : "No video details were returned.");
    } catch (error) { say(error.message); }
    finally { loadingPreview = false; renderPreview(); }
  }

  el("#video-playlist-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    previewReady = false;
    previewItems = [];
    fileItems = [];
    renderPreview();
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const value = JSON.parse(text);
        fileItems = extractVideoItems(value);
        if (!fileItems.length) fileItems = extractJsonBookmarkItems(value);
        if (!fileItems.length) return say(`No YouTube video bookmarks found in ${file.name}.`);
        importInput.value = fileItems.map((item) => item.id).join("\n");
      } else if (/\.html?$/i.test(file.name)) {
        fileItems = extractHtmlBookmarkItems(text);
        if (!fileItems.length) return say(`No individual YouTube video bookmarks found in ${file.name}. Playlist-only bookmarks do not contain their video details.`);
        importInput.value = fileItems.map((item) => item.id).join("\n");
      } else importInput.value = text;
      say(`Loaded ${file.name}. Preparing the preview from its bookmark data…`);
      await loadPreview();
    } catch (error) {
      say(error instanceof SyntaxError ? `${file.name} is not valid JSON.` : `Could not read ${file.name}.`);
    } finally { event.target.value = ""; }
  });

  previewButton.addEventListener("click", loadPreview);
  importInput.addEventListener("input", () => {
    fileItems = [];
    previewReady = false;
    previewItems = [];
    renderPreview();
  });
  el("#video-playlist-select-all").addEventListener("click", () => {
    previewItems.forEach((item) => { item.selected = true; });
    renderPreview();
  });
  el("#video-playlist-select-none").addEventListener("click", () => {
    previewItems.forEach((item) => { item.selected = false; });
    renderPreview();
  });

  importButton.addEventListener("click", async () => {
    const playlist = playlists.find((item) => item.id === selectedId);
    if (!playlist) return say("Select a playlist first.");
    const selected = previewItems.filter((item) => item.selected);
    if (!selected.length) return say("Select at least one video to import.");
    importing = true;
    renderPreview();
    try {
      const data = await request("/api/videos/playlists");
      const latest = data.playlists.find((item) => item.id === selectedId);
      if (!latest) throw new Error("The selected playlist no longer exists. Reload playlists and try again.");
      const known = new Set(latest.items.map((item) => item.id));
      const additions = selected.filter((item) => !known.has(item.id));
      const accepted = additions.slice(0, Math.max(0, 500 - latest.items.length));
      if (accepted.length) await request(`/api/videos/playlists/${latest.id}`, "PATCH", { items: [...latest.items, ...accepted] });
      await refresh();
      previewItems = [];
      previewReady = false;
      importInput.value = "";
      renderPreview();
      say(accepted.length
        ? `Imported ${accepted.length} video${accepted.length === 1 ? "" : "s"} to “${latest.name}”.${additions.length > accepted.length ? ` ${additions.length - accepted.length} skipped: playlist limit is 500 videos.` : ""}`
        : "No videos were added; the selected videos are already in this playlist.");
    } catch (error) { say(error.message); }
    finally { importing = false; render(); renderPreview(); }
  });

  refresh().catch((error) => say(error.message));
}

function parseYoutubeInput(text) {
  try {
    const items = extractVideoItems(JSON.parse(text));
    if (items.length) return { videos: items.map((item) => item.id), youtubePlaylists: [], items };
  } catch {}
  const urlPattern = /(?:https?:\/\/[^\s,;<>]+)?\/api\/videos\/playlist-items\?[^\s,;<>]+|(?:https?:\/\/|www\.)[^\s,;<>]+|(?:[\w-]+\.)+[a-z]{2,}\/[^\s,;<>]+/gi;
  const urls = text.match(urlPattern) || [];
  const ids = text.replace(urlPattern, " ").split(/[\s,;]+/).map((entry) => entry.replace(/^[<("']+|[>)\]"',.]+$/g, "")).filter((entry) => /^[\w-]{11}$/.test(entry));
  const entries = [...urls, ...ids];
  const videos = new Set();
  const youtubePlaylists = new Set();
  for (const entry of entries) {
    if (/^[\w-]{11}$/.test(entry)) { videos.add(entry); continue; }
    try {
      const cleaned = entry.replace(/^[<("']+|[>)\]"',.]+$/g, "");
      const url = new URL(cleaned.startsWith("/") ? cleaned : /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`, "https://youtube.com");
      const host = url.hostname.replace(/^www\./, "");
      if (url.pathname === "/api/videos/playlist-items") {
        const id = url.searchParams.get("id");
        if (/^[\w-]{10,80}$/.test(id || "")) youtubePlaylists.add(id);
        continue;
      }
      if (!isVideoHost(host)) continue;
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0]
        : url.pathname === "/watch" ? url.searchParams.get("v")
          : ["shorts", "embed", "live"].includes(parts[0]) ? parts[1]
            : host === "vevo.com" ? url.searchParams.get("v") || url.searchParams.get("videoId") || parts.find((part) => /^[\w-]{11}$/.test(part)) : null;
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

function extractJsonBookmarkItems(value) {
  const pending = [value];
  const items = new Map();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { pending.push(...value); continue; }
    const url = [value.url, value.uri, value.href].find((candidate) => typeof candidate === "string");
    if (url) for (const item of bookmarkItems(url, value.title || value.name, value.artist || value.author)) items.set(item.id, item);
    pending.push(...Object.values(value).filter((item) => item && typeof item === "object"));
  }
  return [...items.values()];
}

function extractHtmlBookmarkItems(text) {
  const document = new DOMParser().parseFromString(text, "text/html");
  const items = new Map();
  for (const anchor of document.querySelectorAll("a[href]")) {
    for (const item of bookmarkItems(anchor.getAttribute("href"), anchor.textContent.trim(), anchor.getAttribute("data-artist"))) {
      items.set(item.id, item);
    }
  }
  return [...items.values()];
}

function bookmarkItems(url, title, artist) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return []; }
  if (!isVideoHost(parsedUrl.hostname.replace(/^www\./, ""))) return [];
  const { videos } = parseYoutubeInput(url);
  return videos.map((id) => ({
    id,
    title: String(title || id).trim().slice(0, 300),
    artist: String(artist || "").trim().slice(0, 160),
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
  }));
}

function isVideoHost(host) {
  return ["youtube.com", "youtu.be", "youtube-nocookie.com", "vevo.com"]
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}
