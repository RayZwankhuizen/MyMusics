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

async function assertEqualizerHelpers(page) {
  const result = await page.evaluate(() => {
    const quiet = new Uint8Array(32);
    const loud = new Uint8Array(32).fill(255);
    const container = document.querySelector("#equalizer-bands");
    const preset = document.querySelector("#equalizer-preset");
    const filters = Array.from({ length: 5 }, () => ({ gain: { value: 0 } }));
    const drawing = {
      fills: 0, strokes: 0, globalCompositeOperation: "", shadowBlur: 0,
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { this.fills++; }, stroke() { this.strokes++; }
    };
    window.MyMusicsEqualizer.applyPreset("rock", container, () => filters, preset);
    const rock = [...container.querySelectorAll("input")].map((input) => input.value);
    const filterGains = filters.map(({ gain }) => gain.value);
    const frameCanvas = {
      width: 0, height: 0,
      getBoundingClientRect: () => ({ width: 20, height: 40 }),
      getContext: () => drawing
    };
    const phase = window.MyMusicsEqualizer.drawFrame({
      canvas: frameCanvas,
      analyser: { frequencyBinCount: 32, getByteFrequencyData: (data) => data.fill(255) },
      sampleRate: 44_100,
      sensitivity: 1.8,
      playing: true,
      phase: 0
    });
    const gainChanges = [];
    const powerButton = document.querySelector("#equalizer-power");
    const audioGraph = {
      context: { currentTime: 3 },
      dryGain: { gain: { setTargetAtTime: (...values) => gainChanges.push(["dry", ...values]) } },
      wetGain: { gain: { setTargetAtTime: (...values) => gainChanges.push(["wet", ...values]) } }
    };
    window.MyMusicsEqualizer.setEnabled(audioGraph, powerButton, true);
    window.MyMusicsEqualizer.setEnabled(audioGraph, powerButton, false);
    const edges = [];
    let filterNumber = 0;
    const node = (name) => ({
      name, gain: { value: 0 }, frequency: { value: 0 }, Q: { value: 0 },
      connect(target) { edges.push([name, target.name]); return target; }
    });
    const graph = window.MyMusicsEqualizer.createGraph({
      destination: { name: "destination" },
      createMediaElementSource: (media) => node(media),
      createAnalyser: () => node("analyser"),
      createGain: () => node(`gain-${edges.length}`),
      createBiquadFilter: () => node(`filter-${filterNumber++}`)
    }, ["a", "b"], (index) => index - 2);
    return {
      quiet: window.MyMusicsEqualizer.bandLevels(quiet, 22_050, 1.8, true),
      paused: window.MyMusicsEqualizer.bandLevels(loud, 22_050, 1.8, false),
      loud: window.MyMusicsEqualizer.bandLevels(loud, 22_050, 1.8, true),
      bandCount: container.querySelectorAll(".equalizer-band").length,
      rock,
      filterGains,
      preset: preset.value,
      drawing: [drawing.fills, drawing.strokes, drawing.globalCompositeOperation, drawing.shadowBlur],
      frame: [frameCanvas.width, frameCanvas.height, phase],
      power: [powerButton.getAttribute("aria-pressed"), powerButton.textContent, gainChanges],
      graph: [graph.analyser.fftSize, graph.analyser.minDecibels, graph.analyser.maxDecibels,
        graph.analyser.smoothingTimeConstant, graph.dryGain.gain.value, graph.wetGain.gain.value,
        graph.filters.map(({ type, frequency, Q, gain }) => [type, frequency.value, Q.value, gain.value]), edges.length]
    };
  });
  assert.deepEqual(result, {
    quiet: [0, 0, 0], paused: [0, 0, 0], loud: [1, 1, 1], bandCount: 5,
    rock: ["4", "2", "-1", "2", "4"], filterGains: [4, 2, -1, 2, 4], preset: "rock",
    drawing: [3, 3, "source-over", 0], frame: [20, 40, 0.018],
    power: ["false", "EQ Off", [
      ["dry", 0, 3, 0.025], ["wet", 1, 3, 0.025],
      ["dry", 1, 3, 0.025], ["wet", 0, 3, 0.025]
    ]],
    graph: [2048, -85, -25, 0.72, 0, 1, [
      ["lowshelf", 100, 0, -2], ["peaking", 250, 0.8, -1], ["peaking", 1000, 0.8, 0],
      ["peaking", 4000, 0.8, 1], ["highshelf", 10000, 0, 2]
    ], 17]
  });
}

