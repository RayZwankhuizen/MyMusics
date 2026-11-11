export function wireRadioPlayerBar({ getAudio, getBrowserMeterLevels, getStation, getGenre, getStations, isHostOutput, playStation }) {
  const button = document.querySelector("#radio-player-toggle");
  const volume = document.querySelector("#radio-player-volume");
  const stationText = document.querySelector("#radio-player-station");
  const trackText = document.querySelector("#radio-player-track");
  const logo = document.querySelector("#radio-player-logo");
  const live = document.querySelector("#radio-player-live");
  const meterLabel = document.querySelector(".receiver-vu-label");
  const meterBars = [...document.querySelectorAll(".receiver-vu-track > i")];
  let status = "READY";
  let meterTimer;

  function showMeter(levels = []) {
    const active = status === "ON AIR";
    const unavailable = active && levels.length < 2;
    const time = performance.now() / 1000;
    meterLabel.textContent = "STEREO · VU";
    meterBars.forEach((bar, index) => {
      const sway = Math.sin(time * (index ? 5.1 : 4.2) + index * 1.7) * 0.035;
      const level = !active ? 0 : unavailable
        ? 0.28 + Math.sin(time * (index ? 4.4 : 3.6) + index * 1.9) * 0.16
        : 0.04 + Math.min(1, Math.max(0, levels[index])) * 0.96 + sway;
      bar.style.transform = `scaleX(${1 - Math.max(0.04, Math.min(1, level))})`;
    });
  }

  async function pollHostMeter() {
    clearTimeout(meterTimer);
    if (!isHostOutput() || status !== "ON AIR" || document.hidden) { showMeter(); return; }
    try {
      const response = await fetch("/api/host-player/radio-level", { cache: "no-store" });
      const { levels = [] } = await response.json();
      if (isHostOutput() && status === "ON AIR") showMeter(levels);
    } catch { showMeter([]); }
    meterTimer = setTimeout(pollHostMeter, 160);
  }

  function drawBrowserMeter() {
    if (!isHostOutput()) {
      const levels = status === "ON AIR" ? getBrowserMeterLevels() : [];
      showMeter(levels || []);
    }
    requestAnimationFrame(drawBrowserMeter);
  }

  function updateButton() {
    const playing = isHostOutput() ? status === "ON AIR" : !getAudio().paused;
    if (!playing) showMeter();
    button.textContent = playing ? "Ⅱ" : "▶";
    button.setAttribute("aria-label", playing ? "Pause radio" : "Play radio");
    button.setAttribute("aria-pressed", String(playing));
  }
  function updateMediaSession() {
    if (!("mediaSession" in navigator) || !getStation()) return;
    const station = getStation();
    const title = document.querySelector("#track-title")?.textContent.trim();
    const artist = document.querySelector("#track-artist")?.textContent.trim();
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title && title !== "Waiting for a track" ? title : station.name,
        artist: artist && artist !== "Live radio" ? artist : station.genre || "Live radio",
        album: station.name,
        artwork: station.image ? [{ src: station.image }] : []
      });
      navigator.mediaSession.playbackState = isHostOutput() ? (status === "ON AIR" ? "playing" : "paused") : (getAudio().paused ? "paused" : "playing");
    } catch {}
  }
  function updateTrackLine() {
    const title = document.querySelector("#track-title")?.textContent.trim();
    const artist = document.querySelector("#track-artist")?.textContent.trim();
    trackText.textContent = title && title !== "Waiting for a track" ? `${artist && artist !== "Live radio" ? `${artist} · ` : ""}${title}` : "Live radio · waiting for track details";
    updateMediaSession();
  }
  function setStatus(detail = {}) {
    status = detail.message || status;
    live.textContent = status === "ON AIR" ? "LIVE" : status;
    live.dataset.state = status === "ON AIR" ? "live" : /BUFFERING|CONNECTING/.test(status) ? "loading" : status === "READY" ? "idle" : "error";
    updateButton();
    if (isHostOutput()) void pollHostMeter();
    updateMediaSession();
  }
  function setStation(station) {
    stationText.textContent = station?.name || "Choose a station";
    trackText.textContent = station ? "Live radio · waiting for track details" : "Live radio · nothing playing";
    logo.textContent = (station?.name || "M").trim().slice(0, 1).toLocaleUpperCase();
    logo.style.backgroundImage = station?.image ? `url("${station.image.replaceAll('"', '%22')}")` : "";
    button.disabled = !station;
    volume.disabled = !station;
    status = station ? "CONNECTING TO LIVE RADIO" : "READY";
    setStatus({ message: status });
  }
  function bindAudio() {
    const audio = getAudio();
    audio.addEventListener("play", updateButton);
    audio.addEventListener("pause", () => {
      if (getStation() && audio.currentSrc) setStatus({ message: "PAUSED" });
      else updateButton();
    });
    audio.addEventListener("playing", () => setStatus({ message: "ON AIR", live: true }));
    audio.addEventListener("waiting", () => setStatus({ message: "BUFFERING" }));
    audio.addEventListener("error", () => setStatus({ message: "STREAM UNAVAILABLE" }));
    audio.addEventListener("volumechange", updateButton);
    volume.value = String(Math.round(audio.volume * 100));
    updateButton();
  }
  function skipStation(direction) {
    const station = getStation();
    const stations = getStations()[getGenre()] || [];
    if (!station || stations.length < 2) return;
    const index = stations.findIndex((item) => item.url === station.url);
    const next = stations[(index + direction + stations.length) % stations.length];
    void playStation(next, getGenre());
  }
  button.addEventListener("click", () => {
    if (isHostOutput()) document.querySelector("#host-radio-toggle")?.click();
    else if (getAudio().paused) void getAudio().play().catch(() => {});
    else getAudio().pause();
  });
  volume.addEventListener("input", () => {
    if (isHostOutput()) {
      const hostVolume = document.querySelector("#host-radio-volume");
      hostVolume.value = volume.value;
      hostVolume.dispatchEvent(new Event("input", { bubbles: true }));
    } else getAudio().volume = Number(volume.value) / 100;
  });
  window.addEventListener("mymusics:radio-audio-replaced", bindAudio);
  window.addEventListener("mymusics:radio-status", (event) => setStatus(event.detail));
  window.addEventListener("mymusics:radio-station-change", (event) => setStation(event.detail));
  window.addEventListener("mymusics:playback-target-change", () => { volume.disabled = !getStation(); updateButton(); });
  window.addEventListener("mymusics:playback-target-change", () => {
    clearTimeout(meterTimer);
    showMeter();
    if (isHostOutput()) void pollHostMeter();
  });
  window.addEventListener("mymusics:media-action", (event) => {
    if (event.detail === "play" || event.detail === "pause" || event.detail === "toggle") button.click();
    if (event.detail === "next") skipStation(1);
    if (event.detail === "previous") skipStation(-1);
  });
  if ("mediaSession" in navigator) {
    for (const [action, detail] of [["play", "play"], ["pause", "pause"], ["nexttrack", "next"], ["previoustrack", "previous"], ["seekforward", "forward"], ["seekbackward", "rewind"]]) {
      try { navigator.mediaSession.setActionHandler(action, () => window.dispatchEvent(new CustomEvent("mymusics:media-action", { detail }))); } catch {}
    }
  }
  bindAudio();
  requestAnimationFrame(drawBrowserMeter);
  setStation(getStation());
  const nowPlaying = document.querySelector("#track-title");
  const artist = document.querySelector("#track-artist");
  if (nowPlaying && artist) new MutationObserver(updateTrackLine).observe(nowPlaying.parentElement, { childList: true, characterData: true, subtree: true });
  return Object.freeze({});
}
