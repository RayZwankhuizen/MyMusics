const storage = require("./storage");
const file = storage.paths.musicGenres;
const validMappings = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && value.mappings && typeof value.mappings === "object" && !Array.isArray(value.mappings)
  && Object.entries(value.mappings).every(([source, name]) => typeof source === "string" && source.length <= 200
    && typeof name === "string" && name.length > 0 && name.length <= 80)
  && (!value.albumMappings || (typeof value.albumMappings === "object" && !Array.isArray(value.albumMappings)
    && Object.entries(value.albumMappings).every(([id, genre]) => /^[0-9a-z]{8,64}$/i.test(id)
      && typeof genre === "string" && genre.length <= 80))));

function read() { return storage.readJson(file, { mappings: {} }, validMappings); }

function group(items) {
  const mappings = read().mappings;
  const groups = new Map();
  for (const item of items) {
    const source = String(item.title || "").trim();
    if (!source) continue;
    const title = Object.hasOwn(mappings, source) ? mappings[source] : source;
    const key = title.toLocaleLowerCase();
    let entry = groups.get(key);
    if (!entry) {
      entry = { kind: "genre", id: title, title, sources: [] };
      groups.set(key, entry);
    }
    if (!entry.sources.includes(source)) entry.sources.push(source);
  }
  return [...groups.values()];
}

function managementList(items) {
  const mappings = read().mappings;
  return [...new Map(items.map((item) => [item.title, item])).values()].map(({ title }) => ({
    sourceName: title,
    displayName: mappings[title] || title
  }));
}

function set(source, displayName) {
  const cleanSource = typeof source === "string" ? source.trim() : "";
  const cleanName = typeof displayName === "string" ? displayName.trim().replace(/\s+/g, " ") : "";
  if (!cleanSource || cleanSource.length > 200) return { error: "Choose a valid Jellyfin genre." };
  if (!cleanName || cleanName.length > 80) return { error: "Enter a display name of 1 to 80 characters." };
  const store = read();
  if (cleanSource.toLocaleLowerCase() === cleanName.toLocaleLowerCase()) delete store.mappings[cleanSource];
  else {
    store.mappings = Object.assign(Object.create(null), store.mappings);
    store.mappings[cleanSource] = cleanName;
  }
  storage.writeJson(file, store);
  return { ok: true };
}

function reset(source) {
  const store = read();
  delete store.mappings[source];
  storage.writeJson(file, store);
}

function albumGenre(id, fallback = "") {
  const store = read();
  return store.albumMappings?.[id] || store.mappings[fallback] || fallback;
}

function setAlbumGenre(id, genre) {
  if (!/^[0-9a-z]{8,64}$/i.test(id)) return { error: "Choose a valid album." };
  const store = read();
  store.albumMappings ||= {};
  if (genre) store.albumMappings[id] = genre;
  else delete store.albumMappings[id];
  storage.writeJson(file, store);
  return { ok: true };
}

function sum(values) { return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null; }
function unique(items) { return [...new Map(items.flat().filter((item) => item?.id).map((item) => [item.id, item])).values()]; }

async function list(jellyfin) {
  const raw = await jellyfin.allGenres(500);
  return group(raw).map((genre) => {
    const sources = genre.sources.map((source) => raw.find((item) => item.title === source));
    const { sources: _sources, ...result } = genre;
    return { ...result, albumCount: sum(sources.map((item) => item?.albumCount)), trackCount: sum(sources.map((item) => item?.trackCount)) };
  });
}

async function search(term, jellyfin) {
  const needle = term.toLocaleLowerCase();
  const groups = group(await jellyfin.listGenres(500))
    .filter((genre) => genre.title.toLocaleLowerCase().includes(needle))
    .slice(0, 15);
  return Promise.all(groups.map(async (genre) => {
    const counts = await Promise.all(genre.sources.map(async (source) => Promise.all([
      jellyfin.countAlbumsByGenre(source).catch(() => null), jellyfin.countByGenre(source).catch(() => null)
    ])));
    return { kind: "genre", id: genre.id, title: genre.title,
      albumCount: sum(counts.map(([albums]) => albums)), trackCount: sum(counts.map(([, tracks]) => tracks)) };
  }));
}

async function info(id, jellyfin) {
  const genres = group(await jellyfin.listGenres(500));
  const genre = genres.find((item) => item.id.toLocaleLowerCase() === id.toLocaleLowerCase());
  if (!genre) return null;
  const parts = await Promise.all(genre.sources.map(async (source) => {
    const [albumCount, trackCount, albums, tracks] = await Promise.all([
      jellyfin.countAlbumsByGenre(source).catch(() => null), jellyfin.countByGenre(source).catch(() => null),
      jellyfin.albumsByGenre(source, 40).catch(() => []), jellyfin.tracksByGenre(source, 20).catch(() => [])
    ]);
    return { albumCount, trackCount, albums, tracks };
  }));
  return { kind: "genre", id: genre.id, title: genre.title,
    albumCount: sum(parts.map((part) => part.albumCount)), trackCount: sum(parts.map((part) => part.trackCount)),
    albums: unique(parts.map((part) => part.albums)).slice(0, 40), tracks: unique(parts.map((part) => part.tracks)).slice(0, 20) };
}

module.exports = { group, managementList, set, reset, albumGenre, setAlbumGenre, list, search, info };
