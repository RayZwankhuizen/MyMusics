import { wireManageUpdates } from "./manage-updates.mjs";
import { wireManagePlaylists } from "./manage-playlists.mjs";
import { wireManageMusicGenres } from "./manage-music-genres.mjs";
import { wireManageMedia } from "./manage-media.mjs?v=bulk-delete-select-1";
import { wireManageJellyfinSettings } from "./manage-jellyfin-settings.mjs?v=host-ytdlp-1";
import { wireManageYouTubeSettings } from "./manage-youtube-settings.mjs";
import { request } from "./manage-api.mjs";
import { createManageCatalog } from "./manage-catalog.mjs?v=directory-station-editor-1";
import { wireStationSearch } from "./manage-station-search.mjs?v=directory-station-editor-1";
import { wireStationImages } from "./manage-station-images.mjs?v=temporary-logo-batch-1";
import { wireManageStreamFinder } from "./manage-stream-finder.mjs?v=station-country-1";
import { wireManageStationPreview } from "./manage-station-preview.mjs";
import { wireManageBrowserInfo } from "./manage-browser-info.mjs";
import { wireManageStationLogoBatch } from "./manage-station-logo-batch.mjs?v=temporary-logo-batch-1";
import { wireManageAllStations } from "./manage-all-stations.mjs?v=temporary-all-stations-1";
import { wireManageVideoPlaylists } from "./manage-video-playlists.mjs?v=youtube-playlist-tools-1";

const el = (selector) => document.querySelector(selector);
const exportButton = el("#export-saved-data");
const exportStatus = el("#export-saved-data-status");
exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  exportStatus.textContent = "Preparing export…";
  try {
    const [radioStations, music, youtube] = await Promise.all([
      request("/stations"), request("/api/music/playlists"), request("/api/videos/playlists")
    ]);
    const payload = {
      format: "mymusics-data-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      radioStations,
      musicPlaylists: music.playlists,
      youtubePlaylists: youtube.playlists
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `mymusics-export-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const stationCount = Object.values(radioStations).reduce((count, list) => count + (Array.isArray(list) ? list.length : 0), 0);
    exportStatus.textContent = `Exported ${stationCount} radio stations, ${music.playlists.length} Music playlists, and ${youtube.playlists.length} YouTube playlists.`;
  } catch (error) { exportStatus.textContent = error.message; }
  finally { exportButton.disabled = false; }
});
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
wireManageMedia({ el, request });
wireManageJellyfinSettings({ el, request });
wireManageYouTubeSettings({ el, request });
wireManageBrowserInfo();

wireStationSearch({
  el, request, getStations: catalog.getStations, openAddStation: catalog.openAddStation
});

catalog.refresh().catch((error) => notice(error.message, true));
wireManageUpdates({ request, el }).checkForUpdates();
const manageSectionIds = ["general", "jellyfin-settings", "host-audio-test", "browser-info", "updates", "stations", "playlists", "media-management", "video-playlists", "music-genres"];
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
  const selectedLink = document.querySelector(`[data-manage-section="${section}"]`);
  const selectedGroup = selectedLink?.closest(".manage-nav-group");
  if (selectedGroup) document.querySelectorAll(".manage-nav-group").forEach((group) => { group.open = group === selectedGroup; });
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
