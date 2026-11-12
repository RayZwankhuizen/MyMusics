export function emptyRow(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "music-empty";
  paragraph.textContent = message;
  return paragraph;
}

export function textButton(label, onClick, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "station-edit-button";
  button.textContent = label;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", onClick);
  return button;
}

export function markAdded(button) {
  button.classList.add("is-added");
  button.setAttribute("aria-label", `${button.textContent}: added to queue`);
}

export function formatMusicDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function jukeboxEmpty(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "jb-empty";
  paragraph.textContent = message;
  return paragraph;
}

export function genreCountSummary(genre) {
  const parts = [];
  if (Number.isFinite(genre.albumCount)) parts.push(`${genre.albumCount} album${genre.albumCount === 1 ? "" : "s"}`);
  if (Number.isFinite(genre.trackCount)) parts.push(`${genre.trackCount} track${genre.trackCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Counts unavailable";
}

export function createJukeboxStrip(scrollQueueText) {
  return function jukeboxStrip(title, subtitle, onSelect, art = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jb-strip";
    if (art) {
      button.classList.add("has-art");
      const cover = document.createElement("img");
      cover.className = "jb-strip-art";
      cover.src = art;
      cover.alt = `Album cover: ${title}`;
      cover.loading = "lazy";
      cover.onerror = () => cover.remove();
      button.append(cover);
    }
    const body = document.createElement("span");
    body.className = "jb-strip-body";
    const strong = document.createElement("strong");
    strong.textContent = title;
    body.append(strong);
    if (subtitle) {
      const small = document.createElement("span");
      small.textContent = subtitle;
      body.append(small);
    }
    button.append(body);
    button.addEventListener("click", onSelect);
    requestAnimationFrame(() => scrollQueueText(button));
    return button;
  };
}

export function createMusicTrackRow({ state, formatDuration, scrollQueueText }) {
  return function trackRow(track, { action, actionLabel, onAction, stacked = false } = {}) {
    const row = document.createElement("div");
    row.className = "station-row";
    if (state.current?.id === track.id) row.classList.add("queue-current");
    const details = document.createElement("div");
    details.className = "station-details";
    if (stacked) {
      const artist = document.createElement("span");
      artist.className = "track-line track-line-artist";
      artist.textContent = track.artist || "Unknown artist";
      const title = document.createElement("strong");
      title.className = "track-line track-line-title";
      title.textContent = track.title;
      const duration = document.createElement("span");
      duration.className = "track-line track-line-duration";
      duration.textContent = formatDuration(track.durationMs) || "—";
      const album = document.createElement("span");
      album.className = "track-line track-line-album";
      album.textContent = track.album || "Unknown album";
      details.append(artist, title, duration, album);
    } else {
      const title = document.createElement("strong");
      title.textContent = track.title;
      const subtitle = document.createElement("span");
      subtitle.textContent = [track.artist, track.album, formatDuration(track.durationMs)].filter(Boolean).join(" · ") || "Unknown artist";
      details.append(title, subtitle);
    }
    row.append(details);
    if (action) {
      const actions = document.createElement("div");
      actions.className = "station-actions";
      actions.append(action);
      row.append(actions);
    } else if (actionLabel) {
      const actions = document.createElement("div");
      actions.className = "station-actions";
      actions.append(textButton(actionLabel, onAction));
      row.append(actions);
    }
    requestAnimationFrame(() => scrollQueueText(row));
    return row;
  };
}

export function scrollMusicText(root = document) {
  const speed = 26;
  const selector = ".track-line,.station-details strong,.station-details span,.jb-title,.jb-artist,.jb-album,.jb-meta,.jb-strip-body strong,.jb-strip-body span,.info-heading h2";
  const lines = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  for (const line of lines) {
    if (line.closest("#queue-list")) continue;
    const deckInfo = line.closest(".jb-deck, .jb-info");
    if (deckInfo && !deckInfo.classList.contains("is-active")) {
      line.classList.remove("is-scrolling");
      continue;
    }
    line.classList.add("scroll-line");
    line.classList.remove("is-scrolling");
    let content = line.querySelector(":scope > .scroll-content");
    if (!content) {
      content = document.createElement("span");
      content.className = "scroll-content";
      content.append(...line.childNodes);
      line.append(content);
    }
    const overflow = content.scrollWidth - line.clientWidth;
    if (overflow <= 2) continue;
    line.style.setProperty("--track-shift", `-${overflow}px`);
    line.style.setProperty("--track-duration", `${Math.max(4, overflow / speed).toFixed(1)}s`);
    line.classList.add("is-scrolling");
  }
}
