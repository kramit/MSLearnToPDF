const fs = require("node:fs/promises");
const path = require("node:path");
const { relativePosix } = require("../shared");

function buildOutputDirectories(appConfig, courseCode, stamp) {
  return {
    pdfDirectory: path.join(appConfig.outputRoot, "pdf", `${courseCode}-${stamp}`),
    htmlDirectory: path.join(appConfig.outputRoot, "html", `${courseCode}-${stamp}`),
    reportDirectory: path.join(
      appConfig.outputRoot,
      "reports",
      `${courseCode}-${stamp}`
    )
  };
}

async function recreateCourseOutputDirectories(directories, appConfig) {
  const allowedRoot = path.resolve(appConfig.outputRoot);
  for (const directory of Object.values(directories)) {
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
