export function createRadioHostOutput({ getAudio, setStatus }) {
  const controls = document.querySelector("#host-radio-controls");
  const toggle = document.querySelector("#host-radio-toggle");
  const status = document.querySelector("#host-radio-status");

  async function play(station) {
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    controls.hidden = false;
    document.querySelector("#equalizer-status").textContent = "Equalizer and speech detection require browser output.";
    setStatus("CONNECTING TO MYMUSICS HOST");
    try {
      const response = await fetch("/api/host-player/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: station.url })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Host playback failed.");
      toggle.textContent = "Pause";
      status.textContent = "Playing through MyMusics host";
      setStatus("ON AIR", true);
    } catch (error) {
      status.textContent = error.message;
      setStatus("HOST AUDIO UNAVAILABLE");
    }
  }

  async function stop() {
    await fetch("/api/host-player/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" })
    }).catch(() => {});
  }

  toggle?.addEventListener("click", async () => {
    const paused = toggle.textContent === "Resume";
    const state = await fetch("/api/host-player/status").then((response) => response.json()).catch(() => null);
    const response = await fetch("/api/host-player/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: state?.activeDeck || "a", action: paused ? "resume" : "pause" })
    });
    if (response.ok) {
      toggle.textContent = paused ? "Pause" : "Resume";
      setStatus(paused ? "ON AIR" : "PAUSED", paused);
    }
  });

  document.querySelector("#host-radio-volume")?.addEventListener("input", (event) => {
    fetch("/api/host-player/status")
      .then((response) => response.json())
      .then((state) => fetch("/api/host-player/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck: state.activeDeck || "a", action: "volume", value: event.target.value })
      }))
      .catch(() => {});
  });

  return Object.freeze({ play, stop });
}
