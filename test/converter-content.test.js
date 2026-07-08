const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { renderUnit } = require("../src/converter/content");
const { sha256 } = require("../src/files");

const pngData = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

async function createContext(overrides = {}) {
  const imageCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-images-"));
  return {
    imageCacheDir,
    imageCacheIndex: new Map(),
    imageData: new Map(),
    images: [],
    warnings: [],
    externalResources: [],
    progressBase: {},
    onEvent: () => {},
    refresh: false,
    ...overrides
  };
}

function exampleUnit(markdown) {
  return {
    uid: "learn.example.unit",
    title: "Example unit",
    url: "/training/modules/example/2-unit/",
    markdown
  };
}

test("renderUnit embeds linked Microsoft Learn screenshots without placeholder URL drift", async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return new Response(pngData, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(pngData.length)
      }
    });
  };
  try {
    const context = await createContext();
    const unit = exampleUnit(`# Example

[![Screenshot displays the Smart Narrative visual.](media/smart-narrative-visual.png)](media/smart-narrative-visual.png#lightbox)

[![Screenshot displays the Copilot option for Smart Narrative visual.](media/narrative-type.png)](media/narrative-type.png#lightbox)`);

    const rendered = await renderUnit(unit, { locale: "en-us" }, context);

    assert.equal(urls.length, 2);
    assert.match(rendered.html, /src="data:image\/png;base64,/);
    assert.match(
      rendered.html,
      /href="https:\/\/learn\.microsoft\.com\/en-us\/training\/modules\/example\/media\/smart-narrative-visual\.png#lightbox"/
    );
    assert.doesNotMatch(rendered.html, /png\d+"/);
    assert.doesNotMatch(rendered.html, /mslearn-to-pdf\.invalid/);
    assert.equal(context.images.filter((image) => image.status === "embedded").length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("renderUnit ignores cached rate-limit HTML at image URLs and refetches", async () => {
  const originalFetch = global.fetch;
  const absoluteUrl =
    "https://learn.microsoft.com/en-us/training/modules/example/media/rate-limited.png";
  const cacheKey = sha256(absoluteUrl);
  const context = await createContext({
    imageCacheIndex: new Map([[cacheKey, `${cacheKey}.png`]])
  });
  await fs.writeFile(
    path.join(context.imageCacheDir, `${cacheKey}.png`),
    "<html><head><title>Too Many Requests</title></head><body>Too Many Requests</body></html>"
  );
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return new Response(pngData, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(pngData.length)
      }
    });
  };
  try {
    const rendered = await renderUnit(
      exampleUnit("![Recovered image](media/rate-limited.png)"),
      { locale: "en-us" },
      context
    );

    assert.equal(attempts, 1);
    assert.match(rendered.html, /src="data:image\/png;base64,/);
    assert.deepEqual(context.warnings, []);
    assert.equal(context.images[0].status, "embedded");
  } finally {
    global.fetch = originalFetch;
  }
});

test("renderUnit treats non-image rate-limit responses as missing images", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response("<html><body>Too Many Requests</body></html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": "43"
      }
    });
  try {
    const context = await createContext();
    const rendered = await renderUnit(
      exampleUnit("![Rate limited screenshot](media/rate-limited.png)"),
      { locale: "en-us" },
      context
    );
    const cachedFiles = await fs.readdir(context.imageCacheDir);

    assert.match(rendered.html, /Image unavailable:/);
    assert.match(rendered.html, /Rate limited screenshot/);
    assert.equal(cachedFiles.length, 0);
    assert.equal(context.images[0].status, "missing");
  } finally {
    global.fetch = originalFetch;
  }
});
