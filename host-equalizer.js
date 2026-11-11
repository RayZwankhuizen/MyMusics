function validateEqualizer(value) {
  if (!value || typeof value.enabled !== "boolean" || !Array.isArray(value.gains) || value.gains.length !== 5
    || value.gains.some((gain) => typeof gain !== "number" || !Number.isFinite(gain) || gain < -12 || gain > 12)) {
    throw new Error("Equalizer requires five gains from -12 to +12 dB and an enabled flag.");
  }
  return { enabled: value.enabled, gains: [...value.gains] };
}

function equalizerFilter(value) {
  const { enabled, gains } = validateEqualizer(value);
  if (!enabled) return "";
  const filters = [
    `bass=f=100:t=q:w=0.707:g=${gains[0]}`,
    ...[250, 1000, 4000].map((frequency, index) => `equalizer=f=${frequency}:t=q:w=0.8:g=${gains[index + 1]}`),
    `treble=f=10000:t=q:w=0.707:g=${gains[4]}`
  ];
  return `lavfi=[${filters.join(",")}]`;
}
module.exports = { validateEqualizer, equalizerFilter };
