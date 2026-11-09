export function createRadioMetadataView({ list, count, summary, streamInfo, getTrackKey, getMetadataKey, renderSuppression, setMetadataBlockSuppressed, classify }) {
  document.querySelector("#metadata-close").addEventListener("click", () => document.querySelector("#metadata-dialog").close());
  list.addEventListener("click", (event) => {
    const button = event.target.closest(".metadata-suppress-toggle");
    if (button) setMetadataBlockSuppressed(button.dataset.metadataKey, button.getAttribute("aria-pressed") !== "true");
  });

  function createBlock(data, source, trackKey, blockKey) {
    const item = document.createElement("li");
    item.className = "metadata-block";
    item.dataset.source = source;
    item.dataset.trackKey = trackKey || "";
    item.dataset.receivedAt = String(Date.parse(data.receivedAt));
    item.dataset.metadataKey = blockKey;
    const heading = document.createElement("div");
    heading.className = "metadata-block-heading";
    const label = document.createElement("span");
    label.textContent = `${source} · ${new Date(data.receivedAt).toLocaleTimeString()}${Number.isFinite(data.blockBytes) ? ` · ${data.blockBytes} bytes` : ""}`;
    heading.append(label);
    const badge = document.createElement("span");
    const hint = classify(data);
    badge.className = `metadata-kind ${hint.kind}`;
    badge.textContent = hint.label;
    badge.title = hint.reason;
    badge.setAttribute("aria-label", `${hint.label}. ${hint.reason}`);
    heading.append(badge);
    const status = document.createElement("span");
    status.className = "metadata-suppression-status";
    status.setAttribute("aria-label", "Metadata suppression status");
    heading.append(status);
    const toggle = document.createElement("button");
    toggle.className = "metadata-suppress-toggle";
    toggle.type = "button";
    toggle.dataset.metadataKey = blockKey;
    heading.append(toggle);
    renderSuppression(toggle, blockKey);
    const raw = document.createElement("pre");
    raw.textContent = data.raw || "No raw payload.";
    item.append(heading, raw);
    const fields = Object.entries(data.fields || {});
    if (fields.length) {
      const parsed = document.createElement("div");
      parsed.className = "metadata-fields";
      for (const [key, value] of fields) {
        const field = document.createElement("span");
        field.textContent = `${key}: ${value}`;
        parsed.append(field);
      }
      item.append(parsed);
    }
    return item;
  }

  function append(data) {
    if (data.blockBytes === 0) return;
    const source = data.source || "ICY BLOCK";
    const trackKey = getTrackKey(data.fields || {});
    const pairedSource = source === "TRACK UPDATE" ? "ICY BLOCK" : "TRACK UPDATE";
    const paired = trackKey && [...list.querySelectorAll(".metadata-block")].reverse().find((item) =>
      item.dataset.source === pairedSource && item.dataset.trackKey === trackKey &&
      Math.abs(Date.parse(data.receivedAt) - Number(item.dataset.receivedAt)) < 5000);
    if (source === "ICY BLOCK" && paired) return;
    const followTail = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
    if (source === "TRACK UPDATE") paired?.remove();
    list.querySelector(".metadata-empty")?.remove();
    list.append(createBlock(data, source, trackKey, getMetadataKey(data.fields, data.raw)));
    while (list.children.length > 200) list.firstElementChild.remove();
    count.textContent = `${list.querySelectorAll(".metadata-block").length} blocks`;
    if (followTail) list.scrollTop = list.scrollHeight;
  }

  function reset(station) {
    summary.textContent = station ? "Connecting…" : "Waiting for station";
    streamInfo.textContent = station ? `${station.name} · ${station.url}` : "Select a station to inspect its metadata stream.";
    count.textContent = "0 blocks";
    list.replaceChildren(Object.assign(document.createElement("li"), {
      className: "metadata-empty",
      textContent: station ? "Waiting for metadata blocks…" : "Metadata blocks will appear here as they arrive."
    }));
  }

  function setMonitorStatus(status) {
    if (status.reconnecting) {
      summary.textContent = "Reconnecting…";
      return;
    }
    summary.textContent = status.connected ? "Receiving" : `Reconnecting · ${status.message || "connection lost"}`;
    if (status.connected) {
      const headers = Object.entries(status.headers || {}).map(([key, value]) => `${key}: ${value}`);
      headers.unshift(`ICY interval: ${status.interval} bytes`);
      streamInfo.replaceChildren(...headers.map((value) => Object.assign(document.createElement("span"), { textContent: value })));
    }
  }

  return Object.freeze({
    append,
    reset,
    setConnected() { summary.textContent = "Connected · waiting for stream"; },
    setMonitorStatus
  });
}
