const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

module.exports = {
  ensureDir,
  readJson,
  sha256,
  writeJson
};
