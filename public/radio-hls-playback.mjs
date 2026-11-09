export function createRadioHlsPlayback({ getAudio, setStatus, onMetadata, onTrack }) {
  let instance = null;
  let libraryPromise = null;

  function loadLibrary() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        script.remove();
        libraryPromise = null;
        reject(new Error("HLS library timed out"));
      }, 10000);
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Hls) resolve(window.Hls);
        else { libraryPromise = null; reject(new Error("HLS library unavailable")); }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        libraryPromise = null;
        reject(new Error("HLS library unavailable"));
      };
      document.head.append(script);
    });
    return libraryPromise;
  }

  async function play(station) {
    const audio = getAudio();
    const Hls = await loadLibrary().catch(() => null);
    if (Hls?.isSupported()) {
      instance = new Hls({ enableWorker: true });
      instance.loadSource(station.url);
      instance.attachMedia(audio);
      instance.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch((error) => setStatus(`PLAYBACK FAILED · ${error.name || error.message}`)));
      instance.on(Hls.Events.FRAG_PARSING_METADATA, (_event, data) => {
        for (const sample of data.samples || []) {
          const frames = sample.frames || [];
          const artist = frames.find((frame) => frame.key === "TPE1")?.info;
          const title = frames.find((frame) => frame.key === "TIT2")?.info;
          if (frames.length) onMetadata({
            source: "HLS ID3",
            receivedAt: new Date().toISOString(),
            raw: frames.map((frame) => `${frame.key}: ${frame.info || ""}`).join("\n"),
            fields: Object.fromEntries(frames.map((frame) => [frame.key, frame.info || ""]))
          });
          if (artist && title) onTrack(artist, title);
        }
      });
      instance.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setStatus("STREAM UNAVAILABLE"); });
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = station.url;
      await audio.play();
    } else {
      setStatus("HLS PLAYBACK UNAVAILABLE");
    }
  }

  function stop() {
    instance?.destroy();
    instance = null;
  }

  return Object.freeze({ play, stop });
}
