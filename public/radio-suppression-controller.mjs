export function createRadioSuppressionController({ store, speechDetector, getStation, getAudio, getSpeechGain, setSpeechGain, getMetadataKey, getTrackKey, isEnabled = () => true, getTrackElapsedSeconds = () => 0, isHostOutput = () => false }) {
  let currentTrackKey = "";
  let confirmedTrackKey = "";
  let currentBlockKey = "";
  let metadataBlockDucked = false;
  let speechDucked = false;
  let detectorStatus = "idle";
  let speechUnduckTimer = null;
  let trackEndTimer;
  let trackDurationSeconds = 0;
  let audioVolumeRampTimer = null;
  let audioVolumeRampTarget;
  let preferredVolume = getAudio().volume;
  let lastElementVolume = getAudio().volume;
  let expectedSpeechVolume = null;
  const volumeDuckDuration = 300;
  const volumeRestoreDuration = 1000;
  const volumeRampInterval = 50;

  function setVolume(value) {
    if (setSpeechGain?.(preferredVolume ? value / preferredVolume : 1)) return;
    expectedSpeechVolume = value;
    lastElementVolume = value;
    getAudio().volume = value;
  }

  function getVolume() {
    return getAudio().volume * (getSpeechGain?.() ?? 1);
  }

  function renderStatus() {
    const status = document.querySelector("#speech-suppression-status");
    const songSuppressed = isTrackEnabled(currentTrackKey);
    const stationEnabled = isEnabled();
    const suppressionLabel = songSuppressed ? "Song suppressed"
      : stationEnabled ? "Station suppression on" : "No station suppression";
    if (status.textContent !== suppressionLabel) status.textContent = suppressionLabel;
    status.dataset.state = songSuppressed || speechDucked ? "suppressed"
      : stationEnabled ? "listening" : "off";
    status.title = stationEnabled && detectorStatus === "stream-blocked" ? "Stream blocks analysis"
      : stationEnabled && detectorStatus === "unavailable" ? "Detector unavailable" : "";
    const activity = document.querySelector("#radio-suppression-activity");
    if (activity) {
      const volumeReduced = !isHostOutput() && getVolume() + 0.005 < preferredVolume;
      const message = volumeReduced ? songSuppressed ? "Song suppressed"
        : speechDucked ? "Speech / ad volume reduced" : "Restoring volume" : "";
      if (activity.textContent !== message) activity.textContent = message;
    }
  }

  function setDetectorStatus(status) {
    detectorStatus = status;
    renderStatus();
  }

  function setDucked(active) {
    clearTimeout(trackEndTimer);
    if (isTrackEnabled(currentTrackKey)) active = true;
    else if (active && !isEnabled()) return;
    clearTimeout(speechUnduckTimer);
    speechUnduckTimer = null;
    const percent = Number.isInteger(getStation()?.speechVolumePercent) ? getStation().speechVolumePercent : 30;
    const target = active ? preferredVolume * percent / 100 : preferredVolume;
    if (audioVolumeRampTimer && speechDucked === active && audioVolumeRampTarget === target) return;
    clearInterval(audioVolumeRampTimer);
    audioVolumeRampTimer = null;
    const from = getVolume();
    speechDucked = active;
    if (Math.abs(from - target) < 0.005) {
      setVolume(target);
      renderStatus();
      return;
    }
    const started = performance.now();
    const duration = active ? volumeDuckDuration : volumeRestoreDuration;
    audioVolumeRampTarget = target;
    audioVolumeRampTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      setVolume(progress === 1 ? target : from + (target - from) * progress);
      if (progress === 1) {
        clearInterval(audioVolumeRampTimer);
        audioVolumeRampTimer = null;
      }
      renderStatus();
    }, volumeRampInterval);
    renderStatus();
  }

  function releaseAfterPause() {
    clearTimeout(trackEndTimer);
    clearTimeout(speechUnduckTimer);
    const delaySeconds = getStation()?.speechReleaseDelaySeconds ?? 3;
    if (speechDucked && !isTrackEnabled(currentTrackKey)) speechUnduckTimer = setTimeout(() => {
      speechUnduckTimer = null;
      if (!speechDetector.speechActive && !store.suppressedMetadataBlocks.has(currentBlockKey)) setDucked(false);
    }, delaySeconds * 1000);
  }

  function prepareAudioElement(audio) {
    audio.volume = preferredVolume;
    lastElementVolume = preferredVolume;
    expectedSpeechVolume = null;
  }

  function bindAudioVolumeChange() {
    const audio = getAudio();
    audio.addEventListener("volumechange", () => {
      if (expectedSpeechVolume !== null && Math.abs(audio.volume - expectedSpeechVolume) < 0.001) { expectedSpeechVolume = null; return; }
      if (Math.abs(audio.volume - lastElementVolume) < 0.001) return;
      expectedSpeechVolume = null;
      clearInterval(audioVolumeRampTimer);
      audioVolumeRampTimer = null;
      lastElementVolume = audio.volume;
      preferredVolume = audio.volume;
      if (speechDucked) setVolume(preferredVolume * ((getStation()?.speechVolumePercent ?? 30) / 100));
      else setSpeechGain?.(1);
      renderStatus();
    });
  }

  function isTrackEnabled(key) { return store.feedback.get(key)?.suppress ?? false; }
  function isConfirmedTrack() { return Boolean(currentTrackKey && currentTrackKey === confirmedTrackKey); }

  function renderTrack(button, key) {
    const suppress = Boolean(key && isTrackEnabled(key));
    const feedback = key && store.feedback.get(key);
    button.hidden = !key;
    button.setAttribute("aria-pressed", String(suppress));
    button.textContent = suppress ? "Stop suppressing this track" : "Suppress this track";
    button.title = feedback
      ? feedback.suppressionCorrect === null
        ? `Saved choice: suppression ${suppress ? "on" : "off"}.`
        : `Saved feedback: suppression was ${feedback.suppressionCorrect ? "correct" : "incorrect"}.`
      : suppress ? "Play this track at the reduced suppression volume." : "Play this track at normal volume when no station suppression applies.";
  }

  function renderCurrentTrackButton() { renderTrack(document.querySelector("#track-suppression"), currentTrackKey); }

  function renderMetadata(button, key) {
    const suppressed = store.suppressedMetadataBlocks.has(key);
    button.setAttribute("aria-pressed", String(suppressed));
    button.textContent = suppressed ? "Blocked · Undo" : "Suppress this block";
    const status = button.parentElement.querySelector(".metadata-suppression-status");
    status.textContent = suppressed ? "Suppressed" : "Not suppressed";
    status.classList.toggle("active", suppressed);
  }

  function setTrack(key, suppress) {
    if (!key) return;
    if (suppress) store.disabledTracks.delete(key);
    else store.disabledTracks.add(key);
    store.saveTrackPreferences();
    store.feedback.set(key, { suppress, suppressionCorrect: suppress, reviewedAt: new Date().toISOString() });
    store.saveFeedback();
    if (currentTrackKey === key) {
      renderCurrentTrackButton();
      setDucked(isEnabled() && store.suppressedMetadataBlocks.has(currentBlockKey));
    }
    document.querySelectorAll(".metadata-track-toggle").forEach((button) => {
      if (button.dataset.trackKey === key) renderTrack(button, key);
    });
  }

  function setMetadataBlock(key, suppressed) {
    if (!key) return;
    if (suppressed) store.suppressedMetadataBlocks.add(key);
    else store.suppressedMetadataBlocks.delete(key);
    store.saveMetadataBlocks();
    document.querySelectorAll(".metadata-suppress-toggle").forEach((button) => {
      if (button.dataset.metadataKey === key) renderMetadata(button, key);
    });
    if (currentBlockKey === key) {
      metadataBlockDucked = suppressed;
      if (suppressed) setDucked(true);
      else if (!speechDetector.speechActive || !isTrackEnabled(currentTrackKey)) setDucked(false);
    }
  }

  function setCurrentMetadata(fields, raw, stationUrl = getStation()?.url) {
    const previousKey = currentBlockKey;
    currentBlockKey = getMetadataKey(fields, raw, stationUrl);
    if (store.suppressedMetadataBlocks.has(currentBlockKey)) {
      metadataBlockDucked = true;
      setDucked(true);
    } else if (previousKey !== currentBlockKey && metadataBlockDucked) {
      metadataBlockDucked = false;
      if (!speechDetector.speechActive && !speechUnduckTimer) setDucked(false);
    }
  }

  function setCurrentTrack(artist, title) {
    const nextKey = getTrackKey(artist, title);
    if (!nextKey || currentTrackKey === nextKey) return;
    const previousSongSuppressed = isTrackEnabled(currentTrackKey);
    clearTimeout(trackEndTimer);
    trackDurationSeconds = 0;
    confirmedTrackKey = "";
    document.querySelector("#speech-feedback").hidden = true;
    currentTrackKey = nextKey;
    renderCurrentTrackButton();
    const suppressStationAudio = isEnabled() && (store.suppressedMetadataBlocks.has(currentBlockKey)
      || (speechDetector.speechActive && store.feedback.get(currentTrackKey)?.suppress !== false));
    if (isTrackEnabled(currentTrackKey) || suppressStationAudio || previousSongSuppressed) {
      setDucked(suppressStationAudio);
    } else renderStatus();
  }

  function confirmTrack(key) {
    if (!key || currentTrackKey !== key || isConfirmedTrack()) return;
    confirmedTrackKey = key;
    // Stations can announce the next song in metadata while the presenter is still speaking.
    renderCurrentTrackButton();
    renderStatus();
  }

  function checkTrackEndDuringSpeech() {
    clearTimeout(trackEndTimer);
    if (!trackDurationSeconds || !speechDetector.speechActive || speechDucked || !isEnabled()) return;
    const remaining = trackDurationSeconds - getTrackElapsedSeconds();
    if (remaining <= 0) setDucked(true);
    else trackEndTimer = setTimeout(checkTrackEndDuringSpeech, Math.ceil(remaining * 1000));
  }

  function setTrackDuration(key, durationMs) {
    if (key !== currentTrackKey || !Number.isFinite(durationMs) || durationMs <= 0) return;
    trackDurationSeconds = durationMs / 1000;
    checkTrackEndDuringSpeech();
  }

  function onSpeechStart() {
    if (!isEnabled()) return;
    document.querySelector("#speech-feedback").hidden = !currentTrackKey || isConfirmedTrack();
    const choice = store.feedback.get(currentTrackKey)?.suppress;
    if (speechDucked || audioVolumeRampTimer || store.suppressedMetadataBlocks.has(currentBlockKey)
        || choice === true || (!isConfirmedTrack() && choice !== false)) {
      setDucked(true);
    } else checkTrackEndDuringSpeech();
  }

  function resetTrack() {
    clearTimeout(trackEndTimer);
    trackDurationSeconds = 0;
    const previousSongSuppressed = isTrackEnabled(currentTrackKey);
    currentTrackKey = "";
    confirmedTrackKey = "";
    document.querySelector("#speech-feedback").hidden = true;
    renderCurrentTrackButton();
    if (previousSongSuppressed) setDucked(false);
    else renderStatus();
  }

  function resetMetadata() { currentBlockKey = ""; metadataBlockDucked = false; }

  return Object.freeze({
    isTrackEnabled,
    setDucked,
    setDetectorStatus,
    renderStatus,
    releaseAfterPause,
    setVolume,
    prepareAudioElement,
    bindAudioVolumeChange,
    get ducked() { return speechDucked; },
    get preferredVolume() { return preferredVolume; },
    isConfirmedTrack,
    renderTrack,
    renderCurrentTrackButton,
    renderMetadata,
    setTrack,
    setMetadataBlock,
    setCurrentMetadata,
    setCurrentTrack,
    confirmTrack,
    setTrackDuration,
    onSpeechStart,
    resetTrack,
    resetMetadata,
    get currentTrackKey() { return currentTrackKey; },
    get currentBlockKey() { return currentBlockKey; },
    get confirmedTrackKey() { return confirmedTrackKey; },
    get metadataBlockDucked() { return metadataBlockDucked; }
  });
}
