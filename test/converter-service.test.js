const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  convertCourseFromResolution,
  shouldSkipCourseMembershipCheck
} = require("../src/converter/service");
const { slug } = require("../src/shared");

test("direct credential learning paths bypass canonical course membership checks", () => {
  const resolution = {
    normalizedUrl: "https://learn.microsoft.com/en-us/credentials/certifications/example/",
    learningPathUids: ["learn.course-path", "learn.direct-path"],
    directLearningPathUids: ["learn.direct-path"]
  };
  assert.equal(
    shouldSkipCourseMembershipCheck(resolution, "learn.course-path"),
    false
  );
  assert.equal(
    shouldSkipCourseMembershipCheck(resolution, "learn.direct-path"),
    true
  );
});

test("a hierarchy failure is recorded per path and does not abort later paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mslearn-converter-"));
  const cacheRoot = path.join(root, "cache");
  const outputRoot = path.join(root, "output");
  const courseCode = "ZZ-999";
  const learningPathUids = ["learn.first-broken", "learn.second-broken"];

  for (const uid of learningPathUids) {
    const hierarchyFile = path.join(
      cacheRoot,
      slug(courseCode),
      slug(uid),
      "learning-path.json"
    );
    await fs.mkdir(path.dirname(hierarchyFile), { recursive: true });
    await fs.writeFile(hierarchyFile, JSON.stringify({ modules: [] }), "utf8");
  }

  const resolution = {
    originalUrl: "https://learn.microsoft.com/en-us/training/courses/zz-999t00",
    normalizedUrl: "https://learn.microsoft.com/en-us/training/courses/zz-999t00",
    inputPageType: "Course",
    courseCode,
    courseUid: "course.zz-999t00",
    courseTitle: "Synthetic test course",
    courseUrl: "https://learn.microsoft.com/en-us/training/courses/zz-999t00",
    learningPathUids,
    warnings: []
  };
  const appConfig = {
    outputRoot,
    cacheRoot,
    locale: "en-us",
    paperFormat: "A4",
    refreshCourseContent: false
  };

  await assert.rejects(
    convertCourseFromResolution(resolution, {
      appConfig,
      root,
      refresh: false,
      stamp: "2026-06-20"
    }),
    (error) => {
      assert.equal(error.manifest.learningPaths.length, 2);
      assert.deepEqual(
        error.manifest.learningPaths.map((entry) => entry.status),
        ["failed", "failed"]
      );
      assert.match(error.manifest.learningPaths[0].error, /title unavailable/);
      assert.match(error.manifest.learningPaths[1].error, /title unavailable/);
      return true;
    }
  );
});
