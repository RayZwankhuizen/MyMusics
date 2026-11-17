import { createYoutubeHostSync } from "./youtube-host-sync.mjs";

const $ = (selector) => document.querySelector(selector);
const queueEl = $("#video-queue");
const resultsEl = $("#video-results");
const statusEl = $("#video-status");
let queue = [];
let current = -1;
let playlists = [];
let iframePlayer;
let iframePromise;
let metadataAvailable = null;
let iframeQueueKey = "";
let queueSync = 0;
let hostSyncBlocked = true;
let preparingVideoId = "";
let resumeAfterPrepare = false;
let preparationPausePending = false;
let pageLeaving = false;
let queueCleared = false;
let loadedPlaylistId = "";
let tvPlaylistPicker;
let searchGeneration = 0;
let activeSearch = null;
let searchingMore = false;
const videoMetadata = new Map();

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  return data;
}

function say(message) {
  statusEl.textContent = message;
  if ($("#video-search-dialog")?.open) $("#video-search-status").textContent = message;
}
function playlistId() { return $("#saved-video-playlists").value; }

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.floor(seconds);
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function addDurations(items) {
  const ids = [...new Set(items.filter((item) => !Number.isFinite(item.durationSeconds) && !videoMetadata.has(item.id)).map((item) => item.id))];
  for (let offset = 0; offset < ids.length; offset += 50) {
    try {
      const data = await request(`/api/videos/details?ids=${encodeURIComponent(ids.slice(offset, offset + 50).join(","))}`);
      data.videos.forEach((video) => { videoMetadata.set(video.id, video); });
    } catch { break; }
  }
  return items.map((item) => ({ ...item, durationSeconds: item.durationSeconds ?? videoMetadata.get(item.id)?.durationSeconds }));
}

function renderTvPlaylistPicker() {
  const select = $("#saved-video-playlists");
  const tvMode = document.documentElement.classList.contains("tv-mode");
  if (!tvPlaylistPicker) {
    tvPlaylistPicker = document.createElement("div");
    tvPlaylistPicker.className = "tv-playlist-picker";
    tvPlaylistPicker.innerHTML = '<button type="button" class="tv-playlist-current" aria-expanded="false">Choose playlist</button><div class="tv-playlist-options" aria-label="Choose a playlist" hidden></div>';
    select.after(tvPlaylistPicker);
    const currentButton = tvPlaylistPicker.querySelector(".tv-playlist-current");
    const options = tvPlaylistPicker.querySelector(".tv-playlist-options");
    currentButton.addEventListener("click", () => {
      options.hidden = !options.hidden;
      currentButton.setAttribute("aria-expanded", String(!options.hidden));
      if (!options.hidden) (options.querySelector('[aria-pressed="true"]') || options.querySelector("button"))?.focus();
    });
  }
  select.hidden = tvMode;
  tvPlaylistPicker.hidden = !tvMode;
  const currentButton = tvPlaylistPicker.querySelector(".tv-playlist-current");
  const options = tvPlaylistPicker.querySelector(".tv-playlist-options");
  const selected = select.selectedOptions[0];
  currentButton.textContent = selected?.value ? selected.textContent : "Choose playlist";
  currentButton.disabled = select.options.length < 2;
  options.replaceChildren();
  for (const option of [...select.options].slice(1)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.textContent;
    button.setAttribute("aria-pressed", String(option.value === select.value));
    button.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      options.hidden = true;
      currentButton.setAttribute("aria-expanded", "false");
      currentButton.focus();
    });
    options.append(button);
  }
}

