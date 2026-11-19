const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
let server;
let browser;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.static(path.join(root, "public")));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("management updates show available release and surface check errors", async () => {
  const page = await browser.newPage();
  let updateChecks = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/update") {
      updateChecks++;
      if (updateChecks === 1) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            currentVersion: "1.0.0",
            buildDate: "2026-11-08",
            latestVersion: "1.1.0",
            latestDate: "2026-11-07",
            updateAvailable: true,
            canInstall: true
          })
        });
      } else {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Release check unavailable." }) });
      }
      return;
    }
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html#updates`);
  await page.waitForFunction(() => document.querySelector("#app-version")?.textContent.includes("Version 1.0.0"));
  assert.match(await page.locator("#update-message").textContent(), /Version 1\.1\.0 is available/);
  assert.equal(await page.locator("#install-update").isVisible(), true);

  await page.locator("#check-update").click();
  await page.waitForFunction(() => document.querySelector("#update-message")?.textContent === "Could not check for updates. Try again later.");
  assert.equal(await page.locator("#update-details").isVisible(), true);
  assert.equal(await page.locator("#update-error").textContent(), "Release check unavailable.");
  assert.equal(await page.locator("#check-update").isDisabled(), false);
  await page.close();
});

test("management uses a genre master-detail view and confirms genre deletion by name", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
  });
  const deleted = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name: "Test FM", url: "https://radio.example/live", type: "mp3" }], Rock: [] }) });
      return;
    }
    if (url.pathname === "/api/update") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ currentVersion: "1.0.0", updateAvailable: false }) });
      return;
    }
    if (url.pathname === "/api/genres/Jazz" && request.method() === "DELETE") {
      deleted.push(url.pathname);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Rock: [] }) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html`);
  await page.getByRole("heading", { name: "Management" }).waitFor();
  assert.equal(await page.locator("#manage-genres .manage-genre").count(), 2);
  assert.equal(await page.locator("#station-dialog").isVisible(), false);
  assert.equal(await page.locator("#organize-genre").count(), 0);
  assert.equal(await page.locator(".design-topbar").count(), 0);
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-preview-status]")?.textContent === "Testing Test FM.");
  assert.match(await page.locator("#station-list audio").getAttribute("src"), /radio\.example\/live/);
  await page.getByRole("button", { name: "Stop test" }).click();
  await page.waitForFunction(() => document.querySelector("#station-list audio")?.hidden === true);
  await page.locator(".danger-zone summary").click();
  await page.locator("#delete-genre").click();
  assert.equal(await page.locator("#genre-delete-cancel").evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator("#genre-delete-confirm").isDisabled(), true);
  await page.locator("#genre-delete-confirm-name").fill("Jazz");
  assert.equal(await page.locator("#genre-delete-confirm").isDisabled(), false);
  await page.locator("#genre-delete-confirm").click();
  await page.waitForFunction(() => document.querySelector("#stations-heading")?.textContent === "Rock");
  assert.deepEqual(deleted, ["/api/genres/Jazz"]);
  await page.goto(`${baseUrl}/manage.html?tv=1`);
  await page.waitForSelector("#tv-manage-notice");
  assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("tv-mode")), true);
  assert.equal(await page.locator("#tv-manage-notice").isVisible(), true);
  await page.close();
});

test("radio and music maintenance share one page and old playlist links redirect there", async () => {
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [] }) });
      return;
    }
    if (url.pathname === "/api/update") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ currentVersion: "1.0.0", updateAvailable: false }) });
      return;
    }
    if (url.pathname === "/api/music/playlists") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ playlists: [{ id: "road-mix", name: "Road Mix", trackCount: 1 }] }) });
      return;
    }
    if (url.pathname === "/api/music/playlists/road-mix") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ playlist: { id: "road-mix", name: "Road Mix", tracks: [{ id: "track-1", title: "Open Road", album: "Drive" }] } }) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html?playlist=road-mix#playlists`);
  await page.locator("#playlist-tracks .station-row").waitFor();
  assert.equal(new URL(page.url()).pathname, "/manage.html");
  assert.equal(await page.locator("#stations").count(), 1);
  assert.equal(await page.locator("#playlists").count(), 1);
  assert.equal(await page.locator("#playlist-tracks").textContent().then((text) => text.includes("Open Road")), true);

  await page.goto(`${baseUrl}/music-manage.html?playlist=road-mix`);
  await page.waitForFunction(() => location.pathname === "/manage.html" && location.hash === "#playlists");
  assert.equal(new URL(page.url()).searchParams.get("playlist"), "road-mix");
  await page.close();
});

