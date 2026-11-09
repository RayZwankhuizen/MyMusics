const assert = require("node:assert/strict");
const test = require("node:test");

test("music search events preserve submit, type, clear, and empty-input behavior", async () => {
  const { wireMusicSearchEvents } = await import("../public/music-search.mjs");
  const listeners = new Map();
  const calls = [];
  let prevented = false;
  const input = {
    value: "test song",
    focusCalled: false,
    focus() { this.focusCalled = true; },
    addEventListener(type, listener) { listeners.set(`input:${type}`, listener); }
  };
  const type = {
    value: "artist",
    addEventListener(event, listener) { listeners.set(`type:${event}`, listener); }
  };
  const form = { addEventListener(event, listener) { listeners.set(`form:${event}`, listener); } };
  const clearButton = { addEventListener(event, listener) { listeners.set(`clear:${event}`, listener); } };
  const elements = new Map([
    ["#music-search-form", form], ["#music-search-type", type],
    ["#music-search-clear", clearButton], ["#music-search", input]
  ]);

  wireMusicSearchEvents({ el: (selector) => elements.get(selector), search: (...args) => calls.push(args) });
  listeners.get("form:submit")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(calls.pop(), ["test song"]);

  listeners.get("type:change")();
  assert.deepEqual(calls.pop(), ["test song"]);

  listeners.get("clear:click")();
  assert.equal(input.value, "");
  assert.equal(input.focusCalled, true);
  assert.deepEqual(calls.pop(), ["", "artist"]);

  listeners.get("input:input")({ currentTarget: input });
  assert.deepEqual(calls.pop(), ["", "artist"]);
});
