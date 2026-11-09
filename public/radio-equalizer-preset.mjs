export function defaultRadioEqualizerPreset(genre) {
  const name = genre.trim().toLowerCase().replace(/^(nl|us|other)\s*-\s*/, "");
  if (name === "rock") return "rock";
  if (name === "classical") return "classical";
  if (name === "jazz") return "jazz";
  if (name === "country") return "country";
  if (["news", "regional", "spoken", "talk"].includes(name)) return "spoken";
  if (["electronic", "dance"].includes(name)) return "electronic";
  if (["pop", "music"].includes(name)) return "pop";
  return "flat";
}
