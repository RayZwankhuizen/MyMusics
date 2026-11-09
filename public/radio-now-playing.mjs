export function createRadioNowPlaying({ isCurrent, onConnected, onMonitorStatus, onMetadata, onTrack, onPollTrack }) {
  let source = null;
  let timer = null;
  let generation = 0;

  function stop() {
    generation++;
    source?.close();
    source = null;
    clearTimeout(timer);
    timer = null;
  }

  async function poll(station, run) {
    try {
      const params = new URLSearchParams({ url: station.url });
      const response = await fetch(`/nowplaying?${params}`);
      if (response.ok) {
        const track = await response.json();
        if (track && run === generation && isCurrent(station)) await onPollTrack(track, station);
      }
    } catch {
      // The station can continue playing without track metadata.
    }
    if (run === generation && isCurrent(station)) timer = setTimeout(() => poll(station, run), 5000);
  }

  function start(station, { polling = false } = {}) {
    stop();
    const run = generation;
    if (polling) {
      void poll(station, run);
      return;
    }
    const params = new URLSearchParams({ url: station.url });
    source = new EventSource(`/nowplaying/events?${params}`);
    source.addEventListener("open", () => { if (run === generation && isCurrent(station)) onConnected(station); });
    source.addEventListener("error", () => { if (run === generation && isCurrent(station)) onMonitorStatus({ reconnecting: true }, station); });
    source.addEventListener("monitor-status", (event) => {
      if (run === generation && isCurrent(station)) onMonitorStatus(JSON.parse(event.data), station);
    });
    source.addEventListener("metadata", (event) => {
      if (run === generation && isCurrent(station)) onMetadata(JSON.parse(event.data), station);
    });
    source.addEventListener("track", (event) => {
      if (run === generation && isCurrent(station)) onTrack(JSON.parse(event.data), station);
    });
  }

  return Object.freeze({ start, stop });
}
