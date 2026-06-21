const fs = require("node:fs/promises");
const path = require("node:path");
const {
  discoverLearningPathUids,
  ensureDir,
  fetchCached,
  learningPathParent,
  readJson,
  sha256,
  writeJson
} = require("../lib");
const { renderDocument } = require("../template");
const { resolveInputUrl } = require("../resolver");
const { validatePdf } = require("../validate");
const {
  dateStamp,
  learningPathHierarchyCacheFile,
  relativePosix,
  safeFileName,
  slug,
  throwIfAborted
} = require("../shared");
const { emitProgress } = require("../progress");
const {
  contentValidationText,
  courseMetadata,
  makeMarkdownReport,
  moduleObjectives,
  uniqueResources
} = require("./report");
const {
  buildOutputDirectories,
  outputPath,
  recreateCourseOutputDirectories
} = require("./output");
const { generatePdf } = require("./pdf");
const { validateReflection } = require("./reflection");
const {
  createImageCacheIndex,
  renderUnit,
  validateAnswers
} = require("./content");

function shouldSkipCourseMembershipCheck(resolution, uid) {
  return Boolean(
    resolution.directLearningPathUids?.includes(uid) ||
      (resolution.learningPathUids.length === 1 &&
        /\/training\/paths\//i.test(resolution.normalizedUrl || ""))
  );
}

function createPathProgress(base, extra = {}) {
  return {
    courseCode: base.courseCode,
    learningPathUid: base.learningPathUid,
    learningPathTitle: base.learningPathTitle,
    ...extra
  };
}

async function resolveCourseFromUrl(input, options) {
  const {
    appConfig,
    refresh,
    courseCodeOverride = "",
    onEvent,
    signal
  } = options;
  const resolverCache = path.join(appConfig.cacheRoot, "resolver");
  const fetchHtml = (url) =>
    fetchCached(url, path.join(resolverCache, `${sha256(url)}.html`), {
      refresh,
      signal,
      onEvent,
      progress: {
        transferKind: "resolver-html",
        transferLabel: "Resolver page",
        scope: {}
      }
    });
  const fetchHierarchy = async (uid) =>
    JSON.parse(
      await fetchCached(
        `https://learn.microsoft.com/api/hierarchy/paths/${uid}`,
        path.join(resolverCache, `${slug(uid)}.json`),
        {
          refresh,
          signal,
          onEvent,
          progress: {
            transferKind: "resolver-hierarchy",
            transferLabel: `Resolver hierarchy ${uid}`,
            scope: { learningPathUid: uid }
          }
        }
      )
    );
  emitProgress(onEvent, {
    severity: "info",
    stage: "resolve",
    message: `Resolving ${input}`
  });
  const resolution = await resolveInputUrl(input, {
    fetchHtml,
    fetchHierarchy,
    courseCodeOverride,
    locale: appConfig.locale
  });
  emitProgress(onEvent, {
    severity: "info",
    stage: "resolve",
    courseCode: resolution.courseCode,
    message: `Resolved ${resolution.inputPageType} to ${resolution.courseCode} with ${resolution.learningPathUids.length} learning path(s).`
  });
  for (const warning of resolution.warnings || []) {
    emitProgress(onEvent, {
      severity: "warn",
      stage: "warning",
      courseCode: resolution.courseCode,
      message: warning
    });
  }
  return resolution;
}

async function convertLearningPath(pathConfig, options) {
  const { appConfig, root, refresh, signal, onEvent, hierarchy: suppliedHierarchy } = options;
  const hierarchyCacheFile = learningPathHierarchyCacheFile(
    appConfig.cacheRoot,
    pathConfig.courseCode,
    pathConfig.learningPathUid
  );
  const cacheRoot = path.dirname(hierarchyCacheFile);
  const markdownCacheDir = path.join(cacheRoot, "markdown");
  const imageCacheDir = path.join(cacheRoot, "images");
  await Promise.all(
    [
      markdownCacheDir,
      imageCacheDir,
      pathConfig.htmlOutputDir,
      pathConfig.pdfOutputDir,
      pathConfig.reportOutputDir
    ].map(ensureDir)
  );
  const progressBase = {
    courseCode: pathConfig.courseCode,
    learningPathUid: pathConfig.learningPathUid,
    learningPathTitle: pathConfig.learningPathTitle
  };

  emitProgress(onEvent, {
    severity: "info",
    stage: "download-course",
    courseCode: pathConfig.courseCode,
    learningPathUid: pathConfig.learningPathUid,
    learningPathTitle: pathConfig.learningPathTitle,
    message: `Fetching course ${pathConfig.courseUrl}`
  });
  const courseHtml = await fetchCached(
    pathConfig.courseUrl,
    path.join(cacheRoot, "course.html"),
    {
      refresh,
      signal,
      onEvent,
      progress: {
        transferKind: "course-html",
        transferLabel: `Course page ${pathConfig.courseCode}`,
        scope: createPathProgress(progressBase)
      }
    }
  );
  const learningPathUids = discoverLearningPathUids(courseHtml);
  if (
    !pathConfig.skipCourseMembershipCheck &&
    !learningPathUids.includes(pathConfig.learningPathUid)
  ) {
    throw new Error(`Course does not list ${pathConfig.learningPathUid}`);
  }
  const hierarchy =
    suppliedHierarchy ||
    JSON.parse(
      await fetchCached(
        `https://learn.microsoft.com/api/hierarchy/paths/${pathConfig.learningPathUid}`,
        hierarchyCacheFile,
        {
          refresh,
          signal,
          onEvent,
          progress: {
            transferKind: "learning-path-hierarchy",
            transferLabel: `Learning path hierarchy ${pathConfig.learningPathTitle}`,
            scope: createPathProgress(progressBase)
          }
        }
      )
    );
  if (
    pathConfig.expectedModuleCount !== undefined &&
    hierarchy.modules.length !== pathConfig.expectedModuleCount
  ) {
    throw new Error(
      `Expected ${pathConfig.expectedModuleCount} modules but found ${hierarchy.modules.length}`
    );
  }
  const answerData = pathConfig.answersPath
    ? await readJson(path.resolve(root, pathConfig.answersPath))
    : {
        notice:
          "Assessment questions are reproduced from Microsoft Learn. No reviewed answer key is included for this learning path.",
        modules: []
      };
  const answersByModule = new Map(
    answerData.modules.map((entry) => [entry.moduleUid, entry])
  );
  const imageCacheIndex = await createImageCacheIndex(imageCacheDir);
  const context = {
    refresh,
    signal,
    onEvent,
    progressBase,
    imageCacheDir,
    imageCacheIndex,
    imageData: new Map(),
    images: [],
    externalResources: [],
    warnings: []
  };
  const modules = [];
  for (let moduleIndex = 0; moduleIndex < hierarchy.modules.length; moduleIndex += 1) {
    throwIfAborted(signal);
    const sourceModule = hierarchy.modules[moduleIndex];
    const expectedUnits = pathConfig.expectedUnitCounts?.[moduleIndex];
    if (
      expectedUnits !== undefined &&
      sourceModule.units.length !== expectedUnits
    ) {
      throw new Error(
        `${sourceModule.uid}: expected ${expectedUnits} units but found ${sourceModule.units.length}`
      );
    }
    emitProgress(onEvent, {
      severity: "info",
      stage: "module",
      message: `Processing module ${sourceModule.title}`,
      ...createPathProgress(progressBase, {
        moduleUid: sourceModule.uid,
        moduleTitle: sourceModule.title,
        moduleIndex: moduleIndex + 1,
        moduleCount: hierarchy.modules.length
      })
    });
    const moduleCacheDir = path.join(markdownCacheDir, sourceModule.uid);
    await ensureDir(moduleCacheDir);
    const units = [];
    for (let unitIndex = 0; unitIndex < sourceModule.units.length; unitIndex += 1) {
      throwIfAborted(signal);
      const sourceUnit = sourceModule.units[unitIndex];
      const unitUrl = new URL(
        `/${pathConfig.locale}${sourceUnit.url}`,
        "https://learn.microsoft.com"
      );
      unitUrl.searchParams.set("accept", "text/markdown");
      emitProgress(onEvent, {
        severity: "info",
        stage: "unit",
        message: `Fetching unit ${sourceUnit.title}`,
        ...createPathProgress(progressBase, {
          moduleUid: sourceModule.uid,
          moduleTitle: sourceModule.title,
          moduleIndex: moduleIndex + 1,
          moduleCount: hierarchy.modules.length,
          unitUid: sourceUnit.uid,
          unitTitle: sourceUnit.title,
          unitIndex: unitIndex + 1,
          unitCount: sourceModule.units.length
        })
      });
      const markdown = await fetchCached(
        unitUrl.href,
        path.join(moduleCacheDir, `${sourceUnit.uid}.md`),
        {
          refresh,
          signal,
          headers: { accept: "text/markdown" },
          onEvent,
          progress: {
            transferKind: "unit-markdown",
            transferLabel: `Unit markdown ${sourceUnit.title}`,
            scope: createPathProgress(progressBase, {
              moduleUid: sourceModule.uid,
              moduleTitle: sourceModule.title,
              moduleIndex: moduleIndex + 1,
              moduleCount: hierarchy.modules.length,
              unitUid: sourceUnit.uid,
              unitTitle: sourceUnit.title,
              unitIndex: unitIndex + 1,
              unitCount: sourceModule.units.length
            })
          }
        }
      );
      units.push(
        await renderUnit({ ...sourceUnit, markdown }, pathConfig, context)
      );
    }
    const module = {
      ...sourceModule,
      units,
      totalModules: hierarchy.modules.length,
      objectives: moduleObjectives(units[0]?.cleanMarkdown || "")
    };
    validateAnswers(module, answersByModule.get(module.uid));
    modules.push(module);
  }

  const retrievedAt = new Date().toISOString();
  const course = { ...courseMetadata(courseHtml), url: pathConfig.courseUrl };
  const parent = learningPathParent(hierarchy, pathConfig.learningPathUid);
  if (!parent) {
    throw new Error(
      `Hierarchy for ${pathConfig.learningPathUid} did not contain a matching learning-path parent`
    );
  }
  const learningPath = {
    uid: pathConfig.learningPathUid,
    title: parent?.title || pathConfig.learningPathUid,
    summary: hierarchy.summary || "",
    canonicalUrl: new URL(
      `/${pathConfig.locale}${parent?.url || ""}`,
      "https://learn.microsoft.com"
    ).href
  };
  const sourceUpdatedAt =
    modules
      .flatMap((module) => module.units)
      .map((unit) => unit.metadata.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1) || course.updatedAt;

  emitProgress(onEvent, {
    severity: "info",
    stage: "render-html",
    message: `Rendering HTML for ${learningPath.title}`,
    ...createPathProgress(progressBase)
  });
  const html = renderDocument({
    config: pathConfig,
    course,
    learningPath,
    modules,
    answerNotice: answerData.notice,
    retrievedAt,
    sourceUpdatedAt
  });
  const fileBase = pathConfig.fileBase || pathConfig.outputBase;
  const htmlFile = path.join(pathConfig.htmlOutputDir, `${fileBase}.html`);
  const pdfFile = path.join(pathConfig.pdfOutputDir, `${fileBase}.pdf`);
  await fs.writeFile(htmlFile, html, "utf8");

  emitProgress(onEvent, {
    severity: "info",
    stage: "render-pdf",
    message: `Generating PDF ${pdfFile}`,
    ...createPathProgress(progressBase)
  });
  await generatePdf(htmlFile, pdfFile, pathConfig, signal);

  const externalResources = uniqueResources(context.externalResources);
  const reportModules = modules.map((module) => ({
    uid: module.uid,
    title: module.title,
    url: new URL(
      `/${pathConfig.locale}${module.url}`,
      "https://learn.microsoft.com"
    ).href,
    durationInMinutes: module.durationInMinutes,
    units: module.units.map((unit) => ({
      uid: unit.uid,
      title: unit.title,
      durationInMinutes: unit.durationInMinutes,
      url: unit.canonicalUrl,
      updatedAt: unit.metadata.updated_at || null,
      assessment: unit.isAssessment,
      validationText: unit.validationText
    })),
    assessment: {
      questionCount: module.assessmentQuestions.length,
      answerCount: module.answers?.answers?.length || 0,
      questions: module.assessmentQuestions
    }
  }));
  const report = {
    schemaVersion: 4,
    retrievedAt,
    sourceUpdatedAt,
    course: {
      code: pathConfig.courseCode,
      title: course.title || pathConfig.courseTitle,
      url: pathConfig.courseUrl,
      discoveredLearningPathUids: learningPathUids
    },
    learningPath,
    poster: pathConfig.poster
      ? {
          url: pathConfig.poster.url,
          retrievedAt: pathConfig.poster.retrievedAt
        }
      : null,
    selection: pathConfig.selection || null,
    reflection: {
      expectedLearningPathUid: pathConfig.learningPathUid,
      expectedLearningPathTitle: pathConfig.learningPathTitle,
      expectedPdfFileBase: fileBase
    },
    modules: reportModules,
    totals: {
      units: modules.reduce((sum, module) => sum + module.units.length, 0),
      durationInMinutes: modules.reduce(
        (sum, module) => sum + module.durationInMinutes,
        0
      ),
      assessmentQuestions: modules.reduce(
        (sum, module) => sum + module.assessmentQuestions.length,
        0
      ),
      answerCount: modules.reduce(
        (sum, module) => sum + (module.answers?.answers?.length || 0),
        0
      )
    },
    images: {
      embedded: context.images.filter((image) => image.status === "embedded").length,
      missing: context.images.filter((image) => image.status === "missing").length,
      items: context.images
    },
    externalResources,
    warnings: context.warnings,
    outputs: {
      html: outputPath(root, htmlFile),
      pdf: outputPath(root, pdfFile)
    }
  };
  const reportJsonFile = path.join(pathConfig.reportOutputDir, `${fileBase}.json`);
  const reportMarkdownFile = path.join(
    pathConfig.reportOutputDir,
    `${fileBase}.md`
  );
  await writeJson(reportJsonFile, report);
  await fs.writeFile(reportMarkdownFile, makeMarkdownReport(report), "utf8");
  emitProgress(onEvent, {
    severity: "info",
    stage: "complete-path",
    message: `Completed ${learningPath.title}`,
    ...createPathProgress(progressBase)
  });
  return { report, pdfFile, reportJsonFile, reportMarkdownFile };
}

async function convertCourseFromResolution(resolution, options) {
  const {
    appConfig,
    root,
    refresh = appConfig.refreshCourseContent,
    signal,
    onEvent,
    answersFiles = {},
    recreateOutput = true,
    selectedCredentialUrl = resolution.originalUrl,
    posterInfo = null,
    stamp = dateStamp()
  } = options;
  throwIfAborted(signal);
  const directories = buildOutputDirectories(appConfig, resolution.courseCode, stamp);
  if (recreateOutput) {
    await recreateCourseOutputDirectories(directories, appConfig);
  }
  await Promise.all(Object.values(directories).map(ensureDir));

  const manifest = {
    schemaVersion: 3,
    courseCode: resolution.courseCode,
    courseUid: resolution.courseUid || null,
    courseTitle: resolution.courseTitle,
    courseUrl: resolution.courseUrl,
    originalInputUrl: resolution.originalUrl || resolution.courseUrl,
    normalizedInputUrl: resolution.normalizedUrl || resolution.courseUrl,
    selectedCredentialUrl,
    inputPageType: resolution.inputPageType || "Course",
    inputUid: resolution.inputUid || null,
    generatedDate: stamp,
    outputDirectory: relativePosix(root, directories.pdfDirectory),
    poster: posterInfo,
    discoveryWarnings: resolution.warnings || [],
    learningPaths: []
  };
  let failedCount = 0;
  for (let index = 0; index < resolution.learningPathUids.length; index += 1) {
    throwIfAborted(signal);
    const uid = resolution.learningPathUids[index];
    emitProgress(onEvent, {
      severity: "info",
      stage: "path-start",
      courseCode: resolution.courseCode,
      learningPathUid: uid,
      message: `Preparing learning path ${index + 1} of ${resolution.learningPathUids.length}`
    });
    const manifestEntry = {
      uid,
      title: uid,
      modules: 0,
      units: 0,
      pdf: "",
      status: "pending",
      validation: null,
      reflection: null
    };
    try {
      const hierarchyText = await fetchCached(
        `https://learn.microsoft.com/api/hierarchy/paths/${uid}`,
        learningPathHierarchyCacheFile(
          appConfig.cacheRoot,
          resolution.courseCode,
          uid
        ),
        {
          refresh,
          signal,
          onEvent,
          progress: {
            transferKind: "learning-path-hierarchy",
            transferLabel: `Learning path hierarchy ${uid}`,
            scope: {
              courseCode: resolution.courseCode,
              learningPathUid: uid
            }
          }
        }
      );
      const hierarchy = JSON.parse(hierarchyText);
      const parent = learningPathParent(hierarchy, uid);
      if (!parent?.title) {
        throw new Error(`Learning-path title unavailable for ${uid}`);
      }
      const fileBase = safeFileName(
        `${resolution.courseCode} - ${parent.title} - ${stamp}`
      );
      const pathConfig = {
        courseUrl: resolution.courseUrl,
        courseCode: resolution.courseCode,
        courseUid: resolution.courseUid,
        courseTitle: resolution.courseTitle,
        learningPathUid: uid,
        learningPathTitle: parent.title,
        locale: appConfig.locale,
        paperFormat: appConfig.paperFormat,
        outputBase: slug(`${resolution.courseCode}-${parent.title}`),
        fileBase,
        pdfOutputDir: directories.pdfDirectory,
        htmlOutputDir: directories.htmlDirectory,
        reportOutputDir: directories.reportDirectory,
        answersPath: answersFiles?.[uid] || null,
        skipCourseMembershipCheck: shouldSkipCourseMembershipCheck(
          resolution,
          uid
        ),
        poster: posterInfo
          ? {
              url: posterInfo.posterUrl || posterInfo.url || "",
              retrievedAt: posterInfo.retrievedAt || null
            }
          : null,
        selection: {
          selectedCredentialUrl,
          resolvedCourseUrl: resolution.courseUrl
        }
      };
      const pdfFile = path.join(directories.pdfDirectory, `${fileBase}.pdf`);
      manifestEntry.title = parent.title;
      manifestEntry.modules = hierarchy.modules.length;
      manifestEntry.units = hierarchy.modules.reduce(
        (sum, module) => sum + module.units.length,
        0
      );
      manifestEntry.pdf = relativePosix(root, pdfFile);
      const result = await convertLearningPath(pathConfig, {
        appConfig,
        root,
        refresh,
        signal,
        onEvent,
        hierarchy
      });
      const report = result.report;
      manifestEntry.validation = await validatePdf(result.pdfFile, report);
      manifestEntry.status = "complete";
      manifestEntry.reflection = validateReflection({
        report,
        expectedUid: uid,
        expectedTitle: parent.title,
        fileBase
      });
      emitProgress(onEvent, {
        severity: "info",
        stage: "validate",
        courseCode: resolution.courseCode,
        learningPathUid: uid,
        learningPathTitle: parent.title,
        message: `Validated ${parent.title}`
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      failedCount += 1;
      manifestEntry.status = "failed";
      manifestEntry.error = error.message;
      manifestEntry.reflection = {
        status: "failed",
        message: error.message
      };
      emitProgress(onEvent, {
        severity: "error",
        stage: "failed-path",
        courseCode: resolution.courseCode,
        learningPathUid: uid,
        learningPathTitle: manifestEntry.title,
        message: `Failed ${manifestEntry.title}: ${error.message}`
      });
    }
    manifest.learningPaths.push(manifestEntry);
    await writeJson(path.join(directories.reportDirectory, "course-manifest.json"), manifest);
  }
  await writeJson(path.join(directories.reportDirectory, "course-manifest.json"), manifest);
  emitProgress(onEvent, {
    severity: failedCount ? "warn" : "info",
    stage: "complete-course",
    courseCode: resolution.courseCode,
    message: failedCount
      ? `Completed ${resolution.courseCode} with ${failedCount} failed learning path(s)`
      : `Completed ${resolution.courseCode}`
  });
  if (failedCount) {
    const error = new Error(`${failedCount} learning-path export(s) failed`);
    error.manifest = manifest;
    throw error;
  }
  return {
    manifest,
    directories
  };
}

async function convertQueue(queueItems, options) {
  const results = [];
  for (const item of queueItems) {
    try {
      const resolution = item.resolution
        ? item.resolution
        : await resolveCourseFromUrl(item.url, options);
      const result = await convertCourseFromResolution(resolution, {
        ...options,
        selectedCredentialUrl: item.selectedCredentialUrl || item.url,
        posterInfo: item.posterInfo || null
      });
      results.push({
        courseCode: resolution.courseCode,
        status: "complete",
        result
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      results.push({
        courseCode: item.resolution?.courseCode || item.courseCode || "",
        status: "failed",
        error: error.message
      });
      emitProgress(options.onEvent, {
        severity: "error",
        stage: "failed-course",
        courseCode: item.resolution?.courseCode || item.courseCode || "",
        message: error.message
      });
    }
  }
  return results;
}

module.exports = {
  buildOutputDirectories,
  contentValidationText,
  convertCourseFromResolution,
  convertLearningPath,
  convertQueue,
  makeMarkdownReport,
  resolveCourseFromUrl,
  shouldSkipCourseMembershipCheck
};
