const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { learningPathHierarchyCacheFile, slug } = require("../src/shared");

let validationImplementation = async () => ({ status: "pass", pages: 1 });

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
    validatePdf: (...args) => validationImplementation(...args)
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
  assert.match(entry.text, /^output\/AI-901-2026-07-05\/txt\/AI-901 - Synthetic learning path - 2026-07-05\.txt$/);
  assert.match(entry.pdf, /^output\/AI-901-2026-07-05\/pdf\/AI-901 - Synthetic learning path - 2026-07-05\.pdf$/);
  assert.match(entry.epub, /^output\/AI-901-2026-07-05\/epub\/AI-901 - Synthetic learning path - 2026-07-05\.epub$/);
  assert.equal(result.manifest.outputDirectory, "output/AI-901-2026-07-05");

  const textFile = path.resolve(root, entry.text);
  const text = await fs.readFile(textFile, "utf8");
  assert.match(text, /MSLEARN_TEXT_EXPORT\|schema=1/);
  assert.match(text, /UNIT 1\.1\|uid=learn\.synthetic\.unit/);
  assert.match(text, /Microsoft Learn <https:\/\/learn\.microsoft\.com\/en-us\/training\/>/);

  const fileBase = path.basename(entry.pdf, ".pdf");
  const report = await readJson(
    path.join(outputRoot, "AI-901-2026-07-05", "log", `${fileBase}.json`)
  );
  assert.equal(report.outputs.text, entry.text);
  assert.equal(report.outputs.epub, entry.epub);
  await fs.access(path.resolve(root, entry.epub));
  await fs.access(path.join(outputRoot, "AI-901-2026-07-05", "log", "course-manifest.json"));
});

test("stops a course after a bounded PDF validation failure without leaking PDF text", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-validation-limit-"));
  const cacheRoot = path.join(root, "cache");
  const outputRoot = path.join(root, "output");
  const courseCode = "ZZ-998";
  const learningPathUids = ["learn.synthetic.first", "learn.synthetic.second"];
  for (const uid of learningPathUids) {
    await writeCachedCourse(root, cacheRoot, courseCode, uid);
  }
  validationImplementation = async () => {
    const error = new Error("sensitive text from the PDF must not escape");
    error.code = "PDF_VALIDATION_TIMEOUT";
    throw error;
  };
  t.after(() => {
    validationImplementation = async () => ({ status: "pass", pages: 1 });
    return fs.rm(root, { recursive: true, force: true });
  });

  const events = [];
  const resolution = {
    originalUrl: "https://learn.microsoft.com/en-us/training/courses/zz-998",
    normalizedUrl: "https://learn.microsoft.com/en-us/training/courses/zz-998",
    inputPageType: "Course",
    courseCode,
    courseUid: "course.zz-998",
    courseTitle: "Synthetic test course",
    courseUrl: "https://learn.microsoft.com/en-us/training/courses/zz-998",
    learningPathUids,
    directLearningPathUids: learningPathUids,
    warnings: []
  };
  const appConfig = {
    outputRoot,
    cacheRoot,
    locale: "en-us",
    paperFormat: "A4",
    refreshCourseContent: false
  };

  await assert.rejects(
    convertCourseFromResolution(resolution, {
      appConfig,
      root,
      refresh: false,
      stamp: "2026-07-05",
      onEvent: (event) => events.push(event)
    }),
    (error) => {
      assert.equal(error.code, "PDF_VALIDATION_TIMEOUT");
      assert.equal(error.message, "PDF validation stopped at a configured limit");
      assert.equal(error.manifest.learningPaths.length, 1);
      assert.equal(error.manifest.learningPaths[0].validationErrorCode, "PDF_VALIDATION_TIMEOUT");
      assert.equal(error.manifest.learningPaths[0].error, "PDF validation stopped at a configured limit");
      assert.equal(events.filter((event) => event.stage === "path-start").length, 1);
      assert.equal(JSON.stringify(events).includes("sensitive text from the PDF"), false);
      return true;
    }
  );
});
