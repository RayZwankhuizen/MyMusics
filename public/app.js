import { inferMetadataKind as classifyMetadataKind, isProgramMetadata as classifyProgramMetadata, metadataTrack } from "./radio-metadata-kind.mjs";
import { defaultRadioEqualizerPreset } from "./radio-equalizer-preset.mjs";
import { createRadioStationView } from "./radio-station-view.mjs?v=tv-remote-1";
import { createRadioStationManagement } from "./radio-station-management.mjs";
import { createRadioSpeechDetector } from "./radio-speech-detector.mjs";
import { createRadioSuppressionStore, metadataBlockKey as buildMetadataBlockKey, speechTrackKey } from "./radio-suppression-store.mjs";
import { fetchTrackMetadata } from "./radio-track-metadata-api.mjs";
import { createRadioMetadataView } from "./radio-metadata-view.mjs";
import { createRadioTrackDetailsView } from "./radio-track-details-view.mjs";
import { createRadioHostOutput } from "./radio-host-output.mjs";
import { createRadioNowPlaying } from "./radio-now-playing.mjs";
import { createRadioEqualizerController } from "./radio-equalizer-controller.mjs";
import { createRadioHlsPlayback } from "./radio-hls-playback.mjs";
import { createRadioBrowserPlayback } from "./radio-browser-playback.mjs";
import { createRadioLyricsController } from "./radio-lyrics-controller.mjs?v=shared-lyrics-2";
import { createRadioSuppressionController } from "./radio-suppression-controller.mjs?v=manual-track-suppression-2";
import { wireRadioSpeechVolumeSettings } from "./radio-speech-volume-settings.mjs";
import { createRadioStationCatalog } from "./radio-station-catalog.mjs";
import { createRadioTrackUpdates } from "./radio-track-updates.mjs";
import { createRadioSuppressionControls } from "./radio-suppression-controls.mjs";
import { createRadioStationPlayback } from "./radio-station-playback.mjs";
import { createRadioTrackLookup } from "./radio-track-lookup.mjs";
import { createRadioAudioOutput } from "./radio-audio-output.mjs";
import { wireRadioPlayerBar } from "./radio-player-bar.mjs";

let suppressionController;
const radioAudioOutput = createRadioAudioOutput({ initialAudio: document.querySelector("#audio"), getSuppressionController: () => suppressionController });
const setStatus = (...args) => radioAudioOutput.setStatus(...args);
document.querySelector("#radio-build").textContent = `Player build ${new URL(import.meta.url).searchParams.get("v") || "unknown"}`;
const genreNav = document.querySelector("#genres");
const stationList = document.querySelector("#station-list");
const radioSearchInput = document.querySelector("#radio-search");
let stationCatalog;
let activeStation = null;
let activeStationGenre = "";
let lookupKey = "";
let lyricsStartedAt = 0;
let lyricsSyncOffset = 0;
let audioPlaybackGeneration = 0;
let trackStartedAt = null;

