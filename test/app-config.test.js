const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadAppConfig, validateAppConfig } = require("../src/app-config");

test("loads app config and resolves output from app root while cache stays config-relative", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-config-"));
  const configDir = path.join(tempRoot, "nested");
  await fs.mkdir(configDir, { recursive: true });
  const configFile = path.join(configDir, "app.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({
      outputRoot: "../custom-output",
      cacheRoot: "../custom-cache",
      stallWarningSeconds: 75
    }),
    "utf8"
  );
  const loaded = await loadAppConfig(tempRoot, configFile);
  assert.equal(loaded.outputRoot, path.resolve(tempRoot, "../custom-output"));
  assert.equal(loaded.cacheRoot, path.resolve(configDir, "../custom-cache"));
  assert.equal(loaded.stallWarningSeconds, 75);
});

test("default output root resolves to the app root output folder", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-config-"));
  const configDir = path.join(tempRoot, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "app.json"), "{}", "utf8");
  const loaded = await loadAppConfig(tempRoot, path.join(configDir, "app.json"));
  assert.equal(loaded.outputRoot, path.join(tempRoot, "output"));
  assert.equal(loaded.cacheRoot, path.join(configDir, "cache"));
});

test("rejects invalid poster and stall settings", () => {
  assert.throws(
    () =>
      validateAppConfig({
        posterUrl: "http://example.com",
        locale: "en-us",
        paperFormat: "A4",
        stallWarningSeconds: 60
      }),
    /https URL/
  );
  assert.throws(
    () =>
      validateAppConfig({
        posterUrl: "https://example.com",
        locale: "en-us",
        paperFormat: "A4",
        stallWarningSeconds: 0
      }),
    /positive integer/
  );
});
