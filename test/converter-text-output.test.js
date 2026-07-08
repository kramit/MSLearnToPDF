const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { learningPathHierarchyCacheFile, slug } = require("../src/shared");

const pdfModule = require.resolve("../src/converter/pdf");
require.cache[pdfModule] = {
  id: pdfModule,
  filename: pdfModule,
  loaded: true,
  exports: {
    generatePdf: async (htmlFile, pdfFile) => {
      await fs.mkdir(path.dirname(pdfFile), { recursive: true });
      await fs.writeFile(pdfFile, `PDF for ${path.basename(htmlFile)}`, "utf8");
    }
  }
};

const validateModule = require.resolve("../src/validate");
require.cache[validateModule] = {
  id: validateModule,
  filename: validateModule,
  loaded: true,
  exports: {
    validatePdf: async () => ({ status: "pass", pages: 1 })
  }
};

const { convertCourseFromResolution } = require("../src/converter/service");
const { readJson } = require("../src/lib");

async function writeCachedCourse(root, cacheRoot, courseCode, uid) {
  const hierarchyFile = learningPathHierarchyCacheFile(cacheRoot, courseCode, uid);
  const cacheDir = path.dirname(hierarchyFile);
  const hierarchy = {
    summary: "A compact synthetic learning path.",
    modules: [
      {
        uid: "learn.synthetic.module",
        title: "Synthetic module",
        url: "/training/modules/synthetic-module/",
        summary: "Module summary.",
        durationInMinutes: 15,
        parents: [
          {
            type: "learningPath",
            uid,
            title: "Synthetic learning path",
            url: "/training/paths/synthetic-path/"
          }
        ],
        units: [
          {
            uid: "learn.synthetic.unit",
            title: "Synthetic unit",
            url: "/training/modules/synthetic-module/1-intro/",
            durationInMinutes: 5
          }
        ]
      }
    ]
  };
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(hierarchyFile, JSON.stringify(hierarchy), "utf8");
  await fs.writeFile(
    path.join(cacheDir, "course.html"),
    `<html><head>
      <meta name="learn_item" content="${uid}">
      <meta property="og:title" content="Synthetic course">
      <meta name="updated_at" content="2026-07-01T00:00:00Z">
    </head><body></body></html>`,
    "utf8"
  );
  const markdownDir = path.join(cacheDir, "markdown", "learn.synthetic.module");
  await fs.mkdir(markdownDir, { recursive: true });
  await fs.writeFile(
    path.join(markdownDir, "learn.synthetic.unit.md"),
    `---
uid: learn.synthetic.unit
updated_at: 2026-07-02T00:00:00Z
---
# Synthetic unit

Completed

- 5 minutes

Use [Microsoft Learn](/en-us/training/).`,
    "utf8"
  );
}

test("course conversion writes and records text output artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-text-output-"));
  const cacheRoot = path.join(root, "cache");
  const outputRoot = path.join(root, "output");
  const courseCode = "AI-901";
  const uid = "learn.synthetic.path";
  await writeCachedCourse(root, cacheRoot, courseCode, uid);

  const resolution = {
    originalUrl: "https://learn.microsoft.com/en-us/training/courses/ai-901",
    normalizedUrl: "https://learn.microsoft.com/en-us/training/courses/ai-901",
    inputPageType: "Course",
    courseCode,
    courseUid: "course.ai-901",
    courseTitle: "Synthetic course",
    courseUrl: "https://learn.microsoft.com/en-us/training/courses/ai-901",
    learningPathUids: [uid],
    warnings: []
  };
  const appConfig = {
    outputRoot,
    cacheRoot,
    locale: "en-us",
    paperFormat: "A4",
    refreshCourseContent: false
  };

  const result = await convertCourseFromResolution(resolution, {
    appConfig,
    root,
    refresh: false,
    stamp: "2026-07-05"
  });

  const entry = result.manifest.learningPaths[0];
  assert.match(entry.text, /^output\/text\/AI-901-2026-07-05\/AI-901 - Synthetic learning path - 2026-07-05\.txt$/);

  const textFile = path.resolve(root, entry.text);
  const text = await fs.readFile(textFile, "utf8");
  assert.match(text, /MSLEARN_TEXT_EXPORT\|schema=1/);
  assert.match(text, /UNIT 1\.1\|uid=learn\.synthetic\.unit/);
  assert.match(text, /Microsoft Learn <https:\/\/learn\.microsoft\.com\/en-us\/training\/>/);

  const fileBase = path.basename(entry.pdf, ".pdf");
  const report = await readJson(
    path.join(outputRoot, "reports", "AI-901-2026-07-05", `${fileBase}.json`)
  );
  assert.equal(report.outputs.text, entry.text);
});
