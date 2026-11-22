# Meta-Ethnography Canvas — notes for AI assistants

Browser-only app (no server, no build step to run it). Works online (GitHub Pages) and offline: opening
`me_canvas.html` by double-click (file://) is supported — see "Offline edition" below.
Third-party libraries are bundled in `app/vendor/` (committed): Tailwind 3.4.17 (prebuilt CSS), PDF.js 3.11.174,
Phosphor Icons 2.1.1 (regular weight), docx 8.5.0. No CDN is used.

## Layout

```
me_canvas.html         markup only (4 tabs + modals); loads everything under app/
app/version.js         release info (version, date, concept DOI) — the one place to edit per release
app/css/me_canvas.css  app-specific CSS (everything else is Tailwind classes)
app/js/core.js         IndexedDB, auto-save badge, `state`, normalize*(), link helpers, escapeHtml, showSnackbar
app/js/app.js          project/reviewer setup, startup (DOMContentLoaded), welcome guide, tab switching, settings menu, PDF drag & drop
app/js/undo-audit.js   undo stack, recordAuditLog()
app/js/loa.js          "Research Aim & Overall Model" drawer, concept map SVG, team models
app/js/studies-pdf.js  PDF import, study list & order, study details dock, PDF render/selection/highlights, PDF search, citation auto-fill
app/js/extraction.js   Tab 1 sidebar: 1st/2nd order cards, passages, wrap, manual entry, 1st<->2nd switch
app/js/matrix.js       Tab 2: pool, 3rd order rows, CERQual/team sub-tabs, #1 auto-placement, visibility, row reorder
app/js/audit-view.js   Tab 3: memos, timeline, per-row history
app/js/compare.js      compare & merge another reviewer's JSON
app/js/export.js       Tab 4: Methods summary, eMERGe checklist, Tables 1/2/2b/3, Appendix; Markdown/.docx/CSV
app/js/backup.js       JSON backup/restore, reset
app/js/demo.js         ?demo mode: seeds the AI-generated demo project into a separate database (DEMO_MODE in core.js)
app/demo/              AI-GENERATED sample PDFs, project JSON and demo-data.js (rebuild with tools/demo/, see below)
demo.html              redirects to me_canvas.html?demo (so the offline edition can open the demo by double-click)
site/                  website (GitHub Pages): index.html (overview), manual.html, meta-ethnography-101.html,
                       css/site.css, css/tailwind.css, js/site.js. Plain HTML. Tailwind v4 is prebuilt into css/tailwind.css
                       (committed; `npm run css:site` after using a class that appears nowhere else in site/), separate from the app's Tailwind 3.
                       img/*.png and preview.png (social-media card) are taken from the demo by tools/site/make-screenshots.mjs:
                       re-run it after a visible UI change.
```

## Building app/vendor (only when libraries or Tailwind classes change)

Node.js LTS required. `npm install` (exact versions from package.json / package-lock.json), then `npm run build`
(= `npm run vendor`: copy libraries + licences into app/vendor and write THIRD_PARTY_NOTICES.md;
`npm run css`: Tailwind 3 CLI scans me_canvas.html + app/js/**/*.js → app/vendor/tailwind/tailwind.css;
`npm run css:site`: Tailwind 4 CLI (@tailwindcss/cli, its v4 nested under it) scans site/ → site/css/tailwind.css).
Both scripts call their CLI by path, because the two packages share the `tailwindcss` command name. If npm is set to omit
optional dependencies, install with `npm ci --include=optional` (Tailwind 4 needs its platform-specific binaries).
Re-run `npm run css` after using a Tailwind class that appears nowhere else. Write class names in full
(no string concatenation such as 'bg-' + color) so the Tailwind scanner can see them.
`npm run serve` serves the folder at http://localhost:8080 for testing. node_modules/ is not committed.
`npm test` runs the Playwright smoke tests (tools/test/smoke.mjs: audit logging, restore, lazy matrix rows, dialogs, file://) against the ?demo project;
install the browser once with `npx playwright install chromium`. Run it after changing app behaviour and extend it with the change.

## Demo (?demo)

`me_canvas.html?demo` uses its own IndexedDB (`MetaEthnoCanvasDB_demo`) and prefixed localStorage keys (`lsGet/lsSet/lsRemove` in core.js,
never call `localStorage` directly). All demo content is AI-generated and fictional and must stay labelled as such.
To rebuild: `node tools/demo/make-pdfs.mjs app/demo` + `python3 tools/demo/set-pdf-metadata.py app/demo`, then drive the app with
`tools/demo/build-reviewer-b.mjs` and `build-reviewer-a.mjs` (Playwright; they make the merged backup), then
`node tools/demo/enrich-demo.mjs <backup.json> <enriched.json>` (adds worked examples of the newer features: unjudged placements,
empty-cell statuses, within-study relationships, CASP judgements, a not-translated reason, the start choice), then
`node tools/demo/build-demo-data.mjs <enriched.json>`. To change only those examples, run both steps on `app/demo/AI-GENERATED_demo-project.json`.

## Offline edition (file://)

Browsers block fetch/XHR and file-based Workers on file:// pages. Therefore:
- `PDFJS_BASE` (core.js) is an absolute URL; the PDF.js worker resolves relative URLs against itself.
- On file://, `pdfjsDocumentOptions()` swaps in ScriptCMapReaderFactory / ScriptStandardFontDataFactory,
  which load `app/vendor/pdfjs/offline/**.js` via <script> (generated by tools/copy-vendor.mjs).
- The PDF.js worker falls back to the main thread by itself on file:// (slower on very large PDFs).
- `.github/workflows/offline-zip.yml` attaches `meta-ethnography-canvas-offline.zip` (same name every release, so the site can link to
  releases/latest/download/…; it contains the folder meta-ethnography-canvas-offline-vX.Y.Z with me_canvas.html + app/ + LICENSE + CITATION.cff + tools/OFFLINE-README.txt as README.txt) to each release.
Test both ways after changes: `npm run serve` (http) and double-clicking me_canvas.html (file://).

## Publishing

`.github/workflows/pages.yml` publishes site/ together with the app (me_canvas.html, app/) to GitHub Pages
(https://jdaeyun.github.io/meta-ethnography-canvas/) on every push to main that touches them. The pages sit next to
the app, link to it as `me_canvas.html` and read `app/version.js` for version / DOI (js/site.js). When a change is
visible in the UI or changes how something works, update the manual (and the 101 if relevant) in site/.
Release checklist: edit ONLY `app/version.js` (version, released) and push to main (usually by merging a pull request). The
`Sync version and publish release` workflow then (1) runs `tools/sync-version.mjs` (also `npm run sync-version`; `--check` only reports), which copies
the version into CITATION.cff, README.md, me_canvas.html and the site pages (the fallback text of `<span data-mec="version">`), (2) creates the GitHub
release with tag exactly `v` + version (a hyphen, e.g. `1.4.0-beta.1`, makes it a pre-release; notes are generated), and (3) runs `offline-zip.yml` to attach the ZIP.
Nothing happens if that release already exists, so bump the version only when you want a release: one version per group of merged pull requests,
not one per merge (patch = fixes, minor = new features; use a -beta.N suffix only for trial versions).
The website's offline-ZIP link is built from that tag (`site/js/site.js`), because `releases/latest/download/...` ignores pre-releases.

## Rules

- Classic `<script>` files sharing one global scope (not ES modules, so `file://` works).
  Keep the load order in `me_canvas.html`; `version.js`, then `core.js` first. Top-level code may only call
  functions from files loaded earlier — anything else must run inside handlers or DOMContentLoaded.
- Backward compatibility from v1.4.7 on (data format 1): a project saved by 1.4.7 or later must open in every later
  version with the same meaning. Backups carry `formatVersion` (`PROJECT_FORMAT`, core.js). A change to the data shape or to
  what a field means raises `PROJECT_FORMAT` and adds an upgrade step: in `upgradeProjectData()` for backup / compare files
  and in `normalize*()` for the browser's own database. A file from a newer format is refused with a message, nothing changed.
  The smoke test "Compatibility" restores tools/test/fixtures/project-format-1.json and compares its meaning (row bases,
  cell symbols, translation labels, CERQual, team status, counts) with project-format-1.expected.json: never rewrite the
  expected file (`WRITE_FIXTURE=1`) to make a test pass; add the upgrade step instead. Files from before 1.4.7 (no
  formatVersion) open on a best-effort basis through the small bridges already in place (`baseDocId` derived in
  `normalizeCluster()`, `loa.baselineDocId` and PDF fingerprints filled in at startup).
- Data stores: `docs`, `pdf_binaries` (PDF bytes, separate from docs), `annotations`, `clusters`, `logs`, `meta` (`loa_main`).
  Annotation shape is defined by `normalizeAnnotation()`; 1st→2nd order links are `parentIds[]` (many-to-many);
  2nd order → rows are `clusterIds[]` with per-row `clusterRelations` / `clusterComments`. Each row records the study whose construct
  established it (`cluster.baseDocId`; null = no single base, '' = set by the first construct placed): only that study's cards are
  unjudged ◆ in the row (`secRelation()`); study #1 is not the base of every row. A placed card is judged 'reciprocal',
  'refutational' or 'other_aspect' (◇, Noblit & Hare's third relation; `aspectUsedInLoa[rowId]` marks those the line of
  argument draws on), or stays 'unjudged'.
  Rows can be merged and split (matrix.js `mergeRows()` / `splitRow()`, logged, undoable); a row lists the rows it absorbed or
  was split from in `historyFrom`, and its history (`logIsForRow()`) includes theirs.
- Every interpretive change is logged with `recordAuditLog({ category, action, detail, fromVal, toVal, clusterIds })`.
  Pass `clusterIds` whenever the entry concerns 3rd order rows (the row history filter relies on it).
- Text fields that write an audit entry must use `bindPendingCommit(el, commitFn)` (core.js), not a bare `onchange`: the commit
  (save + `recordAuditLog`) then also runs on tab switch, matrix re-render and page leave, so a saved text never lacks its log entry.
- Tab 2 rows are built lazily (`renderMatrixTable`): only rows near the viewport have content. Do not query row DOM across the whole table.
  Scroll position is kept by an anchor row (`data-cluster-id`) and corrected when a placeholder above the viewport is built; overflow-anchor is off on purpose.
- Stance: this is a qualitative (Big Q) tool. Differences between reviewers are readings to discuss, not errors; agreement is provisional
  ("Agreed (for now)"); quality appraisal is never a ranking criterion; the Index Paper is a reasoned choice by the reviewer, not a sort result.
- Big Q wording, in UI text, logs, exports, demo data and the site. Read new text for these before committing; the smoke test
  ("Big Q wording") blocks some of them, but most need judgement:
  | Avoid (small q) | Write instead |
  |---|---|
  | consensus, resolve / resolved, discrepancy, concordance (as a label) | team perspectives, agreed (for now), work through, different readings, team status |
  | inter-rater / inter-reviewer agreement, reliability, kappa | provisional agreement, discussed |
  | verify, validate, real / raw data | trace, ground in participants' accounts, participant quotes (as reported in the primary studies) |
  | coding (of the included papers) | reading, extracting constructs, translating |
  | bias, sampling bias, deviant case | limits of context / sample, disconfirming or contrasting case |
  | weight / weighted, score, rank (of studies or findings) | inform, read, judge; appraisal is a judgement with reasons |
  | handle / control reflexivity, bracketing | reflect on, how the reviewers' positions shaped the reading |
  | rigour (as a property the tool guarantees) | quality, transparency, reflexivity |
  Legitimate uses stay: "accuracy" of extracted text against the source (eMERGe Item 9), counts of studies in CERQual
  adequacy, and quoted wording of external instruments (CASP's "sufficiently rigorous"). A difference between studies that a
  finding explains is part of the finding, not a CERQual coherence concern by itself.
- A row's Reciprocal / Refutational character is derived from its cells (`clusterTranslationType()`); there is no per-row setting.
- Escape every user value interpolated into HTML with `escapeHtml()`.
- Security: `me_canvas.html` has a Content-Security-Policy `<meta>` (everything from 'self' / file:, no outbound requests,
  no inline scripts, no eval; inline styles allowed). Keep it that way: no inline `<script>` or `on…=` handlers, no
  `eval` / `new Function`, no CDN or external fetch. A new resource type means updating the policy and the smoke test
  "Content-Security-Policy". PDF.js stays 3.11.174 (4.x+ ships only ES modules, which file:// cannot load) with
  `isEvalSupported: false` (CVE-2024-4367) on every `getDocument` call.
- Exports are built from shared specs (`getMethodSections()`, `getEmergeChecklist()`, `getTable3Specs()`);
  change the spec, not the three renderers separately. eMERGe item numbers follow France et al. (2019).
- UI text is English.
- The app must fit laptop widths: no overlap in the header or the view toolbars from 1024 px up (smoke test "Layout at laptop widths").
  Toolbars wrap (`flex-wrap`, `gap-*`, not `space-x-*`); long labels shorten below `xl` / `2xl` and keep the full text in `title`.
