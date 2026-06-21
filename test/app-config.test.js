const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadAppConfig, validateAppConfig } = require("../src/app-config");

test("loads app config and resolves relative paths from the config file", async () => {
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
  assert.equal(loaded.outputRoot, path.resolve(configDir, "../custom-output"));
  assert.equal(loaded.cacheRoot, path.resolve(configDir, "../custom-cache"));
  assert.equal(loaded.stallWarningSeconds, 75);
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