test("music search form submits a query and renders its result", async () => {
  const page = await browser.newPage();
  const queries = [];
  let refreshRequests = 0;
  let refreshStatusRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/refresh") {
      refreshRequests++;
      if (refreshRequests === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Refresh denied." }) });
        return;
      }
    }
    if (url.pathname === "/api/music/refresh/status") {
      refreshStatusRequests++;
      body = refreshStatusRequests === 1
        ? { available: true, running: true, progress: 42 }
        : { available: true, running: false };
    }
    if (url.pathname === "/api/music/search") {
      const query = url.searchParams.get("q") || "";
      const type = url.searchParams.get("type") || "all";
      queries.push({ query, type });
      body = {
        type,
        results: query === "test song" ? [{
          id: "track-1", kind: "track", title: "Test Song", artist: "Test Artist", album: "Test Album", durationMs: 1_500
        }] : []
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await assertEqualizerHelpers(page);
  assert.equal(await page.evaluate(() => typeof window.MyMusicsPlayback?.isHost), "boolean");
  const infoDialog = page.locator("#jb-search-dialog");
  await infoDialog.evaluate((dialog) => dialog.showModal());
  await infoDialog.evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: box.right + 1, clientY: box.bottom + 1 }));
  });
  assert.equal(await infoDialog.evaluate((dialog) => dialog.open), false);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");

  await page.locator("#music-results .music-result-row strong").waitFor();
  assert.ok(queries.some(({ query, type }) => query === "test song" && type === "track"));
  assert.equal(await page.locator("#music-results .music-result-row strong").innerText(), "Test Song");
  await page.locator("#music-results .music-result-row").getByRole("button", { name: "Add to queue" }).click();
  assert.equal(await page.locator("#queue-list .track-line-duration").innerText(), "0:02");
  await page.locator("#music-search-type").selectOption("artist");
  await page.waitForFunction(() => document.querySelector("#music-search-status").textContent === "1 result");
  assert.ok(queries.some(({ query, type }) => query === "test song" && type === "artist"));
  await page.locator("#music-search-clear").click();
  assert.equal(await page.locator("#music-search").inputValue(), "");
  assert.equal(await page.evaluate(() => document.activeElement.id), "music-search");
  assert.ok(queries.some(({ query, type }) => query === "" && type === "artist"));
  const emptyArtistSearches = queries.filter(({ query, type }) => query === "" && type === "artist").length;
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  await page.waitForFunction(() => document.querySelector("#music-search-status").textContent === "1 result");
  await page.locator("#music-search").fill("");
  await page.waitForFunction(() => document.querySelector("#music-search-status").textContent === "Nothing matched.");
  assert.equal(queries.filter(({ query, type }) => query === "" && type === "artist").length, emptyArtistSearches + 1);
  await page.locator("#info-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#info-close").click();
  assert.equal(await page.locator("#info-dialog").evaluate((dialog) => dialog.open), false);
  await page.locator("#left-search-close").click();
  assert.equal(await page.locator("#left-search-dialog").evaluate((dialog) => dialog.open), false);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.mouse.click(1, 1);
  assert.equal(await page.locator("#left-search-dialog").evaluate((dialog) => dialog.open), false);
  await page.locator("#equalizer-panel").evaluate((dialog) => dialog.showModal());
  await page.locator("#eq-toggle").evaluate((button) => button.setAttribute("aria-expanded", "true"));
  await page.locator("#equalizer-close").click();
  await page.waitForFunction(() => !document.querySelector("#equalizer-panel").open
    && document.querySelector("#eq-toggle").getAttribute("aria-expanded") === "false");
  await page.locator("#equalizer-panel").evaluate((dialog) => dialog.showModal());
  await page.locator("#equalizer-sensitivity").evaluate((input) => {
    input.value = "2.4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await page.locator("#equalizer-sensitivity-value").innerText(), "2.4×");
  await page.locator("#audio").evaluate((audio) => audio.dispatchEvent(new Event("waiting")));
  assert.equal(await page.locator("#player-status").textContent(), "BUFFERING");
  await page.locator("#equalizer-panel").evaluate((dialog) => dialog.close());
  await page.locator("#music-refresh").click();
  await page.waitForFunction(() => document.querySelector("#music-toolbar-status").textContent === "Refresh denied.");
  assert.equal(await page.locator("#music-refresh").isDisabled(), false);
  await page.locator("#music-refresh").click();
  await page.waitForFunction(() => document.querySelector("#music-toolbar-status").textContent === "Jellyfin library refresh complete.");
  assert.equal(await page.locator("#music-refresh-progress").isVisible(), false);
  assert.equal(await page.locator("#music-refresh").isDisabled(), false);
  assert.equal(new URL(page.url()).pathname, "/music.html");
  await page.close();
});

