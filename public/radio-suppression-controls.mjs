export function createRadioSuppressionControls({ getStation, disabledStations, saveDisabledStations, controller, stopDetection, startDetection }) {
  const el = (selector) => document.querySelector(selector);

  function updateButton() {
    const station = getStation();
    const enabled = Boolean(station && !disabledStations.has(station.url));
    const button = el("#speech-suppression");
    button.disabled = !station || station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url);
    button.setAttribute("aria-pressed", String(enabled && !button.disabled));
    button.textContent = `Speech suppression: ${enabled && !button.disabled ? "On" : "Off"}`;
    const volumeButton = el("#speech-volume-open");
    volumeButton.disabled = button.disabled;
    volumeButton.textContent = `Speech settings (${station?.speechVolumePercent ?? 30}%)`;
    controller.renderStatus();
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
      el("#speech-feedback").hidden = true;
    } else {
      disabledStations.delete(station.url);
      startDetection(station);
      if (controller.metadataBlockDucked) controller.setDucked(true);
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
