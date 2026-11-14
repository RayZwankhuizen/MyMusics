import { wireManageUpdates } from "./manage-updates.mjs";
import { wireManagePlaylists } from "./manage-playlists.mjs";
import { wireManageMusicGenres } from "./manage-music-genres.mjs";
import { wireManageJellyfinSettings } from "./manage-jellyfin-settings.mjs";
import { request } from "./manage-api.mjs";
import { createManageCatalog } from "./manage-catalog.mjs?v=preserve-source-genre-1";
import { wireStationSearch } from "./manage-station-search.mjs";
import { wireStationImages } from "./manage-station-images.mjs?v=temporary-logo-batch-1";
import { wireManageStreamFinder } from "./manage-stream-finder.mjs";
import { wireManageStationPreview } from "./manage-station-preview.mjs";
import { wireManageBrowserInfo } from "./manage-browser-info.mjs";
import { wireManageStationLogoBatch } from "./manage-station-logo-batch.mjs?v=temporary-logo-batch-1";
import { wireManageAllStations } from "./manage-all-stations.mjs?v=temporary-all-stations-1";
import { wireManageVideoPlaylists } from "./manage-video-playlists.mjs?v=2";

const el = (selector) => document.querySelector(selector);
const notice = (message, error = false) => {
  el("#notice").textContent = message;
  el("#notice").classList.toggle("error", error);
};
const stationImages = wireStationImages({ el });
const streamFinder = wireManageStreamFinder({ el, request });
const stationPreview = wireManageStationPreview();
const catalog = createManageCatalog({ el, request, notice, stationImages, streamFinder, stationPreview });
wireManageStationLogoBatch({ el, catalog, request, stationImages });
wireManageAllStations({ el, catalog, request });
wireManagePlaylists({ el, initialPlaylistId: new URLSearchParams(location.search).get("playlist") || "" });
wireManageVideoPlaylists({ el, request });
wireManageMusicGenres({ el, request });
wireManageJellyfinSettings({ el, request });
wireManageBrowserInfo();

wireStationSearch({
  el, request, route: catalog.route,
  getStations: catalog.getStations,
  setStations: catalog.setStations,
  render: catalog.render,
  notice
});

catalog.refresh().catch((error) => notice(error.message, true));
wireManageUpdates({ request, el }).checkForUpdates();
const manageSectionIds = ["general", "jellyfin-settings", "host-audio-test", "browser-info", "updates", "stations", "playlists", "video-playlists", "music-genres"];
const manageTiles = new Map();
for (const id of manageSectionIds) {
  const panel = el(`#${id}`);
  if (!panel) continue;
  let tile = panel;
  if (panel.tagName !== "DETAILS") {
    tile = document.createElement("details");
    tile.className = "manage-tile";
    tile.dataset.manageTile = id;
    const summary = document.createElement("summary");
    summary.dataset.tileLabel = id;
    summary.textContent = document.querySelector(`[data-manage-section="${id}"]`)?.textContent.trim() || panel.querySelector("h2")?.textContent.trim() || id;
    panel.before(tile);
    tile.append(summary, panel);
  } else {
    tile.classList.add("manage-tile");
    tile.dataset.manageTile = id;
  }
  manageTiles.set(id, tile);
}
function updateTileSummary(id, tile) {
  const summary = tile.querySelector(":scope > summary");
  if (!summary || id === "updates") return;
  const label = summary.dataset.tileLabel;
  summary.textContent = tile.open ? "Collapse" : label;
  summary.setAttribute("aria-label", `${tile.open ? "Collapse" : "Open"} ${label}`);
}
function selectManageLink(section) {
  document.querySelectorAll("[data-manage-section]").forEach((link) => {
    const selected = link.dataset.manageSection === section;
    link.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
manageTiles.forEach((tile, id) => { tile.addEventListener("toggle", () => {
  updateTileSummary(id, tile);
  if (!tile.open) return;
  manageTiles.forEach((other, otherId) => {
    if (other !== tile) other.open = false;
    updateTileSummary(otherId, other);
  });
  selectManageLink(id);
  const hash = `#${id}`;
  if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
}); });
function syncManageSection() {
  const requested = location.hash.slice(1);
  const section = manageSectionIds.includes(requested) ? requested : "stations";
  manageTiles.forEach((tile, id) => {
    tile.open = id === section;
    updateTileSummary(id, tile);
  });
  selectManageLink(section);
  if (location.hash) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: "start" }));
}
document.querySelectorAll("[data-manage-section]").forEach((link) => { link.addEventListener("click", () => {
  if (link.dataset.manageSection === location.hash.slice(1)) requestAnimationFrame(syncManageSection);
}); });
syncManageSection();
window.addEventListener("hashchange", syncManageSection);
