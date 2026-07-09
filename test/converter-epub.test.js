const test = require("node:test");
const assert = require("node:assert/strict");
const { unzipSync, strFromU8 } = require("fflate");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const {
  EPUB_IMAGE_MAX_WIDTH,
  renderEpubArchive
} = require("../src/converter/epub");

async function largePngDataUri() {
  const canvas = createCanvas(1800, 200);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 1800, 200);
  context.fillStyle = "#005a9e";
  context.fillRect(0, 0, 1800, 60);
  context.fillStyle = "#111";
  context.font = "32px Arial";
  context.fillText("Kindle image scaling check", 40, 130);
  const buffer = Buffer.from(await canvas.encode("png"));
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function baseModel(imageDataUri) {
  return {
    config: {
      locale: "en-us",
      courseCode: "AI-901",
      courseTitle: "AI course"
    },
    course: {
      title: "AI course",
      url: "https://learn.microsoft.com/en-us/training/courses/ai-901"
    },
    learningPath: {
      uid: "learn.ai.path",
      title: "AI learning path",
      summary: "A compact path.",
      canonicalUrl: "https://learn.microsoft.com/en-us/training/paths/ai-path/"
    },
    modules: [
      {
        uid: "learn.ai.module",
        title: "Module one",
        summary: "Module summary.",
        objectives: ["Explain AI concepts"],
        units: [
          {
            uid: "learn.ai.unit",
            title: "Read this first",
            canonicalUrl: "https://learn.microsoft.com/en-us/training/modules/ai/1-intro/",
            html: `<p>Lesson body with <a href="https://example.com/lab">inline lab link</a>.</p><h2>Learn More</h2><p>Appendix link that should not appear.</p><h2>Next topic</h2><p>Kept lesson content.</p><img alt="Large screenshot" src="${imageDataUri}">`,
            isAssessment: false
          },
          {
            uid: "learn.ai.assessment",
            title: "Module Assessment",
            canonicalUrl: "https://learn.microsoft.com/en-us/training/modules/ai/knowledge-check/",
            html: "<h2>Module Assessment</h2><p>Question content that should not appear.</p>",
            isAssessment: true
          }
        ],
        assessmentQuestions: [{ prompt: "Assessment prompt", choices: ["A"] }],
        answers: {
          answers: [
            {
              questionNumber: 1,
              answer: "A",
              explanation: "Answer key that should not appear.",
              supportingUnitUid: "learn.ai.assessment"
            }
          ]
        }
      }
    ],
    retrievedAt: "2026-07-08T10:00:00.000Z",
    sourceUpdatedAt: "2026-07-01T00:00:00.000Z"
  };
}

test("renders an EPUB 3 package with nav, manifest, XHTML, and scaled images", async () => {
  const archive = await renderEpubArchive(baseModel(await largePngDataUri()));
  const buffer = archive.buffer;
  const firstNameLength = buffer.readUInt16LE(26);
  const firstEntryName = buffer.slice(30, 30 + firstNameLength).toString("utf8");
  const firstCompressionMethod = buffer.readUInt16LE(8);
  assert.equal(firstEntryName, "mimetype");
  assert.equal(firstCompressionMethod, 0);

  const files = unzipSync(buffer);
  assert.equal(strFromU8(files.mimetype), "application/epub+zip");
  assert.ok(files["META-INF/container.xml"]);
  assert.ok(files["EPUB/package.opf"]);
  assert.ok(files["EPUB/nav.xhtml"]);
  assert.ok(files["EPUB/styles/epub.css"]);
  assert.ok(files["EPUB/xhtml/intro.xhtml"]);
  assert.ok(files["EPUB/xhtml/module-1.xhtml"]);
  assert.ok(files["EPUB/images/image-001.png"]);

  const packageDocument = strFromU8(files["EPUB/package.opf"]);
  assert.match(packageDocument, /version="3\.0"/);
  assert.match(packageDocument, /properties="nav"/);
  assert.match(packageDocument, /href="xhtml\/module-1\.xhtml"/);
  assert.match(packageDocument, /href="images\/image-001\.png"/);

  const nav = strFromU8(files["EPUB/nav.xhtml"]);
  assert.match(nav, /epub:type="toc"/);
  assert.match(nav, /Read this first/);

  const module = strFromU8(files["EPUB/xhtml/module-1.xhtml"]);
  assert.match(module, /inline lab link/);
  assert.match(module, /Kept lesson content/);
  assert.match(module, /\.\.\/images\/image-001\.png/);
  assert.doesNotMatch(module, /data:image/);
  assert.doesNotMatch(module, /Learn More/);
  assert.doesNotMatch(module, /Appendix link that should not appear/);
  assert.doesNotMatch(module, /Module Assessment/);
  assert.doesNotMatch(module, /Question content that should not appear/);
  assert.doesNotMatch(module, /Answer key that should not appear/);

  const image = await loadImage(Buffer.from(files["EPUB/images/image-001.png"]));
  assert.ok(image.width <= EPUB_IMAGE_MAX_WIDTH);
});
