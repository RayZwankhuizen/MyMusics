import { fetchTrackLyrics } from "./radio-track-metadata-api.mjs?v=lyrics-version-1";
import { renderPlainLyrics, renderSyncedLyrics } from "./radio-lyrics-view.mjs";

export function createRadioLyricsController({ isCurrent, getTrackKey, parseSynced, elapsedTime, onConfirmedTrack, getCorrectionKey, root = document }) {
  const content = root.querySelector("#lyrics-content");
  const progress = root.querySelector("#lyrics-progress");
  const status = root.querySelector("#lyrics-status");
  const source = root.querySelector("#lyrics-source");
  const timingButtons = root.querySelectorAll("[data-lyrics-delay-step]");
  const timingValue = root.querySelector("#lyrics-delay");
  const maxDelayMs = 3000;
  const correctionControls = root.querySelector("#lyrics-correction");
  const remember = root.querySelector("#lyrics-remember-correction");
  const correctionAmount = root.querySelector("#lyrics-correction-amount");
  const defaultDelay = 0.3;
  let timer = null;
  let request = 0;
  let delay = defaultDelay;
  let correctionKey = null;
  let syncOffset = null;
  let savedCorrection = null;

  // Store the combined shift relative to the default lyric delay.
  const correctionMs = () => Math.round((syncOffset + defaultDelay - delay) * 1000);

  function showCorrection() {
    const milliseconds = correctionMs();
    correctionControls.hidden = false;
    remember.checked = milliseconds === savedCorrection;
    correctionAmount.textContent = milliseconds === 0
      ? "No timing shift"
      : `Lyrics ${(Math.abs(milliseconds) / 1000).toFixed(2)} s ${milliseconds > 0 ? "earlier" : "later"}`;
  }

  remember?.addEventListener("change", () => {
    if (!correctionKey || syncOffset === null) return;
    try {
      if (remember.checked) {
        savedCorrection = correctionMs();
        localStorage.setItem(correctionKey, String(savedCorrection));
      } else {
        localStorage.removeItem(correctionKey);
        savedCorrection = null;
      }
    } catch {
      // Keep the current playback correction even when local storage is blocked.
      savedCorrection = null;
      remember.checked = false;
      correctionAmount.textContent = "Could not save timing correction in this browser.";
    }
  });

  timingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const step = Number(button.dataset.lyricsDelayStep);
      const milliseconds = Math.max(-maxDelayMs, Math.min(maxDelayMs, Math.round(delay * 1000) + step));
      delay = milliseconds / 1000;
      timingValue.value = `${milliseconds} ms`;
      timingButtons.forEach((control) => {
        control.disabled = Math.abs(milliseconds) === maxDelayMs
          && Math.sign(Number(control.dataset.lyricsDelayStep)) === Math.sign(milliseconds);
      });
      if (syncOffset !== null) showCorrection();
    });
  });

  function reset(message, resetScroll = false) {
    request++;
    clearInterval(timer);
    timer = null;
    correctionKey = null;
    syncOffset = null;
    savedCorrection = null;
    if (correctionControls) correctionControls.hidden = true;
    content.replaceChildren();
    if (resetScroll) content.scrollTop = 0;
    content.classList.remove("plain");
    content.style.removeProperty("padding-top");
    content.style.removeProperty("padding-bottom");
    progress.hidden = true;
    progress.value = 0;
    status.textContent = message;
    if (source) {
      source.hidden = true;
      source.textContent = "";
    }
  }

  function render(lyrics, artist, title) {
    if (!lyrics) { status.textContent = "No lyrics found for this track."; return; }
    const lines = lyrics.syncedLyrics ? parseSynced(lyrics.syncedLyrics) : [];
    if (!lines.length && !lyrics.plainLyrics) { status.textContent = "No lyrics found for this track."; return; }
    if (source && lyrics.source) {
      const seconds = Math.round(lyrics.duration);
      const duration = seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";
      source.textContent = [lyrics.source, lyrics.albumName, duration].filter(Boolean).join(" · ");
      source.hidden = false;
    }
    onConfirmedTrack(getTrackKey(artist, title));
    if (!lines.length) {
      timer = renderPlainLyrics({ lyrics, content, progress, status, elapsedTime, lineDelay: () => delay });
      return;
    }
    correctionKey = getCorrectionKey?.(artist, title) || null;
    if (correctionKey && correctionControls) {
      try {
        const stored = localStorage.getItem(correctionKey);
        if (stored !== null && Number.isSafeInteger(Number(stored))) {
          savedCorrection = Number(stored);
          syncOffset = savedCorrection / 1000 + delay - defaultDelay;
          showCorrection();
        }
      } catch {}
    }
    timer = renderSyncedLyrics({
      lines, content, progress, status, elapsedTime, lineDelay: () => delay,
      initialOffset: syncOffset ?? 0,
      onSync: (offset) => {
        if (!correctionKey || !correctionControls) return;
        syncOffset = offset;
        showCorrection();
      }
    });
  }

  async function load(artist, title, key, version) {
    const pending = ++request;
    try {
      const lyrics = await fetchTrackLyrics(artist, title, version ?? undefined);
      if (pending === request && isCurrent(key)) render(lyrics, artist, title);
    } catch {
      if (pending === request && isCurrent(key)) status.textContent = "Lyrics are temporarily unavailable.";
    }
  }

  return Object.freeze({ load, reset });
}
