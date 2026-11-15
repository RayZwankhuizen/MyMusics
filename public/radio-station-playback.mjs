export function createRadioStationPlayback({ state, players, ui }) {
  function applyOutputVolumes() {
    const host = state.isHostOutput();
    const volume = state.getVolume();
    state.getAudio().volume = host ? 0 : volume;
    void players.hostOutput.setVolume(host ? Math.round(volume * 100) : 0);
    ui.setHostControlsVisible(host);
  }

  async function play(station, genre) {
    const generation = state.nextGeneration();
    const useHostOutput = state.isHostOutput();
    if (players.equalizer.ready) {
      const compatible = station.type !== "hls" && !/\.m3u8(?:$|[?#])/i.test(station.url);
      if (!compatible) {
        players.equalizer.closeContext();
        ui.replaceAudio();
        ui.showEqualizerUnavailable();
      }
    }
    const isHls = station.type === "hls" || /\.m3u8(?:$|[?#])/i.test(station.url);
    if (!prepare(station, genre, generation, isHls)) return;

    if (!isHls) await players.equalizer.enable({ autoplay: false, forceBrowser: true });
    if (!state.isCurrentGeneration(generation)) return;
    applyOutputVolumes();
    const [, played] = await Promise.all([
      players.hostOutput.play(station, useHostOutput ? Math.round(state.getVolume() * 100) : 0),
      players.browser.play(station, isHls)
    ]);
    if (played === false && players.equalizer.ready && state.isCurrentGeneration(generation)) {
      players.equalizer.closeContext();
      ui.replaceAudio();
      ui.showEqualizerUnavailable();
      applyOutputVolumes();
      await players.browser.play(station, isHls);
    }
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
    players.equalizer.setHostOutput(state.isHostOutput());
    applyOutputVolumes();
  }

  function stopForNavigation() {
    state.nextGeneration();
    ui.stopSpeechDetection();
    players.hls.stop();
    players.nowPlaying.stop();
    state.setStation(null, "");
    window.dispatchEvent(new CustomEvent("mymusics:radio-station-change", { detail: null }));
  }

  window.addEventListener("mymusics:playback-target-change", onPlaybackTargetChange);
  window.addEventListener("mymusics:radio-volume-change", applyOutputVolumes);
  return Object.freeze({ play, stopForNavigation });
}
