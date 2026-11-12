import { wireMusicRefreshEvents } from "./music-refresh-events.mjs";
import { createMusicSearch, wireMusicSearchEvents } from "./music-search.mjs";
import { wirePlaybackLifecycleEvents, wireMusicPlaybackTargetChange, wireJukeboxPlayerEvents, wireDeckSeekEvents, wireDeckPlaybackControls, createDeckEndedHandler } from "./music-playback-events.mjs?v=music-controls-1";
import { createMusicEqualizer } from "./music-equalizer.mjs?v=stereo-meter-1";
import { createMusicInfoView, createMusicResultView } from "./music-library-views.mjs";
import { createJukeboxRack, createJukeboxSearch } from "./jukebox-browser.mjs?v=tv-remote-1";
import { createMusicDeckState, createMusicDeckPreload, createMusicDeckTransition } from "./music-decks.mjs";
import { createMusicTrackPlayback } from "./music-track-playback.mjs";
import { createMusicQueueView } from "./music-queue-view.mjs";
import { createMusicQueueOperations } from "./music-queue-operations.mjs";
import { createMusicInfoController } from "./music-info-controller.mjs";
import { createMusicPlaybackNavigation } from "./music-playback-navigation.mjs";
import { createMusicJukeboxDecks } from "./music-jukebox-decks.mjs?v=music-controls-2";
import { createMusicDeckTransport } from "./music-deck-transport.mjs";
import { createMusicHostPlayback } from "./music-host-playback.mjs";
import { wireMusicGenrePulldown } from "./music-genre-pulldown.mjs";
import { wireMusicDialogEvents } from "./music-dialog-events.mjs";
import { createMusicAudioSource } from "./music-audio-source.mjs";
import { emptyRow, textButton, markAdded, formatMusicDuration, createMusicTrackRow, scrollMusicText, jukeboxEmpty as jbEmpty, genreCountSummary, createJukeboxStrip } from "./music-ui-elements.mjs?v=rock-ola-scroll-2";
import { wireMusicAutoDj } from "./music-autodj.mjs?v=source-picker-2";
import { createMusicSessionStorage } from "./music-session-storage.mjs";
import { createMusicPlaylistActions } from "./music-playlist-actions.mjs";
import { wireMusicVolume } from "./music-volume.mjs";
import { createRadioLyricsController } from "./radio-lyrics-controller.mjs?v=shared-lyrics-2";
import { wireMusicVuMeter } from "./music-vu-meter.mjs?v=stereo-vu-1";

// Music mode: plays the Jellyfin library through this server and builds the
// queue with the AutoDJ endpoint. Radio page logic stays in app.js.
const deckState = createMusicDeckState({
  a: document.querySelector("#audio"),
  b: document.querySelector("#audio2")
});
wireMusicVolume({ deckState, isHostOutput: () => window.MyMusicsPlayback?.isHost });
const el = (selector) => document.querySelector(selector);
const { audioUrl, needsTranscode } = createMusicAudioSource(deckState.decks.a);

const state = {
  configured: false,
  queue: [],
  history: [],
  current: null,
  seed: null,
  autoDj: null,
  recent: [],
  filling: false,
  transcoding: false,
  shuffle: false,
  fadeSeconds: 3
};

const { recordPlayedTrack, recentArtists, naturalFadeSeconds, saveNaturalFadeout, saveSeed } = createMusicSessionStorage(state);
const musicEqualizer = createMusicEqualizer({ deckState, getCurrentTrack: () => state.current, isHostOutput: () => window.MyMusicsPlayback?.isHost });
const { loadToInactiveDeck, preloadNextToDeck } = createMusicDeckPreload({
  state,
  deckState,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  audioUrl,
  needsTranscode,
  renderJukeboxNow,
  setStatus
});

let naturalFadeStartedTrack = "";

function setStatus(message, live = false) {
  el("#player-status").textContent = message;
  el("#player-status").classList.toggle("live", live);
}

const scrollQueueText = scrollMusicText;
const trackRow = createMusicTrackRow({ state, formatDuration: formatMusicDuration, scrollQueueText });
const jbStrip = createJukeboxStrip(scrollQueueText);

