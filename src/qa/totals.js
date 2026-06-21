const EMPTY_TOTALS = {
  learningPaths: 0,
  modules: 0,
  units: 0,
  assessmentQuestions: 0,
  imagesEmbedded: 0,
  imagesMissing: 0,
  externalResources: 0
};

function sumPathAudits(pathAudits) {
  return pathAudits.reduce(
    (sum, audit) => ({
      learningPaths: sum.learningPaths + 1,
      modules: sum.modules + audit.exportedModules,
      units: sum.units + audit.exportedUnits,
      assessmentQuestions: sum.assessmentQuestions + audit.assessmentQuestions,
      imagesEmbedded: sum.imagesEmbedded + audit.imagesEmbedded,
      imagesMissing: sum.imagesMissing + audit.imagesMissing,
      externalResources: sum.externalResources + audit.externalResources
    }),
    { ...EMPTY_TOTALS }
  );
}

function sumCourses(courses) {
  return courses.reduce(
    (sum, course) => ({
      learningPaths: sum.learningPaths + course.learningPathCount,
      learningPathsPassed:
        sum.learningPathsPassed + course.passedLearningPathCount,
      modules: sum.modules + course.totals.modules,
      units: sum.units + course.totals.units,
      assessmentQuestions:
        sum.assessmentQuestions + course.totals.assessmentQuestions,
      imagesEmbedded: sum.imagesEmbedded + course.totals.imagesEmbedded,
      imagesMissing: sum.imagesMissing + course.totals.imagesMissing,
      externalResources: sum.externalResources + course.totals.externalResources
    }),
    {
      ...EMPTY_TOTALS,
      learningPathsPassed: 0
    }
  );
}

module.exports = {
  EMPTY_TOTALS,
  sumCourses,
  sumPathAudits
};
