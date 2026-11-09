export function wireManageStationPreview() {
  let active = null;
  let generation = 0;
  let hlsPromise = null;

  function stop() {
    generation++;
    if (!active) return;
    active.hls?.destroy();
    active.audio.pause();
    active.audio.removeAttribute("src");
    active.audio.load();
    active.audio.hidden = true;
    active.button.textContent = "Test";
    active.button.setAttribute("aria-expanded", "false");
    active.status.textContent = "";
    active = null;
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
      const timeout = setTimeout(() => { script.remove(); hlsPromise = null; reject(new Error("HLS playback is unavailable.")); }, 10000);
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Hls) resolve(window.Hls);
        else { hlsPromise = null; reject(new Error("HLS playback is unavailable.")); }
      };
      script.onerror = () => { clearTimeout(timeout); hlsPromise = null; reject(new Error("HLS playback is unavailable.")); };
      document.head.append(script);
    });
    return hlsPromise;
  }

  async function play(station, button, row) {
    if (active?.button === button) { stop(); return; }
    stop();
    const audio = row.querySelector("audio");
    const status = row.querySelector("[data-preview-status]");
    const currentGeneration = generation;
    active = { audio, button, status, hls: null };
    audio.hidden = false;
    button.disabled = true;
    status.textContent = `Connecting to ${station.name}…`;
    try {
      if ((station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url)) && !audio.canPlayType("application/vnd.apple.mpegurl")) {
        const Hls = await loadHls();
        if (currentGeneration !== generation) return;
        if (!Hls.isSupported()) throw new Error("HLS is not supported by this browser.");
        const hls = new Hls();
        active.hls = hls;
        hls.loadSource(station.url);
        hls.attachMedia(audio);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("The stream did not start.")), 15000);
          hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().then(resolve, reject));
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) reject(new Error("The stream could not be played.")); });
          audio.addEventListener("playing", () => { clearTimeout(timeout); resolve(); }, { once: true });
        });
      } else {
        audio.src = station.url;
        await audio.play();
      }
      if (currentGeneration !== generation) return;
      button.textContent = "Stop test";
      button.setAttribute("aria-expanded", "true");
      status.textContent = `Testing ${station.name}.`;
      audio.addEventListener("error", () => { if (active?.audio === audio) status.textContent = "Stream unavailable. Check the URL or stream type."; }, { once: true });
    } catch (error) {
      if (currentGeneration === generation) {
        const message = error.message === "NotAllowedError" ? "Playback was blocked by the browser." : error.message;
        stop();
        status.textContent = message;
      }
    } finally {
      button.disabled = false;
    }
  }

  return Object.freeze({ play, stop });
}
