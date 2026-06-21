#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");

async function main() {
  const [pdfPath, outputDirectory] = process.argv.slice(2);
  if (!pdfPath || !outputDirectory) {
    throw new Error("Usage: node src/render-pdf.js <pdf> <output-directory>");
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const name of await fs.readdir(outputDirectory)) {
    if (/^page-\d+\.png$/.test(name)) {
      await fs.unlink(path.join(outputDirectory, name));
    }
  }
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.55 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const file = path.join(
      outputDirectory,
      `page-${String(pageNumber).padStart(3, "0")}.png`
    );
    await fs.writeFile(file, canvas.toBuffer("image/png"));
    console.log(file);
  }
  console.log(`Rendered ${document.numPages} pages.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
