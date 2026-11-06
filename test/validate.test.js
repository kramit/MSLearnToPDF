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

test("matches SC-200 samples interrupted by printed external-link annotations", () => {
  for (const [rendered, sample] of [
    [
      "The Microsoft Defender portal (https://security.microsoft.com/) External resource is a specialized workspace designed",
      "The Microsoft Defender portal (https://security.microsoft.com/) is a specialized workspace designed"
    ],
    [
      "Sign in to the Microsoft Entra admin center External resource using a global administrator account",
      "Sign in to the Microsoft Entra admin center using a"
    ]
  ]) {
    assert.equal(containsValidationText(normalizeForSearch(rendered), sample), true);
  }
});

test("external-link annotations cannot hide missing source words", () => {
  assert.equal(containsValidationText(
    normalizeForSearch("Sign in to the Microsoft Entra admin center External resource using a"),
    "Sign in to the Microsoft Entra admin center using a global administrator"
  ), false);
  assert.equal(containsValidationText(
    normalizeForSearch("Read the guide before continuing"),
    "Read the external resource guide before continuing"
  ), false);
});



test("matches AZ-400 functional-test text across a heading and external-link annotation", () => {
  const rendered = "Estimated time 60 minutes Scenario Selenium External resource is a portable open source software testing framework";
  assert.equal(containsValidationText(normalizeForSearch(rendered),
    "Estimated time: 60 minutes. Selenium is a portable open source"), true);
  assert.equal(containsValidationText(normalizeForSearch(rendered),
    "Estimated time: 60 minutes. Selenium is a portable proprietary open source"), false);
});


test("matches rendered HTML entities without hiding missing source words", () => {
  const text = normalizeForSearch("In Intune, EDR policies are available from Endpoint security > Endpoint detection and response");
  assert.equal(containsValidationText(text, "In Intune, EDR policies are available from Endpoint security &gt;"), true);
  assert.equal(containsValidationText(text, "In Intune, EDR policies are available from Endpoint security &#62;"), true);
  assert.equal(containsValidationText(text, "In Intune, EDR policies are available from Endpoint security &#x3e;"), true);
  assert.equal(containsValidationText(text, "In Intune, EDR policies are available from Endpoint security &gt; missing text"), false);
  assert.equal(containsValidationText(normalizeForSearch("Identity and access"), "Identity &amp; access"), false);
});
