#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { generatePdf } = require("../src/converter/pdf");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-pdf-smoke-"));
  try {
    const htmlFile = path.join(directory, "smoke test.html");
    const pdfFile = path.join(directory, "smoke test.pdf");
    await fs.writeFile(
      htmlFile,
      "<!doctype html><html><body><h1>MSLearnToPDF smoke test</h1></body></html>",
      "utf8"
    );
    await generatePdf(
      htmlFile,
      pdfFile,
      { courseCode: "SMOKE", paperFormat: "A4" }
    );
    const stats = await fs.stat(pdfFile);
    if (stats.size < 1000) {
      throw new Error(`Generated PDF is unexpectedly small: ${stats.size} bytes`);
    }
    console.log(`PDF smoke test passed: ${stats.size} bytes`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
