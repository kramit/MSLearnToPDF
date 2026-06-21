const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommandArgs } = require("../src/cli/args");

const definition = {
  "--url": { name: "urls", kind: "array" },
  "--config": { name: "config", kind: "value" },
  "--refresh": { name: "refresh", kind: "boolean" }
};

test("parseCommandArgs handles repeatable, valued, and boolean options", () => {
  assert.deepEqual(
    parseCommandArgs(
      ["--url", "one", "--", "--url", "two", "--config", "app.json", "--refresh"],
      definition,
      { urls: [], refresh: false }
    ),
    {
      urls: ["one", "two"],
      config: "app.json",
      refresh: true
    }
  );
});

test("parseCommandArgs rejects missing values and unknown options", () => {
  assert.throws(
    () => parseCommandArgs(["--config"], definition, { urls: [] }),
    /--config requires a value/
  );
  assert.throws(
    () => parseCommandArgs(["--wat"], definition, { urls: [] }),
    /Unknown argument: --wat/
  );
});
