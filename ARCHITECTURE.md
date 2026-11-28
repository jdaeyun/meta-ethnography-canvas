# Architecture of Meta-Ethnography Canvas

A map of how the app is built: what each file owns, what the data looks like, how a change travels from a click to the
database and the audit trail, and where the code does not yet follow its own rules. For the rules themselves (what every
change must do) see `CLAUDE.md`; for the list of every place that changes data see
[`docs/operations-inventory.md`](docs/operations-inventory.md) (generated from the code).

Written for v1.4.13 and updated for the one-transaction change after it. Numbers below (counts of units, flags) come
from `node tools/dev/list-operations.mjs`.

---

## 1. The app in one paragraph

A single page (`me_canvas.html`) with four tabs: **1 Extract** (read PDFs, extract 1st order quotes and 2nd order
constructs), **2 Matrix** (place constructs into 3rd order rows, judge how each study relates, CERQual, team status),
**3 Audit Trail** (memos, timeline, per-row history) and **4 Export** (Methods summary, eMERGe checklist, tables,
appendices as Markdown / Word / CSV). A drawer, **Research Aim & Overall Model**, sits over Tab 2. Compare (another
reviewer's JSON) and Backup / Restore are dialogs. Everything runs in the browser: IndexedDB is the only storage, there is
no server and no build step.

## 2. Layers

```
 ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 │ me_canvas.html   markup of the 4 tabs, drawer and dialogs (no inline scripts: CSP)          │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
 ┌──────────── feature files: each draws its views AND handles their events ────────────────┐
 │ app.js  loa.js  studies-pdf.js  extraction.js  matrix.js  audit-view.js  compare.js       │
 │ export.js (read only)   backup.js   demo.js                                                │
 │   render…()  builds DOM from `state`, and inside it attaches onclick / onchange handlers   │
 │   handler    builds the changed copies + audit entry, saveChange() stores both, redraws    │
 └───────────────▲───────────────────────────────▲───────────────────────────────▲───────────┘
                 │ uses                          │ uses                          │ uses
 ┌───────────────┴──────────────┐ ┌──────────────┴─────────────┐ ┌───────────────┴────────────┐
 │ core.js                      │ │ undo-audit.js              │ │ logic.js  (pure)           │
 │ `state` (the project in      │ │ saveChange(), auditEntry() │ │ no DOM, no state, no DB    │
 │  memory), dbPut / dbDelete / │ │ beginChange / finishChange │ │ consistency rules, ref.    │
 │ dbBatch / commitOps,         │ │ undo stack, performUndo    │ │ graph, undo planning,      │
 │ bindTextField, normalize*(), │ │                            │ │ merge / split plans,       │
 │ dialogs, helpers             │ │                            │ │ Appendix A selection …     │
 └───────────────┬──────────────┘ └────────────────────────────┘ └────────────────────────────┘
                 │
 ┌───────────────┴───────────────────────────────────────────────────────────────────────────┐
 │ IndexedDB  MetaEthnoCanvasDB (demo: MetaEthnoCanvasDB_demo)                                 │
 │ docs · pdf_binaries · annotations · clusters · logs · meta ('loa_main')                     │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

All files are classic `<script>`s sharing one global scope (so `file://` works). Load order is fixed in `me_canvas.html`:
`version.js`, `core.js`, `logic.js`, the CASP checklist, then `app.js`, `undo-audit.js`, `loa.js`, `studies-pdf.js`,
`extraction.js`, `matrix.js`, `audit-view.js`, `compare.js`, `export.js`, `backup.js`, `demo.js`. Any file may call any
function at run time; only top-level code is limited to what was loaded before it.

**The important fact about this structure:** a view's render function only draws. What a change does is worked out in
logic.js (`op…()`, section 6), and the buttons and menus that change data carry `data-action`: one listener per view runs
the action of that name (`MATRIX_ACTIONS`, `SIDEBAR_ACTIONS`, `LOA_ACTIONS`, `COMPARE_ACTIONS`, `AUDIT_ACTIONS`). Every
change is stored through the same path (section 6), so the rules for storing live in one place. What is still written in
the views is listed in section 12.

## 3. Files

| File | Size | Owns | Main entry points |
|---|---|---|---|
| `core.js` | 51 KB | storage engine, `state`, normalisation, save path for text, dialogs, small helpers | `initDB`, `dbPut`, `dbDelete`, `dbBatch`, `commitOps`, `bindTextField`, `bindPendingCommit`, `flushAllPendingSaves`, `normalizeDoc/Annotation/Cluster`, `upgradeProjectData`, `askReason`, `askChoice`, `showNotice`, `showSnackbar` |
| `logic.js` | 153 KB | everything that can be decided without the page (unit-tested in Node) | `checkInvariants`, `putIntoRow` / `takeOutOfRow` / `rowFieldsOf`, `applyOps`, `revertChange`, `tidyRefsOps`, `planMergeRows` / `planSplitRow` (+ undo plans), `rowDeletionOps`, `remapDocIds`, `purgeDocRefs`, `purgeClusterRefs`, `isKeyDecisionLog`, `LOG_KINDS`, `sanitizeProjectData`, the operations `op…()` (one per reviewer action, e.g. `opPlace`, `opAbsorbPassage`, `opImportPeerConstruct`) |
| `app.js` | 33 KB | start-up, project / reviewer setup, tab switching, settings, PDF drag & drop | `DOMContentLoaded` handler, `setActiveTab`, `refreshOpenViews`, `openProjectSetupModal` |
| `undo-audit.js` | 14 KB | the one save path for changes, audit entries and the undo stack | `saveChange`, `auditEntry`, `recordAuditLog`, `runOperation`, `OP_NAMES`, `beginChange`, `finishChange`, `pushUndoAction`, `performUndo` |
| `loa.js` | 45 KB | the Research Aim & Overall Model drawer, concept map (SVG), team models, Tab 4 write-up fields | `populateLoaInputs`, `saveLoaDrawer` / `commitLoaDrawer`, `renderLoaMap`, `renderTeamModels`, `addTeamModel`, `LOA_ACTIONS` |
| `studies-pdf.js` | 88 KB | studies: import, order, details / appraisal dock; PDF rendering, selection, highlights, search, citation auto-fill | `handleFiles`, `renderStudyList`, `switchStudy`, `persistDocOrder`, `checkBaselineChange`, `saveCurrentMeta`, `addAnno` |
| `extraction.js` | 57 KB | Tab 1 sidebar: quote and construct cards, links, passages, wrap, manual entry, 1st ⇄ 2nd switch | `updateSidebar`, `makeFirstCard`, `SIDEBAR_ACTIONS`, `deleteSecondOrder`, `absorbAsPassage`, `splitOffPassage`, `toggleAnnotationOrderType` |
| `matrix.js` | 116 KB | Tab 2: pool, rows (synthesis / CERQual / team sub-tabs), empty cells, auto-placement, row order, merge / split | `renderMatrixView`, `renderMatrixTable`, `buildRowBody`, `renderSecondOrderPool`, `assignSecondOrderToCluster`, `removeSecondOrderFromCluster`, `deleteClusterRow`, `mergeRows`, `splitRow`, `getMatrixIndex`, `MATRIX_ACTIONS` |
| `audit-view.js` | 17 KB | Tab 3 | `renderAuditView`, `renderAuditTimeline`, `AUDIT_ACTIONS` (memo form, reasons, attribution, deleting an entry) |
| `compare.js` | 54 KB | Compare & merge another reviewer's JSON | `processPeerJsonFile`, `matchPeerDocs`, `renderComparisonTabContent`, `COMPARE_ACTIONS`, `importPeerConstructNow`, `mergePeerAuditLogs` |
| `export.js` | 99 KB | Tab 4, read only: one spec per table, three renderers (HTML, Markdown, Word) | `getMethodSections`, `getEmergeChecklist`, `getTable1Spec` … `getAppendixASpec`, `renderPublicationView` |
| `backup.js` | 27 KB | JSON backup, restore (clean / merge), reset | `jsonFileInput` change handler, `resetProject` |
| `demo.js` | 4 KB | `?demo`: seeds the AI-generated demo project into its own database | `seedDemoIfEmpty` |

## 4. Data

### 4.1 Stores and records

| Store | Key | One record is | Notes |
|---|---|---|---|
| `docs` | `id` | a primary study | citation fields, `order`, appraisal (`appraisalTool`, `appraisalItems`, `appraisalSummary`), overview, `companionOf`, `conceptLinks[]` (within-study relationships), PDF fingerprint |
| `pdf_binaries` | `id` (= doc id) | the PDF bytes of a study | kept apart so `docs` stays small; never held in `state` |
| `annotations` | `id` | a 1st order quote (`type: 'first_order'`) or a 2nd order construct (`type: 'second_order'`) | shape: `normalizeAnnotation()` (core.js) |
| `clusters` | `id` | a 3rd order row | shape: `normalizeCluster()` (core.js) |
| `logs` | `id` | an audit entry | built by `auditEntry()`, written with its change by `saveChange()` (and merged in from backups / Compare) |
| `meta` | `'loa_main'` | the one project-wide record | aim, review question, write-up fields, line of argument, map links and positions, team models, study order strategy, study #1 … (`state.loa`) |

### 4.2 How the records point at each other

```
 docs ◄──────── annotations.docId ─────────────── (every quote and construct belongs to one study)
  ▲                    │
  │                    ├─ quote.parentIds[] ───────► constructs of the same study   (many-to-many)
  │                    │
  │                    └─ construct.clusterIds[] ──► clusters                        (placement)
  │                       + per-row fields keyed by row id:
  │                         clusterRelations[rowId]  judgement: reciprocal / refutational / other_aspect / unjudged
  │                         clusterComments[rowId]   cell note
  │                         aspectUsedInLoa[rowId]   ◇ used by the line of argument
  │
  ├──── clusters.baseDocId          the study whose construct established the row ('' not set yet, null no single base)
  ├──── clusters.cellStatus[docId]  empty-cell record: — not addressed / ◇ different aspect
  ├──── docs.companionOf            "same primary study as"
  └──── docs.conceptLinks[{from,to}]  between constructs of that study

 clusters.historyFrom[]   rows this row was merged from / split off (their history is its history)
 meta.loa.links[{from,to}]  concept-map relations between rows
 meta.loa.baselineDocId   study #1 when it was last confirmed
 logs.clusterIds[]        the rows an entry concerns (row history)
```

The complete list of fields that name another record, and which of them are kept on purpose as history, is the comment
at the top of "The reference graph" in `logic.js`. Every function that moves or removes ids (`remapDocIds`,
`purgeDocRefs`, `purgeClusterRefs`, `moveRowLinks`, `dropGoneLinks`, `tidyRefsOps`) works from that list, and
`checkInvariants()` checks it.

### 4.3 What is derived, not stored

- A row's character (Reciprocal / Refutational / Mixed …): `clusterTranslationType()` from its cells.
- The symbol in a cell (◆ ● ⚡ ◇ ○): `contribSymbol()` from the row's base and the cell's judgement.
- Which audit entries are key decisions (Appendix A): `isKeyDecisionLog()` from each entry's `kind`.

### 4.4 In memory

`state` (core.js, typed by the `AppState` typedef) holds the whole project: `docs`, `annotations`, `clusters`, `logs`,
`loa`, plus view state (`activeDocId`, filters, open sub-tabs, `undoStack`, `peerComparison` …). Views read `state`
directly. `getMatrixIndex()` (matrix.js) is a per-render index of `state` (a row's constructs, a construct's quotes, a
row's history); every write to annotations / logs drops it.

### 4.5 Format and compatibility

Backups carry `formatVersion` (`PROJECT_FORMAT = 1`, core.js). Files from 1.4.7 on must open with the same meaning in
every later version; a change of shape raises the number and adds a step to `upgradeProjectData()` and `normalize*()`.
The smoke test "Compatibility" holds the line with `tools/test/fixtures/project-format-1.json`.

## 5. Lifecycle

**Start-up** (`DOMContentLoaded`, app.js): ask for persistent storage → seed the demo if `?demo` → reviewer login →
read all stores (`docs` sorted by `order`, annotations, `clusters` sorted by `order`, logs newest first, `meta`) and pass
each record through `normalize*()` → fill the drawer → open the project setup if incomplete → remember study #1 for older
projects → draw the study list → open study #1. PDF fingerprints for older projects are filled in 4 s later.

**Drawing.** There is no central renderer. `setActiveTab(tab)` shows a tab and calls its `render…View()`. After a change,
the handler redraws what it thinks it changed (`updateSidebar()`, `renderMatrixView()`, `renderHighlights()` …). After a
change that can touch anything (Undo, closing Compare), `refreshOpenViews()` (app.js) redraws every open view. Tab 2 rows
are built lazily: only rows near the viewport have content (`renderMatrixTable`), so code must not look for row DOM across
the table.

## 6. How a change is stored

Every change goes the same way: the changed records are built as **copies**, and written **together with the audit
entries about them** in **one transaction**; only then does `state` (and so the screen) follow. A write the browser
refuses therefore changes nothing — not the database, not memory, not the trail.

### The one path: `saveChange(ops, entries)` (undo-audit.js)

```js
await saveChange(
  [{ store: 'clusters', put: { ...cluster, concordanceStatus: status, concordanceNote: note } }],  // copies (or { store, del })
  auditEntry({ kind: 'row_team', clusterIds: [cluster.id], category: 'concordance', action: '…', fromVal, toVal })
);
// stored in one transaction (commitOps); then applied to state: `cluster` itself now has the new status
```

- `auditEntry({ … })` builds an entry (same arguments as `recordAuditLog`; `null` for a minor operation that is not
  logged). `saveChange` takes one entry, a list, or none, and skips `null`s.
- `saveChange` writes with `commitOps(ops)` (core.js): a deletion first lets every save still waiting finish
  (`flushAllPendingSaves`); one transaction (`dbBatch`); then the same ops are applied to `state` (`applyOps`, logic.js):
  a record already in memory keeps its object (its content is replaced), a new one is appended, a deleted one leaves.
- `recordAuditLog(args)` is `saveChange([], auditEntry(args))`: for an entry that is not about a change being stored at the
  same moment (a memo, a note on a difference in Compare).
- `commitOps(ops)` alone is for writes without an entry: layout (map positions), bookkeeping (PDF fingerprints, study #1
  remembered), a new quote or construct, a reason added to a trail entry.

Entries made in the same millisecond keep their order (`auditEntry` keeps time strictly increasing), so an operation that
writes several entries shows them in the trail in the order it made them.

### Operations: `op*()` (logic.js) run by `runOperation(result, { undo })` (undo-audit.js)

The change itself is worked out without the page: an operation in logic.js takes the project, what the reviewer chose and
the names its entries need, and returns `{ ops, entries }` (copies to write, audit-entry arguments) or `null` when nothing
changes. It changes nothing; the scenario tests run it on a small project and check `checkInvariants()` after it.

```js
// matrix.js: the team status menu of a row
const status = tr.querySelector('.cl-conc-status').value;
await runOperation(opRowTeamStatus(state, { rowId: row.id, status, note }));          // stored with its entry, or nothing
// extraction.js: deleting a construct, undoable
await runOperation(project => opDeleteConstruct(project, { secId }, OP_NAMES), { undo: { label, undoLogs } });
```

`runOperation` stores the result with `saveChange`. With `undo`, it first writes saves still pending (and then works the
operation out, when it is given as a function), names the records the ops touch with `beginChange`, and pushes the change
once stored. `OP_NAMES` gives the entries the studies' display names and the judgements' labels. The list of operations,
with the kinds of entry each writes and where it is run from, is at the end of `docs/operations-inventory.md`.

### Views only draw: `data-action` and one listener

The matrix (`#matrixTable`), the Tab 1 sidebar (`#annotationsList`), the drawer (`#loaDrawer`), Compare
(`#compareTabContent`) and the Audit Trail (`#auditView`) do not attach a handler to each button or menu that changes
data. The element carries `data-action="…"`; one listener per view (click for buttons, change for menus) finds what it
belongs to (`matrixActionContext` / `sidebarActionContext` / `compareActionContext` / `auditActionContext`: the row, the
card, the construct, the study of an empty cell, the peer's item, the trail entry) and runs the action of that name in
`MATRIX_ACTIONS` / `SIDEBAR_ACTIONS` / `LOA_ACTIONS` / `COMPARE_ACTIONS` / `AUDIT_ACTIONS`. A Compare card names the peer's
item by its place in the peer's file (`data-peer-index`, `data-peer-row`, `data-peer-doc`: that file does not change during
a comparison, and a foreign file's ids need not be unique) and a construct here by its id (`data-local-id`). A text box commits through the same
action (`bindPendingCommit(el, () => MATRIX_ACTIONS['row-team'](…))`). Buttons that only change the view (sub-tabs, folding,
editors opening) keep their own small handlers.

### Text fields: `bindTextField` (core.js)

```js
bindTextField(el, {
  get: () => cluster.synthesisNote,
  set: v => { cluster.synthesisNote = v; },             // the record in memory follows the typing
  record: () => ({ store: 'clusters', put: cluster }),   // the record as a write
  log: (prev, next) => auditEntry({ kind: 'step_b', … }), // the entry, only if the text changed
  after: (prev, next) => …                               // optional: what follows from the change
});
```

While typing, a draft of the record is saved after a short pause (`dbPut`, no entry). When the box is left (or on a tab
switch, a re-render, the page closing), the text is trimmed and the record is written **with** its entry by `saveChange`.
A text field is the one place where memory changes before the write (that is what typing is); its commit stays pending and
is tried again if the write is refused. `bindPendingCommit(el, fn)` is the same idea for a box whose commit is not one
record's text (the study dock, an appraisal reason); its `fn` uses `saveChange`.

### Undo: `beginChange` … `finishChange` (undo-audit.js)

```js
await flushAllPendingSaves();
const change = beginChange('Relation "A" → "B"', [{ store: 'meta', id: 'loa_main' }], { undoLogs: [{ kind: 'map_relation', … }] });
await saveChange(ops, auditEntry({ … }));
finishChange(change);   // copies "after", pushes the change on the undo stack
showUndoSnackbar('Relation removed');
```

Ctrl+Z runs `revertChange()` + `tidyRefsOps()` (logic.js): it puts back what the operation changed and is still as the
operation left it, keeps later work, and brings nothing back that points at something deleted since; it writes that and
its `undoLogs` entries in one `saveChange`. Row merge / split and study deletion keep their own undo
(`pushUndoAction({ type: 'row_merge' | 'row_split' | 'delete_study' })`), planned on copies in logic.js. Undo covers
deletions and structural steps; ordinary edits are not on the stack (they are logged, and can be edited back). A deletion
that Ctrl+Z undoes does not ask first.

### Shared helpers for changes made from several views

| Helper | File | Used by |
|---|---|---|
| `linkQuoteToConstruct(f, sec)` | extraction.js | dragging a quote onto a card, the link menus in Tab 1 and the Tab 2 pool |
| `saveExtractedText(anno, text)` | extraction.js | correcting the extracted text in Tab 1 (quotes, constructs) and on a matrix card |
| `setConstructTeamStatus(sec, status, note, entry)` | extraction.js | a construct's team status in Tab 1, "Flag for Discussion" in Compare |
| `teamStatusText(status, note)` | extraction.js | how a construct's or row's team status reads in the trail |
| `persistDocOrder(list, entries, extraOps)` | studies-pdf.js | moving a study, sorting by year / richness, ordering tied studies, deleting / restoring a study |
| `rowOrderOps(list)`, `sortRows(list)`, `sortStudies(list)` | logic.js | row order (▲ / ▼), every place that puts rows / studies in their stored order |
| `peerRowPlacementOps(peerRowId, rowId, newRow)` | compare.js | placing constructs that waited in Compare for their row (row import, a row of that title made here) |
| `studyNameOf(rec)` | studies-pdf.js | the display name of the study a quote / construct belongs to |

### What the inventory shows now

From `docs/operations-inventory.md` (88 units that write, log or record an Undo step):

| | Units |
|---|---|
| write with `saveChange` (records and entries together) | 62 |
| write with `commitOps` alone (no entry: layout, bookkeeping, new extractions) | 11 |
| write with `dbPut` directly | 3 (the title's draft save, map positions while dragging, the PDF copy in a clean restore) |
| record an Undo step, themselves or through a helper | 19 |
| `split-write` · `mutate-first` · `no-kind` | 0 · 0 · 0 |

## 7. Decisions on the gaps found by the first inventory (v1.4.13)

The first inventory (before this change) found records and their entries saved in two transactions (41 units), records
changed in memory before the write (24), entries without a `kind` (33), and four places that did not do what the reviewer
would expect. All are fixed:

| Was | Now |
|---|---|
| A record and its audit entry in two transactions | One transaction (`saveChange`), everywhere |
| The record changed in memory first | Copies are written; memory follows once stored (text fields: see section 6) |
| Entries without a `kind` (Appendix A fell back to the action text) | Every entry has a kind registered in `LOG_KINDS`, with the same Appendix A meaning it had by category before (checked case by case) |
| Compare, "Flag for Discussion": replaced the construct's team note, no entry | Adds its reason to the note (the note stays) and logs the change (`construct_team`) |
| Removing a further passage: not logged (adding one is) | Logged (`passage_remove`) |
| Removing a map relation / a within-study relationship: no question, no Undo | No question, Ctrl+Z undoes it (and the undoing is logged) |
| Merge restore: one `dbPut` per record (a refused write left a half-merged project) | Worked out on copies, written in one transaction with its entry |

Still on purpose without an entry (`no-log` in the inventory): moving / resetting the map's boxes and its layout (layout),
a new quote or construct (the record carries its reviewer and its time), and the reason added to a trail entry (it keeps
its own history in the entry).

Removing a team model still asks first and cannot be undone with Ctrl+Z (the dialog says so).

## 8. Audit trail

Entries are built by `auditEntry({ category, action, detail, fromVal, toVal, rationale, clusterIds, kind, targetLabel,
targetId, isMinorOp })` and written with the change by `saveChange` (or alone by `recordAuditLog`). `category` groups
entries in Tab 3; `clusterIds` puts an entry in a row's history; `kind` (registry `LOG_KINDS`, logic.js) decides whether it
is a key decision in Appendix A. Entries are never edited by the app except for their `rationale` (Tab 3, with the earlier
wording kept) and the reviewer name (re-attribution); they can be deleted (undoable) from Tab 3.

## 9. Compare, backup, restore

- **Backup** (backup.js): every store except PDF bytes, plus `formatVersion`, as JSON. `flushAllPendingSaves()` first.
- **Clean restore**: `upgradeProjectData()` → build the project in start-up order → every record through `tidyRefsOps()`
  → clear stores → one `saveChange()` with the trail and the entry about the restore (rolled back by hand if refused).
- **Merge restore**: add what is new, fill empty texts of what exists (`mergeFillEmpty`, on copies), keep local values on
  conflict; everything, tidied (`tidyRefsOps`), in one `saveChange` with the entry about the merge.
- **Compare** (compare.js): match the peer's studies to local ones (`matchPeerDocs`: id, file hash, DOI, name, title),
  then constructs by text similarity. The reviewer imports, sets aside or marks agreed, item by item. Items imported
  before what they belong to keep the peer's links in `_peerParentIds` / `_peerRows` until it arrives.

## 10. Tests and what they guard

| Command | What it checks |
|---|---|
| `npm run typecheck` | names, `state` fields and option names across all scripts; `logic.js` alone with `strictNullChecks` |
| `tools/test/unit.test.mjs` | `logic.js` functions one by one (Node, no browser) |
| `tools/test/scenario.test.mjs` | chains of pure steps (place, judge, merge, split, delete, undo …) with `checkInvariants()` after each, fixed and seeded random walks |
| `tools/test/smoke.mjs` | the real app in Chromium on the demo project, in sections by feature (`[Matrix]`, `[Compare]` …; `ONLY="[Matrix]"` runs one); after every step `settle()` waits for idle and runs `checkInvariants()`; plus checks for wording, CSP, layout widths, compatibility, audit kinds, no browser dialogs, shared global names |

The smoke group "One transaction per change" checks that a refused write leaves memory and the trail as they were, and
the fixes of section 7. Inside `page.evaluate`, a smoke test waits with `__mecIdle()` (the same idea as `settle`), never a
fixed time; a promise of an event handler that fails is reported as a page error, so the group's "no page errors" check
sees it. What the tests still cannot reach well: the code still written in the views (section 12, last column), which only
the smoke test reaches, one click at a time.

`.github/workflows/test.yml` runs `npm test` on every pull request and every push to main.

## 11. Operations inventory

[`docs/operations-inventory.md`](docs/operations-inventory.md) is generated by `node tools/dev/list-operations.mjs`
(`--check` reports whether it is out of date; it is not part of `npm test`, because any edit moves its line numbers).
The script parses `app/js/*.js` with the TypeScript parser and lists every **unit** — the innermost event handler, or
else the named function — that writes (`saveChange`, `commitOps`, `dbPut`, `dbDelete`, `dbBatch`, `dbClear`), logs
(`auditEntry`; `recordAuditLog`, shown as "alone") or records an undo step (`beginChange`, `pushUndoAction`).

Columns: **Line** where the unit starts · **In** the named function it is in · **Trigger** the event or text field
(empty: called from elsewhere) · **Writes** · **Audit entries** (kind · category · action text) · **Undo** (`change` =
generic undo, otherwise the own undo type; "via" = through a function it calls) · **Calls** other units it calls (where
the work may really be done) · **Flags**: `split-write` (records and an entry about them in two transactions),
`mutate-first` (a record changed in memory, then written), `no-log` (project data written, no entry here or in a unit it
calls), `no-kind` (an entry without a kind).

The flags are read from the shape of the code. A flag says "look here", not "this is wrong": for example a `no-log` on
map positions is intended.

## 12. Where each view stands

| View | Operations in logic.js | `data-action` + one listener | Still written in the view (one path: `saveChange`) |
|---|---|---|---|
| Tab 2 matrix (matrix.js) | row team status, seed confirmed, row base, re-read, CERQual, empty cell (status, note), judgement, place, unplace, not translated, move row | yes (`MATRIX_ACTIONS`) | create / delete a row, merge / split (pure plans already: `planMergeRows` …), auto-placement, row texts (`bindTextField`) |
| Tab 1 sidebar (extraction.js) | link / unlink a quote, label source, extracted text, team status, within-study relationships, delete a construct / quote, add / remove a passage, absorb a construct as a passage / split it off (`opAbsorbPassage` / `opSplitPassage`), wrap a quote | yes (`SIDEBAR_ACTIONS`; absorbing is a drag onto the card) | 1st ⇄ 2nd switch, manual entry, labels and notes (`bindTextField`) |
| Drawer and write-up fields (loa.js) | map relations (add, remove), ◇ used by the line of argument, team models (add, remove), a write-up field, the drawer's fields saved together | yes (`LOA_ACTIONS`, on `#loaDrawer`) | map layout and box positions (layout, not logged) |
| Studies (studies-pdf.js) | order strategy, order of studies, study #1 and its rows (`opBaselineCheck`), removing a study, the study info dock, appraisal answers | the study list's 🗑 (`study-remove` on `#studyList`) | adding PDFs and their fingerprints (bookkeeping), a new extraction from the PDF, sorting (builds the order, then `persistDocOrder`) |
| Compare (compare.js) | provisional agreement, set aside / reconsidered, the other reviewer's map relations, a row of theirs (with the constructs waiting for it: `peerRowPlacementOps`), their trail, waiting constructs placed in a row of the same title, importing a construct (`opImportPeerConstruct`: id mapping, links waiting on both sides) and the study it needs (`peerStudyStub`) | yes (`COMPARE_ACTIONS`, on `#compareTabContent`) | team models (`addTeamModel`), a note on a different translation order (an entry on its own: `recordAuditLog`) |
| Audit trail (audit-view.js) | a reason added later (with its history), deleting an entry | yes (`AUDIT_ACTIONS`, on `#auditView`; the reason box commits through `AUDIT_ACTIONS['entry-reason']`) | a memo (an entry on its own: `recordAuditLog`) |
| Setup (app.js) | the reviewer of an item, re-attributing all items of an ID, the project code / aim / question | — | — |
| Backup (backup.js) | — | — | clean restore and merge (built on copies, tidied with `tidyRefsOps`, one `saveChange`), reset |

A test keeps the one path: `npm test` runs `node tools/dev/list-operations.mjs --rules`, which fails when a change is
stored without its entry, a record is changed in memory before it is written, an entry has no kind, or `dbPut` /
`recordAuditLog` is called outside the few places listed (with their reasons) in `ALLOWED_DIRECT`.
