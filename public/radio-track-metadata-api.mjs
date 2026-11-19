export async function fetchTrackMetadata(artist, title) {
  const params = new URLSearchParams({ artist, title });
  const response = await fetch(`/metadata?${params}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Lookup unavailable");
  return result;
}

export async function fetchTrackLyrics(artist, title, { album, durationMs } = {}) {
  const params = new URLSearchParams({ artist, title });
  if (album) params.set("album", album);
  if (Number.isFinite(durationMs) && durationMs > 0) params.set("durationMs", String(durationMs));
  const response = await fetch(`/lyrics?${params}`);
  return response.ok ? response.json() : null;
}

export async function fetchGeniusArtwork(artist, title) {
  const params = new URLSearchParams({ artist, title });
  const response = await fetch(`/genius-art?${params}`);
  return response.ok ? response.json() : null;
}
