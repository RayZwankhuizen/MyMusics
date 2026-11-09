const assert = require("node:assert/strict");
const test = require("node:test");
const { writeBoundedSse } = require("../routes/bounded-sse-write");

test("SSE writes retain responsive clients and disconnect clients that apply backpressure", () => {
  let written = "";
  let destroyed = false;
  const responsive = {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: false,
    write(chunk) { written += chunk; return true; },
    destroy() { destroyed = true; }
  };
  assert.equal(writeBoundedSse(responsive, "event"), true);
  assert.equal(written, "event");
  assert.equal(destroyed, false);

  const slow = {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: false,
    write() { return false; },
    destroy() { destroyed = true; }
  };
  assert.equal(writeBoundedSse(slow, "event"), false);
  assert.equal(destroyed, true);
});

test("SSE disconnects a client already waiting for its output buffer to drain", () => {
  let wrote = false;
  let destroyed = false;
  const client = {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: true,
    write() { wrote = true; return true; },
    destroy() { destroyed = true; }
  };
  assert.equal(writeBoundedSse(client, "keepalive"), false);
  assert.equal(wrote, false);
  assert.equal(destroyed, true);
});