function renderList(element, items, mode) {
  element.replaceChildren();
  for (const [index, item] of items.entries()) {
    const li = document.createElement("li");
    if (mode === "queue" && index === current) li.classList.add("current");
    const image = document.createElement("img");
    image.alt = "";
    image.src = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/default.jpg`;
    const copy = document.createElement("div");
    const kind = document.createElement("span");
    kind.className = "item-kind";
    kind.textContent = mode === "playlist-results" ? "Playlist" : "Video";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;
    const author = document.createElement("div");
    author.className = "item-author";
    author.textContent = item.artist || item.author || "Artist unavailable";
    const duration = document.createElement("div");
    duration.className = "item-duration";
    duration.textContent = formatDuration(item.durationSeconds);
    copy.append(kind, title, author, duration);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const action = (label, callback, aria) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (aria) button.setAttribute("aria-label", aria);
      button.addEventListener("click", callback);
      actions.append(button);
    };
    if (mode === "results") {
      action("Play", () => { queueCleared = false; queue = [item, ...queue]; renderQueue(); playAt(0); });
      action("Add", () => { queueCleared = false; queue.push(item); renderQueue(); say(`Added “${item.title}” to the queue.`); });
      action("Add to playlist", () => addToSelectedPlaylist(item));
    } else if (mode === "playlist-results") {
      action("Show songs", () => showYoutubePlaylist(item.id, item.title));
      action("Play", async () => { await showYoutubePlaylist(item.id, item.title); if (queue.length) playAt(0); });
    } else {
      action("Play", () => playAt(index));
      action("+ Playlist", () => addToSelectedPlaylist(item));
      action("↑", () => move(index, -1), "Move up");
      action("↓", () => move(index, 1), "Move down");
      action("×", () => { queue.splice(index, 1); if (current === index) { iframePlayer?.pauseVideo(); current = -1; } else if (current > index) current--; renderQueue(); }, "Remove from queue");
    }
    li.append(image, copy, actions);
    element.append(li);
  }
}

function renderQueue() {
  renderList(queueEl, queue, "queue");
  if (!queue.length) {
    const empty = document.createElement("li");
    empty.className = "queue-empty";
    empty.textContent = "No videos loaded";
    queueEl.append(empty);
  }
  $("#queue-count").textContent = `${queue.length} ${queue.length === 1 ? "video" : "videos"}`;
  $("#clear-video-queue").disabled = !queue.length;
}

async function playAt(index) {
  if (index < 0 || index >= queue.length) return;
  queueCleared = false;
  current = index;
  const item = queue[index];
  $("#video-title").textContent = item.title;
  $("#video-author").textContent = item.author || "";
  renderQueue();
  try {
    const embed = await ensureIframePlayer();
    const ids = embed.getPlaylist?.() || [];
    await stopHostVideo();
    if (window.MyMusicsPlayback?.isHost) {
      embed.mute();
      preparingVideoId = item.id;
      resumeAfterPrepare = true;
      hostSyncBlocked = false;
      // Cue the image while MPV prepares the audio, rather than loading them sequentially.
      embed.cueVideoById(item.id);
      embed.playVideo();
    } else {
      embed.unMute();
      if (ids[index] === item.id) embed.playVideoAt(index);
      else embed.loadVideoById(item.id);
    }
    say(`Loaded “${item.title}” in the YouTube player.`);
  } catch (error) { say(error.message); }
}

function iframeError(code) {
  const messages = {
    2: "YouTube rejected the video or playlist ID.",
    5: "YouTube could not play this video in its embedded player.",
    100: "YouTube could not find this video or playlist.",
    101: "The video owner does not allow embedded playback.",
    150: "The video owner does not allow embedded playback.",
    153: "YouTube did not receive the MyMusics page address. Reload this page; the TV browser may be blocking embedded playback."
  };
  say(messages[code] || `YouTube player error ${code}.`);
}

function syncIframeQueue() {
  if (queueCleared) return;
  if (!iframePlayer?.getPlaylist) return;
  const ids = iframePlayer.getPlaylist() || [];
  if (ids.length) {
    const previous = new Map(queue.map((item) => [item.id, item]));
    const key = ids.join(",");
    if (key !== iframeQueueKey) {
      iframeQueueKey = key;
      queue = ids.map((id) => videoMetadata.get(id) || previous.get(id) || ({ id, title: "Loading title…", artist: "Loading artist…" }));
    }
    current = iframePlayer.getPlaylistIndex();
    if (current < 0) current = 0;
    showCurrentVideo();
    renderQueue();
    if (metadataAvailable !== false && ids.some((id) => !videoMetadata.has(id))) loadQueueMetadata(ids, ++queueSync);
  } else {
    showCurrentVideo();
    renderQueue();
  }
}

function videoSnapshot() {
  const videoId = iframePlayer?.getVideoData?.().video_id;
  const state = iframePlayer?.getPlayerState?.();
  const states = { 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };
  return {
    active: Boolean(!pageLeaving && !hostSyncBlocked && !queueCleared && window.MyMusicsPlayback?.isHost
      && videoId && queue[current]?.id === videoId && states[state]),
    videoId, state: states[state], time: Math.max(0, Number(iframePlayer?.getCurrentTime?.()) || 0),
    rate: iframePlayer?.getPlaybackRate?.() || 1
  };
}

const hostSync = createYoutubeHostSync({
  snapshot: videoSnapshot, request,
  onSession: (sessionId) => window.MyMusicsPlayback?.setHostSession(sessionId),
  onPrepared: (videoId) => {
    if (preparingVideoId !== videoId) return;
    preparingVideoId = "";
    if (resumeAfterPrepare && window.MyMusicsPlayback?.isHost && !pageLeaving) iframePlayer?.playVideo();
    resumeAfterPrepare = false;
  },
  onError: (error) => {
    if (error.status === 409) hostSyncBlocked = true;
    say(`Host audio synchronization failed: ${error.message}`);
  }
});
const hostSyncTimer = setInterval(() => { void hostSync.sync(); }, 500);

function startHostVideo() {
  hostSyncBlocked = false;
  return hostSync.sync();
}

function stopHostVideo(keepalive = false) {
  hostSyncBlocked = true;
  preparingVideoId = "";
  resumeAfterPrepare = false;
  return hostSync.sync({ keepalive });
}

function prepareHostVideo(videoId, resume) {
  preparingVideoId = videoId;
  resumeAfterPrepare = resume;
  hostSyncBlocked = false;
  if (iframePlayer.getPlayerState?.() === YT.PlayerState.PLAYING) {
    preparationPausePending = true;
    iframePlayer.pauseVideo();
  }
  void hostSync.sync();
}

function showCurrentVideo() {
  const info = iframePlayer?.getVideoData?.() || {};
  const item = queue[current];
  if (item && info.title && !videoMetadata.has(item.id)) {
    item.title = info.title;
    item.artist = info.author || item.artist || "Artist unavailable";
  }
  $("#video-title").textContent = info.title || item?.title || "Choose a video";
  $("#video-author").textContent = info.author || item?.artist || "";
}

async function loadQueueMetadata(ids, generation) {
  try {
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50).filter((id) => !videoMetadata.has(id));
      if (!chunk.length) continue;
      const data = await request(`/api/videos/details?ids=${encodeURIComponent(chunk.join(","))}`);
      data.videos.forEach((video) => { videoMetadata.set(video.id, video); });
    }
    if (generation !== queueSync || ids.join(",") !== iframeQueueKey) return;
    queue = ids.map((id) => videoMetadata.get(id) || ({ id, title: "Video title unavailable", artist: "Artist unavailable" }));
    showCurrentVideo();
    renderQueue();
  } catch (error) {
    if (generation !== queueSync) return;
    metadataAvailable = false;
    queue = ids.map((id) => videoMetadata.get(id) || ({ id, title: "Video title unavailable", artist: "Artist unavailable" }));
    showCurrentVideo();
    renderQueue();
    say(error.message);
  }
}

function ensureIframePlayer() {
  if (iframePlayer && window.YT?.Player) return Promise.resolve(iframePlayer);
  if (iframePromise) return iframePromise;
  iframePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("YouTube IFrame API did not load. Check network or browser blocking.")), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      iframePlayer = new YT.Player("youtube-player", {
        width: "100%", height: "100%",
        playerVars: { playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (event) => { clearTimeout(timer); resolve(event.target); },
          onStateChange: (event) => {
            if (pageLeaving) return;
            if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.CUED) syncIframeQueue();
            if (event.data === YT.PlayerState.CUED && resumeAfterPrepare && !preparingVideoId) {
              preparingVideoId = iframePlayer.getVideoData?.().video_id || "";
            }
            if (window.MyMusicsPlayback?.isHost) {
              iframePlayer.mute();
              const id = iframePlayer.getVideoData?.().video_id;
              if (event.data === YT.PlayerState.PLAYING && id && (hostSync.videoId !== id || !hostSync.ready)) {
                prepareHostVideo(id, true);
              } else if (event.data === YT.PlayerState.PAUSED) {
                if (preparationPausePending) preparationPausePending = false;
                else if (preparingVideoId === id) resumeAfterPrepare = false;
              }
              if ([YT.PlayerState.PLAYING, YT.PlayerState.CUED].includes(event.data)) hostSyncBlocked = false;
              void hostSync.sync();
            } else if (event.data === YT.PlayerState.PLAYING) say("Playing in YouTube’s player.");
            if (event.data === YT.PlayerState.ENDED && !queueCleared && current + 1 < queue.length) playAt(current + 1);
          },
          onPlaybackRateChange: () => { void hostSync.sync(); },
          onError: (event) => { void stopHostVideo(); iframeError(event.data); },
          onAutoplayBlocked: () => say("Autoplay was blocked. Press Play in YouTube’s player.")
        }
      });
    };
    if (window.YT?.Player) return window.onYouTubeIframeAPIReady();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { clearTimeout(timer); reject(new Error("Could not load YouTube IFrame API.")); };
    document.head.append(script);
  }).catch((error) => { iframePromise = null; throw error; });
  return iframePromise;
}

function move(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= queue.length) return;
  [queue[index], queue[target]] = [queue[target], queue[index]];
  if (current === index) current = target;
  else if (current === target) current = index;
  renderQueue();
}

async function refreshPlaylists(selected = playlistId()) {
  const data = await request("/api/videos/playlists");
  playlists = data.playlists;
  const select = $("#saved-video-playlists");
  select.replaceChildren(new Option("Select playlist", ""));
  for (const list of playlists) select.add(new Option(`${list.name} (${list.items.length})`, list.id));
  select.value = selected;
  $("#play-video-playlist").disabled = !select.value;
  renderTvPlaylistPicker();
}

async function updateSelectedPlaylist(items, message) {
  const selected = playlists.find((item) => item.id === playlistId());
  if (!selected) return say("Choose or create a playlist first.");
  try {
    const data = await request(`/api/videos/playlists/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
    });
    await refreshPlaylists(data.playlist.id);
    say(message(data.playlist));
    return data.playlist;
  } catch (error) { say(error.message); }
}

