const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalInputUrl,
  inferCourseCode,
  isLearningPathUid,
  pageMetadata,
  resolveInputUrl
} = require("../src/resolver");

const coursePages = {
  "https://learn.microsoft.com/en-us/training/courses/ai-901t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.ai-901t00">
    <meta property="og:title" content="Course AI-901T00-A: Introduction to AI in Azure - Training | Microsoft Learn">
    <meta name="learn_item" content="learn.ai-technical-concepts">
    <meta name="learn_item" content="learn.wwl.get-started-ai-apps-agents">`,
  "https://learn.microsoft.com/en-us/training/courses/az-104t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.az-104t00">
    <meta property="og:title" content="Course AZ-104T00-A: Microsoft Azure Administrator - Training | Microsoft Learn">
    <meta name="learn_item" content="learn.az104-admin-prerequisites">
    <meta name="learn_item" content="learn.az-104-manage-identities-governance">`,
  "https://learn.microsoft.com/en-us/training/courses/ab-730t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.ab-730t00">
    <meta property="og:title" content="Course AB-730T00-A: Transform business workflows with generative AI - Training | Microsoft Learn">
    <meta name="learn_item" content="learn-m365.wwl.transform-business-workflows-with-ai">`,
  "https://learn.microsoft.com/en-us/training/courses/ab-620t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.ab-620t00">
    <meta property="og:title" content="Course AB-620T00-A: Design and build integrated AI agent solutions in Copilot Studio - Training | Microsoft Learn">
    <meta name="learn_item" content="learn.wwl.design-agent-conversations-responses-topics-copilot-studio">
    <meta name="learn_item" content="learn.wwl.design-build-multi-agent-solutions-copilot-studio">
    <meta name="learn_item" content="learn.wwl.integrate-agents-enterprise-systems-copilot-studio">`,
  "https://learn.microsoft.com/en-us/training/courses/mb-335t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.mb-335t00">
    <meta property="og:title" content="Course MB-335T00-A: Supply Chain Management Functional Consultant - Training | Microsoft Learn">
    <meta name="learn_item" content="learn.dynamics.configure-products">
    <meta name="learn_item" content="learn.dynamics.configure-warehouse">`,
  "https://learn.microsoft.com/en-us/training/courses/sc-300t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.sc-300t00">
    <meta property="og:title" content="Course SC-300T00-A: Microsoft Identity and Access Administrator - Training | Microsoft Learn">
    <meta name="learn_item" content="learn.wwl.explore-identity-azure-active-directory">
    <meta name="learn_item" content="learn.wwl.implement-identity-management-solution">
    <meta name="learn_item" content="learn.wwl.implement-authentication-access-management-solution">`,
  "https://learn.microsoft.com/en-us/training/courses/pl-200t00": `
    <meta name="schema" content="Course">
    <meta name="uid" content="course.pl-200t00">
    <meta property="og:title" content="Course PL-200T00-A: Microsoft Power Platform Functional Consultant - Training | Microsoft Learn">
    <meta name="learn_item" content="learn-bizapps.get-started-dataverse">
    <meta name="learn_item" content="learn-bizapps.extend-power-pages">`
};

const inputPages = {
  "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/": `
    <meta name="schema" content="Examination">
    <meta name="uid" content="exam.ai-901">
    <meta name="learn_item" content="learn.ai-technical-concepts">
    <meta name="learn_item" content="learn.wwl.get-started-ai-apps-agents">
    <a href="/en-us/training/courses/ai-901t00">Course</a>`,
  "https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/": `
    <meta name="schema" content="Certification">
    <meta name="uid" content="certification.azure-administrator">
    <article data-learn-uid="course.az-104t00"></article>`,
  "https://learn.microsoft.com/en-us/training/paths/ai-concepts/": `
    <meta name="schema" content="LearningPath">
    <meta name="uid" content="learn.ai-technical-concepts">`,
  "https://learn.microsoft.com/en-us/training/paths/transform-business-workflows-with-ai/": `
    <meta name="schema" content="LearningPath">
    <meta name="uid" content="learn-m365.wwl.transform-business-workflows-with-ai">`,
  "https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-apps-and-agents-developer-associate/": `
    <meta name="schema" content="Certification">
    <meta name="uid" content="certification.azure-ai-apps-and-agents-developer-associate">
    <article data-learn-uid="course.ai-103t00"></article>`,
  "https://learn.microsoft.com/en-us/credentials/certifications/d365-supply-chain-management-functional-consultant-expert/": `
    <meta name="schema" content="Certification">
    <meta name="uid" content="certification.d365-supply-chain-management-functional-consultant-expert">`,
  "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/": `
    <meta name="schema" content="Certification">
    <meta name="uid" content="certification.identity-and-access-administrator">
    <article data-learn-uid="course.sc-300t00"></article>`,
  "https://learn.microsoft.com/en-us/credentials/certifications/exams/pl-200/": `
    <meta name="schema" content="Examination">
    <meta name="uid" content="exam.pl-200">
    <meta name="learn_item" content="learn-dynamics.create-manage-environments">
    <a href="/en-us/training/courses/pl-200t00">Course</a>`,
  "https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-engineer/": `
    <meta name="schema" content="Certification">
    <meta name="uid" content="certification.azure-ai-engineer">
    No training available for this exam.`
};