test("station-name search lets the user add a station to an existing genre", async () => {
  const page = await browser.newPage();
  const requests = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name: "Existing", url: "https://radio.example/existing" }], "NL - Rock": [] }) });
      return;
    }
    if (url.pathname === "/api/update") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ currentVersion: "1.0.0", updateAvailable: false }) });
      return;
    }
    if (url.pathname === "/api/station-search") {
      requests.push({ path: url.pathname, query: url.searchParams.toString() });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([
        { name: "Existing", url: "https://radio.example/existing", type: "mp3", country: "NL", tags: "jazz" },
        { name: "40rock", url: "https://radio.example/live.m3u8", type: "hls", website: "https://radio.example", country: "NL", tags: "rock" }
      ]) });
      return;
    }
    if (url.pathname === "/api/genres/NL%20-%20Rock/stations" && request.method() === "POST") {
      requests.push({ path: url.pathname, body: request.postDataJSON() });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name: "Existing", url: "https://radio.example/existing" }], "NL - Rock": [{ name: "40rock", url: "https://radio.example/live.m3u8" }] }) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html`);
  await page.locator('#station-search-form input[name="countrycode"]').fill("nl");
  await page.locator('#station-search-form input[name="tag"]').fill("40rock");
  await page.locator("#station-search-form button").click();
  const results = page.locator("#station-search-results");
  await results.getByRole("button", { name: "Add station", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a station" });
  await editor.waitFor();
  assert.equal(await editor.getByLabel("Station name", { exact: true }).first().inputValue(), "40rock");
  assert.equal(await editor.getByLabel("Stream URL", { exact: true }).inputValue(), "https://radio.example/live.m3u8");
  assert.equal(await editor.getByLabel("Stream type").inputValue(), "hls");
  const destination = editor.getByLabel("Genre", { exact: true });
  assert.equal(await destination.inputValue(), "Jazz");
  await destination.selectOption("NL - Rock");
  assert.equal(await results.getByRole("button", { name: "In Jazz", exact: true }).isDisabled(), true);
  assert.equal(requests.length, 1, "opening the editor does not add the station");
  await editor.getByRole("button", { name: "Add station", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent === "Station added.");
  assert.equal(await results.getByRole("button", { name: "In NL - Rock", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("#stations-heading").textContent(), "NL - Rock");
  assert.deepEqual(requests, [
    { path: "/api/station-search", query: "countrycode=NL&tag=40rock" },
    { path: "/api/genres/NL%20-%20Rock/stations", body: { name: "40rock", url: "https://radio.example/live.m3u8", type: "hls", website: "https://radio.example", speechVolumePercent: 30, speechReleaseDelaySeconds: 3, genre: "NL - Rock", image: "" } }
  ]);
  await page.close();
});

test("station logos are found, optimized, uploaded, and saved with a station", async () => {
  const page = await browser.newPage();
  const requests = [];
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [] }) });
      return;
    }
    if (url.pathname === "/api/update") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ currentVersion: "1.0.0", updateAvailable: false }) });
      return;
    }
    if (url.pathname === "/api/station-images/find") {
      requests.push({ path: url.pathname, body: request.postDataJSON() });
      await route.fulfill({ contentType: "image/png", body: image });
      return;
    }
    if (url.pathname === "/api/station-images") {
      const bytes = request.postDataBuffer();
      requests.push({ path: url.pathname, contentType: request.headers()["content-type"], signature: bytes.subarray(0, 4).toString("ascii"), format: bytes.subarray(8, 12).toString("ascii") });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ image: "/station-images/local-logo.webp" }) });
      return;
    }
    if (url.pathname === "/api/genres/Jazz/stations" && request.method() === "POST") {
      requests.push({ path: url.pathname, body: request.postDataJSON() });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name: "Test Radio", url: "https://radio.example/live", website: "https://radio.example", speechReleaseDelaySeconds: request.postDataJSON().speechReleaseDelaySeconds, image: "/station-images/local-logo.webp" }] }) });
      return;
    }
    if (url.pathname === "/api/genres/Jazz/stations/0" && request.method() === "PUT") {
      requests.push({ path: url.pathname, body: request.postDataJSON() });
      const { name, url: streamUrl, website, type, speechVolumePercent, speechReleaseDelaySeconds, image } = request.postDataJSON();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name, url: streamUrl, website, type, speechVolumePercent, speechReleaseDelaySeconds, ...(image ? { image } : {}) }] }) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html`);
  await page.locator("#add-station").click();
  await page.locator("#station-name").fill("Test Radio");
  await page.locator("#station-url").fill("radio.example/live");
  await page.locator("#station-website").fill("radio.example");
  assert.equal(await page.locator("#speech-release-delay").inputValue(), "3");
  await page.locator("#speech-release-delay").fill("5");
  await page.locator("#find-station-logo").click();
  await page.waitForFunction(() => document.querySelector("#station-logo-status")?.textContent === "Logo copied locally as WebP (max. 512 pixels). Save the station to keep it.");
  await page.locator('#station-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent === "Station added.");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("#station-name").fill("Discard this change");
  await page.mouse.click(2, 2);
  await page.locator("#station-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Edit" }).click();
  assert.equal(await page.locator("#station-name").inputValue(), "Test Radio");
  await page.locator("#station-image").setInputFiles({ name: "radio-logo.png", mimeType: "image/png", buffer: image });
  await page.locator('#station-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent === "Station updated.");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("#remove-station-image").click();
  await page.locator('#station-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector("#notice")?.textContent === "Station updated.");
  assert.deepEqual(requests, [
    { path: "/api/station-images/find", body: { automatic: true, name: "Test Radio", url: "https://radio.example/live", website: "https://radio.example" } },
    { path: "/api/station-images", contentType: "image/webp", signature: "RIFF", format: "WEBP" },
    { path: "/api/genres/Jazz/stations", body: {
      name: "Test Radio", url: "https://radio.example/live", website: "radio.example", type: "mp3", speechVolumePercent: 30, speechReleaseDelaySeconds: 5, genre: "Jazz", image: "/station-images/local-logo.webp"
    } },
    { path: "/api/station-images", contentType: "image/webp", signature: "RIFF", format: "WEBP" },
    { path: "/api/genres/Jazz/stations/0", body: {
      name: "Test Radio", url: "https://radio.example/live", website: "https://radio.example", type: "mp3", speechVolumePercent: 30, speechReleaseDelaySeconds: 5, genre: "Jazz", image: "/station-images/local-logo.webp"
    } },
    { path: "/api/genres/Jazz/stations/0", body: {
      name: "Test Radio", url: "https://radio.example/live", website: "https://radio.example", type: "mp3", speechVolumePercent: 30, speechReleaseDelaySeconds: 5, genre: "Jazz", image: ""
    } }
  ]);
  await page.close();
});