async function addToSelectedPlaylist(item) {
  const selected = playlists.find((list) => list.id === playlistId());
  if (!selected) return say("Choose or create a playlist first.");
  if (selected.items.some((video) => video.id === item.id)) return say(`“${item.title}” is already in “${selected.name}”.`);
  const updated = await updateSelectedPlaylist([...selected.items, item], (list) => `Added “${item.title}” to “${list.name}”.`);
  if (updated && loadedPlaylistId === selected.id) {
    queue = selected.items.concat(item).map((video) => ({ ...video }));
    renderQueue();
  }
}

function clearSearchResults() {
  searchGeneration++;
  activeSearch = null;
  searchingMore = false;
  $("#video-search-more").hidden = true;
  resultsEl.replaceChildren();
  $("#results-heading").hidden = true;
  $("#clear-video-results").hidden = true;
}


async function loadYoutubePlaylist(list) {
  try {
    queueCleared = false;
    current = -1;
    iframeQueueKey = "";
    queue = [];
    loadedPlaylistId = "";
    $("#queue-heading").textContent = "YouTube playlist";
    clearSearchResults();
    renderQueue();
    const embed = await ensureIframePlayer();
    await stopHostVideo();
    if (window.MyMusicsPlayback?.isHost) {
      embed.mute();
      hostSyncBlocked = false;
      // Playlist IDs become available when YouTube sends its CUED event.
      resumeAfterPrepare = true;
      embed.cuePlaylist({ listType: "playlist", list, index: 0 });
      embed.playVideo();
    } else {
      embed.unMute();
      embed.loadPlaylist({ listType: "playlist", list, index: 0 });
    }
    say("Loading the YouTube playlist in the player…");
  } catch (error) { say(error.message); }
}

