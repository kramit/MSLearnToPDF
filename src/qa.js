#!/usr/bin/env node

const { loadAppConfig } = require("./app-config");
const { createConsoleReporter } = require("./progress");
const { runQaSuite } = require("./qa/service");
const { parseCommandArgs } = require("./cli/args");

function parseArgs(argv) {
  return parseCommandArgs(
    argv,
    {
      "--config": { name: "config", kind: "value" },
      "--url": { name: "urls", kind: "array" },
      "--course-code": { name: "courseCode", kind: "value" },
      "--refresh": { name: "refresh", kind: "boolean" },
      "--poster-refresh": { name: "posterRefresh", kind: "boolean" },
      "--all-poster": { name: "allPoster", kind: "boolean" },
      "--help": { name: "help", kind: "boolean" }
    },
    {
      urls: [],
      refresh: false,
      posterRefresh: false,
      allPoster: false
    }
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node src/qa.js --url <microsoft-learn-url> [--url <microsoft-learn-url> ...] [--course-code CODE] [--refresh]
  node src/qa.js --all-poster [--poster-refresh] [--refresh]
  node src/qa.js --config <file> <other options>`);
    return;
  }
  if (!args.allPoster && !args.urls.length) {
    throw new Error("Provide at least one --url or use --all-poster");
  }
  if (args.courseCode && args.urls.length > 1) {
    throw new Error("--course-code can only be used with a single --url");
  }

  const root = process.cwd();
  const appConfig = await loadAppConfig(root, args.config);
  const reporter = createConsoleReporter();
  const result = await runQaSuite({
    appConfig,
    root,
    urls: args.urls,
    allPoster: args.allPoster,
    courseCode: args.courseCode || "",
    refresh: args.refresh,
    posterRefresh: args.posterRefresh,
    onEvent: reporter
  });

  console.log(`QA JSON: ${result.summaryJson}`);
  console.log(`QA Markdown: ${result.summaryMarkdown}`);
  if (result.summary.failedCourses || result.summary.partialCourses) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
