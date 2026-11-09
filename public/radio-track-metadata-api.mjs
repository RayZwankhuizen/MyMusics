export async function fetchTrackMetadata(artist, title) {
  const params = new URLSearchParams({ artist, title });
  const response = await fetch(`/metadata?${params}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Lookup unavailable");
  return result;
}

export async function fetchTrackLyrics(artist, title) {
  const params = new URLSearchParams({ artist, title });
  const response = await fetch(`/lyrics?${params}`);
  return response.ok ? response.json() : null;
}

export async function fetchGeniusArtwork(artist, title) {
  const params = new URLSearchParams({ artist, title });
  const response = await fetch(`/genius-art?${params}`);
  return response.ok ? response.json() : null;
}
