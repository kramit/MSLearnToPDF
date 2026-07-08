const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildOutputConfirmation,
  convertPreparedQueue,
  prepareCustomUrlQueue,
  prepareSelectedQueue
} = require("../src/tui/workflows");

test("buildOutputConfirmation calculates selected and full-clean totals", () => {
  const state = {
    outputManager: {
      selectedIds: ["one"],
      inventory: {
        totalBytes: 30,
        totalFiles: 3,
        items: [
          { id: "one", bytes: 10, fileCount: 1 },
          { id: "two", bytes: 20, fileCount: 2 }
        ]
      }
    }
  };
  assert.equal(buildOutputConfirmation(state, "delete-selected").totalBytes, 10);
  assert.equal(buildOutputConfirmation(state, "clean-all").totalFiles, 3);
});

test("prepareSelectedQueue resolves sequentially and retains per-entry failures", async () => {
  const calls = [];
  const state = {
    selectedCodes: ["AI-901", "AZ-104"],
    config: { refreshCourseContent: false },
    catalog: {
      entries: [
        { code: "AI-901", title: "AI", url: "one" },
        { code: "AZ-104", title: "Azure", url: "two" }
      ]
    }
  };
  const queue = await prepareSelectedQueue(state, {
    resolveCourse: async (url) => {
      calls.push(url);
      if (url === "two") throw new Error("unavailable");
      return { courseCode: "AI-901", learningPathUids: ["learn.one"] };
    }
  });

  assert.deepEqual(calls, ["one", "two"]);
  assert.deepEqual(queue.map((item) => item.status), ["ready", "failed"]);
});

test("prepareCustomUrlQueue resolves one learning path without a course override", async () => {
  const calls = [];
  const state = {
    customUrl: {
      value: "https://learn.microsoft.com/en-us/training/paths/dashboard-in-a-day/"
    },
    config: { refreshCourseContent: false }
  };
  const queue = await prepareCustomUrlQueue(state, {
    resolveCourse: async (url, options) => {
      calls.push({ url, courseCodeOverride: options.courseCodeOverride });
      return {
        courseCode: "DASHBOARD-IN-A-DAY",
        courseTitle: "Dashboard in a Day",
        learningPathUids: ["learn-bizapps.dashboard-in-a-day"]
      };
    }
  });

  assert.deepEqual(calls, [
    {
      url: "https://learn.microsoft.com/en-us/training/paths/dashboard-in-a-day/",
      courseCodeOverride: undefined
    }
  ]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "ready");
  assert.equal(queue[0].source, "custom-url");
  assert.equal(queue[0].posterInfo, null);
});

test("prepareCustomUrlQueue keeps failed custom resolution visible", async () => {
  const state = {
    customUrl: {
      value: "https://learn.microsoft.com/en-us/training/paths/dashboard-in-a-day/"
    },
    config: { refreshCourseContent: false }
  };
  const queue = await prepareCustomUrlQueue(state, {
    resolveCourse: async () => {
      throw new Error("unavailable");
    }
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "failed");
  assert.equal(queue[0].source, "custom-url");
  assert.match(queue[0].error, /unavailable/);
});

test("convertPreparedQueue preserves initial failures and stops after cancellation", async () => {
  const state = {
    config: {
      refreshCourseContent: false,
      posterUrl: "poster"
    },
    catalog: { poster: null },
    queue: [
      { code: "BAD", status: "failed", error: "resolve failed" },
      {
        url: "one",
        status: "ready",
        resolution: { courseCode: "AI-901" }
      },
      {
        url: "two",
        status: "ready",
        resolution: { courseCode: "AZ-104" }
      }
    ]
  };
  let calls = 0;
  const results = await convertPreparedQueue(state, {
    root: "root",
    convertCourse: async () => {
      calls += 1;
      const error = new Error("stop");
      error.name = "AbortError";
      throw error;
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(results.map((result) => result.courseCode), ["BAD", "AI-901"]);
  assert.equal(results[1].error, "Cancelled by user");
});
