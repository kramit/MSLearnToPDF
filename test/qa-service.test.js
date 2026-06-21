const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  compareLearningPathReport,
  makeQaMarkdownReport,
  runQaSuite,
  summarizeCourseStatus
} = require("../src/qa/service");

function expectedPath() {
  return {
    uid: "learn.ab-100-agentic-ai",
    title: "AB-100: Architect agentic AI business solutions",
    modules: [
      {
        uid: "module.one",
        title: "Module one",
        units: [
          { uid: "unit.one", title: "Unit one" },
          { uid: "unit.two", title: "Unit two" }
        ]
      },
      {
        uid: "module.two",
        title: "Module two",
        units: [{ uid: "unit.three", title: "Unit three" }]
      }
    ]
  };
}

function matchingReport() {
  return {
    learningPath: {
      uid: "learn.ab-100-agentic-ai",
      title: "AB-100: Architect agentic AI business solutions"
    },
    modules: [
      {
        uid: "module.one",
        title: "Module one",
        units: [
          { uid: "unit.one", title: "Unit one" },
          { uid: "unit.two", title: "Unit two" }
        ]
      },
      {
        uid: "module.two",
        title: "Module two",
        units: [{ uid: "unit.three", title: "Unit three" }]
      }
    ],
    totals: {
      units: 3
    }
  };
}

test("compareLearningPathReport passes when report matches hierarchy expectation", () => {
  const result = compareLearningPathReport(expectedPath(), matchingReport());
  assert.equal(result.status, "pass");
  assert.deepEqual(result.issues, []);
  assert.equal(result.expectedModules, 2);
  assert.equal(result.expectedUnits, 3);
});

test("compareLearningPathReport detects missing modules and units", () => {
  const report = matchingReport();
  report.modules = [report.modules[0]];
  report.totals.units = 2;
  const result = compareLearningPathReport(expectedPath(), report);
  assert.equal(result.status, "failed");
  assert.match(result.issues.join("\n"), /Module count mismatch/);
  assert.match(result.issues.join("\n"), /Missing module in report: Module two/);
  assert.match(result.issues.join("\n"), /Report totals.units mismatch/);
});

test("compareLearningPathReport detects wrong unit order and title drift", () => {
  const report = matchingReport();
  report.learningPath.title = "Wrong title";
  report.modules[0].units = [
    { uid: "unit.two", title: "Unit two" },
    { uid: "unit.one", title: "Unit one" }
  ];
  const result = compareLearningPathReport(expectedPath(), report);
  assert.equal(result.status, "failed");
  assert.match(result.issues.join("\n"), /Learning-path title mismatch/);
  assert.match(result.issues.join("\n"), /Unit UID mismatch/);
});

test("summarizeCourseStatus returns pass, partial, and failed appropriately", () => {
  assert.equal(
    summarizeCourseStatus([], [{ status: "pass" }, { status: "pass" }]),
    "pass"
  );
  assert.equal(
    summarizeCourseStatus([], [{ status: "pass" }, { status: "failed" }]),
    "partial"
  );
  assert.equal(
    summarizeCourseStatus(["missing path"], [{ status: "failed" }]),
    "failed"
  );
});

