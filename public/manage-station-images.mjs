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

export function wireStationImages({ el }) {
  let stationImage = "";
  let removeImage = false;
  let previewUrl = "";

  async function optimize(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const optimized = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!optimized || optimized.type !== "image/webp") throw new Error("This browser could not optimize the logo as WebP.");
    return optimized;
  }

  async function upload(optimized) {
    const response = await fetch("/api/station-images", { method: "POST", headers: { "Content-Type": "image/webp" }, body: optimized });
    if (!response.ok) throw await stationImageApiError(response, "Logo upload failed.");
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw await stationImageApiError(response, "Logo upload failed.");
    const result = await response.json();
    return result.image;
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
      const optimized = await optimize(await response.blob());
      stationImage = await upload(optimized);
      removeImage = false;
      el("#station-image").value = "";
      revokePreview();
      previewUrl = URL.createObjectURL(optimized);
      showPreview(previewUrl);
      status.textContent = "Logo copied locally and optimized.";
    } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  el("#find-station-logo").addEventListener("click", () => {
    let website = el("#station-website").value.trim();
    if (!website) { el("#station-logo-status").textContent = "Enter the station website first."; return; }
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    importLogo({ website });
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
      el("#station-logo-status").textContent = "Find a logo on the station website or copy one from an image URL.";
      el("#remove-station-image").hidden = true;
    },
    edit(image) {
      stationImage = image || "";
      if (stationImage) showPreview(stationImage);
    },
    image() { return removeImage ? "" : stationImage; },
    async uploadFile(file) { return upload(await optimize(file)); }
  };
}
