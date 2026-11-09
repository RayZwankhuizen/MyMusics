const MAX_CACHE_ENTRIES = 500;
const MAX_PENDING_LOOKUPS = 32;
const MAX_STREAM_ERROR_KEYS = 500;

function readCache(cache, key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function writeCache(cache, key, result, ttl, now = Date.now()) {
  rememberBounded(cache, key, { result, expires: now + ttl }, MAX_CACHE_ENTRIES);
}

function rememberBounded(map, key, value, maxEntries) {
  map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) map.delete(map.keys().next().value);
}

function canStartLookup(requests, key) {
  return requests.has(key) || requests.size < MAX_PENDING_LOOKUPS;
}

module.exports = {
  MAX_PENDING_LOOKUPS,
  MAX_STREAM_ERROR_KEYS,
  canStartLookup,
  readCache,
  rememberBounded,
  writeCache
};
