const test = require("node:test");
const assert = require("node:assert/strict");
const {
  containsValidationText,
  normalizeForSearch
} = require("../src/validate");

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

test("matches validation samples when a heading separates sentences", () => {
  const searchableText = normalizeForSearch(
    "Azure Administrators prepare for planned and unplanned failures. " +
      "Things to know about maintenance planning " +
      "An availability plan for Azure virtual machines."
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Azure Administrators prepare for planned and unplanned failures. An availability"
    ),
    true
  );
});

test("matches validation samples separated by a numbered list", () => {
  const searchableText = normalizeForSearch(
    "Restoring deleted email messages is a two-step process: 1. Recover the deleted data"
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Restoring deleted email messages is a two-step process: Recover the"
    ),
    true
  );
});

test("does not accept validation samples with missing sentence fragments", () => {
  const searchableText = normalizeForSearch(
    "Azure Administrators prepare for planned and unplanned failures."
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Azure Administrators prepare for planned and unplanned failures. An availability"
    ),
    false
  );
});
