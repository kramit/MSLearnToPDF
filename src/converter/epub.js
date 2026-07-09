const fs = require("node:fs/promises");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { escapeHtml } = require("../content");
const { slug } = require("../shared");

const EPUB_IMAGE_MAX_WIDTH = 1200;
const EPUB_IMAGE_MAX_HEIGHT = 1600;

function xml(value = "") {
  return escapeHtml(value);
}

function modifiedTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  const valid = Number.isNaN(date.valueOf()) ? new Date() : date;
  return valid.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function contentId(prefix, value) {
  const base = slug(value) || "item";
  return `${prefix}-${base}`.replace(/^[^A-Za-z_]+/, `${prefix}-`);
}

function extensionForMime(mime) {
  const normalized = (mime || "").split(";")[0].toLowerCase();
  return {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp"
  }[normalized] || ".bin";
}

function mediaTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".xhtml": "application/xhtml+xml",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function parseDataUri(value) {
  const match = String(value || "").match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  return {
    mime: match[1].toLowerCase(),
    data: Buffer.from(match[2], "base64")
  };
}

function normalizeVoidElements(fragment) {
  return fragment
    .replace(/&nbsp;/g, "&#160;")
    .replace(/<(br|hr)([^>/]*?)>/gi, "<$1$2 />")
    .replace(/<img\b([^>]*?)(?<!\/)>/gi, "<img$1 />");
}

function plainHeadingText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLearnMoreSections(fragment) {
  const headings = [...String(fragment || "").matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)].map(
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
      level: Number(match[1]),
      text: plainHeadingText(match[0])
    })
  );
  const ranges = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!/^learn more$/i.test(heading.text)) continue;
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    ranges.push({
      start: heading.start,
      end: next ? next.start : fragment.length
    });
  }
  if (!ranges.length) return fragment;
  let stripped = "";
  let cursor = 0;
  for (const range of ranges) {
    stripped += fragment.slice(cursor, range.start);
    cursor = range.end;
  }
  stripped += fragment.slice(cursor);
  return stripped;
}

async function normalizeImage(data, mime) {
  if (mime === "image/svg+xml" || mime === "image/gif") {
    return { data, mime, extension: extensionForMime(mime) };
  }
  try {
    const image = await loadImage(data);
    const scale = Math.min(
      1,
      EPUB_IMAGE_MAX_WIDTH / image.width,
      EPUB_IMAGE_MAX_HEIGHT / image.height
    );
    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));
    if (scale >= 1 && (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg")) {
      return {
        data,
        mime: mime === "image/jpg" ? "image/jpeg" : mime,
        extension: extensionForMime(mime)
      };
    }
    const canvas = createCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputMime = mime === "image/jpeg" || mime === "image/jpg" ? "image/jpeg" : "image/png";
    const outputData =
      outputMime === "image/jpeg"
        ? await canvas.encode("jpeg", 85)
        : await canvas.encode("png");
    return {
      data: Buffer.from(outputData),
      mime: outputMime,
      extension: extensionForMime(outputMime)
    };
  } catch {
    if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") {
      return {
        data,
        mime: mime === "image/jpg" ? "image/jpeg" : mime,
        extension: extensionForMime(mime)
      };
    }
    return { data, mime, extension: extensionForMime(mime) };
  }
}

