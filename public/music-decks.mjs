export function createMusicDeckState(decks) {
  return {
    decks,
    activeDeck: "a",
    fadingDeck: null,
    fadingOutDeck: null,
    deckTracks: { a: null, b: null },
    armDropped: { a: false, b: false }
  };
}

export function createMusicDeckPreload({ state, deckState, isHostOutput, audioUrl, needsTranscode, renderJukeboxNow, setStatus }) {
  const { decks, deckTracks, armDropped } = deckState;

  function inactiveDeckKey() {
    const activeDeck = deckState.activeDeck;
    const activeHasTrack = Boolean(state.current?.id || deckTracks[activeDeck]?.id || decks[activeDeck].src);
    return activeHasTrack ? (activeDeck === "a" ? "b" : "a") : activeDeck;
  }

  function loadToInactiveDeck(track) {
    if (!track?.id) return;
    const targetKey = inactiveDeckKey();
    const otherKey = targetKey === "a" ? "b" : "a";
    if (deckTracks[otherKey]?.id === track.id) {
      setStatus(`Already loaded on deck ${otherKey.toUpperCase()}`);
      return;
    }
    const target = decks[targetKey];
    armDropped[targetKey] = false;
    deckTracks[targetKey] = track;
    target.src = audioUrl(track, { transcode: needsTranscode(track) });
    target.volume = 0;
    try { target.load(); } catch {}
    renderJukeboxNow();
    setStatus(`Loaded to deck ${targetKey.toUpperCase()}`);
  }

  function preloadNextToDeck() {
    if (isHostOutput() || !state.queue.length) return;
    const activeDeck = deckState.activeDeck;
    const targetKey = inactiveDeckKey();
    const target = decks[targetKey];
    const track = state.queue[0];
    if (track.id === (deckTracks[activeDeck]?.id || state.current?.id)) return;
    if (deckTracks[targetKey]?.id === track.id && target.src) return;
    if (target.src) {
      if (!target.paused && !target.ended) return;
      target.pause();
      target.removeAttribute("src");
      deckTracks[targetKey] = null;
      try { target.load(); } catch {}
    }
    loadToInactiveDeck(track);
  }

  return Object.freeze({ loadToInactiveDeck, preloadNextToDeck });
}

export function createMusicDeckTransition({ state, deckState, setNaturalFadeStartedTrack, musicEqualizer, needsTranscode, audioUrl, setStatus, renderNow, renderQueue, syncJukeboxPlaying }) {
  const { decks, deckTracks, armDropped } = deckState;
  let playbackTransition = 0;

  function invalidate() {
    const transition = ++playbackTransition;
    deckState.fadingDeck = null;
    deckState.fadingOutDeck = null;
    return transition;
  }

  function isCurrent(transition) {
    return transition === playbackTransition;
  }

  function resolveIncomingDeck(track, targetKey) {
    const activeDeck = deckState.activeDeck;
    return targetKey || (state.current && state.current.id !== track.id ? (activeDeck === "a" ? "b" : "a") : activeDeck);
  }

  function prepareIncomingDeck(track, key, fadeSeconds) {
    const deck = decks[key];
    const previousTrack = deckTracks[key];
    const previousArm = armDropped[key];
    const alreadyLoaded = deckTracks[key]?.id === track.id && deck.src;
    deck.pause();
    if (!alreadyLoaded) {
      armDropped[key] = false;
      deck.src = audioUrl(track, { transcode: needsTranscode(track) });
      try { deck.load(); } catch {}
    }
    deck.volume = fadeSeconds ? 0 : 1;
    deckTracks[key] = track;
    state.current = track;
    setNaturalFadeStartedTrack("");
    deckState.activeDeck = key;
    return { deck, previousTrack, previousArm, alreadyLoaded };
  }

  function activateIncomingDeck(track, key, outgoingKey, fadeSeconds) {
    musicEqualizer.autoPreset(track);
    // Ask for a conversion before playback when the browser cannot decode this format.
    state.transcoding = needsTranscode(track);
    setStatus(state.transcoding ? "CONVERTING" : "BUFFERING");
    renderNow();
    if (fadeSeconds) {
      deckState.fadingDeck = key;
      deckState.fadingOutDeck = outgoingKey;
      syncJukeboxPlaying();
    }
    renderQueue();
  }

  function restoreAfterFailure({ transition, outgoingKey, incomingKey, outgoing, incoming, previousTrack, previousTranscoding, incomingPreviousTrack, incomingPreviousArm, alreadyLoaded }) {
    if (!isCurrent(transition)) return;
    deckState.activeDeck = outgoingKey;
    state.current = previousTrack;
    state.transcoding = previousTranscoding;
    deckState.fadingDeck = null;
    deckState.fadingOutDeck = null;
    deckTracks[incomingKey] = incomingPreviousTrack;
    armDropped[incomingKey] = incomingPreviousArm;
    incoming.pause();
    if (!alreadyLoaded && incoming !== outgoing) {
      incoming.removeAttribute("src");
      try { incoming.load(); } catch {}
    }
    incoming.volume = incoming === outgoing ? 1 : 0;
    renderNow();
    renderQueue();
  }

  function releaseOutgoingDeck(outgoing, incoming, key, naturalFadeIn) {
    if (outgoing === incoming || naturalFadeIn) return;
    outgoing.pause();
    outgoing.currentTime = 0;
    outgoing.volume = 1;
    deckTracks[key] = null;
    armDropped[key] = false;
    outgoing.removeAttribute("src");
    try { outgoing.load(); } catch {}
  }

  function finish(naturalFadeIn) {
    deckState.fadingDeck = null;
    if (!naturalFadeIn) deckState.fadingOutDeck = null;
  }

  return Object.freeze({ invalidate, isCurrent, resolveIncomingDeck, prepareIncomingDeck, activateIncomingDeck, restoreAfterFailure, releaseOutgoingDeck, finish });
}

export function runDeckFade(incoming, outgoing, duration, naturalFadeIn, isCurrentTransition) {
  const remaining = outgoing.duration - outgoing.currentTime;
  if (Number.isFinite(remaining) && remaining > 0) duration = Math.min(duration, remaining);
  const started = performance.now();
  const outgoingVolume = outgoing.volume;
  return new Promise((resolve) => {
    const step = (now) => {
      if (!isCurrentTransition()) return resolve(false);
      const progress = Math.min(1, (now - started) / (duration * 1000));
      incoming.volume = progress;
      if (!naturalFadeIn) outgoing.volume = Math.max(0, outgoingVolume * (1 - progress));
      if (progress < 1) setTimeout(() => step(performance.now()), 50);
      else resolve(true);
    };
    setTimeout(() => step(performance.now()), 0);
  });
}
