import { fetchTrackLyrics } from "./radio-track-metadata-api.mjs";
import { renderPlainLyrics, renderSyncedLyrics } from "./radio-lyrics-view.mjs";

export function createRadioLyricsController({ isCurrent, getTrackKey, parseSynced, elapsedTime, onConfirmedTrack, root = document }) {
  const content = root.querySelector("#lyrics-content");
  const progress = root.querySelector("#lyrics-progress");
  const status = root.querySelector("#lyrics-status");
  const slower = root.querySelector("#lyrics-slower");
  const faster = root.querySelector("#lyrics-faster");
  let timer = null;
  let delay = 0.3;

  function adjustDelay(amount) {
    delay = Math.max(0, Math.min(3, Math.round((delay + amount) * 100) / 100));
    root.querySelector("#lyrics-delay").value = `${Math.round(delay * 1000)} ms`;
    slower.disabled = delay === 0;
    faster.disabled = delay === 3;
  }

  slower?.addEventListener("click", () => adjustDelay(0.05));
  faster?.addEventListener("click", () => adjustDelay(-0.05));

  function reset(message, resetScroll = false) {
    clearInterval(timer);
    timer = null;
    content.replaceChildren();
    if (resetScroll) content.scrollTop = 0;
    content.classList.remove("plain");
    content.style.removeProperty("padding-top");
    content.style.removeProperty("padding-bottom");
    progress.hidden = true;
    progress.value = 0;
    status.textContent = message;
  }

  function render(lyrics, artist, title) {
    if (!lyrics) { status.textContent = "No lyrics found for this track."; return; }
    const lines = lyrics.syncedLyrics ? parseSynced(lyrics.syncedLyrics) : [];
    if (!lines.length && !lyrics.plainLyrics) { status.textContent = "No lyrics found for this track."; return; }
    onConfirmedTrack(getTrackKey(artist, title));
    if (lines.length) timer = renderSyncedLyrics({ lines, content, progress, status, elapsedTime, lineDelay: () => delay });
    else renderPlainLyrics({ lyrics, content, progress, status });
  }

  async function load(artist, title, key) {
    try {
      const lyrics = await fetchTrackLyrics(artist, title);
      if (isCurrent(key)) render(lyrics, artist, title);
    } catch {
      if (isCurrent(key)) status.textContent = "Lyrics are temporarily unavailable.";
    }
  }

  return Object.freeze({ load, reset });
}
