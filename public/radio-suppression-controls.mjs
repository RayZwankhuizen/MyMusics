export function createRadioSuppressionControls({ getStation, disabledStations, saveDisabledStations, controller, stopDetection, startDetection }) {
  const el = (selector) => document.querySelector(selector);

  function updateButton() {
    const station = getStation();
    const enabled = Boolean(station && !disabledStations.has(station.url));
    const button = el("#speech-suppression");
    button.disabled = !station || station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url);
    button.setAttribute("aria-pressed", String(enabled));
    const volumeButton = el("#speech-volume-open");
    volumeButton.disabled = button.disabled;
    volumeButton.textContent = `${station?.speechVolumePercent ?? 30}%`;
    volumeButton.setAttribute("aria-label", `Set speech and ad volume, ${station?.speechVolumePercent ?? 30}%`);
    if (button.disabled && station) {
      el("#speech-suppression-status").textContent = "HLS unavailable";
      el("#speech-suppression-status").dataset.state = "off";
    } else if (!enabled) {
      el("#speech-suppression-status").textContent = "Off";
      el("#speech-suppression-status").dataset.state = "off";
    }
  }

  el("#speech-feedback").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-suppress]");
    if (!button || !controller.currentTrackKey) return;
    controller.setTrack(controller.currentTrackKey, button.dataset.suppress === "true");
    el("#speech-feedback").hidden = true;
  });

  el("#speech-suppression").addEventListener("click", () => {
    const station = getStation();
    if (!station) return;
    if (!disabledStations.has(station.url)) {
      disabledStations.add(station.url);
      stopDetection();
      el("#speech-suppression-status").textContent = "Off";
      el("#speech-suppression-status").dataset.state = "off";
    } else {
      disabledStations.delete(station.url);
      startDetection(station);
    }
    saveDisabledStations();
    updateButton();
  });

  el("#track-suppression").addEventListener("click", () => {
    const key = controller.currentTrackKey;
    if (key) controller.setTrack(key, !controller.isTrackEnabled(key));
  });

  return updateButton;
}
