import { fetchGeniusArtwork } from "./radio-track-metadata-api.mjs";

export function createRadioTrackDetailsView({ isCurrent }) {
  const titleElement = document.querySelector("#track-title");
  const albumElement = document.querySelector("#track-album");
  const statusElement = document.querySelector("#lookup-status");
  const image = document.querySelector("#cover-art");
  const sourceElement = document.querySelector("#art-source");

  function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  async function showGeniusArtwork(artist, title, key) {
    if (!isCurrent(key)) return;
    try {
      const art = await fetchGeniusArtwork(artist, title);
      if (!isCurrent(key)) return;
      if (!art?.imageUrl) {
        statusElement.textContent = art?.configured === false ? "Set GENIUS_ACCESS_TOKEN to enable Genius artwork." : "No album art found.";
        return;
      }
      image.onload = () => { image.hidden = false; };
      image.onerror = () => { image.hidden = true; statusElement.textContent = "Genius artwork is unavailable."; };
      image.src = art.imageUrl;
      const source = document.createElement("a");
      source.href = art.sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer";
      source.textContent = "Artwork: Genius";
      sourceElement.replaceChildren(source);
      sourceElement.hidden = false;
    } catch {
      if (isCurrent(key)) statusElement.textContent = "Album art is temporarily unavailable.";
    }
  }

  function render(result, artist, title, key) {
    titleElement.textContent = result.trackTitle || title;
    albumElement.textContent = [result.album, result.year].filter(Boolean).join(" · ");
    statusElement.textContent = [...(result.tags || []).map((tag) => tag.name), result.durationMs ? formatDuration(result.durationMs) : null].filter(Boolean).join(" · ");
    if (result.coverArt) {
      image.onload = () => { image.hidden = false; };
      image.onerror = () => { image.hidden = true; void showGeniusArtwork(artist, result.trackTitle || title, key); };
      image.src = result.coverArt;
      sourceElement.hidden = true;
    } else void showGeniusArtwork(artist, result.trackTitle || title, key);
  }

  return Object.freeze({ render });
}
