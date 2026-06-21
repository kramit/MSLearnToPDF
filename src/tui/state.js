const { compareCourseCodes } = require("../shared");

function initialNetworkState() {
  return {
    totalDownloadedBytes: 0,
    completedTransfers: 0,
    activeTransfers: {},
    currentThroughputBytesPerSecond: 0,
    lastTransferLabel: "",
    lastTransferAt: 0
  };
}

function initialState() {
  return {
    screen: "startup",
    message: "Loading configuration",
    config: null,
    catalog: null,
    filter: "",
    searchMode: false,
    cursor: 0,
    selectedCodes: [],
    qaMode: null,
    queue: [],
    prepareError: "",
    converting: {
      active: false,
      queueIndex: 0,
      total: 0,
      mode: "convert",
      startedAt: 0,
      lastActivityAt: 0,
      logExpanded: true,
      logOffset: 0,
      logs: [],
      results: [],
      currentEvent: null,
      cancelRequested: false,
      stallWarningShown: false,
      network: initialNetworkState()
    },
    outputManager: {
      inventory: null,
      filter: "",
      searchMode: false,
      cursor: 0,
      selectedIds: [],
      loading: false,
      message: "",
      error: "",
      confirmation: null
    },
    summary: null,
    fatalError: ""
  };
}

function withUniqueSelection(selectedCodes) {
  return [...new Set(selectedCodes)];
}

