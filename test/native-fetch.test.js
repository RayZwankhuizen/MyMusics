const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const dns = require("node:dns").promises;
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const zlib = require("node:zlib");
const express = require("express");
const { fetchPublicUrl } = require("../routes/station-discovery");
const registerRadioStream = require("../routes/radio-stream");

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("native fetch radio proxy forwards streamed bytes and content type", async (t) => {
  const upstream = await listen(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.write(Buffer.from([0, 128, 255]));
    setTimeout(() => res.end(Buffer.from([42, 7])), 10);
  });
  const app = express();
  registerRadioStream(app, { getStations: () => ({ Test: [{ url: upstream, type: "mp3" }] }) });
  const base = await listen(t, app);
  const response = await fetch(`${base}/api/radio-stream?url=${encodeURIComponent(upstream)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /audio\/mpeg/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 128, 255, 42, 7]));
});

function mockLogoTransport(t, { status = 200, headers = {}, payload, stall = false } = {}) {
  let requests = 0;
  t.mock.method(dns, "lookup", async (hostname) => [{ address: hostname === "private.test" ? "127.0.0.1" : "93.184.216.34", family: 4 }]);
  t.mock.method(http, "get", (_url, options) => {
    requests++;
    assert.equal(options.agent, false);
    options.lookup("logo.test", { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
    });
    const request = new EventEmitter();
    const response = new PassThrough();
    response.statusCode = status;
    response.headers = headers;
    request.destroy = (error) => { response.destroy(); if (error) request.emit("error", error); };
    process.nextTick(() => {
      request.emit("response", response);
      if (!stall) response.end(payload || Buffer.from("logo"));
    });
    return request;
  });
  return () => requests;
}

test("logo downloads keep DNS pinning and reject redirects to private addresses", async (t) => {
  const requests = mockLogoTransport(t, { status: 302, headers: { location: "http://private.test/logo" } });
  await assert.rejects(fetchPublicUrl("http://logo.test/logo"), /public website/);
  assert.equal(requests(), 1);
});

test("logo downloads decode gzip and enforce the decoded size limit", async (t) => {
  const content = Buffer.from("a".repeat(200));
  mockLogoTransport(t, { headers: { "content-encoding": "gzip", "content-type": "image/png" }, payload: zlib.gzipSync(content) });
  const result = await fetchPublicUrl("http://logo.test/logo", 200);
  assert.deepEqual(result.body, content);
  assert.equal(result.type, "image/png");
  await assert.rejects(fetchPublicUrl("http://logo.test/logo", 100), /download limit/);
});

test("logo downloads abort a stalled body at the deadline", async (t) => {
  mockLogoTransport(t, { stall: true });
  await assert.rejects(fetchPublicUrl("http://logo.test/logo", 200, Date.now() + 60), /timed out/);
});