test("stream search previews HLS and fills the station stream fields", async () => {
  const page = await browser.newPage();
  const searches = [];
  await page.addInitScript(() => {
    window.Hls = class {
      static Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
      static isSupported() { return true; }
      constructor() { this.handlers = {}; window.testManageHls = this; }
      loadSource(url) { this.url = url; }
      attachMedia(audio) { this.audio = audio; }
      on(event, callback) { this.handlers[event] = callback; if (event === "manifest") setTimeout(callback, 0); }
      destroy() { this.destroyed = true; }
    };
    HTMLMediaElement.prototype.canPlayType = () => "";
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/stations") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [] }) });
      return;
    }
    if (url.pathname === "/api/update") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ currentVersion: "1.0.0", updateAvailable: false }) });
      return;
    }
    if (url.pathname === "/api/stream-search") {
      searches.push({ name: url.searchParams.get("name"), countrycode: url.searchParams.get("countrycode") });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([
        { name: "Test FM", url: "https://radio.example/live.m3u8", type: "hls", website: "https://radio.example", country: "NL", codec: "AAC", bitrate: 128, clickcount: 25 },
        { name: "Test MP3", url: "https://radio.example/live.mp3", type: "mp3", website: "https://radio.example", country: "NL", codec: "MP3", bitrate: 128, clickcount: 10 }
      ]) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/manage.html`);
  await page.locator("#add-station").click();
  await page.locator("#station-name").fill("Test Radio");
  await page.locator("#stream-finder summary").click();
  await page.locator("#stream-search-name").waitFor();
  await page.waitForFunction(() => document.querySelector("#stream-search-name")?.value === "Test Radio");
  await page.locator("#stream-search-country").fill("nl");
  await page.locator("#stream-search-country").press("Enter");
  const preview = page.locator('#stream-search-results button[aria-label="Preview Test FM"]');
  await preview.waitFor();
  await preview.click();
  await page.waitForFunction(() => document.querySelector('#stream-search-results button[aria-label="Preview Test FM"]')?.textContent === "Stop preview");
  assert.equal(await page.evaluate(() => window.testManageHls.url), "https://radio.example/live.m3u8");
  await preview.click();
  await page.waitForFunction(() => document.querySelector("#stream-search-status")?.textContent === "Preview stopped.");
  const mp3Preview = page.locator('#stream-search-results button[aria-label="Preview Test MP3"]');
  await mp3Preview.click();
  await page.waitForFunction(() => document.querySelector("#stream-search-status")?.textContent === "Previewing Test MP3.");
  assert.equal(await page.locator("#stream-preview").getAttribute("src"), "https://radio.example/live.mp3");
  await mp3Preview.click();
  await page.waitForFunction(() => document.querySelector("#stream-search-status")?.textContent === "Preview stopped.");
  await page.locator("#stream-search-name").fill("");
  await page.locator("#stream-search-button").click();
  await page.getByRole("button", { name: "Use Test FM stream" }).click();
  assert.deepEqual(searches, [{ name: "Test Radio", countrycode: "NL" }, { name: "", countrycode: "NL" }]);
  assert.equal(await page.locator("#station-url").inputValue(), "https://radio.example/live.m3u8");
  assert.equal(await page.locator("#station-type").inputValue(), "hls");
  assert.equal(await page.locator("#station-website").inputValue(), "https://radio.example");
  assert.equal(await page.locator("#station-name").inputValue(), "Test Radio");
  assert.equal(await page.locator("#stream-preview").isHidden(), true);
  await page.close();
});
