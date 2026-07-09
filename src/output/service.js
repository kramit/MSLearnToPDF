const fs = require("node:fs/promises");
const path = require("node:path");
const { emitProgress } = require("../progress");
const { compareCourseCodes, relativePosix, throwIfAborted } = require("../shared");

const BUNDLE_REGEX = /^(.*)-(\d{4}-\d{2}-\d{2})$/;
const BUNDLE_KINDS = ["pdf", "html", "txt", "epub", "log"];
const LEGACY_ROOT_KINDS = ["pdf", "html", "text", "reports"];
const LEGACY_ROOTS = new Set([...LEGACY_ROOT_KINDS, "logs"]);

function parseBundleName(name) {
  const match = String(name || "").match(BUNDLE_REGEX);
  if (!match) return { courseCode: "", date: "" };
  return {
    courseCode: match[1] || "",
    date: match[2] || ""
  };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function statTree(target) {
  const stats = await fs.lstat(target);
  if (!stats.isDirectory()) {
    return { fileCount: 1, bytes: stats.size };
  }
  let fileCount = 0;
  let bytes = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else {
        const childStats = await fs.lstat(child);
        fileCount += 1;
        bytes += childStats.size;
      }
    }
  }
  return { fileCount, bytes };
}

function createBundleItem(root, folderName, bundlePaths) {
  const { courseCode, date } = parseBundleName(folderName);
  const presentAreas = {
    pdf: false,
    html: false,
    txt: false,
    epub: false,
    log: false
  };
  const deleteTargets = [];
  let fileCount = 0;
  let bytes = 0;
  for (const [kind, info] of Object.entries(bundlePaths)) {
    const area = kind === "text" ? "txt" : kind === "reports" || kind === "logs" ? "log" : kind;
    if (Object.hasOwn(presentAreas, area)) presentAreas[area] = Boolean(info);
    if (info) {
      deleteTargets.push(info.absolutePath);
      fileCount += info.fileCount;
      bytes += info.bytes;
    }
  }
  return {
    id: `bundle:${folderName}`,
    kind: "bundle",
    label: folderName,
    courseCode,
    date,
    absolutePath: null,
    relativePath: folderName,
    presentAreas,
    deleteTargets,
    fileCount,
    bytes,
    details: {
      folderName,
      roots: Object.fromEntries(
        Object.entries(bundlePaths)
          .filter(([, info]) => info)
          .map(([kind, info]) => [kind, relativePosix(root, info.absolutePath)])
      )
    }
  };
}

function createFileItem(root, kind, absolutePath, stats, subKind, isDirectory = false) {
  const name = path.basename(absolutePath);
  const area = kind === "text" ? "txt" : kind === "reports" || kind === "logs" ? "log" : kind;
  return {
    id: `${subKind}:${kind}:${name}`,
    kind: subKind,
    label: name,
    courseCode: "",
    date: "",
    absolutePath,
    relativePath: relativePosix(root, absolutePath),
    presentAreas: {
      pdf: area === "pdf",
      html: area === "html",
      txt: area === "txt",
      epub: area === "epub",
      log: area === "log"
    },
    deleteTargets: [absolutePath],
    fileCount: stats.fileCount ?? 1,
    bytes: stats.bytes ?? stats.size ?? 0,
    details: {
      rootKind: kind,
      name,
      isDirectory
    }
  };
}

async function readLegacyRootKind(outputRoot, kind, bundleMap, standaloneItems) {
  const rootPath = path.join(outputRoot, kind);
  if (!(await pathExists(rootPath))) return;
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const stats = await statTree(absolutePath);
      const parsed = parseBundleName(entry.name);
      if (parsed.courseCode && parsed.date) {
        if (!bundleMap.has(entry.name)) bundleMap.set(entry.name, {});
        bundleMap.get(entry.name)[kind] = { absolutePath, ...stats };
      } else {
        standaloneItems.push(
          createFileItem(
            outputRoot,
            kind,
            absolutePath,
            stats,
            "legacy-file",
            true
          )
        );
      }
    } else {
      const stats = await fs.lstat(absolutePath);
      standaloneItems.push(createFileItem(outputRoot, kind, absolutePath, stats, "legacy-file"));
    }
  }
}

