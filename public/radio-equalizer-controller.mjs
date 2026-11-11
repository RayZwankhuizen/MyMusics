import { createHostEqualizer } from "./host-equalizer.mjs";
export function createRadioEqualizerController({ getAudio, getStation, getStationGenre, getStationIndex, getGeneration, isHostOutput, streamUrl, replaceAudio, onStationUpdated }) {
  const bands = document.querySelector("#equalizer-bands");
  const preset = document.querySelector("#equalizer-preset");
  const panel = document.querySelector("#equalizer-panel");
  const hostEqualizer = createHostEqualizer(isHostOutput);
  let context = null;
  let ready = false;
  let enabled = false;
  let frame = 0;
  let phase = 0;
  let filters = [];

  function setEnabled(value) {
    if (!ready) return;
    enabled = value;
    window.MyMusicsEqualizer.setEnabled(context, document.querySelector("#equalizer-power"), enabled);
  }

  function applyPreset(name) {
    window.MyMusicsEqualizer.applyPreset(name, bands, () => filters, preset);
  }

  async function choosePreset(name) {
    applyPreset(name);
    const station = getStation();
    const genre = getStationGenre();
    if (!station || !genre || name === "custom") return;
    const index = getStationIndex(station, genre);
    if (index < 0) return;
    document.querySelector("#equalizer-status").textContent = "Saving station preset…";
    try {
      const response = await fetch(`/api/genres/${encodeURIComponent(genre)}/stations/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...station, genre, equalizerPreset: name })
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Could not save this station preset.");
      onStationUpdated(updated, index, genre);
      document.querySelector("#equalizer-status").textContent = `Preset saved for ${getStation().name}.`;
    } catch (error) { document.querySelector("#equalizer-status").textContent = error.message; }
  }

  function draw() {
    cancelAnimationFrame(frame);
    if (!ready || !panel.open || document.hidden) return;
    const audio = getAudio();
    phase = window.MyMusicsEqualizer.drawFrame({
      canvas: document.querySelector("#equalizer-visual"),
      analyser: context.analyser,
      sampleRate: context.context.sampleRate,
      sensitivity: Number(document.querySelector("#equalizer-sensitivity").value),
      playing: !audio.paused && !audio.ended,
      phase
    });
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(draw);
  }

  function reset() {
    cancelAnimationFrame(frame);
    ready = false;
    enabled = false;
    filters = [];
    for (const selector of ["#equalizer-reset", "#equalizer-preset", "#equalizer-power"]) document.querySelector(selector).disabled = true;
    document.querySelector("#equalizer-power").setAttribute("aria-pressed", "false");
    document.querySelector("#equalizer-power").textContent = "EQ Off";
    bands.querySelectorAll("input").forEach((input) => { input.disabled = true; });
    const canvas = document.querySelector("#equalizer-visual");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  async function enable({ autoplay = true } = {}) {
    if (isHostOutput()) {
      hostEqualizer.refresh();
      return true;
    }
    if (ready) {
      if (autoplay) setEnabled(true);
      await context.context.resume();
      draw();
      return true;
    }
    const station = getStation();
    if (!station || station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url)) {
      document.querySelector("#equalizer-status").textContent = "Equalizer needs an MP3 stream.";
      return false;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      document.querySelector("#equalizer-status").textContent = "Audio processing is unavailable in this browser.";
      return false;
    }
    document.querySelector("#equalizer-status").textContent = "Checking stream support…";
    const generation = getGeneration();
    const audioContext = new AudioContextClass();
    const replacement = document.createElement("audio");
    replacement.crossOrigin = "anonymous";
    let switchedAudio = false;
    try {
      const graph = window.MyMusicsEqualizer.createGraph(audioContext, [replacement], (index) => Number(bands.querySelectorAll("input")[index].value), true);
      await audioContext.resume();
      if (generation !== getGeneration() || station !== getStation()) { audioContext.close().catch(() => {}); return false; }
      replaceAudio(replacement);
      switchedAudio = true;
      context = { context: audioContext, analyser: graph.analyser, dryGain: graph.dryGain, wetGain: graph.wetGain, meterAnalysers: graph.meterAnalysers };
      filters = graph.filters;
      ready = true;
      bands.querySelectorAll("input").forEach((input) => { input.disabled = false; });
      document.querySelector("#equalizer-reset").disabled = false;
      preset.disabled = false;
      document.querySelector("#equalizer-power").disabled = false;
      setEnabled(true);
      document.querySelector("#equalizer-status").textContent = "Adjust the bands from −12 to +12 dB.";
      if (autoplay) {
        getAudio().src = streamUrl(station.url);
        await getAudio().play();
      }
      draw();
      return true;
    } catch {
      audioContext.close().catch(() => {});
      context = null;
      reset();
      if (switchedAudio) replaceAudio();
      if (autoplay && switchedAudio && station === getStation() && generation === getGeneration()) {
        getAudio().src = station.url;
        getAudio().play().catch(() => {});
      }
      document.querySelector("#equalizer-status").textContent = "Equalizer unavailable; the radio stream continues without EQ.";
      return false;
    }
  }

  window.MyMusicsEqualizer.buildControls(bands, () => filters, preset);
  preset.addEventListener("change", (event) => choosePreset(event.currentTarget.value));
  document.querySelector("#equalizer-power").addEventListener("click", () => isHostOutput() ? hostEqualizer.toggle() : setEnabled(!enabled));
  document.querySelector("#equalizer-toggle").addEventListener("click", async () => {
    const toggle = document.querySelector("#equalizer-toggle");
    if (panel.open) { panel.close(); return; }
    panel.showModal();
    toggle.setAttribute("aria-expanded", "true");
    if (isHostOutput() || !ready) await enable();
    else draw();
  });
  document.querySelector("#equalizer-close").addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => {
    document.querySelector("#equalizer-toggle").setAttribute("aria-expanded", "false");
    cancelAnimationFrame(frame);
  });
  document.querySelector("#equalizer-reset").addEventListener("click", () => choosePreset("flat"));
  document.querySelector("#equalizer-sensitivity").addEventListener("input", (event) => {
    document.querySelector("#equalizer-sensitivity-value").value = `${Number(event.target.value).toFixed(1)}×`;
    draw();
  });
  document.addEventListener("visibilitychange", () => document.hidden ? cancelAnimationFrame(frame) : draw());

  return Object.freeze({
    applyPreset,
    draw,
    enable,
    reset,
    getMeterLevels() {
      if (!ready || !context?.meterAnalysers?.length) return null;
      return context.meterAnalysers.map((analyser) => {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 54) / 54));
      });
    },
    get ready() { return ready; },
    closeContext() { context?.context.close().catch(() => {}); context = null; reset(); },
    setHostOutput(host) {
      if (host) { hostEqualizer.refresh(); return; }
      for (const selector of ["#equalizer-power", "#equalizer-reset", "#equalizer-preset"]) document.querySelector(selector).disabled = host || !ready;
      bands.querySelectorAll("input").forEach((input) => { input.disabled = host || !ready; });
      if (ready) setEnabled(enabled);
    }
  });
}
