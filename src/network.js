const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, sha256 } = require("./files");
const { emitProgress } = require("./progress");
const { abortError, throwIfAborted } = require("./shared");

const NETWORK_PROGRESS_INTERVAL_MS = 200;
const NETWORK_PROGRESS_STEP_BYTES = 64 * 1024;
const DEFAULT_USER_AGENT = "MSLearnToPDF/0.3 (+local study snapshot)";
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 5,
  baseDelayMs: 1500,
  maxDelayMs: 30000,
  jitterRatio: 0.25
};
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
let transferSequence = 0;

function nextTransferId(url, label) {
  transferSequence += 1;
  return `${sha256(`${url}|${label || ""}`).slice(0, 12)}-${transferSequence}`;
}

function buildTransferProgress(progress = {}, url, fallbackKind = "download") {
  const label = progress.transferLabel || url;
  return {
    transferId: progress.transferId || nextTransferId(url, label),
    transferUrl: url,
    transferLabel: label,
    transferKind: progress.transferKind || fallbackKind,
    scope: progress.scope || {}
  };
}

function parseRetryAfterMs(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

function shouldRetryStatus(status) {
  return RETRYABLE_HTTP_STATUS.has(Number(status));
}

function shouldRetryError(error) {
  if (!error || error.name === "AbortError") return false;
  if (error.status && !shouldRetryStatus(error.status)) return false;
  return true;
}

function retryConfig(retry = {}) {
  return { ...DEFAULT_RETRY_OPTIONS, ...retry };
}

function computeRetryDelayMs(attempt, retryAfterMs, retry = {}) {
  const config = retryConfig(retry);
  const exponentialDelay = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.max(0, attempt - 1)
  );
  const candidateDelay = Math.max(retryAfterMs || 0, exponentialDelay);
  const random = typeof config.random === "function" ? config.random() : Math.random();
  const jitter = Math.round(candidateDelay * config.jitterRatio * Math.max(0, random));
  return Math.min(config.maxDelayMs, candidateDelay + jitter);
}

function createHttpError(status, url) {
  const error = new Error(`HTTP ${status} fetching ${url}`);
  error.status = status;
  error.url = url;
  return error;
}