async function rewriteImages(fragment, assets) {
  let rewritten = "";
  let cursor = 0;
  const imageRegex = /<img\b([^>]*?)>/gi;
  for (const match of fragment.matchAll(imageRegex)) {
    rewritten += fragment.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const tag = match[0];
    const srcMatch = tag.match(/\s+src=(["'])([\s\S]*?)\1/i);
    if (!srcMatch) {
      rewritten += tag;
      continue;
    }
    const parsed = parseDataUri(srcMatch[2]);
    if (!parsed) {
      rewritten += tag;
      continue;
    }
    const normalized = await normalizeImage(parsed.data, parsed.mime);
    const assetName = `image-${String(assets.length + 1).padStart(3, "0")}${normalized.extension}`;
    const assetPath = `images/${assetName}`;
    assets.push({
      path: assetPath,
      data: normalized.data,
      mediaType: normalized.mime
    });
    rewritten += tag.replace(srcMatch[0], ` src="../${assetPath}"`);
  }
  rewritten += fragment.slice(cursor);
  return normalizeVoidElements(rewritten);
}

function renderIntroXhtml(model, readableModules) {
  const { config, course, learningPath, retrievedAt, sourceUpdatedAt } = model;
  const moduleItems = readableModules
    .map(
      (module, index) => `<li><a href="module-${index + 1}.xhtml">${xml(module.title)}</a></li>`
    )
    .join("");
  return xhtmlDocument({
    lang: config.locale,
    title: learningPath.title,
    body: `
      <section class="cover">
        <p class="kicker">${xml(config.courseCode)} study guide</p>
        <h1>${xml(learningPath.title)}</h1>
        <p class="summary">${xml(learningPath.summary || "")}</p>
        <p class="source">${xml(course.title || config.courseTitle || "")}</p>
      </section>
      <section>
        <h2>Contents</h2>
        <ol>${moduleItems}</ol>
        <p class="edition">Source updated: ${xml(sourceUpdatedAt || "Not supplied")}</p>
        <p class="edition">Snapshot retrieved: ${xml(retrievedAt)}</p>
      </section>`
  });
}

function renderModuleXhtml(model, module, moduleIndex) {
  const { config } = model;
  const unitItems = module.units
    .map(
      (unit, unitIndex) => `
        <section class="unit" id="unit-${unitIndex + 1}">
          <p class="kicker">Module ${moduleIndex + 1} - Unit ${unitIndex + 1}</p>
          <h2>${xml(unit.title)}</h2>
          <p class="unit-source"><a href="${xml(unit.canonicalUrl)}">View current Microsoft Learn unit</a></p>
          <div class="unit-content">${unit.epubHtml}</div>
        </section>`
    )
    .join("");
  const objectives = module.objectives?.length
    ? `<h2>Learning objectives</h2><ul>${module.objectives.map((item) => `<li>${xml(item)}</li>`).join("")}</ul>`
    : "";
  return xhtmlDocument({
    lang: config.locale,
    title: module.title,
    body: `
      <section class="module-overview">
        <p class="kicker">Module ${moduleIndex + 1}</p>
        <h1>${xml(module.title)}</h1>
        ${module.summary ? `<p class="summary">${xml(module.summary)}</p>` : ""}
        ${objectives}
      </section>
      ${unitItems}`
  });
}

function xhtmlDocument({ lang, title, body }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${xml(lang)}" xml:lang="${xml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>${xml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/epub.css" />
</head>
<body>
${body}
</body>
</html>`;
}

function renderNav(model, readableModules) {
  const { config, learningPath } = model;
  const moduleItems = readableModules
    .map(
      (module, moduleIndex) => `
        <li>
          <a href="xhtml/module-${moduleIndex + 1}.xhtml">${xml(module.title)}</a>
          <ol>
            ${module.units
              .map(
                (unit, unitIndex) =>
                  `<li><a href="xhtml/module-${moduleIndex + 1}.xhtml#unit-${unitIndex + 1}">${xml(unit.title)}</a></li>`
              )
              .join("")}
          </ol>
        </li>`
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(config.locale)}" xml:lang="${xml(config.locale)}">
<head>
  <meta charset="utf-8" />
  <title>${xml(learningPath.title)} contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${xml(learningPath.title)}</h1>
    <ol>
      <li><a href="xhtml/intro.xhtml">Overview</a></li>
      ${moduleItems}
    </ol>
  </nav>
</body>
</html>`;
}

function renderPackageDocument(model, contentFiles, assets) {
  const { config, learningPath, retrievedAt } = model;
  const identifier = `urn:mslearn:${slug(config.courseCode)}:${slug(learningPath.uid)}`;
  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="styles/epub.css" media-type="text/css"/>',
    ...contentFiles.map(
      (file) =>
        `<item id="${xml(file.id)}" href="${xml(file.path)}" media-type="application/xhtml+xml"/>`
    ),
    ...assets.map(
      (asset, index) =>
        `<item id="image-${index + 1}" href="${xml(asset.path)}" media-type="${xml(asset.mediaType || mediaTypeForPath(asset.path))}"/>`
    )
  ].join("\n    ");
  const spineItems = contentFiles
    .map((file) => `<itemref idref="${xml(file.id)}"/>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${xml(config.locale)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${xml(identifier)}</dc:identifier>
    <dc:title>${xml(learningPath.title)}</dc:title>
    <dc:language>${xml(config.locale)}</dc:language>
    <dc:creator>MSLearnToPDF</dc:creator>
    <meta property="dcterms:modified">${xml(modifiedTimestamp(retrievedAt))}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
}

function renderContainerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

const epubCss = `
html {
  color: #111;
  background: #fff;
}
body {
  margin: 0;
  padding: 0;
  font-family: serif;
  font-size: 1em;
  line-height: 1.38;
  text-align: left;
}
p {
  margin: 0 0 .65em;
  text-align: left;
}
h1, h2, h3, h4 {
  line-height: 1.2;
  margin: 1em 0 .45em;
  text-align: left;
}
h1 { font-size: 1.55em; }
h2 { font-size: 1.25em; }
h3 { font-size: 1.08em; }
ol, ul {
  margin: .4em 0 .8em;
  padding-left: 1.25em;
}
li { margin: .18em 0; }
a { color: inherit; text-decoration: underline; }
table {
  border-collapse: collapse;
  margin: .8em 0;
  width: 100%;
  font-size: .88em;
}
th, td {
  border: 1px solid #999;
  padding: .28em;
  vertical-align: top;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: .82em;
  line-height: 1.3;
  margin: .8em 0;
  padding: .55em;
  border: 1px solid #aaa;
}
code {
  font-family: monospace;
  font-size: .9em;
}
blockquote {
  margin: .8em 0;
  padding: .2em .7em;
  border-left: .22em solid #777;
}
img, svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: .75em auto;
}
.cover {
  margin: 0 0 1.2em;
}
.kicker, .edition, .source, .unit-source {
  font-size: .85em;
  color: #555;
}
.summary {
  font-size: .98em;
}
.module-overview {
  margin-bottom: 1em;
}
.unit {
  margin-top: 1.2em;
  padding-top: .4em;
  border-top: 1px solid #aaa;
}
.external-resource {
  font-weight: normal;
}
`;

async function buildReadableModules(modules) {
  const assets = [];
  const readableModules = [];
  for (const module of modules) {
    const units = [];
    for (const unit of module.units || []) {
      if (unit.isAssessment) continue;
      units.push({
        ...unit,
        epubHtml: await rewriteImages(stripLearnMoreSections(unit.html || ""), assets)
      });
    }
    readableModules.push({
      ...module,
      units
    });
  }
  return { readableModules, assets };
}

async function renderEpubArchive(model) {
  const { readableModules, assets } = await buildReadableModules(model.modules || []);
  const contentFiles = [
    {
      id: "intro",
      path: "xhtml/intro.xhtml",
      contents: renderIntroXhtml(model, readableModules)
    },
    ...readableModules.map((module, index) => ({
      id: contentId("module", `${index + 1}-${module.uid || module.title}`),
      path: `xhtml/module-${index + 1}.xhtml`,
      contents: renderModuleXhtml(model, module, index)
    }))
  ];
  const archive = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(renderContainerXml()),
    "EPUB/package.opf": strToU8(renderPackageDocument(model, contentFiles, assets)),
    "EPUB/nav.xhtml": strToU8(renderNav(model, readableModules)),
    "EPUB/styles/epub.css": strToU8(epubCss)
  };
  for (const file of contentFiles) {
    archive[`EPUB/${file.path}`] = strToU8(file.contents);
  }
  for (const asset of assets) {
    archive[`EPUB/${asset.path}`] = asset.data;
  }
  return {
    buffer: Buffer.from(zipSync(archive, { level: 6 })),
    contentFiles,
    assets
  };
}

async function writeEpubFile(target, model) {
  const archive = await renderEpubArchive(model);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, archive.buffer);
  return archive;
}

module.exports = {
  EPUB_IMAGE_MAX_HEIGHT,
  EPUB_IMAGE_MAX_WIDTH,
  renderEpubArchive,
  writeEpubFile
};