async function readBundleFirstItems(outputRoot, bundleItems, standaloneItems) {
  if (!(await pathExists(outputRoot))) return;
  const entries = await fs.readdir(outputRoot, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(outputRoot, entry.name);
    if (LEGACY_ROOTS.has(entry.name)) continue;
    if (!entry.isDirectory()) {
      const stats = await fs.lstat(absolutePath);
      standaloneItems.push(createFileItem(outputRoot, "root", absolutePath, stats, "legacy-file"));
      continue;
    }
    const parsed = parseBundleName(entry.name);
    const isQaBundle = /^qa-\d{8}-\d{6}$/.test(entry.name);
    if (!parsed.courseCode && !isQaBundle) {
      const stats = await statTree(absolutePath);
      standaloneItems.push(createFileItem(outputRoot, "root", absolutePath, stats, "legacy-file", true));
      continue;
    }
    const bundlePaths = {};
    for (const kind of BUNDLE_KINDS) {
      const childPath = path.join(absolutePath, kind);
      if (await pathExists(childPath)) {
        bundlePaths[kind] = { absolutePath: childPath, ...(await statTree(childPath)) };
      }
    }
    if (!Object.keys(bundlePaths).length) {
      const stats = await statTree(absolutePath);
      standaloneItems.push(createFileItem(outputRoot, "root", absolutePath, stats, "legacy-file", true));
      continue;
    }
    const stats = await statTree(absolutePath);
    bundleItems.push({
      ...createBundleItem(outputRoot, entry.name, bundlePaths),
      id: isQaBundle ? `qa-bundle:${entry.name}` : `bundle:${entry.name}`,
      kind: isQaBundle ? "qa-bundle" : "bundle",
      courseCode: isQaBundle ? "QA" : parsed.courseCode,
      date: isQaBundle ? entry.name.replace(/^qa-/, "") : parsed.date,
      absolutePath,
      deleteTargets: [absolutePath],
      fileCount: stats.fileCount,
      bytes: stats.bytes,
      details: {
        folderName: entry.name,
        roots: Object.fromEntries(
          Object.entries(bundlePaths).map(([kind, info]) => [
            kind,
            relativePosix(outputRoot, info.absolutePath)
          ])
        )
      }
    });
  }
}

