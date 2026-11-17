const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const path = require("node:path");
const { chromium } = require("playwright");
let server, browser, base;

test.before(async () => {
  const app = express();
  app.use(express.static(path.resolve(__dirname, "../public")));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
});
test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function setup(t, { host = false, waitForLoad } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const calls = [], errors = [];
  let status = { activeType: "", videoId: "", decks: { a: { time: 0, paused: true, playing: false } } };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((useHost) => {
    localStorage.setItem("mymusics:playback-target", useHost ? "host" : "browser");
    window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5, ENDED: 0 },
      Player: class {
        constructor(_id, options) {
          this.options = options; this.state = -1; this.time = 0; this.rate = 1; this.id = "";
          window.testYoutube = this;
          queueMicrotask(() => options.events.onReady({ target: this }));
        }
        getVideoData() { return { video_id: this.id, title: `Video ${this.id}`, author: "Test artist" }; }
        getPlayerState() { return this.state; }
        getCurrentTime() { return this.time; }
        getPlaybackRate() { return this.rate; }
        getPlaylist() { return []; }
        mute() { this.muted = true; }
        unMute() { this.muted = false; }
        emit(state) { this.state = state; this.options.events.onStateChange({ data: state }); }
        cueVideoById(id) { this.id = id; this.time = 0; this.emit(5); }
        loadVideoById(id) { this.id = id; this.time = 0; this.emit(1); }
        playVideo() { this.emit(1); }
        pauseVideo() { this.emit(2); }
        stopVideo() { this.emit(0); }
        clearVideo() { this.id = ""; }
      }
    };
  }, host);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    let data = {};
    if (url.pathname === "/api/host-player/mpv") data = { installed: true, youtubeResolverInstalled: true };
    if (url.pathname === "/api/videos/status") data = { searchAvailable: true, metadataAvailable: true };
    if (url.pathname === "/api/videos/playlists") data = { playlists: [] };
    if (url.pathname === "/api/videos/details") data = { videos: url.searchParams.get("ids").split(",").map((id) => ({ id, durationSeconds: 245 })) };
    if (["/api/videos/search", "/api/videos/search-playlists"].includes(url.pathname)) {
      const second = url.searchParams.has("pageToken");
      data = { results: Array.from({ length: second ? 3 : 10 }, (_, i) => ({
        id: `video${String(i + (second ? 9 : 0)).padStart(6, "0")}`, title: `Result ${i + (second ? 9 : 0)}`, artist: "Artist",
        thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23465a7a'/%3E%3C/svg%3E"
      })), nextPageToken: second ? null : "NEXT_PAGE" };
    }
    if (url.pathname === "/api/host-player/video") {
      if (waitForLoad) await waitForLoad();
      status = { activeType: "video", videoId: body.videoId, decks: { a: { time: body.startSeconds, paused: body.paused, playing: !body.paused } } };
      data = { sessionId: "test-session" };
    }
    if (url.pathname === "/api/host-player/status") data = status;
    if (url.pathname === "/api/host-player/control") {
      if (body.action === "seek") status.decks.a.time = body.value;
      if (body.action === "pause") { status.decks.a.paused = true; status.decks.a.playing = false; }
      if (body.action === "resume") { status.decks.a.paused = false; status.decks.a.playing = true; }
      if (body.action === "stop") status.activeType = "";
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(`${base}/youtube.html`);
  await page.waitForFunction(() => document.querySelector("#video-status").textContent.includes("ready"));
  return { page, calls, errors, status: () => status };
}

