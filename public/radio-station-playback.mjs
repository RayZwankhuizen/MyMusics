export function createRadioStationPlayback({ state, players, ui }) {
  async function play(station, genre) {
    const generation = state.nextGeneration();
    const useHostOutput = state.isHostOutput();
    const audio = state.getAudio();
    audio.hidden = Boolean(useHostOutput);
    if (!useHostOutput && players.equalizer.ready) {
      const compatible = station.type !== "hls" && !/\.m3u8(?:$|[?#])/i.test(station.url);
      if (!compatible) {
        players.equalizer.closeContext();
        ui.replaceAudio();
        ui.showEqualizerUnavailable();
      }
    }
    const isHls = station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url);
    if (!prepare(station, genre, generation, isHls)) return;

    if (useHostOutput) {
      await players.hostOutput.play(station);
      return;
    }
    ui.hideHostControls();
    await players.browser.play(station, isHls);
  }

  function prepare(station, genre, generation, isHls) {
    ui.stopSpeechDetection();
    players.hls.stop();
    players.nowPlaying.stop();
    ui.resetTrackMetadata();
    state.setStation(station, genre);
    players.equalizer.applyPreset(station.equalizerPreset || ui.defaultEqualizerPreset(genre));
    ui.updateSuppressionButton();
    ui.renderStations();
    ui.showStation(station);
    window.dispatchEvent(new CustomEvent("mymusics:radio-station-change", { detail: station }));
    ui.resetMetadataMonitor(station);
    if (isHls) ui.showPollingMetadata();
    if (!state.isCurrentGeneration(generation)) return false;
    players.nowPlaying.start(station, { polling: isHls });
    return true;
  }

  async function onPlaybackTargetChange() {
    const useHostOutput = state.isHostOutput();
    players.equalizer.setHostOutput(useHostOutput);
    const station = state.getStation();
    if (!station) return;
    if (!useHostOutput) await players.hostOutput.stop();
    void play(station, state.getGenre());
  }

  window.addEventListener("mymusics:playback-target-change", onPlaybackTargetChange);
  return Object.freeze({ play });
}
