function makeQaMarkdownReport(summary) {
  const courseLines = summary.courses
    .map((course, index) => {
      const courseIssues = course.issues.length
        ? course.issues.map((issue) => `  - ${issue}`).join("\n")
        : "  - None";
      const resolutionWarnings = course.diagnostics?.resolution?.warnings?.length
        ? course.diagnostics.resolution.warnings.map((warning) => `  - ${warning}`).join("\n")
        : "  - None";
      const discoveryWarnings = course.diagnostics?.manifest?.discoveryWarnings?.length
        ? course.diagnostics.manifest.discoveryWarnings.map((warning) => `  - ${warning}`).join("\n")
        : "  - None";
      const conversionError = course.diagnostics?.conversionError;
      const paths = course.learningPaths
        .map((pathAudit, pathIndex) => {
          const pathIssues = pathAudit.issues.length
            ? pathAudit.issues.map((issue) => `    - ${issue}`).join("\n")
            : "    - None";
          const pathWarnings = pathAudit.warnings.length
            ? pathAudit.warnings.map((warning) => `    - ${warning}`).join("\n")
            : "    - None";
          return `  ${pathIndex + 1}. [${pathAudit.status.toUpperCase()}] ${pathAudit.title}
     - UID: \`${pathAudit.uid}\`
     - Expected modules/units: ${pathAudit.expectedModules}/${pathAudit.expectedUnits}
     - Exported modules/units: ${pathAudit.exportedModules}/${pathAudit.exportedUnits}
     - Assessment questions: ${pathAudit.assessmentQuestions}
     - Images embedded/missing: ${pathAudit.imagesEmbedded}/${pathAudit.imagesMissing}
     - External resources: ${pathAudit.externalResources}
     - PDF: ${pathAudit.pdf || "(missing)"}
     - Report: ${pathAudit.report || "(missing)"}
     - Validation: ${pathAudit.validation?.status || "not-run"}${pathAudit.validation?.pages ? ` (${pathAudit.validation.pages} pages)` : ""}
     - Reflection: ${pathAudit.reflection?.status || "not-recorded"}
     - Report warnings:
${pathWarnings}
     - Issues:
${pathIssues}`;
        })
        .join("\n\n");
      return `## ${index + 1}. ${course.courseCode} - ${course.courseTitle}

- Status: ${course.status}
- Input URL: ${course.inputUrl}
- Resolved course URL: ${course.courseUrl}
- Learning paths resolved/exported/passed: ${course.learningPathCount}/${course.exportedLearningPathCount}/${course.passedLearningPathCount}
- Modules exported: ${course.totals.modules}
- Units exported: ${course.totals.units}
- Assessment questions: ${course.totals.assessmentQuestions}
- Images embedded/missing: ${course.totals.imagesEmbedded}/${course.totals.imagesMissing}
- External resources retained as links: ${course.totals.externalResources}
- Reports directory: ${course.reportDirectory || "(missing)"}
- Event count: ${course.diagnostics?.eventCount || 0}
- Manifest file: ${course.diagnostics?.manifestFile || "(missing)"}
- Issues:
${courseIssues}

### Resolution Diagnostics

- Original URL: ${course.diagnostics?.resolution?.originalUrl || course.inputUrl}
- Normalized URL: ${course.diagnostics?.resolution?.normalizedUrl || "(missing)"}
- Input page type / UID: ${course.diagnostics?.resolution?.inputPageType || "(missing)"} / ${course.diagnostics?.resolution?.inputUid || "(missing)"}
- Resolved course UID: ${course.diagnostics?.resolution?.courseUid || "(missing)"}
- Course learning paths exposed by Learn: ${(course.diagnostics?.resolution?.courseLearningPathUids || []).length}
- Direct learning paths from input page: ${(course.diagnostics?.resolution?.directLearningPathUids || []).length}
- Resolution warnings:
${resolutionWarnings}

### Conversion Diagnostics

- Discovery warnings from manifest:
${discoveryWarnings}
${conversionError ? `- Conversion error: ${conversionError.message}\n- Conversion error type: ${conversionError.name}\n` : ""}${course.diagnostics?.eventLog ? `- Event log: ${course.diagnostics.eventLog}` : ""}

### Learning paths

${paths}`;
    })
    .join("\n\n");

  return `# Microsoft Learn QA summary

- Generated at: ${summary.generatedAt}
- Run ID: ${summary.runId}
- Scope: ${summary.scope}
- Requested courses: ${summary.requestedCourses}
- Courses completed: ${summary.completedCourses}
- Courses partial: ${summary.partialCourses}
- Courses failed: ${summary.failedCourses}
- Total learning paths resolved: ${summary.totals.learningPaths}
- Total learning paths passed QA: ${summary.totals.learningPathsPassed}
- Total modules exported: ${summary.totals.modules}
- Total units exported: ${summary.totals.units}
- Total assessment questions: ${summary.totals.assessmentQuestions}
- Total images embedded/missing: ${summary.totals.imagesEmbedded}/${summary.totals.imagesMissing}
- Total external resources retained as links: ${summary.totals.externalResources}
- QA event log: ${summary.eventLog || "(missing)"}

${courseLines}
`;
}

module.exports = { makeQaMarkdownReport };
