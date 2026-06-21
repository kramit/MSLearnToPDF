const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compareCourseCodes,
  getFilteredEntries,
  getFilteredOutputItems,
  initialState,
  reduce,
  sortCatalogEntries
} = require("../src/tui/state");

function readyState() {
  return reduce(initialState(), {
    type: "startup/ready",
    config: { outputRoot: "output" },
    catalog: {
      entries: [
        { code: "AI-900", title: "Azure AI Fundamentals" },
        { code: "AI-901", title: "Introduction to AI in Azure" },
        { code: "AZ-104", title: "Azure Administrator Associate" }
      ]
    }
  });
}

test("filters entries and preserves a safe cursor", () => {
  let state = readyState();
  state = reduce(state, { type: "catalog/search-set", value: "AI-" });
  assert.deepEqual(
    getFilteredEntries(state).map((entry) => entry.code),
    ["AI-900", "AI-901"]
  );
  state = reduce(state, { type: "catalog/cursor-delta", delta: 20 });
  assert.equal(state.cursor, 1);
});

test("sorts the catalog by course code family and then numeric value", () => {
  const entries = sortCatalogEntries([
    { code: "MB-300", title: "Dynamics 365" },
    { code: "AZ-900", title: "Azure Fundamentals" },
    { code: "AI-901", title: "Introduction to AI in Azure" },
    { code: "AI-900", title: "Azure AI Fundamentals" },
    { code: "AZ-104", title: "Azure Administrator Associate" },
    { code: "AZ-801", title: "Windows Server Hybrid Administrator Associate" }
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.code),
    ["AI-900", "AI-901", "AZ-104", "AZ-801", "AZ-900", "MB-300"]
  );
  assert.ok(compareCourseCodes("AI-900", "AZ-104") < 0);
  assert.ok(compareCourseCodes("AZ-104", "AZ-900") < 0);
});

test("supports selecting entries and queue transitions", () => {
  let state = readyState();
  state = reduce(state, { type: "catalog/toggle-select", code: "AI-900" });
  state = reduce(state, { type: "catalog/select-all-filtered" });
  assert.deepEqual(state.selectedCodes.sort(), ["AI-900", "AI-901", "AZ-104"]);
  state = reduce(state, { type: "queue/preparing" });
  assert.equal(state.screen, "preparing");
  state = reduce(state, {
    type: "queue/ready",
    queue: [{ code: "AI-900", status: "ready" }]
  });
  assert.equal(state.screen, "confirm");
  state = reduce(state, { type: "qa/preparing" });
  assert.equal(state.screen, "confirm");
  assert.equal(state.qaMode, "all-poster");
});

test("tracks progress logs and cancellation state", () => {
  let state = readyState();
  state = reduce(state, {
    type: "convert/start",
    total: 2,
    startedAt: 1000,
    mode: "qa"
  });
  state = reduce(state, {
    type: "convert/progress",
    now: 2000,
    event: {
      timestamp: "2026-06-20T12:00:00.000Z",
      severity: "info",
      stage: "unit",
      message: "Fetching unit"
    }
  });
  state = reduce(state, { type: "convert/request-cancel" });
  assert.equal(state.converting.logs.length, 1);
  assert.equal(state.converting.cancelRequested, true);
  assert.equal(state.converting.mode, "qa");
});

test("aggregates live network telemetry without flooding the log", () => {
  let state = readyState();
  state = reduce(state, {
    type: "convert/start",
    total: 1,
    startedAt: 1000,
    mode: "convert"
  });
  state = reduce(state, {
    type: "convert/progress",
    now: 1100,
    event: {
      timestamp: "2026-06-20T12:00:00.000Z",
      severity: "info",
      stage: "network-start",
      message: "Downloading unit markdown",
      transferId: "transfer-1",
      transferLabel: "Unit markdown Intro",
      bytesTransferred: 0,
      contentLength: 4096,
      transferBytesPerSecond: 0
    }
  });
  state = reduce(state, {
    type: "convert/progress",
    now: 1200,
    event: {
      timestamp: "2026-06-20T12:00:00.100Z",
      severity: "info",
      stage: "network-progress",
      message: "Downloading unit markdown",
      transferId: "transfer-1",
      transferLabel: "Unit markdown Intro",
      bytesTransferred: 1024,
      contentLength: 4096,
      transferBytesPerSecond: 2048
    }
  });
  state = reduce(state, {
    type: "convert/progress",
    now: 1300,
    event: {
      timestamp: "2026-06-20T12:00:00.200Z",
      severity: "info",
      stage: "network-complete",
      message: "Downloaded unit markdown",
      transferId: "transfer-1",
      transferLabel: "Unit markdown Intro",
      bytesTransferred: 4096,
      contentLength: 4096,
      transferBytesPerSecond: 4096
    }
  });
  assert.equal(state.converting.logs.length, 2);
  assert.equal(state.converting.network.totalDownloadedBytes, 4096);
  assert.equal(state.converting.network.completedTransfers, 1);
  assert.equal(
    Object.keys(state.converting.network.activeTransfers).length,
    0
  );
  assert.equal(state.converting.network.currentThroughputBytesPerSecond, 0);
});

test("supports output manager inventory, filtering, and confirmation flow", () => {
  let state = readyState();
  state = reduce(state, { type: "output/open", message: "Scanning output inventory" });
  assert.equal(state.screen, "output-manager");
  assert.equal(state.outputManager.loading, true);
  state = reduce(state, {
    type: "output/set-inventory",
    inventory: {
      items: [
        {
          id: "bundle:AI-901-2026-06-20",
          label: "AI-901-2026-06-20",
          courseCode: "AI-901",
          date: "2026-06-20",
          relativePath: "pdf/AI-901-2026-06-20",
          kind: "bundle"
        },
        {
          id: "legacy-file:pdf:pilot.pdf",
          label: "pilot.pdf",
          courseCode: "",
          date: "",
          relativePath: "pdf/pilot.pdf",
          kind: "legacy-file"
        }
      ]
    }
  });
  assert.equal(state.outputManager.loading, false);
  assert.equal(getFilteredOutputItems(state).length, 2);
  state = reduce(state, { type: "output/filter-set", value: "AI-901" });
  assert.deepEqual(
    getFilteredOutputItems(state).map((item) => item.id),
    ["bundle:AI-901-2026-06-20"]
  );
  state = reduce(state, {
    type: "output/toggle-select",
    id: "bundle:AI-901-2026-06-20"
  });
  state = reduce(state, {
    type: "output/open-confirm",
    confirmation: {
      mode: "delete-selected",
      items: [{ id: "bundle:AI-901-2026-06-20" }],
      totalBytes: 100,
      totalFiles: 5
    }
  });
  assert.equal(state.screen, "output-confirm");
  state = reduce(state, { type: "output/close-confirm" });
  assert.equal(state.screen, "output-manager");
});
