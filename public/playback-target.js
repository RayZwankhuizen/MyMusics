(() => {
  const key = "mymusics:playback-target";
  const select = document.querySelector("#playback-target");
  const read = () => { try { return localStorage.getItem(key) === "host" ? "host" : "browser"; } catch { return "browser"; } };
  let target = read();
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
      picker.querySelectorAll("[data-output]").forEach((button) => button.addEventListener("click", () => {
        select.value = button.dataset.output;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        picker.querySelector(".tv-playback-options").hidden = true;
        picker.querySelector(".tv-playback-current").setAttribute("aria-expanded", "false");
        picker.querySelector(".tv-playback-current").focus();
      }));
    }
    select.hidden = tvMode();
    picker.hidden = !tvMode();
    picker.querySelector(".tv-playback-current").textContent = `Audio output: ${target === "host" ? "MyMusics host" : "This browser"}`;
    picker.querySelectorAll("[data-output]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.output === target)));
  };
  if (select) {
    select.value = target;
    select.addEventListener("change", () => {
      target = select.value === "host" ? "host" : "browser";
      try { localStorage.setItem(key, target); } catch {}
      window.dispatchEvent(new Event("mymusics:playback-target-change"));
      renderPicker();
    });
  }
  renderPicker();
  window.addEventListener("mymusics:tv-mode-change", renderPicker);
  window.MyMusicsPlayback = { get target() { return target; }, get isHost() { return target === "host"; } };
})();
