const fs = require("node:fs/promises");
const path = require("node:path");
const { loadPosterCatalog } = require("../catalog/service");
const {
  buildOutputDirectories,
  convertCourseFromResolution,
  resolveCourseFromUrl
} = require("../converter/service");
const { emitProgress } = require("../progress");
const {
  dateStamp,
  learningPathHierarchyCacheFile,
  relativePosix,
  throwIfAborted,
  timestampStamp
} = require("../shared");
const { fetchCached, readJson, writeJson } = require("../lib");
const { validatePdf } = require("../validate");
const {
  compareLearningPathReport,
  expectedLearningPathFromHierarchy,
  summarizeCourseStatus
} = require("./audit");
const {
  manifestSnapshot,
  resolutionSnapshot,
  serializeError
} = require("./diagnostics");
const { makeQaMarkdownReport } = require("./report");
const { sumCourses, sumPathAudits } = require("./totals");

function failedCourseResult(root, appConfig, eventLogFile, item, options = {}) {
  const { resolution = null, manifest = null, error, courseEvents = [], courseEventStart = 0 } = options;
  const courseCode =
    resolution?.courseCode ||
    manifest?.courseCode ||
    item.courseCode ||
    "(unresolved)";
  const courseTitle = resolution?.courseTitle || manifest?.courseTitle || "";
  const courseUrl = resolution?.courseUrl || manifest?.courseUrl || "";
  const inputUrl = item.url || resolution?.originalUrl || courseUrl;
  const reportDirectory =
    resolution && manifest?.generatedDate
      ? relativePosix(
          root,
          path.join(
            appConfig.outputRoot,
            "reports",
            `${resolution.courseCode}-${manifest.generatedDate}`
          )
        )
      : "";
  const manifestFile =
    manifest?.generatedDate && courseCode && courseCode !== "(unresolved)"
      ? relativePosix(
          root,
          path.join(
            appConfig.outputRoot,
            "reports",
            `${courseCode}-${manifest.generatedDate}`,
            "course-manifest.json"
          )
        )
      : "";
  return {
    courseCode,
    courseTitle,
    inputUrl,
    courseUrl,
    status: "failed",
    learningPathCount: resolution?.learningPathUids?.length || 0,
    exportedLearningPathCount: manifest?.learningPaths?.length || 0,
    passedLearningPathCount: 0,
    totals: {
      learningPaths: resolution?.learningPathUids?.length || 0,
      modules: 0,
      units: 0,
      assessmentQuestions: 0,
      imagesEmbedded: 0,
      imagesMissing: 0,
      externalResources: 0
    },
    issues: [error.message],
    learningPaths: [],
    reportDirectory,
    diagnostics: {
      resolution: resolutionSnapshot(resolution),
      manifest: manifestSnapshot(manifest),
      manifestFile,
      conversionError: serializeError(error),
      eventCount: courseEvents.length,
      eventLog: relativePosix(root, eventLogFile),
      recentEvents: courseEvents,
      queueEventOffset: courseEventStart
    }
  };
}

async function loadHierarchyExpectation(appConfig, resolution, uid, options) {
  const hierarchyText = await fetchCached(
    `https://learn.microsoft.com/api/hierarchy/paths/${uid}`,
    learningPathHierarchyCacheFile(
      appConfig.cacheRoot,
      resolution.courseCode,
      uid
    ),
    {
      refresh: options.refresh,
      signal: options.signal,
      onEvent: options.onEvent,
      progress: {
        transferKind: "qa-hierarchy",
        transferLabel: `QA hierarchy ${uid}`,
        scope: {
          courseCode: resolution.courseCode,
          learningPathUid: uid
        }
      }
    }
  );
  return expectedLearningPathFromHierarchy(uid, JSON.parse(hierarchyText));
}

