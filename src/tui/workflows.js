function buildOutputConfirmation(state, mode) {
  const inventory = state.outputManager.inventory;
  if (!inventory) return null;
  const items =
    mode === "clean-all"
      ? inventory.items
      : inventory.items.filter((item) =>
          state.outputManager.selectedIds.includes(item.id)
        );
  return {
    mode,
    items,
    totalBytes:
      mode === "clean-all"
        ? inventory.totalBytes
        : items.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles:
      mode === "clean-all"
        ? inventory.totalFiles
        : items.reduce((sum, item) => sum + item.fileCount, 0)
  };
}

async function prepareSelectedQueue(state, options = {}) {
  const {
    resolveCourse,
    onEntry,
    onEvent
  } = options;
  const selected = new Set(state.selectedCodes);
  const selectedEntries = state.catalog.entries.filter((entry) =>
    selected.has(entry.code)
  );
  const queue = [];
  for (const entry of selectedEntries) {
    if (onEntry) onEntry(entry);
    try {
      const resolution = await resolveCourse(entry.url, {
        appConfig: state.config,
        refresh: state.config.refreshCourseContent,
        courseCodeOverride: entry.code,
        onEvent
      });
      queue.push({ ...entry, status: "ready", resolution });
    } catch (error) {
      queue.push({ ...entry, status: "failed", error: error.message });
    }
  }
  return queue;
}

function validateLearningPathUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("Paste a valid Microsoft Learn learning path URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "learn.microsoft.com") {
    throw new Error("Only https://learn.microsoft.com learning path URLs are supported.");
  }
  if (!/\/training\/paths\/[^/]+\/?$/i.test(url.pathname)) {
    throw new Error("Paste a Microsoft Learn URL under /training/paths/.");
  }
  return url.href;
}

async function prepareCustomUrlQueue(state, options = {}) {
  const {
    resolveCourse,
    onEntry,
    onEvent
  } = options;
  const url = validateLearningPathUrl(state.customUrl?.value);
  const entry = {
    code: "CUSTOM",
    title: url,
    url,
    source: "custom-url"
  };
  if (onEntry) onEntry(entry);
  try {
    const resolution = await resolveCourse(url, {
      appConfig: state.config,
      refresh: state.config.refreshCourseContent,
      onEvent
    });
    return [
      {
        ...entry,
        code: resolution.courseCode,
        title: resolution.courseTitle || url,
        status: "ready",
        resolution,
        posterInfo: null
      }
    ];
  } catch (error) {
    return [{ ...entry, status: "failed", error: error.message }];
  }
}

async function convertPreparedQueue(state, options = {}) {
  const {
    root,
    signal,
    convertCourse,
    onEvent,
    onResult
  } = options;
  const failures = state.queue
    .filter((item) => item.status === "failed")
    .map((item) => ({
      courseCode: item.code,
      status: "failed",
      error: item.error
    }));
  const readyItems = state.queue.filter((item) => item.status === "ready");
  const results = [...failures];

  for (const item of readyItems) {
    const queueIndex = results.length + 1;
    const startEvent = {
      timestamp: new Date().toISOString(),
      severity: "info",
      stage: "course-start",
      courseCode: item.resolution.courseCode,
      message: `Starting ${item.resolution.courseCode}`
    };
    if (onEvent) onEvent(startEvent, queueIndex);
    try {
      const output = await convertCourse(item.resolution, {
        appConfig: state.config,
        root,
        refresh: state.config.refreshCourseContent,
        signal,
        selectedCredentialUrl: item.url,
        posterInfo:
          item.posterInfo === null
            ? null
            : item.posterInfo || {
                url: state.catalog?.poster?.url || state.config.posterUrl,
                posterUrl: state.config.posterUrl,
                retrievedAt: state.catalog?.poster?.retrievedAt || null
              },
        onEvent: (event) => {
          if (onEvent) onEvent(event, queueIndex);
        }
      });
      const result = {
        courseCode: item.resolution.courseCode,
        status: "complete",
        manifest: output.manifest
      };
      results.push(result);
      if (onResult) onResult(result);
    } catch (error) {
      const result = {
        courseCode: item.resolution.courseCode,
        status: "failed",
        error: error.name === "AbortError" ? "Cancelled by user" : error.message
      };
      results.push(result);
      if (error.name !== "AbortError" && onResult) onResult(result);
      if (error.name === "AbortError") break;
    }
  }
  return results;
}

module.exports = {
  buildOutputConfirmation,
  convertPreparedQueue,
  prepareCustomUrlQueue,
  prepareSelectedQueue
};