const hostPlayback = createMusicHostPlayback({
  state,
  deckState,
  resolveIncomingDeck: (track, key) => deckTransition.resolveIncomingDeck(track, key),
  setNaturalFadeStartedTrack: (id) => { naturalFadeStartedTrack = id; },
  getNaturalFadeStartedTrack: () => naturalFadeStartedTrack,
  naturalFadeSeconds,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  musicEqualizer,
  recordPlayedTrack,
  setStatus,
  refreshPlaybackAndQueue,
  renderDeckTime,
  syncJukeboxPlaying,
  next: (...args) => next(...args)
});
wireMusicVuMeter({
  getBrowserLevels: () => musicEqualizer.getMeterLevels(),
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  isPlaying: () => {
    const key = deckState.activeDeck || "a";
    return window.MyMusicsPlayback?.isHost
      ? Boolean(hostPlayback.getDeckStatus()?.[key]?.playing)
      : !deckState.decks[key].paused && !deckState.decks[key].ended && deckState.decks[key].readyState >= 2;
  }
});

const jukeboxDeckView = createMusicJukeboxDecks({
  state,
  deckState,
  el,
  getHostDeckStatus: hostPlayback.getDeckStatus,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  getNaturalFadeStartedTrack: () => naturalFadeStartedTrack,
  setNaturalFadeStartedTrack: (id) => { naturalFadeStartedTrack = id; },
  formatDuration: formatMusicDuration,
  naturalFadeSeconds,
  scrollQueueText,
  next: (...args) => next(...args)
});
let musicLyricsTrackKey = "";
const musicLyrics = createRadioLyricsController({
  root: el("#music-lyrics-panel"),
  isCurrent: (key) => key === musicLyricsTrackKey,
  getTrackKey: (artist, title) => `${artist}\n${title}`,
  parseSynced: (value) => window.MyMusicsLyrics.parseSynced(value),
  elapsedTime: () => window.MyMusicsPlayback?.isHost
    ? hostPlayback.getDeckStatus()?.[deckState.activeDeck]?.time || 0
    : deckState.decks[deckState.activeDeck].currentTime || 0,
  onConfirmedTrack: () => {}
});
function renderMusicLyrics(track) {
  const key = track?.id || "";
  if (key === musicLyricsTrackKey) return;
  musicLyricsTrackKey = key;
  if (!track?.artist || !track?.title) {
    musicLyrics.reset(track ? "Track details are needed to find lyrics." : "Choose a track to find lyrics.", true);
    return;
  }
  musicLyrics.reset("Searching lyrics…", true);
  musicLyrics.load(track.artist, track.title, key);
}
function syncJukeboxPlaying() { return jukeboxDeckView.syncPlaying(); }
function renderJukeboxNow() { return jukeboxDeckView.renderNow(); }
function renderDeckTime(key) { return jukeboxDeckView.renderTime(key); }

// The jukebox is the only place a track is presented now, so everything the
// separate now-playing card used to show is rendered there.
function renderNow() {
  const result = jukeboxDeckView.renderCurrent();
  renderMusicLyrics(state.current);
  updateMusicMediaSession();
  return result;
}

function updateMusicMediaSession() {
  if (!("mediaSession" in navigator) || !state.current) return;
  const track = state.current;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "MyMusics",
      artist: track.artist || "",
      album: track.album || "",
      artwork: track.art ? [{ src: track.art }] : []
    });
    navigator.mediaSession.playbackState = window.MyMusicsPlayback?.isHost
      ? (hostPlayback.getDeckStatus()?.[deckState.activeDeck]?.paused ? "paused" : "playing")
      : (deckState.decks[deckState.activeDeck].paused ? "paused" : "playing");
  } catch {}
}

