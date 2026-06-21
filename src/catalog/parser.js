const COURSE_CODE_REGEX = /\b([A-Z]{2,5}-\d{2,4})\b/g;

function canonicalPosterUrl(rawUrl) {
  if (!rawUrl) return "";
  let repaired = String(rawUrl).trim();
  if (/^https:\/[^/]/i.test(repaired)) {
    repaired = repaired.replace(/^https:\//i, "https://");
  } else if (/^http:\/[^/]/i.test(repaired)) {
    repaired = repaired.replace(/^http:\//i, "http://");
  }
  try {
    const url = new URL(repaired);
    if (!/learn\.microsoft\.com$/i.test(url.hostname)) return "";
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/+$/u, "/");
  } catch {
    return "";
  }
}

function rectFromItem(item) {
  const [, b, , d, e, f] = item.transform;
  const height = Math.max(Math.abs(d) || 0, Math.abs(b) || 0, item.height || 0, 8);
  return {
    left: e,
    right: e + item.width,
    bottom: f,
    top: f + height,
    width: item.width,
    height,
    centerX: e + item.width / 2,
    centerY: f + height / 2
  };
}

function rectFromAnnotation(annotation) {
  const [left, bottom, right, top] = annotation.rect;
  return {
    left,
    right,
    bottom,
    top,
    width: right - left,
    height: top - bottom,
    centerX: (left + right) / 2,
    centerY: (bottom + top) / 2
  };
}

function groupLines(items) {
  const sorted = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({ ...item, rect: rectFromItem(item) }))
    .sort((a, b) => b.rect.centerY - a.rect.centerY || a.rect.left - b.rect.left);
  const rows = [];
  for (const item of sorted) {
    const existing = rows.find(
      (line) => Math.abs(line.centerY - item.rect.centerY) <= 3.5
    );
    if (existing) {
      existing.items.push(item);
      existing.left = Math.min(existing.left, item.rect.left);
      existing.right = Math.max(existing.right, item.rect.right);
      existing.top = Math.max(existing.top, item.rect.top);
      existing.bottom = Math.min(existing.bottom, item.rect.bottom);
      existing.centerY =
        existing.items.reduce((sum, candidate) => sum + candidate.rect.centerY, 0) /
        existing.items.length;
    } else {
      rows.push({
        items: [item],
        left: item.rect.left,
        right: item.rect.right,
        top: item.rect.top,
        bottom: item.rect.bottom,
        centerY: item.rect.centerY
      });
    }
  }
  return rows
    .flatMap((row) => {
      const ordered = row.items.sort((a, b) => a.rect.left - b.rect.left);
      const fragments = [];
      let current = [];
      for (const item of ordered) {
        const previous = current.at(-1);
        if (previous && item.rect.left - previous.rect.right > 36) {
          fragments.push(current);
          current = [item];
        } else {
          current.push(item);
        }
      }
      if (current.length) fragments.push(current);
      return fragments.map((fragment) => ({
        items: fragment,
        left: Math.min(...fragment.map((item) => item.rect.left)),
        right: Math.max(...fragment.map((item) => item.rect.right)),
        top: Math.max(...fragment.map((item) => item.rect.top)),
        bottom: Math.min(...fragment.map((item) => item.rect.bottom)),
        centerY:
          fragment.reduce((sum, item) => sum + item.rect.centerY, 0) / fragment.length,
        text: fragment.map((item) => item.str).join("").replace(/\s+/g, " ").trim()
      }));
    })
    .filter((line) => line.text);
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
  return width * height;
}

function rectContains(inner, outer) {
  return (
    inner.left <= outer.left + 1 &&
    inner.right >= outer.right - 1 &&
    inner.bottom <= outer.bottom + 1 &&
    inner.top >= outer.top - 1
  );
}

