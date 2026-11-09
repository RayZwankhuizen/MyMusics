import { wireManageUpdates } from "./manage-updates.mjs";
import { wireManagePlaylists } from "./manage-playlists.mjs";
import { wireManageMusicGenres } from "./manage-music-genres.mjs";
import { request } from "./manage-api.mjs";
import { createManageCatalog } from "./manage-catalog.mjs";
import { wireStationSearch } from "./manage-station-search.mjs";
import { wireStationImages } from "./manage-station-images.mjs";
import { wireManageStreamFinder } from "./manage-stream-finder.mjs";
import { wireManageStationPreview } from "./manage-station-preview.mjs";

const el = (selector) => document.querySelector(selector);
const notice = (message, error = false) => {
  el("#notice").textContent = message;
  el("#notice").classList.toggle("error", error);
};
const stationImages = wireStationImages({ el });
const streamFinder = wireManageStreamFinder({ el, request });
const stationPreview = wireManageStationPreview();
const catalog = createManageCatalog({ el, request, notice, stationImages, streamFinder, stationPreview });
wireManagePlaylists({ el, initialPlaylistId: new URLSearchParams(location.search).get("playlist") || "" });
wireManageMusicGenres({ el, request });

wireStationSearch({
  el, request, route: catalog.route,
  getStations: catalog.getStations,
  setStations: catalog.setStations,
  render: catalog.render,
  notice
});

catalog.refresh().catch((error) => notice(error.message, true));
wireManageUpdates({ request, el }).checkForUpdates();
function syncManageSection() {
  const section = location.hash.slice(1) || "stations";
  if (section === "updates") el("#updates").open = true;
  document.querySelectorAll("[data-manage-section]").forEach((link) => {
    const selected = link.dataset.manageSection === section;
    link.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (location.hash) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: "start" }));
}
syncManageSection();
window.addEventListener("hashchange", syncManageSection);
