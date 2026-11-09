export function createRadioSuppressionController({ store, speechDetector, getStation, getAudio, getMetadataKey, getTrackKey }) {
  let currentTrackKey = "";
  let confirmedTrackKey = "";
  let currentBlockKey = "";
  let metadataBlockDucked = false;
  let speechDucked = false;
  let speechUnduckTimer = null;
  let audioVolumeRampTimer = null;
  let preferredVolume = getAudio().volume;
  let lastElementVolume = getAudio().volume;
  let expectedSpeechVolume = null;
  const speechReleaseDelay = 2000;
  const volumeRestoreDuration = 2000;
  const volumeRampInterval = 50;

  function setVolume(value) {
    expectedSpeechVolume = value;
    lastElementVolume = value;
    getAudio().volume = value;
  }

  function setDucked(active) {
    if (active && isConfirmedTrack()) active = false;
    clearTimeout(speechUnduckTimer);
    speechUnduckTimer = null;
    clearInterval(audioVolumeRampTimer);
    audioVolumeRampTimer = null;
    if (speechDucked === active) return;
    speechDucked = active;
    const percent = Number.isInteger(getStation()?.speechVolumePercent) ? getStation().speechVolumePercent : 30;
    const status = document.querySelector("#speech-suppression-status");
    if (active) {
      setVolume(preferredVolume * percent / 100);
      status.textContent = "Suppressed";
      status.dataset.state = "suppressed";
      return;
    }
    status.textContent = "Restoring";
    status.dataset.state = "restoring";
    const audio = getAudio();
    const from = audio.volume;
    const to = preferredVolume;
    const started = performance.now();
    audioVolumeRampTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / volumeRestoreDuration);
      setVolume(from + (to - from) * progress);
      if (progress === 1) {
        clearInterval(audioVolumeRampTimer);
        audioVolumeRampTimer = null;
        status.textContent = "Listening";
        status.dataset.state = "listening";
      }
    }, volumeRampInterval);
  }

  function releaseAfterPause() {
    clearTimeout(speechUnduckTimer);
    if (speechDucked) speechUnduckTimer = setTimeout(() => {
      if (!store.suppressedMetadataBlocks.has(currentBlockKey)) setDucked(false);
    }, speechReleaseDelay);
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
    });
  }

  function isTrackEnabled(key) { return store.feedback.get(key)?.suppress ?? false; }
  function isConfirmedTrack() { return Boolean(currentTrackKey && currentTrackKey === confirmedTrackKey); }

  function renderTrack(button, key) {
    const suppress = Boolean(key && isTrackEnabled(key));
    const feedback = key && store.feedback.get(key);
    button.hidden = !key || (key === currentTrackKey && isConfirmedTrack());
    button.setAttribute("aria-pressed", String(suppress));
    button.textContent = suppress ? "Suppress this track" : "Do not suppress this track";
    button.title = feedback
      ? feedback.suppressionCorrect === null
        ? `Saved choice: suppression ${suppress ? "on" : "off"}.`
        : `Saved feedback: suppression was ${feedback.suppressionCorrect ? "correct" : "incorrect"}.`
      : suppress ? "Automatic speech/ad suppression is enabled for this track." : "Automatic suppression is disabled for this track.";
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
      clearTimeout(speechUnduckTimer);
      renderCurrentTrackButton();
      if (store.suppressedMetadataBlocks.has(currentBlockKey)) setDucked(true);
      else if (suppress && speechDetector.speechActive) setDucked(true);
      else if (!speechDetector.speechActive || !suppress) setDucked(false);
      const status = document.querySelector("#speech-suppression-status");
      status.textContent = isConfirmedTrack() ? "Song identified · normal volume" : suppress ? "Listening · suppression on" : "Track suppression off";
      status.dataset.state = speechDucked ? "suppressed" : "listening";
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
      if (!speechDetector.speechActive || !isTrackEnabled(currentTrackKey)) setDucked(false);
    }
  }

  function setCurrentTrack(artist, title) {
    const nextKey = getTrackKey(artist, title);
    if (currentTrackKey !== nextKey) {
      confirmedTrackKey = "";
      document.querySelector("#speech-feedback").hidden = true;
    }
    currentTrackKey = nextKey;
    renderCurrentTrackButton();
    const status = document.querySelector("#speech-suppression-status");
    if (isConfirmedTrack()) {
      setDucked(false);
      status.textContent = "Song identified · normal volume";
      status.dataset.state = "listening";
      return;
    }
    if (store.suppressedMetadataBlocks.has(currentBlockKey)) {
      setDucked(true);
    } else if (currentTrackKey && store.feedback.get(currentTrackKey)?.suppress !== true) {
      clearTimeout(speechUnduckTimer);
      setDucked(false);
      status.textContent = store.feedback.has(currentTrackKey) ? "Track suppression off" : "Listening";
      status.dataset.state = "listening";
    } else if (currentTrackKey && store.feedback.get(currentTrackKey)?.suppress === true && !speechDucked && speechDetector.active) {
      status.textContent = "Listening";
      if (speechDetector.speechActive) setDucked(true);
    }
    if (currentTrackKey && store.feedback.has(currentTrackKey)) {
      status.textContent = speechDucked ? "Suppressed" : `Saved choice · suppression ${isTrackEnabled(currentTrackKey) ? "on" : "off"}`;
    }
  }

  function confirmTrack(key) {
    if (currentTrackKey !== key) return;
    confirmedTrackKey = key;
    setDucked(false);
    renderCurrentTrackButton();
    const status = document.querySelector("#speech-suppression-status");
    status.textContent = "Song identified · normal volume";
    status.dataset.state = "listening";
  }

  function onSpeechStart() {
    document.querySelector("#speech-feedback").hidden = !currentTrackKey || isConfirmedTrack();
    const choice = store.feedback.get(currentTrackKey)?.suppress;
    if (!isConfirmedTrack() && (store.suppressedMetadataBlocks.has(currentBlockKey) || choice === true || (choice !== false && !confirmedTrackKey))) setDucked(true);
  }

  function resetTrack() {
    currentTrackKey = "";
    renderCurrentTrackButton();
  }

  function resetMetadata() { currentBlockKey = ""; metadataBlockDucked = false; }

  return Object.freeze({
    isTrackEnabled,
    setDucked,
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
    onSpeechStart,
    resetTrack,
    resetMetadata,
    get currentTrackKey() { return currentTrackKey; },
    get currentBlockKey() { return currentBlockKey; },
    get confirmedTrackKey() { return confirmedTrackKey; },
    get metadataBlockDucked() { return metadataBlockDucked; }
  });
}
