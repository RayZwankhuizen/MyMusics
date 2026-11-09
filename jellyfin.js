const fetch = require("node-fetch");
const createAutoDj = require("./jellyfin-autodj");
const createJellyfinCatalog = require("./jellyfin-catalog");

// Server-side Jellyfin client for the music mode. Every request stays on this
// server so the API key never reaches the browser and Web Audio keeps working
// on same-origin audio.
// Container is what lets the browser decide whether it can decode a track
// itself. Jellyfin reports it only when asked for it explicitly.
const requestTimeout = 10000;
const userCacheTtl = 600000;

let cachedUserId = "";
let cachedUserIdAt = 0;
let userLookup;

function clearCache() {
  cachedUserId = "";
  cachedUserIdAt = 0;
  userLookup = null;
  catalog.clearCache();
}

async function refreshLibrary() {
  const { url } = config();
  if (!url) throw new Error("Jellyfin is not configured.");
  const response = await fetch(`${url}/Library/Refresh`, {
    method: "POST",
    headers: { ...authHeaders() },
    timeout: requestTimeout
  });
  if (!response.ok) throw new Error(`Jellyfin refresh failed (${response.status}).`);
  return true;
}

async function libraryRefreshStatus() {
  const { url } = config();
  if (!url) throw new Error("Jellyfin is not configured.");
  const response = await fetch(`${url}/ScheduledTasks`, {
    headers: { ...authHeaders(), Accept: "application/json", "Cache-Control": "no-cache" },
    timeout: requestTimeout
  });
  if (!response.ok) throw new Error(`Could not read Jellyfin task status (${response.status}).`);
  const tasks = await response.json();
  const task = (Array.isArray(tasks) ? tasks : []).find((item) => item.Key === "RefreshLibrary")
    || (Array.isArray(tasks) ? tasks : []).find((item) => /scan media library/i.test(item.Name || ""));
  if (!task) return { available: false, running: false, progress: null };
  const progress = Number(task.CurrentProgressPercentage);
  return {
    available: true,
    running: task.State === "Running",
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null
  };
}

function config() {
  return {
    url: String(process.env.JELLYFIN_URL || "").trim().replace(/\/+$/, ""),
    key: String(process.env.JELLYFIN_API_KEY || "").trim(),
    userId: String(process.env.JELLYFIN_USER_ID || "").trim()
  };
}

function configured() {
  const { url, key } = config();
  return Boolean(url && key);
}

function serverUrl() {
  return config().url;
}

function authHeaders() {
  // Jellyfin 12 removed the legacy Emby token header; this form works on both
  // 10.x and 12.x.
  return { Authorization: `MediaBrowser Token="${config().key}"` };
}

// Jellyfin 12 rejects /Items/{id} and the audio routes without a user, and API
// keys are server-scoped rather than owned by a user. Resolve one once and
// cache it; JELLYFIN_USER_ID pins a specific account.
async function resolveUserId() {
  const { userId } = config();
  if (userId) return userId;
  if (cachedUserId && Date.now() - cachedUserIdAt < userCacheTtl) return cachedUserId;
  if (!userLookup) {
    userLookup = (async () => {
      const users = await getJson("/Users", {}, { withUser: false });
      const list = Array.isArray(users) ? users : [];
      const owner = list.find((user) => user?.Policy?.IsDisabled !== true) || list[0];
      cachedUserId = owner?.Id || "";
      cachedUserIdAt = Date.now();
      return cachedUserId;
    })().finally(() => { userLookup = null; });
  }
  return userLookup;
}

async function getJson(pathname, params = {}, { withUser = true } = {}) {
  const { url } = config();
  const search = new URLSearchParams(params);
  search.set("_t", Date.now().toString());
  if (withUser) {
    const userId = await resolveUserId().catch(() => "");
    if (userId) search.set("userId", userId);
  }
  const response = await fetch(`${url}${pathname}?${search}`, {
    headers: { ...authHeaders(), Accept: "application/json", "Cache-Control": "no-cache" },
    timeout: requestTimeout
  });
  if (response.status === 401 || response.status === 403) throw new Error("Jellyfin rejected the API key. Check JELLYFIN_API_KEY.");
  if (!response.ok) throw new Error(`Jellyfin returned HTTP ${response.status}.`);
  return response.json();
}

const catalog = createJellyfinCatalog({ getJson });
const nextTracks = createAutoDj(catalog.autoDj);

// static=true serves the original file and honours range requests, which is
// what seeking needs. The transcoding path exists for browsers that cannot
// decode the library format at all (a TV or Fire TV stick with FLAC files), and
// asks for MP3 explicitly because that is the format every browser decodes.
async function streamAudio(id, range, { transcode = false } = {}) {
  const { url } = config();
  const userId = await resolveUserId().catch(() => "");
  if (!userId) throw new Error("Jellyfin needs a user for playback. Set JELLYFIN_USER_ID.");

  const request = async (mode) => {
    const params = new URLSearchParams({ UserId: userId, DeviceId: "mymusics" });
    if (mode === "static") params.set("static", "true");
    if (mode === "transcode") {
      params.set("Container", "mp3");
      params.set("AudioCodec", "mp3");
      params.set("MaxStreamingBitrate", "192000");
    }
    const headers = { ...authHeaders() };
    // A converted stream has no stable byte offsets, so a range request only
    // makes sense against the original file.
    if (range && mode === "static") headers.Range = range;
    return fetch(`${url}/Audio/${encodeURIComponent(id)}/stream?${params}`, { headers, timeout: 20000 });
  };

  if (transcode) return request("transcode");
  const original = await request("static");
  if (original.ok) return original;
  original.body?.destroy();
  return request("transcode");
}

async function image(id, size = 480) {
  const { url } = config();
  const params = new URLSearchParams({ maxHeight: String(size), quality: "88" });
  return fetch(`${url}/Items/${encodeURIComponent(id)}/Images/Primary?${params}`, {
    headers: authHeaders(),
    timeout: requestTimeout
  });
}

module.exports = {
  configured,
  serverUrl,
  ...catalog.api,
  nextTracks,
  streamAudio,
  image,
  clearCache,
  refreshLibrary,
  libraryRefreshStatus
};