async function showYoutubePlaylist(list, title) {
  queueCleared = false;
  queue = [];
  loadedPlaylistId = "";
  current = -1;
  renderQueue();
  try {
    say(`Loading songs from “${title}”…`);
    const data = await request(`/api/videos/playlist-items?id=${encodeURIComponent(list)}`);
    queue = await addDurations(data.items);
    current = -1;
    iframeQueueKey = "";
    $("#queue-heading").textContent = title;
    renderQueue();
    say(`Loaded ${queue.length} songs from “${title}”.`);
  } catch (error) { say(error.message); }
}

async function loadSavedPlaylist(selected, play = false) {
  queueCleared = true;
  queueSync++;
  iframeQueueKey = "";
  iframePlayer?.stopVideo?.();
  iframePlayer?.clearVideo?.();
  await stopHostVideo();
  current = -1;
  queue = await addDurations(selected.items.map((item) => ({ ...item })));
  loadedPlaylistId = selected.id;
  queueCleared = false;
  clearSearchResults();
  $("#queue-heading").textContent = selected.name;
  $("#video-title").textContent = "Choose a video";
  $("#video-author").textContent = "";
  renderQueue();
  if (!queue.length) return say(`“${selected.name}” is empty.`);
  say(`Loaded ${queue.length} tracks from “${selected.name}”.`);
  if (play) playAt(0);
}

