import { hostEqualizerSettings } from "./host-equalizer.mjs";
export function createRadioHostOutput({ getAudio, setStatus, isHostOutput }) {
  const controls = document.querySelector("#host-radio-controls");
  const toggle = document.querySelector("#host-radio-toggle");
  const status = document.querySelector("#host-radio-status");
  let currentUrl = "";
  let currentSessionId = "";
  let pageLeaving = false;
  let paused = false;
  let volumeTimer;

  async function control(action, value) {
    const state = await fetch("/api/host-player/status").then((response) => response.json()).catch(() => null);
    return fetch("/api/host-player/control", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: state?.activeDeck || "a", action, ...(value === undefined ? {} : { value }) })
    });
  }

  async function play(station, volume = 0) {
    controls.hidden = !isHostOutput();
    if (isHostOutput()) document.querySelector("#equalizer-status").textContent = "Host equalizer · MPV audio processing";
    if (!currentUrl && isHostOutput()) setStatus("CONNECTING TO MYMUSICS HOST");
    try {
      const response = await fetch("/api/host-player/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: station.url, volume, equalizer: hostEqualizerSettings() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Host playback failed.");
      currentSessionId = result.sessionId || "";
      if (pageLeaving) return stopForNavigation();
      window.MyMusicsPlayback?.setHostSession(currentSessionId);
      currentUrl = station.url;
      paused = false;
      toggle.textContent = "Pause";
      status.textContent = "Playing through MyMusics host";
      await setVolume(isHostOutput() ? Number(document.querySelector("#radio-player-volume").value) : 0);
      if (isHostOutput()) setStatus("ON AIR", true);
    } catch (error) {
      status.textContent = error.message;
      if (isHostOutput()) setStatus("HOST AUDIO UNAVAILABLE");
    }
  }

  async function stop() {
    window.MyMusicsPlayback?.setHostSession("");
    currentUrl = "";
    currentSessionId = "";
    await fetch("/api/host-player/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" })
    }).catch(() => {});
  }

  async function setPaused(value) {
    paused = Boolean(value);
    if (paused) getAudio().pause();
    else getAudio().play().catch(() => {});
    const response = await control(paused ? "pause" : "resume").catch(() => null);
    if (!response?.ok) return;
    toggle.textContent = paused ? "Resume" : "Pause";
    if (isHostOutput()) setStatus(paused ? "PAUSED" : "ON AIR", !paused);
  }

  function togglePaused() { return setPaused(!paused); }

  function stopForNavigation() {
    pageLeaving = true;
    const sessionId = currentSessionId;
    currentSessionId = "";
    currentUrl = "";
    paused = true;
    getAudio().pause();
    window.MyMusicsPlayback?.setHostSession("");
    if (!sessionId) return;
    void fetch("/api/host-player/radio/stop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }), keepalive: true
    }).catch(() => {});
  }

  toggle?.addEventListener("click", () => { void togglePaused(); });

  async function setVolume(value) {
    const level = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const slider = document.querySelector("#host-radio-volume");
    if (slider) slider.value = String(level);
    clearTimeout(volumeTimer);
    if (currentUrl) volumeTimer = setTimeout(() => { void control("volume", level).catch(() => {}); }, 60);
  }

  document.querySelector("#host-radio-volume")?.addEventListener("input", (event) => {
    document.querySelector("#radio-player-volume").value = event.target.value;
    document.querySelector("#radio-player-volume").dispatchEvent(new Event("input", { bubbles: true }));
  });

  window.addEventListener("pageshow", () => { pageLeaving = false; });

  return Object.freeze({ play, stop, setPaused, togglePaused, stopForNavigation, setVolume });
}
