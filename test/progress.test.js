const test = require("node:test");
const assert = require("node:assert/strict");
const { emitProgress } = require("../src/progress");

test("emitProgress preserves the common progress-event contract", () => {
  let received;
  emitProgress((event) => {
    received = event;
  }, {
    severity: "warn",
    stage: "unit",
    message: "Fetching unit",
    courseCode: "AI-901",
    learningPathUid: "learn.example"
  });

  assert.match(received.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(received.severity, "warn");
  assert.equal(received.stage, "unit");
  assert.equal(received.message, "Fetching unit");
  assert.equal(received.courseCode, "AI-901");
  assert.equal(received.learningPathUid, "learn.example");
});

test("emitProgress is a no-op without a reporter", () => {
  assert.doesNotThrow(() => emitProgress(null, { message: "ignored" }));
});
