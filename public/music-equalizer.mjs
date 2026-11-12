import { createHostEqualizer } from "./host-equalizer.mjs";
export function createMusicEqualizer({ deckState, getCurrentTrack, isHostOutput }) {
  const decks = [deckState.decks.a, deckState.decks.b];
  const hostEqualizer = createHostEqualizer(isHostOutput);
  let context = null;
  let ready = false;
  let enabled = false;
  let filters = [];
  let frame = 0;
  let phase = 0;
  const el = (selector) => document.querySelector(selector);

  function buildControls() {
    window.MyMusicsEqualizer.buildControls(el("#equalizer-bands"), () => filters, el("#equalizer-preset"));
  }

  function applyPreset(name) {
    window.MyMusicsEqualizer.applyPreset(name, el("#equalizer-bands"), () => filters, el("#equalizer-preset"));
  }

  const genrePresets = [
    [/classical|classique|orchestral|opera/, "classical"],
    [/spoken|speech|podcast|audiobook|talk/, "spoken"],
    [/electronic|edm|techno|house|trance|dance|disco|synthwave/, "electronic"],
    [/country|bluegrass/, "country"],
    [/jazz|swing|bebop/, "jazz"],
    [/rock|metal|punk|grunge|hardcore/, "rock"],
    [/pop|dance-pop|k-pop/, "pop"]
  ];

  function autoPreset(track) {
    const genre = [track?.genre, ...(Array.isArray(track?.genres) ? track.genres : [])]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    if (!genre) return;
    const preset = genrePresets.find(([pattern]) => pattern.test(genre))?.[1];
    if (!preset) return;
    applyPreset(preset);
    el("#equalizer-status").textContent = `EQ set to ${preset} from track genre: ${genre}.`;
  }

  function setEnabled(value) {
    if (!ready) return;
    enabled = value;
    window.MyMusicsEqualizer.setEnabled(context, el("#equalizer-power"), value);
  }

  function draw() {
    cancelAnimationFrame(frame);
    if (!ready || !el("#equalizer-panel").open || document.hidden) return;
    const canvas = el("#equalizer-visual");
    const playing = decks.some((audio) => !audio.paused && !audio.ended);
    phase = window.MyMusicsEqualizer.drawFrame({
      canvas,
      analyser: context.analyser,
      sampleRate: context.context.sampleRate,
      sensitivity: Number(el("#equalizer-sensitivity").value),
      playing,
      phase
    });
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(draw);
  }

  async function enable() {
    if (isHostOutput()) {
      hostEqualizer.refresh();
      return true;
    }
    if (ready) {
      setEnabled(true);
      draw();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      el("#equalizer-status").textContent = "Audio processing is unavailable in this browser.";
      return false;
    }
    const audioContext = new AudioContextClass();
    try {
      const graph = window.MyMusicsEqualizer.createGraph(
        audioContext,
        decks,
        (index) => Number(document.querySelectorAll(".equalizer-band input")[index].value),
        true
      );
      filters = graph.filters;
      context = { context: audioContext, analyser: graph.analyser, dryGain: graph.dryGain, wetGain: graph.wetGain, meterAnalyserSets: graph.meterAnalyserSets };
      ready = true;
      document.querySelectorAll(".equalizer-band input").forEach((input) => { input.disabled = false; });
      el("#equalizer-reset").disabled = false;
      el("#equalizer-preset").disabled = false;
      el("#equalizer-power").disabled = false;
      setEnabled(true);
      if (getCurrentTrack()?.genre) autoPreset(getCurrentTrack());
      else el("#equalizer-status").textContent = "Adjust the bands from −12 to +12 dB.";
      await audioContext.resume();
      draw();
      return true;
    } catch {
      audioContext.close().catch(() => {});
      context = null;
      ready = false;
      el("#equalizer-status").textContent = "The equalizer is unavailable in this browser.";
      return false;
    }
  }

  async function prepare() {
    if (isHostOutput()) return false;
    if (!ready) return enable();
    await context.context.resume();
    return true;
  }

  function wireControls() {
    const panel = el("#equalizer-panel");
    el("#equalizer-close").addEventListener("click", () => panel.close());
    panel.addEventListener("close", () => {
      el("#eq-toggle").setAttribute("aria-expanded", "false");
      cancelAnimationFrame(frame);
    });
    el("#eq-toggle").addEventListener("click", async () => {
      if (panel.open) { panel.close(); return; }
      panel.showModal();
      el("#eq-toggle").setAttribute("aria-expanded", "true");
      if (isHostOutput() || !ready) await enable();
      else draw();
    });
    window.addEventListener("mymusics:playback-target-change", () => {
      const disabled = isHostOutput();
      if (disabled) { hostEqualizer.refresh(); return; }
      el("#equalizer-power").disabled = disabled || !ready;
      el("#equalizer-reset").disabled = disabled || !ready;
      el("#equalizer-preset").disabled = disabled || !ready;
      document.querySelectorAll(".equalizer-band input").forEach((input) => { input.disabled = disabled || !ready; });
      if (ready) setEnabled(enabled);
    });
    el("#equalizer-power").addEventListener("click", () => isHostOutput() ? hostEqualizer.toggle() : setEnabled(!enabled));
    el("#equalizer-preset").addEventListener("change", (event) => applyPreset(event.currentTarget.value));
    el("#equalizer-reset").addEventListener("click", () => applyPreset("flat"));
    el("#equalizer-sensitivity").addEventListener("input", (event) => {
      el("#equalizer-sensitivity-value").value = `${Number(event.target.value).toFixed(1)}×`;
      draw();
    });
    document.addEventListener("visibilitychange", () => document.hidden ? cancelAnimationFrame(frame) : draw());
  }

  function getMeterLevels() {
    const analysers = context?.meterAnalyserSets?.[deckState.activeDeck === "b" ? 1 : 0];
    if (!ready || !analysers?.length) return null;
    return analysers.map((analyser) => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 54) / 54));
    });
  }

  return Object.freeze({ buildControls, wireEvents: wireControls, autoPreset, prepare, getMeterLevels });
}
