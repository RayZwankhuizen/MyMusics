export function renderSyncedLyrics({ lines, content, progress, status, elapsedTime, lineDelay, initialOffset = 0, onSync, estimated = false }) {
  progress.max = lines.length;
  progress.hidden = estimated;
  const elements = lines.map(({ text }) => {
    const line = document.createElement("button");
    line.type = "button";
    line.className = "lyric-line";
    line.setAttribute("aria-label", `${estimated ? "Start estimated timing at" : "Start sync at"}: ${text}`);
    line.textContent = text;
    content.append(line);
    return line;
  });
  let previousActive = -2;
  let syncOffset = estimated ? null : initialOffset;
  let previousSize = "";
  const elapsed = () => elapsedTime() + syncOffset;
  const sync = () => {
    if (syncOffset === null) return;
    const currentTime = elapsed();
    let active = -1;
    lines.forEach((line, index) => { if (line.time + lineDelay() <= currentTime) active = index; });
    const size = `${content.clientWidth}:${content.clientHeight}`;
    if (active === previousActive && size === previousSize) return;
    previousSize = size;
    elements.forEach((line, index) => {
      line.classList.toggle("active", index === active);
      if (index === active) line.setAttribute("aria-current", "true");
      else line.removeAttribute("aria-current");
    });
    progress.value = Math.max(0, active + 1);
    status.textContent = estimated ? "Estimated timing · select a line to adjust"
      : active < 0 ? "Waiting for first line" : "Lyrics synced";
    if (elements.length) {
      // Reserve the same space while waiting for the first timestamp too.
      // Space at both ends lets even the first and last lines sit in the middle.
      content.style.paddingTop = `${Math.max(0, (content.clientHeight - elements[0].offsetHeight) / 2)}px`;
      content.style.paddingBottom = `${Math.max(0, (content.clientHeight - elements[elements.length - 1].offsetHeight) / 2)}px`;
      const line = elements[Math.max(0, active)].getBoundingClientRect();
      const box = content.getBoundingClientRect();
      content.scrollTop += line.top + line.height / 2 - (box.top + content.clientTop + content.clientHeight / 2);
    }
    previousActive = active;
  };
  elements.forEach((element, index) => { element.addEventListener("click", () => {
    syncOffset = lines[index].time + lineDelay() - elapsedTime() + 0.001;
    progress.hidden = false;
    onSync?.(syncOffset);
    previousActive = -2;
    sync();
  }); });
  sync();
  return setInterval(sync, 100);
}

export function renderPlainLyrics({ lyrics, content, progress, status, elapsedTime, lineDelay }) {
  const secondsPerLine = 4;
  const lines = lyrics.plainLyrics.split(/\r?\n/).map((text) => text.trim()).filter(Boolean)
    .map((text, index) => ({ text, time: index * secondsPerLine }));
  if (!lines.length) {
    status.textContent = "No lyrics found for this track.";
    return null;
  }
  status.textContent = "Unsynced lyrics · select the line you hear";
  content.classList.add("plain");
  return renderSyncedLyrics({ lines, content, progress, status, elapsedTime, lineDelay, estimated: true });
}
