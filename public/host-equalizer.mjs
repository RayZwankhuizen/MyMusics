let enabled = true;
export function hostEqualizerSettings() {
  return { enabled, gains: [...document.querySelectorAll(".equalizer-band input")].map((input) => Number(input.value)) };
}

export function createHostEqualizer(isHostOutput) {
  const el = (selector) => document.querySelector(selector);
  let timer;
  let pending = Promise.resolve();
  function refresh() {
    for (const selector of ["#equalizer-reset", "#equalizer-preset", "#equalizer-power", ".equalizer-band input"]) {
      document.querySelectorAll(selector).forEach((node) => { node.disabled = false; });
    }
    el("#equalizer-power").textContent = enabled ? "EQ On" : "EQ Off";
    el("#equalizer-power").setAttribute("aria-pressed", String(enabled));
    el("#equalizer-status").textContent = "Host equalizer · MPV audio processing";
  }
  function sync() {
    if (!isHostOutput()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const settings = hostEqualizerSettings();
      pending = pending.catch(() => {}).then(async () => {
        if (!isHostOutput()) return;
        const response = await fetch("/api/host-player/equalizer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Host equalizer update failed.");
      }).catch((error) => { el("#equalizer-status").textContent = error.message; });
    }, 120);
  }
  el("#equalizer-bands").addEventListener("input", sync);
  el("#equalizer-preset").addEventListener("change", sync);
  el("#equalizer-reset").addEventListener("click", sync);
  return {
    refresh,
    sync,
    toggle() { enabled = !enabled; refresh(); sync(); }
  };
}
