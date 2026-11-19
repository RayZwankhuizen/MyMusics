const assert = require("node:assert/strict");
const test = require("node:test");

test("early song metadata and confirmation preserve ducking until the presenter stops speaking", async (t) => {
  const { createRadioSuppressionController } = await import("../public/radio-suppression-controller.mjs");
  const elements = new Map();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "setInterval", () => 1);
  const previousDocument = globalThis.document;
  t.after(() => { globalThis.document = previousDocument; });
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { dataset: {}, setAttribute() {} });
      return elements.get(selector);
    }
  };
  const audio = { volume: 1 };
  let outputGain = 1;
  const speechDetector = { speechActive: true };
  const station = { speechVolumePercent: 30 };
  const controller = createRadioSuppressionController({
    store: { feedback: new Map(), suppressedMetadataBlocks: new Set() },
    speechDetector,
    getStation: () => station,
    getAudio: () => audio,
    getSpeechGain: () => outputGain,
    setSpeechGain: (gain) => { outputGain = gain; return true; },
    getTrackKey: (artist, title) => artist && title ? title : ""
  });

  controller.onSpeechStart();
  controller.setCurrentTrack("Artist", "Track");
  assert.equal(outputGain, 0.3, "new metadata can arrive during active speech");
  assert.equal(audio.volume, 1, "the detector still gets the original player signal");
  controller.setCurrentTrack("Artist", "Track");
  assert.equal(controller.ducked, true, "repeated metadata keeps the current ducking state");
  controller.confirmTrack("Track");
  assert.equal(outputGain, 0.3, "an early song match cannot raise the volume during speech");
  speechDetector.speechActive = false;
  controller.releaseAfterPause();
  t.mock.timers.tick(2999);
  assert.equal(controller.ducked, true, "a brief pause does not release ducking");
  speechDetector.speechActive = true;
  controller.onSpeechStart();
  t.mock.timers.tick(3000);
  assert.equal(controller.ducked, true, "resumed speech cancels the pending release");
  speechDetector.speechActive = false;
  station.speechReleaseDelaySeconds = 5;
  controller.releaseAfterPause();
  t.mock.timers.tick(4999);
  assert.equal(controller.ducked, true, "a station can extend the default hold");
  t.mock.timers.tick(1);
  assert.equal(controller.ducked, false, "the sustained silence starts normal volume restoration");
  speechDetector.speechActive = true;
  controller.onSpeechStart();
  assert.equal(controller.ducked, true, "speech during the volume fade lowers it again");
  controller.resetTrack();
  assert.equal(controller.confirmedTrackKey, "", "a station change discards the previous song confirmation");
});

test("track suppression overrides the station setting and ends when the next song starts", async (t) => {
  const { createRadioSuppressionController } = await import("../public/radio-suppression-controller.mjs");
  const elements = new Map();
  const previousDocument = globalThis.document;
  t.after(() => { globalThis.document = previousDocument; });
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { dataset: {}, setAttribute() {} });
      return elements.get(selector);
    },
    querySelectorAll: () => []
  };
  let finishRamp;
  t.mock.method(globalThis, "setInterval", (callback) => { finishRamp = callback; return 1; });
  const clock = t.mock.method(performance, "now", () => 0);
  const audio = { volume: 1 };
  let enabled = true;
  const speechDetector = { speechActive: false };
  const controller = createRadioSuppressionController({
    store: {
      feedback: new Map(),
      disabledTracks: new Set(),
      saveTrackPreferences() {},
      saveFeedback() {},
      suppressedMetadataBlocks: new Set(["Blocked"])
    },
    speechDetector,
    getStation: () => ({ url: "https://radio.example/live" }),
    isEnabled: () => enabled,
    getAudio: () => audio,
    getTrackKey: (_artist, title) => title,
    getMetadataKey: (_fields, raw) => raw
  });
  const status = document.querySelector("#speech-suppression-status");
  controller.setDetectorStatus("ready");
  assert.equal(status.textContent, "Station suppression on");
  controller.setCurrentMetadata({}, "Blocked");
  assert.equal(audio.volume, 0.3);

  enabled = false;
  controller.setDetectorStatus("idle");
  controller.setDucked(false);
  controller.setCurrentMetadata({}, "Blocked");
  clock.mock.mockImplementation(() => 1000);
  finishRamp();
  assert.equal(audio.volume, 1);
  assert.equal(status.textContent, "No station suppression");
  assert.equal(controller.metadataBlockDucked, true);

  controller.setCurrentTrack("Artist", "Track");
  controller.confirmTrack("Track");
  controller.setTrack("Track", true);
  assert.equal(audio.volume, 0.3);
  assert.equal(status.textContent, "Song suppressed");
  controller.releaseAfterPause();
  controller.setDucked(false);
  assert.equal(audio.volume, 0.3, "stopping the station detector leaves the song suppressed");

  controller.setCurrentTrack("Artist", "Next track");
  clock.mock.mockImplementation(() => 2000);
  finishRamp();
  assert.equal(audio.volume, 1);
  assert.equal(status.textContent, "No station suppression");
  controller.setCurrentTrack("Artist", "Track");
  assert.equal(audio.volume, 0.3, "the preference applies the next time the song plays");
  controller.setTrack("Track", false);
  clock.mock.mockImplementation(() => 3000);
  finishRamp();
  assert.equal(audio.volume, 1);
  assert.equal(status.textContent, "No station suppression");
});

test("speech detection uses the player stream and disposes of its input when stopped", async (t) => {
  const { createRadioSpeechDetector } = await import("../public/radio-speech-detector.mjs");
  const stream = {};
  const statuses = [];
  let closed = false;
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  globalThis.window = { vad: { MicVAD: { async new(options) {
    assert.equal(await options.getStream(), stream);
    return { start() {}, pause() {} };
  } } } };
  const detector = createRadioSpeechDetector({
    createInput: () => ({ stream, close() { closed = true; } }),
    onStopped() {},
    onStatus: (status) => statuses.push(status)
  });

  await detector.start();
  assert.deepEqual(statuses, ["loading", "ready"]);
  assert.equal(detector.active, true);
  detector.stop();
  assert.equal(closed, true);
  assert.equal(detector.active, false);
});

test("a pending play from an old station cannot restart speech analysis", async () => {
  const { createRadioBrowserPlayback } = await import("../public/radio-browser-playback.mjs");
  let generation = 1;
  let finishPlaying;
  const audio = {
    pause() {},
    removeAttribute() {},
    load() {},
    play: () => new Promise((resolve) => { finishPlaying = resolve; })
  };
  const started = [];
  const playback = createRadioBrowserPlayback({
    getAudio: () => audio,
    getGeneration: () => generation,
    setStatus() {},
    streamUrl: (url) => url,
    speechSuppressionDisabled: () => false,
    startSpeechDetection: (station) => started.push(station.url)
  });

  const oldPlay = playback.play({ url: "old" }, false);
  generation++;
  finishPlaying();
  await oldPlay;
  const currentPlay = playback.play({ url: "current" }, false);
  finishPlaying();
  await currentPlay;
  assert.deepEqual(started, ["current"]);
});
