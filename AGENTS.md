# MSLearnToPDF Agent Guide

## Purpose

This repository turns public Microsoft Learn content into print-oriented PDFs.
It now has two user-facing flows:

- `src/cli.js` for scripted URL/config exports.
- `src/tui.js` for the interactive certification-poster browser and download queue.

## Entry Points

- `node src/tui.js [--config config/app.json]`
- `node src/cli.js --url <learn-url> [--course-code CODE] [--refresh]`
- `node src/qa.js --url <learn-url> [--url <learn-url> ...] [--course-code CODE] [--refresh]`
- `node src/qa.js --all-poster [--poster-refresh] [--refresh]`
- `node src/cli.js --config <legacy-config.json> [--refresh]`
- `run.ps1`
- `run.sh`

## Architecture

- `src/app-config.js`
  Loads `config/app.json`, applies defaults, resolves relative paths from the config file, and validates the app-level settings.

- `src/catalog/service.js`
  Downloads and parses the official certification poster, extracts poster entries, caches metadata, hydrates incomplete titles, and falls back to the last valid catalog when needed.

- `src/converter/service.js`
  Public conversion facade and orchestration pipeline. Focused helpers under
  `src/converter/` own content assembly, reports, output paths, PDF rendering,
  and reflection validation.

- `src/qa/service.js`
  Higher-level QA orchestration. Comparison, diagnostics, totals, and Markdown
  reporting live in focused modules under `src/qa/`.

- `src/tui.js`
  Ink/React terminal UI for catalog browsing, queue preparation, progress monitoring, and summary reporting.

- `src/tui/state.js`
  Reducer-backed state machine used by the TUI.

- `src/tui/format.js` and `src/tui/workflows.js`
  Pure event formatting and dependency-injected queue/output workflows used by
  the interactive app.

- `src/content.js`, `src/network.js`, and `src/files.js`
  Focused content parsing, HTTP/cache, and filesystem/JSON helpers. `src/lib.js`
  remains a compatibility facade for existing imports.

- `src/template.js`
  Print HTML template and CSS. Option D module styling lives here.

- `src/resolver.js`
  Microsoft Learn URL classification and course/learning-path discovery.

## Data Flow

1. Load app config.
2. Refresh or reuse the certification poster catalog.
3. Let the user select one or more course codes.
4. Resolve each selected poster link into a course plus ordered learning paths.
5. Convert each learning path into HTML, PDF, and reports.
6. Validate PDF content and enforce reflection checks between:
   poster selection -> resolved UID/title -> PDF filename -> report -> manifest.
7. Optionally run `src/qa/service.js` to audit each exported learning path back against the expected module/unit hierarchy and roll the results into a course-level QA report.

## Invariants

- Course exports are one PDF per learning path.
- Output folders are dated per course:
  `outputRoot/pdf/<COURSE>-YYYY-MM-DD/`
  `outputRoot/html/<COURSE>-YYYY-MM-DD/`
  `outputRoot/reports/<COURSE>-YYYY-MM-DD/`
- Cache data never lives inside the output tree.
- External labs, videos, repositories, and docs remain links and are never crawled.
- The converter may continue after a single course or learning-path failure, but manifests must record the failure.
- Reflection validation must fail if the expected learning-path UID or title drifts.
- QA summaries under `outputRoot/reports/qa/<RUN-ID>/` are the machine-readable audit artifact for unattended Codex or LLM review.

## Testing

- `npm test`
- `node src/cli.js --help`
- `node src/qa.js --help`
- `node src/tui.js --help`

Live smoke checks that are safe to run:

- Poster parse and catalog load through `src/catalog/service.js`
- URL resolution for AI-901 and AZ-104 through `src/converter/service.js`

## Troubleshooting

- If the TUI says raw input is unsupported, launch it from a real interactive terminal instead of a non-interactive command runner.
- If poster parsing regresses, inspect `cache/poster/catalog.json` and the warnings array first.
- If a learning path produces the wrong title, check the report JSON and course manifest for reflection failures before changing template code.
- If a credential resolves to the wrong course, confirm the course-code override path from the poster entry through `resolveCourseFromUrl`.