test("queue avoids duplicate tracks and Empty queue keeps the active track playing", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      this.dataset.pauseCount = String(Number(this.dataset.pauseCount || 0) + 1);
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/search") {
      const query = url.searchParams.get("q") || "";
      body = {
        results: query === "test song" ? [
          { id: "track-1", kind: "track", title: "Test Song", artist: "Test Artist", album: "Test Album", durationMs: 180_000 },
          { id: "track-2", kind: "track", title: "Second Song", artist: "Test Artist", album: "Test Album", durationMs: 210_000 }
        ] : []
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  await page.locator("#music-results .music-result-row").nth(1).waitFor();

  const results = page.locator("#music-results .music-result-row");
  const firstAdd = results.nth(0).locator(".station-actions button").first();
  const secondAdd = results.nth(1).locator(".station-actions button").first();
  await firstAdd.click();
  await firstAdd.click();
  assert.equal(await page.locator("#queue-list .station-row").count(), 1);
  await secondAdd.click();
  assert.equal(await page.locator("#queue-list .station-row").count(), 2);

  await page.locator("#left-search-close").click();
  await page.locator("#jb-play-a").click();
  await page.waitForFunction(() => document.querySelector("#jb-title").textContent === "Test Song");
  const audio = page.locator("#audio");
  assert.equal(await audio.getAttribute("data-playing"), "true");
  const pauseCount = await audio.getAttribute("data-pause-count");

  await page.locator("#queue-empty").click();
  assert.equal(await page.locator("#queue-list .station-row").count(), 0);
  assert.equal(await page.locator("#jb-title").textContent(), "Test Song");
  assert.equal(await audio.getAttribute("data-playing"), "true");
  assert.equal(await audio.getAttribute("data-pause-count"), pauseCount);
  await page.close();
});

test("queue actions reorder and remove tracks", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let body = {};
      if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
      if (url.pathname === "/api/music/playlists") body = { playlists: [] };
      if (url.pathname === "/api/music/search") {
        body = {
          results: (url.searchParams.get("q") || "") === "test song" ? [1, 2].map((number) => ({
            id: `track-${number}`, kind: "track", title: number === 1 ? "Test Song" : "Second Song",
            artist: "Test Artist", album: "Test Album", durationMs: 180_000
          })) : []
        };
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    await page.goto(`${baseUrl}/music.html`);
    await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
    await page.locator("#music-search-type").selectOption("track");
    await page.locator("#music-search").fill("test song");
    await page.locator("#music-search").press("Enter");
    const results = page.locator("#music-results .music-result-row");
    await results.nth(1).waitFor();
    for (let index = 0; index < 2; index++) {
      await results.nth(index).locator(".station-actions button").first().click();
    }
    await page.locator("#left-search-close").click();

    const rows = page.locator("#queue-list .station-row");
    const titles = page.locator("#queue-list .track-line-title");
    await rows.nth(1).getByRole("button", { name: "Move Second Song up" }).click();
    assert.deepEqual(await titles.allTextContents(), ["Second Song", "Test Song"]);
    await rows.nth(0).getByRole("button", { name: "Move Second Song down" }).click();
    assert.deepEqual(await titles.allTextContents(), ["Test Song", "Second Song"]);
    await rows.nth(1).getByRole("button", { name: "Remove" }).click();
    assert.deepEqual(await titles.allTextContents(), ["Test Song"]);
  } finally {
    await page.close();
  }
});

