const fs = require("node:fs/promises");

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForSearch(value) {
  return normalize(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsValidationText(searchableText, value) {
  const normalizedValue = normalizeForSearch(value);
  if (!normalizedValue) return true;
  if (searchableText.includes(normalizedValue)) return true;

  const sentenceFragments = String(value || "")
    .split(/(?<=[.!?])\s+/u)
    .map(normalizeForSearch)
    .filter(Boolean);

  return (
    sentenceFragments.length > 1 &&
    sentenceFragments.every((fragment) => searchableText.includes(fragment))
  );
}

async function validatePdf(pdfFile, report) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(pdfFile));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(
      content.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  const fullText = normalize(pageTexts.join(" "));
  const searchableText = normalizeForSearch(fullText);
  const units = report.modules.flatMap((module) => module.units);
  const required = [
    report.learningPath.title,
    "Source and attribution",
    ...report.modules.map((module) => module.title),
    ...units.map((unit) => unit.title)
  ];
  if (report.schemaVersion >= 4) {
    const unsampledUnits = units.filter((unit) => !unit.validationText);
    if (unsampledUnits.length) {
      throw new Error(
        `PDF validation samples missing for: ${unsampledUnits
          .map((unit) => unit.title)
          .join(" | ")}`
      );
    }
  }
  if (report.totals.answerCount > 0) required.push("Assessment answer key");
  const missing = [
    ...required.filter(
    (value) => !searchableText.includes(normalizeForSearch(value))
    ),
    ...units
      .map((unit) => unit.validationText)
      .filter(Boolean)
      .filter((value) => !containsValidationText(searchableText, value))
  ];
  if (missing.length) {
    throw new Error(`Required PDF text missing: ${missing.join(" | ")}`);
  }
  const blankPages = pageTexts
    .map((text, index) => ({ text, page: index + 1 }))
    .filter((item) => item.text.length < 20)
    .map((item) => item.page);
  if (blankPages.length) {
    throw new Error(`Blank or nearly blank PDF pages: ${blankPages.join(", ")}`);
  }
  let cursor = 0;
  for (const unit of units) {
    const title = normalizeForSearch(unit.title);
    const position = searchableText.indexOf(title, cursor);
    if (position < 0) {
      throw new Error(`Unit is not present in source order: ${unit.title}`);
    }
    cursor = position + title.length;
  }
  return {
    status: "pass",
    pages: document.numPages,
    modulesVerified: report.modules.length,
    unitsVerified: units.length,
    blankPages
  };
}

module.exports = {
  containsValidationText,
  normalizeForSearch,
  validatePdf
};
