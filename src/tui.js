#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { loadAppConfig, ensureWritableDirectory } = require("./app-config");
const { loadPosterCatalog } = require("./catalog/service");
const { convertCourseFromResolution, resolveCourseFromUrl } = require("./converter/service");
const { ensureDir } = require("./lib");
const { cleanOutputRoot, deleteOutputItems, scanOutputInventory } = require("./output/service");
const { runQaSuite } = require("./qa/service");
const { formatBytes, formatDuration, timestampStamp } = require("./shared");
const { getFilteredEntries, getFilteredOutputItems, initialState, reduce } = require("./tui/state");
const { parseCommandArgs } = require("./cli/args");
const { buildTheme, formatRate, lineForEvent } = require("./tui/format");
const {
  buildOutputConfirmation,
  convertPreparedQueue,
  prepareSelectedQueue
} = require("./tui/workflows");
const { createPresentationPrimitives } = require("./tui/presentation");

function parseArgs(argv) {
  return parseCommandArgs(argv, {
    "--config": { name: "config", kind: "value" },
    "--help": { name: "help", kind: "boolean" }
  });
}

function isPageUp(input, key) {
  return key.pageUp || input === "\u001b[5~";
}

function isPageDown(input, key) {
  return key.pageDown || input === "\u001b[6~";
}

