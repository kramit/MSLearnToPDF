const fs = require("node:fs/promises");
const path = require("node:path");
const { marked } = require("marked");
const {
  cleanUnitMarkdown,
  escapeHtml,
  extensionFromContentType,
  extractAssessment,
  isExternalResource,
  mimeFromExtension,
  parseFrontMatter,
  resolveLearnUrl
} = require("../content");
const { sha256 } = require("../files");
const { fetchWithProgress } = require("../network");
const { emitProgress } = require("../progress");
const { throwIfAborted } = require("../shared");
const { contentValidationText } = require("./report");

function pathProgress(base, extra = {}) {
  return {
    courseCode: base.courseCode,
    learningPathUid: base.learningPathUid,
    learningPathTitle: base.learningPathTitle,
    ...extra
  };
}

async function createImageCacheIndex(imageCacheDir) {
  return new Map(
    (await fs.readdir(imageCacheDir).catch(() => []))
      .map((name) => [name.split(".")[0], name])
  );
}

async function downloadImage(rawUrl, unit, config, context) {
  const absoluteUrl = resolveLearnUrl(rawUrl, unit.url, config.locale, "image");
  if (context.imageData.has(absoluteUrl)) return context.imageData.get(absoluteUrl);
  const cacheKey = sha256(absoluteUrl);
  try {
    throwIfAborted(context.signal);
    let data;
    let contentType = "";
    const existing = context.imageCacheIndex.get(cacheKey);
    if (existing && !context.refresh) {
      const file = path.join(context.imageCacheDir, existing);
      data = await fs.readFile(file);
      contentType = mimeFromExtension(path.extname(file));
      emitProgress(context.onEvent, {
        severity: "info",
        stage: "cache-hit",
        message: `Reused cached image ${absoluteUrl}`,
        ...pathProgress(context.progressBase, {
          unitUid: unit.uid,
          unitTitle: unit.title
        })
      });
    } else {
      emitProgress(context.onEvent, {
        severity: "info",
        stage: "download-image",
        message: `Downloading image ${absoluteUrl}`,
        ...pathProgress(context.progressBase, {
          unitUid: unit.uid,
          unitTitle: unit.title
        })
      });
      const { response, data: downloaded } = await fetchWithProgress(absoluteUrl, {
        binary: true,
        signal: context.signal,
        onEvent: context.onEvent,
        progress: {
          transferKind: "image",
          transferLabel: `Image ${unit.title}`,
          scope: pathProgress(context.progressBase, {
            unitUid: unit.uid,
            unitTitle: unit.title
          })
        }
      });
      contentType = response.headers.get("content-type") || "";
      data = downloaded;
      const cacheName = `${cacheKey}${extensionFromContentType(contentType, absoluteUrl)}`;
      await fs.writeFile(path.join(context.imageCacheDir, cacheName), data);
      context.imageCacheIndex.set(cacheKey, cacheName);
    }
    const dataUri = `data:${contentType.split(";")[0] || "image/png"};base64,${data.toString("base64")}`;
    context.imageData.set(absoluteUrl, dataUri);
    context.images.push({
      sourceUrl: absoluteUrl,
      bytes: data.length,
      status: "embedded"
    });
    return dataUri;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const warning = `Image unavailable: ${absoluteUrl} (${error.message})`;
    context.warnings.push(warning);
    context.images.push({
      sourceUrl: absoluteUrl,
      status: "missing",
      error: error.message
    });
    emitProgress(context.onEvent, {
      severity: "warn",
      stage: "warning",
      message: warning,
      ...pathProgress(context.progressBase, {
        unitUid: unit.uid,
        unitTitle: unit.title
      })
    });
    return "";
  }
}

