const { escapeHtml } = require("./lib");

function formatDate(value) {
  if (!value) return "Not supplied";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(date);
}

function renderModuleContents(module, moduleIndex) {
  return module.units
    .map(
      (unit, unitIndex) => `
        <li>
          <a href="#module-${moduleIndex + 1}-unit-${unitIndex + 1}">
            <span class="toc-number">${moduleIndex + 1}.${unitIndex + 1}</span>
            <span>${escapeHtml(unit.title)}</span>
            <span class="toc-duration">${unit.durationInMinutes || "?"} min</span>
          </a>
        </li>`
    )
    .join("");
}

function renderUnit(unit, moduleIndex, unitIndex, unitCount) {
  return `
    <section class="unit ${unit.isAssessment ? "assessment-unit" : ""}" id="module-${moduleIndex + 1}-unit-${unitIndex + 1}">
      <div class="unit-header">
        <div class="unit-kicker">Module ${moduleIndex + 1} - Unit ${unitIndex + 1} of ${unitCount}</div>
        <h1>${escapeHtml(unit.title)}</h1>
        <div class="unit-meta">
          <span>${unit.durationInMinutes || "Unknown"} minutes</span>
          <a href="${escapeHtml(unit.canonicalUrl)}">View current Microsoft Learn unit</a>
        </div>
      </div>
      <div class="unit-content">${unit.html}</div>
    </section>`;
}

function renderAnswerKey(module, moduleIndex, notice) {
  if (!module.answers?.answers?.length) return "";
  const answerRows = module.answers.answers
    .map((answer) => {
      const supporting = module.units.find(
        (unit) => unit.uid === answer.supportingUnitUid
      );
      return `
        <article class="answer">
          <div class="answer-number">${answer.questionNumber}</div>
          <div>
            <h2>${escapeHtml(answer.answer)}</h2>
            <p>${escapeHtml(answer.explanation)}</p>
            <p class="supporting-source">
              Supporting unit: ${escapeHtml(supporting?.title || answer.supportingUnitUid)}
            </p>
          </div>
        </article>`;
    })
    .join("");

  return `
    <section class="answer-key" id="module-${moduleIndex + 1}-answer-key">
      <p class="eyebrow">MODULE ${moduleIndex + 1} SELF-CHECK</p>
      <h1>Assessment answer key</h1>
      <div class="answer-notice">
        <strong>Authorship note</strong>
        <p>${escapeHtml(notice)}</p>
      </div>
      ${answerRows}
    </section>`;
}

function renderModule(module, moduleIndex, notice) {
  const objectives = module.objectives?.length
    ? `<h2>Learning objectives</h2><ul>${module.objectives
        .map((objective) => `<li>${escapeHtml(objective)}</li>`)
        .join("")}</ul>`
    : "";
  const units = module.units
    .map((unit, unitIndex) =>
      renderUnit(unit, moduleIndex, unitIndex, module.units.length)
    )
    .join("\n");

  return `
    <section class="module-overview" id="module-${moduleIndex + 1}">
      <div class="module-highlight">
        <div class="module-highlight-header">
          <p class="eyebrow">MODULE ${moduleIndex + 1} OF ${module.totalModules}</p>
          <h1>${escapeHtml(module.title)}</h1>
          <p class="lead">${escapeHtml(module.summary || "")}</p>
        </div>
        <div class="module-highlight-details">
          <dl class="module-stats">
            <div><dt>Units</dt><dd>${module.units.length}</dd></div>
            <div><dt>Estimated time</dt><dd>${module.durationInMinutes} minutes</dd></div>
            <div><dt>Assessment</dt><dd>${module.assessmentQuestions.length} questions</dd></div>
          </dl>
          <div class="module-objectives">
            ${objectives}
          </div>
        </div>
      </div>
      <div class="module-contents">
        <h2>Module contents</h2>
        <ol class="toc compact">${renderModuleContents(module, moduleIndex)}</ol>
      </div>
    </section>
    ${units}
    ${renderAnswerKey(module, moduleIndex, notice)}`;
}

