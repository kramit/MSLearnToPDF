const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  canonicalPosterUrl,
  loadPosterCatalog,
  pickAnnotation,
  validateCatalog
} = require("../src/catalog/service");

test("normalizes poster URLs by repairing malformed schemes and removing tracking", () => {
  assert.equal(
    canonicalPosterUrl(
      "https:/learn.microsoft.com/credentials/certifications/azure-administrator/?WT.mc_id=poster#fragment"
    ),
    "https://learn.microsoft.com/credentials/certifications/azure-administrator/"
  );
  assert.equal(
    canonicalPosterUrl(
      "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/?source=poster"
    ),
    "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
  );
  assert.equal(canonicalPosterUrl("https://example.com/not-learn"), "");
});

test("rejects malformed or suspiciously shrunken poster catalogs", () => {
  assert.throws(
    () => validateCatalog({ entries: [{ code: "AI-900", title: "", url: "" }] }),
    /missing a code, title, or URL/
  );
  assert.throws(
    () =>
      validateCatalog(
        {
          entries: Array.from({ length: 39 }, (_, index) => ({
            code: `AI-${900 + index}`,
            title: `Course ${index}`,
            url: "https://learn.microsoft.com/en-us/example/"
          }))
        },
        {
          entries: Array.from({ length: 66 }, (_, index) => ({
            code: `AI-${900 + index}`,
            title: `Course ${index}`,
            url: "https://learn.microsoft.com/en-us/example/"
          }))
        }
      ),
    /shrank suspiciously/
  );
});

test("prefers the tighter code-level annotation on mixed poster cards", () => {
  const codeItem = {
    rect: {
      left: 1760.3745,
      right: 1795.1939,
      bottom: 1250.3485,
      top: 1260.7985,
      centerY: 1255.5735
    }
  };
  const selected = pickAnnotation(codeItem, [
    {
      normalizedUrl: "https://learn.microsoft.com/credentials/certifications/exams/pl-600/",
      rect: {
        left: 1758.37,
        right: 1813.99,
        bottom: 1242.91,
        top: 1265.65,
        width: 55.62,
        height: 22.74,
        centerY: 1254.28
      }
    },
    {
      normalizedUrl:
        "https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-business-solutions-architect/",
      rect: {
        left: 1760.37,
        right: 1795.2,
        bottom: 1247.25,
        top: 1261.48,
        width: 34.83,
        height: 14.23,
        centerY: 1254.365
      }
    }
  ]);
  assert.equal(
    selected.normalizedUrl,
    "https://learn.microsoft.com/en-us/credentials/certifications/agentic-ai-business-solutions-architect/"
  );
});

test("loadPosterCatalog falls back to the last valid catalog", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-catalog-"));
  const catalogFile = path.join(cacheRoot, "poster", "catalog.json");
  const previous = {
    schemaVersion: 1,
    entries: [
      {
        code: "AI-901",
        title: "Introduction to AI",
        url: "https://learn.microsoft.com/ai-901"
      }
    ],
    poster: { status: "cached" }
  };
  await fs.mkdir(path.dirname(catalogFile), { recursive: true });
  await fs.writeFile(catalogFile, JSON.stringify(previous), "utf8");
  const events = [];

  const result = await loadPosterCatalog(
    {
      cacheRoot,
      posterUrl: "https://example.invalid/poster.pdf",
      refreshPosterOnStart: true
    },
    {
      fetchPosterBinary: async () => {
        throw new Error("poster unavailable");
      },
      onEvent: (event) => events.push(event)
    }
  );

  assert.deepEqual(result, previous);
  assert.equal(events.at(-1).severity, "warn");
  assert.match(events.at(-1).message, /Using cached poster catalog/);
});