function wireVideoDialog(buttonId, dialogId, sections, focusSelector) {
  const button = $(buttonId);
  const dialog = $(dialogId);
  const body = dialog.querySelector(".video-dialog-body");
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".video-dialog[open]")) other.close();
    for (const [contentId] of sections) body.append($(contentId));
    dialog.showModal();
    (dialog.querySelector(focusSelector) || dialog.querySelector("button"))?.focus();
  });
  dialog.querySelector("[data-close-video-dialog]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    for (const [contentId, homeId] of sections) $(homeId).append($(contentId));
    button.focus();
  });
}
wireVideoDialog("#open-video-search", "#video-search-dialog", [
  ["#video-search-controls", "#video-search-home"], ["#video-results-content", "#video-results-home"]
], "#video-query");
wireVideoDialog("#open-video-queue", "#video-queue-dialog", [["#video-queue-content", "#video-queue-home"]], "#video-queue button");

async function searchVideos(mode, query, append = false) {
  if (append && (searchingMore || !activeSearch?.nextPageToken)) return;
  const generation = append ? searchGeneration : ++searchGeneration;
  const previous = append ? activeSearch.items : [];
  const token = append ? activeSearch.nextPageToken : "";
  if (!append) activeSearch = { mode, query, items: [], nextPageToken: "" };
  searchingMore = true;
  const more = $("#video-search-more");
  more.disabled = true;
  if (!append) more.hidden = true;
  more.textContent = "Searching…";
  try {
    say(append ? "Loading more results…" : "Searching YouTube…");
    const params = new URLSearchParams({ q: query, ...(token ? { pageToken: token } : {}) });
    const data = await request(`/api/videos/${mode === "playlist-results" ? "search-playlists" : "search"}?${params}`);
    if (mode === "results") data.results = await addDurations(data.results);
    if (generation !== searchGeneration) return;
    const items = [...new Map([...previous, ...data.results].map((item) => [item.id, item])).values()];
    activeSearch = { mode, query, items, nextPageToken: data.nextPageToken || "" };
    renderList(resultsEl, items, mode);
    $("#results-heading").textContent = `${mode === "playlist-results" ? "YouTube playlists" : "Search results"} (${items.length})`;
    $("#results-heading").hidden = false;
    $("#clear-video-results").hidden = false;
    more.hidden = !activeSearch.nextPageToken;
    say(items.length ? `Showing ${items.length} results.` : "No results found. Try another search.");
    if (append) resultsEl.children[previous.length]?.querySelector("button")?.focus();
  } catch (error) {
    if (generation === searchGeneration) say(error.message);
  } finally {
    if (generation === searchGeneration) {
      searchingMore = false;
      more.disabled = false;
      more.textContent = "Search more";
    }
  }
}
for (const [formId, inputId, mode] of [["#video-search", "#video-query", "results"], ["#video-playlist-search", "#video-playlist-query", "playlist-results"]]) {
  $(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try { await searchVideos(mode, $(inputId).value.trim()); }
    finally { button.disabled = false; }
  });
}
$("#video-search-more").addEventListener("click", () => {
  if (activeSearch) void searchVideos(activeSearch.mode, activeSearch.query, true);
});

