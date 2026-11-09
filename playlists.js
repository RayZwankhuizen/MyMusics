const crypto = require("node:crypto");
const storage = require("./storage");

// Playlists live next to stations.json so they survive updates, and the
// client can queue them without another round trip to Jellyfin.
const file = storage.paths.playlists;

const maxPlaylists = 200;
const maxTracks = 1000;
const idPattern = /^[0-9a-z]{8,64}$/i;

function emptyStore() {
  return { playlists: [] };
}

function validPlaylist(playlist) {
  return Boolean(playlist
    && typeof playlist.id === "string"
    && typeof playlist.name === "string"
    && Array.isArray(playlist.tracks));
}

function read() {
  return storage.readJson(file, emptyStore(), (value) => Boolean(value
    && Array.isArray(value.playlists)
    && value.playlists.every(validPlaylist)));
}

function write(store) {
  storage.writeJson(file, store);
}

function summary(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.tracks.length,
    updatedAt: playlist.updatedAt || null
  };
}

function list() {
  return read().playlists
    .map(summary)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function get(id) {
  return read().playlists.find((playlist) => playlist.id === id) || null;
}

function cleanName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) return { error: "Enter a playlist name." };
  if (name.length > 60) return { error: "Use a playlist name of 60 characters or fewer." };
  return { name };
}

function cleanTrack(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !idPattern.test(value.id)) return null;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 200) : "";
  if (!title) return null;
  const text = (input, max = 200) => typeof input === "string" ? input.trim().slice(0, max) : "";
  const albumId = typeof value.albumId === "string" && idPattern.test(value.albumId) ? value.albumId : value.id;
  const duration = Number(value.durationMs);
  const year = Number(value.year);
  return {
    kind: "track",
    id: value.id,
    title,
    artist: text(value.artist),
    album: text(value.album),
    albumId,
    genre: text(value.genre, 80),
    year: Number.isInteger(year) ? year : null,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    art: `/library/art/${albumId}`
  };
}

function create(rawName) {
  const cleaned = cleanName(rawName);
  if (cleaned.error) return { error: cleaned.error };
  const store = read();
  if (store.playlists.length >= maxPlaylists) return { error: `You can keep at most ${maxPlaylists} playlists.` };
  if (store.playlists.some((playlist) => playlist.name.toLowerCase() === cleaned.name.toLowerCase())) {
    return { error: "That playlist already exists." };
  }
  const now = new Date().toISOString();
  const playlist = { id: crypto.randomUUID(), name: cleaned.name, createdAt: now, updatedAt: now, tracks: [] };
  store.playlists.push(playlist);
  write(store);
  return { playlist };
}

function rename(id, rawName) {
  const cleaned = cleanName(rawName);
  if (cleaned.error) return { error: cleaned.error };
  const store = read();
  const playlist = store.playlists.find((entry) => entry.id === id);
  if (!playlist) return { error: "Playlist not found.", status: 404 };
  if (store.playlists.some((entry) => entry.id !== id && entry.name.toLowerCase() === cleaned.name.toLowerCase())) {
    return { error: "That playlist already exists." };
  }
  playlist.name = cleaned.name;
  playlist.updatedAt = new Date().toISOString();
  write(store);
  return { playlist };
}

function remove(id) {
  const store = read();
  const next = store.playlists.filter((playlist) => playlist.id !== id);
  if (next.length === store.playlists.length) return false;
  write({ playlists: next });
  return true;
}

function addTrack(id, rawTrack) {
  const track = cleanTrack(rawTrack);
  if (!track) return { error: "This track cannot be added to a playlist." };
  const store = read();
  const playlist = store.playlists.find((entry) => entry.id === id);
  if (!playlist) return { error: "Playlist not found.", status: 404 };
  if (playlist.tracks.length >= maxTracks) return { error: `A playlist can hold at most ${maxTracks} tracks.` };
  playlist.tracks.push(track);
  playlist.updatedAt = new Date().toISOString();
  write(store);
  return { playlist };
}

function removeTrack(id, index) {
  const store = read();
  const playlist = store.playlists.find((entry) => entry.id === id);
  if (!playlist) return { error: "Playlist not found.", status: 404 };
  if (!Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
    return { error: "Track not found in this playlist.", status: 404 };
  }
  playlist.tracks.splice(index, 1);
  playlist.updatedAt = new Date().toISOString();
  write(store);
  return { playlist };
}

function search(term, limit = 20) {
  const needle = String(term || "").trim().toLocaleLowerCase();
  return list()
    .filter((playlist) => !needle || playlist.name.toLocaleLowerCase().includes(needle))
    .slice(0, limit);
}

module.exports = { list, get, create, rename, remove, addTrack, removeTrack, search };
