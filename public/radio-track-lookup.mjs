export function createRadioTrackLookup({ getKey, setKey, isProgramMetadata, setCurrentTrack, setTrackStartedAt, setTrackStartStatus, lyrics, startLyrics, fetchMetadata, trackDetailsView }) {
  function showProgramMetadata(track) {
    setCurrentTrack(track.artist || "", track.title || "");
    setKey("");
    setTrackStartedAt(null);
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
    setCurrentTrack(artist, title);
    if (isProgramMetadata({ artist, title })) {
      showProgramMetadata({ artist, title });
      return;
    }
    const key = `${artist}\u0000${title}`;
    if (key === getKey()) return;
    setKey(key);
    startLyrics();
    lyrics.reset("Searching lyrics…", true);
    lyrics.load(artist, title, key);
    document.querySelector("#track-title").textContent = title;
    document.querySelector("#track-artist").textContent = artist;
    document.querySelector("#track-album").textContent = "";
    document.querySelector("#art-source").hidden = true;
    document.querySelector("#lookup-status").textContent = "Finding album details…";
    document.querySelector("#cover-art").hidden = true;
    try {
      const result = await fetchMetadata(artist, title);
      if (key === getKey()) trackDetailsView.render(result, artist, title, key);
    } catch (error) {
      if (key === getKey()) document.querySelector("#lookup-status").textContent = error.message;
    }
  }

  return Object.freeze({ lookup, showProgramMetadata });
}
