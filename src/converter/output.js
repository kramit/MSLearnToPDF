const fs = require("node:fs/promises");
const path = require("node:path");
const { relativePosix } = require("../shared");

function buildOutputDirectories(appConfig, courseCode, stamp) {
  const bundleDirectory = path.join(appConfig.outputRoot, `${courseCode}-${stamp}`);
  return {
    bundleDirectory,
    pdfDirectory: path.join(bundleDirectory, "pdf"),
    htmlDirectory: path.join(bundleDirectory, "html"),
    textDirectory: path.join(bundleDirectory, "txt"),
    epubDirectory: path.join(bundleDirectory, "epub"),
    reportDirectory: path.join(bundleDirectory, "log"),
    logDirectory: path.join(bundleDirectory, "log")
  };
}

async function recreateCourseOutputDirectories(directories, appConfig) {
  const allowedRoot = path.resolve(appConfig.outputRoot);
  for (const directory of new Set(Object.values(directories))) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error(`Refusing to recreate unsafe output path: ${resolved}`);
    }
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

function outputPath(root, file) {
  return relativePosix(root, file);
}

module.exports = {
  buildOutputDirectories,
  outputPath,
  recreateCourseOutputDirectories
};