test("jukebox search submits the active rack and renders results", async () => {
  const page = await browser.newPage();
  const queries = [];
  try {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let body = {};
      if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
      if (url.pathname === "/api/music/playlists") body = { playlists: [] };
      if (url.pathname === "/api/music/info") body = { info: {
        kind: "album", title: "Jukebox Album", tracks: [
          { id: "album-track", kind: "track", title: "Album Track", artist: "Rack Artist", album: "Jukebox Album", durationMs: 180_000 }
        ]
      } };
      if (url.pathname === "/api/music/search") {
        const query = url.searchParams.get("q") || "";
        const type = url.searchParams.get("type") || "all";
        queries.push({ query, type });
        body = {
          results: query === "jukebox song" ? [
            { id: "jukebox-track", kind: "track", title: "Jukebox Song", artist: "Rack Artist", album: "Rack Album", durationMs: 180_000 }
          ] : query === "jukebox album" ? [
            { id: "jukebox-album", kind: "album", title: "Jukebox Album", artist: "Rack Artist" }
          ] : []
        };
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    await page.goto(`${baseUrl}/music.html`);
    await page.locator("#jb-search-open").click();
    await page.locator('#jb-tv-keyboard [data-search-key="b"]').click();
    assert.equal(await page.locator("#jb-search").inputValue(), "b");
    await page.locator("#jb-search-clear").click();
    assert.equal(await page.locator("#jb-search").inputValue(), "");
    await page.locator('#jb-search-dialog .jb-tab[data-rack="tracks"]').click();
    await page.locator("#jb-search").fill("jukebox song");
    await page.locator("#jb-search").press("Enter");
    await page.locator("#jb-rack-list .jb-strip").waitFor();
    assert.ok(queries.some(({ query, type }) => query === "jukebox song" && type === "track"));
    assert.match(await page.locator("#jb-rack-list").innerText(), /Jukebox Song/);
    await page.locator('#jb-search-dialog .jb-tab[data-rack="albums"]').click();
    await page.locator("#jb-search").fill("jukebox album");
    await page.locator("#jb-search").press("Enter");
    await page.locator(".jb-search-result-album .jb-strip").click();
    await page.locator("#jb-search-back").waitFor({ state: "visible" });
    await page.locator("#jb-rack-list .jb-strip").waitFor();
    await page.locator("#jb-search-back").click();
    await page.waitForFunction(() => document.querySelector("#jb-search-heading").textContent === "Search my music"
      && document.querySelector("#jb-rack-list").textContent.includes("Jukebox Album"));
    await page.locator('#jb-search-dialog .jb-tab[data-rack="tracks"]').click();
    await page.locator("#jb-search").fill("debounced query");
    await page.waitForFunction(() => document.querySelector("#jb-search-feedback").textContent === "No matches found.");
    assert.ok(queries.some(({ query, type }) => query === "debounced query" && type === "track"));
    await page.locator("#jb-search-close").click();
    assert.equal(await page.locator("#jb-search-dialog").evaluate((dialog) => dialog.open), false);
  } finally {
    await page.close();
  }
});

test("manual deck switching is direct and automatic next starts a crossfade", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/search") {
      body = {
        results: (url.searchParams.get("q") || "") === "test song" ? [1, 2, 3].map((number) => ({
          id: `track-${number}`, kind: "track", title: `Test Song ${number}`, artist: "Test Artist", album: "Test Album", durationMs: 180_000
        })) : []
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  const results = page.locator("#music-results .music-result-row");
  await results.nth(2).waitFor();
  for (let index = 0; index < 3; index++) {
    await results.nth(index).locator(".station-actions button").first().click();
  }

  await page.locator("#left-search-close").click();
  await page.locator("#jb-crossfade").click();
  await page.locator("#jb-play-a").click();
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "true");
  await page.locator("#jb-pause-a").click();
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "false");
  await page.locator("#jb-play-a").click();
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "true");
  await page.locator("#jb-play-b").click();
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "false"
    && document.querySelector("#audio2").dataset.playing === "true");
  assert.equal(await page.locator("#jb-title-b").textContent(), "Test Song 2");
  assert.equal(await page.locator("#audio2").evaluate((audio) => audio.volume), 1);

  await page.locator("#jb-crossfade").click();
  const fadeStarted = page.evaluate(() => new Promise((resolve) => {
    const audio = document.querySelector("#audio");
    const onVolumeChange = () => {
      if (audio.volume >= 1) return;
      audio.removeEventListener("volumechange", onVolumeChange);
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      audio.removeEventListener("volumechange", onVolumeChange);
      resolve(false);
    }, 5000);
    audio.addEventListener("volumechange", onVolumeChange);
  }));
  await page.locator("#audio2").evaluate((audio) => audio.dispatchEvent(new Event("ended")));
  assert.equal(await fadeStarted, true, "incoming deck should fade in");
  await page.waitForFunction(() => document.querySelector("#jb-title").textContent === "Test Song 3"
    && document.querySelector("#audio").dataset.playing === "true"
    && document.querySelector("#audio2").dataset.playing === "true");
  assert.equal(await page.locator("#audio2").getAttribute("data-playing"), "true");
  await page.close();
});

