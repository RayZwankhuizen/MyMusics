/* TV interaction layer. Playback and page state remain in their feature modules. */
(() => {
  const key = "mymusics:tv-mode";
  const focusKey = `mymusics:focus:${location.pathname}`;
  const focusable = 'a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  const directions = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };
  const path = location.pathname;
  const isRadio = path === "/" || path.endsWith("index.html");
  const isMusic = path.endsWith("music.html");
  const pages = path.endsWith("help.html")
    ? { title: "Help", detail: "MyMusics guide", links: [["Radio", "/"], ["Management", "/manage.html"]] }
    : { title: "Management", detail: path.endsWith("music-manage.html") ? "Playlists" : "Stations and settings", links: [["Stations", "/manage.html#stations"], ["Playlists", "/manage.html#playlists"], ["Updates", "/manage.html#updates"], ["Help", "/help.html"]] };

  function setTvMode(enabled, persist = true) {
    document.documentElement.classList.toggle("tv-mode", enabled);
    const toggle = document.querySelector("#tv-mode-toggle");
    toggle?.setAttribute("aria-pressed", String(enabled));
    if (toggle) toggle.textContent = `TV mode ${enabled ? "On" : "Off"}`;
    if (persist) try { localStorage.setItem(key, String(enabled)); } catch {}
    window.dispatchEvent(new Event("mymusics:tv-mode-change"));
  }
  function addToggle() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar || document.querySelector("#tv-mode-toggle")) return;
    const button = document.createElement("button");
    button.id = "tv-mode-toggle";
    button.className = "tv-mode-toggle";
    button.type = "button";
    button.setAttribute("aria-pressed", String(document.documentElement.classList.contains("tv-mode")));
    button.textContent = `TV mode ${document.documentElement.classList.contains("tv-mode") ? "On" : "Off"}`;
    button.addEventListener("click", () => setTvMode(!document.documentElement.classList.contains("tv-mode")));
    sidebar.append(button);
  }
  function addContextHeader() {
    const main = document.querySelector("main");
    if (!main || isRadio || isMusic || path.endsWith("manage.html") || path.endsWith("music-manage.html")) return;
    const header = document.createElement("header");
    header.className = "design-topbar";
    header.innerHTML = `<div class="design-page-status"><span class="design-live-dot" aria-hidden="true"></span><div><p>${pages.detail}</p><span class="design-page-title">${pages.title}</span></div></div><nav aria-label="Screen shortcuts">${pages.links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav>`;
    main.prepend(header);
    header.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      if (target.matches("button")) { event.preventDefault(); target.click(); }
      else if (target.matches("dialog")) {
        event.preventDefault();
        if (target.showModal) target.showModal();
        else target.setAttribute("open", "");
        requestAnimationFrame(() => target.querySelector("input,button")?.focus());
      } else if (target.matches("input,select,textarea")) { event.preventDefault(); target.focus(); }
    }));
    const status = document.querySelector("#player-status");
    if (status) {
      const label = header.querySelector(".design-page-status p");
      const update = () => { label.textContent = status.textContent.trim() || pages.detail; };
      update();
      new MutationObserver(update).observe(status, { childList: true, characterData: true, subtree: true });
    }
  }

  const visible = (node) => {
    if (node.closest('[hidden],[inert]')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
  };
  function moveFocus(direction) {
    const scope = document.querySelector("dialog[open]") || document;
    const nodes = [...scope.querySelectorAll(focusable)].filter(visible);
    const current = document.activeElement;
    if (!nodes.length) return;
    if (!nodes.includes(current)) return (document.querySelector('[data-tv-autofocus]') || nodes[0]).focus();
    const box = current.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const candidates = nodes.filter((node) => node !== current).map((node) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const primary = direction === "right" ? rect.left - box.right : direction === "left" ? box.left - rect.right : direction === "down" ? rect.top - box.bottom : box.top - rect.bottom;
      const cross = direction === "right" || direction === "left" ? Math.abs(y - cy) : Math.abs(x - cx);
      return { node, score: Math.max(0, primary) + cross * 2.5, primary };
    }).filter(({ primary }) => primary >= -2).sort((a, b) => a.score - b.score);
    const next = candidates[0]?.node;
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function dispatchAction(action) {
    window.dispatchEvent(new CustomEvent("mymusics:media-action", { detail: action }));
  }

  addToggle();
  addContextHeader();
  window.addEventListener("pagehide", () => {
    const active = document.activeElement;
    if (!active || !document.contains(active)) return;
    const token = active.id ? `#${CSS.escape(active.id)}` : active.dataset.genre ? `[data-genre="${CSS.escape(active.dataset.genre)}"]` : active.dataset.favorites ? "[data-favorites]" : active.getAttribute("href") ? `a[href="${CSS.escape(active.getAttribute("href"))}"]` : "";
    if (token) try { sessionStorage.setItem(focusKey, token); } catch {}
  });
  if (document.documentElement.classList.contains("tv-mode")) {
    let token = "";
    try { token = sessionStorage.getItem(focusKey) || ""; } catch {}
    const previous = token && document.querySelector(token);
    (previous && visible(previous) ? previous : document.querySelector("[data-tv-autofocus]") || document.querySelector(isRadio ? "#genres button" : isMusic ? "#jb-search-open" : "main button,main a[href]"))?.focus({ preventScroll: true });
    const genres = isRadio && document.querySelector("#genres");
    if (genres && !genres.querySelector("button") && document.activeElement === document.body) {
      new MutationObserver((_, observer) => {
        const firstGenre = genres.querySelector("button");
        if (!firstGenre || document.activeElement !== document.body) return;
        firstGenre.focus({ preventScroll: true });
        observer.disconnect();
      }).observe(genres, { childList: true, subtree: true });
    }
  }
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target.matches('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),select');
    if (document.documentElement.classList.contains("tv-mode") && directions[event.key] && !typing && !target.matches('input[type="range"],input[type="checkbox"],input[type="radio"]')) {
      event.preventDefault();
      if (isRadio && target.closest(".radio-player-controls") && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        dispatchAction(event.key === "ArrowUp" ? "next" : "previous");
        return;
      }
      moveFocus(directions[event.key]);
      return;
    }
    if (["Escape", "Backspace", "BrowserBack", "GoBack", "Back"].includes(event.key)) {
      if (event.key !== "Escape" && (typing || target.isContentEditable)) return;
      const outputOptions = document.querySelector(".tv-playback-options:not([hidden])");
      if (event.key !== "Backspace" && outputOptions) {
        event.preventDefault();
        outputOptions.hidden = true;
        const outputButton = document.querySelector(".tv-playback-current");
        outputButton?.setAttribute("aria-expanded", "false");
        outputButton?.focus();
        return;
      }
      const dialog = document.querySelector("dialog[open]");
      if (dialog) { event.preventDefault(); dialog.close(); return; }
      if (document.documentElement.classList.contains("tv-mode")) { event.preventDefault(); history.back(); }
      return;
    }
    if (typing || event.target.isContentEditable) return;
    if ([" ", "MediaPlayPause"].includes(event.key)) { event.preventDefault(); dispatchAction("toggle"); }
    else if (event.key === "MediaTrackNext") { event.preventDefault(); dispatchAction("next"); }
    else if (event.key === "MediaTrackPrevious") { event.preventDefault(); dispatchAction("previous"); }
    else if (["MediaFastForward", "MediaRewind"].includes(event.key)) { event.preventDefault(); dispatchAction(event.key === "MediaFastForward" ? "forward" : "rewind"); }
    else if (["f", "F"].includes(event.key)) document.querySelector("[data-fav-current]")?.click();
    else if (!document.querySelector("dialog[open]") && ["s", "S"].includes(event.key)) document.querySelector("[data-open-search]")?.click();
  });
})();
