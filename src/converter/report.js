function courseMetadata(html) {
  const title =
    html.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>(.*?)<\/h1>/is)?.[1] ||
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] ||
    "";
  return {
    title: title.replace(/<[^>]+>/g, "").trim(),
    description:
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] || "",
    updatedAt:
      html.match(/<meta\s+name=["']updated_at["']\s+content=["']([^"']+)/i)?.[1] || ""
  };
}

function moduleObjectives(moduleBody) {
  const listMatch =
    moduleBody.match(
      /##\s+Learning objectives\s+([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i
    ) ||
    moduleBody.match(
      /By the end of this module,\s+you(?:'|’)re able to:\s*([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i
    );
  if (listMatch) {
    return listMatch[1]
      .split("\n")
      .map((line) => line.match(/^\s*-\s+(.+)/)?.[1])
      .filter(Boolean);
  }
  const proseMatch = moduleBody.match(
    /##\s+What will we be doing\?\s+([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i
  );
  if (!proseMatch) return [];
  const objective = proseMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return objective ? [objective] : [];
}

function uniqueResources(resources) {
  const seen = new Set();
  return resources.filter((resource) => {
    const key = `${resource.unitUid}|${resource.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contentValidationText(markdown, assessmentQuestions = []) {
  const source = assessmentQuestions[0]?.prompt || markdown || "";
  const normalized = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[#>*+\-\d.\s]+/gm, "")
    .replace(/[`_*~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.split(" ").slice(0, 10).join(" ");
}

function makeMarkdownReport(report) {
  const warnings = report.warnings.length
    ? report.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- None";
  const skipped = report.externalResources.length
    ? report.externalResources
        .map((resource) => `- [${resource.text}](${resource.url})`)
        .join("\n")
    : "- None";
  const modules = report.modules
    .map(
      (module, moduleIndex) => `### ${moduleIndex + 1}. ${module.title}

- UID: \`${module.uid}\`
- Units: ${module.units.length}
- Duration: ${module.durationInMinutes} minutes
- Assessment questions: ${module.assessment.questionCount}
- Answer-key entries: ${module.assessment.answerCount}

${module.units
  .map(
    (unit, unitIndex) =>
      `${moduleIndex + 1}.${unitIndex + 1}. ${unit.title} (${unit.durationInMinutes || "?"} minutes) - ${unit.url}`
  )
  .join("\n")}`
    )
    .join("\n\n");
  return `# ${report.learningPath.title} extraction report

- Retrieved: ${report.retrievedAt}
- Course: ${report.course.url}
- Learning path UID: \`${report.learningPath.uid}\`
- Modules: ${report.modules.length}
- Units: ${report.totals.units}
- Duration: ${report.totals.durationInMinutes} minutes
- Images embedded: ${report.images.embedded}
- Assessment questions: ${report.totals.assessmentQuestions}
- Answer-key entries: ${report.totals.answerCount}
- PDF: ${report.outputs.pdf}

## Included modules and units

${modules}

## External resources retained as links

${skipped}

## Warnings

${warnings}
`;
}

module.exports = {
  contentValidationText,
  courseMetadata,
  makeMarkdownReport,
  moduleObjectives,
  uniqueResources
};
