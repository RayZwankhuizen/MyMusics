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

test("TV mode enables remote focus, custom radio controls, and the audio output picker", async () => {
  const page = await browser.newPage();
  await page.route("**/stations", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ Jazz: [{ name: "Test Jazz", url: "https://radio.example/jazz", image: "" }] }) }));
  await page.route("**/api/host-player/*", (route) => {
    const body = new URL(route.request().url()).pathname.endsWith("/mpv") ? { installed: true } : {};
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("https://radio.example/**", (route) => route.abort());
  await page.goto(`${baseUrl}/?tv=1`);
  await page.waitForSelector("#genres button");
  await page.waitForFunction(() => !document.querySelector('.tv-playback-options [data-output="host"]').disabled);

  assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("tv-mode")), true);
  assert.equal(await page.locator("#audio").evaluate((node) => node.controls), false);
  assert.equal(await page.locator("#radio-player-toggle").isDisabled(), true);
  await page.locator("#station-list .play-button").click();
  await page.waitForFunction(() => document.querySelector("#radio-player-toggle")?.disabled === false);

  const firstFocus = await page.evaluate(() => document.activeElement?.outerHTML);
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.evaluate(() => document.activeElement?.outerHTML), firstFocus);

  await page.locator(".tv-playback-current").click();
  await page.locator('.tv-playback-options [data-output="host"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem("mymusics:playback-target")), "host");

  await page.locator("#tv-mode-toggle").click();
  assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("tv-mode")), false);
  await page.locator("#tv-mode-toggle").click();
  assert.equal(await page.evaluate(() => localStorage.getItem("mymusics:tv-mode")), "true");
  await page.close();
});

test("radio favorites can be changed and stay selected after reload", async () => {
  const page = await browser.newPage();
  try {
    const station = { name: "Test Jazz", url: "https://radio.example/jazz" };
    const other = { name: "Other Jazz", url: "https://radio.example/other" };
    const catalog = { Jazz: [station, other] };
    const requests = [];
    await page.route("**/stations", (route) => route.fulfill({ json: catalog }));
    await page.route("**/api/**", (route) => route.abort());
    await page.route("**/api/genres/Jazz/stations/*/favorite", (route) => {
      assert.equal(route.request().method(), "PATCH");
      const { favorite, name } = route.request().postDataJSON();
      const index = Number(new URL(route.request().url()).pathname.split("/").at(-2));
      assert.equal(name, catalog.Jazz[index].name);
      requests.push([index, favorite]);
      catalog.Jazz[index].favorite = favorite;
      return route.fulfill({ json: catalog });
    });

    await page.goto(baseUrl);
    const star = page.locator("#radio-player-favorite");
    assert.equal(await star.isHidden(), true);
    await page.getByRole("button", { name: "Play Test Jazz" }).click();
    await star.click();
    await page.locator('#radio-player-favorite[aria-pressed="true"]').waitFor();
    await page.getByRole("button", { name: "Add Other Jazz to favorites" }).click();
    await page.getByRole("button", { name: "Remove Other Jazz from favorites" }).waitFor();
    assert.equal(await page.locator("#radio-player-station").textContent(), "Test Jazz");
    await page.locator("#genres [data-favorites]").click();
    await page.getByRole("button", { name: "Play Test Jazz" }).waitFor();
    await page.getByRole("button", { name: "Play Other Jazz" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Delete Test Jazz" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Remove Test Jazz from favorites" }).textContent(), "Remove from Favorites");

    await page.getByRole("button", { name: "Remove Test Jazz from favorites" }).click();
    await page.locator('#radio-player-favorite[aria-pressed="false"]').waitFor();
    assert.equal(await page.getByRole("button", { name: "Play Test Jazz" }).count(), 0);
    await page.locator('#genres [data-genre="Jazz"]').click();
    await page.getByRole("button", { name: "Play Test Jazz" }).waitFor();
    await page.locator("#genres [data-favorites]").click();
    await page.reload();
    await page.locator('#genres [data-favorites][aria-current="page"]').waitFor();
    await page.getByRole("button", { name: "Play Other Jazz" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Play Test Jazz" }).count(), 0);
    assert.deepEqual(requests, [[0, true], [1, true], [0, false]]);
  } finally {
    await page.close();
  }
});

test("radio speech settings show and save the recovery delay", async () => {
  const page = await browser.newPage();
  try {
    const station = { name: "Test Jazz", url: "https://radio.example/jazz", type: "mp3" };
    const catalog = { Jazz: [station] };
    await page.route("**/stations", (route) => route.fulfill({ json: catalog }));
    await page.route("**/api/**", (route) => route.abort());
    await page.route("**/api/genres/Jazz/stations/0", (route) => {
      assert.equal(route.request().method(), "PUT");
      const { speechVolumePercent, speechReleaseDelaySeconds } = route.request().postDataJSON();
      assert.equal(speechReleaseDelaySeconds, 6);
      Object.assign(station, { speechVolumePercent, speechReleaseDelaySeconds });
      return route.fulfill({ json: catalog });
    });
    await page.route("**/radio-audio-classifier.worker.mjs", (route) => route.fulfill({ contentType: "text/javascript", body: "self.postMessage({ ready: true });" }));
    await page.goto(baseUrl);
    await page.locator("#station-list .play-button").click();
    await page.getByRole("button", { name: "Sound settings", exact: true }).click();
    const open = page.getByRole("button", { name: "Speech settings (30%)" });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Speech and ad settings" });
    const delay = dialog.getByLabel("Volume recovery delay (seconds)");
    assert.equal(await delay.inputValue(), "3");
    await delay.fill("6");
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "hidden" });
    await open.click();
    assert.equal(await delay.inputValue(), "6");
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Audio classification trial" }).click();
    const analysis = page.getByRole("dialog", { name: "Audio classification trial" });
    await analysis.getByText("Waveform", { exact: true }).waitFor();
    assert.equal(await analysis.locator("canvas").count(), 2);
    await page.mouse.click(2, 2);
    await analysis.waitFor({ state: "hidden" });
  } finally {
    await page.close();
  }
});

test("the radio station overview deletes a station only after confirmation", async () => {
  const page = await browser.newPage();
  try {
    const catalog = { Jazz: [{ name: "Test Jazz", url: "https://radio.example/jazz" }] };
    let deletions = 0;
    await page.route("**/stations", (route) => route.fulfill({ json: catalog }));
    await page.route("**/api/genres/Jazz/stations/0", (route) => {
      assert.equal(route.request().method(), "DELETE");
      deletions++;
      return route.fulfill({ json: { Jazz: [] } });
    });
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "Play Test Jazz" }).waitFor();
    const remove = page.getByRole("button", { name: "Delete Test Jazz" });
    await remove.waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await remove.click();
    assert.equal(deletions, 0);
    await remove.waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await page.getByText("“Test Jazz” deleted.", { exact: true }).waitFor();
    assert.equal(deletions, 1);
    assert.equal(await page.getByRole("button", { name: "Play Test Jazz" }).count(), 0);
  } finally {
    await page.close();
  }
});
