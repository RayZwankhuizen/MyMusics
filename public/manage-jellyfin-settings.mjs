export function wireManageJellyfinSettings({ el, request }) {
  const form = el("#jellyfin-settings-form");
  const url = el("#jellyfin-url");
  const apiKey = el("#jellyfin-api-key");
  const userId = el("#jellyfin-user-id");
  const badge = el("#jellyfin-config-badge");
  const status = el("#jellyfin-settings-status");
  const testButton = el("#jellyfin-test");
  const mpvStatus = el("#mpv-install-status");
  const checkMpvButton = el("#check-mpv");
  const installMpvButton = el("#install-mpv");
  let installingMpv = false;
  const setState = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };

  function showMpv(settings) {
    installMpvButton.disabled = settings.installed || !settings.canInstall || settings.installing || installingMpv;
    if (settings.installed) {
      mpvStatus.textContent = `MPV is installed on this host${settings.version ? ` (${settings.version})` : ""}. Host audio is available.`;
      mpvStatus.classList.remove("error");
    } else if (settings.installing || installingMpv) {
      mpvStatus.textContent = "MyMusics is restarting and installing MPV on the host…";
      mpvStatus.classList.remove("error");
    } else if (settings.canInstall) {
      mpvStatus.textContent = settings.error || "MPV is not installed. Install it on the Ubuntu host to enable host audio.";
      mpvStatus.classList.toggle("error", Boolean(settings.failed));
    } else {
      mpvStatus.textContent = "MPV is not installed, and host installation is not configured on this server.";
      mpvStatus.classList.add("error");
    }
  }

  async function checkMpv() {
    checkMpvButton.disabled = true;
    try {
      const settings = await request("/api/host-player/mpv");
      showMpv(settings);
      return settings;
    } catch (error) {
      mpvStatus.textContent = error.message;
      mpvStatus.classList.add("error");
      installMpvButton.disabled = true;
      return null;
    } finally {
      checkMpvButton.disabled = installingMpv;
    }
  }

  async function installMpv() {
    let finalMessage = "";
    let finalError = false;
    installingMpv = true;
    checkMpvButton.disabled = true;
    installMpvButton.disabled = true;
    mpvStatus.textContent = "Requesting MPV installation. MyMusics will restart…";
    mpvStatus.classList.remove("error");
    try {
      await request("/api/host-player/mpv/install", "POST", {});
      const deadline = Date.now() + 20 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try {
          const settings = await request("/api/host-player/mpv");
          if (settings.installed) {
            showMpv(settings);
            finalMessage = "MPV is installed. MyMusics host audio is available on the Radio and Music pages.";
            try { localStorage.setItem("mymusics:mpv-installed", String(Date.now())); } catch {}
            return;
          }
          if (!settings.installing) {
            showMpv({ ...settings, failed: true });
            finalMessage = "MPV installation did not complete. Check the host’s package repositories and system log, then retry.";
            finalError = true;
            return;
          }
          showMpv(settings);
        } catch {
          mpvStatus.textContent = "MyMusics is restarting while MPV installs. Waiting for it to return…";
          mpvStatus.classList.remove("error");
        }
      }
      finalMessage = "MPV installation is taking longer than expected. Check Manage again shortly.";
      finalError = true;
    } catch (error) {
      finalMessage = error.message;
      finalError = true;
    } finally {
      installingMpv = false;
      checkMpvButton.disabled = false;
      await checkMpv();
      if (finalMessage) {
        mpvStatus.textContent = finalMessage;
        mpvStatus.classList.toggle("error", finalError);
      }
    }
  }

  async function load() {
    try {
      const settings = await request("/api/settings/jellyfin");
      url.value = settings.url || "";
      userId.value = settings.userId || "";
      badge.textContent = settings.configured ? "Configured" : "Not configured";
      setState(settings.configured ? "Jellyfin settings are loaded. Test the connection to check access." : "Enter the Jellyfin URL and API key to enable Music mode.");
    } catch (error) {
      badge.textContent = "Unavailable";
      setState(error.message, true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setState("Saving Jellyfin settings…");
    try {
      const settings = await request("/api/settings/jellyfin", "PUT", {
        url: url.value.trim(), apiKey: apiKey.value, userId: userId.value.trim()
      });
      apiKey.value = "";
      badge.textContent = settings.configured ? "Configured" : "Not configured";
      setState(settings.configured ? "Settings saved. Test the connection to confirm Jellyfin is reachable." : "Settings saved, but both a URL and API key are needed.");
      url.value = settings.url || "";
      userId.value = settings.userId || "";
    } catch (error) {
      setState(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    setState("Testing Jellyfin connection…");
    try {
      await request("/api/settings/jellyfin/test", "POST", {});
      badge.textContent = "Connected";
      setState("Connected to Jellyfin. Music mode is ready.");
    } catch (error) {
      badge.textContent = "Connection failed";
      setState(error.message, true);
    } finally {
      testButton.disabled = false;
    }
  });

  checkMpvButton.addEventListener("click", checkMpv);
  installMpvButton.addEventListener("click", installMpv);

  load();
  checkMpv();
}
