const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("release manifest creates a complete runtime package", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mymusics-release-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const archive = path.join(temporary, "mymusics.tar.gz");
  const extracted = path.join(temporary, "extracted");
  fs.mkdirSync(extracted);
  fs.writeFileSync(path.join(temporary, "VERSION"), "v1.2.3\n");
  fs.writeFileSync(path.join(temporary, "BUILD_DATE"), "2026-11-01T00:00:00Z\n");

  execFileSync("tar", ["-czf", archive, "-C", temporary, "VERSION", "BUILD_DATE", "-C", root, "-T", "deploy/runtime-files.txt"], { cwd: root });
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);

  const manifest = fs.readFileSync(path.join(root, "deploy/runtime-files.txt"), "utf8").trim().split(/\r?\n/);
  for (const file of manifest) assert.ok(fs.existsSync(path.join(extracted, file)), `${file} is in the package`);
  for (const file of ["routes/health.js", "routes/music.js", "routes/stations.js", "storage.js", "deploy/mymusics-update.sh"]) {
    assert.ok(entries.includes(file), `${file} is archived`);
  }
  assert.equal(fs.readFileSync(path.join(extracted, "VERSION"), "utf8"), "v1.2.3\n");
  assert.match(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"), /-T deploy\/runtime-files\.txt/);
});
