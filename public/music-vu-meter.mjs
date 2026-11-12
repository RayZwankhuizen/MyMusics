export function wireMusicVuMeter({ getBrowserLevels, isHostOutput, isPlaying }) {
  const label = document.querySelector(".music-vu-label");
  const bars = [...document.querySelectorAll(".music-vu-track > i")];
  let hostLevels = null;
  let nextPoll = 0;
  let polling = false;

  function show(levels) {
    const active = isPlaying();
    const unavailable = active && (!Array.isArray(levels) || levels.length < 2);
    const time = performance.now() / 1000;
    label.textContent = "STEREO · VU";
    bars.forEach((bar, index) => {
      const sway = Math.sin(time * (index ? 5.1 : 4.2) + index * 1.7) * 0.035;
      const level = !active ? 0 : unavailable
        ? 0.28 + Math.sin(time * (index ? 4.4 : 3.6) + index * 1.9) * 0.16
        : 0.04 + Math.min(1, Math.max(0, levels[index])) * 0.96 + sway;
      bar.style.transform = `scaleX(${1 - Math.max(0.04, Math.min(1, level))})`;
    });
  }

  async function pollHost() {
    polling = true;
    nextPoll = performance.now() + 160;
    try {
      const response = await fetch("/api/host-player/music-level", { cache: "no-store" });
      hostLevels = (await response.json()).levels || null;
    } catch { hostLevels = null; }
    polling = false;
  }

  function draw() {
    const active = isPlaying() && !document.hidden;
    if (isHostOutput()) {
      if (active && !polling && performance.now() >= nextPoll) void pollHost();
      show(active ? hostLevels : []);
    } else show(active ? getBrowserLevels() : []);
    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}
