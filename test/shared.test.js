const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { learningPathHierarchyCacheFile } = require("../src/shared");

test("learning path hierarchy cache files use the shared slugged layout", () => {
  assert.equal(
    learningPathHierarchyCacheFile(
      path.join("C:", "cache"),
      "AZ-104",
      "learn.wwl.configure-manage-governance-azure"
    ),
    path.join(
      "C:",
      "cache",
      "az-104",
      "learn-wwl-configure-manage-governance-azure",
      "learning-path.json"
    )
  );
});
