const { fork } = require("node:child_process");
const path = require("node:path");

const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 10 * 60 * 1000,
  maxPdfBytes: 128 * 1024 * 1024,
  maxPages: 1200,
  maxOldSpaceMb: 1536
});

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
  if (containsNormalizedValidationText(searchableText, normalizedValue)) return true;

  const sentenceFragments = String(value || "")
    .split(/(?<=[.!?:])\s+/u)
    .map(normalizeForSearch)
    .filter(Boolean);

  return (
    sentenceFragments.length > 1 &&
    sentenceFragments.every((fragment) => containsNormalizedValidationText(searchableText, fragment))
  );
}

function containsNormalizedValidationText(searchableText, value) {
  if (searchableText.includes(value)) return true;
  // The print template adds this annotation after outbound links. It can
  // interrupt a source sentence, but must not replace any of its words.
  const pattern = value.split(" ").join(" (?:external resource )?");
  return new RegExp(`(?:^| )${pattern}(?: |$)`, "u").test(searchableText);
}

function safeValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeValidationError = true;
  return error;
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function peakRssBytes() {
  const maxRss = process.resourceUsage().maxRSS;
  // Node reports maxRSS in KiB on all supported platforms.
  return Math.round(maxRss * 1024);
}

async function validatePdfInProcess(pdfFile, report, options = {}) {
  const { maxPdfBytes, maxPages, onProgress = () => {} } = options;
  const startedAt = process.hrtime.bigint();
  const cpuStartedAt = process.cpuUsage();
  const stat = await require("node:fs/promises").stat(pdfFile);
  if (stat.size > maxPdfBytes) {
    throw safeValidationError(
      "PDF_VALIDATION_SIZE_LIMIT",
      `PDF validation size limit exceeded (${stat.size} bytes; limit ${maxPdfBytes} bytes)`
    );
  }
  onProgress({ phase: "start", pdfBytes: stat.size, elapsedMs: Math.round(elapsedMs(startedAt)) });

  let loadingTask;
  let document;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await require("node:fs/promises").readFile(pdfFile));
    loadingTask = pdfjs.getDocument({ data, disableWorker: true });
    document = await loadingTask.promise;
    const pageCount = document.numPages;
    if (pageCount > maxPages) {
      throw safeValidationError(
        "PDF_VALIDATION_PAGE_LIMIT",
        `PDF validation page limit exceeded (${pageCount} pages; limit ${maxPages})`
      );
    }
    onProgress({ phase: "pages-loaded", pdfBytes: stat.size, pageCount, elapsedMs: Math.round(elapsedMs(startedAt)) });

    const pageTexts = [];
    const milestoneInterval = 10;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress({
        phase: "page-start",
        pageNumber,
        pageCount,
        pdfBytes: stat.size,
        elapsedMs: Math.round(elapsedMs(startedAt)),
        peakRssBytes: peakRssBytes()
      });
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(
        content.items
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      );
      page.cleanup();
      if (pageNumber % milestoneInterval === 0 || pageNumber === pageCount) {
        onProgress({
          phase: "page-milestone",
          pageNumber,
          pageCount,
          pdfBytes: stat.size,
          elapsedMs: Math.round(elapsedMs(startedAt)),
          peakRssBytes: peakRssBytes()
        });
      }
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
      const unsampledCount = units.filter((unit) => !unit.validationText).length;
      if (unsampledCount) {
        throw safeValidationError(
          "PDF_VALIDATION_SAMPLES_MISSING",
          `PDF validation samples missing (${unsampledCount} unit(s))`
        );
      }
    }
    if (report.totals.answerCount > 0) required.push("Assessment answer key");
    const missingCount = required.filter(
      (value) => !searchableText.includes(normalizeForSearch(value))
    ).length + units
      .map((unit) => unit.validationText)
      .filter(Boolean)
      .filter((value) => !containsValidationText(searchableText, value)).length;
    if (missingCount) {
      throw safeValidationError(
        "PDF_VALIDATION_REQUIRED_TEXT_MISSING",
        `Required PDF text missing (${missingCount} check(s))`
      );
    }
    const blankPages = pageTexts
      .map((text, index) => ({ text, page: index + 1 }))
      .filter((item) => item.text.length < 20)
      .map((item) => item.page);
    if (blankPages.length) {
      throw safeValidationError(
        "PDF_VALIDATION_BLANK_PAGES",
        `Blank or nearly blank PDF pages: ${blankPages.join(", ")}`
      );
    }
    let cursor = 0;
    for (const unit of units) {
      const title = normalizeForSearch(unit.title);
      const position = searchableText.indexOf(title, cursor);
      if (position < 0) {
        throw safeValidationError(
          "PDF_VALIDATION_UNIT_ORDER",
          "PDF unit source-order check failed"
        );
      }
      cursor = position + title.length;
    }

    const cpu = process.cpuUsage(cpuStartedAt);
    const result = {
      status: "pass",
      pages: pageCount,
      modulesVerified: report.modules.length,
      unitsVerified: units.length,
      blankPages,
      pdfBytes: stat.size,
      elapsedMs: Math.round(elapsedMs(startedAt)),
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      peakRssBytes: peakRssBytes()
    };
    onProgress({ phase: "complete", ...result });
    return result;
  } catch (error) {
    if (error?.safeValidationError) throw error;
    throw safeValidationError("PDF_VALIDATION_FAILED", "PDF could not be parsed or validated");
  } finally {
    if (document) await document.destroy().catch(() => {});
    else if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

function validatePdf(pdfFile, report, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) {
    const error = new Error("PDF validation was cancelled");
    error.name = "AbortError";
    error.code = "PDF_VALIDATION_ABORTED";
    return Promise.reject(error);
  }
  const limits = {
    timeoutMs: clamp(options.timeoutMs, 1, DEFAULT_LIMITS.timeoutMs, DEFAULT_LIMITS.timeoutMs),
    maxPdfBytes: clamp(options.maxPdfBytes, 1, DEFAULT_LIMITS.maxPdfBytes, DEFAULT_LIMITS.maxPdfBytes),
    maxPages: clamp(options.maxPages, 1, DEFAULT_LIMITS.maxPages, DEFAULT_LIMITS.maxPages),
    maxOldSpaceMb: clamp(options.maxOldSpaceMb, 256, DEFAULT_LIMITS.maxOldSpaceMb, DEFAULT_LIMITS.maxOldSpaceMb)
  };
  const workerFile = path.join(__dirname, "validate-worker.js");
  const worker = fork(workerFile, [], {
    execArgv: [`--max-old-space-size=${limits.maxOldSpaceMb}`],
    serialization: "json",
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const stop = (error) => {
      worker.kill("SIGKILL");
      finish(error);
    };
    const abort = () => {
      const error = new Error("PDF validation was cancelled");
      error.name = "AbortError";
      error.code = "PDF_VALIDATION_ABORTED";
      stop(error);
    };
    const timeout = setTimeout(() => {
      const error = new Error(`PDF validation exceeded its ${limits.timeoutMs}ms time budget`);
      error.code = "PDF_VALIDATION_TIMEOUT";
      stop(error);
    }, limits.timeoutMs);
    timeout.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        if (typeof options.onProgress === "function") {
          try {
            options.onProgress(message.progress);
          } catch {
            // Progress is diagnostic; reporter failures must not invalidate a checked PDF.
          }
        }
      } else if (message?.type === "result") {
        finish(null, message.result);
      } else if (message?.type === "error") {
        const error = new Error(message.message);
        error.code = message.code;
        finish(error);
      }
    });
    worker.on("error", () => {
      const error = new Error("PDF validation worker failed");
      error.code = "PDF_VALIDATION_WORKER_FAILED";
      finish(error);
    });
    worker.on("exit", (code, signalName) => {
      if (settled) return;
      const error = new Error(
        `PDF validation worker exited before completion (${signalName || code || "unknown"})`
      );
      error.code = "PDF_VALIDATION_WORKER_EXITED";
      finish(error);
    });
    worker.send({
      pdfFile: path.resolve(pdfFile),
      report,
      limits: {
        maxPdfBytes: limits.maxPdfBytes,
        maxPages: limits.maxPages
      }
    }, (error) => {
      if (!error) return;
      const failure = new Error("PDF validation worker could not be started");
      failure.code = "PDF_VALIDATION_WORKER_FAILED";
      stop(failure);
    });
  });
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

module.exports = {
  containsValidationText,
  DEFAULT_LIMITS,
  normalizeForSearch,
  validatePdf,
  validatePdfInProcess
};
