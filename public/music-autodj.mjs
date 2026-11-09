export function wireMusicAutoDj({ el, state, fillQueue, setStatus }) {
  const button = el("#autodj-toggle");
  const dialog = el("#autodj-dialog");
  if (!button || !dialog) return;
  let selectedTrack = null;

  function renderButton() {
    button.setAttribute("aria-pressed", String(Boolean(state.autoDj)));
    button.setAttribute("aria-expanded", String(dialog.open));
    button.textContent = state.autoDj ? `AutoDJ: ${state.autoDj.mode[0].toUpperCase()}${state.autoDj.mode.slice(1)}` : "AutoDJ: OFF";
  }
  dialog.addEventListener("close", renderButton);
  window.addEventListener("mymusics:autodj-state-change", renderButton);

  button.addEventListener("click", () => {
    if (state.autoDj) {
      state.autoDj = null;
      renderButton();
      setStatus("AUTODJ OFF · CURRENT QUEUE WILL FINISH");
      return;
    }
    const track = state.current;
    if (!track?.id) {
      setStatus("PLAY A TRACK BEFORE STARTING AUTODJ");
      return;
    }
    selectedTrack = track;
    let selected = false;
    for (const mode of ["artist", "album", "genre"]) {
      const option = dialog.querySelector(`[name="autodj-mode"][value="${mode}"]`);
      const label = dialog.querySelector(`[data-autodj-label="${mode}"]`);
      const value = mode === "artist" ? track.artist : mode === "album" ? track.album : track.genre;
      option.disabled = !value;
      option.checked = !selected && Boolean(value);
      selected ||= Boolean(value);
      label.textContent = value || `${mode[0].toUpperCase()}${mode.slice(1)} unavailable for this track`;
    }
    el("#autodj-start").disabled = !selected;
    dialog.showModal();
    renderButton();
  });

  el("#autodj-close")?.addEventListener("click", () => dialog.close());
  el("#autodj-start")?.addEventListener("click", (event) => {
    event.preventDefault();
    const mode = dialog.querySelector('[name="autodj-mode"]:checked')?.value;
    if (!mode || !selectedTrack?.id) return;
    state.autoDj = { mode, seed: selectedTrack };
    renderButton();
    dialog.close();
    setStatus(`AUTODJ · LOADING ${mode.toUpperCase()} TRACKS`);
    void fillQueue(true);
  });

  dialog.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
  renderButton();
}
