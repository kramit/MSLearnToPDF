const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("HTML input paths use portable file URLs", () => {
  const file = path.resolve("tmp", "course folder", "guide.html");
  const url = pathToFileURL(file);

  assert.equal(url.protocol, "file:");
  assert.match(url.href, /course%20folder/);
  assert.equal(url.pathname.endsWith("/guide.html"), true);
});
