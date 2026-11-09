export function createRadioTrackUpdates({ setMetadataBlock, setCurrentTrack, isProgramMetadata, showProgramMetadata, appendMetadata, setTrackStartedAt, setTrackStartStatus, renderTrack, lookupTrack }) {
  let lastPolledTrackKey = "";

  async function applyPoll(track, station) {
    if (track.title) {
      const fields = { artist: track.artist || "", title: track.title, startTime: track.startTime || "", startTimeSent: track.startTimeSent };
      setMetadataBlock(fields, JSON.stringify(track), station.url);
      const artist = track.artist || "Artist unavailable";
      const key = `${artist}\u0000${track.title}`;
      if (key !== lastPolledTrackKey) {
        appendMetadata({ source: "HLS EXTINF", receivedAt: new Date().toISOString(), raw: JSON.stringify(track), fields });
        lastPolledTrackKey = key;
      }
      setCurrentTrack(track.artist || "", track.title);
      if (isProgramMetadata(track, station)) {
        showProgramMetadata(track);
        return;
      }
      setTrackStartedAt(track.startTime || null);
      setTrackStartStatus(Boolean(track.startTimeSent), track.startTime);
      renderTrack(artist, track.title);
    }
    if (track.artist && track.title) await lookupTrack(track.artist, track.title);
  }

  function applyStream(track, station) {
    const fields = { artist: track.artist || "", title: track.title || "", startTime: track.startTime || "", startTimeSent: track.startTimeSent };
    setMetadataBlock(fields, JSON.stringify(track), station.url);
    setCurrentTrack(track.artist || "", track.title || "");
    if (isProgramMetadata(track, station)) {
      showProgramMetadata(track);
      return;
    }
    appendMetadata({ source: "TRACK UPDATE", receivedAt: new Date().toISOString(), raw: JSON.stringify(track), fields });
    setTrackStartedAt(track.startTime || null);
    setTrackStartStatus(Boolean(track.startTimeSent), track.startTime);
    if (track.title) renderTrack(track.artist || "Artist unavailable", track.title);
    if (track.artist && track.title) void lookupTrack(track.artist, track.title);
  }

  return Object.freeze({ applyPoll, applyStream, reset() { lastPolledTrackKey = ""; } });
}
