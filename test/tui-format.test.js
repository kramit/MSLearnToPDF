const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTheme, lineForEvent } = require("../src/tui/format");

test("buildTheme honors no-color mode without removing semantic labels", () => {
  assert.deepEqual(buildTheme(true), { noColor: true, colors: {} });
  assert.equal(buildTheme(false).colors.azure, "#0f6cbd");
});

test("lineForEvent formats scoped and retry events deterministically", () => {
  assert.match(
    lineForEvent({
      timestamp: "2026-06-21T12:34:56.000Z",
      severity: "info",
      stage: "unit",
      courseCode: "AI-901",
      unitTitle: "Introduction",
      message: "Fetching"
    }),
    /AI-901 > Introduction \| Fetching/
  );
  assert.match(
    lineForEvent({
      timestamp: "2026-06-21T12:34:56.000Z",
      severity: "warn",
      stage: "rate-limit",
      transferLabel: "Hierarchy",
      retryDelayMs: 2000,
      retryNextAttempt: 2,
      retryMaxAttempts: 6,
      httpStatus: 429,
      message: "Retrying"
    }),
    /HTTP 429.*retry in 2s.*attempt 2\/6/
  );
});