const suppressionStore = createRadioSuppressionStore();
const { disabledStations: speechSuppressionDisabledStations } = suppressionStore;
const el = (selector) => document.querySelector(selector);
const isProgramMetadata = (track, station = activeStation) => classifyProgramMetadata(track, station);
const metadataBlockKey = (fields, raw, stationUrl = activeStation?.url) => buildMetadataBlockKey(fields, raw, stationUrl);
const trackDetailsView = createRadioTrackDetailsView({ isCurrent: (key) => key === lookupKey });
const lyricsController = createRadioLyricsController({
  isCurrent: (key) => key === lookupKey,
  getTrackKey: speechTrackKey,
  parseSynced: (value) => window.MyMusicsLyrics.parseSynced(value),
  elapsedTime: () => (trackStartedAt ? Math.max(0, (Date.now() - Date.parse(trackStartedAt)) / 1000) : (performance.now() - lyricsStartedAt) / 1000) + lyricsSyncOffset,
  onConfirmedTrack: (key) => suppressionController.confirmTrack(key)
});
const radioEqualizer = createRadioEqualizerController({
  getAudio: radioAudioOutput.getAudio,
  getStation: () => activeStation,
  getStationGenre: () => activeStationGenre,
  getStationIndex: (station, genre) => stationCatalog.stations[genre]?.findIndex((item) => item.url === station.url) ?? -1,
  getGeneration: () => audioPlaybackGeneration,
  isHostOutput: () => window.MyMusicsPlayback?.isHost,
  streamUrl: radioStreamUrl,
  replaceAudio: radioAudioOutput.replace,
  onStationUpdated: (updated, index, genre) => {
    stationCatalog.setStations(updated);
    activeStation = stationCatalog.stations[genre][index];
  }
});
const hlsPlayback = createRadioHlsPlayback({
  getAudio: radioAudioOutput.getAudio,
  setStatus,
  onMetadata: appendMetadataBlock,
  onTrack: (artist, title) => { trackStartedAt = null; setTrackStartStatus(false); lookupTrack(artist, title); }
});
const browserPlayback = createRadioBrowserPlayback({
  getAudio: radioAudioOutput.getAudio,
  setStatus,
  streamUrl: radioStreamUrl,
  hlsPlayback,
  equalizerReady: () => radioEqualizer.ready,
  speechSuppressionDisabled: (url) => speechSuppressionDisabledStations.has(url),
  startSpeechDetection
});
const speechDetector = createRadioSpeechDetector({
  streamUrl: radioStreamUrl,
  onStopped: () => suppressionController.setDucked(false),
  onStatus: (status) => {
    const element = el("#speech-suppression-status");
    if (status === "loading") {
      element.textContent = "Loading…";
      element.dataset.state = "loading";
    } else if (status === "ready") {
      element.textContent = suppressionController.ducked ? "Suppressed" : isTrackSuppressionEnabled(suppressionController.currentTrackKey) ? "Listening" : "Track suppression off";
      element.dataset.state = suppressionController.ducked ? "suppressed" : "listening";
    } else if (status === "stream-blocked" || status === "unavailable") {
      element.textContent = status === "stream-blocked" ? "Stream blocks analysis" : "Detector unavailable";
      element.dataset.state = "off";
    }
  },
  onSpeechStart: () => {
    suppressionController.onSpeechStart();
  },
  onSpeechEnd: () => suppressionController.releaseAfterPause(),
  onMisfire: () => suppressionController.releaseAfterPause()
});
suppressionController = createRadioSuppressionController({
  store: suppressionStore,
  speechDetector,
  getStation: () => activeStation,
  getAudio: radioAudioOutput.getAudio,
  getMetadataKey: metadataBlockKey,
  getTrackKey: speechTrackKey
});
suppressionController.bindAudioVolumeChange();
const updateSpeechSuppressionButton = createRadioSuppressionControls({
  getStation: () => activeStation,
  disabledStations: speechSuppressionDisabledStations,
  saveDisabledStations: suppressionStore.saveDisabledStations,
  controller: suppressionController,
  stopDetection: stopSpeechDetection,
  startDetection: startSpeechDetection
});
const stationView = createRadioStationView({
  genreNav,
  stationList,
  searchInput: radioSearchInput,
  favoriteStatus: el("#favorite-status"),
  getStations: () => stationCatalog.stations,
  onChooseGenre: chooseGenre,
  onChooseFavorites: chooseFavorites,
  onPlay: playStation,
  onEdit: openStationEditor,
  onToggleFavorite: toggleFavorite
});
stationCatalog = createRadioStationCatalog({
  onChange: () => { renderGenreNav(); renderStations(); },
  onFavoriteStatus: (message) => { el("#favorite-status").textContent = message; }
});
const hostPlayerOutput = createRadioHostOutput({ getAudio: radioAudioOutput.getAudio, setStatus });
function playStation(station, genre) { return stationPlayback.play(station, genre); }
wireRadioPlayerBar({
  getAudio: radioAudioOutput.getAudio,
  getBrowserMeterLevels: () => radioEqualizer.getMeterLevels(),
  getStation: () => activeStation,
  getGenre: () => activeStationGenre,
  getStations: () => stationCatalog.stations,
  isHostOutput: () => window.MyMusicsPlayback?.isHost === true,
  playStation
});

