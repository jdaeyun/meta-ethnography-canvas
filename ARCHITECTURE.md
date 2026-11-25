# Architecture of Meta-Ethnography Canvas

A map of how the app is built: what each file owns, what the data looks like, how a change travels from a click to the
database and the audit trail, and where the code does not yet follow its own rules. For the rules themselves (what every
change must do) see `CLAUDE.md`; for the list of every place that changes data see
[`docs/operations-inventory.md`](docs/operations-inventory.md) (generated from the code).

Written for v1.4.13. Numbers below (counts of units, flags) come from `node tools/dev/list-operations.mjs`.

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
 │   handler    changes a record, writes it, writes an audit entry, redraws                   │
 └───────────────▲───────────────────────────────▲───────────────────────────────▲───────────┘
                 │ uses                          │ uses                          │ uses
 ┌───────────────┴──────────────┐ ┌──────────────┴─────────────┐ ┌───────────────┴────────────┐
 │ core.js                      │ │ undo-audit.js              │ │ logic.js  (pure)           │
 │ `state` (the project in      │ │ recordAuditLog()           │ │ no DOM, no state, no DB    │
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

**The important fact about this structure:** the feature files have no separate "operations" layer. A view's render
function also contains the code that changes data when its buttons are used. `renderMatrixTable` (matrix.js) builds rows
lazily, and the row builder `buildRowBody` holds about a dozen such handlers; `updateSidebar` (extraction.js) and
`renderComparisonTabContent` (compare.js) are the same shape. Section 6 shows what that means for bugs.

## 3. Files

| File | Size | Owns | Main entry points |
|---|---|---|---|
| `core.js` | 53 KB | storage engine, `state`, normalisation, save path for text, dialogs, small helpers | `initDB`, `dbPut`, `dbDelete`, `dbBatch`, `commitOps`, `bindTextField`, `bindPendingCommit`, `flushAllPendingSaves`, `normalizeDoc/Annotation/Cluster`, `upgradeProjectData`, `askReason`, `askChoice`, `showNotice`, `showSnackbar` |
| `logic.js` | 81 KB | everything that can be decided without the page (unit-tested in Node) | `checkInvariants`, `putIntoRow` / `takeOutOfRow` / `rowFieldsOf`, `applyOps`, `revertChange`, `tidyRefsOps`, `planMergeRows` / `planSplitRow` (+ undo plans), `rowDeletionOps`, `remapDocIds`, `purgeDocRefs`, `purgeClusterRefs`, `isKeyDecisionLog`, `LOG_KINDS`, `sanitizeProjectData` |
| `app.js` | 36 KB | start-up, project / reviewer setup, tab switching, settings, PDF drag & drop | `DOMContentLoaded` handler, `setActiveTab`, `refreshOpenViews`, `openProjectSetupModal` |
| `undo-audit.js` | 12 KB | audit entries and the undo stack | `recordAuditLog`, `beginChange`, `finishChange`, `pushUndoAction`, `performUndo` |
| `loa.js` | 52 KB | the Research Aim & Overall Model drawer, concept map (SVG), team models, Tab 4 write-up fields | `populateLoaInputs`, `saveLoaDrawer` / `commitLoaDrawer`, `renderLoaMap`, `renderTeamModels`, `addTeamModel` |
| `studies-pdf.js` | 95 KB | studies: import, order, details / appraisal dock; PDF rendering, selection, highlights, search, citation auto-fill | `handleFiles`, `renderStudyList`, `switchStudy`, `persistDocOrder`, `checkBaselineChange`, `saveCurrentMeta`, `addAnno` |
| `extraction.js` | 66 KB | Tab 1 sidebar: quote and construct cards, links, passages, wrap, manual entry, 1st ⇄ 2nd switch | `updateSidebar`, `makeFirstCard`, `deleteSecondOrder`, `absorbAsPassage`, `splitOffPassage`, `toggleAnnotationOrderType` |
| `matrix.js` | 128 KB | Tab 2: pool, rows (synthesis / CERQual / team sub-tabs), empty cells, auto-placement, row order, merge / split | `renderMatrixView`, `renderMatrixTable`, `buildRowBody`, `renderSecondOrderPool`, `assignSecondOrderToCluster`, `removeSecondOrderFromCluster`, `deleteClusterRow`, `mergeRows`, `splitRow`, `getMatrixIndex` |
| `audit-view.js` | 17 KB | Tab 3 | `renderAuditView`, `renderAuditTimeline`, memo form |
| `compare.js` | 60 KB | Compare & merge another reviewer's JSON | `processPeerJsonFile`, `matchPeerDocs`, `renderComparisonTabContent`, `importPeerConstructNow`, `mergePeerAuditLogs` |
| `export.js` | 102 KB | Tab 4, read only: one spec per table, three renderers (HTML, Markdown, Word) | `getMethodSections`, `getEmergeChecklist`, `getTable1Spec` … `getAppendixASpec`, `renderPublicationView` |
| `backup.js` | 28 KB | JSON backup, restore (clean / merge), reset | `jsonFileInput` change handler, `resetProject` |
| `demo.js` | 4 KB | `?demo`: seeds the AI-generated demo project into its own database | `seedDemoIfEmpty` |

## 4. Data

### 4.1 Stores and records

| Store | Key | One record is | Notes |
|---|---|---|---|
| `docs` | `id` | a primary study | citation fields, `order`, appraisal (`appraisalTool`, `appraisalItems`, `appraisalSummary`), overview, `companionOf`, `conceptLinks[]` (within-study relationships), PDF fingerprint |
| `pdf_binaries` | `id` (= doc id) | the PDF bytes of a study | kept apart so `docs` stays small; never held in `state` |
| `annotations` | `id` | a 1st order quote (`type: 'first_order'`) or a 2nd order construct (`type: 'second_order'`) | shape: `normalizeAnnotation()` (core.js) |
| `clusters` | `id` | a 3rd order row | shape: `normalizeCluster()` (core.js) |
| `logs` | `id` | an audit entry | written only by `recordAuditLog()` (and merged in from backups / Compare) |
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

## 6. How a change happens today

There are four ways a change reaches the database. They behave differently, and each handler picks one.

### Path A — a text field: `bindTextField` (core.js)

```js
bindTextField(el, {
  get: () => cluster.synthesisNote,
  set: v => { cluster.synthesisNote = v; },
  save: saveRow,                                   // draft save after a short pause while typing
  commit: (prev, next) => recordAuditLog({ … })    // once, when the box is left, if the text changed
});
```

One save path per field; the audit entry is written once per edit. `bindPendingCommit(el, fn)` is the same idea for a box
whose commit is not one record's text. **This path is consistent and needs no change**, except that its `save` and its
`commit` are still two separate writes (see 7.1).

### Path B — one record, written directly: `dbPut` + `recordAuditLog`

The most common shape. Example: the team status of a row (matrix.js, `updateClusterConcordance`):

```js
cluster.concordanceStatus = newStatus;      // 1. change the record in memory (state is changed now)
cluster.concordanceNote = newNote;
await dbPut('clusters', cluster);           // 2. write it (transaction 1)
… update the badge in the DOM …
await recordAuditLog({ kind: 'row_team', … });   // 3. write the audit entry (transaction 2)
```

Memory is changed **before** the write, and the record and its audit entry are written in **two** transactions.

### Path C — several records at once: `commitOps(ops)` (core.js)

```js
const ops = [{ store: 'annotations', put: { ...sec, … } }, { store: 'clusters', del: rowId }, …];
await commitOps(ops);   // one transaction; THEN the same ops are applied to `state` (applyOps, logic.js)
```

Records are built as copies, written in one transaction, and only then applied to memory, so a refused write changes
nothing. Deletions flush pending saves first. Used for merge / split / delete a row, delete a study, orders, placing,
passages, restore. The audit entry is still written afterwards by `recordAuditLog` (a second transaction).

### Path D — Undo: `beginChange` … `finishChange` (undo-audit.js)

```js
const change = beginChange('Delete row "…"', [{ store: 'clusters', id }, …], { undoLogs: [ … ] }); // copies "before"
… do the work (path B or C) …
finishChange(change, created);   // copies "after", pushes the change on the undo stack
```

Ctrl+Z runs `revertChange()` + `tidyRefsOps()` (logic.js): it puts back what the operation changed and is still as the
operation left it, keeps later work, and brings nothing back that points at something deleted since. Row merge / split
and study deletion keep their own undo (`pushUndoAction({ type: 'row_merge' | 'row_split' | 'delete_study' })`), planned
on copies in logic.js. Undo covers deletions and a few structural steps; ordinary edits are not on the stack (they are
logged, and can be edited back).

### Who uses which path

From the inventory (104 units that write, log or record an undo step):

| | Units |
|---|---|
| write with `dbPut` / `dbDelete` directly (path B) | 61 |
| write with `commitOps` (path C) | 23 |
| record an undo step (path D), themselves or through a helper | 17 |
| write a record and its audit entry in two transactions (`split-write`) | 41 |
| change the record in memory before writing it (`mutate-first`) | 24 |

So the rules in `CLAUDE.md` (copies before the write, one transaction, flush before deleting, log every interpretive
change with its `kind` and `clusterIds`, undo for deletions, redraw what changed) are kept by each handler on its own.
Paths C and D already do most of it in one place; path B does it by hand in every handler. Many of the bugs fixed in
v1.4.8 – 1.4.13 were a handler that missed one of those rules.

## 7. Known gaps (found by the inventory)

These are places to look at, not confirmed bugs. Line numbers are those in `docs/operations-inventory.md` at the time
of writing.

### 7.1 A record and its audit entry are saved separately (41 units, `split-write`)

Every path B handler, and every path C handler, writes the audit entry in a second transaction. If the second write is
refused (storage full, tab closed between the two), the change is saved without its entry in the trail — the one thing
the audit trail promises not to happen. Fix: write the entry in the same transaction (an op `{ store: 'logs', put }` in
the same `commitOps`).

### 7.2 Memory is changed before the write (24 units, `mutate-first`)

When the write is refused, `state` (and the screen) shows a change the database does not have; the next save of that
record writes it anyway, possibly with other changes. `commitOps` was made to avoid this; path B handlers still do it.
Examples: `updateClusterConcordance`, `saveCerqualChanges`, `setRowBase`, the empty-cell status (matrix.js),
`updateSecConcordance`, label source (extraction.js), `saveCurrentMeta` (studies-pdf.js).

### 7.3 Interpretive changes that leave no audit entry (`no-log`, 9 units; some are on purpose)

| Unit | Kind of change | Comment |
|---|---|---|
| compare.js `renderLocalOnly` → "flag for discussion" | sets a construct's team status to Discuss **and replaces its team note** | not logged; the reviewer's earlier note is overwritten without a trace. Likely a real gap. |
| extraction.js `removePassage` | removes a further passage from a construct | undoable, but not logged, while adding a passage (`passage_add`) is |
| studies-pdf.js `addAnno`, extraction.js `submitManualAddForm` | a new quote / construct | not logged anywhere; check whether that is intended (the record itself carries `by` and its id carries the time) |
| loa.js map positions / reset, compare.js `savePeerSetAside`, matrix.js `persistClusterOrder`, compare.js `reattachPeerRowPlacements` | layout, or bookkeeping whose caller logs | fine (layout is not logged on purpose; the callers log the others) |

### 7.4 Audit entries without a `kind` (33 units, `no-kind`)

Appendix A falls back to matching the action text (`APPENDIX_ROUTINE` etc. in logic.js) for these, so rewording the UI
text can silently move an entry in or out of Appendix A. `CLAUDE.md` requires a kind only for the calls those patterns
recognise; the smoke test checks that. Examples without a kind: row created / deleted / merged / split, row base changed,
seed confirmed, empty-cell status, map relations, team models, Compare imports, study order.

### 7.5 Deletions that Ctrl+Z does not undo

| Unit | Asks first? |
|---|---|
| loa.js `renderLoaMap` → remove a map relation | no, and no undo |
| extraction.js `buildStudyConceptLinksBox` → remove a within-study relationship | no, and no undo |
| loa.js `renderTeamModels` → remove a team model | yes (says it cannot be undone) |

The rule "a deletion that Ctrl+Z undoes does not ask first" leaves open what a deletion without undo does; two of the
three neither ask nor undo.

### 7.6 Writes that are not one transaction

- Merge restore (backup.js, `jsonFileInput` handler): each added or filled record is a separate `dbPut` in a loop. A
  refused write half way leaves a half-merged project. The clean restore clears the stores and then writes in one
  `commitOps`, with a hand-made rollback snapshot if that fails.
- Auto-placement (matrix.js `seedIndexPaperRows`): rows and constructs are created with several `dbPut`s.
- 1st ⇄ 2nd switch (extraction.js `toggleAnnotationOrderType`): one branch uses `dbPut`, the other `commitOps`.

## 8. Audit trail

`recordAuditLog({ category, action, detail, fromVal, toVal, rationale, clusterIds, kind, targetLabel, targetId })`
(undo-audit.js) writes one entry and adds it to `state.logs`. `category` groups entries in Tab 3; `clusterIds` puts an
entry in a row's history; `kind` (registry `LOG_KINDS`, logic.js) decides whether it is a key decision in Appendix A.
Entries are never edited by the app except for their `rationale` (Tab 3) and the reviewer name (bulk re-attribution);
they can be deleted (undoable) from Tab 3.

## 9. Compare, backup, restore

- **Backup** (backup.js): every store except PDF bytes, plus `formatVersion`, as JSON. `flushAllPendingSaves()` first.
- **Clean restore**: `upgradeProjectData()` → build the project in start-up order → every record through `tidyRefsOps()`
  → clear stores → one `commitOps()`.
- **Merge restore**: add what is new, fill empty texts of what exists (`mergeFillEmpty`), keep local values on conflict.
- **Compare** (compare.js): match the peer's studies to local ones (`matchPeerDocs`: id, file hash, DOI, name, title),
  then constructs by text similarity. The reviewer imports, sets aside or marks agreed, item by item. Items imported
  before what they belong to keep the peer's links in `_peerParentIds` / `_peerRows` until it arrives.

## 10. Tests and what they guard

| Command | What it checks |
|---|---|
| `npm run typecheck` | names, `state` fields and option names across all scripts; `logic.js` alone with `strictNullChecks` |
| `tools/test/unit.test.mjs` | `logic.js` functions one by one (Node, no browser) |
| `tools/test/scenario.test.mjs` | chains of pure steps (place, judge, merge, split, delete, undo …) with `checkInvariants()` after each, fixed and seeded random walks |
| `tools/test/smoke.mjs` | the real app in Chromium on the demo project; after every step `settle()` waits for idle and runs `checkInvariants()`; plus checks for wording, CSP, layout widths, compatibility, audit kinds, no browser dialogs, shared global names |

What the tests cannot see well today: path B handlers (they live inside render functions, so only the smoke test reaches
them, one click at a time), and failures between the two writes of 7.1.

## 11. Operations inventory

[`docs/operations-inventory.md`](docs/operations-inventory.md) is generated by `node tools/dev/list-operations.mjs`
(`--check` reports whether it is out of date; it is not part of `npm test`, because any edit moves its line numbers).
The script parses `app/js/*.js` with the TypeScript parser and lists every **unit** — the innermost event handler, or
else the named function — that writes (`dbPut`, `dbDelete`, `dbBatch`, `dbClear`, `commitOps`), logs (`recordAuditLog`,
`logExtractedTextEdit`) or records an undo step (`beginChange`, `pushUndoAction`).

Columns: **Line** where the unit starts · **In** the named function it is in · **Trigger** the event or text field
(empty: called from elsewhere) · **Writes** · **Audit entries** (kind · category · action text) · **Undo** (`change` =
generic undo, otherwise the own undo type; "via" = through a function it calls) · **Calls** other units it calls (where
the work may really be done) · **Flags** (section 7).

The flags are read from the shape of the code. A flag says "look here", not "this is wrong": for example a `no-log` on
map positions is intended.

## 12. Direction (proposal, not yet started)

The gaps in section 7 have one cause: there is no single path for "an operation". The proposed refactoring keeps the data
format and the behaviour, and changes where the code lives:

1. **Operations as pure functions** (logic.js or a new pure file): `(project, args) → { label, ops, log, undo }`. No DOM,
   no `state`. Each one can then run in the scenario tests with `checkInvariants()`.
2. **One entry point in the browser**, `runOperation(op, args)`: flush pending saves, begin the undo change, write the ops
   **and the audit entry in one `commitOps`**, finish the change, redraw (`refreshOpenViews`). A handler becomes one call.
3. **Render functions only draw**: buttons carry `data-action`, one delegated listener per view calls `runOperation`.
   `bindTextField` commits through `runOperation` too.
4. **One file at a time**, starting with matrix.js, each as its own pull request, with the smoke tests as the safety net;
   then a test that only `runOperation` may call `dbPut` / `recordAuditLog` (like the existing check for `dbBatch`).
