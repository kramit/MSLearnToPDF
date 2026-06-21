const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeForSearch } = require("../src/validate");

test("normalizes PDF punctuation and spacing for reliable text matching", () => {
  assert.equal(
    normalizeForSearch("What is a large language model (LLM) ?"),
    normalizeForSearch("What is a large language model (LLM)?")
  );
  assert.equal(
    normalizeForSearch("Microsoft\u00a0Entra—ID"),
    "microsoft entra id"
  );
});
