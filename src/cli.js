#!/usr/bin/env node

const path = require("node:path");
const { loadAppConfig, DEFAULT_APP_CONFIG } = require("./app-config");
const {
  convertCourseFromResolution,
  convertLearningPath,
  resolveCourseFromUrl
} = require("./converter/service");
const { createConsoleReporter } = require("./progress");
const { discoverLearningPathUids, fetchCached, readJson } = require("./lib");
const { relativePosix, slug } = require("./shared");
const { validatePdf } = require("./validate");
const { parseCommandArgs } = require("./cli/args");

function parseArgs(argv) {
  return parseCommandArgs(
    argv,
    {
      "--config": { name: "config", kind: "value" },
      "--url": { name: "url", kind: "value" },
      "--course-code": { name: "courseCode", kind: "value" },
      "--refresh": { name: "refresh", kind: "boolean" },
      "--help": { name: "help", kind: "boolean" }
    },
    { refresh: false }
  );
}

function appConfigFromLegacy(root, legacyConfig) {
  return {
    ...DEFAULT_APP_CONFIG,
    outputRoot: path.join(root, "output"),
    cacheRoot: path.join(root, "cache"),
    locale: legacyConfig.locale || "en-us",
    paperFormat: legacyConfig.paperFormat || "A4",
    refreshPosterOnStart: false,
    refreshCourseContent: true
  };
}

async function convertLegacyConfig(root, args, legacyConfig, onEvent) {
  const appConfig = appConfigFromLegacy(root, legacyConfig);
  if (legacyConfig.allLearningPaths) {
    let learningPathUids = legacyConfig.learningPathUids || [];
    if (!learningPathUids.length) {
      const courseCache = path.join(
        appConfig.cacheRoot,
        slug(legacyConfig.courseCode),
        "course.html"
      );
      const courseHtml = await fetchCached(legacyConfig.courseUrl, courseCache, {
        refresh: args.refresh
      });
      learningPathUids = discoverLearningPathUids(courseHtml);
    }
    const resolution = {
      originalUrl: legacyConfig.originalInputUrl || legacyConfig.courseUrl,
      normalizedUrl: legacyConfig.normalizedInputUrl || legacyConfig.courseUrl,
      inputPageType: legacyConfig.inputPageType || "Course",
      inputUid: legacyConfig.inputUid || legacyConfig.courseUid || null,
      courseCode: legacyConfig.courseCode,
      courseUid: legacyConfig.courseUid || null,
      courseTitle: legacyConfig.courseTitle,
      courseUrl: legacyConfig.courseUrl,
      learningPathUids,
      warnings: legacyConfig.discoveryWarnings || []
    };
    return convertCourseFromResolution(resolution, {
      appConfig,
      root,
      refresh: args.refresh,
      onEvent,
      answersFiles: legacyConfig.answersFiles || {},
      recreateOutput: legacyConfig.recreateOutput !== false,
      selectedCredentialUrl: legacyConfig.courseUrl
    });
  }

  const outputHtmlDir = legacyConfig.htmlOutputDir
    ? path.resolve(root, legacyConfig.htmlOutputDir)
    : path.join(root, "output", "html");
  const outputPdfDir = legacyConfig.pdfOutputDir
    ? path.resolve(root, legacyConfig.pdfOutputDir)
    : path.join(root, "output", "pdf");
  const outputReportDir = legacyConfig.reportOutputDir
    ? path.resolve(root, legacyConfig.reportOutputDir)
    : path.join(root, "output", "reports");
  const pathConfig = {
    ...legacyConfig,
    htmlOutputDir: outputHtmlDir,
    pdfOutputDir: outputPdfDir,
    reportOutputDir: outputReportDir,
    locale: legacyConfig.locale || "en-us",
    paperFormat: legacyConfig.paperFormat || "A4",
    learningPathTitle: legacyConfig.learningPathTitle || legacyConfig.learningPathUid
  };
  const result = await convertLearningPath(pathConfig, {
    appConfig,
    root,
    refresh: args.refresh,
    onEvent
  });
  const report = await readJson(result.reportJsonFile);
  const validation = await validatePdf(result.pdfFile, report);
  console.log(`Validation passed: ${JSON.stringify(validation)}`);
  console.log(`PDF: ${relativePosix(root, result.pdfFile)}`);
  console.log(`Report: ${relativePosix(root, result.reportJsonFile)}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node src/cli.js --url <microsoft-learn-url> [--course-code CODE] [--refresh]
  node src/cli.js --config <file> [--refresh]`);
    return;
  }

  const root = process.cwd();
  const reporter = createConsoleReporter();
  if (args.url) {
    const appConfig = await loadAppConfig(root, args.config);
    const resolution = await resolveCourseFromUrl(args.url, {
      appConfig,
      refresh: args.refresh,
      courseCodeOverride: args.courseCode || "",
      onEvent: reporter
    });
    await convertCourseFromResolution(resolution, {
      appConfig,
      root,
      refresh: args.refresh,
      onEvent: reporter,
      selectedCredentialUrl: args.url
    });
    return;
  }

  if (!args.config) throw new Error("--url or --config is required");
  const legacyConfig = await readJson(path.resolve(root, args.config));
  await convertLegacyConfig(root, args, legacyConfig, reporter);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
