const assert = require("node:assert/strict");
const test = require("node:test");
const { wireAudioDeckEvents } = require("../public/music-playback-events.mjs");

function createPlayer() {
  const listeners = new Map();
  return {
    src: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    play() { return Promise.resolve(); },
    emit(type) { listeners.get(type)(); }
  };
}

test("audio deck errors preserve conversion and inactive-deck guards", () => {
  const audio = createPlayer();
  const audio2 = createPlayer();
  const state = { current: { id: "track-1" }, transcoding: false };
  const statuses = [];
  const converted = [];
  const deckState = { decks: { a: audio, b: audio2 }, activeDeck: "a" };
  let renders = 0;
  let syncs = 0;
  wireAudioDeckEvents({
    deckState,
    syncDeck() {},
    syncJukeboxPlaying() { syncs++; },
    state,
    audioUrl: (track, options) => { converted.push([track.id, options.transcode]); return `/audio/${track.id}?transcode`; },
    setStatus: (status) => statuses.push(status),
    renderNow() { renders++; },
    handleDeckEnded() {}
  });

  audio.emit("error");
  assert.equal(state.transcoding, true);
  assert.equal(audio.src, "/audio/track-1?transcode");
  assert.deepEqual(statuses, ["CONVERTING"]);

  state.transcoding = false;
  deckState.activeDeck = "a";
  audio2.emit("error");
  assert.equal(audio2.src, "");
  assert.equal(state.transcoding, false);

  deckState.activeDeck = "b";
  audio2.emit("error");
  assert.equal(state.transcoding, true);
  assert.equal(audio2.src, "/audio/track-1?transcode");
  assert.deepEqual(converted, [["track-1", true], ["track-1", true]]);
  assert.deepEqual(statuses, ["CONVERTING", "CONVERTING"]);
  assert.equal(renders, 2);
  assert.equal(syncs, 3);

  state.transcoding = false;
  audio.src = "";
  audio.emit("error");
  assert.equal(state.transcoding, false);
  assert.equal(audio.src, "");
  assert.equal(renders, 2);
  assert.equal(syncs, 4);

  state.current = null;
  deckState.activeDeck = "a";
  audio.emit("error");
  assert.deepEqual(statuses, ["CONVERTING", "CONVERTING", "TRACK UNAVAILABLE"]);
  deckState.activeDeck = "b";
  audio2.emit("error");
  assert.equal(statuses.at(-1), "TRACK UNAVAILABLE");
});

test("ended events identify the deck that finished", () => {
  const ended = [];
  const statuses = [];
  const audio = createPlayer();
  const audio2 = createPlayer();
  wireAudioDeckEvents({
    deckState: { decks: { a: audio, b: audio2 }, activeDeck: "a" },
    syncDeck: (deck, status, live) => statuses.push([deck, status, live]),
    syncJukeboxPlaying() {},
    state: { current: null, transcoding: false },
    audioUrl() {},
    setStatus() {},
    renderNow() {},
    handleDeckEnded: (deck) => ended.push(deck)
  });
  audio.emit("playing");
  audio.emit("waiting");
  audio.emit("pause");
  audio2.emit("playing");
  audio2.emit("waiting");
  audio2.emit("pause");
  audio.emit("ended");
  audio2.emit("ended");
  assert.deepEqual(statuses, [
    ["a", "PLAYING", true], ["a", "BUFFERING", undefined], ["a", "PAUSED", undefined],
    ["b", "PLAYING", true], ["b", "BUFFERING", undefined], ["b", "PAUSED", undefined]
  ]);
  assert.deepEqual(ended, ["a", "b"]);
});