function hierarchy(uid, title = uid) {
  return {
    modules: [
      {
        parents: [
          {
            uid: "learn.unrelated",
            type: "learningPath",
            title: "MD-102 Explore endpoint management"
          },
          { uid, type: "learningPath", title }
        ]
      }
    ]
  };
}

async function fixtureResolver(url, options = {}) {
  return resolveInputUrl(url, {
    courseCodeOverride: options.courseCodeOverride || "",
    locale: "en-us",
    fetchHtml: async (requested) => {
      const html = inputPages[requested] || coursePages[requested];
      if (!html) throw new Error(`Missing fixture: ${requested}`);
      return html;
    },
    fetchHierarchy: async (uid) => {
      if (
        uid === "learn.wwl.explore-identity-azure-active-directory" ||
        uid === "learn-dynamics.create-manage-environments"
      ) {
        throw new Error(`HTTP 404 fetching https://learn.microsoft.com/api/hierarchy/paths/${uid}`);
      }
      return hierarchy(
        uid,
        uid === "learn.az-104-manage-identities-governance"
          ? "AZ-104: Manage identities and governance in Azure"
          : uid
      );
    }
  });
}

test("canonical input URL ignores query strings and fragments", () => {
  assert.equal(
    canonicalInputUrl(
      "https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/?practice-assessment-type=certification#prepare"
    ),
    "https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/"
  );
});

test("infers normalized course codes", () => {
  assert.equal(inferCourseCode("course.ai-901t00"), "AI-901");
  assert.equal(inferCourseCode("az-104t00"), "AZ-104");
});

test("recognizes both legacy and hyphenated learning-path UIDs", () => {
  assert.equal(isLearningPathUid("learn.ai-technical-concepts"), true);
  assert.equal(
    isLearningPathUid("learn-m365.wwl.transform-business-workflows-with-ai"),
    true
  );
  assert.equal(isLearningPathUid("course.ab-730t00"), false);
});

test("extracts page metadata and references", () => {
  const page = pageMetadata(
    inputPages[
      "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
    ],
    "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
  );
  assert.equal(page.schema, "Examination");
  assert.equal(page.learningPathUids.length, 2);
  assert.equal(page.courseLinks[0].slug, "ai-901t00");
});

test("extracts metadata when attributes use a different order", () => {
  const page = pageMetadata(
    `<meta content="Course" name="schema">
     <meta content="course.az-104t00" name="uid">
     <meta content="learn.az104-admin-prerequisites" name="learn_item">
     <meta content="learn-m365.wwl.transform-business-workflows-with-ai" name="learn_item">
     <meta content="Reordered title" property="og:title">`,
    "https://learn.microsoft.com/en-us/example/"
  );
  assert.equal(page.schema, "Course");
  assert.equal(page.uid, "course.az-104t00");
  assert.equal(page.title, "Reordered title");
  assert.deepEqual(page.learningPathUids, [
    "learn.az104-admin-prerequisites",
    "learn-m365.wwl.transform-business-workflows-with-ai"
  ]);
});

test("AI-901 exam resolves course ordering and deduplicates direct paths", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
  );
  assert.equal(result.courseCode, "AI-901");
  assert.equal(
    result.courseUrl,
    "https://learn.microsoft.com/en-us/training/courses/ai-901t00"
  );
  assert.deepEqual(result.learningPathUids, [
    "learn.ai-technical-concepts",
    "learn.wwl.get-started-ai-apps-agents"
  ]);
});

test("Azure Administrator certification resolves through course UID", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/?practice-assessment-type=certification"
  );
  assert.equal(result.courseCode, "AZ-104");
  assert.equal(result.courseTitle, "Microsoft Azure Administrator");
  assert.deepEqual(result.learningPathUids, [
    "learn.az104-admin-prerequisites",
    "learn.az-104-manage-identities-governance"
  ]);
  assert.equal(result.warnings.length, 0);
});

test("AB-730 course resolves a hyphenated learning-path UID", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/training/courses/ab-730t00"
  );
  assert.equal(result.courseCode, "AB-730");
  assert.deepEqual(result.learningPathUids, [
    "learn-m365.wwl.transform-business-workflows-with-ai"
  ]);
});

test("direct learning path requires an explicit course code when none is present", async () => {
  await assert.rejects(
    fixtureResolver(
      "https://learn.microsoft.com/en-us/training/paths/ai-concepts/"
    ),
    /Supply --course-code/
  );
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/training/paths/ai-concepts/",
    { courseCodeOverride: "AI-901" }
  );
  assert.equal(result.courseCode, "AI-901");
  assert.deepEqual(result.learningPathUids, ["learn.ai-technical-concepts"]);
});

