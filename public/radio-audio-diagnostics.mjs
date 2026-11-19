import { createRadioAudioPlots } from "./radio-audio-plots.mjs";

export function wireRadioAudioDiagnostics({ open, dialog, close, status, scores, waveform, spectrogram, createAnalyser }) {
  const plots = createRadioAudioPlots({ waveform, spectrogram, createAnalyser });
  // YAMNet consumes 975 ms of mono audio at the VAD's 16 kHz sample rate.
  const samplesPerWindow = 15600;
  let worker;
  let loadTimer;
  let ready = false;
  let busy = false;
  let detectorState = "idle";
  let generation = 0;
  let samples;
  let sampleCount = 0;

  function resetSamples() {
    generation++;
    sampleCount = 0;
    scores.textContent = "";
  }

  function updateStatus() {
    status.textContent = !worker ? ""
      : !ready ? "Loading audio classifier…"
      : detectorState === "stream-blocked" || detectorState === "unavailable" ? "Radio voice detector unavailable."
      : detectorState !== "ready" ? "Waiting for active station speech detection."
      : "Classification active · volume control unchanged.";
  }

  function stop() {
    clearTimeout(loadTimer);
    worker?.terminate();
    worker = undefined;
    ready = false;
    busy = false;
    samples = undefined;
    resetSamples();
    updateStatus();
  }

  function fail() {
    stop();
    status.textContent = "Audio classifier unavailable in this browser.";
  }

  open.addEventListener("click", () => {
    if (dialog.open) return;
    stop();
    dialog.showModal();
    plots.start();
    try {
      const session = new Worker(new URL("./radio-audio-classifier.worker.mjs", import.meta.url), { type: "module" });
      worker = session;
      loadTimer = setTimeout(fail, 20000);
      session.addEventListener("error", () => { if (worker === session) fail(); });
      session.addEventListener("message", ({ data }) => {
        if (worker !== session) return;
        if (data.error) {
          fail();
        } else if (data.ready) {
          clearTimeout(loadTimer);
          ready = true;
          updateStatus();
        } else {
          busy = false;
          if (data.generation !== generation || detectorState !== "ready") return;
          const [speech, singing, music] = data.scores.map((score) => `${Math.round(score * 100)}%`);
          scores.textContent = `Speech ${speech} · Singing ${singing} · Music ${music}`;
        }
      });
      updateStatus();
    } catch {
      fail();
    }
  });

  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    stop();
    plots.stop();
  });

  return Object.freeze({
    setDetectorStatus(state) {
      detectorState = state;
      resetSamples();
      if (dialog.open && state === "ready") plots.start();
      else plots.stop();
      if (worker || !dialog.open) updateStatus();
    },
    addFrame(frame) {
      if (!dialog.open || !ready || busy || detectorState !== "ready") return;
      samples ||= new Float32Array(samplesPerWindow);
      const slice = frame.subarray(0, samplesPerWindow - sampleCount);
      samples.set(slice, sampleCount);
      sampleCount += slice.length;
      if (sampleCount < samplesPerWindow) return;
      busy = true;
      try { worker.postMessage({ samples, generation }, [samples.buffer]); }
      catch { fail(); }
      samples = undefined;
      sampleCount = 0;
    }
  });
}
