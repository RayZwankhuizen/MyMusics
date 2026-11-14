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
let hostVideoId = "";
let queueCleared = false;
const videoMetadata = new Map();

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function say(message) { statusEl.textContent = message; }
function playlistId() { return $("#saved-video-playlists").value; }

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
    kind.textContent = mode === "playlist-results" ? "PLAYLIST" : "VIDEO";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;
    const author = document.createElement("div");
    author.className = "item-author";
    author.textContent = item.artist || item.author || "Artist unavailable";
    copy.append(kind, title, author);
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
      action("+ Playlist", () => addToSelectedPlaylist(item));
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
    if (window.MyMusicsPlayback?.isHost) {
      embed.mute();
      await startHostVideo(item.id);
    } else {
      await stopHostVideo();
      embed.unMute();
    }
    if (ids[index] === item.id) embed.playVideoAt(index);
    else embed.loadVideoById(item.id);
    say(`Loaded “${item.title}” in the YouTube player.`);
  } catch (error) { say(error.message); }
}

function iframeError(code) {
  const messages = {
    2: "YouTube rejected the video or playlist ID.",
    5: "YouTube could not play this video in its embedded player.",
    100: "YouTube could not find this video or playlist.",
    101: "The video owner does not allow embedded playback.",
    150: "The video owner does not allow embedded playback."
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

async function startHostVideo(videoId) {
  if (hostVideoId === videoId) return hostControl("resume");
  try {
    await request("/api/host-player/video", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId })
    });
    hostVideoId = videoId;
    say("YouTube video audio is playing on the MyMusics host; video is shown here.");
  } catch (error) { hostVideoId = ""; say(`Host audio failed: ${error.message}`); }
}

function hostControl(action) {
  return request("/api/host-player/control", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, deck: "a" })
  }).catch((error) => say(`Host audio control failed: ${error.message}`));
}

async function stopHostVideo() {
  if (!hostVideoId) return;
  hostVideoId = "";
  await hostControl("stop");
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
            if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.CUED) syncIframeQueue();
            if (event.data === YT.PlayerState.PLAYING) {
              const id = queue[current]?.id;
              if (window.MyMusicsPlayback?.isHost && id) void startHostVideo(id);
              else say("Playing in YouTube’s player.");
            }
            if (event.data === YT.PlayerState.PAUSED && window.MyMusicsPlayback?.isHost && hostVideoId) void hostControl("pause");
            if (event.data === YT.PlayerState.ENDED && current + 1 < queue.length) playAt(current + 1);
          },
          onError: (event) => iframeError(event.data),
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
  await updateSelectedPlaylist([...selected.items, item], (list) => `Added “${item.title}” to “${list.name}”.`);
}


async function loadYoutubePlaylist(list) {
  try {
    queueCleared = false;
    current = -1;
    iframeQueueKey = "";
    queue = [];
    $("#queue-heading").textContent = "YouTube playlist";
    resultsEl.replaceChildren();
    $("#results-heading").hidden = true;
    renderQueue();
    const embed = await ensureIframePlayer();
    if (window.MyMusicsPlayback?.isHost) embed.mute();
    else { await stopHostVideo(); embed.unMute(); }
    embed.loadPlaylist({ listType: "playlist", list, index: 0 });
    say("Loading the YouTube playlist in the player…");
  } catch (error) { say(error.message); }
}

async function showYoutubePlaylist(list, title) {
  queueCleared = false;
  queue = [];
  current = -1;
  renderQueue();
  try {
    say(`Loading songs from “${title}”…`);
    const data = await request(`/api/videos/playlist-items?id=${encodeURIComponent(list)}`);
    queue = data.items;
    current = -1;
    iframeQueueKey = "";
    $("#queue-heading").textContent = title;
    renderQueue();
    say(`Loaded ${queue.length} songs from “${title}”.`);
  } catch (error) { say(error.message); }
}

$("#video-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#video-query").value.trim();
  event.submitter.disabled = true;
  event.submitter.textContent = "Searching…";
  try {
    say("Searching YouTube…");
    const data = await request(`/api/videos/search?q=${encodeURIComponent(query)}`);
    renderList(resultsEl, data.results, "results");
    $("#queue-heading").textContent = "Queue";
    $("#results-heading").textContent = `Search results (${data.results.length})`;
    $("#results-heading").hidden = false;
    say(`Found ${data.results.length} videos.`);
  } catch (error) { say(error.message); }
  finally { event.submitter.disabled = false; event.submitter.textContent = "Search"; }
});

$("#video-playlist-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#video-playlist-query").value.trim();
  event.submitter.disabled = true;
  event.submitter.textContent = "Searching…";
  try {
    say("Searching YouTube playlists…");
    const data = await request(`/api/videos/search-playlists?q=${encodeURIComponent(query)}`);
    renderList(resultsEl, data.results, "playlist-results");
    $("#results-heading").textContent = `YouTube playlists (${data.results.length})`;
    $("#results-heading").hidden = false;
    say(`Found ${data.results.length} playlists.`);
  } catch (error) { say(error.message); }
  finally { event.submitter.disabled = false; event.submitter.textContent = "Search playlists"; }
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
    $("#queue-heading").textContent = "Queue";
    resultsEl.replaceChildren();
    $("#results-heading").hidden = true;
    renderQueue();
    await playAt(0);
  } catch (error) { say(error.message); }
  finally { event.submitter.disabled = false; event.submitter.textContent = "Load"; }
});

$("#saved-video-playlists").addEventListener("change", () => {
  $("#play-video-playlist").disabled = !playlistId();
});

$("#play-video-playlist").addEventListener("click", () => {
  const selected = playlists.find((item) => item.id === playlistId());
  if (!selected) return say("Choose a saved playlist first.");
  queue = selected.items.map((item) => ({ ...item }));
  current = -1;
  $("#queue-heading").textContent = selected.name;
  renderQueue();
  if (!queue.length) return say("This playlist is empty.");
  playAt(0);
});

$("#clear-video-queue").addEventListener("click", async () => {
  queueCleared = true;
  queueSync++;
  iframeQueueKey = "";
  queue = [];
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
    if (item) await startHostVideo(item.id);
  } else {
    await stopHostVideo();
    embed.unMute();
  }
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
]).catch((error) => say(error.message));
