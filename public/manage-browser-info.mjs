import { detectBrowser, getBrowserInfo } from "./browser-info.mjs";

const emulationKey = "mymusics:silk-emulation";
const ua = navigator.userAgent || "";
const actualSilk = detectBrowser(ua).name === "Silk";
const el = (selector) => document.querySelector(selector);

export function wireManageBrowserInfo() {
  const list = el("#browser-details");
  const status = el("#browser-info-status");
  const toggle = el("#silk-emulation");
  const refresh = el("#browser-info-refresh");
  const previewLinks = el("#browser-preview-links");

  try { toggle.checked = localStorage.getItem(emulationKey) === "true"; }
  catch { toggle.disabled = true; status.textContent = "Local storage is unavailable; this setting cannot be saved."; }

  function syncEmulationStatus() {
    if (toggle.disabled) { previewLinks.hidden = true; return; }
    const on = toggle.checked;
    status.textContent = on
      ? actualSilk ? "This browser is already Silk. Emulation is also enabled for Radio and Music." : "Silk layout emulation is on. Open Radio or Music to preview it."
      : actualSilk ? "This browser already identifies as Silk." : "Silk layout emulation is off.";
    previewLinks.hidden = !on;
  }

  toggle.addEventListener("change", () => {
    const on = toggle.checked;
    try { localStorage.setItem(emulationKey, String(on)); }
    catch {
      toggle.checked = false;
      status.textContent = "Local storage is unavailable; the setting could not be saved.";
      return;
    }
    document.documentElement.classList.toggle("silk-browser", actualSilk || on);
    document.documentElement.classList.toggle("silk-emulated", !actualSilk && on);
    syncEmulationStatus();
  });

  async function render() {
    refresh.disabled = true;
    status.dataset.info = "loading";
    const rows = await getBrowserInfo();
    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      if (label === "User agent") description.classList.add("browser-raw-value");
      fragment.append(term, description);
    }
    list.replaceChildren(fragment);
    refresh.disabled = false;
    status.dataset.info = "ready";
    syncEmulationStatus();
  }

  refresh.addEventListener("click", render);
  syncEmulationStatus();
  render();
}
