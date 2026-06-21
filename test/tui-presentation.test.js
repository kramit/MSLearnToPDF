const test = require("node:test");
const assert = require("node:assert/strict");
const { createPresentationPrimitives } = require("../src/tui/presentation");

test("presentation primitives preserve labels when colors are disabled", () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const { Panel, SeverityText, tint } = createPresentationPrimitives({
    h,
    Box: "Box",
    Text: "Text",
    theme: { noColor: true, colors: {} }
  });

  assert.equal(tint("red"), undefined);
  assert.equal(SeverityText({ severity: "error", children: "Failed" }).children[0], "Failed");
  const panel = Panel({ title: "Status", subtitle: "Ready", children: "Body" });
  assert.equal(panel.type, "Box");
  assert.equal(panel.children.at(-1), "Body");
});
