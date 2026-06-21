const test = require("node:test");
const assert = require("node:assert/strict");
const { renderDocument } = require("../src/template");

function model() {
  return {
    config: {
      courseCode: "AI-901",
      courseTitle: "Introduction to AI",
      locale: "en-us"
    },
    course: {
      title: "Introduction to AI",
      url: "https://learn.microsoft.com/course"
    },
    learningPath: {
      uid: "learn.example",
      title: "Explore AI",
      summary: "A summary",
      canonicalUrl: "https://learn.microsoft.com/path"
    },
    modules: [
      {
        uid: "module.one",
        title: "Module one",
        durationInMinutes: 10,
        objectives: ["Understand the topic"],
        units: [
          {
            uid: "unit.one",
            title: "Unit one",
            durationInMinutes: 5,
            canonicalUrl: "https://learn.microsoft.com/unit",
            html: "<p>Unit body</p>",
            isAssessment: false
          }
        ],
        assessmentQuestions: [],
        answers: null
      }
    ],
    answerNotice: "No answer key.",
    retrievedAt: "2026-06-21T10:00:00.000Z",
    sourceUpdatedAt: "2026-06-20T10:00:00.000Z"
  };
}

test("renderDocument preserves learning-path, module, unit, and source metadata", () => {
  const html = renderDocument(model());

  assert.match(html, /Explore AI/);
  assert.match(html, /Module one/);
  assert.match(html, /Unit one/);
  assert.match(html, /Unit body/);
  assert.match(html, /https:\/\/learn\.microsoft\.com\/path/);
  assert.match(html, /public Microsoft Learn content/i);
});
