# Converter Agent Guide

## Scope

`src/converter/service.js` is the shared conversion pipeline used by both the CLI and the TUI.

Focused implementation modules:

- `content.js` prepares units, images, assessments, and reviewed answers.
- `report.js` builds report text and extracts source metadata.
- `output.js` owns dated output paths and safe recreation.
- `pdf.js` owns Playwright rendering.
- `reflection.js` enforces UID/title/filename alignment.

## Main Exports

- `resolveCourseFromUrl`
- `convertLearningPath`
- `convertCourseFromResolution`
- `convertQueue`

`src/qa/service.js` builds on these exports and assumes their output contracts stay stable.

## Progress Contract

Progress events are plain objects with these common fields:

- `timestamp`
- `severity`
- `stage`
- `message`

Optional scope fields:

- `courseCode`
- `learningPathUid`
- `learningPathTitle`
- `moduleUid`
- `moduleTitle`
- `moduleIndex`
- `moduleCount`
- `unitUid`
- `unitTitle`
- `unitIndex`
- `unitCount`

The TUI log and the CLI reporter both depend on this shape. Add fields if useful, but do not remove or rename the common ones.

## Output Rules

- The converter writes HTML, PDF, JSON report, Markdown report, and course manifest files.
- `convertCourseFromResolution` recreates only the selected course/date folders.
- `convertLearningPath` keeps cached Markdown and images outside the output tree.
- The optional `stamp` parameter on `convertCourseFromResolution` lets higher-level QA runs keep a stable date folder while still using the same export pipeline.

## Reflection Validation

These values must align:

- Expected learning-path UID
- Expected learning-path title
- PDF filename base
- Report `learningPath.uid`
- Report `learningPath.title`

If any one of them drifts, fail the learning path and record the error in the manifest.

The QA layer adds a second pass that compares the exported report structure back to the expected hierarchy module/unit order.

## Cancellation

- Use `AbortSignal` for network fetches and explicit checkpoints between stages.
- Safe file writes should complete before the thrown abort reaches the caller.
- The TUI treats abort as a graceful user cancellation, not a crash.

## External Resource Boundary

- Unit images are downloaded and embedded.
- External labs, videos, repositories, and docs remain outbound links only.
- Missing images become warnings and do not abort the path.
