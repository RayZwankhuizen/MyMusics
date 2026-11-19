export function createRadioTrackLookup({ getKey, setKey, isProgramMetadata, setCurrentTrack, setTrackStartStatus, lyrics, startLyrics, fetchMetadata, trackDetailsView, onTrackDuration }) {
  function showProgramMetadata(track) {
    setKey("");
    setTrackStartStatus(false);
    lyrics.reset("Program information; no lyrics.");
    document.querySelector("#track-artist").textContent = "Radio information";
    document.querySelector("#track-title").textContent = track.title || "Radio information";
    document.querySelector("#track-album").textContent = "";
    document.querySelector("#lookup-status").textContent = "";
    document.querySelector("#art-source").hidden = true;
    const image = document.querySelector("#cover-art");
    image.hidden = true;
    image.removeAttribute("src");
  }

  async function lookup(artist, title) {
    if (!artist.trim() || !title.trim()) return;
    if (isProgramMetadata({ artist, title })) {
      showProgramMetadata({ artist, title });
      return;
    }
    setCurrentTrack(artist, title);
    const key = `${artist}\u0000${title}`;
    if (key === getKey()) return;
    setKey(key);
    startLyrics();
    lyrics.reset("Searching lyrics…", true);
    document.querySelector("#track-title").textContent = title;
    document.querySelector("#track-artist").textContent = artist;
    document.querySelector("#track-album").textContent = "";
    document.querySelector("#art-source").hidden = true;
    document.querySelector("#lookup-status").textContent = "Finding album details…";
    document.querySelector("#cover-art").hidden = true;
    let result;
    try {
      result = await fetchMetadata(artist, title);
      if (key === getKey()) {
        onTrackDuration(artist, title, result.durationMs);
        trackDetailsView.render(result, artist, title, key);
      }
    } catch (error) {
      if (key === getKey()) document.querySelector("#lookup-status").textContent = error.message;
    } finally {
      if (key === getKey()) void lyrics.load(artist, title, key, result);
    }
  }

  return Object.freeze({ lookup, showProgramMetadata });
}
