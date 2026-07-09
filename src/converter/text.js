const { resolveLearnUrl } = require("../content");

const FENCE_REGEX = /```[\s\S]*?```/g;

function field(value = "") {
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSegment(segment) {
  return segment
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactMarkdown(markdown = "") {
  const source = String(markdown).replace(/\r\n?/g, "\n");
  const parts = [];
  let lastIndex = 0;
  for (const match of source.matchAll(FENCE_REGEX)) {
    const before = compactSegment(source.slice(lastIndex, match.index));
    if (before) parts.push(before);
    parts.push(match[0].replace(/[ \t]+$/gm, "").trim());
    lastIndex = match.index + match[0].length;
  }
  const after = compactSegment(source.slice(lastIndex));
  if (after) parts.push(after);
  return parts.join("\n\n").trim();
}

function normalizeInline(value = "") {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function imageReference(alt, rawUrl, unit, config) {
  const label = normalizeInline(alt) || "image";
  const url = resolveLearnUrl(rawUrl, unit.url, config.locale, "image");
  return `IMAGE ${label} <${url}>`;
}

function normalizeLinksAndImages(markdown, unit, config) {
  return String(markdown || "")
    .replace(
      /\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
      (full, alt, imageUrl) => imageReference(alt, imageUrl, unit, config)
    )
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
      (full, alt, imageUrl) => imageReference(alt, imageUrl, unit, config)
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
      (full, label, href) => {
        const text = normalizeInline(label);
        const url = resolveLearnUrl(href, unit.url, config.locale, "link");
        return text ? `${text} <${url}>` : `<${url}>`;
      }
    );
}

function unitBody(unit, config) {
  if (unit.isAssessment && unit.assessmentQuestions?.length) {
    return unit.assessmentQuestions
      .map((question) => {
        const choices = question.choices
          .map((choice) => `- ${field(choice)}`)
          .join("\n");
        return `Q${question.questionNumber}: ${field(question.prompt)}${
          choices ? `\n${choices}` : ""
        }`;
      })
      .join("\n\n");
  }
  return compactMarkdown(
    normalizeLinksAndImages(unit.cleanMarkdown || "", unit, config)
  );
}

function renderAnswerKey(module, notice) {
  if (!module.answers?.answers?.length) return "";
  const rows = module.answers.answers
    .map((answer) => {
      const supporting = module.units.find(
        (unit) => unit.uid === answer.supportingUnitUid
      );
      return [
        `ANSWER ${answer.questionNumber}|value=${field(answer.answer)}|supportingUnit=${field(supporting?.uid || answer.supportingUnitUid)}`,
        field(answer.explanation)
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const noticeLine = notice ? `ANSWER_NOTICE|${field(notice)}\n` : "";
  return `${noticeLine}${rows}`.trim();
}

function renderLlmText(model) {
  const {
    config,
    course,
    learningPath,
    modules,
    answerNotice,
    retrievedAt,
    sourceUpdatedAt
  } = model;
  const totals = {
    modules: modules.length,
    units: modules.reduce((sum, module) => sum + module.units.length, 0),
    duration: modules.reduce(
      (sum, module) => sum + (module.durationInMinutes || 0),
      0
    ),
    assessmentQuestions: modules.reduce(
      (sum, module) => sum + module.assessmentQuestions.length,
      0
    )
  };
  const lines = [
    "MSLEARN_TEXT_EXPORT|schema=1",
    `COURSE|code=${field(config.courseCode)}|title=${field(course.title || config.courseTitle)}|url=${field(config.courseUrl)}`,
    `LEARNING_PATH|uid=${field(learningPath.uid)}|title=${field(learningPath.title)}|url=${field(learningPath.canonicalUrl)}`,
    `SNAPSHOT|retrieved=${field(retrievedAt)}|sourceUpdated=${field(sourceUpdatedAt)}`,
    `TOTALS|modules=${totals.modules}|units=${totals.units}|minutes=${totals.duration}|assessmentQuestions=${totals.assessmentQuestions}`
  ];

  if (learningPath.summary) {
    lines.push(`SUMMARY|${field(learningPath.summary)}`);
  }

  modules.forEach((module, moduleIndex) => {
    lines.push(
      "",
      `MODULE ${moduleIndex + 1}|uid=${field(module.uid)}|title=${field(module.title)}|minutes=${module.durationInMinutes || 0}`
    );
    if (module.summary) lines.push(`MODULE_SUMMARY|${field(module.summary)}`);
    module.units.forEach((unit, unitIndex) => {
      const body = unitBody(unit, config);
      lines.push(
        "",
        `UNIT ${moduleIndex + 1}.${unitIndex + 1}|uid=${field(unit.uid)}|title=${field(unit.title)}|url=${field(unit.canonicalUrl)}|minutes=${unit.durationInMinutes || 0}`,
        body
      );
    });
    const answerKey = renderAnswerKey(module, answerNotice);
    if (answerKey) {
      lines.push("", `ANSWER_KEY ${moduleIndex + 1}|moduleUid=${field(module.uid)}`, answerKey);
    }
  });

  return `${lines.filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

module.exports = {
  compactMarkdown,
  normalizeLinksAndImages,
  renderLlmText
};