function seekActiveDeck(delta) {
  const key = deckState.activeDeck;
  if (window.MyMusicsPlayback?.isHost) {
    const currentTime = hostPlayback.getDeckStatus()?.[key]?.time || 0;
    fetch("/api/host-player/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: key, action: "seek", value: Math.max(0, currentTime + delta) }) }).catch(() => {});
  } else {
    const audio = deckState.decks[key];
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  }
}

window.addEventListener("mymusics:media-action", (event) => {
  const key = deckState.activeDeck;
  if (event.detail === "toggle") return deckState.decks[key].paused ? void playDeck(key) : pauseDeck(key);
  if (event.detail === "play") return void playDeck(key);
  if (event.detail === "pause") return pauseDeck(key);
  if (event.detail === "next") return void next();
  if (event.detail === "previous") return seekActiveDeck(-Infinity);
  if (event.detail === "forward") return seekActiveDeck(10);
  if (event.detail === "rewind") return seekActiveDeck(-10);
});

if ("mediaSession" in navigator) {
  for (const [action, detail] of [["play", "play"], ["pause", "pause"], ["nexttrack", "next"], ["previoustrack", "previous"], ["seekforward", "forward"], ["seekbackward", "rewind"]]) {
    try { navigator.mediaSession.setActionHandler(action, () => window.dispatchEvent(new CustomEvent("mymusics:media-action", { detail }))); } catch {}
  }
}
for (const audio of Object.values(deckState.decks)) {
  audio.addEventListener("play", updateMusicMediaSession);
  audio.addEventListener("pause", updateMusicMediaSession);
}
for (const selector of ["#jb-title", "#jb-artist", "#jb-album"]) {
  const node = el(selector);
  if (node) new MutationObserver(updateMusicMediaSession).observe(node, { childList: true, characterData: true, subtree: true });
}

const { render: renderQueue } = createMusicQueueView({
  state,
  el,
  emptyRow,
  trackRow,
  textButton,
  loadToInactiveDeck,
  openInfo,
  scrollQueueText,
  preloadNextToDeck
});

const { enqueueTracks, addAlbumToQueue, loadCollectionToQueue, shuffleTracks, fillQueue, queuePlaylist, wireControls: wireQueueControls } = createMusicQueueOperations({
  state, deckState, el, renderQueue, renderJukeboxNow, recentArtists, setStatus, emptyRow,
  startFreshSequence: (...args) => startFreshSequence(...args),
  saveSeed
});

const kindLabels = { track: "Track", album: "Album", artist: "Artist", genre: "Genre", playlist: "Playlist" };
let musicGenreOptions;
async function getMusicGenres() {
  musicGenreOptions ||= fetch("/api/music/genres", { cache: "no-store" }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load genres.");
    return result.genres || [];
  }).catch((error) => { musicGenreOptions = null; throw error; });
  return musicGenreOptions;
}
async function saveAlbumGenre(id, genre) {
  const response = await fetch(`/api/music/albums/${encodeURIComponent(id)}/genre`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ genre })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save the album genre.");
  return result;
}
const { addTrackToPlaylist } = createMusicPlaylistActions({ el, textButton });
for (const key of ["a", "b"]) {
  el(`#jb-add-playlist-${key}`).addEventListener("click", () => {
    const track = deckState.deckTracks[key] || (deckState.activeDeck === key ? state.current : null);
    if (track) void addTrackToPlaylist(track);
  });
}
const musicResultView = createMusicResultView({
  el,
  emptyRow,
  textButton,
  scrollQueueText,
  addAlbumToQueue,
  loadCollectionToQueue,
  queuePlaylist,
  enqueueTracks,
  markAdded,
  openInfo,
  addTrackToPlaylist,
  getMusicGenres,
  saveAlbumGenre
});
const musicInfoView = createMusicInfoView({
  kindLabels,
  formatDuration: formatMusicDuration,
  scrollQueueText,
  emptyRow,
  resultRow: musicResultView.row,
  resultAction: musicResultView.action,
  textButton,
  enqueueTrack: (track) => enqueueTracks([track], "track"),
  addTrackToPlaylist,
  markAdded,
  jbEmpty,
  jbStrip,
  resultDetails: musicResultView.details,
  openInfo,
  getMusicGenres,
  saveAlbumGenre
});

const musicSearch = createMusicSearch({
  el,
  kindLabels,
  renderResults: musicResultView.render,
  fetchSearch: (url, options) => fetch(url, options)
});
const deckTransition = createMusicDeckTransition({
  state,
  deckState,
  setNaturalFadeStartedTrack: (id) => { naturalFadeStartedTrack = id; },
  musicEqualizer,
  needsTranscode,
  audioUrl,
  setStatus,
  renderNow,
  renderQueue,
  syncJukeboxPlaying
});
const { playTrack } = createMusicTrackPlayback({
  state,
  deckState,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  hostPlayback,
  deckTransition,
  recordPlayedTrack,
  setStatus,
  refreshPlaybackAndQueue
});
const { startFreshSequence, startRadio, next } = createMusicPlaybackNavigation({
  state,
  deckState,
  deckTransition,
  setNaturalFadeStartedTrack: (id) => { naturalFadeStartedTrack = id; },
  playTrack,
  fillQueue,
  saveSeed,
  el,
  setStatus
});
const handleDeckEnded = createDeckEndedHandler({
  state, deckState,
  getNaturalFadeStartedTrack: () => naturalFadeStartedTrack,
  next, syncJukeboxPlaying, renderJukeboxNow, renderQueue
});

function refreshPlaybackAndQueue() {
  renderNow();
  renderQueue();
  fillQueue();
}

const { playDeck, pauseDeck } = createMusicDeckTransport({
  state,
  deckState,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  getHostDeckStatus: hostPlayback.getDeckStatus,
  renderQueue,
  syncJukeboxPlaying,
  playTrack
});

async function openInfo(item, { browseOnly = false } = {}) {
  return musicInfoController.openInfo(item, { browseOnly });
}

