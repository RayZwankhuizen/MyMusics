export function wireManageStreamFinder({ el, request }) {
  let activePreviewButton = null;
  let previewHls = null;
  let previewGeneration = 0;
  let hlsLoadPromise = null;
  let previewReject = null;

  function stopPreview() {
    previewGeneration++;
    previewReject?.(new Error("Preview stopped.")); previewReject = null;
    previewHls?.destroy(); previewHls = null;
    const audio = el("#stream-preview");
    audio.pause(); audio.removeAttribute("src"); audio.load(); audio.hidden = true;
    if (activePreviewButton) { activePreviewButton.textContent = "Preview"; activePreviewButton.setAttribute("aria-pressed", "false"); }
    activePreviewButton = null;
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoadPromise) return hlsLoadPromise;
    hlsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => { script.remove(); hlsLoadPromise = null; reject(new Error("HLS preview timed out.")); }, 10000);
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
      script.onload = () => { clearTimeout(timeout); if (window.Hls) resolve(window.Hls); else { hlsLoadPromise = null; reject(new Error("HLS preview is unavailable.")); } };
      script.onerror = () => { clearTimeout(timeout); hlsLoadPromise = null; reject(new Error("HLS preview is unavailable.")); };
      document.head.append(script);
    });
    return hlsLoadPromise;
  }

  el("#stream-finder").addEventListener("toggle", (event) => {
    if (event.currentTarget.open && !el("#stream-search-name").value) el("#stream-search-name").value = el("#station-name").value.trim();
  });
  el("#stream-search-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); el("#stream-search-button").click(); }
  });

  el("#stream-search-button").addEventListener("click", async () => {
    const name = el("#stream-search-name").value.trim();
    const status = el("#stream-search-status");
    const results = el("#stream-search-results");
    const button = el("#stream-search-button");
    if (name.length < 2) { status.textContent = "Enter at least two characters of the station name."; return; }
    stopPreview();
    results.replaceChildren();
    status.textContent = "Searching for available streams…";
    button.disabled = true;
    try {
      const found = await request(`/api/stream-search?${new URLSearchParams({ name })}`);
      if (!found.length) { status.textContent = "No online streams found. Try another station name."; return; }
      status.textContent = `${found.length} stream${found.length === 1 ? "" : "s"} found. Preview and select one to fill the stream fields.`;
      found.forEach((stream) => {
        const row = document.createElement("article"); row.className = "stream-result";
        const details = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = stream.name;
        const metadata = document.createElement("small");
        metadata.textContent = [stream.country, stream.codec, stream.bitrate ? `${stream.bitrate} kbps` : "Bitrate unknown", stream.clickcount ? `${stream.clickcount.toLocaleString()} directory clicks` : ""].filter(Boolean).join(" · ");
        const url = document.createElement("code"); url.textContent = stream.url;
        details.append(title, metadata, url);
        const actions = document.createElement("div"); actions.className = "stream-result-actions";
        const preview = document.createElement("button"); preview.type = "button"; preview.className = "small-button"; preview.textContent = "Preview"; preview.setAttribute("aria-pressed", "false");
        preview.setAttribute("aria-label", `Preview ${stream.name}`);
        preview.addEventListener("click", async () => {
          const audio = el("#stream-preview");
          if (activePreviewButton === preview && !audio.paused) { stopPreview(); status.textContent = "Preview stopped."; return; }
          stopPreview();
          const generation = previewGeneration;
          activePreviewButton = preview;
          audio.hidden = false;
          preview.disabled = true;
          try {
            if (stream.type === "hls" && !audio.canPlayType("application/vnd.apple.mpegurl")) {
              const Hls = await loadHls();
              if (generation !== previewGeneration) return;
              if (!Hls.isSupported()) throw new Error("HLS preview is unsupported in this browser.");
              previewHls = new Hls(); previewHls.loadSource(stream.url); previewHls.attachMedia(audio);
              await new Promise((resolve, reject) => {
                const finish = (done, value) => { clearTimeout(timeout); if (previewReject === cancel) previewReject = null; done(value); };
                const cancel = () => finish(reject, new Error("Preview stopped."));
                const timeout = setTimeout(() => finish(reject, new Error("HLS stream did not start.")), 15000);
                previewReject = cancel;
                previewHls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().then(() => finish(resolve), (error) => finish(reject, error)));
                previewHls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) finish(reject, new Error("HLS stream could not be played.")); });
              });
            } else { audio.src = stream.url; await audio.play(); }
            if (generation !== previewGeneration) return;
            preview.textContent = "Stop preview"; preview.setAttribute("aria-pressed", "true");
            status.textContent = `Previewing ${stream.name}.`;
          } catch {
            if (generation === previewGeneration) { stopPreview(); status.textContent = `Could not play ${stream.name}. Try another stream.`; }
          } finally { preview.disabled = false; }
        });
        const use = document.createElement("button"); use.type = "button"; use.className = "small-button"; use.textContent = "Use stream";
        use.setAttribute("aria-label", `Use ${stream.name} stream`);
        use.addEventListener("click", () => {
          stopPreview();
          el("#station-url").value = stream.url;
          el("#station-type").value = stream.type;
          if (!el("#station-name").value.trim()) el("#station-name").value = stream.name;
          if (!el("#station-website").value.trim() && stream.website) el("#station-website").value = stream.website;
          status.textContent = `Selected ${stream.name}. Save the station to keep this stream.`;
          el("#station-url").focus();
        });
        actions.append(preview, use); row.append(details, actions); results.append(row);
      });
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });

  return {
    stopPreview,
    reset() {
      stopPreview();
      el("#stream-search-name").value = "";
      el("#stream-search-status").textContent = "";
      el("#stream-search-results").replaceChildren();
      el("#stream-finder").open = false;
    }
  };
}
