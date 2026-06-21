const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReflection } = require("../src/converter/reflection");

function report(overrides = {}) {
  return {
    learningPath: {
      uid: "learn.example",
      title: "Example path",
      ...(overrides.learningPath || {})
    },
    outputs: {
      pdf: "output/pdf/AI-901 - Example path - 2026-06-21.pdf",
      ...(overrides.outputs || {})
    }
  };
}

test("validateReflection returns the manifest reflection contract", () => {
  assert.deepEqual(
    validateReflection({
      report: report(),
      expectedUid: "learn.example",
      expectedTitle: "Example path",
      fileBase: "AI-901 - Example path - 2026-06-21"
    }),
    {
      status: "pass",
      expectedUid: "learn.example",
      expectedTitle: "Example path",
      filename: "AI-901 - Example path - 2026-06-21"
    }
  );
});

test("validateReflection reports UID, title, and filename drift", () => {
  assert.throws(
    () =>
      validateReflection({
        report: report({ learningPath: { uid: "learn.wrong" } }),
        expectedUid: "learn.example",
        expectedTitle: "Example path",
        fileBase: "AI-901 - Example path - 2026-06-21"
      }),
    /expected learning-path UID/
  );
  assert.throws(
    () =>
      validateReflection({
        report: report({ learningPath: { title: "Wrong title" } }),
        expectedUid: "learn.example",
        expectedTitle: "Example path",
        fileBase: "AI-901 - Example path - 2026-06-21"
      }),
    /expected title/
  );
  assert.throws(
    () =>
      validateReflection({
        report: report({ outputs: { pdf: "wrong.pdf" } }),
        expectedUid: "learn.example",
        expectedTitle: "Example path",
        fileBase: "AI-901 - Example path - 2026-06-21"
      }),
    /PDF filename/
  );
});