async function auditLearningPathExport(root, appConfig, resolution, manifest, manifestEntry, options) {
  const expected = await loadHierarchyExpectation(appConfig, resolution, manifestEntry.uid, options);
  const reportDirectory = buildOutputDirectories(
    appConfig,
    resolution.courseCode,
    manifest.generatedDate
  ).reportDirectory;
  const fileBase = path.basename(manifestEntry.pdf || "", ".pdf");
  const reportFile = fileBase
    ? path.join(reportDirectory, `${fileBase}.json`)
    : "";
  const pdfFile = manifestEntry.pdf ? path.resolve(root, manifestEntry.pdf) : "";
  let report = null;
  const issues = [];
  try {
    if (reportFile) report = await readJson(reportFile);
    else issues.push(`Report file could not be derived for ${manifestEntry.uid}`);
  } catch (error) {
    issues.push(`Report file missing or unreadable: ${relativePosix(root, reportFile)} (${error.message})`);
  }
  const structure = compareLearningPathReport(expected, report);
  issues.push(...structure.issues);

  let validation = null;
  if (report && pdfFile) {
    try {
      await fs.access(pdfFile);
      validation = await validatePdf(pdfFile, report);
    } catch (error) {
      issues.push(`PDF validation failed: ${error.message}`);
      validation = { status: "failed", message: error.message };
    }
  } else if (!pdfFile) {
    issues.push("PDF path missing from manifest entry");
  }

  if (manifestEntry.status !== "complete") {
    issues.push(
      `Manifest entry status is ${manifestEntry.status}${manifestEntry.error ? `: ${manifestEntry.error}` : ""}`
    );
  }

  return {
    uid: manifestEntry.uid,
    title: expected.title,
    status: issues.length ? "failed" : "pass",
    expectedModules: structure.expectedModules,
    expectedUnits: structure.expectedUnits,
    exportedModules: report?.modules?.length || 0,
    exportedUnits: report?.totals?.units || 0,
    assessmentQuestions: report?.totals?.assessmentQuestions || 0,
    imagesEmbedded: report?.images?.embedded || 0,
    imagesMissing: report?.images?.missing || 0,
    externalResources: report?.externalResources?.length || 0,
    warnings: report?.warnings || [],
    validation,
    issues,
    pdf: manifestEntry.pdf || "",
    report: reportFile ? relativePosix(root, reportFile) : "",
    reflection: manifestEntry.reflection || null,
    diagnostics: {
      manifestStatus: manifestEntry.status,
      manifestError: manifestEntry.error || "",
      manifestModules: manifestEntry.modules || 0,
      manifestUnits: manifestEntry.units || 0,
      reportOutputs: report?.outputs || null,
      reportReflection: report?.reflection || null,
      reportSourceUpdatedAt: report?.sourceUpdatedAt || null,
      externalResourceItems: report?.externalResources || [],
      imageItems: report?.images?.items || []
    }
  };
}

