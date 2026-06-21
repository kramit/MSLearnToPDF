const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanUnitMarkdown,
  dedupeAdjacentContent,
  discoverLearningPathUids,
  learningPathParent,
  extractAssessment,
  fetchWithProgress,
  parseFrontMatter,
  resolveLearnUrl
} = require("../src/lib");
const { contentValidationText } = require("../src/converter/service");

test("discovers ordered unique learning path UIDs", () => {
  const html = `
    <meta name="learn_item" content="learn.one">
    <meta name="learn_item" content="learn.two">
    <meta name="learn_item" content="learn.one">`;
  assert.deepEqual(discoverLearningPathUids(html), ["learn.one", "learn.two"]);
});

test("selects the learning-path parent by exact UID", () => {
  const hierarchy = {
    modules: [
      {
        parents: [
          {
            uid: "learn.unrelated",
            type: "learningPath",
            title: "MD-102 Explore endpoint management"
          },
          {
            uid: "learn.az-104-manage-identities-governance",
            type: "learningPath",
            title: "AZ-104: Manage identities and governance in Azure"
          }
        ]
      }
    ]
  };
  assert.equal(
    learningPathParent(
      hierarchy,
      "learn.az-104-manage-identities-governance"
    ).title,
    "AZ-104: Manage identities and governance in Azure"
  );
});

test("parses front matter and removes Learn completion chrome", () => {
  const source = `---
uid: learn.example
updated_at: 2026-03-16T07:10:00Z
---
# Example

Completed

- 5 minutes

Body text.`;
  const parsed = parseFrontMatter(source);
  assert.equal(parsed.metadata.uid, "learn.example");
  assert.equal(cleanUnitMarkdown(parsed.body), "Body text.");
});

test("resolves Microsoft Learn source-relative images", () => {
  assert.equal(
    resolveLearnUrl(
      "media/screenshot.png",
      "/training/modules/example/2-unit/",
      "en-us",
      "image"
    ),
    "https://learn.microsoft.com/en-us/training/modules/example/media/screenshot.png"
  );
  assert.equal(
    resolveLearnUrl(
      "images/diagram.png",
      "/training/modules/example/3-details/",
      "en-us",
      "image"
    ),
    "https://learn.microsoft.com/en-us/training/modules/example/images/diagram.png"
  );
  assert.equal(
    resolveLearnUrl(
      "../../wwl-sci/example/media/image.png",
      "/training/modules/example/2-unit/",
      "en-us",
      "image"
    ),
    "https://learn.microsoft.com/en-us/training/wwl-sci/example/media/image.png"
  );
});

test("extracts assessment questions and choices", () => {
  const markdown = `1.
Question one?

Choice A

Choice B

2.
Question two?

Choice C

Choice D`;
  const questions = extractAssessment(markdown);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].prompt, "Question one?");
  assert.deepEqual(questions[1].choices, ["Choice C", "Choice D"]);
});

test("removes adjacent duplicate Markdown blocks and line sequences", () => {
  const markdown = `Paragraph.

Paragraph.

## Heading

## Heading

one
two
one
two`;
  assert.equal(
    dedupeAdjacentContent(markdown),
    `Paragraph.\n\n## Heading\n\none\ntwo`
  );
});

test("normalizes standalone indented Markdown images without changing code", () => {
  const source = `# Example

    [![Screenshot](../../media/example.png)](../../media/example.png#lightbox)

    const value = 1;`;
  assert.equal(
    cleanUnitMarkdown(source),
    `[![Screenshot](../../media/example.png)](../../media/example.png#lightbox)\n\n    const value = 1;`
  );
});

test("builds stable body-text samples for PDF validation", () => {
  assert.equal(
    contentValidationText(
      "## Introduction\n\nUse **Microsoft Entra ID** to control secure access to resources."
    ),
    "Use Microsoft Entra ID to control secure access to resources."
  );
  assert.equal(
    contentValidationText("Assessment", [
      { prompt: "Which authentication method provides phishing-resistant sign-in?" }
    ]),
    "Which authentication method provides phishing-resistant sign-in?"
  );
});

test("fetchWithProgress retries HTTP 429 using Retry-After before succeeding", async () => {
  const originalFetch = global.fetch;
  const waits = [];
  const events = [];
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("", {
        status: 429,
        headers: { "retry-after": "1" }
      });
    }
    return new Response("ok", {
      status: 200,
      headers: { "content-length": "2" }
    });
  };
  try {
    const result = await fetchWithProgress("https://example.invalid/learn", {
      onEvent: (event) => events.push(event),
      progress: {
        transferKind: "test",
        transferLabel: "Retry test"
      },
      retry: {
        maxRetries: 2,
        jitterRatio: 0,
        wait: async (ms) => waits.push(ms),
        random: () => 0
      }
    });
    assert.equal(result.data, "ok");
    assert.equal(attempts, 2);
    assert.deepEqual(waits, [1500]);
    assert.ok(events.some((event) => event.stage === "rate-limit"));
    assert.ok(events.some((event) => event.stage === "network-complete"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchWithProgress stops after retry budget is exhausted", async () => {
  const originalFetch = global.fetch;
  const waits = [];
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return new Response("", {
      status: 429,
      headers: { "retry-after": "0" }
    });
  };
  try {
    await assert.rejects(
      fetchWithProgress("https://example.invalid/limited", {
        progress: {
          transferKind: "test",
          transferLabel: "Exhaust retries"
        },
        retry: {
          maxRetries: 1,
          baseDelayMs: 0,
          maxDelayMs: 0,
          jitterRatio: 0,
          wait: async (ms) => waits.push(ms),
          random: () => 0
        }
      }),
      /HTTP 429 fetching https:\/\/example\.invalid\/limited/
    );
    assert.equal(attempts, 2);
    assert.deepEqual(waits, [0]);
  } finally {
    global.fetch = originalFetch;
  }
});
