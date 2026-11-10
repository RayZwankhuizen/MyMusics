export function wireMusicVolume({ deckState, isHostOutput }) {
  const slider = document.querySelector("#music-volume");
  const value = document.querySelector("#music-volume-value");
  const key = "mymusics:music-volume";
  let timer;
  let volume = 100;
  try {
    const stored = localStorage.getItem(key);
    const saved = Number(stored);
    if (stored !== null && Number.isInteger(saved) && saved >= 0 && saved <= 100) volume = saved;
  } catch {}

  deckState.volume = volume / 100;
  slider.value = String(volume);
  value.value = `${volume}%`;

  function applyBrowserVolume() {
    for (const key of ["a", "b"]) {
      deckState.decks[key].volume = deckState.volume * deckState.gains[key];
    }
  }

  function applyHostVolume() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!isHostOutput()) return;
      fetch("/api/host-player/music-volume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume })
      }).catch(() => {});
    }, 60);
  }

  function apply() {
    if (isHostOutput()) applyHostVolume();
    else applyBrowserVolume();
  }

  slider.addEventListener("input", () => {
    volume = Number(slider.value);
    deckState.volume = volume / 100;
    value.value = `${volume}%`;
    try { localStorage.setItem(key, String(volume)); } catch {}
    apply();
  });
  window.addEventListener("mymusics:playback-target-change", apply);
  apply();
}
