export function metadataTrack(fields) {
  const artist = fields.artist || fields.TPE1 || "";
  const title = fields.title || fields.TIT2 || fields.StreamTitle || "";
  if (!artist && fields.StreamTitle?.includes(" - ")) {
    const [parsedArtist, ...parts] = fields.StreamTitle.split(" - ");
    return { artist: parsedArtist.trim(), title: parts.join(" - ").trim() };
  }
  return { artist, title };
}

export function isProgramMetadata(track, station) {
  if (/\b(news|nieuws)\b|\b(traffic|weather|verkeers)(\s+(report|update|bericht|informatie))\b|\bweerbericht\b/i.test(track.title || "")) return true;
  const normalize = (value) => value.toLocaleLowerCase().replace(/\bradio\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const identity = normalize(station?.name || "");
  return Boolean(identity && normalize(`${track.artist || ""} ${track.title || ""}`) === identity);
}

export function inferMetadataKind(data, { station, speechDetected, speechDetectionEnabled }) {
  const fields = data.fields || {};
  const raw = [data.raw, ...Object.values(fields)].filter(Boolean).join(" ").toLocaleLowerCase();
  const track = metadataTrack(fields);
  if (/\b(news|nieuws)\b|\b(traffic|weather|verkeers)(\s+(report|update|bericht|informatie))\b|\bweerbericht\b/i.test(track.title || "")) {
    return { kind: "speech", label: "Speech likely", reason: "Metadata appears to identify a news or traffic report." };
  }
  if (isProgramMetadata(track, station)) {
    return { kind: "unknown", label: "Station identification", reason: "Metadata matches the station name." };
  }
  if (/\b(advert(?:isement)?|commercial|sponsor(?:ed)?|reclame|promo(?:tion)?|ad break)\b/.test(raw)) {
    return { kind: "speech", label: "Possible advertisement", reason: "Received metadata contains advertising or sponsor terms." };
  }
  if (track.artist && track.title) {
    return { kind: "music", label: "Music likely", reason: "Metadata contains an artist and track title." };
  }
  if (speechDetected) return { kind: "speech", label: "Possible speech/ad", reason: "The audio detector recently identified speech; this may also be singing." };
  return { kind: "unknown", label: "Unknown", reason: speechDetectionEnabled ? "No recent speech detection or recognizable track fields." : "No active speech detection or recognizable track fields." };
}
