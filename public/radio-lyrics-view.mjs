export function renderSyncedLyrics({ lines, content, progress, status, elapsedTime, lineDelay }) {
  progress.max = lines.length;
  progress.hidden = false;
  const elements = lines.map(({ text }) => {
    const line = document.createElement("button");
    line.type = "button";
    line.className = "lyric-line";
    line.setAttribute("aria-label", `Start sync at: ${text}`);
    line.textContent = text;
    content.append(line);
    return line;
  });
  let previousActive = -2;
  let syncOffset = 0;
  const elapsed = () => elapsedTime() + syncOffset;
  const sync = () => {
    const currentTime = elapsed();
    let active = -1;
    lines.forEach((line, index) => { if (line.time + lineDelay() <= currentTime) active = index; });
    if (active === previousActive) return;
    elements.forEach((line, index) => {
      line.classList.toggle("active", index === active);
      if (index === active) line.setAttribute("aria-current", "true");
      else line.removeAttribute("aria-current");
    });
    progress.value = Math.max(0, active + 1);
    status.textContent = active < 0
      ? `Waiting for first line · ${lines.length} lines`
      : `Line ${active + 1} of ${lines.length} · sync approximate`;
    if (active >= 0) {
      const line = elements[active].getBoundingClientRect();
      const box = content.getBoundingClientRect();
      if (line.top < box.top) content.scrollTop -= box.top - line.top;
      else if (line.bottom > box.bottom) content.scrollTop += line.bottom - box.bottom;
    }
    previousActive = active;
  };
  elements.forEach((element, index) => element.addEventListener("click", () => {
    syncOffset += lines[index].time + lineDelay() - elapsed() + 0.01;
    previousActive = -2;
    sync();
  }));
  sync();
  return setInterval(sync, 100);
}

export function renderPlainLyrics({ lyrics, content, progress, status }) {
  progress.hidden = true;
  status.textContent = lyrics.source ? `Unsynced lyrics · ${lyrics.source}` : "Unsynced lyrics";
  content.classList.add("plain");
  content.textContent = lyrics.plainLyrics;
}
