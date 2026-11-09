export function wireManageJellyfinSettings({ el, request }) {
  const form = el("#jellyfin-settings-form");
  const url = el("#jellyfin-url");
  const apiKey = el("#jellyfin-api-key");
  const userId = el("#jellyfin-user-id");
  const badge = el("#jellyfin-config-badge");
  const status = el("#jellyfin-settings-status");
  const testButton = el("#jellyfin-test");
  const setState = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };

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

  load();
}
