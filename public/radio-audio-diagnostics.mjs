import { createRadioAudioPlots } from "./radio-audio-plots.mjs";

export function wireRadioAudioDiagnostics({ open, dialog, close, status, scores, waveform, spectrogram, createAnalyser, getStation }) {
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
  let hostPoll;

  function paintHost(frame) {
    const line = waveform.getContext("2d");
    line.clearRect(0, 0, waveform.width, waveform.height);
    line.strokeStyle = "#74d8ff"; line.lineWidth = 2; line.beginPath();
    frame.waveform.forEach((value, index) => {
      const x = index * waveform.width / (frame.waveform.length - 1);
      const y = waveform.height * (0.5 - value * 0.48);
      index ? line.lineTo(x, y) : line.moveTo(x, y);
    }); line.stroke();
    const bars = spectrogram.getContext("2d");
    bars.drawImage(spectrogram, 0, -2);
    frame.spectrum.forEach((value, index) => {
      bars.fillStyle = `hsl(${195 - value * 0.35} 82% ${24 + value * 0.25}%)`;
      bars.fillRect(index * spectrogram.width / frame.spectrum.length, spectrogram.height - 2, Math.ceil(spectrogram.width / frame.spectrum.length), 2);
    });
    if (frame.scores) scores.textContent = `Speech ${Math.round(frame.scores[0] * 100)}% · Singing ${Math.round(frame.scores[1] * 100)}% · Music ${Math.round(frame.scores[2] * 100)}%`;
  }

  async function startHost() {
    const station = getStation?.();
    if (!station) { status.textContent = "Select a radio station first."; return; }
    const response = await fetch("/api/host-player/radio-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: station.url, classify: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Host audio analysis unavailable.");
    status.textContent = "Host analysis active · playback and volume are unchanged.";
    hostPoll = setInterval(async () => {
      try {
        const data = await (await fetch("/api/host-player/radio-analysis", { cache: "no-store" })).json();
        if (data.error) { status.textContent = data.error; return; }
        if (data.frame) paintHost(data.frame);
        if (data.frame && !data.frame.scores && data.running) status.textContent = "Waveform active; classifier is still loading or unavailable.";
      } catch {}
    }, 500);
  }

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
    clearInterval(hostPoll); hostPoll = undefined;
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
    if (getStation) { startHost().catch((error) => { status.textContent = error.message; }); return; }
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
    if (getStation) fetch("/api/host-player/radio-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", url: getStation()?.url }) }).catch(() => {});
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
