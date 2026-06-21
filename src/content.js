const path = require("node:path");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---")) {
    return { metadata: {}, body: markdown };
  }
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) {
    return { metadata: {}, body: markdown };
  }
  const raw = markdown.slice(4, end).replace(/\r/g, "");
  const metadata = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    metadata[match[1]] = value;
  }
  return { metadata, body: markdown.slice(end + 4).trim() };
}

function dedupeAdjacentContent(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  const dedupedBlocks = [];
  for (const block of blocks) {
    const normalized = block.replace(/[ \t]+$/gm, "").trimEnd();
    if (!normalized.trim()) continue;
    if (dedupedBlocks.at(-1)?.trim() === normalized.trim()) continue;
    const lines = normalized.split("\n");
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < lines.length; index += 1) {
        const maxWindow = Math.floor((lines.length - index) / 2);
        for (let window = maxWindow; window >= 1; window -= 1) {
          const first = lines.slice(index, index + window).join("\n");
          const second = lines.slice(index + window, index + window * 2).join("\n");
          if (first === second) {
            lines.splice(index + window, window);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    dedupedBlocks.push(lines.join("\n"));
  }
  return dedupedBlocks.join("\n\n");
}

function cleanUnitMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  if (lines[0]?.startsWith("# ")) lines.shift();
  while (lines[0] === "") lines.shift();
  if (lines[0]?.trim() === "Completed") lines.shift();
  while (lines[0] === "") lines.shift();
  if (/^-\s+\d+\s+minutes?$/.test(lines[0]?.trim() || "")) lines.shift();
  while (lines[0] === "") lines.shift();
  const body = lines
    .join("\n")
    .trim()
    .replace(
      /^[ \t]{4,}((?:\[)?!\[[^\]]*\]\([^)]+\)(?:\]\([^)]+\))?)\s*$/gm,
      "$1"
    );
  return dedupeAdjacentContent(body);
}

function discoverLearningPathUids(courseHtml) {
  const uids = [];
  const seen = new Set();
  const regex = /<meta\s+name=["']learn_item["']\s+content=["']([^"']+)["']/gi;
  for (const match of courseHtml.matchAll(regex)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    uids.push(match[1]);
  }
  return uids;
}

function learningPathParent(hierarchy, learningPathUid) {
  for (const module of hierarchy.modules || []) {
    const parent = module.parents?.find(
      (item) => item.type === "learningPath" && item.uid === learningPathUid
    );
    if (parent) return parent;
  }
  return null;
}

function resolveLearnUrl(rawUrl, unitUrl, locale, kind = "link") {
  if (!rawUrl || rawUrl.startsWith("#") || rawUrl.startsWith("data:")) {
    return rawUrl;
  }
  if (/^(mailto:|tel:|javascript:)/i.test(rawUrl)) return rawUrl;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) {
    return new URL(rawUrl, "https://learn.microsoft.com").href;
  }

  if (kind === "image" && /^(?:\.\/)?(?:media|images)\//i.test(rawUrl)) {
    const moduleSlug = new URL(
      unitUrl,
      "https://learn.microsoft.com"
    ).pathname.match(/\/training\/modules\/([^/]+)/i)?.[1];
    if (moduleSlug) {
      return new URL(
        `/${locale}/training/modules/${moduleSlug}/${rawUrl.replace(/^\.\//, "")}`,
        "https://learn.microsoft.com"
      ).href;
    }
  }
  if (kind === "image" && /^(\.\.\/){2,}/.test(rawUrl)) {
    const sourceRelative = rawUrl.replace(/^(\.\.\/)+/, "");
    return `https://learn.microsoft.com/${locale}/training/${sourceRelative}`;
  }
  return new URL(rawUrl, new URL(unitUrl, "https://learn.microsoft.com")).href;
}

function extensionFromContentType(contentType, url) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp"
  };
  const normalized = (contentType || "").split(";")[0].toLowerCase();
  if (map[normalized]) return map[normalized];
  const ext = path.extname(new URL(url).pathname);
  return ext && ext.length <= 5 ? ext : ".bin";
}

function mimeFromExtension(extension) {
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  };
  return map[extension.toLowerCase()] || "application/octet-stream";
}

function extractAssessment(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const questions = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const number = line.match(/^(\d+)\.\s*$/);
    if (number) {
      if (current) questions.push(current);
      current = { questionNumber: Number(number[1]), prompt: "", choices: [] };
      continue;
    }
    if (!current || !line) continue;
    if (!current.prompt) current.prompt = line;
    else current.choices.push(line);
  }
  if (current) questions.push(current);
  return questions;
}

function isExternalResource(url) {
  if (!url || url.startsWith("#")) return false;
  try {
    return new URL(url).hostname !== "learn.microsoft.com";
  } catch {
    return false;
  }
}

module.exports = {
  cleanUnitMarkdown,
  dedupeAdjacentContent,
  discoverLearningPathUids,
  escapeHtml,
  extensionFromContentType,
  extractAssessment,
  isExternalResource,
  learningPathParent,
  mimeFromExtension,
  parseFrontMatter,
  resolveLearnUrl
};