document.querySelectorAll("dialog").forEach(window.MyMusicsUI.closeOnBackdropClick);

const isTrackSuppressionEnabled = (key) => suppressionController.isTrackEnabled(key);
const renderMetadataSuppression = (button, key) => suppressionController.renderMetadata(button, key);
const setCurrentMetadataBlock = (fields, raw, stationUrl) => suppressionController.setCurrentMetadata(fields, raw, stationUrl);
const setCurrentSpeechTrack = (artist, title) => suppressionController.setCurrentTrack(artist, title);
const trackLookup = createRadioTrackLookup({
  getKey: () => lookupKey,
  setKey: (key) => { lookupKey = key; },
  isProgramMetadata,
  setCurrentTrack: setCurrentSpeechTrack,
  setTrackStartedAt: (value) => { trackStartedAt = value; },
  setTrackStartStatus,
  lyrics: lyricsController,
  startLyrics: () => { lyricsStartedAt = performance.now(); lyricsSyncOffset = 0; },
  fetchMetadata: fetchTrackMetadata,
  trackDetailsView
});
function showProgramMetadata(track) { trackLookup.showProgramMetadata(track); }

wireRadioSpeechVolumeSettings({
  getStation: () => activeStation,
  getStations: () => stationCatalog.stations,
  setStations: (stations) => stationCatalog.setStations(stations),
  setActiveStation: (station, genre) => { activeStation = station; activeStationGenre = genre; },
  isDucked: () => suppressionController.ducked,
  applyPercent: (percent) => suppressionController.setVolume(suppressionController.preferredVolume * percent / 100),
  renderStations,
  updateSuppressionButton: updateSpeechSuppressionButton
});

el("#player-tools-toggle").addEventListener("click", () => {
  const tools = el("#player-tools");
  const open = tools.hidden;
  tools.hidden = !open;
  el(".player-bar").classList.toggle("sound-open", open);
  el("#player-tools-toggle").setAttribute("aria-expanded", String(open));
  el("#player-tools-toggle").textContent = open ? "Close sound settings" : "Sound settings";
  if (!open && el("#equalizer-panel").open) el("#equalizer-panel").close();
});

function radioStreamUrl(url) { return `/api/radio-stream?url=${encodeURIComponent(url)}`; }

function stopSpeechDetection() { speechDetector.stop(); }
function startSpeechDetection(station) { return speechDetector.start(station); }

function chooseGenre(genre) { stationCatalog.chooseGenre(genre); }
function chooseFavorites() { stationCatalog.chooseFavorites(); }

function toggleFavorite(genre, index, favorite) { return stationCatalog.toggleFavorite(genre, index, favorite); }

function renderGenreNav() { stationView.renderGenres(stationCatalog.stations, stationCatalog.activeGenre, stationCatalog.showingFavorites); }
function renderStations() { stationView.renderStations(stationCatalog.stations, stationCatalog.activeGenre, stationCatalog.showingFavorites, activeStation); }
function resetStationTrackMetadata() {
  lookupKey = "";
  trackUpdates.reset();
  suppressionController.resetTrack();
  lyricsSyncOffset = 0;
  lyricsController.reset("Waiting for track metadata…", true);
  setTrackStartStatus(false);
  trackStartedAt = null;
}

const stationManagement = createRadioStationManagement({
  getStations: () => stationCatalog.stations,
  setStations: (stations) => stationCatalog.setStations(stations),
  getActiveStation: () => activeStation,
  getActiveGenre: () => activeStationGenre,
  setActiveStation: (station, genre) => { activeStation = station; activeStationGenre = genre; },
  playStation,
  renderGenres: renderGenreNav,
  renderStations
});
function openStationEditor(genre, index) { stationManagement.open(genre, index); }

function lookupTrack(artist, title) { return trackLookup.lookup(artist, title); }

function setTrackStartStatus(sent, startTime = null) {
  const indicator = el("#start-time-indicator");
  indicator.dataset.state = sent === null ? "unknown" : sent ? "present" : "missing";
  indicator.setAttribute("aria-label", sent === null ? "Waiting for track metadata" : sent ? startTime ? "Track start time received" : "Track start time received, format unknown" : "Track start time not sent");
}

