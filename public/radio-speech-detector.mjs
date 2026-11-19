export function createRadioSpeechDetector({ createInput, onSpeechStart, onSpeechEnd, onMisfire, onStopped, onStatus, onFrame }) {
  let detector = null;
  let input = null;
  let generation = 0;
  let lastDetectedAt = 0;
  let speechActive = false;
  let loadPromise = null;

  function dispose(instance) {
    void Promise.resolve().then(() => instance.destroy ? instance.destroy() : instance.pause()).catch(() => {});
  }

  function stop() {
    generation++;
    lastDetectedAt = 0;
    speechActive = false;
    if (detector) dispose(detector);
    detector = null;
    input?.close();
    input = null;
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
      onFrameProcessed: (_probabilities, frame) => { if (current()) onFrame?.(frame); },
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

  async function start() {
    stop();
    const run = generation;
    onStatus("loading");
    try {
      const analysis = createInput();
      if (!analysis) {
        onStatus("stream-blocked");
        return;
      }
      input = analysis;
      await loadVad();
      if (run !== generation) return;
      const instance = await window.vad.MicVAD.new(detectorOptions(run, analysis));
      if (run !== generation) {
        dispose(instance);
        return;
      }
      detector = instance;
      await instance.start();
      if (run !== generation) return;
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