test("failed deck playback restores the previous active track", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      if (this.dataset.failNextPlay) {
        delete this.dataset.failNextPlay;
        return Promise.reject(new Error("Playback denied."));
      }
      this.dataset.playing = "true";
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/search") {
      body = {
        results: (url.searchParams.get("q") || "") === "test song" ? [1, 2].map((number) => ({
          id: `track-${number}`, kind: "track", title: `Test Song ${number}`, artist: "Test Artist", album: "Test Album", durationMs: 180_000
        })) : []
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  const results = page.locator("#music-results .music-result-row");
  await results.nth(1).waitFor();
  for (let index = 0; index < 2; index++) {
    await results.nth(index).locator(".station-actions button").first().click();
  }
  await page.locator("#left-search-close").click();
  await page.locator("#jb-play-a").click();
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "true");

  await page.locator("#audio2").evaluate((audio) => { audio.dataset.failNextPlay = "true"; });
  await page.locator("#jb-play-b").click();
  await page.waitForFunction(() => document.querySelector("#player-status").textContent === "PRESS PLAY TO LISTEN");
  assert.equal(await page.locator("#jb-title").textContent(), "Test Song 1");
  assert.equal(await page.locator("#audio").getAttribute("data-playing"), "true");
  assert.equal(await page.locator("#audio2").getAttribute("data-playing"), "false");
  await page.close();
});

test("host playback sends the deck contract and updates the jukebox", async () => {
  const page = await browser.newPage();
  const hostRequests = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/search") {
      body = {
        results: (url.searchParams.get("q") || "") === "test song" ? [
          { id: "track-host", kind: "track", title: "Host Song", artist: "Host Artist", album: "Host Album", durationMs: 180_000 }
        ] : []
      };
    }
    if (url.pathname === "/api/host-player/mpv") body = { installed: true, version: "mpv test", canInstall: false };
    if (url.pathname === "/api/host-player/status") body = { activeDeck: "a", decks: { a: {}, b: {} } };
    if (url.pathname === "/api/host-player/music") hostRequests.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await page.waitForFunction(() => !document.querySelector('#playback-target option[value="host"]').disabled);
  await page.locator("#playback-target").selectOption("host");
  await page.waitForFunction(() => window.MyMusicsPlayback.isHost && document.querySelector("#audio").hidden);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  await page.locator("#music-results .music-result-row").waitFor();
  await page.locator("#music-results .music-result-row .station-actions button").first().click();
  await page.locator("#left-search-close").click();
  await page.locator("#jb-play-a").click();
  await page.waitForFunction(() => document.querySelector("#player-status").textContent === "PLAYING ON MYMUSICS HOST");

  assert.deepEqual(hostRequests, [{ id: "track-host", deck: "a", crossfade: false, naturalFadeIn: false, fadeSeconds: 3 }]);
  assert.equal(await page.locator("#jb-title").textContent(), "Host Song");
  assert.equal(await page.locator("#audio").isHidden(), true);
  assert.equal(await page.locator("#audio2").isHidden(), true);
  assert.deepEqual(pageErrors, []);
  await page.close();
});

