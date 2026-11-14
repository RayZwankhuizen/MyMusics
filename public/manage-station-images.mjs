export async function stationImageApiError(response, fallback) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    const body = await response.text();
    if (response.status === 404 || response.status === 405 || /<!doctype\s+html|<html\b/i.test(body)) {
      return new Error("This MyMusics server does not have the logo import API. Restart the updated server and reload this page.");
    }
    return new Error(`${fallback} (HTTP ${response.status}).`);
  }
  try {
    const result = await response.json();
    return new Error(result.error || fallback);
  } catch { return new Error(fallback); }
}

export async function optimizeStationLogo(blob) {
  let source;
  let objectUrl = "";
  try {
    try { source = await createImageBitmap(blob); }
    catch {
      // Image elements can decode SVG and icon formats that createImageBitmap rejects.
      objectUrl = URL.createObjectURL(blob);
      source = new Image();
      source.src = objectUrl;
      await source.decode();
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) throw new Error("The logo has no usable image dimensions.");
    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const optimized = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (optimized?.type !== "image/webp") throw new Error("This browser could not optimize the logo as WebP.");
    return optimized;
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function wireStationImages({ el }) {
  let stationImage = "";
  let removeImage = false;
  let previewUrl = "";


  async function upload(optimized) {
    const response = await fetch("/api/station-images", { method: "POST", headers: { "Content-Type": "image/webp" }, body: optimized });
    if (!response.ok) throw await stationImageApiError(response, "Logo upload failed.");
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw await stationImageApiError(response, "Logo upload failed.");
    const result = await response.json();
    return result.image;
  }

  async function findAndUpload(source, signal) {
    const response = await fetch("/api/station-images/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automatic: true, ...source }),
      signal
    });
    if (!response.ok) throw await stationImageApiError(response, "Could not find the logo.");
    return upload(await optimizeStationLogo(await response.blob()));
  }

  function revokePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  function showPreview(source) {
    el("#station-image-preview").src = source;
    el("#station-image-preview").hidden = false;
    el("#remove-station-image").hidden = false;
  }

  async function importLogo(source) {
    const status = el("#station-logo-status");
    const buttons = [el("#find-station-logo"), el("#use-station-logo-url")];
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = "Finding and optimizing logo…";
    try {
      const response = await fetch("/api/station-images/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source) });
      if (!response.ok) throw await stationImageApiError(response, "Could not find the logo.");
      const optimized = await optimizeStationLogo(await response.blob());
      stationImage = await upload(optimized);
      removeImage = false;
      el("#station-image").value = "";
      revokePreview();
      previewUrl = URL.createObjectURL(optimized);
      showPreview(previewUrl);
      status.textContent = "Logo copied locally as WebP (max. 512 pixels). Save the station to keep it.";
    } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  el("#find-station-logo").addEventListener("click", () => {
    let website = el("#station-website").value.trim();
    const name = el("#station-name").value.trim();
    let url = el("#station-url").value.trim();
    if (!website && !name && !url) { el("#station-logo-status").textContent = "Enter the station name or stream URL first."; return; }
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    importLogo({ automatic: true, name, url, website });
  });
  el("#use-station-logo-url").addEventListener("click", () => {
    const imageUrl = el("#station-logo-url").value.trim();
    if (!imageUrl) { el("#station-logo-status").textContent = "Enter a direct logo image URL."; return; }
    importLogo({ imageUrl });
  });
  el("#station-image").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    revokePreview();
    previewUrl = URL.createObjectURL(file);
    showPreview(previewUrl);
    removeImage = false;
  });
  el("#remove-station-image").addEventListener("click", () => {
    stationImage = "";
    removeImage = true;
    el("#station-image").value = "";
    el("#station-image-preview").hidden = true;
    el("#remove-station-image").hidden = true;
  });

  return {
    reset() {
      revokePreview();
      stationImage = "";
      removeImage = false;
      el("#station-image").value = "";
      el("#station-image-preview").hidden = true;
      el("#station-image-preview").removeAttribute("src");
      el("#station-logo-url").value = "";
      el("#station-logo-status").textContent = "Find a logo automatically using the station name and stream URL.";
      el("#remove-station-image").hidden = true;
    },
    edit(image) {
      stationImage = image || "";
      if (stationImage) showPreview(stationImage);
    },
    image() { return removeImage ? "" : stationImage; },
    findAndUpload,
    async uploadFile(file) { return upload(await optimizeStationLogo(file)); }
  };
}