function sortOutputItems(items) {
  return [...items].sort((left, right) => {
    if (left.kind === "bundle" && right.kind === "bundle") {
      const codeCompare = compareCourseCodes(left.courseCode, right.courseCode);
      if (codeCompare) return codeCompare;
      const dateCompare = String(right.date || "").localeCompare(String(left.date || ""));
      if (dateCompare) return dateCompare;
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }
    if (left.kind === "bundle") return -1;
    if (right.kind === "bundle") return 1;
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind, undefined, {
        sensitivity: "base"
      });
    }
    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

async function scanOutputInventory(outputRoot, options = {}) {
  const { onEvent, signal } = options;
  throwIfAborted(signal);
  emitProgress(onEvent, {
    stage: "inventory-refresh",
    message: `Scanning output inventory at ${outputRoot}`
  });
  const bundleMap = new Map();
  const bundleFirstItems = [];
  const standaloneItems = [];
  await readBundleFirstItems(outputRoot, bundleFirstItems, standaloneItems);
  for (const kind of LEGACY_ROOT_KINDS) {
    throwIfAborted(signal);
    await readLegacyRootKind(outputRoot, kind, bundleMap, standaloneItems);
  }

  const logItems = [];
  const logsRoot = path.join(outputRoot, "logs");
  if (await pathExists(logsRoot)) {
    const entries = await fs.readdir(logsRoot, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(logsRoot, entry.name);
      const stats = await fs.lstat(absolutePath);
      if (entry.isDirectory()) {
        const tree = await statTree(absolutePath);
        logItems.push({
          id: `log-file:logs:${entry.name}`,
          kind: "log-file",
          label: entry.name,
          courseCode: "",
          date: "",
          absolutePath,
          relativePath: relativePosix(outputRoot, absolutePath),
          presentAreas: {
            pdf: false,
            html: false,
            txt: false,
            epub: false,
            log: true
          },
          deleteTargets: [absolutePath],
          fileCount: tree.fileCount,
          bytes: tree.bytes,
          details: {
            rootKind: "logs",
            name: entry.name
          }
        });
      } else {
        logItems.push(createFileItem(outputRoot, "logs", absolutePath, stats, "log-file"));
      }
    }
  }

  const bundleItems = [...bundleMap.entries()].map(([folderName, bundlePaths]) =>
    createBundleItem(outputRoot, folderName, bundlePaths)
  );
  const items = sortOutputItems([
    ...bundleFirstItems,
    ...bundleItems,
    ...standaloneItems,
    ...logItems
  ]);
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const totalFiles = items.reduce((sum, item) => sum + item.fileCount, 0);
  return {
    outputRoot,
    items,
    totalBytes,
    totalFiles
  };
}

function isPathInsideRoot(outputRoot, target) {
  const root = path.resolve(outputRoot);
  const resolvedTarget = path.resolve(target);
  return (
    resolvedTarget !== root &&
    resolvedTarget.startsWith(`${root}${path.sep}`)
  );
}

function validateDeleteTargets(outputRoot, targets) {
  for (const target of targets) {
    if (!isPathInsideRoot(outputRoot, target)) {
      throw new Error(`Refusing to delete path outside output root: ${target}`);
    }
  }
}

async function removeTarget(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function deleteOutputItems(outputRoot, items, options = {}) {
  const { onEvent, signal } = options;
  const targets = [...new Set(items.flatMap((item) => item.deleteTargets || []))];
  validateDeleteTargets(outputRoot, targets);
  emitProgress(onEvent, {
    stage: "delete-start",
    message: `Deleting ${items.length} output item(s)`
  });
  const warnings = [];
  for (const item of items) {
    throwIfAborted(signal);
    emitProgress(onEvent, {
      stage: "delete-item",
      message: `Deleting ${item.label}`
    });
    for (const target of item.deleteTargets || []) {
      try {
        if (!(await pathExists(target))) {
          const warning = `Missing target while deleting ${item.label}: ${target}`;
          warnings.push(warning);
          emitProgress(onEvent, {
            severity: "warn",
            stage: "warning",
            message: warning
          });
          continue;
        }
        await removeTarget(target);
      } catch (error) {
        const warning = `Unable to delete ${target}: ${error.message}`;
        warnings.push(warning);
        emitProgress(onEvent, {
          severity: "warn",
          stage: "warning",
          message: warning
        });
      }
    }
  }
  emitProgress(onEvent, {
    stage: "delete-complete",
    message: `Deleted ${items.length} output item(s)`
  });
  return { warnings };
}

async function cleanOutputRoot(outputRoot, options = {}) {
  const { onEvent, signal } = options;
  throwIfAborted(signal);
  emitProgress(onEvent, {
    stage: "clean-start",
    message: `Cleaning output root ${outputRoot}`
  });
  const entries = (await pathExists(outputRoot))
    ? await fs.readdir(outputRoot, { withFileTypes: true })
    : [];
  const targets = entries.map((entry) => path.join(outputRoot, entry.name));
  validateDeleteTargets(outputRoot, targets);
  const warnings = [];
  for (const target of targets) {
    throwIfAborted(signal);
    try {
      await removeTarget(target);
    } catch (error) {
      const warning = `Unable to delete ${target}: ${error.message}`;
      warnings.push(warning);
      emitProgress(onEvent, {
        severity: "warn",
        stage: "warning",
        message: warning
      });
    }
  }
  emitProgress(onEvent, {
    stage: "clean-complete",
    message: `Cleaned output root ${outputRoot}`
  });
  return { warnings };
}

module.exports = {
  cleanOutputRoot,
  deleteOutputItems,
  parseBundleName,
  scanOutputInventory,
  sortOutputItems,
  validateDeleteTargets
};