test("natural outro fades in the next deck while the current deck keeps playing", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === "/api/music/status") body = { configured: true, server: "http://jellyfin.test" };
    if (url.pathname === "/api/music/playlists") body = { playlists: [] };
    if (url.pathname === "/api/music/search") {
      body = {
        results: (url.searchParams.get("q") || "") === "test song" ? [1, 2].map((number) => ({
          id: `track-${number}`, kind: "track", title: `Test Song ${number}`, artist: "Test Artist", album: "Test Album", durationMs: 180_000
        })) : []
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/music.html`);
  await page.locator("#left-search-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator("#music-search-type").selectOption("track");
  await page.locator("#music-search").fill("test song");
  await page.locator("#music-search").press("Enter");
  const results = page.locator("#music-results .music-result-row");
  await results.nth(1).waitFor();
  for (let index = 0; index < 2; index++) {
    await results.nth(index).locator(".station-actions button").first().click();
  }
  await page.locator("#left-search-close").click();
  await page.locator("#jb-play-a").click();
  const audio = page.locator("#audio");
  await page.waitForFunction(() => document.querySelector("#audio").dataset.playing === "true");
  await page.locator('[data-natural-fadeout="a"]').fill("5");
  await page.locator('[data-natural-fadeout="a"]').dispatchEvent("change");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("mymusics:natural-fadeouts"))), { "track-1": 5 });
  await audio.evaluate((player) => {
    Object.defineProperty(player, "duration", { configurable: true, value: 180 });
    Object.defineProperty(player, "currentTime", { configurable: true, writable: true, value: 177 });
    player.dispatchEvent(new Event("timeupdate"));
  });

  await page.waitForFunction(() => document.querySelector("#jb-title-b").textContent === "Test Song 2"
    && document.querySelector("#audio2").dataset.playing === "true"
    && document.querySelector("#audio2").volume < 1);
  assert.equal(await audio.getAttribute("data-playing"), "true");
  assert.equal(await audio.evaluate((player) => player.volume), 1);
  await page.close();
});

test("radio playback renders metadata from the active station event stream", async () => {
  const page = await browser.newPage();
  const stationUrl = `${baseUrl}/live.mp3`;
  await page.addInitScript((url) => {
    localStorage.setItem("mymusics:speech-suppression-disabled", JSON.stringify([url]));
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
    HTMLMediaElement.prototype.load = function () {};
    window.EventSource = class extends EventTarget {
      constructor(sourceUrl) {
        super();
        this.url = sourceUrl;
        window.nowPlayingTestSource = this;
      }
      close() {}
      emit(type, data) {
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
      }
    };
  }, stationUrl);
  await page.route("**/stations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ Jazz: [{ name: "Test Radio", url: stationUrl, type: "mp3", favorite: false }] })
  }));
  await page.route("**/live.mp3", (route) => route.fulfill({ status: 200, contentType: "audio/mpeg", body: "" }));
  await page.route("**/metadata**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ trackTitle: "Test Track", album: "Test Album", year: 2026, durationMs: 1_500, tags: [], coverArt: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" })
  }));
  await page.route(/\/lyrics(?:\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ syncedLyrics: "[00:00.00]Test lyric\n[00:01.00]Second line" })
  }));

  await page.goto(`${baseUrl}/index.html`);
  await assertEqualizerHelpers(page);
  assert.deepEqual(await page.evaluate(() => window.MyMusicsLyrics.parseSynced(
    "[00:02.00]Second line\n[00:01.5]First line"
  )), [{ time: 1.5, text: "First line" }, { time: 2, text: "Second line" }]);
  await page.locator("#radio-search-open").click();
  await page.locator("#radio-search-dialog").evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: box.right + 1, clientY: box.bottom + 1 }));
  });
  assert.equal(await page.locator("#radio-search-dialog").evaluate((dialog) => dialog.open), false);
  await page.locator("#radio-search-open").click();
  await page.locator("#radio-search").fill("test");
  const searchResult = page.locator("#radio-search-results .radio-search-result");
  await searchResult.waitFor();
  assert.equal(await searchResult.innerText(), "Test Radio\nJazz · MP3");
  await searchResult.click();
  assert.equal(await page.locator("#radio-search-dialog").evaluate((dialog) => dialog.open), false);
  await page.waitForFunction(() => window.nowPlayingTestSource && document.querySelector("#player-status").textContent === "ON AIR");
  assert.equal(await page.locator("#lyrics-status").textContent(), "Waiting for track metadata…");
  await page.evaluate(() => window.nowPlayingTestSource.emit("monitor-status", {
    connected: true,
    interval: 16_000,
    headers: { "icy-name": "Test Radio" }
  }));
  await page.waitForFunction(() => document.querySelector("#metadata-summary-status").textContent === "Receiving");
  await page.evaluate(() => window.nowPlayingTestSource.emit("track", {
    artist: "Test Artist",
    title: "Test Track",
    startTime: "",
    startTimeSent: false
  }));

  await page.waitForFunction(() => document.querySelector("#track-title").textContent === "Test Track"
    && document.querySelector("#track-artist").textContent === "Test Artist"
    && document.querySelector("#metadata-block-count").textContent === "1 blocks");
  await page.waitForFunction(() => document.querySelector("#lookup-status").textContent === "0:01");
  assert.equal(await page.locator("#lookup-status").textContent(), "0:01");
  await page.waitForFunction(() => !document.querySelector("#cover-art").hidden);
  await page.locator("#lyrics-content .lyric-line").nth(1).waitFor();
  assert.deepEqual(await page.locator("#lyrics-content .lyric-line").allTextContents(), ["Test lyric", "Second line"]);
  assert.equal(await page.locator("#lyrics-progress").getAttribute("max"), "2");
  assert.match(await page.locator("#metadata-blocks").innerText(), /TRACK UPDATE/);
  assert.deepEqual(await page.locator("#metadata-stream-info span").allInnerTexts(), ["ICY interval: 16000 bytes", "icy-name: Test Radio"]);
  await page.evaluate(() => window.nowPlayingTestSource.emit("track", {
    artist: "",
    title: "News bulletin",
    startTime: "",
    startTimeSent: false
  }));
  await page.waitForFunction(() => document.querySelector("#track-title").textContent === "News bulletin"
    && document.querySelector("#lyrics-status").textContent === "Program information; no lyrics.");
  assert.equal(await page.locator("#lyrics-content .lyric-line").count(), 0);
  await page.close();
});

test("HLS playback starts on manifest and renders fragment metadata", async () => {
  const page = await browser.newPage();
  const stationUrl = `${baseUrl}/test-stream.m3u8`;
  await page.addInitScript(() => {
    class HlsMock {
      static Events = { MANIFEST_PARSED: "manifest", FRAG_PARSING_METADATA: "fragment", ERROR: "error" };
      static isSupported() { return true; }
      constructor() {
        this.listeners = new Map();
        window.testHls = this;
      }
      loadSource(url) { this.url = url; }
      attachMedia(media) { this.media = media; }
      on(name, listener) { this.listeners.set(name, listener); }
      emit(name, data = {}) { this.listeners.get(name)?.(name, data); }
    }
    window.Hls = HlsMock;
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/stations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ Jazz: [{ name: "HLS Radio", url: stationUrl, type: "hls", favorite: false }] })
  }));
  await page.route("**/nowplaying**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({})
  }));

  await page.goto(`${baseUrl}/index.html`);
  await page.locator("#station-list .play-button").click();
  await page.waitForFunction(() => window.testHls && document.querySelector("#metadata-summary-status").textContent === "Polling HLS metadata");
  assert.equal(await page.evaluate(() => window.testHls.url), stationUrl);
  await page.evaluate(() => window.testHls.emit(window.Hls.Events.MANIFEST_PARSED));
  await page.waitForFunction(() => document.querySelector("#player-status").textContent === "ON AIR");
  await page.evaluate(() => window.testHls.emit(window.Hls.Events.FRAG_PARSING_METADATA, {
    samples: [{ frames: [{ key: "TXXX", info: "HLS marker" }] }]
  }));

  await page.waitForFunction(() => document.querySelector("#metadata-block-count").textContent === "1 blocks");
  assert.match(await page.locator("#metadata-blocks").innerText(), /HLS ID3/);
  assert.match(await page.locator("#metadata-blocks").innerText(), /HLS marker/);
  await page.close();
});