function extractTitleForCode(codeItem, lines) {
  const candidates = lines
    .filter(
      (line) =>
        line.centerY > codeItem.rect.centerY + 8 &&
        line.centerY < codeItem.rect.centerY + 78 &&
        Math.abs(line.left - codeItem.rect.left) < 18 &&
        line.right - line.left < 260 &&
        !/\b[A-Z]{2,5}-\d{2,4}\b/.test(line.text)
    )
    .sort((a, b) => b.centerY - a.centerY);
  const titleLines = [];
  for (const line of candidates) {
    if (titleLines.length && titleLines.at(-1).centerY - line.centerY > 18) break;
    titleLines.push(line);
  }
  return titleLines
    .sort((a, b) => b.centerY - a.centerY)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNearbyTitleFallback(codeItem, lines) {
  const candidates = lines
    .filter(
      (line) =>
        line.centerY > codeItem.rect.centerY + 8 &&
        line.centerY < codeItem.rect.centerY + 90 &&
        line.left >= codeItem.rect.left - 140 &&
        line.left <= codeItem.rect.left + 20 &&
        line.right - line.left < 260 &&
        !/\b[A-Z]{2,5}-\d{2,4}\b/.test(line.text)
    )
    .sort((a, b) => b.centerY - a.centerY);
  const titleLines = [];
  for (const line of candidates) {
    if (
      titleLines.length &&
      (Math.abs(titleLines.at(-1).left - line.left) > 6 ||
        titleLines.at(-1).centerY - line.centerY > 18)
    ) {
      break;
    }
    titleLines.push(line);
  }
  return titleLines
    .sort((a, b) => b.centerY - a.centerY)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackPosterUrl(code) {
  return `https://learn.microsoft.com/en-us/credentials/certifications/exams/${code.toLowerCase()}/`;
}

function pickAnnotation(codeItem, annotations) {
  const expanded = {
    left: codeItem.rect.left - 4,
    right: codeItem.rect.right + 4,
    top: codeItem.rect.top + 4,
    bottom: codeItem.rect.bottom - 4
  };
  const direct = annotations
    .map((annotation) => ({
      annotation,
      overlap: intersectionArea(expanded, annotation.rect),
      area: annotation.rect.width * annotation.rect.height,
      dy: Math.abs(annotation.rect.centerY - codeItem.rect.centerY),
      containsCode: rectContains(annotation.rect, codeItem.rect)
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort((a, b) => {
      const containsCompare = Number(b.containsCode) - Number(a.containsCode);
      if (containsCompare) return containsCompare;
      const dyCompare = a.dy - b.dy;
      if (dyCompare) return dyCompare;
      const areaCompare = a.area - b.area;
      if (areaCompare) return areaCompare;
      return b.overlap - a.overlap;
    })[0];
  if (direct) return direct.annotation;

  return annotations
    .map((annotation) => ({
      annotation,
      score:
        Math.abs(annotation.rect.centerY - codeItem.rect.centerY) * 2 +
        Math.abs(annotation.rect.left - codeItem.rect.left)
    }))
    .filter(
      (candidate) =>
        Math.abs(candidate.annotation.rect.left - codeItem.rect.left) < 24 &&
        Math.abs(candidate.annotation.rect.centerY - codeItem.rect.centerY) < 90
    )
    .sort((a, b) => a.score - b.score)[0]?.annotation;
}

async function parsePosterCatalog(binary, sourceUrl) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(binary),
    disableWorker: true
  }).promise;
  const entries = [];
  const warnings = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const annotations = (await page.getAnnotations())
      .filter((annotation) => annotation.url)
      .map((annotation) => ({
        ...annotation,
        normalizedUrl: canonicalPosterUrl(annotation.url),
        rect: rectFromAnnotation(annotation)
      }))
      .filter((annotation) => annotation.normalizedUrl);
    const textItems = textContent.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({ ...item, rect: rectFromItem(item) }));
    const lines = groupLines(textItems);
    for (const item of textItems) {
      const match = item.str.match(/^[A-Z]{2,5}-\d{2,4}$/);
      if (!match) continue;
      const code = match[0].toUpperCase();
      const annotation = pickAnnotation(item, annotations);
      const title =
        extractTitleForCode(item, lines) ||
        extractNearbyTitleFallback(item, lines) ||
        code;
      const url = annotation?.normalizedUrl || fallbackPosterUrl(code);
      if (!title || title === code) warnings.push(`No nearby title text found for ${code}`);
      if (!annotation?.normalizedUrl) {
        warnings.push(`No poster link found for ${code}; using inferred exam URL`);
      }
      entries.push({
        code,
        title,
        url,
        pageNumber,
        sourceUrl,
        cardTop: item.rect.top,
        cardLeft: item.rect.left
      });
    }
  }

  const deduped = new Map();
  for (const entry of entries) {
    const existing = deduped.get(entry.code);
    if (!existing) {
      deduped.set(entry.code, entry);
      continue;
    }
    const existingScore =
      (existing.url ? 10 : 0) + (existing.title && existing.title !== existing.code ? 5 : 0);
    const nextScore =
      (entry.url ? 10 : 0) + (entry.title && entry.title !== entry.code ? 5 : 0);
    if (nextScore > existingScore) deduped.set(entry.code, entry);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceUrl,
    pageCount: document.numPages,
    warnings,
    entries: [...deduped.values()].sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      if (Math.abs(a.cardTop - b.cardTop) > 1) return b.cardTop - a.cardTop;
      return a.cardLeft - b.cardLeft;
    })
  };
}

module.exports = {
  COURSE_CODE_REGEX,
  canonicalPosterUrl,
  parsePosterCatalog,
  pickAnnotation
};
