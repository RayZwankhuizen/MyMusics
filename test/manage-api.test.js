const assert = require("node:assert/strict");
const test = require("node:test");

test("management request sends JSON and returns a successful JSON response", async () => {
  const { request } = await import("../public/manage-api.mjs");
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (...args) => {
    received = args;
    return { headers: { get: () => "application/json" }, ok: true, async json() { return { saved: true }; } };
  };
  try {
    assert.deepEqual(await request("/api/genres", "POST", { name: "Jazz" }), { saved: true });
    assert.deepEqual(received, ["/api/genres", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":"Jazz"}'
    }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("management request preserves JSON API errors and non-JSON server messages", async () => {
  const { request } = await import("../public/manage-api.mjs");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      headers: { get: () => "application/json" }, ok: false,
      async json() { return { error: "Genre already exists." }; }
    });
    await assert.rejects(request("/api/genres"), { message: "Genre already exists." });

    globalThis.fetch = async () => ({ headers: { get: () => "text/html" }, status: 404 });
    await assert.rejects(request("/missing"), { message: "This MyMusics server does not have this feature yet. Install the latest release, restart MyMusics, and reload this page." });
  } finally { globalThis.fetch = originalFetch; }
});
