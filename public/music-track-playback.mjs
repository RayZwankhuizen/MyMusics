import { runDeckFade } from "./music-decks.mjs";

export function createMusicTrackPlayback({ state, deckState, isHostOutput, hostPlayback, deckTransition, recordPlayedTrack, setStatus, refreshPlaybackAndQueue }) {
  async function playTrack(track, { record = true, targetKey = null, naturalFadeIn = false, naturalFadeDuration = 0, crossfadeDuration = null } = {}) {
    if (!track?.id) return;
    if (isHostOutput()) {
      await hostPlayback.playTrack(track, { record, targetKey, naturalFadeIn, naturalFadeDuration, crossfadeDuration });
      return;
    }
    deckState.decks.a.hidden = false;
    deckState.decks.b.hidden = false;
    const transition = deckTransition.invalidate();
    const previousTrack = state.current;
    const previousTranscoding = state.transcoding;
    const outgoingKey = deckState.activeDeck;
    const incomingKey = deckTransition.resolveIncomingDeck(track, targetKey);
    const outgoing = deckState.decks[outgoingKey];
    const fadeSeconds = previousTrack && incomingKey !== outgoingKey && state.crossfadeEnabled
      ? naturalFadeIn ? Number(naturalFadeDuration) || 0 : Number(crossfadeDuration ?? state.fadeSeconds) || 0
      : 0;
    const { deck: incoming, previousTrack: incomingPreviousTrack, previousArm: incomingPreviousArm, previousGain: incomingPreviousGain, alreadyLoaded } = deckTransition.prepareIncomingDeck(track, incomingKey, fadeSeconds);
    deckTransition.activateIncomingDeck(track, incomingKey, outgoingKey, fadeSeconds);
    try {
      await incoming.play();
    } catch {
      deckTransition.restoreAfterFailure({
        transition,
        outgoingKey,
        incomingKey,
        outgoing,
        incoming,
        previousTrack,
        previousTranscoding,
        incomingPreviousTrack,
        incomingPreviousArm,
        incomingPreviousGain,
        alreadyLoaded
      });
      setStatus("PRESS PLAY TO LISTEN");
      return;
    }
    if (record) recordPlayedTrack(track);
    if (fadeSeconds) {
      const outgoingStartGain = deckState.gains[outgoingKey];
      const completed = await runDeckFade(
        incoming, outgoing, fadeSeconds, naturalFadeIn,
        () => deckTransition.isCurrent(transition),
        () => deckState.volume,
        outgoingStartGain,
        (incomingGain, outgoingGain) => {
          deckState.gains[incomingKey] = incomingGain;
          deckState.gains[outgoingKey] = outgoingGain;
        }
      );
      if (!completed) return;
      deckTransition.finish(naturalFadeIn);
    }
    deckTransition.releaseOutgoingDeck(outgoing, incoming, outgoingKey, naturalFadeIn);
    refreshPlaybackAndQueue();
  }

  return Object.freeze({ playTrack });
}
