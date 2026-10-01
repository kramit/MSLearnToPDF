const { validatePdfInProcess } = require("./validate");

process.once("message", async (message) => {
  try {
    const result = await validatePdfInProcess(message.pdfFile, message.report, {
      ...message.limits,
      onProgress: (progress) => {
        if (process.connected) process.send({ type: "progress", progress });
      }
    });
    if (!process.connected) return;
    process.send({ type: "result", result }, () => process.exit(0));
  } catch (error) {
    const safe = error?.safeValidationError;
    const code = safe ? error.code : "PDF_VALIDATION_FAILED";
    const text = safe ? error.message : "PDF could not be parsed or validated";
    if (!process.connected) return;
    process.send({ type: "error", code, message: text }, () => process.exit(1));
  }
});
