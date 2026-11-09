export function naturalFadeoutSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 2 && seconds <= 60 ? seconds : 0;
}
