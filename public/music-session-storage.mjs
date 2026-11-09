import { naturalFadeoutSeconds } from "./natural-fadeout.mjs";

const keys = {
  recent: "mymusics:dj-recent",
  seed: "mymusics:dj-seed",
  naturalFadeouts: "mymusics:natural-fadeouts"
};

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function createMusicSessionStorage(state) {
  const savedRecent = read(keys.recent, []);
  state.recent = Array.isArray(savedRecent) ? savedRecent.filter((id) => typeof id === "string").slice(-80) : [];
  state.seed = read(keys.seed, null);
  const savedFadeouts = read(keys.naturalFadeouts, {});
  const fadeouts = savedFadeouts && typeof savedFadeouts === "object" && !Array.isArray(savedFadeouts) ? savedFadeouts : {};

  function remember(track) {
    state.recent = [...state.recent.filter((id) => id !== track.id), track.id].slice(-80);
    write(keys.recent, state.recent);
  }

  function recordPlayedTrack(track) {
    state.history = [...state.history, track].slice(-40);
    remember(track);
  }

  function recentArtists() {
    return [...new Set(state.history.slice(-3).map((track) => track.artist).filter(Boolean))].slice(-2);
  }

  function naturalFadeSeconds(track) {
    return naturalFadeoutSeconds(fadeouts[track?.id]);
  }

  function saveNaturalFadeout(track, value) {
    if (!track?.id) return;
    const seconds = naturalFadeoutSeconds(value);
    if (seconds) fadeouts[track.id] = seconds;
    else delete fadeouts[track.id];
    write(keys.naturalFadeouts, fadeouts);
  }

  function saveSeed(track) {
    write(keys.seed, track);
  }

  return Object.freeze({ recordPlayedTrack, recentArtists, naturalFadeSeconds, saveNaturalFadeout, saveSeed });
}
