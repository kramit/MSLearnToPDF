const path = require("node:path");

function dateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestampStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function learningPathHierarchyCacheFile(cacheRoot, courseCode, uid) {
  return path.join(
    cacheRoot,
    slug(courseCode),
    slug(uid),
    "learning-path.json"
  );
}

function toPosix(filePath) {
  return String(filePath || "").replaceAll("\\", "/");
}

function relativePosix(root, target) {
  return toPosix(path.relative(root, target));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(message = "Operation aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError(signal.reason || "Operation aborted");
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function compareCourseCodes(left, right) {
  const leftMatch = String(left || "").match(/^([A-Z]+)-(\d+)(.*)$/i);
  const rightMatch = String(right || "").match(/^([A-Z]+)-(\d+)(.*)$/i);
  if (!leftMatch || !rightMatch) {
    return String(left || "").localeCompare(String(right || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }
  const prefixCompare = leftMatch[1].localeCompare(rightMatch[1], undefined, {
    sensitivity: "base"
  });
  if (prefixCompare) return prefixCompare;
  const numberCompare = Number(leftMatch[2]) - Number(rightMatch[2]);
  if (numberCompare) return numberCompare;
  return leftMatch[3].localeCompare(rightMatch[3], undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

module.exports = {
  abortError,
  compareCourseCodes,
  dateStamp,
  formatBytes,
  learningPathHierarchyCacheFile,
  formatDuration,
  relativePosix,
  safeFileName,
  sleep,
  slug,
  throwIfAborted,
  timestampStamp,
  toPosix
};
