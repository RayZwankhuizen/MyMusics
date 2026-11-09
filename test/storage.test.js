const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStorage } = require("../storage");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mymusics-storage-"));
}

test("initializes persistent paths and migrates bundled stations and legacy images", (t) => {
  const root = temporaryDirectory();
  const data = path.join(root, "persistent");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stations = { Rock: [{ name: "Example" }] };
  const legacyImage = path.join(root, "data", "station-images", "abc.png");
  fs.mkdirSync(path.dirname(legacyImage), { recursive: true });
  fs.writeFileSync(path.join(root, "stations.json"), JSON.stringify(stations));
  fs.writeFileSync(legacyImage, "image");

  const storage = createStorage({ dataDir: data, rootDir: root });

  assert.deepEqual(storage.readStations(), stations);
  assert.equal(fs.readFileSync(path.join(storage.paths.images, "abc.png"), "utf8"), "image");
  assert.deepEqual(storage.readJson(storage.paths.playlists, { playlists: [] }), { playlists: [] });
  assert.deepEqual(storage.readUpdateStatus(), { state: "idle", version: "", message: "" });
});

test("rejects corrupt and structurally invalid JSON without changing the source", (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createStorage({ dataDir: path.join(root, "data"), rootDir: root });
  const corrupt = path.join(root, "corrupt.json");
  fs.writeFileSync(corrupt, "{broken");

  assert.throws(() => storage.readJson(corrupt, {}), /Cannot parse corrupt\.json/);
  assert.equal(fs.readFileSync(corrupt, "utf8"), "{broken");
  fs.writeFileSync(storage.paths.stations, "[]");
  assert.throws(() => storage.readStations(), /invalid data structure/);
  assert.equal(fs.readFileSync(storage.paths.stations, "utf8"), "[]");
});

test("writes JSON atomically and validates station data", (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createStorage({ dataDir: path.join(root, "data"), rootDir: root });
  const stations = { Jazz: [{ name: "Example" }] };

  storage.writeStations(stations);
  assert.deepEqual(storage.readStations(), stations);
  const original = fs.readFileSync(storage.paths.stations, "utf8");
  assert.throws(() => storage.writeStations({ Jazz: "invalid" }), /must be an object/);
  assert.equal(fs.readFileSync(storage.paths.stations, "utf8"), original);
  assert.deepEqual(fs.readdirSync(path.dirname(storage.paths.stations)).sort(), ["station-images", "stations.json"]);
});

test("writes and removes only valid, unreferenced station images", (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createStorage({ dataDir: path.join(root, "data"), rootDir: root });
  const used = "11111111-1111-4111-8111-111111111111.webp";
  const unused = "22222222-2222-4222-8222-222222222222.png";
  const usedUrl = `/station-images/${used}`;
  const unusedUrl = `/station-images/${unused}`;

  storage.writeStationImage(used, Buffer.from("used"));
  storage.writeStationImage(unused, Buffer.from("unused"));
  assert.equal(storage.hasStationImage(usedUrl), true);
  assert.equal(storage.hasStationImage("/station-images/../../stations.json"), false);
  assert.throws(() => storage.writeStationImage("../stations.json", Buffer.from("bad")), /Invalid station image/);
  storage.removeUnusedStationImages([usedUrl, unusedUrl], [usedUrl]);

  assert.equal(storage.hasStationImage(usedUrl), true);
  assert.equal(storage.hasStationImage(unusedUrl), false);
});
