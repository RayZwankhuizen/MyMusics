export function wireManageMedia({ el, request }) {
  const scanButton = el("#media-duplicate-scan");
  const bulkDeleteButton = el("#media-delete-selected");
  const selectionStatus = el("#media-delete-selection-status");
  const status = el("#media-duplicate-status");
  const list = el("#media-duplicate-list");
  const dialog = el("#media-delete-dialog");
  const deleteForm = el("#media-delete-form");
  const confirmText = el("#media-delete-confirm-text");
  const confirmStatus = el("#media-delete-confirm-status");
  const confirmButton = el("#media-delete-confirm");
  const cancelButton = el("#media-delete-cancel");
  let scanning = false;
  let deleting = false;
  let pendingItems = [];

  function updateConfirmation() {
    const confirmed = confirmText.value.trim() === "DELETE";
    confirmButton.disabled = !confirmed || deleting;
    confirmStatus.textContent = confirmed ? "Confirmation accepted. Click Delete files to continue." : "Type DELETE exactly to enable Delete files.";
    confirmStatus.classList.toggle("is-confirmed", confirmed);
  }
  const errorMessage = (error) => error.message === "API endpoint not found."
    ? "This server has not loaded the Media management API yet. Restart MyMusics from the updated installation, then reload this page."
    : error.message;
  const normalize = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const fingerprint = (track) => {
    const title = normalize(track.title);
    const artist = normalize(track.artist);
    const duration = Math.round(Number(track.durationMs) / 1000);
    return title && artist && duration > 0 ? `${title}\0${artist}\0${duration}` : "";
  };
  const formatDuration = (durationMs) => {
    const seconds = Math.floor((Number(durationMs) || 0) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const formatSize = (size) => size ? `${(size / 1024 / 1024).toFixed(1)} MB` : "Size unavailable";

  function updateSelection() {
    const cards = [...list.querySelectorAll(".media-duplicate-group")];
    let count = 0;
    let groupCount = 0;
    for (const card of cards) {
      const boxes = [...card.querySelectorAll('input[type="checkbox"]')];
      const selected = boxes.filter((box) => box.checked).length;
      const pathful = boxes.filter((box) => box.dataset.pathAvailable === "true").length;
      count += selected;
      if (selected) groupCount++;
      for (const box of boxes) box.disabled = box.dataset.pathAvailable !== "true" || (!box.checked && pathful - selected <= 1);
      const summary = card.querySelector(".media-duplicate-summary");
      const total = card.querySelectorAll(".media-copy-row").length;
      summary.textContent = `${card.dataset.artist} · ${card.dataset.duration} · ${total} copies · ${selected} selected to delete`;
    }
    bulkDeleteButton.disabled = count === 0 || deleting;
    bulkDeleteButton.textContent = count ? `Delete ${count} selected ${count === 1 ? "copy" : "copies"}` : "Delete selected copies";
    selectionStatus.textContent = count
      ? `${count} copies selected across ${groupCount} groups; at least one located copy will remain in each group.`
      : "Select copies to delete. At least one located copy must remain in every group.";
  }

  function renderGroup(group, index) {
    const card = document.createElement("article");
    card.className = "media-duplicate-group";
    card.dataset.group = String(index);
    card.dataset.artist = group.tracks[0].artist;
    card.dataset.duration = formatDuration(group.tracks[0].durationMs);
    const heading = document.createElement("h3");
    heading.textContent = group.tracks[0].title;
    const summary = document.createElement("p");
    summary.className = "media-duplicate-summary";
    summary.textContent = `${group.tracks[0].artist} · ${formatDuration(group.tracks[0].durationMs)} · ${group.tracks.length} copies · 0 selected to delete`;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "media-duplicate-copies";
    const legend = document.createElement("legend");
    legend.textContent = "Select copies to delete; leave at least one copy to keep";
    fieldset.append(legend);

    for (const track of group.tracks) {
      const label = document.createElement("label");
      label.className = "media-copy-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = track.id;
      checkbox.dataset.pathAvailable = String(Boolean(track.path));
      checkbox.dataset.path = track.path || "";
      checkbox.setAttribute("aria-label", `Select ${track.title} by ${track.artist} for deletion at ${track.path || "unknown location"}`);
      checkbox.addEventListener("change", updateSelection);
      const detail = document.createElement("span");
      detail.className = "media-copy-detail";
      const album = document.createElement("strong");
      album.textContent = track.album || "Album unavailable";
      const file = document.createElement("code");
      file.textContent = track.path || "File location unavailable";
      const size = document.createElement("small");
      size.textContent = `${formatSize(track.size)}${track.container ? ` · ${track.container.toUpperCase()}` : ""}`;
      detail.append(album, file, size);
      label.append(checkbox, detail);
      fieldset.append(label);
    }
    card.append(heading, summary, fieldset);
    return card;
  }

  async function scan() {
    if (scanning || deleting) return;
    scanning = true;
    scanButton.disabled = true;
    list.replaceChildren();
    updateSelection();
    status.textContent = "Scanning Jellyfin tracks…";
    const groups = new Map();
    let startIndex = 0;
    let total = 0;
    try {
      while (true) {
        const page = await request(`/api/music/manage/tracks?startIndex=${startIndex}&limit=500`);
        const tracks = Array.isArray(page.tracks) ? page.tracks : [];
        total = Math.max(total, Number(page.totalRecordCount) || 0);
        for (const track of tracks) {
          const key = fingerprint(track);
          if (!key) continue;
          const group = groups.get(key) || [];
          group.push(track);
          groups.set(key, group);
        }
        startIndex += tracks.length;
        status.textContent = `Scanned ${startIndex}${total ? ` of ${total}` : ""} tracks…`;
        if (!tracks.length || (total && startIndex >= total) || tracks.length < 500) break;
      }
      const duplicates = [...groups.values()].filter((tracks) => tracks.length > 1);
      duplicates.sort((a, b) => a[0].artist.localeCompare(b[0].artist) || a[0].title.localeCompare(b[0].title));
      duplicates.forEach((group, index) => list.append(renderGroup({ tracks: group }, index)));
      updateSelection();
      status.textContent = duplicates.length
        ? `${duplicates.length} matching groups found across ${startIndex} tracks. Matches use title, artist, and duration; review each location before deleting.`
        : `No matching duplicate groups found across ${startIndex} tracks.`;
    } catch (error) { status.textContent = errorMessage(error); }
    finally { scanning = false; scanButton.disabled = false; }
  }

  async function deletePending() {
    if (confirmText.value.trim() !== "DELETE" || deleting) return;
    const items = pendingItems;
    if (!items.length) return;
    deleting = true;
    confirmText.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = "Deleting…";
    cancelButton.disabled = true;
    scanButton.disabled = true;
    confirmStatus.textContent = "Deleting selected files from disk and Jellyfin…";
    status.textContent = "Deleting selected duplicate files…";
    let deleted = 0;
    let failureMessage = "";
    const deletedItems = [];
    try {
      for (const item of items) {
        await request(`/api/music/manage/tracks/${encodeURIComponent(item.id)}`, "DELETE", { keepId: item.keepId, confirm: "DELETE" });
        deleted++;
        deletedItems.push(item);
      }
      dialog.close();
      status.textContent = `${deleted} duplicate ${deleted === 1 ? "file" : "files"} deleted. Selected copies were removed from the list.`;
    } catch (error) {
      failureMessage = `${deleted} files deleted before this error: ${errorMessage(error)}${deleted ? " Remaining selections are still shown." : ""}`;
      status.textContent = failureMessage;
      confirmStatus.textContent = failureMessage;
      if (deleted) dialog.close();
    } finally {
      for (const item of deletedItems) item.row.remove();
      for (const card of new Set(items.map((item) => item.card))) {
        if (card.querySelectorAll(".media-copy-row").length < 2) card.remove();
      }
      deleting = false;
      scanButton.disabled = false;
      updateSelection();
      confirmText.disabled = false;
      confirmButton.textContent = "Delete files";
      cancelButton.disabled = false;
      if (dialog.open) {
        updateConfirmation();
        if (failureMessage) confirmStatus.textContent = failureMessage;
      }
    }
  }
  function openBulkDeleteDialog() {
    const items = [];
    const keepPaths = new Set();
    for (const card of list.querySelectorAll(".media-duplicate-group")) {
      const boxes = [...card.querySelectorAll('input[type="checkbox"]')];
      const keep = boxes.find((box) => !box.checked && box.dataset.pathAvailable === "true");
      if (!keep) continue;
      for (const box of boxes.filter((candidate) => candidate.checked)) {
        items.push({ id: box.value, keepId: keep.value, path: box.dataset.path, row: box.closest(".media-copy-row"), card });
      }
      if (boxes.some((box) => box.checked)) keepPaths.add(keep.dataset.path);
    }
    if (!items.length) return;
    pendingItems = items;
    el("#media-delete-selected-summary").textContent = `${items.length} files selected across ${keepPaths.size} duplicate groups.`;
    const paths = el("#media-delete-paths");
    paths.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item.path;
      return li;
    }));
    const keeps = el("#media-keep-paths");
    keeps.replaceChildren(...[...keepPaths].map((path) => {
      const li = document.createElement("li");
      li.textContent = path;
      return li;
    }));
    confirmText.value = "";
    confirmText.disabled = false;
    cancelButton.disabled = false;
    updateConfirmation();
    dialog.showModal();
    confirmText.focus();
  }
  confirmText.addEventListener("input", updateConfirmation);
  confirmButton.addEventListener("click", () => void deletePending());
  bulkDeleteButton.addEventListener("click", openBulkDeleteDialog);
  el("#media-delete-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { pendingItems = []; });
  dialog.addEventListener("cancel", (event) => { if (deleting) event.preventDefault(); });
  deleteForm.addEventListener("submit", (event) => event.preventDefault());
  scanButton.addEventListener("click", () => void scan());
  document.querySelector('[data-manage-section="media-management"]')?.addEventListener("click", () => {
    if (!list.childElementCount && status.textContent.startsWith("Scan the")) void scan();
  });
}
