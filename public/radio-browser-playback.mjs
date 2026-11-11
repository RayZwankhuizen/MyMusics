export function createRadioBrowserPlayback({ getAudio, setStatus, streamUrl, hlsPlayback, equalizerReady, speechSuppressionDisabled, startSpeechDetection }) {
  async function play(station, isHls) {
    const audio = getAudio();
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
        audio.src = equalizerReady() ? streamUrl(station.url) : station.url;
        await audio.play();
        if (!speechSuppressionDisabled(station.url)) startSpeechDetection(station);
      }
      return true;
    } catch (error) {
      setStatus(`PLAYBACK FAILED · ${error.name || error.message}`);
      return false;
    }
  }

  return Object.freeze({ play });
}
