export function wireManageUpdates({ request, el }) {
  const updateDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "unknown";
  const technicalDetails = el("#update-details");
  const errorDetails = el("#update-error");
  function showTechnicalError(error) {
    if (errorDetails) errorDetails.textContent = error?.message || String(error);
    if (technicalDetails) technicalDetails.hidden = false;
  }
  function clearTechnicalError() {
    if (errorDetails) errorDetails.textContent = "";
    if (technicalDetails) technicalDetails.hidden = true;
  }

  async function checkForUpdates() {
    const button = el("#check-update");
    const install = el("#install-update");
    const message = el("#update-message");
    button.disabled = true;
    install.hidden = true;
    clearTechnicalError();
    message.textContent = "Checking GitHub for the latest release…";
    try {
      const info = await request("/api/update");
      el("#app-version").textContent = `Version ${info.currentVersion} · code updated ${updateDate(info.buildDate)}`;
      if (info.updateAvailable) {
        message.textContent = `Version ${info.latestVersion} is available · released ${updateDate(info.latestDate)}.`;
        install.hidden = !info.canInstall;
        if (!info.canInstall) message.textContent += " Install the server updater to enable one-click updates.";
      } else {
        message.textContent = "You have the latest version.";
      }
      return info;
    } catch (error) {
      message.textContent = "Could not check for updates. Try again later.";
      showTechnicalError(error);
      return null;
    } finally { button.disabled = false; }
  }

  async function watchUpdate(version) {
    const message = el("#update-message");
    const install = el("#install-update");
    const until = Date.now() + 360_000;
    install.disabled = true;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        const state = await request("/api/update/status");
        if (state.state === "failed" && (!state.version || state.version === version)) {
          message.textContent = "The update failed. See technical details for more information.";
          showTechnicalError(state.message || "The server reported an unspecified update failure.");
          install.disabled = false;
          return;
        }
        if (state.state === "complete" && state.version === version) {
          await checkForUpdates();
          message.textContent = `Updated to ${version}.`;
          install.disabled = false;
          window.setTimeout(() => window.location.reload(), 1500);
          return;
        }
        message.textContent = "Installing update. MyMusics will restart automatically…";
      } catch (error) {
        message.textContent = "MyMusics is restarting. Waiting for it to come back…";
        showTechnicalError(error);
      }
    }
    message.textContent = "The update is taking longer than expected. Reload the page and check the version.";
    install.disabled = false;
  }

  el("#check-update").addEventListener("click", checkForUpdates);
  el("#install-update").addEventListener("click", async () => {
    if (!window.confirm("Download and install the latest release? MyMusics will restart; playback may stop briefly.")) return;
    const install = el("#install-update");
    install.disabled = true;
    el("#update-message").textContent = "Starting the update…";
    try {
      const result = await request("/api/update", "POST", {});
      await watchUpdate(result.version);
    } catch (error) {
      el("#update-message").textContent = "Could not start the update. Try again later.";
      showTechnicalError(error);
      install.disabled = false;
    }
  });

  return { checkForUpdates, watchUpdate };
}
