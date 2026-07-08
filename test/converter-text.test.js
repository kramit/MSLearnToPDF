const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compactMarkdown,
  normalizeLinksAndImages,
  renderLlmText
} = require("../src/converter/text");

function baseModel(overrides = {}) {
  return {
    config: {
      courseCode: "AI-901",
      courseTitle: "AI course",
      courseUrl: "https://learn.microsoft.com/en-us/training/courses/ai-901",
      locale: "en-us"
    },
    course: {
      title: "AI course",
      url: "https://learn.microsoft.com/en-us/training/courses/ai-901"
    },
    learningPath: {
      uid: "learn.ai.path",
      title: "AI path",
      summary: "Learn AI basics.",
      canonicalUrl: "https://learn.microsoft.com/en-us/training/paths/ai-path/"
    },
    modules: [
      {
        uid: "learn.ai.module",
        title: "Module one",
        summary: "Module summary.",
        durationInMinutes: 30,
        assessmentQuestions: [],
        units: [
          {
            uid: "learn.ai.unit",
            title: "Unit one",
            url: "/training/modules/ai-module/1-intro/",
            canonicalUrl:
              "https://learn.microsoft.com/en-us/training/modules/ai-module/1-intro/",
            durationInMinutes: 5,
            cleanMarkdown:
              "Use [Azure AI](https://learn.microsoft.com/azure/ai)."
          }
        ]
      }
    ],
    answerNotice: "",
    retrievedAt: "2026-07-05T10:00:00.000Z",
    sourceUpdatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides
  };
}

test("renders compact metadata and stable module/unit delimiters", () => {
  const text = renderLlmText(baseModel());

  assert.match(text, /^MSLEARN_TEXT_EXPORT\|schema=1/);
  assert.match(text, /COURSE\|code=AI-901\|title=AI course\|url=https:\/\/learn\.microsoft\.com\/en-us\/training\/courses\/ai-901/);
  assert.match(text, /LEARNING_PATH\|uid=learn\.ai\.path\|title=AI path/);
  assert.match(text, /TOTALS\|modules=1\|units=1\|minutes=30\|assessmentQuestions=0/);
  assert.match(text, /MODULE 1\|uid=learn\.ai\.module\|title=Module one\|minutes=30/);
  assert.match(text, /UNIT 1\.1\|uid=learn\.ai\.unit\|title=Unit one\|url=https:\/\/learn\.microsoft\.com\/en-us\/training\/modules\/ai-module\/1-intro\/\|minutes=5/);
});

test("normalizes links and images for compact LLM ingestion", () => {
  const unit = {
    url: "/training/modules/ai-module/1-intro/"
  };
  const config = { locale: "en-us" };

  assert.equal(
    normalizeLinksAndImages(
      "Read [the docs](/en-us/azure/ai) and see ![Diagram](media/diagram.png).",
      unit,
      config
    ),
    "Read the docs <https://learn.microsoft.com/en-us/azure/ai> and see IMAGE Diagram <https://learn.microsoft.com/en-us/training/modules/ai-module/media/diagram.png>."
  );
  assert.equal(
    normalizeLinksAndImages(
      "[![Screenshot](../../media/example.png)](../../media/example.png#lightbox)",
      unit,
      config
    ),
    "IMAGE Screenshot <https://learn.microsoft.com/en-us/training/media/example.png>"
  );
});

test("compacts whitespace without flattening fenced code blocks", () => {
  assert.equal(
    compactMarkdown("Intro.\n\n\n\n```js\n  const value = 1;  \n```\n\n\nDone."),
    "Intro.\n\n```js\n  const value = 1;\n```\n\nDone."
  );
});

test("renders assessments and reviewed answer keys as text", () => {
  const text = renderLlmText(
    baseModel({
      modules: [
        {
          uid: "learn.ai.module",
          title: "Module one",
          durationInMinutes: 10,
          assessmentQuestions: [
            {
              questionNumber: 1,
              prompt: "Which service should you choose?",
              choices: ["Azure AI Search", "Azure Storage"]
            }
          ],
          answers: {
            answers: [
              {
                questionNumber: 1,
                answer: "Azure AI Search",
                explanation: "It indexes content for retrieval.",
                supportingUnitUid: "learn.ai.assessment"
              }
            ]
          },
          units: [
            {
              uid: "learn.ai.assessment",
              title: "Knowledge check",
              url: "/training/modules/ai-module/knowledge-check/",
              canonicalUrl:
                "https://learn.microsoft.com/en-us/training/modules/ai-module/knowledge-check/",
              durationInMinutes: 2,
              isAssessment: true,
              cleanMarkdown: "Assessment",
              assessmentQuestions: [
                {
                  questionNumber: 1,
                  prompt: "Which service should you choose?",
                  choices: ["Azure AI Search", "Azure Storage"]
                }
              ]
            }
          ]
        }
      ],
      answerNotice: "Reviewed answer key."
    })
  );

  assert.match(text, /Q1: Which service should you choose\?\n- Azure AI Search\n- Azure Storage/);
  assert.match(text, /ANSWER_KEY 1\|moduleUid=learn\.ai\.module/);
  assert.match(text, /ANSWER_NOTICE\|Reviewed answer key\./);
  assert.match(text, /ANSWER 1\|value=Azure AI Search\|supportingUnit=learn\.ai\.assessment/);
});