async function waitWithSignal(ms, signal) {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal.reason || "Operation aborted"));
    };
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readResponseBody(response, options = {}) {
  const { binary = false, onEvent, progress = {}, signal, transfer } = options;
  const activeTransfer = transfer || buildTransferProgress(progress, response.url || "");
  const contentLength = Number(response.headers.get("content-length") || 0) || 0;
  const startedAt = Date.now();
  let lastEmitAt = startedAt;
  let lastEmitBytes = 0;
  let bytesTransferred = 0;
  const chunks = [];

  const emitTransferEvent = (stage, extra = {}) => {
    emitProgress(onEvent, {
      severity: extra.severity || "info",
      stage,
      message:
        extra.message ||
        (stage === "network-start"
          ? `Downloading ${activeTransfer.transferLabel}`
          : stage === "network-complete"
            ? `Downloaded ${activeTransfer.transferLabel}`
            : `Downloading ${activeTransfer.transferLabel}`),
      transferId: activeTransfer.transferId,
      transferUrl: activeTransfer.transferUrl,
      transferLabel: activeTransfer.transferLabel,
      transferKind: activeTransfer.transferKind,
      bytesTransferred,
      contentLength,
      transferBytesPerSecond:
        extra.transferBytesPerSecond ??
        (Date.now() > startedAt
          ? bytesTransferred / Math.max((Date.now() - startedAt) / 1000, 0.001)
          : 0),
      durationMs: extra.durationMs,
      ...activeTransfer.scope,
      ...extra
    });
  };

  emitTransferEvent("network-start", {
    bytesTransferred: 0,
    transferBytesPerSecond: 0
  });

  try {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      try {
        while (true) {
          if (signal?.aborted) {
            await reader.cancel(signal.reason).catch(() => {});
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          chunks.push(chunk);
          bytesTransferred += chunk.length;
          const now = Date.now();
          if (
            now - lastEmitAt >= NETWORK_PROGRESS_INTERVAL_MS ||
            bytesTransferred - lastEmitBytes >= NETWORK_PROGRESS_STEP_BYTES
          ) {
            emitTransferEvent("network-progress");
            lastEmitAt = now;
            lastEmitBytes = bytesTransferred;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      const data = Buffer.from(await response.arrayBuffer());
      chunks.push(data);
      bytesTransferred = data.length;
    }
    emitTransferEvent("network-complete", {
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    emitTransferEvent("network-error", {
      severity: error?.name === "AbortError" ? "warn" : "error",
      message:
        error?.name === "AbortError"
          ? `Cancelled ${activeTransfer.transferLabel}`
          : `Failed ${activeTransfer.transferLabel}: ${error.message}`
    });
    throw error;
  }

  const buffer = Buffer.concat(chunks);
  return binary ? buffer : buffer.toString("utf8");
}

async function fetchResponseWithRetry(url, options = {}) {
  const {
    headers = {},
    signal,
    onEvent,
    progress,
    userAgent = DEFAULT_USER_AGENT,
    retry = {},
    acceptStatuses = []
  } = options;
  const transfer = buildTransferProgress(progress, url);
  const config = retryConfig(retry);
  const wait = typeof config.wait === "function" ? config.wait : waitWithSignal;
  const maxAttempts = Math.max(1, config.maxRetries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": userAgent, ...headers },
        signal
      });
      if (response.ok || acceptStatuses.includes(response.status)) {
        return { response, transfer };
      }
      const error = createHttpError(response.status, url);
      if (attempt >= maxAttempts || !shouldRetryStatus(response.status)) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const retryDelayMs = computeRetryDelayMs(attempt, retryAfterMs, config);
      emitProgress(onEvent, {
        severity: "warn",
        stage: response.status === 429 ? "rate-limit" : "retry-backoff",
        message: `HTTP ${response.status} for ${transfer.transferLabel}; retrying in ${Math.max(1, Math.ceil(retryDelayMs / 1000))}s (attempt ${attempt + 1} of ${maxAttempts})`,
        transferId: transfer.transferId,
        transferUrl: transfer.transferUrl,
        transferLabel: transfer.transferLabel,
        transferKind: transfer.transferKind,
        retryDelayMs,
        retryAttempt: attempt,
        retryNextAttempt: attempt + 1,
        retryMaxAttempts: maxAttempts,
        httpStatus: response.status,
        ...transfer.scope
      });
      if (response.body && typeof response.body.cancel === "function") {
        await response.body.cancel().catch(() => {});
      }
      await wait(retryDelayMs, signal);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (attempt >= maxAttempts || !shouldRetryError(error)) throw error;
      const retryDelayMs = computeRetryDelayMs(attempt, 0, config);
      emitProgress(onEvent, {
        severity: "warn",
        stage: "retry-backoff",
        message: `${error.message} for ${transfer.transferLabel}; retrying in ${Math.max(1, Math.ceil(retryDelayMs / 1000))}s (attempt ${attempt + 1} of ${maxAttempts})`,
        transferId: transfer.transferId,
        transferUrl: transfer.transferUrl,
        transferLabel: transfer.transferLabel,
        transferKind: transfer.transferKind,
        retryDelayMs,
        retryAttempt: attempt,
        retryNextAttempt: attempt + 1,
        retryMaxAttempts: maxAttempts,
        httpStatus: error.status || 0,
        ...transfer.scope
      });
      await wait(retryDelayMs, signal);
    }
  }

  throw new Error(`Retry loop exited unexpectedly for ${url}`);
}

async function fetchWithProgress(url, options = {}) {
  const {
    binary = false,
    headers = {},
    signal,
    onEvent,
    progress,
    userAgent = DEFAULT_USER_AGENT,
    retry,
    acceptStatuses
  } = options;
  const { response, transfer } = await fetchResponseWithRetry(url, {
    headers,
    signal,
    onEvent,
    progress,
    userAgent,
    retry,
    acceptStatuses
  });
  const data = await readResponseBody(response, {
    binary,
    onEvent,
    progress,
    signal,
    transfer
  });
  return { response, data };
}

async function fetchCached(url, cacheFile, options = {}) {
  const {
    refresh = false,
    binary = false,
    headers = {},
    signal,
    onEvent,
    progress,
    userAgent = DEFAULT_USER_AGENT,
    retry
  } = options;
  if (!refresh) {
    try {
      const data = await fs.readFile(cacheFile);
      return binary ? data : data.toString("utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const { data } = await fetchWithProgress(url, {
    binary,
    headers,
    signal,
    onEvent,
    progress,
    userAgent,
    retry
  });
  await ensureDir(path.dirname(cacheFile));
  await fs.writeFile(cacheFile, data);
  return data;
}

module.exports = {
  fetchCached,
  fetchWithProgress
};