test("makeQaMarkdownReport includes detailed troubleshooting references", () => {
  const markdown = makeQaMarkdownReport({
    generatedAt: "2026-06-20T12:00:00.000Z",
    runId: "20260620-120000",
    scope: "poster-catalog",
    requestedCourses: 1,
    completedCourses: 0,
    partialCourses: 1,
    failedCourses: 0,
    eventLog: "output/reports/qa/20260620-120000/qa-events.jsonl",
    totals: {
      learningPaths: 1,
      learningPathsPassed: 0,
      modules: 2,
      units: 3,
      assessmentQuestions: 0,
      imagesEmbedded: 1,
      imagesMissing: 0,
      externalResources: 2
    },
    courses: [
      {
        courseCode: "SC-300",
        courseTitle: "Identity and Access Administrator",
        inputUrl: "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/",
        courseUrl: "https://learn.microsoft.com/en-us/training/courses/sc-300t00",
        status: "partial",
        learningPathCount: 2,
        exportedLearningPathCount: 1,
        passedLearningPathCount: 0,
        totals: {
          modules: 2,
          units: 3,
          assessmentQuestions: 0,
          imagesEmbedded: 1,
          imagesMissing: 0,
          externalResources: 2
        },
        issues: ["Manifest is missing learning-path UID learn.wwl.explore-identity-azure-active-directory"],
        reportDirectory: "output/reports/SC-300-2026-06-20",
        diagnostics: {
          eventCount: 12,
          eventLog: "output/reports/qa/20260620-120000/qa-events.jsonl",
          manifestFile: "output/reports/SC-300-2026-06-20/course-manifest.json",
          resolution: {
            originalUrl: "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/",
            normalizedUrl: "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/",
            inputPageType: "Certification",
            inputUid: "certification.identity-and-access-administrator",
            courseUid: "course.sc-300t00",
            courseLearningPathUids: ["learn.wwl.explore-identity-azure-active-directory"],
            directLearningPathUids: [],
            warnings: ["Skipping unavailable learning path exposed by Microsoft Learn: learn.wwl.explore-identity-azure-active-directory."]
          },
          manifest: {
            discoveryWarnings: ["Learning path removed from upstream hierarchy"]
          },
          conversionError: {
            name: "Error",
            message: "1 learning-path export(s) failed"
          }
        },
        learningPaths: [
          {
            status: "failed",
            title: "Implement identity management solution",
            uid: "learn.wwl.implement-identity-management-solution",
            expectedModules: 2,
            expectedUnits: 3,
            exportedModules: 2,
            exportedUnits: 3,
            assessmentQuestions: 0,
            imagesEmbedded: 1,
            imagesMissing: 0,
            externalResources: 2,
            pdf: "output/pdf/SC-300-2026-06-20/example.pdf",
            report: "output/reports/SC-300-2026-06-20/example.json",
            validation: { status: "failed", pages: 10 },
            reflection: { status: "failed" },
            warnings: ["Image unavailable: https://example.invalid/example.png"],
            issues: ["PDF validation failed: Required PDF text missing"]
          }
        ]
      }
    ]
  });

  assert.match(markdown, /QA event log: output\/reports\/qa\/20260620-120000\/qa-events\.jsonl/);
  assert.match(markdown, /Manifest file: output\/reports\/SC-300-2026-06-20\/course-manifest\.json/);
  assert.match(markdown, /Resolution Diagnostics/);
  assert.match(markdown, /Conversion Diagnostics/);
  assert.match(markdown, /Report warnings:/);
});

test("runQaSuite orchestrates an explicit URL and writes consolidated artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-qa-"));
  const appConfig = {
    outputRoot: path.join(root, "output"),
    cacheRoot: path.join(root, "cache"),
    refreshCourseContent: false,
    refreshPosterOnStart: false
  };
  const resolution = {
    originalUrl: "https://learn.microsoft.com/input",
    courseCode: "AI-901",
    courseTitle: "Introduction to AI",
    courseUrl: "https://learn.microsoft.com/course",
    learningPathUids: ["learn.one"]
  };
  const manifest = {
    generatedDate: "2026-06-21",
    learningPaths: [{ uid: "learn.one", status: "complete" }]
  };

  const result = await runQaSuite({
    appConfig,
    root,
    urls: [resolution.originalUrl],
    dependencies: {
      resolveCourseFromUrl: async () => resolution,
      convertCourseFromResolution: async () => ({ manifest }),
      auditCourseExport: async () => ({
        courseCode: "AI-901",
        courseTitle: "Introduction to AI",
        inputUrl: resolution.originalUrl,
        courseUrl: resolution.courseUrl,
        status: "pass",
        learningPathCount: 1,
        exportedLearningPathCount: 1,
        passedLearningPathCount: 1,
        totals: {
          learningPaths: 1,
          modules: 2,
          units: 5,
          assessmentQuestions: 1,
          imagesEmbedded: 2,
          imagesMissing: 0,
          externalResources: 1
        },
        issues: [],
        learningPaths: [],
        reportDirectory: "output/reports/AI-901-2026-06-21",
        diagnostics: {}
      })
    }
  });

  assert.equal(result.summary.completedCourses, 1);
  assert.equal(result.summary.totals.units, 5);
  await fs.access(result.summaryJson);
  await fs.access(result.summaryMarkdown);
  await fs.access(result.eventLog);
});
