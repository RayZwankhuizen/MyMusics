(() => {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  const footer = document.createElement("div");
  footer.className = "sidebar-version";
  footer.innerHTML = '<span data-version></span><time></time>';
  sidebar.append(footer);

  fetch("/app-info.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((info) => {
    if (!info) return footer.remove();
    footer.querySelector("[data-version]").textContent = `Version ${info.version}`;
    const date = footer.querySelector("time");
    if (!info.date) return date.remove();
    date.dateTime = info.date;
    date.textContent = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(info.date));
  }).catch(() => footer.remove());
})();