function sortCatalogEntries(entries) {
  return [...(entries || [])].sort((left, right) => {
    const codeCompare = compareCourseCodes(left.code, right.code);
    if (codeCompare) return codeCompare;
    return String(left.title || "").localeCompare(String(right.title || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function normalizeCatalog(catalog) {
  if (!catalog?.entries) return catalog;
  return {
    ...catalog,
    entries: sortCatalogEntries(catalog.entries)
  };
}

function getFilteredEntries(state) {
  const entries = state.catalog?.entries || [];
  const filter = state.filter.trim().toLowerCase();
  if (!filter) return entries;
  return entries.filter((entry) =>
    `${entry.code} ${entry.title}`.toLowerCase().includes(filter)
  );
}

function getFilteredOutputItems(state) {
  const items = state.outputManager.inventory?.items || [];
  const filter = state.outputManager.filter.trim().toLowerCase();
  if (!filter) return items;
  return items.filter((item) =>
    [
      item.label,
      item.courseCode,
      item.date,
      item.relativePath,
      item.kind
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(filter)
  );
}

function clampCursor(state) {
  const filtered = getFilteredEntries(state);
  const cursor = Math.max(0, Math.min(state.cursor, Math.max(0, filtered.length - 1)));
  return { ...state, cursor };
}

function clampOutputCursor(state) {
  const filtered = getFilteredOutputItems(state);
  const cursor = Math.max(
    0,
    Math.min(state.outputManager.cursor, Math.max(0, filtered.length - 1))
  );
  return {
    ...state,
    outputManager: {
      ...state.outputManager,
      cursor
    }
  };
}

function sumCurrentThroughput(activeTransfers, now) {
  return Object.values(activeTransfers).reduce((sum, transfer) => {
    if (!transfer?.lastUpdatedAt) return sum;
    if (now - transfer.lastUpdatedAt > 1500) return sum;
    return sum + Math.max(0, Number(transfer.transferBytesPerSecond) || 0);
  }, 0);
}

function updateNetworkState(network, event, now) {
  if (!event?.stage?.startsWith("network-")) {
    return network;
  }
  const transferId = event.transferId;
  const nextActiveTransfers = { ...network.activeTransfers };
  const previousTransfer = transferId ? nextActiveTransfers[transferId] : null;
  let totalDownloadedBytes = network.totalDownloadedBytes;
  let completedTransfers = network.completedTransfers;
  let lastTransferLabel = network.lastTransferLabel;
  let lastTransferAt = network.lastTransferAt;

  if (event.stage === "network-start" && transferId) {
    nextActiveTransfers[transferId] = {
      transferId,
      transferLabel: event.transferLabel || event.message || "",
      transferKind: event.transferKind || "",
      contentLength: event.contentLength || 0,
      bytesTransferred: 0,
      transferBytesPerSecond: 0,
      lastUpdatedAt: now
    };
    lastTransferLabel = event.transferLabel || lastTransferLabel;
    lastTransferAt = now;
  }

  if (event.stage === "network-progress" && transferId) {
    const bytesTransferred = Math.max(
      0,
      Number(event.bytesTransferred) || 0
    );
    const previousBytes = Math.max(
      0,
      Number(previousTransfer?.bytesTransferred) || 0
    );
    totalDownloadedBytes += Math.max(0, bytesTransferred - previousBytes);
    nextActiveTransfers[transferId] = {
      transferId,
      transferLabel: event.transferLabel || previousTransfer?.transferLabel || "",
      transferKind: event.transferKind || previousTransfer?.transferKind || "",
      contentLength:
        Number(event.contentLength) ||
        Number(previousTransfer?.contentLength) ||
        0,
      bytesTransferred,
      transferBytesPerSecond: Math.max(
        0,
        Number(event.transferBytesPerSecond) || 0
      ),
      lastUpdatedAt: now
    };
    lastTransferLabel =
      event.transferLabel ||
      previousTransfer?.transferLabel ||
      lastTransferLabel;
    lastTransferAt = now;
  }

  if ((event.stage === "network-complete" || event.stage === "network-error") && transferId) {
    const bytesTransferred = Math.max(
      0,
      Number(event.bytesTransferred) || 0
    );
    const previousBytes = Math.max(
      0,
      Number(previousTransfer?.bytesTransferred) || 0
    );
    totalDownloadedBytes += Math.max(0, bytesTransferred - previousBytes);
    delete nextActiveTransfers[transferId];
    lastTransferLabel =
      event.transferLabel ||
      previousTransfer?.transferLabel ||
      lastTransferLabel;
    lastTransferAt = now;
    if (event.stage === "network-complete") {
      completedTransfers += 1;
    }
  }

  return {
    totalDownloadedBytes,
    completedTransfers,
    activeTransfers: nextActiveTransfers,
    currentThroughputBytesPerSecond: sumCurrentThroughput(nextActiveTransfers, now),
    lastTransferLabel,
    lastTransferAt
  };
}

function reduce(state, action) {
  switch (action.type) {
    case "startup/message":
      return { ...state, message: action.message };
    case "startup/ready":
      return {
        ...state,
        screen: "catalog",
        config: action.config,
        catalog: normalizeCatalog(action.catalog),
        message: "",
        cursor: 0
      };
    case "startup/error":
      return {
        ...state,
        screen: "error",
        fatalError: action.error
      };
    case "catalog/search-mode":
      return { ...state, searchMode: action.value };
    case "catalog/search-set":
      return clampCursor({ ...state, filter: action.value });
    case "catalog/cursor-delta":
      return clampCursor({ ...state, cursor: state.cursor + action.delta });
    case "catalog/cursor-set":
      return clampCursor({ ...state, cursor: action.index });
    case "catalog/toggle-select": {
      const selected = new Set(state.selectedCodes);
      if (selected.has(action.code)) selected.delete(action.code);
      else selected.add(action.code);
      return { ...state, selectedCodes: [...selected] };
    }
    case "catalog/select-all-filtered": {
      const filteredCodes = getFilteredEntries(state).map((entry) => entry.code);
      return {
        ...state,
        selectedCodes: withUniqueSelection([...state.selectedCodes, ...filteredCodes])
      };
    }
    case "catalog/clear-selection":
      return { ...state, selectedCodes: [] };
    case "catalog/replace":
      return clampCursor({
        ...state,
        catalog: normalizeCatalog(action.catalog),
        cursor: 0
      });
    case "queue/preparing":
      return {
        ...state,
        screen: "preparing",
        qaMode: null,
        prepareError: "",
        queue: []
      };
    case "qa/preparing":
      return {
        ...state,
        screen: "confirm",
        qaMode: "all-poster",
        prepareError: "",
        queue: []
      };
    case "queue/ready":
      return {
        ...state,
        screen: "confirm",
        qaMode: null,
        queue: action.queue,
        prepareError: ""
      };
    case "queue/error":
      return {
        ...state,
        screen: "catalog",
        prepareError: action.error
      };
    case "nav/back":
      if (state.screen === "confirm") return { ...state, screen: "catalog" };
      if (state.screen === "summary") return { ...state, screen: "catalog" };
      if (state.screen === "output-manager") return { ...state, screen: "catalog" };
      if (state.screen === "output-confirm") {
        return {
          ...state,
          screen: "output-manager",
          outputManager: {
            ...state.outputManager,
            confirmation: null
          }
        };
      }
      return state;
    case "output/open":
      return {
        ...state,
        screen: "output-manager",
        outputManager: {
          ...state.outputManager,
          loading: true,
          message: action.message || "Scanning output inventory",
          error: "",
          confirmation: null
        }
      };
    case "output/loading":
      return {
        ...state,
        outputManager: {
          ...state.outputManager,
          loading: true,
          message: action.message,
          error: ""
        }
      };
    case "output/error":
      return {
        ...state,
        screen: "output-manager",
        outputManager: {
          ...state.outputManager,
          loading: false,
          error: action.error,
          message: ""
        }
      };
    case "output/set-inventory":
      return clampOutputCursor({
        ...state,
        screen: "output-manager",
        outputManager: {
          ...state.outputManager,
          inventory: action.inventory,
          loading: false,
          message: "",
          error: "",
          cursor: 0,
          selectedIds: [],
          confirmation: null
        }
      });
    case "output/search-mode":
      return {
        ...state,
        outputManager: {
          ...state.outputManager,
          searchMode: action.value
        }
      };
    case "output/filter-set":
      return clampOutputCursor({
        ...state,
        outputManager: {
          ...state.outputManager,
          filter: action.value
        }
      });
    case "output/cursor-delta":
      return clampOutputCursor({
        ...state,
        outputManager: {
          ...state.outputManager,
          cursor: state.outputManager.cursor + action.delta
        }
      });
    case "output/toggle-select": {
      const selected = new Set(state.outputManager.selectedIds);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return {
        ...state,
        outputManager: {
          ...state.outputManager,
          selectedIds: [...selected]
        }
      };
    }
    case "output/select-all-filtered":
      return {
        ...state,
        outputManager: {
          ...state.outputManager,
          selectedIds: withUniqueSelection([
            ...state.outputManager.selectedIds,
            ...getFilteredOutputItems(state).map((item) => item.id)
          ])
        }
      };
    case "output/clear-selection":
      return {
        ...state,
        outputManager: {
          ...state.outputManager,
          selectedIds: [],
          confirmation: null
        }
      };
    case "output/open-confirm":
      return {
        ...state,
        screen: "output-confirm",
        outputManager: {
          ...state.outputManager,
          confirmation: action.confirmation,
          loading: false,
          message: "",
          error: ""
        }
      };
    case "output/close-confirm":
      return {
        ...state,
        screen: "output-manager",
        outputManager: {
          ...state.outputManager,
          confirmation: null,
          loading: false,
          message: "",
          error: ""
        }
      };
    case "convert/start":
      return {
        ...state,
        screen: "converting",
        converting: {
          ...state.converting,
          active: true,
          queueIndex: 0,
          total: action.total,
          startedAt: action.startedAt,
          lastActivityAt: action.startedAt,
          logs: [],
          results: [],
          currentEvent: null,
          cancelRequested: false,
          stallWarningShown: false,
          mode: action.mode || "convert",
          logOffset: 0,
          network: initialNetworkState()
        }
      };
    case "convert/progress": {
      const network = updateNetworkState(
        state.converting.network,
        action.event,
        action.now
      );
      const suppressLog = action.event.stage === "network-progress";
      const logs = suppressLog
        ? state.converting.logs
        : [...state.converting.logs, action.event].slice(-500);
      const currentEvent =
        suppressLog && state.converting.currentEvent
          ? state.converting.currentEvent
          : action.event;
      return {
        ...state,
        converting: {
          ...state.converting,
          logs,
          lastActivityAt: action.now,
          currentEvent,
          queueIndex: action.queueIndex ?? state.converting.queueIndex,
          network,
          stallWarningShown:
            action.event.stage === "stall-warning"
              ? true
              : state.converting.stallWarningShown
        }
      };
    }
    case "convert/toggle-log":
      return {
        ...state,
        converting: {
          ...state.converting,
          logExpanded: !state.converting.logExpanded
        }
      };
    case "convert/scroll-log":
      return {
        ...state,
        converting: {
          ...state.converting,
          logOffset: Math.max(0, state.converting.logOffset + action.delta)
        }
      };
    case "convert/request-cancel":
      return {
        ...state,
        converting: {
          ...state.converting,
          cancelRequested: true
        }
      };
    case "convert/result":
      return {
        ...state,
        converting: {
          ...state.converting,
          results: [...state.converting.results, action.result]
        }
      };
    case "convert/summary":
      return {
        ...state,
        screen: "summary",
        summary: action.summary,
        qaMode: null,
        converting: {
          ...state.converting,
          active: false
        }
      };
    default:
      return state;
  }
}

module.exports = {
  compareCourseCodes,
  getFilteredEntries,
  getFilteredOutputItems,
  initialState,
  reduce,
  sortCatalogEntries
};
