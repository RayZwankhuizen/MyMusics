import { detectBrowser } from "./browser-info.mjs";

(() => {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  const footer = document.createElement("div");
  footer.className = "sidebar-version";
  footer.innerHTML = '<span data-version></span><time></time><span data-browser></span>';
  const version = footer.querySelector("[data-version]");
  const date = footer.querySelector("time");
  footer.querySelector("[data-browser]").textContent = `Browser: ${detectBrowser(navigator.userAgent || "").name}`;
  sidebar.append(footer);

  fetch("/app-info.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((info) => {
    if (!info) return removeBuildInfo();
    version.textContent = `Version ${info.version}`;
    if (!info.date) return date.remove();
    date.dateTime = info.date;
    date.textContent = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(info.date));
  }).catch(removeBuildInfo);

  function removeBuildInfo() { version.remove(); date.remove(); }

})();