// ---------------------------------------------------------------------------
// Jukebox: a full-screen, remote-friendly view of the same player. It reuses
// the queue, playlists and AutoDJ state above, so the phone or laptop keeps the
// same session. No keyboard is assumed: arrows move focus, select plays.
// ---------------------------------------------------------------------------
const jbState = { tab: "all", cache: {}, searchRequest: 0, detailRequest: 0, detailItem: null, searchTerm: "" };
const jbSearchTypes = { all: "all", artists: "artist", albums: "album", genres: "genre", playlists: "playlist", tracks: "track" };

async function queueJukeboxPlaylist(item, title) {
  if (await queuePlaylist(item.id)) {
    el("#jb-search-feedback").textContent = `Playlist “${title}” added to the playback queue.`;
  }
}

const musicInfoController = createMusicInfoController({ state: jbState, el, view: musicInfoView, empty: jbEmpty });
const { render: renderJukeboxRack, load: loadJukeboxTab, selectTab: jbSelectTab } = createJukeboxRack({
  state: jbState,
  searchTypes: jbSearchTypes,
  el,
  empty: jbEmpty,
  strip: jbStrip,
  genreCountSummary,
  resultDetails: musicResultView.details,
  openInfo,
  startRadio,
  queuePlaylist: queueJukeboxPlaylist
});
const jukeboxSearch = createJukeboxSearch({
  state: jbState,
  searchTypes: jbSearchTypes,
  el,
  empty: jbEmpty,
  strip: jbStrip,
  textButton,
  genreCountSummary,
  openInfo,
  enqueueTrack: (track) => enqueueTracks([track], "track"),
  addTrackToPlaylist,
  addAlbumToQueue,
  markAdded,
  queuePlaylist: queueJukeboxPlaylist,
  selectTab: jbSelectTab
});
const runJukeboxSearch = jukeboxSearch.run;
const wireJukeboxSearch = jukeboxSearch.wire;

function wireJukebox() {
  state.crossfadeEnabled = true;
  wireQueueControls();
  wireDeckPlaybackControls({ el, state, deckState, saveNaturalFadeout, naturalFadeSeconds, setStatus, playDeck, pauseDeck });
  wireJukeboxSearch();
  wireJukeboxPlayerEvents({ deckState, syncJukeboxPlaying, renderDeckTime });
  wireDeckSeekEvents({ deckState, getHostDeckStatus: hostPlayback.getDeckStatus, isHostOutput: () => window.MyMusicsPlayback?.isHost, setStatus });
}

function wireEvents() {
  wirePlaybackLifecycleEvents({
    deckState,
    handleDeckEnded, renderDeckTime, refreshHostStatus: hostPlayback.refreshStatus,
    nextHostPollDelay: hostPlayback.nextPollDelay,
    syncJukeboxPlaying, state, audioUrl, setStatus, renderNow
  });
  wireMusicPlaybackTargetChange({ state, deckState, playTrack });
  wireMusicAutoDj({ el, state, fillQueue, renderQueue, setStatus });

  wireMusicSearchEvents({ el, search: musicSearch });
  wireMusicDialogEvents({ el, closeOnBackdropClick: window.MyMusicsUI.closeOnBackdropClick });
  wireMusicRefreshEvents({ el, jbState, loadJukeboxTab, runJukeboxSearch });

  wireMusicGenrePulldown({ el, emptyRow, resultRow: musicResultView.row });
  musicEqualizer.wireEvents();
  window.addEventListener("resize", () => requestAnimationFrame(() => scrollQueueText()));
}

async function init() {
  musicEqualizer.buildControls();
  wireEvents();
  wireJukebox();
  renderQueue();
  try {
    const status = await fetch("/api/music/status").then((response) => response.json());
    state.configured = Boolean(status.configured);
  } catch {
    state.configured = false;
  }
  const jbDetailsInit = el("#jukebox-details");
  if (jbDetailsInit) {
    jbDetailsInit.hidden = false;
    jbDetailsInit.open = true;
  }
  if (!state.configured) {
    el("#setup").hidden = false;
    el("#queue-list").replaceChildren(emptyRow("The queue starts once Jellyfin is connected."));
    setStatus("JELLYFIN NOT CONFIGURED");
  }
  const params = new URLSearchParams(location.search);
  const playlistId = params.get("playlist");
  if (playlistId) {
    renderJukeboxNow();
    await queuePlaylist(playlistId, { shuffle: params.get("shuffle") === "1" });
  } else {
    // With an empty search term, All lists the artists in the library.
    musicSearch("", "all");
    // The jukebox is the main screen, so its rack is filled right away.
    renderJukeboxNow();
    jbSelectTab(jbState.tab);
  }
}

init();