async function auditCourseExport(root, appConfig, resolution, manifest, options) {
  const courseIssues = [];
  if (!manifest) {
    return {
      courseCode: resolution.courseCode,
      courseTitle: resolution.courseTitle,
      inputUrl: resolution.originalUrl || resolution.courseUrl,
      courseUrl: resolution.courseUrl,
      status: "failed",
      learningPathCount: resolution.learningPathUids.length,
      exportedLearningPathCount: 0,
      passedLearningPathCount: 0,
      totals: {
        learningPaths: resolution.learningPathUids.length,
        modules: 0,
        units: 0,
        assessmentQuestions: 0,
        imagesEmbedded: 0,
        imagesMissing: 0,
        externalResources: 0
      },
      issues: ["Course manifest was not produced"],
      learningPaths: [],
      reportDirectory: "",
      diagnostics: {
        resolution: resolutionSnapshot(resolution),
        manifest: null,
        manifestFile: "",
        conversionError: null,
        eventCount: options.courseEvents?.length || 0,
        eventLog: options.eventLog || "",
        recentEvents: options.courseEvents || []
      }
    };
  }

  const reportDirectory = path.join(
    appConfig.outputRoot,
    "reports",
    `${resolution.courseCode}-${manifest.generatedDate}`
  );
  if (manifest.learningPaths.length !== resolution.learningPathUids.length) {
    courseIssues.push(
      `Learning-path count mismatch: expected ${resolution.learningPathUids.length}, found ${manifest.learningPaths.length}`
    );
  }
  for (const uid of resolution.learningPathUids) {
    if (!manifest.learningPaths.some((entry) => entry.uid === uid)) {
      courseIssues.push(`Manifest is missing learning-path UID ${uid}`);
    }
  }

  const pathAudits = [];
  for (const manifestEntry of manifest.learningPaths) {
    throwIfAborted(options.signal);
    emitProgress(options.onEvent, {
      severity: "info",
      stage: "qa-path",
      courseCode: resolution.courseCode,
      learningPathUid: manifestEntry.uid,
      message: `Auditing exported learning path ${manifestEntry.title || manifestEntry.uid}`
    });
    pathAudits.push(
      await auditLearningPathExport(root, appConfig, resolution, manifest, manifestEntry, options)
    );
  }

  const passedLearningPathCount = pathAudits.filter(
    (audit) => audit.status === "pass"
  ).length;
  const totals = sumPathAudits(pathAudits);

  return {
    courseCode: resolution.courseCode,
    courseTitle: resolution.courseTitle,
    inputUrl: resolution.originalUrl || resolution.courseUrl,
    courseUrl: resolution.courseUrl,
    status: summarizeCourseStatus(courseIssues, pathAudits),
    learningPathCount: resolution.learningPathUids.length,
    exportedLearningPathCount: pathAudits.length,
    passedLearningPathCount,
    totals,
    issues: courseIssues,
    learningPaths: pathAudits,
    reportDirectory: relativePosix(root, reportDirectory),
    diagnostics: {
      resolution: resolutionSnapshot(resolution),
      manifest: manifestSnapshot(manifest),
      manifestFile: relativePosix(
        root,
        path.join(reportDirectory, "course-manifest.json")
      ),
      conversionError: options.conversionError || null,
      eventCount: options.courseEvents?.length || 0,
      eventLog: options.eventLog || "",
      recentEvents: options.courseEvents || []
    }
  };
}

async function buildQaQueue(appConfig, options) {
  if (options.allPoster) {
    const catalog = await (options.loadPosterCatalog || loadPosterCatalog)(appConfig, {
      refresh: options.posterRefresh,
      signal: options.signal,
      onEvent: options.onEvent
    });
    return {
      scope: "poster-catalog",
      poster: catalog.poster || null,
      items: catalog.entries.map((entry) => ({
        url: entry.url,
        courseCode: entry.code,
        selectedCredentialUrl: entry.url,
        posterInfo: {
          posterUrl: catalog.poster?.url || appConfig.posterUrl,
          retrievedAt: catalog.poster?.retrievedAt || null
        }
      }))
    };
  }
  return {
    scope: "explicit-urls",
    poster: null,
    items: (options.urls || []).map((url, index) => ({
      url,
      courseCode: index === 0 ? options.courseCode || "" : "",
      selectedCredentialUrl: url,
      posterInfo: null
    }))
  };
}

