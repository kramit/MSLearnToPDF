function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isLearningPathUid(uid) {
  return /^learn[.-]/i.test(String(uid || ""));
}

function isCourseUid(uid) {
  return /^course\./i.test(String(uid || ""));
}

function noTrainingAvailable(html) {
  return /No training available for this exam|Learning paths or modules are not yet available for this certification/i.test(
    String(html || "")
  );
}

function learningPathParent(hierarchy, uid) {
  for (const module of hierarchy.modules || []) {
    const parent = module.parents?.find(
      (item) => item.type === "learningPath" && item.uid === uid
    );
    if (parent) return parent;
  }
  return null;
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(
    /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  )) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function metaEntries(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) =>
    tagAttributes(match[0])
  );
}

function metaContent(html, name, attribute = "name") {
  const expected = String(name).toLowerCase();
  return (
    metaEntries(html).find(
      (entry) => entry[attribute] && entry[attribute].toLowerCase() === expected
    )?.content || ""
  );
}

function pageTitle(html) {
  return (
    metaContent(html, "og:title", "property") ||
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pageMetadata(html, url) {
  const metas = metaEntries(html);
  const dataUids = [...html.matchAll(/data-learn-uid=["']([^"']+)["']/gi)].map(
    (match) => match[1]
  );
  const metaItems = metas
    .filter((entry) => entry.name?.toLowerCase() === "learn_item")
    .map((entry) => entry.content);
  const courseLinks = [
    ...html.matchAll(
      /href=["']([^"']*\/training\/courses\/([^"'/?#]+)[^"']*)["']/gi
    )
  ].map((match) => ({
    url: new URL(match[1], "https://learn.microsoft.com").href,
    slug: match[2].toLowerCase()
  }));
  return {
    url,
    schema: metaContent(html, "schema"),
    uid: metaContent(html, "uid"),
    canonicalUrl: metaContent(html, "canonicalUrl") || url,
    title: pageTitle(html),
    learningPathUids: unique(
      [...metaItems, ...dataUids].filter((uid) => isLearningPathUid(uid))
    ),
    courseUids: unique(
      [...dataUids].filter((uid) => uid.startsWith("course."))
    ),
    courseLinks
  };
}

function courseSlugFromUid(uid) {
  const match = uid?.match(/^course\.([a-z0-9-]+)$/i);
  return match?.[1]?.toLowerCase() || "";
}

function inferCourseCode(value) {
  const slug = courseSlugFromUid(value) || String(value || "").toLowerCase();
  const match = slug.match(/^([a-z]+)-?(\d+)(?:t\d+)?$/i);
  if (!match) return "";
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function canonicalInputUrl(input) {
  const url = new URL(input);
  if (url.hostname !== "learn.microsoft.com") {
    throw new Error("Only public learn.microsoft.com URLs are supported");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

function learningPathUidFromUrl(url) {
  return new URL(url).pathname.match(/\/training\/paths\/([^/]+)/i)?.[1] || "";
}

function courseSlugFromUrl(url) {
  return new URL(url).pathname.match(/\/training\/courses\/([^/]+)/i)?.[1] || "";
}

function defaultCourseSlugForCode(courseCode) {
  if (!courseCode) return "";
  return `${String(courseCode).toLowerCase()}t00`;
}

async function loadCandidateCoursePage(slug, locale, fetchHtml) {
  if (!slug) return null;
  const courseUrl = `https://learn.microsoft.com/${locale}/training/courses/${slug}`;
  try {
    const courseHtml = await fetchHtml(courseUrl);
    const coursePage = pageMetadata(courseHtml, courseUrl);
    if (coursePage.schema !== "Course" && !isCourseUid(coursePage.uid)) {
      return null;
    }
    return {
      slug,
      courseUrl,
      courseHtml,
      coursePage
    };
  } catch {
    return null;
  }
}

async function resolveInputUrl(input, options) {
  const {
    fetchHtml,
    fetchHierarchy,
    courseCodeOverride = "",
    locale = "en-us"
  } = options;
  const originalUrl = input;
  const normalizedUrl = canonicalInputUrl(input);
  const inputHtml = await fetchHtml(normalizedUrl);
  const inputPage = pageMetadata(inputHtml, normalizedUrl);
  const inputHasNoTraining = noTrainingAvailable(inputHtml);
  const warnings = [];
  let courseUrl = "";
  let courseUid = "";
  let courseTitle = "";
  let coursePathUids = [];
  const directPathUids = [...inputPage.learningPathUids];

  const directPathSlug = learningPathUidFromUrl(normalizedUrl);
  if (directPathSlug) {
    const candidate =
      isLearningPathUid(inputPage.uid) ? inputPage.uid : directPathSlug;
    const hierarchy = await fetchHierarchy(candidate);
    const parent = learningPathParent(hierarchy, candidate);
    const titleCode = parent?.title?.match(/\b([A-Z]{2,5}-\d{2,4})\b/)?.[1] || "";
    if (
      courseCodeOverride &&
      titleCode &&
      titleCode.toUpperCase() !== courseCodeOverride.toUpperCase()
    ) {
      throw new Error(
        `The learning path resolves to ${titleCode.toUpperCase()}, which does not match the requested course code ${courseCodeOverride.toUpperCase()}.`
      );
    }
    const code =
      courseCodeOverride ||
      titleCode ||
      "";
    if (!code) {
      throw new Error(
        "A direct learning-path URL does not identify a course code. Supply --course-code."
      );
    }
    return {
      originalUrl,
      normalizedUrl,
      inputPageType: inputPage.schema || "LearningPath",
      inputUid: inputPage.uid || candidate,
      courseCode: code.toUpperCase(),
      courseTitle: parent?.title || inputPage.title,
      courseUrl: normalizedUrl,
      learningPathUids: [candidate],
      warnings
    };
  }

  const inputCourseSlug = courseSlugFromUrl(normalizedUrl);
  if (inputCourseSlug) {
    courseUid = inputPage.uid || `course.${inputCourseSlug}`;
    courseUrl = normalizedUrl;
  } else {
    const referencedCourseUids = unique(inputPage.courseUids);
    const linkedSlugs = unique(inputPage.courseLinks.map((item) => item.slug));
    const courseSlugs = unique([
      ...referencedCourseUids.map(courseSlugFromUid),
      ...linkedSlugs
    ]);
    if (courseSlugs.length > 1 && !courseCodeOverride) {
      throw new Error(
        `The page references multiple training courses (${courseSlugs.join(
          ", "
        )}). Supply --course-code.`
      );
    }
    let selectedSlug = courseSlugs[0] || "";
    if (courseCodeOverride && courseSlugs.length > 1) {
      selectedSlug =
        courseSlugs.find(
          (slug) => inferCourseCode(slug) === courseCodeOverride.toUpperCase()
        ) || "";
    }
    const overrideSlug = defaultCourseSlugForCode(courseCodeOverride);
    const needsOverrideFallback =
      courseCodeOverride &&
      (!selectedSlug ||
        inferCourseCode(selectedSlug) !== courseCodeOverride.toUpperCase());
    if (needsOverrideFallback) {
      const candidate = await loadCandidateCoursePage(
        overrideSlug,
        locale,
        fetchHtml
      );
      if (candidate) {
        selectedSlug = candidate.slug;
      }
    }
    if (!selectedSlug) {
      if (inputHasNoTraining) {
        throw new Error(
          "Microsoft Learn reports that no training is available for this certification or exam."
        );
      }
      throw new Error(
        `Unsupported Microsoft Learn page. Found schema="${inputPage.schema ||
          "unknown"}", uid="${inputPage.uid || "unknown"}", and no training course reference.`
      );
    }
    courseUid = `course.${selectedSlug}`;
    courseUrl = `https://learn.microsoft.com/${locale}/training/courses/${selectedSlug}`;
  }

  const courseHtml = await fetchHtml(courseUrl);
  const coursePage = pageMetadata(courseHtml, courseUrl);
  courseUid = coursePage.uid || courseUid;
  courseTitle = coursePage.title
    .replace(/\s*\|\s*Microsoft Learn.*$/i, "")
    .replace(/\s*-\s*Training\s*$/i, "")
    .replace(/^Course\s+[A-Z0-9-]+:\s*/i, "")
    .trim();
  coursePathUids = coursePage.learningPathUids;
  const candidateLearningPathUids = coursePathUids.length
    ? [...coursePathUids]
    : [...directPathUids];
  if (!candidateLearningPathUids.length) {
    if (inputHasNoTraining || noTrainingAvailable(courseHtml)) {
      throw new Error(
        "Microsoft Learn reports that no learning paths or modules are available for this certification or exam."
      );
    }
    throw new Error(`No learning paths were discovered from ${courseUrl}`);
  }
  const inferredCodes = unique(
    [courseUid, courseSlugFromUrl(courseUrl)]
      .map(inferCourseCode)
      .filter(Boolean)
  );
  if (inferredCodes.length > 1 && !courseCodeOverride) {
    throw new Error(
      `Conflicting course codes were inferred (${inferredCodes.join(
        ", "
      )}). Supply --course-code.`
    );
  }
  if (
    courseCodeOverride &&
    inferredCodes.length &&
    !inferredCodes.includes(courseCodeOverride.toUpperCase())
  ) {
    throw new Error(
      `The supplied URL resolves to ${inferredCodes.join(
        ", "
      )}, which does not match the requested course code ${courseCodeOverride.toUpperCase()}.`
    );
  }
  const courseCode =
    courseCodeOverride.toUpperCase() || inferredCodes[0] || "";
  if (!courseCode) {
    throw new Error("The course code could not be inferred. Supply --course-code.");
  }

  const learningPathUids = [];
  for (const uid of candidateLearningPathUids) {
    try {
      const hierarchy = await fetchHierarchy(uid);
      const parent = learningPathParent(hierarchy, uid);
      if (!parent) {
        throw new Error(
          `Hierarchy for ${uid} did not contain a matching learning-path parent`
        );
      }
      const titleCode = parent?.title
        ?.match(/\b([A-Z]{2,5}-\d{2,4})\b/)?.[1]
        ?.toUpperCase();
      if (titleCode && titleCode !== courseCode.toUpperCase()) {
        warnings.push(
          `Learning path "${parent.title}" contains course code ${titleCode}, which differs from ${courseCode}.`
        );
      }
      learningPathUids.push(uid);
    } catch (error) {
      if (
        /learning_path_id_not_found/i.test(error.message) ||
        /HTTP 404/i.test(error.message)
      ) {
        warnings.push(
          `Skipping unavailable learning path exposed by Microsoft Learn: ${uid}.`
        );
        continue;
      }
      throw error;
    }
  }
  if (!learningPathUids.length) {
    if (inputHasNoTraining || noTrainingAvailable(courseHtml)) {
      throw new Error(
        "Microsoft Learn reports that no learning paths or modules are available for this certification or exam."
      );
    }
    throw new Error(`No learning paths were discovered from ${courseUrl}`);
  }

  return {
    originalUrl,
    normalizedUrl,
    inputPageType: inputPage.schema || "unknown",
    inputUid: inputPage.uid,
    courseCode,
    courseUid,
    courseTitle,
    courseUrl,
    learningPathUids,
    directLearningPathUids: directPathUids,
    courseLearningPathUids: coursePathUids,
    warnings
  };
}

module.exports = {
  canonicalInputUrl,
  courseSlugFromUid,
  inferCourseCode,
  isLearningPathUid,
  metaContent,
  pageMetadata,
  resolveInputUrl
};
