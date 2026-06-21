# Microsoft Learn to PDF

This project extracts public Microsoft Learn course content and produces
print-oriented study-book PDFs. It supports both a URL-driven CLI and a
colorful terminal UI that reads the official Microsoft certification poster and
lets you queue one or more courses for export.

## Launch the TUI

```powershell
.\run.ps1
```

```sh
./run.sh
```

Optional alternate app config:

```powershell
.\run.ps1 -Config .\config\app.json
```

The TUI:

- refreshes the official certification poster with cached fallback
- shows every recognized course code from the poster
- supports search, multi-select, and queue review
- can launch a full poster-wide QA sweep with `Q`
- displays live conversion progress and verbose logs
- writes outputs under the configured output root

Default app config lives in `config/app.json`.

## Convert a Microsoft Learn URL

```powershell
npm install
npm run convert -- --url "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
```

Force a fresh Microsoft Learn snapshot:

```powershell
npm run convert -- --url "https://learn.microsoft.com/..." --refresh
```

If a direct learning-path URL does not identify its course unambiguously:

```powershell
npm run convert -- --url "https://learn.microsoft.com/en-us/training/paths/..." --course-code "AI-901"
```

The converter creates dated folders such as:

- `output/pdf/AI-901-2026-06-20/`
- `output/html/AI-901-2026-06-20/`
- `output/reports/AI-901-2026-06-20/`

Each PDF is named:

- `AI-901 - <Learning Path title> - 2026-06-20.pdf`

The report folder includes a course manifest with source resolution details,
learning-path order, counts, warnings, failures, filenames, and validation
results. Before a PDF is accepted, a reflection check confirms that its
learning-path UID, displayed title, report title, and filename all match the
course's expected learning path. A failed learning path does not prevent later
paths from being attempted, and a failed course in the TUI does not stop the
rest of the queue.

Source Markdown and images are cached under `cache/`. External labs, videos,
repositories, and documentation are retained as links but are not crawled.
Assessment questions are included; answer-key sections appear only when a
reviewed answer file is configured.

## Run a QA conversion audit

For one or more explicit URLs:

```powershell
npm run qa -- --url "https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-901/"
```

For a larger unattended sweep driven from the certification poster catalog:

```powershell
npm run qa -- --all-poster --poster-refresh --refresh
```

The QA runner:

- resolves each course URL
- runs the normal download and PDF conversion pipeline
- re-checks every exported learning path against Microsoft Learn hierarchy data
- validates the generated PDFs for required text, source order, and blank pages
- writes a consolidated QA report

QA outputs are written to:

- `output/reports/qa/<RUN-ID>/qa-summary.json`
- `output/reports/qa/<RUN-ID>/qa-summary.md`

Each course entry in the QA report includes:

- resolved learning-path count
- passed and failed learning paths
- exported module and unit totals
- assessment-question totals
- embedded and missing image counts
- external-resource counts
- per-learning-path PDF and report paths
- detailed issues for missing modules, missing units, title drift, reflection failures, and PDF validation failures

The QA command exits with a nonzero code if any course is partial or failed, so
Codex or another LLM can use it as a reliable gate in an automated review flow.

## Repeatable SC-500 configuration builds

The existing configuration workflow remains available:

```powershell
npm run build
npm run build:refresh
npm run build:path
```

The underlying CLI accepts `--config <path>` with optional `--refresh`.

## PDF validation

URL exports are validated automatically for module/unit presence, source order,
blank pages, and expected answer-key content. To render a PDF for visual review:

```powershell
node src/render-pdf.js "<pdf-path>" "<output-directory>"
```

This is a study aid and dated snapshot of Microsoft Learn content, not an
automatically current replacement for the source course.
