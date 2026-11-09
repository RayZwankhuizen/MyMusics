export function createRadioSpeechDetector({ streamUrl, onSpeechStart, onSpeechEnd, onMisfire, onStopped, onStatus }) {
  let detector = null;
  let detectorAudio = null;
  let context = null;
  let generation = 0;
  let lastDetectedAt = 0;
  let speechActive = false;
  let loadPromise = null;

  function stop() {
    generation++;
    lastDetectedAt = 0;
    speechActive = false;
    detector?.pause();
    detector = null;
    if (detectorAudio) {
      detectorAudio.pause();
      detectorAudio.removeAttribute("src");
      detectorAudio.load();
    }
    detectorAudio = null;
    context?.close().catch(() => {});
    context = null;
    onStopped();
  }

  function loadVad() {
    if (window.vad?.MicVAD) return Promise.resolve();
    if (loadPromise) return loadPromise;
    const load = (src) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Speech detector failed to load"));
      document.head.append(script);
    });
    loadPromise = load("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js")
      .then(() => load("https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/bundle.min.js"))
      .then(() => { if (!window.vad?.MicVAD) throw new Error("Speech detector unavailable"); })
      .catch((error) => { loadPromise = null; throw error; });
    return loadPromise;
  }

  function detectorOptions(run, input) {
    const current = () => run === generation;
    return {
      model: "v5",
      getStream: async () => input.stream,
      pauseStream: async () => {},
      resumeStream: async (stream) => stream,
      onSpeechRealStart: () => {
        if (!current()) return;
        speechActive = true;
        lastDetectedAt = Date.now();
        onSpeechStart();
      },
      onSpeechEnd: () => {
        if (!current()) return;
        speechActive = false;
        lastDetectedAt = Date.now();
        onSpeechEnd();
      },
      onVADMisfire: () => { if (current()) { speechActive = false; onMisfire(); } },
      baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
      onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/"
    };
  }

  async function start(station) {
    stop();
    const run = generation;
    onStatus("loading");
    try {
      context = new AudioContext();
      const resumed = context.resume();
      detectorAudio = new Audio();
      detectorAudio.crossOrigin = "anonymous";
      detectorAudio.preload = "none";
      detectorAudio.src = streamUrl(station.url);
      const source = context.createMediaElementSource(detectorAudio);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      source.connect(silentOutput).connect(context.destination);
      const input = context.createMediaStreamDestination();
      source.connect(input);
      await Promise.all([resumed, detectorAudio.play(), loadVad()]);
      if (run !== generation) return;
      detector = await window.vad.MicVAD.new(detectorOptions(run, input));
      if (run !== generation) { detector.pause(); detector = null; return; }
      detector.start();
      onStatus("ready");
    } catch (error) {
      if (run !== generation) return;
      stop();
      onStatus(error.name === "TypeError" ? "stream-blocked" : "unavailable");
    }
  }

  return Object.freeze({
    start,
    stop,
    get active() { return Boolean(detector); },
    get speechActive() { return speechActive; },
    recentlyDetected: () => Date.now() - lastDetectedAt < 10000
  });
}
