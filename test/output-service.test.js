const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  cleanOutputRoot,
  deleteOutputItems,
  parseBundleName,
  scanOutputInventory,
  validateDeleteTargets
} = require("../src/output/service");

async function makeTempOutputRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-output-"));
  await fs.mkdir(path.join(root, "pdf"), { recursive: true });
  await fs.mkdir(path.join(root, "html"), { recursive: true });
  await fs.mkdir(path.join(root, "reports"), { recursive: true });
  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  return root;
}

async function writeFileWithDirs(target, contents = "x") {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

test("parses dated bundle folder names", () => {
  assert.deepEqual(parseBundleName("AZ-104-2026-06-20"), {
    courseCode: "AZ-104",
    date: "2026-06-20"
  });
  assert.deepEqual(parseBundleName("not-a-bundle"), {
    courseCode: "",
    date: ""
  });
});

test("detects bundles, partial bundles, legacy files, and logs", async () => {
  const root = await makeTempOutputRoot();
  await writeFileWithDirs(
    path.join(root, "pdf", "AI-901-2026-06-20", "one.pdf"),
    "pdf"
  );
  await writeFileWithDirs(
    path.join(root, "html", "AI-901-2026-06-20", "one.html"),
    "html"
  );
  await writeFileWithDirs(
    path.join(root, "reports", "AI-901-2026-06-20", "course-manifest.json"),
    "{}"
  );
  await writeFileWithDirs(
    path.join(root, "pdf", "AZ-104-2026-06-19", "one.pdf"),
    "partial"
  );
  await writeFileWithDirs(path.join(root, "pdf", "pilot.pdf"), "legacy");
  await writeFileWithDirs(path.join(root, "logs", "session.log"), "log");
  await writeFileWithDirs(
    path.join(root, "reports", "qa", "run-one", "qa-summary.json"),
    "{}"
  );

  const inventory = await scanOutputInventory(root);
  assert.equal(inventory.items.length, 5);
  assert.deepEqual(
    inventory.items.map((item) => item.id),
    [
      "bundle:AI-901-2026-06-20",
      "bundle:AZ-104-2026-06-19",
      "legacy-file:pdf:pilot.pdf",
      "legacy-file:reports:qa",
      "log-file:logs:session.log"
    ]
  );
  assert.deepEqual(inventory.items[1].presentAreas, {
    pdf: true,
    html: false,
    reports: false,
    logs: false
  });
});

test("standalone directories keep recursive file counts and byte totals", async () => {
  const root = await makeTempOutputRoot();
  await writeFileWithDirs(
    path.join(root, "reports", "qa", "run-one", "qa-summary.json"),
    "{}"
  );
  await writeFileWithDirs(
    path.join(root, "reports", "qa", "run-one", "qa-summary.md"),
    "#"
  );

  const inventory = await scanOutputInventory(root);
  const qaItem = inventory.items.find((item) => item.id === "legacy-file:reports:qa");

  assert.equal(qaItem.fileCount, 2);
  assert.equal(qaItem.bytes, 3);
  assert.equal(inventory.totalFiles, 2);
  assert.equal(inventory.totalBytes, 3);
});

test("sorts bundles by course family and newest date first", async () => {
  const root = await makeTempOutputRoot();
  await writeFileWithDirs(path.join(root, "pdf", "AZ-104-2026-06-19", "a.pdf"));
  await writeFileWithDirs(path.join(root, "pdf", "AZ-104-2026-06-20", "b.pdf"));
  await writeFileWithDirs(path.join(root, "pdf", "AI-901-2026-06-18", "c.pdf"));
  const inventory = await scanOutputInventory(root);
  assert.deepEqual(
    inventory.items.map((item) => item.id),
    [
      "bundle:AI-901-2026-06-18",
      "bundle:AZ-104-2026-06-20",
      "bundle:AZ-104-2026-06-19"
    ]
  );
});

test("returns an empty inventory for an empty output root", async () => {
  const root = await makeTempOutputRoot();
  const inventory = await scanOutputInventory(root);
  assert.equal(inventory.items.length, 0);
  assert.equal(inventory.totalBytes, 0);
  assert.equal(inventory.totalFiles, 0);
});

test("deletes selected output items only", async () => {
  const root = await makeTempOutputRoot();
  await writeFileWithDirs(path.join(root, "pdf", "AI-901-2026-06-20", "one.pdf"));
  await writeFileWithDirs(path.join(root, "html", "AI-901-2026-06-20", "one.html"));
  await writeFileWithDirs(path.join(root, "pdf", "pilot.pdf"), "legacy");
  let inventory = await scanOutputInventory(root);
  const target = inventory.items.find((item) => item.id === "bundle:AI-901-2026-06-20");
  await deleteOutputItems(root, [target]);
  inventory = await scanOutputInventory(root);
  assert.deepEqual(
    inventory.items.map((item) => item.id),
    ["legacy-file:pdf:pilot.pdf"]
  );
});

test("cleanOutputRoot removes everything inside output root but preserves the root", async () => {
  const root = await makeTempOutputRoot();
  await writeFileWithDirs(path.join(root, "pdf", "AI-901-2026-06-20", "one.pdf"));
  await writeFileWithDirs(path.join(root, "logs", "session.log"), "log");
  await cleanOutputRoot(root);
  const remaining = await fs.readdir(root);
  assert.deepEqual(remaining, []);
});

test("validateDeleteTargets rejects paths outside the output root", () => {
  const root = path.resolve("C:\\temp\\output-root");
  assert.throws(
    () => validateDeleteTargets(root, [path.resolve("C:\\temp\\elsewhere\\bad.txt")]),
    /outside output root/
  );
});

test("validateDeleteTargets rejects the output root itself", () => {
  const root = path.resolve("C:\\temp\\output-root");
  assert.throws(
    () => validateDeleteTargets(root, [root]),
    /outside output root/
  );
});

test("deleteOutputItems tolerates missing targets with warnings", async () => {
  const root = await makeTempOutputRoot();
  const result = await deleteOutputItems(root, [
    {
      label: "ghost",
      deleteTargets: [path.join(root, "pdf", "missing-folder")]
    }
  ]);
  assert.equal(result.warnings.length, 1);
});