async function runQaSuite(options) {
  const {
    appConfig,
    root,
    refresh = appConfig.refreshCourseContent,
    posterRefresh = appConfig.refreshPosterOnStart,
    urls = [],
    allPoster = false,
    courseCode = "",
    signal,
    onEvent,
    dependencies = {}
  } = options;
  const resolveCourse = dependencies.resolveCourseFromUrl || resolveCourseFromUrl;
  const convertCourse =
    dependencies.convertCourseFromResolution || convertCourseFromResolution;
  const auditCourse = dependencies.auditCourseExport || auditCourseExport;
  const runId = timestampStamp();
  const qaDirectory = path.join(appConfig.outputRoot, "reports", "qa", runId);
  await fs.mkdir(qaDirectory, { recursive: true });
  const eventLogFile = path.join(qaDirectory, "qa-events.jsonl");
  const eventLogState = {
    queue: Promise.resolve()
  };
  const qaEvents = [];
  const emitQaEvent = (event) => {
    if (!event) return;
    qaEvents.push(event);
    eventLogState.queue = eventLogState.queue
      .then(() =>
        fs.appendFile(eventLogFile, `${JSON.stringify(event)}\n`, "utf8")
      )
      .catch(() => {});
    if (onEvent) onEvent(event);
  };
  await fs.writeFile(eventLogFile, "", "utf8");
  const queue = await buildQaQueue(appConfig, {
    urls,
    allPoster,
    courseCode,
    posterRefresh,
    signal,
    onEvent: emitQaEvent,
    loadPosterCatalog: dependencies.loadPosterCatalog
  });
  const courseResults = [];

  for (const item of queue.items) {
    throwIfAborted(signal);
    const courseEvents = [];
    const courseEventStart = qaEvents.length;
    const courseReporter = (event) => {
      courseEvents.push(event);
      emitQaEvent(event);
    };
    emitProgress(courseReporter, {
      severity: "info",
      stage: "qa-course",
      courseCode: item.courseCode,
      message: `Starting QA for ${item.url}`
    });
    let resolution;
    let manifest = null;
    let conversionError = null;
    try {
      resolution = await resolveCourse(item.url, {
        appConfig,
        refresh,
        courseCodeOverride: item.courseCode || "",
        onEvent: courseReporter,
        signal
      });
      const conversion = await convertCourse(resolution, {
        appConfig,
        root,
        refresh,
        signal,
        onEvent: courseReporter,
        selectedCredentialUrl: item.selectedCredentialUrl || item.url,
        posterInfo: item.posterInfo,
        stamp: dateStamp()
      });
      manifest = conversion.manifest;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      manifest = error.manifest || manifest;
      conversionError = serializeError(error);
      if (!resolution) {
        const failedCourse = failedCourseResult(
          root,
          appConfig,
          eventLogFile,
          item,
          {
            manifest,
            error,
            courseEvents,
            courseEventStart
          }
        );
        courseResults.push(failedCourse);
        emitProgress(courseReporter, {
          severity: "error",
          stage: "qa-course-complete",
          courseCode: failedCourse.courseCode,
          message: `QA failed for ${failedCourse.courseCode}: ${error.message}`
        });
        continue;
      }
    }
    let courseAudit;
    try {
      courseAudit = await auditCourse(
        root,
        appConfig,
        resolution,
        manifest,
        {
          refresh: false,
          signal,
          onEvent: courseReporter,
          conversionError,
          courseEvents,
          eventLog: relativePosix(root, eventLogFile)
        }
      );
    } catch (error) {
      if (error.name === "AbortError") throw error;
      courseAudit = failedCourseResult(root, appConfig, eventLogFile, item, {
        resolution,
        manifest,
        error,
        courseEvents,
        courseEventStart
      });
    }
    courseResults.push(courseAudit);
    emitProgress(courseReporter, {
      severity:
        courseAudit.status === "pass"
          ? "info"
          : courseAudit.status === "partial"
            ? "warn"
            : "error",
      stage: "qa-course-complete",
      courseCode: courseAudit.courseCode,
      message: `QA ${courseAudit.status} for ${courseAudit.courseCode}`
    });
  }

  const summary = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    scope: queue.scope,
    requestedCourses: queue.items.length,
    completedCourses: courseResults.filter((course) => course.status === "pass").length,
    partialCourses: courseResults.filter((course) => course.status === "partial").length,
    failedCourses: courseResults.filter((course) => course.status === "failed").length,
    poster: queue.poster,
    courses: courseResults,
    totals: sumCourses(courseResults)
  };
  const summaryJson = path.join(qaDirectory, "qa-summary.json");
  const summaryMarkdown = path.join(qaDirectory, "qa-summary.md");
  summary.eventLog = relativePosix(root, eventLogFile);
  summary.eventCount = qaEvents.length;
  await writeJson(summaryJson, summary);
  await fs.writeFile(summaryMarkdown, makeQaMarkdownReport(summary), "utf8");
  await eventLogState.queue;
  emitProgress(emitQaEvent, {
    severity:
      summary.failedCourses || summary.partialCourses ? "warn" : "info",
    stage: "qa-complete",
    message:
      summary.failedCourses || summary.partialCourses
        ? `QA finished with ${summary.partialCourses} partial and ${summary.failedCourses} failed course(s)`
        : `QA finished successfully for ${summary.completedCourses} course(s)`
  });
  await eventLogState.queue;
  return {
    summary,
    summaryJson,
    summaryMarkdown,
    qaDirectory,
    eventLog: eventLogFile
  };
}

module.exports = {
  compareLearningPathReport,
  makeQaMarkdownReport,
  runQaSuite,
  summarizeCourseStatus
};
