const { learningPathParent } = require("../content");

function expectedLearningPathFromHierarchy(uid, hierarchy) {
  const parent = learningPathParent(hierarchy, uid);
  return {
    uid,
    title: parent?.title || uid,
    modules: (hierarchy.modules || []).map((module) => ({
      uid: module.uid,
      title: module.title,
      units: (module.units || []).map((unit) => ({
        uid: unit.uid,
        title: unit.title
      }))
    }))
  };
}

function compareLearningPathReport(expectedPath, report) {
  const issues = [];
  if (!report) {
    return {
      status: "failed",
      issues: ["Report JSON is missing"],
      expectedModules: expectedPath.modules.length,
      expectedUnits: expectedPath.modules.reduce(
        (sum, module) => sum + module.units.length,
        0
      )
    };
  }
  if (report.learningPath?.uid !== expectedPath.uid) {
    issues.push(
      `Learning-path UID mismatch: expected ${expectedPath.uid}, found ${report.learningPath?.uid || "(missing)"}`
    );
  }
  if (report.learningPath?.title !== expectedPath.title) {
    issues.push(
      `Learning-path title mismatch: expected "${expectedPath.title}", found "${report.learningPath?.title || "(missing)"}"`
    );
  }
  if ((report.modules || []).length !== expectedPath.modules.length) {
    issues.push(
      `Module count mismatch: expected ${expectedPath.modules.length}, found ${(report.modules || []).length}`
    );
  }
  const maxModules = Math.max(expectedPath.modules.length, report.modules?.length || 0);
  for (let moduleIndex = 0; moduleIndex < maxModules; moduleIndex += 1) {
    const expectedModule = expectedPath.modules[moduleIndex];
    const reportModule = report.modules?.[moduleIndex];
    if (!expectedModule) {
      issues.push(`Unexpected extra module in report: ${reportModule?.title || "(missing title)"}`);
      continue;
    }
    if (!reportModule) {
      issues.push(`Missing module in report: ${expectedModule.title}`);
      continue;
    }
    if (reportModule.uid !== expectedModule.uid) {
      issues.push(
        `Module UID mismatch at position ${moduleIndex + 1}: expected ${expectedModule.uid}, found ${reportModule.uid}`
      );
    }
    if (reportModule.title !== expectedModule.title) {
      issues.push(
        `Module title mismatch at position ${moduleIndex + 1}: expected "${expectedModule.title}", found "${reportModule.title}"`
      );
    }
    if ((reportModule.units || []).length !== expectedModule.units.length) {
      issues.push(
        `Unit count mismatch for module "${expectedModule.title}": expected ${expectedModule.units.length}, found ${(reportModule.units || []).length}`
      );
    }
    const maxUnits = Math.max(
      expectedModule.units.length,
      reportModule.units?.length || 0
    );
    for (let unitIndex = 0; unitIndex < maxUnits; unitIndex += 1) {
      const expectedUnit = expectedModule.units[unitIndex];
      const reportUnit = reportModule.units?.[unitIndex];
      if (!expectedUnit) {
        issues.push(
          `Unexpected extra unit in report module "${reportModule.title}": ${reportUnit?.title || "(missing title)"}`
        );
        continue;
      }
      if (!reportUnit) {
        issues.push(
          `Missing unit in report module "${expectedModule.title}": ${expectedUnit.title}`
        );
        continue;
      }
      if (reportUnit.uid !== expectedUnit.uid) {
        issues.push(
          `Unit UID mismatch in module "${expectedModule.title}" at position ${unitIndex + 1}: expected ${expectedUnit.uid}, found ${reportUnit.uid}`
        );
      }
      if (reportUnit.title !== expectedUnit.title) {
        issues.push(
          `Unit title mismatch in module "${expectedModule.title}" at position ${unitIndex + 1}: expected "${expectedUnit.title}", found "${reportUnit.title}"`
        );
      }
    }
  }
  const expectedUnits = expectedPath.modules.reduce(
    (sum, module) => sum + module.units.length,
    0
  );
  if ((report.totals?.units || 0) !== expectedUnits) {
    issues.push(
      `Report totals.units mismatch: expected ${expectedUnits}, found ${report.totals?.units || 0}`
    );
  }
  return {
    status: issues.length ? "failed" : "pass",
    issues,
    expectedModules: expectedPath.modules.length,
    expectedUnits
  };
}

function summarizeCourseStatus(courseIssues, pathAudits) {
  if (courseIssues.length) {
    return pathAudits.some((audit) => audit.status === "pass") ? "partial" : "failed";
  }
  if (!pathAudits.length) return "failed";
  if (pathAudits.every((audit) => audit.status === "pass")) return "pass";
  if (pathAudits.some((audit) => audit.status === "pass")) return "partial";
  return "failed";
}

module.exports = {
  compareLearningPathReport,
  expectedLearningPathFromHierarchy,
  summarizeCourseStatus
};
