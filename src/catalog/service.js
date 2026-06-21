const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ensureDir,
  fetchWithProgress,
  readJson,
  sha256,
  writeJson
} = require("../lib");
const { emitProgress } = require("../progress");
const { throwIfAborted } = require("../shared");
const {
  COURSE_CODE_REGEX,
  canonicalPosterUrl,
  parsePosterCatalog,
  pickAnnotation
} = require("./parser");

function validateCatalog(nextCatalog, previousCatalog) {
  if (!Array.isArray(nextCatalog.entries) || !nextCatalog.entries.length) {
    throw new Error("Poster catalog did not contain any entries");
  }
  for (const entry of nextCatalog.entries) {
    if (!entry.code || !entry.title || !entry.url) {
      throw new Error("Poster catalog entry is missing a code, title, or URL");
    }
  }
  if (previousCatalog?.entries?.length) {
    const minimum = Math.max(
      40,
      Math.floor(previousCatalog.entries.length * 0.75)
    );
    if (nextCatalog.entries.length < minimum) {
      throw new Error(
        `Poster catalog shrank suspiciously from ${previousCatalog.entries.length} to ${nextCatalog.entries.length}`
      );
    }
  }
}

async function fetchPosterBinary(appConfig, options) {
  const { refresh = true, signal, onEvent } = options;
  const cacheDir = path.join(appConfig.cacheRoot, "poster");
  const pdfFile = path.join(cacheDir, "Certification-Poster_en-us.pdf");
  const metadataFile = path.join(cacheDir, "poster-metadata.json");
  await ensureDir(cacheDir);
  let previousMetadata = null;
  try {
    previousMetadata = await readJson(metadataFile);
  } catch {}
  if (!refresh) {
    const data = await fs.readFile(pdfFile);
    return {
      data,
      status: "cached",
      metadata: previousMetadata
    };
  }

  const headers = { "user-agent": "MSLearnToPDF/0.3 (+local study snapshot)" };
  if (previousMetadata?.etag) headers["if-none-match"] = previousMetadata.etag;
  if (previousMetadata?.lastModified) {
    headers["if-modified-since"] = previousMetadata.lastModified;
  }
  emitProgress(onEvent, {
    severity: "info",
    stage: "poster-refresh",
    message: "Checking Microsoft certification poster for updates"
  });
  const { response, data } = await fetchWithProgress(appConfig.posterUrl, {
    binary: true,
    headers,
    signal,
    onEvent,
    acceptStatuses: [304],
    progress: {
      transferKind: "poster-pdf",
      transferLabel: "Certification poster PDF"
    }
  });
  if (response.status === 304) {
    return {
      data: await fs.readFile(pdfFile),
      status: "not-modified",
      metadata: previousMetadata
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching poster`);
  }
  await fs.writeFile(pdfFile, data);
  const metadata = {
    url: appConfig.posterUrl,
    etag: response.headers.get("etag") || "",
    lastModified: response.headers.get("last-modified") || "",
    retrievedAt: new Date().toISOString(),
    bytes: data.length,
    sha256: sha256(data)
  };
  await writeJson(metadataFile, metadata);
  return {
    data,
    status: "downloaded",
    metadata
  };
}

function normalizeCredentialTitle(html, fallbackCode) {
  const raw =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] ||
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
    "";
  const cleaned = raw
    .replace(/\s*\|\s*Microsoft Learn.*$/i, "")
    .replace(/^Exam\s+[A-Z0-9-]+:\s*/i, "")
    .replace(/^Certification details\s*[-:]\s*/i, "")
    .replace(/\s*-\s*Credentials.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallbackCode;
}

async function hydrateIncompleteEntries(appConfig, catalog, options) {
  const { signal, onEvent } = options;
  const cacheDir = path.join(appConfig.cacheRoot, "poster", "credential-pages");
  await ensureDir(cacheDir);
  const hydratedEntries = [];
  for (const entry of catalog.entries) {
    const needsHydration =
      !entry.title ||
      entry.title === entry.code ||
      /full certification title/i.test(entry.title);
    if (!needsHydration) {
      hydratedEntries.push(entry);
      continue;
    }
    try {
      const html = await fs.readFile(
        path.join(cacheDir, `${entry.code}.html`),
        "utf8"
      );
      hydratedEntries.push({
        ...entry,
        title: normalizeCredentialTitle(html, entry.code)
      });
      continue;
    } catch {}

    try {
      const { data: html } = await fetchWithProgress(entry.url, {
        signal,
        onEvent,
        progress: {
          transferKind: "credential-page",
          transferLabel: `Credential page ${entry.code}`,
          scope: { courseCode: entry.code }
        }
      });
      await fs.writeFile(path.join(cacheDir, `${entry.code}.html`), html, "utf8");
      hydratedEntries.push({
        ...entry,
        title: normalizeCredentialTitle(html, entry.code)
      });
    } catch {
      hydratedEntries.push(entry);
    }
  }
  return {
    ...catalog,
    entries: hydratedEntries
  };
}

async function loadPosterCatalog(appConfig, options = {}) {
  const { refresh = appConfig.refreshPosterOnStart, signal, onEvent } = options;
  const fetchPoster = options.fetchPosterBinary || fetchPosterBinary;
  const parsePoster = options.parsePosterCatalog || parsePosterCatalog;
  const hydrateEntries = options.hydrateIncompleteEntries || hydrateIncompleteEntries;
  const cacheDir = path.join(appConfig.cacheRoot, "poster");
  const catalogFile = path.join(cacheDir, "catalog.json");
  let previousCatalog = null;
  try {
    previousCatalog = await readJson(catalogFile);
  } catch {}

  try {
    throwIfAborted(signal);
    const poster = await fetchPoster(appConfig, { refresh, signal, onEvent });
    let catalog = await parsePoster(poster.data, appConfig.posterUrl);
    catalog = await hydrateEntries(appConfig, catalog, {
      refresh,
      signal,
      onEvent
    });
    validateCatalog(catalog, previousCatalog);
    const hydrated = {
      ...catalog,
      poster: {
        url: appConfig.posterUrl,
        retrievedAt:
          poster.metadata?.retrievedAt || previousCatalog?.poster?.retrievedAt || null,
        status: poster.status
      }
    };
    await writeJson(catalogFile, hydrated);
    emitProgress(onEvent, {
      severity: "info",
      stage: "poster-ready",
      message: `Loaded ${hydrated.entries.length} poster catalog entries`
    });
    return hydrated;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (previousCatalog) {
      emitProgress(onEvent, {
        severity: "warn",
        stage: "warning",
        message: `Using cached poster catalog: ${error.message}`
      });
      return previousCatalog;
    }
    throw error;
  }
}

module.exports = {
  COURSE_CODE_REGEX,
  canonicalPosterUrl,
  loadPosterCatalog,
  pickAnnotation,
  parsePosterCatalog,
  validateCatalog
};
