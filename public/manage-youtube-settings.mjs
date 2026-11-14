export function wireManageYouTubeSettings({ el, request }) {
  const form = el("#youtube-settings-form");
  const apiKey = el("#youtube-api-key");
  const badge = el("#youtube-config-badge");
  const status = el("#youtube-settings-status");
  const testButton = el("#youtube-test");
  const clearButton = el("#youtube-clear");

  function show(settings, message) {
    badge.textContent = settings.configured ? `Configured · ${settings.source}` : "Not configured";
    testButton.disabled = !settings.configured;
    clearButton.hidden = settings.source !== "Manage";
    status.textContent = message || (settings.configured
      ? "YouTube search and playlist details are ready."
      : "Add a YouTube Data API v3 key to enable search and playlist details.");
  }

  async function load() {
    try { show(await request("/api/settings/youtube")); }
    catch (error) { show({ configured: false, source: "None" }, error.message); }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = "Saving YouTube API key…";
    try {
      const settings = await request("/api/settings/youtube", "PUT", { apiKey: apiKey.value });
      apiKey.value = "";
      show(settings, "YouTube API settings saved.");
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    status.textContent = "Testing YouTube Data API key…";
    try {
      await request("/api/settings/youtube/test", "POST", {});
      status.textContent = "YouTube Data API key is valid.";
    } catch (error) { status.textContent = error.message; }
    finally { testButton.disabled = false; }
  });

  clearButton.addEventListener("click", async () => {
    clearButton.disabled = true;
    status.textContent = "Removing saved YouTube API key…";
    try {
      show(await request("/api/settings/youtube", "DELETE"), "Saved YouTube API key removed.");
    } catch (error) { status.textContent = error.message; }
    finally { clearButton.disabled = false; }
  });

  load();
}
