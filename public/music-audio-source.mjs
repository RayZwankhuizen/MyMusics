const containerMime = {
  flac: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg; codecs=opus", wav: "audio/wav",
  alac: "audio/mp4", aiff: "audio/aiff", aif: "audio/aiff", wma: "audio/x-ms-wma",
  ape: "audio/x-ape", dsf: "audio/x-dsf", dff: "audio/x-dff"
};

export function createMusicAudioSource(audio) {
  function needsTranscode(track) {
    const mime = containerMime[track?.container];
    return mime ? !audio.canPlayType(mime) : false;
  }

  function audioUrl(track, { transcode = false } = {}) {
    return `/library/audio/${encodeURIComponent(track.id)}${transcode ? "?transcode=1" : ""}`;
  }

  return Object.freeze({ audioUrl, needsTranscode });
}
