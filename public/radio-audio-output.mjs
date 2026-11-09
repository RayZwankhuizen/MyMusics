export function createRadioAudioOutput({ initialAudio, getSuppressionController }) {
  let audio = initialAudio;

  function setStatus(message, live = false) {
    document.querySelector("#player-status").textContent = message;
    document.querySelector(".equalizer").classList.toggle("playing", live);
    window.dispatchEvent(new CustomEvent("mymusics:radio-status", { detail: { message, live } }));
  }

  function replace(replacement = document.createElement("audio")) {
    const previous = audio;
    const suppressionController = getSuppressionController();
    replacement.id = "audio";
    replacement.controls = false;
    replacement.preload = "none";
    suppressionController.prepareAudioElement(replacement);
    replacement.setAttribute("aria-label", "Radio playback");
    replacement.onplaying = () => setStatus("ON AIR", true);
    replacement.onerror = () => setStatus("STREAM UNAVAILABLE");
    replacement.onwaiting = () => setStatus("BUFFERING");
    previous.pause();
    previous.replaceWith(replacement);
    audio = replacement;
    window.dispatchEvent(new Event("mymusics:radio-audio-replaced"));
    suppressionController.bindAudioVolumeChange();
  }

  return Object.freeze({ getAudio: () => audio, replace, setStatus });
}