$("#video-load-playlist").addEventListener("submit", async (event) => {
  event.preventDefault();
  event.submitter.disabled = true;
  event.submitter.textContent = "Loading…";
  try {
    const url = new URL($("#video-playlist-url").value.trim());
    if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== "youtu.be") throw new Error("Enter a YouTube video or playlist link.");
    const list = url.searchParams.get("list");
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
    if (!list && !id) throw new Error("This link has no video or playlist ID.");
    if (list) { await loadYoutubePlaylist(list); return; }
    iframeQueueKey = "";
    queue = [{ id, title: "Loading title…", artist: "Loading artist…" }];
    loadedPlaylistId = "";
    $("#queue-heading").textContent = "Queue";
    clearSearchResults();
    renderQueue();
    await playAt(0);
  } catch (error) { say(error.message); }
  finally { event.submitter.disabled = false; event.submitter.textContent = "Load"; }
});

$("#saved-video-playlists").addEventListener("change", () => {
  const selected = playlists.find((item) => item.id === playlistId());
  $("#play-video-playlist").disabled = !selected;
  renderTvPlaylistPicker();
  if (selected) loadSavedPlaylist(selected);
});

window.addEventListener("mymusics:tv-mode-change", renderTvPlaylistPicker);

$("#play-video-playlist").addEventListener("click", () => {
  const selected = playlists.find((item) => item.id === playlistId());
  if (!selected) return say("Choose a saved playlist first.");
  loadSavedPlaylist(selected, true);
});

$("#clear-video-queue").addEventListener("click", async () => {
  queueCleared = true;
  queueSync++;
  iframeQueueKey = "";
  queue = [];
  loadedPlaylistId = "";
  current = -1;
  iframePlayer?.stopVideo?.();
  iframePlayer?.clearVideo?.();
  await stopHostVideo();
  $("#queue-heading").textContent = "Queue";
  $("#video-title").textContent = "Choose a video";
  $("#video-author").textContent = "";
  renderQueue();
  say("YouTube queue cleared.");
});

window.addEventListener("mymusics:playback-target-change", async () => {
  const embed = await ensureIframePlayer().catch(() => null);
  if (!embed) return;
  if (window.MyMusicsPlayback?.isHost) {
    embed.mute();
    const item = queue[current];
    if (item) {
      prepareHostVideo(item.id, embed.getPlayerState?.() === YT.PlayerState.PLAYING);
      await startHostVideo();
    }
  } else {
    await stopHostVideo();
    embed.unMute();
  }
});

$("#clear-video-results").addEventListener("click", () => {
  clearSearchResults();
  say("Showing playlist only.");
});

window.addEventListener("pagehide", () => {
  pageLeaving = true;
  iframePlayer?.stopVideo?.();
  clearInterval(hostSyncTimer);
  void stopHostVideo(true);
});

$("#previous-video").addEventListener("click", () => playAt(Math.max(0, current - 1)));
$("#next-video").addEventListener("click", () => playAt(current + 1));
Promise.all([
  request("/api/videos/status").then((data) => {
    metadataAvailable = data.metadataAvailable;
    say(data.searchAvailable
      ? "YouTube player ready. Search and queue titles are enabled."
      : "Playback works. Add YOUTUBE_API_KEY for search and queue titles.");
  }),
  refreshPlaylists(new URLSearchParams(location.search).get("playlist") || "")
]).then(() => {
  const initial = playlists.find((item) => item.id === playlistId());
  if (initial) loadSavedPlaylist(initial);
}).catch((error) => say(error.message));
