export function createRadioBrowserPlayback({ getAudio, getGeneration, setStatus, streamUrl, hlsPlayback, speechSuppressionDisabled, startSpeechDetection }) {
  async function play(station, isHls) {
    const audio = getAudio();
    const generation = getGeneration();
    try {
      audio.pause();
      audio.onplaying = () => setStatus("ON AIR", true);
      audio.onerror = () => setStatus("STREAM UNAVAILABLE");
      audio.onwaiting = () => setStatus("BUFFERING");
      audio.removeAttribute("src");
      audio.load();
      setStatus("CONNECTING TO LIVE RADIO");
      if (isHls) {
        await hlsPlayback.play(station);
      } else {
        audio.src = streamUrl(station.url);
        await audio.play();
        if (generation === getGeneration() && !speechSuppressionDisabled(station.url)) startSpeechDetection(station);
      }
      return true;
    } catch (error) {
      if (generation === getGeneration()) setStatus(`PLAYBACK FAILED · ${error.name || error.message}`);
      return false;
    }
  }

  return Object.freeze({ play });
}