function isPrintable(input) {
  return Boolean(input && /^[ -~]$/.test(input));
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node src/tui.js [--config <config/app.json>]");
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "The TUI requires an interactive terminal with raw input support."
    );
  }

  const React = await import("react");
  const Ink = await import("ink");
  const {
    render,
    Box,
    Text,
    useApp,
    useInput,
    useWindowSize
  } = Ink;
  const { useEffect, useReducer, useRef } = React;
  const h = React.createElement;
  const theme = buildTheme();
  const root = process.cwd();
  const { Panel, SeverityText, tint } = createPresentationPrimitives({
    h,
    Box,
    Text,
    theme
  });

  function StartupScreen({ state }) {
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, "Microsoft Learn Course Downloader"),
      h(Text, { color: tint("cyan") }, "Loading configuration and certification poster"),
      h(Box, { height: 1 }),
      h(Panel, { title: "Status" }, h(Text, null, state.message || "Starting")),
      state.config
        ? h(
            Panel,
            { title: "Configuration" },
            h(Text, null, `Poster: ${state.config.posterUrl}`),
            h(Text, null, `Output root: ${state.config.outputRoot}`),
            h(Text, null, `Cache root: ${state.config.cacheRoot}`),
            h(Text, null, `Locale: ${state.config.locale}  Paper: ${state.config.paperFormat}`)
          )
        : null
    );
  }

  function CatalogRow({ entry, selected, active }) {
    return h(
      Box,
      { flexDirection: "row" },
      h(Text, { color: tint(selected ? "magenta" : active ? "cyan" : "slate") }, selected ? "[x]" : "[ ]"),
      h(Text, { color: tint(active ? "cyan" : "azure"), bold: active }, ` ${entry.code.padEnd(8)} `),
      h(Text, { color: tint("white") }, entry.title)
    );
  }

  function CatalogScreen({ state }) {
    const filtered = getFilteredEntries(state);
    const current = filtered[state.cursor];
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, "Course Catalog"),
      h(Text, { color: tint("slate") }, `${state.catalog.entries.length} poster entries loaded`),
      h(Box, { height: 1 }),
      h(
        Panel,
        {
          title: "Search",
          subtitle: state.searchMode
            ? "Type to filter. Enter or Esc to leave search."
            : "Press / to search"
        },
        h(Text, { color: tint(state.searchMode ? "magenta" : "white") }, `Filter: ${state.filter || "(none)"}`)
      ),
      state.prepareError
        ? h(
            Panel,
            { title: "Last Warning" },
            h(SeverityText, { severity: "warn" }, state.prepareError)
          )
        : null,
      h(
        Panel,
        {
          title: "Courses",
          subtitle: current ? `${state.cursor + 1} of ${filtered.length}` : "No matching entries"
        },
        ...filtered
          .slice(Math.max(0, state.cursor - 8), Math.max(0, state.cursor - 8) + 16)
          .map((entry) =>
            h(CatalogRow, {
              key: entry.code,
              entry,
              selected: state.selectedCodes.includes(entry.code),
              active: current?.code === entry.code
            })
          )
      ),
      h(
        Panel,
        { title: "Controls" },
        h(Text, null, "Arrows/Page Up/Page Down navigate"),
        h(Text, null, "Space selects  Enter prepares queue  / searches"),
        h(Text, null, "A selects all filtered  O opens output manager"),
        h(Text, null, "Q runs full poster QA sweep"),
        h(Text, null, "R refreshes poster  Ctrl+C exits")
      )
    );
  }

  function OutputRow({ item, selected, active }) {
    const metadata =
      item.kind === "bundle"
        ? `${item.courseCode || "Bundle"} ${item.date || ""}`.trim()
        : item.relativePath;
    return h(
      Box,
      { flexDirection: "row" },
      h(Text, { color: tint(selected ? "magenta" : active ? "cyan" : "slate") }, selected ? "[x]" : "[ ]"),
      h(Text, { color: tint(active ? "cyan" : "azure"), bold: active }, ` ${item.label} `),
      h(Text, { color: tint("slate") }, metadata)
    );
  }

  function OutputManagerScreen({ state }) {
    const inventory = state.outputManager.inventory;
    const filtered = getFilteredOutputItems(state);
    const current = filtered[state.outputManager.cursor];
    const details = current
      ? [
          current.kind,
          current.courseCode || "",
          current.date || "",
          `${current.fileCount} files`,
          formatBytes(current.bytes)
        ]
          .filter(Boolean)
          .join(" • ")
      : "No output items found";
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, "Output Manager"),
      h(
        Text,
        { color: tint("slate") },
        inventory
          ? `${inventory.items.length} removable item(s) • ${formatBytes(inventory.totalBytes)}`
          : state.outputManager.loading
            ? "Scanning output inventory"
            : "No inventory loaded"
      ),
      h(Box, { height: 1 }),
      h(
        Panel,
        {
          title: "Output root",
          subtitle: state.outputManager.loading
            ? state.outputManager.message || "Working"
            : "Press / to filter"
        },
        h(Text, null, state.config?.outputRoot || "-"),
        h(Text, { color: tint(state.outputManager.searchMode ? "magenta" : "white") }, `Filter: ${state.outputManager.filter || "(none)"}`)
      ),
      state.outputManager.error
        ? h(
            Panel,
            { title: "Last Warning" },
            h(SeverityText, { severity: "warn" }, state.outputManager.error)
          )
        : null,
      h(
        Panel,
        {
          title: "Generated output",
          subtitle: current ? `${state.outputManager.cursor + 1} of ${filtered.length}` : "No matching output items"
        },
        ...(filtered.length
          ? filtered
              .slice(
                Math.max(0, state.outputManager.cursor - 8),
                Math.max(0, state.outputManager.cursor - 8) + 16
              )
              .map((item) =>
                h(OutputRow, {
                  key: item.id,
                  item,
                  selected: state.outputManager.selectedIds.includes(item.id),
                  active: current?.id === item.id
                })
              )
          : [h(Text, { key: "empty", color: tint("slate") }, "No output items in the configured output root")])
      ),
      h(
        Panel,
        { title: "Details", subtitle: details },
        current
          ? h(Text, null, `Areas: ${Object.entries(current.presentAreas).filter(([, present]) => present).map(([name]) => name).join(", ")}`)
          : h(Text, { color: tint("slate") }, "Select an item to inspect it"),
        current ? h(Text, null, `Path: ${current.relativePath}`) : null,
        current?.details?.folderName
          ? h(Text, null, `Bundle: ${current.details.folderName}`)
          : null
      ),
      h(
        Panel,
        { title: "Controls" },
        h(Text, null, "Arrows/Page Up/Page Down navigate"),
        h(Text, null, "Space selects  / filters  A selects all visible"),
        h(Text, null, "D deletes selected  C cleans all  R refreshes  Esc returns")
      )
    );
  }

  function OutputConfirmScreen({ state }) {
    const confirmation = state.outputManager.confirmation;
    const items = confirmation?.items || [];
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(
        Text,
        { color: tint("red"), bold: true },
        confirmation?.mode === "clean-all" ? "Confirm Full Clean" : "Confirm Delete"
      ),
      h(
        Text,
        { color: tint("slate") },
        confirmation?.mode === "clean-all"
          ? "Everything inside the configured output root will be removed, including logs."
          : "Selected output items will be removed."
      ),
      h(Box, { height: 1 }),
      h(
        Panel,
        {
          title: "Summary",
          subtitle: `${confirmation?.totalFiles || 0} file(s) • ${formatBytes(confirmation?.totalBytes || 0)}`
        },
        h(Text, null, `Output root: ${state.config?.outputRoot || "-"}`),
        confirmation?.mode === "clean-all"
          ? h(Text, null, "Action: remove every file and folder inside output root, then keep the root directory.")
          : null
      ),
      h(
        Panel,
        {
          title: confirmation?.mode === "clean-all" ? "Items that will be removed" : "Selected items"
        },
        ...(items.length
          ? items.slice(0, 18).map((item) =>
              h(Text, { key: item.id || item.label }, `${item.label} • ${item.relativePath}`)
            )
          : [h(Text, { key: "none", color: tint("slate") }, "No items selected")])
      ),
      h(
        Panel,
        { title: "Controls" },
        h(Text, null, "Y confirms deletion"),
        h(Text, null, "Esc cancels and returns to Output Manager")
      )
    );
  }

  function QueueScreen({ state, preparing = false }) {
    if (state.qaMode === "all-poster") {
      return h(
        Box,
        { flexDirection: "column", padding: 1 },
        h(Text, { color: tint("azure"), bold: true }, "Full Course QA Sweep"),
        h(
          Text,
          { color: tint("slate") },
          "Run download, conversion, and QA for every course in the poster catalog"
        ),
        h(Box, { height: 1 }),
        h(
          Panel,
          {
            title: "Scope",
            subtitle: `${state.catalog?.entries?.length || 0} poster course(s)`
          },
          h(Text, null, "This processes the full certification poster sequentially."),
          h(Text, null, "Each course is resolved, exported, audited, and added to one QA summary."),
          h(Text, null, "The run continues past individual course failures.")
        ),
        h(
          Panel,
          { title: "Controls" },
          h(Text, null, "Enter starts the full QA sweep"),
          h(Text, null, "Esc returns to the catalog")
        )
      );
    }
    const ready = state.queue.filter((item) => item.status === "ready");
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, preparing ? "Preparing Queue" : "Queue Review"),
      h(Text, { color: tint("slate") }, preparing ? "Resolving selected Microsoft Learn links" : "Review resolved courses before conversion"),
      h(Box, { height: 1 }),
      h(
        Panel,
        {
          title: preparing ? "Progress" : "Resolved queue",
          subtitle: `${state.queue.length} selected, ${ready.length} ready`
        },
        ...state.queue.map((item) =>
          h(
            Box,
            { key: item.code, flexDirection: "column", marginBottom: 1 },
            h(
              Box,
              null,
              h(Text, { color: tint("magenta"), bold: true }, item.code),
              h(Text, null, ` ${item.title}`)
            ),
            item.status === "ready"
              ? h(
                  Text,
                  { color: tint("green") },
                  `Ready • ${item.resolution.courseCode} • ${item.resolution.learningPathUids.length} learning path(s)`
                )
              : h(Text, { color: tint("red") }, `Unavailable • ${item.error}`)
          )
        )
      ),
      preparing
        ? h(Panel, { title: "Status" }, h(Text, null, state.message || "Working"))
        : h(
            Panel,
            { title: "Controls" },
            h(Text, null, "Enter starts conversion for ready courses"),
            h(Text, null, "Esc returns to the catalog")
          )
    );
  }

  function ProgressScreen({ state, logFile }) {
    const now = Date.now();
    const elapsed = state.converting.startedAt
      ? formatDuration(now - state.converting.startedAt)
      : "0s";
    const since = state.converting.lastActivityAt
      ? formatDuration(now - state.converting.lastActivityAt)
      : "0s";
    const logs = state.converting.logs;
    const visibleCount = state.converting.logExpanded ? 14 : 6;
    const end = Math.max(0, logs.length - state.converting.logOffset);
    const start = Math.max(0, end - visibleCount);
    const visibleLogs = logs.slice(start, end);
    const current = state.converting.currentEvent;
    const network = state.converting.network;
    const activeTransfers = Object.values(network.activeTransfers || {});
    const currentTransfer = activeTransfers
      .sort((left, right) => (right.lastUpdatedAt || 0) - (left.lastUpdatedAt || 0))
      .at(0);
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, "Conversion Dashboard"),
      h(
        Text,
        { color: tint("slate") },
        state.converting.mode === "qa"
          ? `QA progress ${state.converting.results.length} of ${state.converting.total} course(s) finished`
          : `Queue progress ${state.converting.results.length} of ${state.converting.total} finished`
      ),
      h(Box, { height: 1 }),
      h(
        Panel,
        { title: "Current activity" },
        h(Text, null, `Course: ${current?.courseCode || "-"}`),
        h(Text, null, `Learning path: ${current?.learningPathTitle || current?.learningPathUid || "-"}`),
        h(Text, null, `Module: ${current?.moduleTitle || "-"}`),
        h(Text, null, `Unit: ${current?.unitTitle || "-"}`),
        h(Text, null, `Stage: ${current?.stage || "-"}`),
        h(Text, null, `Message: ${current?.message || (state.converting.cancelRequested ? "Cancelling after safe stop point" : "-")}`)
      ),
      h(
        Panel,
        { title: "Session" },
        h(Text, null, `Elapsed: ${elapsed}`),
        h(Text, null, `Since last activity: ${since}`),
        h(Text, null, `Downloaded: ${formatBytes(network.totalDownloadedBytes)}`),
        h(Text, null, `Throughput: ${formatRate(network.currentThroughputBytesPerSecond)}`),
        h(Text, null, `Active downloads: ${activeTransfers.length}`),
        h(
          Text,
          null,
          currentTransfer
            ? `Current transfer: ${currentTransfer.transferLabel} ${formatBytes(currentTransfer.bytesTransferred)}${currentTransfer.contentLength ? ` of ${formatBytes(currentTransfer.contentLength)}` : ""}`
            : `Last transfer: ${network.lastTransferLabel || "-"}`
        ),
        h(Text, null, `Verbose log: ${logFile || "(pending)"}`),
        state.converting.cancelRequested
          ? h(SeverityText, { severity: "warn" }, "Graceful cancellation requested")
          : null
      ),
      h(
        Panel,
        {
          title: state.converting.logExpanded ? "Verbose log" : "Recent log",
          subtitle: state.converting.logExpanded
            ? "Page Up/Page Down scroll  L collapse"
            : "L expands"
        },
        ...visibleLogs.map((event, index) =>
          h(
            Text,
            {
              key: `${event.timestamp}-${index}`,
              color:
                event.severity === "error"
                  ? tint("red")
                  : event.severity === "warn"
                    ? tint("amber")
                    : tint("white")
            },
            lineForEvent(event)
          )
        )
      ),
      h(
        Panel,
        { title: "Controls" },
        h(Text, null, "Ctrl+C requests graceful cancellation"),
        h(Text, null, "L toggles verbose log")
      )
    );
  }

  function SummaryScreen({ state, logFile }) {
    if (state.summary?.mode === "qa") {
      const qa = state.summary.qa;
      const runError = state.summary.error || "";
      const passed = qa?.courses?.filter((item) => item.status === "pass") || [];
      const partial = qa?.courses?.filter((item) => item.status === "partial") || [];
      const failed = qa?.courses?.filter((item) => item.status === "failed") || [];
      return h(
        Box,
        { flexDirection: "column", padding: 1 },
        h(Text, { color: tint("azure"), bold: true }, "QA Sweep Summary"),
        h(
          Text,
          { color: tint("slate") },
          `${passed.length} passed, ${partial.length} partial, ${failed.length} failed`
        ),
        h(Box, { height: 1 }),
        h(
          Panel,
          { title: "Totals" },
          ...(runError
            ? [
                h(
                  Text,
                  { key: "qa-error", color: tint("red") },
                  `${state.summary.cancelled ? "Cancelled" : "QA error"}: ${runError}`
                )
              ]
            : []),
          h(Text, null, `Requested courses: ${qa?.requestedCourses || 0}`),
          h(Text, null, `Learning paths passed: ${qa?.totals?.learningPathsPassed || 0} of ${qa?.totals?.learningPaths || 0}`),
          h(Text, null, `Modules exported: ${qa?.totals?.modules || 0}`),
          h(Text, null, `Units exported: ${qa?.totals?.units || 0}`),
          h(Text, null, `Assessment questions: ${qa?.totals?.assessmentQuestions || 0}`)
        ),
        h(
          Panel,
          { title: "Course results" },
          ...[...passed, ...partial, ...failed].slice(0, 18).map((item, index) =>
            h(
              Box,
              { key: `${item.courseCode}-${item.status}-${index}`, flexDirection: "column", marginBottom: 1 },
              h(
                Text,
                {
                  color:
                    item.status === "pass"
                      ? tint("green")
                      : item.status === "partial"
                        ? tint("amber")
                        : tint("red"),
                  bold: true
                },
                `${item.courseCode} ${item.status}`
              ),
              h(
                Text,
                null,
                `${item.passedLearningPathCount}/${item.learningPathCount} learning path(s) passed QA`
              )
            )
          )
        ),
        h(
          Panel,
          { title: "Artifacts" },
          h(Text, null, `QA Markdown: ${state.summary.qaSummaryMarkdown || "(none)"}`),
          h(Text, null, `QA JSON: ${state.summary.qaSummaryJson || "(none)"}`),
          h(Text, null, `Logs: ${logFile || "(none)"}`)
        ),
        h(
          Panel,
          { title: "Controls" },
          h(Text, null, "Esc returns to the catalog  Ctrl+C exits")
        )
      );
    }
    const successful = state.summary?.results?.filter((item) => item.status === "complete") || [];
    const failed = state.summary?.results?.filter((item) => item.status === "failed") || [];
    const pdfs = successful.flatMap((item) =>
      item.manifest.learningPaths
        .filter((pathEntry) => pathEntry.status === "complete")
        .map((pathEntry) => pathEntry.pdf)
    );
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("azure"), bold: true }, "Completion Summary"),
      h(Text, { color: tint("slate") }, `${successful.length} course(s) completed, ${failed.length} failed`),
      h(Box, { height: 1 }),
      h(
        Panel,
        { title: "Results" },
        ...successful.map((item) =>
          h(
            Box,
            { key: item.courseCode, flexDirection: "column", marginBottom: 1 },
            h(Text, { color: tint("green"), bold: true }, `${item.courseCode} complete`),
            h(Text, null, `${item.manifest.learningPaths.filter((entry) => entry.status === "complete").length} PDF(s) ready`)
          )
        ),
        ...failed.map((item, index) =>
          h(
            Box,
            { key: `${item.courseCode}-${index}`, flexDirection: "column", marginBottom: 1 },
            h(Text, { color: tint("red"), bold: true }, `${item.courseCode || "Course"} failed`),
            h(Text, null, item.error)
          )
        )
      ),
      h(
        Panel,
        { title: "Generated PDFs" },
        ...(pdfs.length ? pdfs.map((pdf) => h(Text, { key: pdf }, pdf)) : [h(Text, { key: "none" }, "No PDFs generated")])
      ),
      h(
        Panel,
        { title: "Artifacts" },
        h(Text, null, `Logs: ${logFile || "(none)"}`),
        h(Text, null, `Output root: ${state.config?.outputRoot || "-"}`)
      ),
      h(
        Panel,
        { title: "Controls" },
        h(Text, null, "Esc returns to the catalog  Ctrl+C exits")
      )
    );
  }

  function ErrorScreen({ state }) {
    return h(
      Box,
      { flexDirection: "column", padding: 1 },
      h(Text, { color: tint("red"), bold: true }, "Startup failed"),
      h(Box, { height: 1 }),
      h(Panel, { title: "Error" }, h(Text, null, state.fatalError)),
      h(Panel, { title: "Control" }, h(Text, null, "Ctrl+C exits"))
    );
  }

  function App() {
    const { exit } = useApp();
    const [state, dispatch] = useReducer(reduce, undefined, initialState);
    const size = useWindowSize();
    const startupOnceRef = useRef(false);
    const sessionLogFileRef = useRef("");
    const logWriteRef = useRef(Promise.resolve());
    const convertAbortRef = useRef(null);
    const refreshAbortRef = useRef(null);

    async function ensureSessionLogFile(forceNew = false) {
      const outputRoot = state.config?.outputRoot;
      if (!outputRoot) return;
      const current = sessionLogFileRef.current;
      if (!forceNew && current && (await fileExists(current))) return;
      await ensureDir(path.join(outputRoot, "logs"));
      sessionLogFileRef.current = path.join(
        outputRoot,
        "logs",
        `${timestampStamp()}.log`
      );
      await fs.writeFile(
        sessionLogFileRef.current,
        `MSLearnToPDF session ${new Date().toISOString()}\n`,
        "utf8"
      );
    }

    function appendSessionLog(event) {
      if (!sessionLogFileRef.current) return;
      const line = `${lineForEvent(event)}\n`;
      logWriteRef.current = logWriteRef.current
        .then(() => fs.appendFile(sessionLogFileRef.current, line, "utf8"))
        .catch(() => {});
    }

    async function bootstrap() {
      try {
        dispatch({ type: "startup/message", message: "Loading configuration" });
        const appConfig = await loadAppConfig(root, args.config);
        await ensureWritableDirectory(appConfig.outputRoot);
        const logDir = path.join(appConfig.outputRoot, "logs");
        await ensureDir(logDir);
        sessionLogFileRef.current = path.join(
          logDir,
          `${timestampStamp()}.log`
        );
        await fs.writeFile(
          sessionLogFileRef.current,
          `MSLearnToPDF session ${new Date().toISOString()}\n`,
          "utf8"
        );
        dispatch({
          type: "startup/message",
          message: appConfig.refreshPosterOnStart
            ? "Refreshing certification poster"
            : "Loading cached certification poster"
        });
        const catalog = await loadPosterCatalog(appConfig, {
          refresh: appConfig.refreshPosterOnStart,
          onEvent: (event) => {
            appendSessionLog(event);
            dispatch({ type: "startup/message", message: event.message });
          }
        });
        dispatch({ type: "startup/ready", config: appConfig, catalog });
      } catch (error) {
        dispatch({ type: "startup/error", error: error.message });
      }
    }

    useEffect(() => {
      if (startupOnceRef.current) return;
      startupOnceRef.current = true;
      bootstrap();
    }, []);

    useEffect(() => {
      if (state.screen !== "converting" || !state.converting.active) return;
      const timer = setInterval(() => {
        const now = Date.now();
        const threshold = (state.config?.stallWarningSeconds || 60) * 1000;
        if (
          !state.converting.stallWarningShown &&
          state.converting.lastActivityAt &&
          now - state.converting.lastActivityAt > threshold
        ) {
          const event = {
            timestamp: new Date().toISOString(),
            severity: "warn",
            stage: "stall-warning",
            courseCode: state.converting.currentEvent?.courseCode || "",
            message: `No new activity for ${state.config?.stallWarningSeconds || 60} seconds`
          };
          appendSessionLog(event);
          dispatch({
            type: "convert/progress",
            event,
            now
          });
        }
      }, 1000);
      return () => clearInterval(timer);
    }, [state.screen, state.converting.active, state.converting.lastActivityAt, state.converting.stallWarningShown, state.config?.stallWarningSeconds]);

    async function refreshCatalog() {
      if (!state.config) return;
      try {
        await ensureSessionLogFile();
        refreshAbortRef.current?.abort();
        const controller = new AbortController();
        refreshAbortRef.current = controller;
        dispatch({ type: "startup/message", message: "Refreshing certification poster" });
        const catalog = await loadPosterCatalog(state.config, {
          refresh: true,
          signal: controller.signal,
          onEvent: (event) => {
            appendSessionLog(event);
            dispatch({ type: "startup/message", message: event.message });
          }
        });
        dispatch({ type: "catalog/replace", catalog });
      } catch (error) {
        dispatch({ type: "queue/error", error: error.message });
      }
    }

    async function refreshOutputManager() {
      if (!state.config) return;
      try {
        dispatch({
          type: "output/loading",
          message: "Scanning output inventory"
        });
        const inventory = await scanOutputInventory(state.config.outputRoot, {
          onEvent: (event) => appendSessionLog(event)
        });
        dispatch({ type: "output/set-inventory", inventory });
      } catch (error) {
        dispatch({ type: "output/error", error: error.message });
      }
    }

    async function openOutputManager() {
      dispatch({
        type: "output/open",
        message: "Scanning output inventory"
      });
      await refreshOutputManager();
    }

    async function executeOutputConfirmation() {
      const confirmation = state.outputManager.confirmation;
      if (!confirmation || !state.config) return;
      try {
        dispatch({
          type: "output/loading",
          message:
            confirmation.mode === "clean-all"
              ? "Cleaning output root"
              : "Deleting selected output items"
        });
        appendSessionLog({
          timestamp: new Date().toISOString(),
          severity: "info",
          stage: confirmation.mode === "clean-all" ? "clean-start" : "delete-start",
          message:
            confirmation.mode === "clean-all"
              ? `Cleaning ${state.config.outputRoot}`
              : `Deleting ${confirmation.items.length} selected output item(s)`
        });
        if (confirmation.mode === "clean-all") {
          await cleanOutputRoot(state.config.outputRoot, {
            onEvent: (event) => appendSessionLog(event)
          });
          sessionLogFileRef.current = "";
        } else {
          const deletingCurrentLog = confirmation.items.some((item) =>
            item.deleteTargets?.includes(sessionLogFileRef.current)
          );
          await deleteOutputItems(state.config.outputRoot, confirmation.items, {
            onEvent: (event) => appendSessionLog(event)
          });
          if (deletingCurrentLog) {
            sessionLogFileRef.current = "";
          }
        }
        dispatch({ type: "output/close-confirm" });
        await refreshOutputManager();
      } catch (error) {
        dispatch({ type: "output/error", error: error.message });
      }
    }

    async function prepareQueue() {
      if (!state.config || !state.catalog) return;
      await ensureSessionLogFile();
      if (!state.selectedCodes.length) return;
      dispatch({ type: "queue/preparing" });
      try {
        const queue = await prepareSelectedQueue(state, {
          resolveCourse: resolveCourseFromUrl,
          onEntry: (entry) =>
            dispatch({
              type: "startup/message",
              message: `Resolving ${entry.code} ${entry.title}`
            }),
          onEvent: (event) => appendSessionLog(event)
        });
        dispatch({ type: "queue/ready", queue });
      } catch (error) {
        dispatch({ type: "queue/error", error: error.message });
      }
    }

    async function startConversion() {
      if (!state.config) return;
      await ensureSessionLogFile();
      if (state.qaMode === "all-poster") {
        dispatch({
          type: "convert/start",
          total: state.catalog?.entries?.length || 0,
          startedAt: Date.now(),
          mode: "qa"
        });
        const controller = new AbortController();
        convertAbortRef.current = controller;
        try {
          const output = await runQaSuite({
            appConfig: state.config,
            root,
            allPoster: true,
            refresh: state.config.refreshCourseContent,
            posterRefresh: true,
            signal: controller.signal,
            onEvent: (event) => {
              appendSessionLog(event);
              dispatch({
                type: "convert/progress",
                event,
                now: Date.now()
              });
              if (
                event.stage === "qa-course-complete"
              ) {
                dispatch({
                  type: "convert/result",
                  result: {
                    courseCode: event.courseCode || "",
                    status: event.severity === "error" ? "failed" : "complete"
                  }
                });
              }
            }
          });
          dispatch({
            type: "convert/summary",
            summary: {
              mode: "qa",
              qa: output.summary,
              qaSummaryJson: output.summaryJson,
              qaSummaryMarkdown: output.summaryMarkdown
            }
          });
        } catch (error) {
          const cancelled = error.name === "AbortError";
          const event = {
            timestamp: new Date().toISOString(),
            severity: cancelled ? "warn" : "error",
            stage: cancelled ? "cancelled" : "qa-failed",
            message: cancelled ? "QA sweep cancelled by user" : error.message
          };
          appendSessionLog(event);
          dispatch({
            type: "convert/summary",
            summary: {
              mode: "qa",
              qa: {
                requestedCourses: state.catalog?.entries?.length || 0,
                courses: [],
                totals: {}
              },
              qaSummaryJson: "",
              qaSummaryMarkdown: "",
              cancelled,
              error: event.message
            }
          });
        }
        return;
      }
      dispatch({
        type: "convert/start",
        total: state.queue.length,
        startedAt: Date.now(),
        mode: "convert"
      });
      const controller = new AbortController();
      convertAbortRef.current = controller;
      const results = await convertPreparedQueue(state, {
        root,
        signal: controller.signal,
        convertCourse: convertCourseFromResolution,
        onEvent: (event, queueIndex) => {
          appendSessionLog(event);
          dispatch({
            type: "convert/progress",
            event,
            now: Date.now(),
            queueIndex
          });
        },
        onResult: (result) => dispatch({ type: "convert/result", result })
      });
      dispatch({
        type: "convert/summary",
        summary: {
          results
        }
      });
    }

    useInput((input, key) => {
      if (state.searchMode) {
        if (key.escape || key.return) {
          dispatch({ type: "catalog/search-mode", value: false });
          return;
        }
        if (key.backspace || key.delete) {
          dispatch({
            type: "catalog/search-set",
            value: state.filter.slice(0, -1)
          });
          return;
        }
        if (isPrintable(input)) {
          dispatch({
            type: "catalog/search-set",
            value: state.filter + input
          });
        }
        return;
      }

      if (state.screen === "output-manager" && state.outputManager.searchMode) {
        if (key.escape || key.return) {
          dispatch({ type: "output/search-mode", value: false });
          return;
        }
        if (key.backspace || key.delete) {
          dispatch({
            type: "output/filter-set",
            value: state.outputManager.filter.slice(0, -1)
          });
          return;
        }
        if (isPrintable(input)) {
          dispatch({
            type: "output/filter-set",
            value: state.outputManager.filter + input
          });
        }
        return;
      }

      if (key.ctrl && input === "c") {
        if (state.screen === "converting" && state.converting.active) {
          dispatch({ type: "convert/request-cancel" });
          convertAbortRef.current?.abort();
          return;
        }
        exit();
        return;
      }

      if (state.screen === "catalog") {
        const pageDelta = Math.max(5, Math.floor((size.rows || 24) / 2));
        const filtered = getFilteredEntries(state);
        const current = filtered[state.cursor];
        if (key.upArrow) dispatch({ type: "catalog/cursor-delta", delta: -1 });
        else if (key.downArrow) dispatch({ type: "catalog/cursor-delta", delta: 1 });
        else if (isPageUp(input, key)) {
          dispatch({ type: "catalog/cursor-delta", delta: -pageDelta });
        } else if (isPageDown(input, key)) {
          dispatch({ type: "catalog/cursor-delta", delta: pageDelta });
        } else if (input === "/") dispatch({ type: "catalog/search-mode", value: true });
        else if (input === "a" || input === "A") {
          dispatch({ type: "catalog/select-all-filtered" });
        } else if (input === "q" || input === "Q") {
          dispatch({ type: "qa/preparing" });
        } else if (input === "r" || input === "R") {
          refreshCatalog();
        } else if (input === "o" || input === "O") {
          openOutputManager();
        } else if (input === " " && current) {
          dispatch({ type: "catalog/toggle-select", code: current.code });
        } else if (key.return && state.selectedCodes.length) {
          prepareQueue();
        }
        return;
      }

      if (state.screen === "confirm") {
        if (key.escape) dispatch({ type: "nav/back" });
        else if (key.return) startConversion();
        return;
      }

      if (state.screen === "summary") {
        if (key.escape || key.return) dispatch({ type: "nav/back" });
        return;
      }

      if (state.screen === "output-manager") {
        if (key.escape) {
          dispatch({ type: "nav/back" });
          return;
        }
        if (state.outputManager.loading) return;
        const pageDelta = Math.max(5, Math.floor((size.rows || 24) / 2));
        const filtered = getFilteredOutputItems(state);
        const current = filtered[state.outputManager.cursor];
        if (key.upArrow) dispatch({ type: "output/cursor-delta", delta: -1 });
        else if (key.downArrow) dispatch({ type: "output/cursor-delta", delta: 1 });
        else if (isPageUp(input, key)) {
          dispatch({ type: "output/cursor-delta", delta: -pageDelta });
        } else if (isPageDown(input, key)) {
          dispatch({ type: "output/cursor-delta", delta: pageDelta });
        } else if (input === "/") {
          dispatch({ type: "output/search-mode", value: true });
        } else if (input === "a" || input === "A") {
          dispatch({ type: "output/select-all-filtered" });
        } else if (input === "r" || input === "R") {
          refreshOutputManager();
        } else if (input === " " && current) {
          dispatch({ type: "output/toggle-select", id: current.id });
        } else if ((input === "d" || input === "D") && state.outputManager.selectedIds.length) {
          dispatch({
            type: "output/open-confirm",
            confirmation: buildOutputConfirmation(state, "delete-selected")
          });
        } else if (input === "c" || input === "C") {
          dispatch({
            type: "output/open-confirm",
            confirmation: buildOutputConfirmation(state, "clean-all")
          });
        }
        return;
      }

      if (state.screen === "output-confirm") {
        if (key.escape) {
          dispatch({ type: "output/close-confirm" });
        } else if (input === "y" || input === "Y") {
          executeOutputConfirmation();
        }
        return;
      }

      if (state.screen === "converting") {
        if (input === "l" || input === "L") dispatch({ type: "convert/toggle-log" });
        else if (isPageUp(input, key)) dispatch({ type: "convert/scroll-log", delta: 6 });
        else if (isPageDown(input, key)) dispatch({ type: "convert/scroll-log", delta: -6 });
      }
    });

    if (state.screen === "startup") {
      return h(StartupScreen, { state });
    }
    if (state.screen === "error") {
      return h(ErrorScreen, { state });
    }
    if (state.screen === "catalog") {
      return h(CatalogScreen, { state });
    }
    if (state.screen === "output-manager") {
      return h(OutputManagerScreen, { state });
    }
    if (state.screen === "output-confirm") {
      return h(OutputConfirmScreen, { state });
    }
    if (state.screen === "preparing") {
      return h(QueueScreen, { state, preparing: true });
    }
    if (state.screen === "confirm") {
      return h(QueueScreen, { state, preparing: false });
    }
    if (state.screen === "converting") {
      return h(ProgressScreen, { state, logFile: sessionLogFileRef.current });
    }
    if (state.screen === "summary") {
      return h(SummaryScreen, { state, logFile: sessionLogFileRef.current });
    }
    return h(Text, null, "Unknown state");
  }

  render(h(App), { alternateScreen: true });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
