import { metadataTrack } from "./radio-metadata-kind.mjs";

function readSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
  catch { return new Set(); }
}

export function speechTrackKey(artist, title) {
  const normalize = (value) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return artist?.trim() && title?.trim() ? JSON.stringify([normalize(artist), normalize(title)]) : "";
}

export function metadataBlockKey(fields, raw, stationUrl = "") {
  const { artist, title } = metadataTrack(fields || {});
  const normalize = (value) => (value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const identity = artist || title ? JSON.stringify([normalize(artist), normalize(title)]) : normalize(raw) || JSON.stringify(fields || {});
  return stationUrl && identity ? JSON.stringify([stationUrl, identity]) : "";
}

export function createRadioSuppressionStore() {
  const disabledStations = readSet("mymusics:speech-suppression-disabled");
  const disabledTracks = readSet("mymusics:speech-exempt-tracks");
  const suppressedMetadataBlocks = readSet("mymusics:suppressed-metadata-blocks");
  let feedback = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem("mymusics:speech-suppression-feedback") || "{}");
    feedback = new Map(Object.entries(saved).filter(([, value]) => value && typeof value.suppress === "boolean"));
    for (const key of disabledTracks) if (!feedback.has(key)) feedback.set(key, { suppress: false, suppressionCorrect: null, reviewedAt: null });
  } catch {
    feedback = new Map([...disabledTracks].map((key) => [key, { suppress: false, suppressionCorrect: null, reviewedAt: null }]));
  }

  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  return Object.freeze({
    disabledStations,
    disabledTracks,
    suppressedMetadataBlocks,
    feedback,
    saveDisabledStations: () => save("mymusics:speech-suppression-disabled", [...disabledStations]),
    saveTrackPreferences: () => save("mymusics:speech-exempt-tracks", [...disabledTracks]),
    saveFeedback: () => save("mymusics:speech-suppression-feedback", Object.fromEntries(feedback)),
    saveMetadataBlocks: () => save("mymusics:suppressed-metadata-blocks", [...suppressedMetadataBlocks])
  });
}
