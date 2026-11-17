// The visible YouTube player is the clock. Serialize host commands so an
// older load/seek cannot overtake a newer video or output selection.
export function createYoutubeHostSync({ snapshot, request, onSession, onPrepared, onError, now = () => performance.now() }) {
  let owned = null;
  let pending = false;
  let running = null;
  let keepalive = false;
  let retryAt = 0;
  const current = () => {
    const value = snapshot();
    return value?.active && value.videoId ? value : null;
  };
  const matches = (session) => owned === session && current()?.videoId === session.videoId;
  const post = (path, body, extra = {}) => request(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra
  });
  const command = (session, action, value, extra) => post("/api/host-player/control", {
    sessionId: session.sessionId, videoId: session.videoId, deck: "a", action, ...(value === undefined ? {} : { value })
  }, extra);

  async function release() {
    if (!owned) return;
    const previous = owned;
    owned = null;
    onSession("");
    await command(previous, "stop", undefined, { keepalive });
  }

  async function reconcile() {
    let desired = current();
    if (desired && now() < retryAt) return;
    if (!desired || (owned && owned.videoId !== desired.videoId)) await release();
    desired = current();
    if (!desired) return;
    if (!owned) {
      const videoId = desired.videoId;
      const result = await post("/api/host-player/video", { videoId, startSeconds: desired.time, paused: true });
      owned = { videoId, sessionId: result.sessionId, ready: false, rate: 1 };
      onSession(result.sessionId);
      if (!matches(owned)) { await release(); pending = true; return; }
    }
    const session = owned;
    const started = now();
    const status = await request("/api/host-player/status", { cache: "no-store" });
    const received = now();
    const roundTrip = (received - started) / 1000;
    if (!matches(session)) { pending = true; return; }
    if (status.activeType !== "video" || status.videoId !== session.videoId) {
      throw Object.assign(new Error("Host playback changed. Select host output again to reconnect."), { status: 409 });
    }
    const deck = status.decks?.a;
    if (!deck || deck.error) throw new Error(deck?.error || "Host video status is unavailable.");
    desired = current();
    const rate = Number(desired.rate) || 1;
    if (session.rate !== rate) {
      await command(session, "speed", rate);
      session.rate = rate;
      if (!matches(session)) { pending = true; return; }
    }
    // Stop audio while the image is paused or buffering, and align before resume.
    const playing = desired.state === "playing";
    if (!playing && !deck.paused) {
      await command(session, "pause");
      if (!matches(session)) { pending = true; return; }
    }
    desired = current();
    const hostTime = Number(deck.time) + (deck.playing ? ((now() - received) / 1000 + roundTrip * 0.5) * rate : 0);
    if (!Number.isFinite(hostTime)) throw new Error("Host video position is unavailable.");
    if (!session.ready || (!playing && !deck.paused) || Math.abs(desired.time - hostTime) > 0.35) {
      await command(session, "seek", desired.time + (desired.state === "playing" ? roundTrip * 0.5 * rate : 0));
      if (!matches(session)) { pending = true; return; }
    }
    if (!session.ready) {
      session.ready = true;
      onPrepared(session.videoId);
    }
    desired = current();
    if (!matches(session)) { pending = true; return; }
    if (desired.state === "playing" && (deck.paused || !playing)) await command(session, "resume");
    else if (desired.state !== "playing" && !deck.paused && playing) await command(session, "pause");
  }

  function sync(options = {}) {
    keepalive = Boolean(options.keepalive);
    pending = true;
    if (running) return running;
    running = (async () => {
      while (pending) {
        pending = false;
        try { await reconcile(); }
        catch (error) {
          if (error.status === 409) { owned = null; onSession(""); }
          retryAt = now() + 3000;
          onError(error);
          pending = false;
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  return Object.freeze({ sync, get videoId() { return owned?.videoId || ""; }, get ready() { return Boolean(owned?.ready); } });
}
