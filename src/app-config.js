const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, readJson } = require("./lib");

const DEFAULT_APP_CONFIG = {
  posterUrl:
    "https://arch-center.azureedge.net/Credentials/Certification-Poster_en-us.pdf",
  outputRoot: "./output",
  cacheRoot: "./cache",
  locale: "en-us",
  paperFormat: "A4",
  refreshPosterOnStart: true,
  refreshCourseContent: true,
  stallWarningSeconds: 60,
  logLevel: "verbose",
  theme: "azure"
};

function resolveSetting(configDir, value) {
  return path.resolve(configDir, value);
}

function validateAppConfig(config) {
  if (!/^https:\/\/.+/i.test(config.posterUrl)) {
    throw new Error("config.posterUrl must be an https URL");
  }
  if (!config.locale) throw new Error("config.locale is required");
  if (!config.paperFormat) throw new Error("config.paperFormat is required");
  if (
    !Number.isInteger(config.stallWarningSeconds) ||
    config.stallWarningSeconds < 1
  ) {
    throw new Error("config.stallWarningSeconds must be a positive integer");
  }
}

async function loadAppConfig(root, configPath) {
  const file = path.resolve(root, configPath || path.join("config", "app.json"));
  const configDir = path.dirname(file);
  const raw = await readJson(file);
  const config = {
    ...DEFAULT_APP_CONFIG,
    ...raw,
    configFile: file,
    configDirectory: configDir
  };
  config.outputRoot = resolveSetting(configDir, config.outputRoot);
  config.cacheRoot = resolveSetting(configDir, config.cacheRoot);
  validateAppConfig(config);
  return config;
}

async function ensureWritableDirectory(directory) {
  await ensureDir(directory);
  const probe = path.join(directory, ".write-test");
  await fs.writeFile(probe, "ok", "utf8");
  await fs.rm(probe, { force: true });
}

module.exports = {
  DEFAULT_APP_CONFIG,
  ensureWritableDirectory,
  loadAppConfig,
  validateAppConfig
};
