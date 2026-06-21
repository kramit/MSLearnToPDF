const path = require("node:path");

function validateReflection({ report, expectedUid, expectedTitle, fileBase }) {
  if (report.learningPath.uid !== expectedUid) {
    throw new Error(
      `Reflection check failed: expected learning-path UID ${expectedUid}, but the report contains ${report.learningPath.uid}`
    );
  }
  if (report.learningPath.title !== expectedTitle) {
    throw new Error(
      `Reflection check failed: expected title "${expectedTitle}", but the report contains "${report.learningPath.title}"`
    );
  }
  if (path.basename(report.outputs.pdf, ".pdf") !== fileBase) {
    throw new Error(
      `Reflection check failed: PDF filename does not match learning-path title "${expectedTitle}"`
    );
  }
  return {
    status: "pass",
    expectedUid,
    expectedTitle,
    filename: fileBase
  };
}

module.exports = { validateReflection };
