(() => {
  const key = "mymusics:playback-target";
  const select = document.querySelector("#playback-target");
  const read = () => { try { return localStorage.getItem(key) === "host" ? "host" : "browser"; } catch { return "browser"; } };
  let target = read();
  let hostAvailable = false;
  let picker;
  const tvMode = () => document.documentElement.classList.contains("tv-mode");
  const renderPicker = () => {
    if (!select) return;
    if (!picker) {
      picker = document.createElement("div");
      picker.className = "tv-playback-picker";
      picker.innerHTML = '<button type="button" class="tv-playback-current" aria-expanded="false">Audio output: This browser</button><div class="tv-playback-options" role="group" aria-label="Choose audio output" hidden><button type="button" data-output="browser">This browser</button><button type="button" data-output="host">MyMusics host</button></div>';
      select.closest("label")?.append(picker);
      picker.querySelector(".tv-playback-current").addEventListener("click", () => {
        const options = picker.querySelector(".tv-playback-options");
        options.hidden = !options.hidden;
        picker.querySelector(".tv-playback-current").setAttribute("aria-expanded", String(!options.hidden));
        if (!options.hidden) options.querySelector(`[data-output="${target}"]`).focus();
      });
      picker.querySelectorAll("[data-output]").forEach((button) => { button.addEventListener("click", () => {
        select.value = button.dataset.output;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        picker.querySelector(".tv-playback-options").hidden = true;
        picker.querySelector(".tv-playback-current").setAttribute("aria-expanded", "false");
        picker.querySelector(".tv-playback-current").focus();
      }); });
    }
    select.hidden = tvMode();
    picker.hidden = !tvMode();
    const hostOption = select.querySelector('option[value="host"]');
    hostOption.disabled = !hostAvailable;
    hostOption.textContent = hostAvailable ? "MyMusics host" : "MyMusics host (MPV required)";
    picker.querySelector(".tv-playback-current").textContent = `Audio output: ${target === "host" ? "MyMusics host" : "This browser"}`;
    picker.querySelectorAll("[data-output]").forEach((button) => { button.setAttribute("aria-pressed", String(button.dataset.output === target)); });
    const hostButton = picker.querySelector('[data-output="host"]');
    hostButton.disabled = !hostAvailable;
    hostButton.textContent = hostAvailable ? "MyMusics host" : "MyMusics host (MPV required)";
    hostButton.title = hostAvailable ? "" : "Install MPV on the MyMusics host first.";
  };
  function setTarget(value, persist = true) {
    target = value === "host" && hostAvailable ? "host" : "browser";
    if (select) select.value = target;
    if (persist) { try { localStorage.setItem(key, target); } catch {} }
    renderPicker();
  }
  async function refreshHostAvailability() {
    let available = false;
    try {
      const response = await fetch("/api/host-player/mpv", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check MPV availability.");
      available = (await response.json()).installed === true;
    } catch {}
    const wasAvailable = hostAvailable;
    hostAvailable = available;
    if (!available && target === "host") {
      setTarget("browser");
      window.dispatchEvent(new Event("mymusics:playback-target-change"));
      return;
    }
    renderPicker();
    if (available && !wasAvailable && target === "host") window.dispatchEvent(new Event("mymusics:playback-target-change"));
  }
  if (select) {
    select.value = target;
    select.addEventListener("change", () => {
      setTarget(select.value);
      window.dispatchEvent(new Event("mymusics:playback-target-change"));
    });
  }
  renderPicker();
  window.addEventListener("mymusics:tv-mode-change", renderPicker);
  window.MyMusicsPlayback = { get target() { return target; }, get isHost() { return target === "host" && hostAvailable; } };
  refreshHostAvailability();
  window.addEventListener("focus", refreshHostAvailability);
  window.addEventListener("storage", (event) => {
    if (event.key === "mymusics:mpv-installed") refreshHostAvailability();
  });
})();