function renderDocument(model) {
  const {
    config,
    course,
    learningPath,
    modules,
    answerNotice,
    retrievedAt,
    sourceUpdatedAt
  } = model;
  const totalUnits = modules.reduce((sum, module) => sum + module.units.length, 0);
  const totalMinutes = modules.reduce(
    (sum, module) => sum + (module.durationInMinutes || 0),
    0
  );
  const totalQuestions = modules.reduce(
    (sum, module) => sum + module.assessmentQuestions.length,
    0
  );
  const pathContents = modules
    .map(
      (module, moduleIndex) => `
        <li class="path-module">
          <a class="path-module-link" href="#module-${moduleIndex + 1}">
            <span class="module-number">${moduleIndex + 1}</span>
            <span>
              <strong>${escapeHtml(module.title)}</strong>
              <small>${module.units.length} units - ${module.durationInMinutes} minutes</small>
            </span>
          </a>
          <ol class="toc compact">${renderModuleContents(module, moduleIndex)}</ol>
        </li>`
    )
    .join("");
  const moduleSections = modules
    .map((module, index) => renderModule(module, index, answerNotice))
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(config.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(learningPath.title)} - ${escapeHtml(config.courseCode)}</title>
  <style>${styles}</style>
</head>
<body>
  <main>
    <section class="cover">
      <div class="cover-band"></div>
      <p class="eyebrow">${escapeHtml(config.courseCode)} STUDY GUIDE</p>
      <h1>${escapeHtml(learningPath.title)}</h1>
      <p class="cover-path">${escapeHtml(course.title || config.courseTitle)}</p>
      <div class="cover-rule"></div>
      <p class="cover-summary">${escapeHtml(learningPath.summary || "")}</p>
      <dl class="cover-details">
        <div><dt>Modules</dt><dd>${modules.length}</dd></div>
        <div><dt>Units</dt><dd>${totalUnits}</dd></div>
        <div><dt>Estimated time</dt><dd>${totalMinutes} minutes</dd></div>
        <div><dt>Assessment questions</dt><dd>${totalQuestions}</dd></div>
        <div><dt>Source updated</dt><dd>${escapeHtml(formatDate(sourceUpdatedAt))}</dd></div>
        <div><dt>Snapshot retrieved</dt><dd>${escapeHtml(formatDate(retrievedAt))}</dd></div>
      </dl>
      <p class="cover-note">A print-oriented study snapshot generated from public Microsoft Learn content.</p>
    </section>

    <section class="front-matter">
      <p class="eyebrow">LEARNING PATH OVERVIEW</p>
      <h1>${escapeHtml(learningPath.title)}</h1>
      <p class="lead">${escapeHtml(learningPath.summary || "")}</p>
      <aside class="snapshot-notice">
        <strong>About this edition</strong>
        <p>This PDF preserves the learning-path structure and content available on Microsoft Learn when the snapshot was retrieved. External labs, videos, repositories, and documentation are linked but not copied or followed.</p>
      </aside>
      <h2>Contents</h2>
      <ol class="path-toc">${pathContents}</ol>
    </section>

    ${moduleSections}

    <section class="attribution">
      <h1>Source and attribution</h1>
      <p>This study aid is derived from the public Microsoft Learn course <a href="${escapeHtml(config.courseUrl)}">${escapeHtml(course.title || config.courseTitle)}</a> and the learning path <a href="${escapeHtml(learningPath.canonicalUrl)}">${escapeHtml(learningPath.title)}</a>.</p>
      <p>Microsoft Learn content, product names, and trademarks remain the property of Microsoft and their respective owners. This generated snapshot may become outdated; use the links in each unit to check the current source.</p>
      <p>Generated ${escapeHtml(formatDate(retrievedAt))}.</p>
    </section>
  </main>
</body>
</html>`;
}

const styles = `
  :root {
    --ink: #172033;
    --muted: #56657a;
    --blue: #115ea3;
    --blue-dark: #0f3f68;
    --cyan: #dff4ff;
    --paper: #ffffff;
    --line: #d7e0ea;
    --soft: #f4f7fa;
  }
  * { box-sizing: border-box; }
  html { color: var(--ink); background: var(--paper); }
  body {
    margin: 0;
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 10.1pt;
    line-height: 1.46;
  }
  main { width: 100%; }
  a { color: var(--blue); text-decoration: none; }
  p { margin: 0 0 0.72em; }
  ul, ol { padding-left: 1.45em; margin: 0.45em 0 0.9em; }
  li { margin: 0.22em 0; }
  h1, h2, h3, h4 { color: var(--blue-dark); line-height: 1.18; break-after: avoid; }
  h1 { font-size: 23pt; margin: 0 0 0.55em; letter-spacing: -0.02em; }
  h2 { font-size: 15.5pt; margin: 1.35em 0 0.45em; }
  h3 { font-size: 12.2pt; margin: 1.15em 0 0.35em; }
  h4 { font-size: 10.6pt; margin: 1em 0 0.3em; }
  .eyebrow {
    color: var(--blue);
    font-size: 8.2pt;
    font-weight: 700;
    letter-spacing: 0.16em;
    margin-bottom: 1.2em;
  }
  .cover, .front-matter, .module-overview, .attribution { break-before: page; }
  .cover {
    break-before: auto;
    min-height: 245mm;
    padding: 25mm 16mm 18mm;
    position: relative;
    overflow: hidden;
  }
  .cover-band {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 10mm;
    background: linear-gradient(90deg, #0f6cbd, #3aa0d8 60%, #6bb6e2);
  }
  .cover h1 { max-width: 155mm; font-size: 34pt; margin-top: 19mm; }
  .cover-path { color: var(--muted); font-size: 15pt; max-width: 150mm; }
  .cover-rule { width: 28mm; height: 1.6mm; background: var(--blue); margin: 12mm 0 7mm; }
  .cover-summary { font-size: 12pt; max-width: 150mm; }
  .cover-details {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4mm 12mm;
    margin: 12mm 0 0;
    max-width: 150mm;
  }
  .cover-details div, .module-stats div { border-top: 1px solid var(--line); padding-top: 2.5mm; }
  .cover-details dt, .module-stats dt { color: var(--muted); font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; }
  .cover-details dd, .module-stats dd { margin: 1mm 0 0; font-weight: 600; }
  .cover-note { position: absolute; bottom: 12mm; left: 16mm; color: var(--muted); font-size: 8.5pt; }
  .front-matter, .module-overview, .attribution { padding: 5mm 0 0; }
  .lead { font-size: 12pt; color: #34445a; }
  .module-highlight {
    border: 1px solid #d6dce2;
    border-radius: 8px;
    overflow: hidden;
    break-inside: avoid;
  }
  .module-highlight-header {
    background: #eceff2;
    padding: 8mm 9mm 6mm;
  }
  .module-highlight-header h1 { margin-bottom: 4mm; }
  .module-highlight-header .lead { margin-bottom: 0; }
  .module-highlight-details {
    background: #f8f9fa;
    padding: 5mm 9mm 7mm;
  }
  .module-objectives h2 {
    color: var(--blue-dark);
    margin-top: 5mm;
  }
  .module-objectives ul { margin-bottom: 0; }
  .module-contents {
    break-inside: avoid;
    margin-top: 7mm;
  }
  .module-contents h2 { margin-top: 0; }
  .snapshot-notice, .answer-notice {
    background: var(--cyan);
    border-left: 4px solid var(--blue);
    padding: 4mm 5mm;
    margin: 7mm 0;
    break-inside: avoid;
  }
  .snapshot-notice p, .answer-notice p { margin: 1.5mm 0 0; }
  .path-toc { list-style: none; padding: 0; }
  .path-module { margin: 0 0 6mm; break-inside: avoid; }
  .path-module-link {
    display: grid;
    grid-template-columns: 11mm 1fr;
    gap: 4mm;
    align-items: start;
    color: var(--ink);
    padding-bottom: 2mm;
  }
  .path-module-link small { display: block; color: var(--muted); margin-top: 1mm; }
  .module-number {
    width: 9mm; height: 9mm; border-radius: 50%;
    background: var(--blue); color: white;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .toc { list-style: none; padding: 0; margin-top: 4mm; }
  .toc.compact { margin: 1mm 0 0 15mm; }
  .toc li { margin: 0; border-bottom: 1px solid var(--line); }
  .toc a {
    display: grid;
    grid-template-columns: 12mm 1fr 17mm;
    gap: 2mm;
    padding: 2.2mm 1mm;
    align-items: baseline;
    color: var(--ink);
  }
  .toc-number { color: var(--blue); font-weight: 700; }
  .toc-duration { color: var(--muted); text-align: right; font-size: 8.5pt; }
  .module-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8mm;
    margin: 7mm 0;
  }
  .unit {
    break-before: auto;
    padding: 11mm 0 0;
    margin-top: 4mm;
    border-top: 1.5px solid #9eb4c6;
  }
  .module-overview + .unit { break-before: page; border-top: 0; margin-top: 0; padding-top: 5mm; }
  .unit-kicker { color: var(--blue); font-weight: 700; font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; }
  .unit-header { break-inside: avoid; break-after: avoid; }
  .unit-header h1 { margin-top: 2mm; border-bottom: 1px solid var(--line); padding-bottom: 4mm; }
  .unit-meta { display: flex; justify-content: space-between; gap: 5mm; color: var(--muted); font-size: 8.5pt; margin: -2mm 0 7mm; }
  .unit-content img {
    display: block;
    max-width: 100%;
    max-height: 190mm;
    object-fit: contain;
    margin: 5mm auto;
    break-inside: avoid;
  }
  .unit-content figure { break-inside: avoid; margin: 5mm 0; }
  blockquote {
    margin: 4mm 0;
    border-left: 4px solid var(--blue);
    background: var(--soft);
    padding: 3mm 4mm;
    break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }
  .callout-label { color: var(--blue-dark); font-weight: 700; margin-top: 4mm; margin-bottom: 1mm; }
  .external-resource {
    display: inline-block;
    border: 1px solid #9bbbd3;
    border-radius: 3px;
    padding: 2.5mm 4mm;
    margin: 2mm 0 4mm;
    background: #f1f8fc;
    font-weight: 600;
  }
  .external-resource::after { content: "  External resource"; color: var(--muted); font-size: 7.5pt; font-weight: 400; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 4mm 0 5mm;
    font-size: 9pt;
    break-inside: avoid;
  }
  th { background: #e7f1f8; color: var(--blue-dark); text-align: left; }
  th, td { border: 1px solid #aebdca; padding: 2mm 2.5mm; vertical-align: top; }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: #18212f;
    color: #f5f7fa;
    padding: 4mm;
    border-radius: 4px;
    font-size: 8.3pt;
    line-height: 1.42;
    break-inside: avoid;
  }
  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: .9em;
    background: #edf1f5;
    padding: .1em .25em;
    border-radius: 2px;
  }
  pre code { background: transparent; padding: 0; }
  .assessment-questions { padding-left: 7mm; }
  .assessment-questions > li {
    padding: 0 0 4mm 2mm;
    margin: 0 0 4mm;
    border-bottom: 1px solid var(--line);
    break-inside: avoid;
  }
  .assessment-prompt { font-weight: 600; margin-bottom: 2.5mm; }
  .assessment-choices { list-style: none; padding: 0; margin: 0; }
  .assessment-choices li { position: relative; padding: 1.2mm 0 1.2mm 7mm; margin: 0; }
  .assessment-choices li::before {
    content: "";
    position: absolute;
    left: 0; top: 2.1mm;
    width: 3.2mm; height: 3.2mm;
    border: 1px solid #6e7f91;
    border-radius: 50%;
  }
  .answer-key {
    break-before: auto;
    margin-top: 11mm;
    padding-top: 9mm;
    border-top: 1.5px solid #9eb4c6;
  }
  .answer { display: grid; grid-template-columns: 11mm 1fr; gap: 4mm; padding: 5mm 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .answer-number { width: 9mm; height: 9mm; border-radius: 50%; background: var(--blue); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .answer h2 { margin: 0 0 1.5mm; font-size: 13pt; }
  .supporting-source { color: var(--muted); font-size: 8.5pt; margin-bottom: 0; }
  .attribution { font-size: 9.5pt; }
  @media print {
    a { text-decoration: none; }
    .cover, .front-matter, .module-overview, .attribution { page-break-before: always; }
    .cover { page-break-before: auto; }
    .answer-key, .unit { page-break-before: auto; }
    .module-overview + .unit { page-break-before: always; }
  }
`;

module.exports = { renderDocument };
