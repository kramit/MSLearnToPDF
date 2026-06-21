const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

test("url mode honors --config before attempting resolution", () => {
  const missingConfig = path.join(
    os.tmpdir(),
    `mslearn-missing-config-${process.pid}-${Date.now()}.json`
  );
  const result = spawnSync(
    process.execPath,
    [
      "src/cli.js",
      "--url",
      "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/",
      "--config",
      missingConfig
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, /\[INFO\] resolve\b/);
  assert.match(output, /ENOENT|no such file|cannot find/i);
});

test("cli rejects unknown arguments without starting resolution", () => {
  const result = spawnSync(process.execPath, ["src/cli.js", "--unknown"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Unknown argument: --unknown/);
  assert.doesNotMatch(output, /\[INFO\] resolve\b/);
});

test("qa validates course-code scope before loading configuration", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/qa.js",
      "--url",
      "https://learn.microsoft.com/one",
      "--url",
      "https://learn.microsoft.com/two",
      "--course-code",
      "AI-901"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /--course-code can only be used with a single --url/);
});
