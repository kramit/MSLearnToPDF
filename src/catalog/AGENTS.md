# Catalog Agent Guide

## Scope

`src/catalog/service.js` owns the certification-poster catalog.

`src/catalog/parser.js` contains deterministic PDF geometry and parsing logic;
the service retains download, cache, hydration, validation, and fallback policy.

## Responsibilities

- Conditional poster download using `ETag` and `Last-Modified`
- Cached fallback behavior
- PDF text/annotation parsing with `pdfjs-dist`
- Geometric matching of:
  code -> title -> embedded Learn URL
- Malformed URL cleanup
- Duplicate removal by course code
- Targeted title hydration for incomplete poster entries
- Structural validation before replacing the cached catalog

## Matching Rules

- Prefer the link whose annotation overlaps the course-code box.
- If no overlapping link exists, choose the nearest link in the same visual card.
- First try to find title text directly above the course code with the same left edge.
- If a code is the secondary code in a multi-exam card, fall back to nearby left-shifted title text.
- If no poster link is found, infer an exam URL from the course code and emit a warning.

## Validation Rules

- Every entry must end with a code, title, and Learn URL after repair/hydration.
- A new catalog is rejected if it shrinks suspiciously compared with the last valid catalog.
- On parse/download/validation failure, return the previous cached catalog if available.

## Cache Layout

- `cache/poster/Certification-Poster_en-us.pdf`
- `cache/poster/poster-metadata.json`
- `cache/poster/catalog.json`
- `cache/poster/credential-pages/<CODE>.html`

## Safe Edits

- Keep URL normalization strict to `learn.microsoft.com`.
- Treat poster warnings as useful diagnostics, not fatal errors, unless catalog validation would otherwise fail.
- If adding heuristics, preserve deterministic ordering and dedupe rules.