async function renderUnit(unit, config, context) {
  throwIfAborted(context.signal);
  const parsed = parseFrontMatter(unit.markdown);
  const cleanMarkdown = cleanUnitMarkdown(parsed.body);
  const isAssessment =
    parsed.metadata.module_assessment === "true" ||
    unit.uid.endsWith(".knowledge-check");
  const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let prepared = cleanMarkdown;
  const imageReplacements = [];
  let imageIndex = 0;
  for (const match of cleanMarkdown.matchAll(imageRegex)) {
    const sourceUrl = resolveLearnUrl(match[2], unit.url, config.locale, "image");
    const dataUri = await downloadImage(match[2], unit, config, context);
    const placeholder = `https://mslearn-to-pdf.invalid/image-${imageIndex++}`;
    imageReplacements.push({
      placeholder,
      dataUri,
      alt: match[1],
      sourceUrl
    });
    prepared = prepared.replace(
      match[0],
      dataUri
        ? `![${match[1]}](${placeholder})`
        : `> **Image unavailable:** ${match[1] || "See the current Microsoft Learn unit."}`
    );
  }

  const externalResources = [];
  const html = marked.parse(prepared, {
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link") return;
      token.href = resolveLearnUrl(token.href, unit.url, config.locale, "link");
      if (isExternalResource(token.href)) {
        externalResources.push({
          url: token.href,
          text: token.text || token.href,
          unitUid: unit.uid
        });
      }
    }
  });
  context.externalResources.push(...externalResources);
  let decorated = html;
  for (const replacement of imageReplacements) {
    decorated = decorated.replaceAll(
      `src="${replacement.placeholder}"`,
      `src="${replacement.dataUri}"`
    );
    decorated = decorated.replaceAll(
      replacement.placeholder,
      escapeHtml(replacement.sourceUrl)
    );
  }
  decorated = decorated
    .replace(
      /<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g,
      (full, href, attributes, label) =>
        isExternalResource(href)
          ? `<a class="external-resource" href="${escapeHtml(href)}"${attributes}>${label}</a>`
          : full
    )
    .replace(
      /<p>(Note|Warning|Important|Tip)<\/p>/gi,
      '<div class="callout-label">$1</div>'
    );
  const assessmentQuestions = isAssessment ? extractAssessment(cleanMarkdown) : [];
  if (isAssessment) {
    decorated = `<ol class="assessment-questions">${assessmentQuestions
      .map(
        (question) => `<li>
          <p class="assessment-prompt">${escapeHtml(question.prompt)}</p>
          <ul class="assessment-choices">${question.choices
            .map((choice) => `<li>${escapeHtml(choice)}</li>`)
            .join("")}</ul>
        </li>`
      )
      .join("")}</ol>`;
  }
  return {
    ...unit,
    metadata: parsed.metadata,
    canonicalUrl:
      parsed.metadata.canonicalUrl ||
      new URL(`/${config.locale}${unit.url}`, "https://learn.microsoft.com").href,
    cleanMarkdown,
    html: decorated,
    isAssessment,
    assessmentQuestions,
    validationText: contentValidationText(cleanMarkdown, assessmentQuestions)
  };
}

function validateAnswers(module, answers) {
  const assessment = module.units.find((unit) => unit.isAssessment);
  if (!assessment) {
    module.assessmentQuestions = [];
    module.answers = null;
    if (answers) {
      throw new Error(
        `Reviewed answers were configured for ${module.uid}, but no module assessment was found`
      );
    }
    return;
  }
  module.assessmentQuestions = assessment.assessmentQuestions;
  if (!answers) {
    module.answers = null;
    return;
  }
  if (assessment.assessmentQuestions.length !== answers.answers.length) {
    throw new Error(
      `${module.uid}: ${assessment.assessmentQuestions.length} questions and ${answers.answers.length} answers`
    );
  }
  assessment.assessmentQuestions.forEach((question, index) => {
    const answer = answers.answers[index];
    if (question.questionNumber !== answer.questionNumber) {
      throw new Error(`${module.uid}: answer numbering mismatch at ${index + 1}`);
    }
    if (!question.choices.includes(answer.answer)) {
      throw new Error(
        `${module.uid}: answer for question ${question.questionNumber} is not one of the source choices`
      );
    }
    if (!module.units.some((unit) => unit.uid === answer.supportingUnitUid)) {
      throw new Error(
        `${module.uid}: supporting unit not found for question ${question.questionNumber}`
      );
    }
  });
  module.answers = answers;
}

module.exports = {
  createImageCacheIndex,
  renderUnit,
  validateAnswers
};