function resetMetadataMonitor(station) {
  suppressionController.resetMetadata();
  metadataView.reset(station);
}

const metadataView = createRadioMetadataView({
  list: el("#metadata-blocks"),
  count: el("#metadata-block-count"),
  summary: el("#metadata-summary-status"),
  streamInfo: el("#metadata-stream-info"),
  setMetadataBlockSuppressed: (key, suppressed) => suppressionController.setMetadataBlock(key, suppressed),
  getTrackKey: (fields) => { const track = metadataTrack(fields); return speechTrackKey(track.artist, track.title); },
  getMetadataKey: (fields, raw) => metadataBlockKey(fields, raw),
  renderSuppression: renderMetadataSuppression,
  classify: (data) => classifyMetadataKind(data, {
    station: activeStation,
    speechDetected: speechDetector.active && (speechDetector.speechActive || speechDetector.recentlyDetected()),
    speechDetectionEnabled: speechDetector.active
  })
});
const trackUpdates = createRadioTrackUpdates({
  setMetadataBlock: setCurrentMetadataBlock,
  setCurrentTrack: setCurrentSpeechTrack,
  isProgramMetadata,
  showProgramMetadata,
  appendMetadata: appendMetadataBlock,
  setTrackStartedAt: (value) => { trackStartedAt = value; },
  setTrackStartStatus,
  renderTrack: (artist, title) => {
    el("#track-artist").textContent = artist;
    el("#track-title").textContent = title;
  },
  lookupTrack
});
const nowPlaying = createRadioNowPlaying({
  isCurrent: (station) => activeStation?.url === station.url,
  onConnected: () => metadataView.setConnected(),
  onMonitorStatus: metadataView.setMonitorStatus,
  onMetadata: (data, station) => {
    if (data.blockBytes !== 0) setCurrentMetadataBlock(data.fields, data.raw, station.url);
    appendMetadataBlock(data);
  },
  onTrack: trackUpdates.applyStream,
  onPollTrack: trackUpdates.applyPoll
});
const stationPlayback = createRadioStationPlayback({
  state: {
    getAudio: radioAudioOutput.getAudio,
    getStation: () => activeStation,
    getGenre: () => activeStationGenre,
    isHostOutput: () => window.MyMusicsPlayback?.isHost,
    nextGeneration: () => ++audioPlaybackGeneration,
    isCurrentGeneration: (generation) => generation === audioPlaybackGeneration,
    setStation: (station, genre) => { activeStation = station; activeStationGenre = genre; }
  },
  players: { equalizer: radioEqualizer, hostOutput: hostPlayerOutput, browser: browserPlayback, hls: hlsPlayback, nowPlaying },
  ui: {
    stopSpeechDetection,
    resetTrackMetadata: resetStationTrackMetadata,
    replaceAudio: radioAudioOutput.replace,
    showEqualizerUnavailable: () => { el("#equalizer-status").textContent = "This station does not support audio processing."; },
    defaultEqualizerPreset: defaultRadioEqualizerPreset,
    updateSuppressionButton: updateSpeechSuppressionButton,
    renderStations,
    showStation: (station) => {
      el("#now-heading").textContent = station.name;
      el("#track-title").textContent = "Waiting for a track";
      el("#track-artist").textContent = "Live radio";
      el("#track-album").textContent = "";
      el("#art-source").hidden = true;
      el("#lookup-status").textContent = "";
      el("#cover-art").hidden = true;
      el("#cover-art").removeAttribute("src");
    },
    resetMetadataMonitor,
    showPollingMetadata: () => { el("#metadata-summary-status").textContent = "Polling HLS metadata"; },
    hideHostControls: () => { el("#host-radio-controls").hidden = true; }
  }
});
function appendMetadataBlock(data) { metadataView.append(data); }

async function start() {
  try {
    const stations = await stationCatalog.load();
    renderGenreNav();
    const firstGenre = Object.keys(stations)[0];
    if (firstGenre) chooseGenre(firstGenre);
  } catch (error) {
    console.error("Could not load stations:", error);
    stationList.textContent = `${error.message || "Stations could not be loaded."} Try refreshing the page.`;
  }
}

start();
