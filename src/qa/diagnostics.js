function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack || "",
    manifestAvailable: Boolean(error.manifest)
  };
}

function manifestSnapshot(manifest) {
  if (!manifest) return null;
  return {
    courseCode: manifest.courseCode,
    courseUid: manifest.courseUid,
    courseTitle: manifest.courseTitle,
    courseUrl: manifest.courseUrl,
    originalInputUrl: manifest.originalInputUrl,
    normalizedInputUrl: manifest.normalizedInputUrl,
    selectedCredentialUrl: manifest.selectedCredentialUrl,
    inputPageType: manifest.inputPageType,
    inputUid: manifest.inputUid,
    generatedDate: manifest.generatedDate,
    outputDirectory: manifest.outputDirectory,
    poster: manifest.poster || null,
    discoveryWarnings: manifest.discoveryWarnings || [],
    learningPaths: (manifest.learningPaths || []).map((entry) => ({
      uid: entry.uid,
      title: entry.title,
      status: entry.status,
      modules: entry.modules,
      units: entry.units,
      pdf: entry.pdf,
      error: entry.error || "",
      reflection: entry.reflection || null,
      validation: entry.validation || null
    }))
  };
}

function resolutionSnapshot(resolution) {
  if (!resolution) return null;
  return {
    originalUrl: resolution.originalUrl || "",
    normalizedUrl: resolution.normalizedUrl || "",
    inputPageType: resolution.inputPageType || "",
    inputUid: resolution.inputUid || "",
    courseCode: resolution.courseCode || "",
    courseUid: resolution.courseUid || "",
    courseTitle: resolution.courseTitle || "",
    courseUrl: resolution.courseUrl || "",
    learningPathUids: resolution.learningPathUids || [],
    directLearningPathUids: resolution.directLearningPathUids || [],
    courseLearningPathUids: resolution.courseLearningPathUids || [],
    warnings: resolution.warnings || []
  };
}

module.exports = {
  manifestSnapshot,
  resolutionSnapshot,
  serializeError
};