async function waitUntil(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Expected host command did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("YouTube prepares host audio while the image is cued, then synchronizes transport and seeking", async (t) => {
  let releaseLoad;
  const load = new Promise((resolve) => { releaseLoad = resolve; });
  const h = await setup(t, { host: true, waitForLoad: () => load });
  const { page } = h;
  await page.locator("#video-playlist-url").fill("https://www.youtube.com/watch?v=abcdefghijk");
  await page.locator('#video-load-playlist button[type="submit"]').click();
  await waitUntil(() => h.calls.some((c) => c.path.endsWith("/video")));
  assert.ok([2, 5].includes(await page.evaluate(() => testYoutube.state)));
  assert.equal(h.calls.find((c) => c.path.endsWith("/video")).body.paused, true);
  releaseLoad();
  await waitUntil(() => h.calls.some((c) => c.body?.action === "resume"));
  assert.equal(await page.evaluate(() => testYoutube.state), 1);
  await page.evaluate(() => testYoutube.emit(3));
  await waitUntil(() => h.status().decks.a.paused);
  await page.evaluate(() => { testYoutube.time = 42; testYoutube.emit(1); });
  await waitUntil(() => h.status().decks.a.time >= 42 && !h.status().decks.a.paused);
  await page.evaluate(() => { testYoutube.rate = 1.5; testYoutube.options.events.onPlaybackRateChange(); });
  await waitUntil(() => h.calls.some((c) => c.body?.action === "speed" && c.body.value === 1.5));
  await page.selectOption("#playback-target", "browser");
  await waitUntil(() => h.calls.some((c) => c.body?.action === "stop"));
  assert.equal(await page.evaluate(() => testYoutube.muted), false);
  assert.deepEqual(h.errors, []);
});

test("YouTube search and queue modals enlarge live lists and search beyond ten results", async (t) => {
  const { page, calls, errors } = await setup(t);
  await page.locator("#open-video-search").click();
  const dialog = page.locator("#video-search-dialog");
  assert.equal(await dialog.isVisible(), true);
  await dialog.locator("#video-query").fill("artist");
  await dialog.locator('#video-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll("#video-results li").length === 10);
  await dialog.getByRole("button", { name: "Search more", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("#video-results li").length === 12);
  assert.equal(calls.filter((c) => c.path === "/api/videos/search").at(-1).query.pageToken, "NEXT_PAGE");
  assert.equal(await dialog.locator("#video-search-more").isVisible(), false);
  await page.screenshot({ path: "/tmp/mymusics-youtube-search-modal.png" });
  const first = dialog.locator("#video-results li").first();
  assert.ok((await first.locator("img").boundingBox()).width >= 190);
  assert.equal(await first.locator(".item-duration").textContent(), "4:05");
  await first.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("#video-results-home #video-results li").length === 12);
  await page.locator("#open-video-queue").click();
  assert.equal(await page.locator("#video-queue-dialog #video-queue li").count(), 1);
  assert.equal(await page.locator("#video-queue-dialog .item-duration").textContent(), "4:05");
  assert.ok((await page.locator('#video-queue-dialog #video-queue button').first().boundingBox()).height >= 48);
  await page.screenshot({ path: "/tmp/mymusics-youtube-queue-modal.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#video-queue-dialog").isVisible(), false);
  await page.waitForFunction(() => document.querySelectorAll("#video-queue-home #video-queue li").length === 1);
  assert.equal(await page.locator("#open-video-queue").evaluate((el) => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/mymusics-youtube-expanded.png", fullPage: true });
});

test("YouTube playlist searches also paginate and the expanded view fits a narrow screen", async (t) => {
  const { page, calls } = await setup(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#open-video-search").click();
  await page.locator("#video-playlist-query").fill("jazz playlist");
  await page.locator('#video-playlist-search button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll("#video-results li").length === 10);
  await page.locator("#video-search-more").click();
  await page.waitForFunction(() => document.querySelectorAll("#video-results li").length === 12);
  assert.equal(calls.filter((c) => c.path === "/api/videos/search-playlists").at(-1).query.pageToken, "NEXT_PAGE");
  await page.screenshot({ path: "/tmp/mymusics-youtube-mobile-modal.png" });
  const dialog = await page.locator("#video-search-dialog").boundingBox();
  assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 390);
  assert.equal(await page.locator("#video-search-dialog").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    document.documentElement.classList.add("silk-browser", "tv-mode");
    window.dispatchEvent(new Event("mymusics:tv-mode-change"));
  });
  const tvDialog = await page.locator("#video-search-dialog").boundingBox();
  assert.ok(tvDialog.x >= 0 && tvDialog.x + tvDialog.width <= 1280);
  assert.ok((await page.locator("#video-search-dialog #video-results img").first().boundingBox()).width >= 190);
  await page.keyboard.press("Escape");
  await page.locator("#video-search-dialog").waitFor({ state: "hidden" });
});
