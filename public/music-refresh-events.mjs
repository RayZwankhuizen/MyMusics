export function refreshOutcome({ completed, progressAvailable, progressUnavailableMessage, sawRunning, lastProgress }) {
  if (completed) return { progress: null, message: "Jellyfin library refresh complete." };
  if (!progressAvailable) return {
    progress: null,
    message: progressUnavailableMessage || "Refresh requested · Jellyfin does not report scan progress."
  };
  if (sawRunning) return {
    progress: lastProgress,
    message: lastProgress === null ? "Jellyfin scan is still running." : `Jellyfin scan is still running · ${Math.round(lastProgress)}%`
  };
  return { progress: null, message: "Refresh requested · Jellyfin has not reported scan progress yet." };
}

export async function pollRefreshStatus({
  fetchStatus = () => fetch("/api/music/refresh/status"),
  reportRefresh,
  setRefreshProgress,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  const startedAt = now();
  let sawRunning = false;
  let completed = false;
  let progressAvailable = true;
  let lastProgress = null;
  let progressUnavailableMessage = "";
  while (now() - startedAt < (sawRunning ? 30 * 60_000 : 20_000)) {
    const response = await fetchStatus();
    if (!response.ok) {
      progressAvailable = false;
      progressUnavailableMessage = response.status === 404
        ? "Refresh sent · restart MyMusics to enable scan progress."
        : "Refresh sent · scan progress could not be read.";
      break;
    }
    const status = await response.json();
    if (!status.available) { progressAvailable = false; break; }
    if (status.running) {
      sawRunning = true;
      lastProgress = status.progress;
      setRefreshProgress(lastProgress);
      reportRefresh(lastProgress === null ? "Jellyfin is scanning the library…" : `Jellyfin is scanning the library · ${Math.round(lastProgress)}%`);
    } else if (sawRunning) {
      completed = true;
      break;
    } else {
      reportRefresh("Refresh requested · waiting for Jellyfin to start the scan…");
    }
    await wait(1500);
  }
  return { completed, progressAvailable, sawRunning, lastProgress, progressUnavailableMessage };
}

export function wireMusicRefreshEvents({ el, jbState, loadJukeboxTab, runJukeboxSearch }) {
  const musicRefreshBtn = el("#music-refresh");
  if (!musicRefreshBtn) return;
  let refreshStatusClearTimer;
  musicRefreshBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);
  musicRefreshBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    musicRefreshBtn.disabled = true;
    const reportRefresh = (message) => {
      el("#music-search-status").textContent = message;
      const toolbarStatus = el("#music-toolbar-status");
      if (toolbarStatus) toolbarStatus.textContent = message;
      if (el("#jb-search-dialog")?.open) el("#jb-search-feedback").textContent = message;
    };
    const reportTerminalRefresh = (message) => {
      clearTimeout(refreshStatusClearTimer);
      reportRefresh(message);
      refreshStatusClearTimer = setTimeout(() => reportRefresh(""), 12_000);
    };
    clearTimeout(refreshStatusClearTimer);
    const progressBar = el("#music-refresh-progress");
    const setRefreshProgress = (value) => {
      progressBar.hidden = value === null;
      if (value === null) progressBar.removeAttribute("value");
      else progressBar.value = value;
    };
    reportRefresh("Updating music library…");
    try {
      const refreshResponse = await fetch("/api/music/refresh", { method: "POST" });
      const refreshResult = await refreshResponse.json().catch(() => ({}));
      if (!refreshResponse.ok) throw new Error(refreshResult.error || "Could not refresh the Jellyfin library.");

      const refreshStatus = await pollRefreshStatus({ reportRefresh, setRefreshProgress });
      const { completed, progressAvailable, sawRunning, lastProgress, progressUnavailableMessage } = refreshStatus;

      jbState.cache = {};
      await loadJukeboxTab(jbState.tab, true);
      const searchTerm = el("#jb-search")?.value.trim();
      if (searchTerm) await runJukeboxSearch(searchTerm);

      const outcome = refreshOutcome({ completed, progressAvailable, progressUnavailableMessage, sawRunning, lastProgress });
      setRefreshProgress(outcome.progress);
      reportTerminalRefresh(outcome.message);
    } catch (error) {
      setRefreshProgress(null);
      reportTerminalRefresh(error.message || "Update failed.");
    } finally {
      musicRefreshBtn.disabled = false;
    }
  }, true);
}