test("direct hyphenated learning path keeps the Learn UID", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/training/paths/transform-business-workflows-with-ai/",
    { courseCodeOverride: "AB-730" }
  );
  assert.equal(result.courseCode, "AB-730");
  assert.deepEqual(result.learningPathUids, [
    "learn-m365.wwl.transform-business-workflows-with-ai"
  ]);
});

test("course-code override can replace a stale referenced course with a verified current course", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-apps-and-agents-developer-associate/",
    { courseCodeOverride: "AB-620" }
  );
  assert.equal(result.courseCode, "AB-620");
  assert.equal(
    result.courseUrl,
    "https://learn.microsoft.com/en-us/training/courses/ab-620t00"
  );
  assert.deepEqual(result.learningPathUids, [
    "learn.wwl.design-agent-conversations-responses-topics-copilot-studio",
    "learn.wwl.design-build-multi-agent-solutions-copilot-studio",
    "learn.wwl.integrate-agents-enterprise-systems-copilot-studio"
  ]);
});

test("course-code override can discover a course when the certification page omits course references", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/d365-supply-chain-management-functional-consultant-expert/",
    { courseCodeOverride: "MB-335" }
  );
  assert.equal(result.courseCode, "MB-335");
  assert.equal(
    result.courseUrl,
    "https://learn.microsoft.com/en-us/training/courses/mb-335t00"
  );
  assert.deepEqual(result.learningPathUids, [
    "learn.dynamics.configure-products",
    "learn.dynamics.configure-warehouse"
  ]);
});

test("course learning paths take precedence over stale exam-page path IDs", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/exams/pl-200/",
    { courseCodeOverride: "PL-200" }
  );
  assert.deepEqual(result.learningPathUids, [
    "learn-bizapps.get-started-dataverse",
    "learn-bizapps.extend-power-pages"
  ]);
  assert.equal(
    result.warnings.some((warning) =>
      /Skipping unavailable learning path/.test(warning)
    ),
    false
  );
});

test("stale course-page learning paths are skipped with warnings when others remain", async () => {
  const result = await fixtureResolver(
    "https://learn.microsoft.com/en-us/credentials/certifications/identity-and-access-administrator/",
    { courseCodeOverride: "SC-300" }
  );
  assert.deepEqual(result.learningPathUids, [
    "learn.wwl.implement-identity-management-solution",
    "learn.wwl.implement-authentication-access-management-solution"
  ]);
  assert.equal(
    result.warnings.some((warning) =>
      warning.includes("learn.wwl.explore-identity-azure-active-directory")
    ),
    true
  );
});

test("certifications with no public training get a clearer error", async () => {
  await assert.rejects(
    fixtureResolver(
      "https://learn.microsoft.com/en-us/credentials/certifications/azure-ai-engineer/",
      { courseCodeOverride: "AI-102" }
    ),
    /no training is available/i
  );
});

test("unsupported pages fail with discovered metadata", async () => {
  await assert.rejects(
    resolveInputUrl("https://learn.microsoft.com/en-us/example/", {
      fetchHtml: async () =>
        `<meta name="schema" content="Conceptual"><meta name="uid" content="example.page">`,
      fetchHierarchy: async () => ({}),
      locale: "en-us"
    }),
    /schema="Conceptual".*uid="example.page"/
  );
});

test("conflicting course references require an override", async () => {
  await assert.rejects(
    resolveInputUrl("https://learn.microsoft.com/en-us/conflict/", {
      fetchHtml: async () =>
        `<meta name="schema" content="Certification">
         <article data-learn-uid="course.az-104t00"></article>
         <article data-learn-uid="course.ai-901t00"></article>`,
      fetchHierarchy: async () => ({}),
      locale: "en-us"
    }),
    /multiple training courses/
  );
});

test("explicit course-code overrides reject mismatched resolved courses", async () => {
  await assert.rejects(
    resolveInputUrl(
      "https://learn.microsoft.com/en-us/credentials/certifications/exams/pl-600/",
      {
        courseCodeOverride: "AB-100",
        locale: "en-us",
        fetchHtml: async (requested) => {
          if (
            requested ===
            "https://learn.microsoft.com/en-us/credentials/certifications/exams/pl-600/"
          ) {
            return `
              <meta name="schema" content="Examination">
              <meta name="uid" content="exam.pl-600">
              <meta name="learn_item" content="learn.wwl.validate-power-platform-solution-architect-skills">
              <a href="/en-us/training/courses/pl-600t00">Course</a>`;
          }
          if (
            requested ===
            "https://learn.microsoft.com/en-us/training/courses/pl-600t00"
          ) {
            return `
              <meta name="schema" content="Course">
              <meta name="uid" content="course.pl-600t00">
              <meta property="og:title" content="Course PL-600T00: Microsoft Power Platform Solution Architect - Training | Microsoft Learn">
              <meta name="learn_item" content="learn.wwl.validate-power-platform-solution-architect-skills">`;
          }
          throw new Error(`Missing fixture: ${requested}`);
        },
        fetchHierarchy: async (uid) => hierarchy(uid, "PL-600: Validate solution architect skills")
      }
    ),
    /does not match the requested course code AB-100/
  );
});
