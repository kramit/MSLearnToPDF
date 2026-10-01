const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  containsValidationText,
  normalizeForSearch,
  validatePdf
} = require("../src/validate");

function makePdf(pages) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  pages.forEach((text, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
    const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    );
  });
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

const validReport = {
  schemaVersion: 4,
  learningPath: { title: "Sample Learning Path" },
  modules: [{ title: "Module One", units: [{ title: "Unit One", validationText: "A distinctive validation sample." }] }],
  totals: { answerCount: 0 }
};

async function temporaryPdf(t, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-pdf-validation-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pdfFile = path.join(directory, "fixture.pdf");
  await fs.writeFile(pdfFile, bytes);
  return pdfFile;
}

test("normalizes PDF punctuation and spacing for reliable text matching", () => {
  assert.equal(
    normalizeForSearch("What is a large language model (LLM) ?"),
    normalizeForSearch("What is a large language model (LLM)?")
  );
  assert.equal(
    normalizeForSearch("Microsoft\u00a0Entra—ID"),
    "microsoft entra id"
  );
});

test("matches validation samples when a heading separates sentences", () => {
  const searchableText = normalizeForSearch(
    "Azure Administrators prepare for planned and unplanned failures. " +
      "Things to know about maintenance planning " +
      "An availability plan for Azure virtual machines."
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Azure Administrators prepare for planned and unplanned failures. An availability"
    ),
    true
  );
});

test("matches validation samples separated by a numbered list", () => {
  const searchableText = normalizeForSearch(
    "Restoring deleted email messages is a two-step process: 1. Recover the deleted data"
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Restoring deleted email messages is a two-step process: Recover the"
    ),
    true
  );
});

test("does not accept validation samples with missing sentence fragments", () => {
  const searchableText = normalizeForSearch(
    "Azure Administrators prepare for planned and unplanned failures."
  );

  assert.equal(
    containsValidationText(
      searchableText,
      "Azure Administrators prepare for planned and unplanned failures. An availability"
    ),
    false
  );
});

test("validates required content and reports privacy-safe page milestones and resource measurements", async (t) => {
  const pdfFile = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample."
  ]));
  const progress = [];
  const result = await validatePdf(pdfFile, validReport, { onProgress: (event) => progress.push(event) });

  assert.equal(result.status, "pass");
  assert.equal(result.pages, 1);
  assert.equal(result.modulesVerified, 1);
  assert.equal(result.unitsVerified, 1);
  assert.ok(result.pdfBytes > 0);
  assert.ok(result.elapsedMs >= 0);
  assert.ok(result.cpuUserMs >= 0);
  assert.ok(result.peakRssBytes > 0);
  assert.deepEqual(progress.map((event) => event.phase), [
    "start", "pages-loaded", "page-start", "page-milestone", "complete"
  ]);
  assert.equal(JSON.stringify(progress).includes("A distinctive validation sample"), false);
});

test("preserves required-text checks without exposing missing document text in errors", async (t) => {
  const pdfFile = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One"
  ]));
  await assert.rejects(
    validatePdf(pdfFile, validReport),
    (error) => {
      assert.equal(error.code, "PDF_VALIDATION_REQUIRED_TEXT_MISSING");
      assert.match(error.message, /1 check/);
      assert.equal(error.message.includes("A distinctive validation sample"), false);
      return true;
    }
  );
});

test("enforces PDF byte and page limits before validation completes", async (t) => {
  const pdfFile = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample.",
    "Second page has enough text to pass blank-page validation."
  ]));
  await assert.rejects(validatePdf(pdfFile, validReport, { maxPdfBytes: 1 }), {
    code: "PDF_VALIDATION_SIZE_LIMIT"
  });
  await assert.rejects(validatePdf(pdfFile, validReport, { maxPages: 1 }), {
    code: "PDF_VALIDATION_PAGE_LIMIT"
  });
});

test("kills validation when its wall-clock budget expires", async (t) => {
  const pdfFile = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample."
  ]));
  await assert.rejects(validatePdf(pdfFile, validReport, { timeoutMs: 1 }), {
    code: "PDF_VALIDATION_TIMEOUT"
  });
});

test("reports repeated milestones while validating a many-page document", async (t) => {
  const pageText = "An additional course page has enough readable text to validate.";
  const pages = [
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample.",
    ...Array.from({ length: 39 }, () => pageText)
  ];
  const pdfFile = await temporaryPdf(t, makePdf(pages));
  const progress = [];
  const result = await validatePdf(pdfFile, validReport, { onProgress: (event) => progress.push(event) });

  assert.equal(result.pages, 40);
  assert.deepEqual(
    progress.filter((event) => event.phase === "page-milestone").map((event) => event.pageNumber),
    [10, 20, 30, 40]
  );
});

test("rejects malformed PDF input with a text-safe failure", async (t) => {
  const pdfFile = await temporaryPdf(t, Buffer.from("this is not a PDF"));
  await assert.rejects(validatePdf(pdfFile, validReport), {
    code: "PDF_VALIDATION_FAILED",
    message: "PDF could not be parsed or validated"
  });
});

test("retains blank-page and source-order checks", async (t) => {
  const withBlankPage = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample.",
    ""
  ]));
  await assert.rejects(validatePdf(withBlankPage, validReport), {
    code: "PDF_VALIDATION_BLANK_PAGES"
  });

  const orderReport = {
    ...validReport,
    modules: [{
      title: "Module One",
      units: [
        { title: "First Unit", validationText: "First distinctive text sample." },
        { title: "Second Unit", validationText: "Second distinctive text sample." }
      ]
    }]
  };
  const outOfOrder = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Second Unit Second distinctive text sample.",
    "First Unit First distinctive text sample."
  ]));
  await assert.rejects(validatePdf(outOfOrder, orderReport), {
    code: "PDF_VALIDATION_UNIT_ORDER",
    message: "PDF unit source-order check failed"
  });
});

test("cancels the isolated validator when the caller aborts", async (t) => {
  const pdfFile = await temporaryPdf(t, makePdf([
    "Sample Learning Path Source and attribution Module One Unit One A distinctive validation sample."
  ]));
  const controller = new AbortController();
  const pending = validatePdf(pdfFile, validReport, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError", code: "PDF_VALIDATION_ABORTED" });
});
