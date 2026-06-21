const path = require("node:path");
const { chromium } = require("playwright");
const { escapeHtml } = require("../content");
const { throwIfAborted } = require("../shared");

async function generatePdf(htmlFile, pdfFile, config, signal) {
  throwIfAborted(signal);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(
      new URL(`file:///${path.resolve(htmlFile).replaceAll("\\", "/")}`).href,
      { waitUntil: "networkidle" }
    );
    throwIfAborted(signal);
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfFile,
      format: config.paperFormat || "A4",
      printBackground: true,
      displayHeaderFooter: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
      margin: { top: "18mm", right: "17mm", bottom: "18mm", left: "17mm" },
      headerTemplate: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#65758a;width:100%;padding:0 17mm;display:flex;justify-content:space-between;"><span>${escapeHtml(config.courseCode)} study guide</span><span>Learning path edition</span></div>`,
      footerTemplate: '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#65758a;width:100%;padding:0 17mm;display:flex;justify-content:space-between;"><span>Microsoft Learn snapshot</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
    });
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };
