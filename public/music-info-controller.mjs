export function createMusicInfoController({ state, el, view, empty }) {
  async function fetchInfo(item) {
    const id = item.kind === "genre" ? item.title : item.id;
    const response = await fetch(`/api/music/info?${new URLSearchParams({ kind: item.kind, id })}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Details are unavailable.");
    return result.info;
  }

  async function openDialog(item, browseOnly, detailRequest) {
    try {
      const info = await fetchInfo(item);
      if (detailRequest !== state.detailRequest) return;
      if (browseOnly) view.renderBrowse(info);
      else view.renderInfo(info);
      el("#info-status").textContent = "";
    } catch (error) {
      if (detailRequest !== state.detailRequest) return;
      view.renderError(item, browseOnly, error);
    }
    const dialog = el("#info-dialog");
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const firstRow = dialog.querySelector(".info-lists .station-row");
    const target = browseOnly ? firstRow?.querySelector(".station-actions button:first-child") : null;
    (target || dialog.querySelector(".info-actions button") || dialog.querySelector(".info-heading button"))?.focus();
  }

  async function openJukeboxSearchInfo(item, detailRequest) {
    const rackList = view.prepareJukeboxSearchInfo(item);
    try {
      const info = await fetchInfo(item);
      if (detailRequest !== state.detailRequest) return;
      if (rackList) view.renderJukeboxSearchInfo(item, info, rackList);
    } catch (error) {
      if (detailRequest !== state.detailRequest) return;
      if (rackList) rackList.replaceChildren(empty(error.message));
      el("#jb-search-feedback").textContent = error.message;
    }
    (rackList?.querySelector(".jb-strip") || el("#jb-search-close"))?.focus();
  }

  async function openInfo(item, { browseOnly = false } = {}) {
    const detailRequest = ++state.detailRequest;
    state.detailItem = item;
    const addAlbumButton = el("#jb-search-add-album");
    addAlbumButton.classList.remove("is-added");
    addAlbumButton.removeAttribute("aria-label");
    if (el("#jb-search-dialog")?.open) await openJukeboxSearchInfo(item, detailRequest);
    else await openDialog(item, browseOnly, detailRequest);
  }

  return Object.freeze({ openInfo });
}
