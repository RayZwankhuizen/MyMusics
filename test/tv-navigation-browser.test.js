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
  await page.route("**/api/host-player/*", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("https://radio.example/**", (route) => route.abort());
  await page.goto(`${baseUrl}/?tv=1`);
  await page.waitForSelector("#genres button");

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
