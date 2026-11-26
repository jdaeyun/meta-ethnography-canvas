// Pure logic: no DOM, no `state`, no IndexedDB. Loaded right after core.js, so every later file can use it; the unit tests
// (tools/test/unit.test.mjs, `npm run test:unit`) load this file alone in Node. Keep it that way: what needs the page or
// the project goes in the other files, and takes what it needs from here as arguments.

// ======================= Audit actions and Appendix A selection (export.js) =======================
// Audit actions that other code reads back (row title history, Appendix A): written and matched from one place
const LOG_ACTION = { rowTitle: 'Refined 3rd Order Construct Title' };

// What kind of entry an audit entry is, written with it (recordAuditLog({ kind, targetLabel })). Appendix A decides by the kind,
// so rewording an action's text in the UI changes nothing here. The patterns further down read entries written before kinds
// existed (they stay as they are in old trails), and only those.
//   series: repeated edits of one text, shown as one line in Appendix A (its label; one series per row, or per targetLabel)
//   routine: bookkeeping, in Appendix A only when a reason was recorded with it; writeup: the Methods wording itself (Tab 4)
//   rowsKey: a key decision only when it concerns rows (clusterIds); changedKey: only when it changes an earlier judgement
/** @type {Record<string, { series?: string, routine?: boolean, writeup?: boolean, key?: boolean, rowsKey?: boolean, changedKey?: boolean }>} */
const LOG_KINDS = {
  row_title: { series: 'Row title refined' },
  step_a: { series: 'Step A translation summary revised' },
  step_b: { series: 'Step B third-order interpretation revised' },
  row_reflexive: { series: 'Reflexive note on the row revised' },
  row_team: { series: 'Team perspective on the row revised' },
  row_cerqual: { series: 'GRADE-CERQual assessment revised' },
  aim: { series: 'Research aim revised' },
  review_question: { series: 'Review question revised' },
  line_of_argument: { series: 'Line of argument revised' },
  relate_outcome: { series: 'Outcome of relating studies (Item 12) revised' },
  alternative_interpretations: { series: 'Alternative interpretations revised' },
  model_context: { series: 'Context where the model applies (Item 16) revised' },
  writeup: { writeup: true },
  memo: { key: true },
  auto_place: { key: true },
  construct_delete: { rowsKey: true },
  construct_restore: { rowsKey: true },
  judgement: { changedKey: true },
  trail_delete: { key: true },
  trail_restore: { key: true },
  undo_extraction: { routine: true },
  // Kinds of entries that were matched by category alone before (each keeps the meaning it had in Appendix A then)
  team_merge_note: { key: true },
  row_create: { key: true }, row_delete: { key: true }, row_restore: { key: true }, row_base: { key: true }, row_reread: { key: true },
  row_merge: { key: true }, row_split: { key: true }, row_undo: { key: true }, seed_choice: { key: true }, seed_confirm: { key: true },
  aspect_use: { key: true }, map_relation: { key: true }, team_model: { key: true }, peer_relations: { key: true },
  order_strategy: { key: true }, study_order: { key: true }, study_remove: { key: true }, study_restore: { key: true }, baseline_rows: { key: true },
  order_difference: { key: true }, peer_set_aside: { key: true }, peer_row_import: { key: true }, reviewer_bulk: { key: true }, peer_placement: { key: true }, project_setup: { key: true }, restore: { key: true },
  empty_cell: { routine: true }, // empty-cell statuses are shown in Table 2b
  undo_placement: { routine: true }
};
['quote_link', 'quote_unlink', 'order_switch', 'wrap', 'label_source', 'construct_label', 'place', 'unplace', 'passage_add', 'passage_remove', 'passage_absorb',
  'passage_split', 'within_study_link', 'within_study_unlink', 'extract_edit', 'study_overview', 'quote_delete', 'quote_restore', 'peer_import',
  'peer_logs', 'provisional_agreement', 'construct_team', 'row_reorder', 'cell_note', 'not_translated', 'subgroup', 'appraisal_answer',
  'appraisal', 'companion', 'reviewer_change'].forEach(k => { LOG_KINDS[k] = { routine: true }; });

// ---- Entries written before kinds existed: recognised by their action text ----
// Edits of one text that are shown as one line in Appendix A (family name; same row for row texts)
/** @type {[RegExp, string][]} */
const APPENDIX_EDIT_SERIES = [
  [new RegExp('^' + LOG_ACTION.rowTitle + '$'), 'Row title refined'],
  [/^Updated Step A Translation Summary for /, 'Step A translation summary revised'],
  [/^Updated Step B 3rd Order Definition & Interpretation for /, 'Step B third-order interpretation revised'],
  [/^Reflexive note on /, 'Reflexive note on the row revised'],
  [/^3rd Order Team Perspective Updated /, 'Team perspective on the row revised'],
  [/^Updated GRADE-CERQual Assessment for /, 'GRADE-CERQual assessment revised'],
  [/^Updated Phase 1 Research Aim$/, 'Research aim revised'],
  [/^Updated Review question \(Item 3\)$/, 'Review question revised'],
  [/^Updated Line of Argument Synthesis/, 'Line of argument revised'],
  [/^Updated Phase 4: Outcome of Relating Studies/, 'Outcome of relating studies (Item 12) revised'],
  [/^Updated Alternative interpretations/, 'Alternative interpretations revised'],
  [/^Updated Context where the model applies/, 'Context where the model applies (Item 16) revised']
];
function appendixSeries(l) {
  const kind = l.kind && LOG_KINDS[l.kind];
  const label = kind ? kind.series : (APPENDIX_EDIT_SERIES.find(([re]) => re.test(l.action || '')) || [])[1];
  if (!label) return null;
  // Same row by id; else by what it is about (targetLabel); entries from older versions without row ids by their action text
  return { label, key: label + '|' + ((l.clusterIds || [])[0] || l.targetLabel || l.action || '') };
}
function isMemoLog(l) { return l.kind ? l.kind === 'memo' : /^\[[^\]]+\]/.test(l.action || '') && !/^\[Reviewer-wrapped\]/.test(l.action || ''); }
// Routine bookkeeping: shown in the full trail; in Appendix A only when a reason was recorded with it
const APPENDIX_ROUTINE = [
  /^Linked 1st Order Quote/, /^Unlinked 1st Order Quote/, /^Switched (1st|2nd) Order/, /^\[Reviewer-wrapped\]/, /^Set 2nd Order label source/,
  /^Updated 2nd Order Summary Label/, /^Placed 2nd Order Construct/, /^Removed 2nd Order Construct from/,
  /^Added a further passage/, /^Recorded p\..* as a further passage/, /^Split p\..* off/, /^Recorded how two concepts relate within/, /^Removed a relationship between concepts within/,
  /^Edited the extracted text of/, /^Wrote Study Overview/, /^Revised Study Overview/, /^Deleted a 1st Order quote/, /^Restored a deleted 1st Order quote/,
  /^Imported Peer Construct from/, /^Merged \d+ audit trail entries from/, /^Recorded provisional agreement/, /^2nd Order Team Perspective Updated/,
  /^Reordered 3rd Order Theme Row/, /^Updated note on how a concept fits/, /^Noted why a 2nd Order construct was not translated/,
  /^Set subgroup for/, /^Appraisal \(/, /^Updated Critical Appraisal/, /^(Linked|Unlinked) .* companion paper/,
  /^Changed the reviewer attributed to an item/
];
// Write-up wording of the Methods (Tab 4 fields) is the Methods text itself, not a decision
const APPENDIX_WRITEUP = /^Updated (Reading & extraction process|Extracted from|Units of synthesis|Working definitions|Translation process|Quality appraisal policy|How appraisal was used|Process of relating studies|Studies synthesized into the line of argument)/;
function isKeyDecisionLog(l) {
  if ((l.rationale || '').trim()) return true;
  if (isMemoLog(l)) return true;
  const a = l.action || '';
  const kind = l.kind && LOG_KINDS[l.kind];
  if (kind) {
    if (kind.routine || kind.writeup) return false;
    // Deleting / restoring a construct is part of the reading; it is a decision about the synthesis when it was placed in a row
    if (kind.rowsKey) return (l.clusterIds || []).length > 0;
    // A first judgement of a placement is shown in Tables 2 / 2b: only a CHANGED judgement is a decision here
    if (kind.changedKey) return !/Not yet judged/.test(l.fromVal || '');
    if (kind.key || kind.series) return true;
  } else {
    // Undoing a key decision (a row merge / split, a removed row or study) is itself key; undoing an extraction step is not
    if (/^Undid: /.test(a) && l.category === 'reading_extraction') return false; // undoing a passage step is routine like the step
    if (/^Restored a deleted 2nd Order construct/.test(a)) return (l.clusterIds || []).length > 0;
    // Older trails logged several drawer fields in one entry ("Updated A / B / C"): leave it out only if every part is write-up wording
    if (/^Updated /.test(a) && a.slice(8).split(' / ').every(part => APPENDIX_WRITEUP.test('Updated ' + part))) return false;
    if (APPENDIX_ROUTINE.some(re => re.test(a))) return false;
    if (/^Judged construct as /.test(a)) return !/Not yet judged/.test(l.fromVal || '');
    if (/^Deleted a 2nd Order construct/.test(a)) return (l.clusterIds || []).length > 0;
  }
  // By category, for entries of any age (an entry with a kind that says nothing above, or none)
  const isAutoPlace = l.kind ? l.kind === 'auto_place' : /^Auto-placed/.test(a);
  const isOutcome = l.kind ? l.kind === 'relate_outcome' : /^Updated Phase 4/.test(a);
  if (l.category === 'linking' || (l.category === 'matrix_mapping' && !isAutoPlace)) return false;
  if (l.category === 'context_appraisal') return false; // reported per study in Table 1 / 1b
  if (l.category === 'relating_studies' && !isOutcome) return false; // empty-cell statuses are shown in Table 2b
  return true;
}

// ======================= Project files (core.js: upgradeProjectData) =======================
// A project file can come from someone else (Compare) or be edited by hand: keys that would change an object's prototype
// are removed at every depth, and records that are not objects with an id are left out (counted in data._droppedRecords).
function sanitizeProjectData(data) {
  if (!data || typeof data !== 'object') return data;
  const strip = v => {
    if (Array.isArray(v)) { v.forEach(strip); return v; }
    if (v && typeof v === 'object' && !(v instanceof ArrayBuffer)) {
      ['__proto__', 'constructor', 'prototype'].forEach(k => { if (Object.prototype.hasOwnProperty.call(v, k)) delete v[k]; });
      Object.keys(v).forEach(k => strip(v[k]));
    }
    return v;
  };
  strip(data);
  let dropped = 0;
  ['docs', 'annotations', 'clusters', 'logs'].forEach(k => {
    if (!Array.isArray(data[k])) return;
    // A usable key: a non-empty string or a finite number ('' or NaN would be refused by the database part way through)
    const ok = data[k].filter(r => r && typeof r === 'object' && !Array.isArray(r) && (typeof r.id === 'string' ? r.id.trim().length > 0 : Number.isFinite(r.id)));
    dropped += data[k].length - ok.length;
    data[k] = ok;
  });
  if (dropped) data._droppedRecords = dropped;
  return data;
}

// ======================= The project's consistency rules (checked in the tests; nothing here changes data) =======================
// A 2nd Order construct's per-row fields (keyed by 3rd Order row id), besides its clusterIds
const ANNOTATION_ROW_FIELDS = ['clusterRelations', 'clusterComments', 'aspectUsedInLoa'];

// Every rule the project's records must keep, in one place. Returns the violations ([] = consistent): { rule, id, detail }.
// Run after each step of the smoke tests (and available in the browser console), so a record left pointing at something that
// is gone is caught where it is made, not later in an export.
/** @param {{ docs?: any[], annotations?: any[], clusters?: any[], loa?: Record<string, any> }} project */
function checkInvariants({ docs = [], annotations = [], clusters = [], loa = {} }) {
  const out = [];
  const bad = (rule, id, detail) => out.push({ rule, id, detail });
  const docIds = new Set(docs.map(d => d.id)), rowIds = new Set(clusters.map(c => c.id));
  const secs = annotations.filter(a => a.type === 'second_order');
  const secById = new Map(secs.map(a => [a.id, a]));
  /** @type {[string, any[]][]} */ ([['docs', docs], ['annotations', annotations], ['clusters', clusters]]).forEach(([store, list]) => {
    const seen = new Set();
    list.forEach(r => { if (seen.has(r.id)) bad('unique-id', r.id, `${store}: the id is used twice`); seen.add(r.id); });
  });
  annotations.forEach(a => {
    if (!docIds.has(a.docId)) bad('annotation-study', a.id, `its study ${a.docId} is not in the project`);
    if (a.type === 'second_order') {
      const ids = Array.isArray(a.clusterIds) ? a.clusterIds : [];
      if (new Set(ids).size !== ids.length) bad('row-once', a.id, 'placed in the same row twice');
      ids.forEach(id => { if (!rowIds.has(id)) bad('row-exists', a.id, `placed in row ${id}, which is not in the project`); });
      ANNOTATION_ROW_FIELDS.forEach(k => Object.keys(a[k] || {}).forEach(id => {
        if (!ids.includes(id)) bad('row-fields-in-rows', a.id, `${k} for row ${id}, where it is not placed`);
      }));
      // The line-of-argument mark goes with a ◇ judgement in that row
      Object.keys(a.aspectUsedInLoa || {}).forEach(id => {
        if (a.aspectUsedInLoa[id] && (a.clusterRelations || {})[id] !== 'other_aspect') bad('aspect-mark', a.id, `marked as used by the line of argument in row ${id}, where it is not judged ◇ Different aspect`);
      });
    } else if (a.type === 'first_order') {
      if ((a.clusterIds || []).length) bad('quote-shape', a.id, 'a quote placed in a row');
      if ((a.passages || []).length) bad('quote-shape', a.id, 'a quote with passages');
      ANNOTATION_ROW_FIELDS.forEach(k => { if (Object.keys(a[k] || {}).length) bad('quote-shape', a.id, `a quote with ${k}`); });
      (a.parentIds || []).forEach(pid => {
        const p = secById.get(pid);
        if (!p) bad('quote-parent', a.id, `linked to construct ${pid}, which is not in the project`);
        else if (p.docId !== a.docId) bad('quote-parent', a.id, `linked to construct ${pid} of another study`);
      });
    }
  });
  clusters.forEach(c => {
    Object.keys(c.cellStatus || {}).forEach(docId => {
      if (!docIds.has(docId)) bad('cell-status-study', c.id, `an empty-cell record for study ${docId}, which is not in the project`);
      if (secs.some(a => a.docId === docId && (a.clusterIds || []).includes(c.id))) bad('cell-status-with-card', c.id, `an empty-cell record for study ${docId}, which has a construct in the row`);
    });
  });
  (Array.isArray(loa.links) ? loa.links : []).forEach(l => {
    if (!rowIds.has(l.from) || !rowIds.has(l.to)) bad('map-link', l.id, `a map relation to a row not in the project (${l.from} → ${l.to})`);
  });
  docs.forEach(d => {
    if (d.companionOf && (d.companionOf === d.id || !docIds.has(d.companionOf))) bad('companion', d.id, `"same primary study as" ${d.companionOf}, not another study here`);
    // A construct absorbed as a passage keeps its relationships under its id (they come back when it is split off)
    const own = new Set(secs.filter(a => a.docId === d.id).flatMap(a => [a.id, ...(a.passages || []).map(p => p.absorbed && p.absorbed.snapshot && p.absorbed.snapshot.id).filter(Boolean)]));
    (Array.isArray(d.conceptLinks) ? d.conceptLinks : []).forEach(l => {
      if (!own.has(l.from) || !own.has(l.to)) bad('concept-link', d.id, `a within-study relationship to a construct not in this study (${l.from} → ${l.to})`);
    });
  });
  return out;
}

// A write of one record, as dbBatch / commitOps take it (core.js): [{ store, put: record } | { store, del: key }]
/** @typedef {{ store: string, put?: any, del?: any }} DbOp */

// ======================= The reference graph: every field that names another record =======================
// The fields that point at a study, a 3rd Order row or a construct, in one place. A path that renames ids (backup merge,
// Compare) or removes a record (delete a study / a row, merge rows) goes through the functions below, so a new reference
// field is added here once and every such path follows it:
//   names a study:     annotation.docId; doc.companionOf; row.baseDocId, the keys of row.cellStatus,
//                      row.baselineChange.fromDocId / toDocId; loa.baselineDocId
//   names a row:       a construct's clusterIds and the keys of each of its ANNOTATION_ROW_FIELDS; loa.links from / to
//   names a construct: a quote's parentIds (dropGoneLinks, core.js); doc.conceptLinks from / to; row.seededFromId
//   (working fields of Compare that name the OTHER reviewer's ids: _peerParentIds, _peerRows, doc._peerConceptLinks)
// Kept on purpose when what they name is removed (history, or what Undo brings back): a row's baseDocId and baselineChange
// (which rows a removed study #1 established), row.historyFrom, row.seededFromId, a log entry's clusterIds, and
// loa.mapPositions (a deleted row's box goes back to where it was dragged when Undo brings the row back).
const mapRefId = (id, toLocal) => (id ? toLocal(id) || id : id);

// ---- Study ids from another file (backup.js merge, compare.js) ----
// Another reviewer's file, or a backup, can call a study by another id. toLocal(id) gives this project's id (or nothing: the
// id stays as it is). Each function returns a new record; an empty id stays as is.
// A row: its base (◆), its empty-cell records (keyed by study) and the re-reading note after study #1 changed
function remapRowDocIds(row, toLocal) {
  const out = { ...row };
  if ('baseDocId' in out) out.baseDocId = mapRefId(out.baseDocId, toLocal);
  if (isPlainObject(out.cellStatus)) {
    const cs = {};
    Object.keys(out.cellStatus).forEach(id => { cs[mapRefId(id, toLocal)] = out.cellStatus[id]; });
    out.cellStatus = cs;
  }
  if (isPlainObject(out.baselineChange)) {
    out.baselineChange = { ...out.baselineChange, fromDocId: mapRefId(out.baselineChange.fromDocId, toLocal), toDocId: mapRefId(out.baselineChange.toDocId, toLocal) };
  }
  return out;
}
// A study: the study it reports the same primary study as
function remapDocRecord(doc, toLocal) {
  const out = { ...doc };
  if (out.companionOf) out.companionOf = mapRefId(out.companionOf, toLocal);
  return out;
}
// Every study id in a project-shaped object ({ docs, annotations, clusters, loa }; absent parts stay absent)
/** @param {{ docs?: any[], annotations?: any[], clusters?: any[], loa?: any }} project @param {(id: string) => any} toLocal */
function remapDocIds(project, toLocal) {
  const each = (list, f) => (Array.isArray(list) ? list.map(r => (isPlainObject(r) ? f(r) : r)) : list);
  const out = { ...project };
  if ('docs' in project) out.docs = each(project.docs, d => remapDocRecord(d, toLocal));
  if ('annotations' in project) out.annotations = each(project.annotations, a => ({ ...a, docId: mapRefId(a.docId, toLocal) }));
  if ('clusters' in project) out.clusters = each(project.clusters, c => remapRowDocIds(c, toLocal));
  if (isPlainObject(project.loa) && 'baselineDocId' in project.loa) out.loa = { ...project.loa, baselineDocId: mapRefId(project.loa.baselineDocId, toLocal) };
  return out;
}

// ---- A study is removed (studies-pdf.js) ----
// What else names it, as new records to write ([{ store, put }]), and what they had there (for Undo): its empty-cell records in
// rows and "same primary study as" of other studies. (Its own constructs and quotes go with it; a row's ◆ base is kept, see
// above; study #1 is worked out again by checkBaselineChange.)
/** @param {{ docs?: any[], clusters?: any[] }} project @param {string} docId */
function purgeDocRefs({ docs = [], clusters = [] }, docId) {
  /** @type {DbOp[]} */ const ops = [];
  const cellStatus = [], companions = [];
  clusters.forEach(c => {
    if (!isPlainObject(c.cellStatus) || !(docId in c.cellStatus)) return;
    cellStatus.push({ id: c.id, v: c.cellStatus[docId] });
    const cs = { ...c.cellStatus };
    delete cs[docId];
    ops.push({ store: 'clusters', put: { ...c, cellStatus: cs } });
  });
  docs.forEach(d => {
    if (d.id === docId || d.companionOf !== docId) return;
    companions.push(d.id);
    ops.push({ store: 'docs', put: { ...d, companionOf: '' } });
  });
  return { ops, cellStatus, companions };
}
// A study's links that name what is not here (a study added from another file): "same primary study as" a study that is not
// in the project, or itself. Returns a new record.
/** @param {any} doc @param {Set<string>} docIds */
function dropGoneDocRefs(doc, docIds) {
  const out = { ...doc };
  if (out.companionOf && (out.companionOf === out.id || !docIds.has(out.companionOf))) out.companionOf = '';
  return out;
}

// ---- Within-study relationships of a study added from another reviewer's file (compare.js) ----
// A study added in Compare (a stub: none of its constructs are here yet) would bring the other reviewer's within-study
// relationships pointing at constructs that are not here. They wait aside (_peerConceptLinks: an optional working field, ignored
// where absent, like _peerParentIds / _peerRows) and each one joins the study's relationships once both its constructs have
// been imported. A waiting link keeps the peer's ids in from / to and, once known, the local ones in fromLocal / toLocal.
/** @param {any} doc */
function setAsideConceptLinks(doc) {
  const out = { ...doc };
  const links = (Array.isArray(doc.conceptLinks) ? doc.conceptLinks : []).filter(l => l && l.from && l.to);
  out.conceptLinks = [];
  if (links.length) out._peerConceptLinks = links.map(l => ({ ...l })); else delete out._peerConceptLinks;
  return out;
}
// The peer's construct peerId is now here as localId: its waiting links learn the local id; a link whose two constructs are both
// here joins the study's relationships. Returns a new record, or null when nothing changed.
/** @param {any} doc @param {string} peerId @param {string} localId */
function attachWaitingConceptLinks(doc, peerId, localId) {
  const waiting = Array.isArray(doc._peerConceptLinks) ? doc._peerConceptLinks : [];
  if (!waiting.some(l => l.from === peerId || l.to === peerId)) return null;
  const out = { ...doc, conceptLinks: [...(Array.isArray(doc.conceptLinks) ? doc.conceptLinks : [])] };
  const ids = new Set(out.conceptLinks.map(l => l.id));
  const still = [];
  waiting.forEach(w0 => {
    const w = { ...w0 };
    if (w.from === peerId) w.fromLocal = localId;
    if (w.to === peerId) w.toLocal = localId;
    if (!w.fromLocal || !w.toLocal) { still.push(w); return; }
    const { fromLocal, toLocal, ...link } = w;
    link.from = fromLocal; link.to = toLocal;
    if (!link.id || ids.has(link.id)) link.id = 'cl_' + fromLocal + '_' + toLocal + '_' + (link.type || 'link');
    if (out.conceptLinks.some(l => l.from === link.from && l.to === link.to && l.type === link.type)) return; // drawn here already
    ids.add(link.id);
    out.conceptLinks.push(link);
  });
  if (still.length) out._peerConceptLinks = still; else delete out._peerConceptLinks;
  return out;
}

// ---- A 3rd Order row is removed (matrix.js) or merged into another ----
// Every construct placed in it (or still carrying a per-row field of it) is taken out with all it had there, and its
// concept-map relations go. Returns new records to write ([{ store, put }]) and what Undo needs to put it back:
// assignedSecIds (the constructs placed in it), perRow (what each had there), removedLinks. loa: the model after it.
/** @param {{ annotations?: any[], loa?: any }} project @param {string} rowId */
function purgeClusterRefs({ annotations = [], loa = {} }, rowId) {
  /** @type {DbOp[]} */ const ops = [];
  const assignedSecIds = [], perRow = {};
  annotations.forEach(a => {
    if (!a || a.type !== 'second_order') return;
    const placed = Array.isArray(a.clusterIds) && a.clusterIds.includes(rowId);
    if (!placed && !ANNOTATION_ROW_FIELDS.some(k => isPlainObject(a[k]) && rowId in a[k])) return;
    const copy = { ...a };
    perRow[a.id] = takeOutOfRow(copy, rowId); // (copies the fields it changes: the record in memory is not touched)
    if (placed) assignedSecIds.push(a.id);
    ops.push({ store: 'annotations', put: copy });
  });
  const links = Array.isArray(loa.links) ? loa.links : [];
  const removedLinks = links.filter(l => l && (l.from === rowId || l.to === rowId));
  const nextLoa = removedLinks.length ? { ...loa, links: links.filter(l => !removedLinks.includes(l)) } : loa;
  if (removedLinks.length) ops.push({ store: 'meta', put: nextLoa });
  return { ops, assignedSecIds, perRow, removedLinks, loa: nextLoa };
}
// Deleting a row: purgeClusterRefs, the row's deletion, and every other row numbered by its place in the list (rows can share
// a number, e.g. one brought back by an Undo after others were renumbered). The deleted row's place stays free, and row is the
// record as Undo should bring it back (with that place as its number), so Undo puts it back exactly where it was.
/** @param {any} project @param {string} rowId */
function rowDeletionOps(project, rowId) {
  const purge = purgeClusterRefs(project, rowId);
  const list = project.clusters || [];
  const at = list.findIndex(c => c.id === rowId);
  /** @type {{ store: string, put?: any, del?: any }[]} */ const ops = [...purge.ops];
  list.forEach((c, i) => { if (c.id !== rowId && c.order !== i) ops.push({ store: 'clusters', put: { ...c, order: i } }); });
  ops.push({ store: 'clusters', del: rowId });
  return { ...purge, ops, row: at >= 0 ? { ...list[at], order: at } : null };
}
// Concept-map relations when row srcId is merged into tgtId: they follow the row; a relation of the two rows to each other, or
// one that becomes a duplicate, is dropped (for a relation without direction, A–C and C–A are the same relation)
/** @param {any[]} links @param {string} srcId @param {string} tgtId */
function moveRowLinks(links, srcId, tgtId) {
  const seen = new Set(), out = [];
  (Array.isArray(links) ? links : []).forEach(l => {
    const n = { ...l, from: l.from === srcId ? tgtId : l.from, to: l.to === srcId ? tgtId : l.to };
    const pair = isDirectedLink(n.type) ? n.from + '|' + n.to : [n.from, n.to].sort().join('|');
    const key = pair + '|' + n.type;
    if (n.from !== n.to && !seen.has(key)) { seen.add(key); out.push(n); }
  });
  return out;
}
// Concept-map relations between rows that are all here (e.g. taken from a backup whose rows were not all merged)
/** @param {any[]} links @param {Set<string>} rowIds */
function liveRowLinks(links, rowIds) {
  return (Array.isArray(links) ? links : []).filter(l => l && rowIds.has(l.from) && rowIds.has(l.to));
}

// ---- A construct and a row: the one place that changes a construct's membership of a row ----
// A construct's place in a row is clusterIds plus one value per row in each of ANNOTATION_ROW_FIELDS (judgement, cell note,
// line-of-argument mark). Every code path that puts a construct into a row, takes it out, or records / restores what it had
// there goes through these three, so no field is forgotten (the source of many earlier bugs).
// What the construct has in the row: { clusterRelations?, clusterComments?, aspectUsedInLoa? } (only the fields it has)
function rowFieldsOf(a, rowId) {
  const out = {};
  ANNOTATION_ROW_FIELDS.forEach(k => { if (a[k] && typeof a[k] === 'object' && rowId in a[k]) out[k] = a[k][rowId]; });
  return out;
}
// Out of the row, with everything it had there. Returns what it had (rowFieldsOf), e.g. for Undo.
function takeOutOfRow(a, rowId) {
  const had = rowFieldsOf(a, rowId);
  if (Array.isArray(a.clusterIds)) a.clusterIds = a.clusterIds.filter(id => id !== rowId);
  ANNOTATION_ROW_FIELDS.forEach(k => { if (a[k] && typeof a[k] === 'object' && rowId in a[k]) { a[k] = { ...a[k] }; delete a[k][rowId]; } });
  return had;
}
// Into the row, with exactly the given fields: anything left there from an earlier placement does not come back (a new
// placement starts unjudged). What it changes in the row itself (base, empty-cell note): placementOpsFor.
function putIntoRow(a, rowId, fields = {}) {
  if (!Array.isArray(a.clusterIds)) a.clusterIds = [];
  if (!a.clusterIds.includes(rowId)) a.clusterIds.push(rowId);
  ANNOTATION_ROW_FIELDS.forEach(k => {
    const has = a[k] && typeof a[k] === 'object' && rowId in a[k];
    if (k in fields && fields[k] !== undefined) a[k] = { ...(a[k] || {}), [rowId]: fields[k] };
    else if (has) { a[k] = { ...a[k] }; delete a[k][rowId]; }
  });
  return a;
}


// ======================= Applying written ops to a project in memory (core.js commitOps; the scenario tests) =======================
// The same ops dbBatch wrote, applied to a project object ({ docs, annotations, clusters, logs, loa }): a record already there
// under its id stays the same object (its content is replaced, so a view holding it sees the change), a new one is appended,
// a deleted one leaves its list. 'meta' / 'loa_main' replaces project.loa; pdf_binaries are not kept in memory.
const STORE_LIST = { docs: 'docs', annotations: 'annotations', clusters: 'clusters', logs: 'logs' };
/** @param {any} project @param {{ store: string, put?: any, del?: any }[]} ops */
function applyOps(project, ops) {
  const gone = {}, index = {};
  let logsAdded = false;
  const indexOf = key => index[key] || (index[key] = new Map((project[key] || []).map((r, i) => [r && r.id, i])));
  for (const o of ops) {
    if (o.store === 'meta') {
      if (!('del' in o) && o.put && o.put.id === 'loa_main' && project.loa !== o.put) project.loa = o.put;
      continue;
    }
    const key = STORE_LIST[o.store];
    if (!key) continue;
    if (!Array.isArray(project[key])) project[key] = [];
    if ('del' in o) { (gone[key] = gone[key] || new Set()).add(o.del); continue; }
    const rec = o.put;
    if (gone[key]) gone[key].delete(rec.id); // deleted and written again in one batch: it stays
    const at = indexOf(key).get(rec.id);
    if (at === undefined) {
      index[key].set(rec.id, project[key].length);
      project[key].push(rec);
      if (key === 'logs') logsAdded = true;
    } else if (project[key][at] !== rec) {
      const cur = project[key][at];
      Object.keys(cur).forEach(k => { if (!(k in rec)) delete cur[k]; });
      Object.assign(cur, rec);
    }
  }
  Object.keys(gone).forEach(key => { if (gone[key].size) project[key] = project[key].filter(r => !gone[key].has(r && r.id)); });
  if (logsAdded) project.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // newest first, as at startup
  return project;
}

// ======================= A construct in a row, read from a project (core.js reads `state` through these) =======================
// How a study's construct relates to a row it was placed in ('baseline' = the study that established the row, ◆)
const CELL_RELATIONS = ['unjudged', 'reciprocal', 'refutational', 'other_aspect'];
/** @param {any} project @param {any} row */
function rowBaseIn(project, row) {
  const id = row && row.baseDocId;
  return id && (project.docs || []).some(d => d.id === id) ? id : null;
}
/** @param {any} project @param {any} sec @param {string} rowId */
function relationIn(project, sec, rowId) {
  const b = rowBaseIn(project, (project.clusters || []).find(c => c && c.id === rowId));
  if (b && sec.docId === b) return 'baseline';
  const r = sec.clusterRelations && sec.clusterRelations[rowId];
  return CELL_RELATIONS.includes(r) ? r : 'unjudged';
}
/** @param {any} project @param {string} rowId */
function rowSecsIn(project, rowId) {
  return (project.annotations || []).filter(a => a && a.type === 'second_order' && (a.clusterIds || []).includes(rowId));
}
// A construct of study docId is in the row: a row whose base is not set yet ('') takes that study's, and the study's
// empty-cell record there ("— not addressed" / "◇ different aspect") no longer applies. Changes the row given; true if it did.
/** @param {any} row @param {string} docId */
function applyPlacementToRow(row, docId) {
  let ch = false;
  if (row.baseDocId === '') { row.baseDocId = docId; ch = true; }
  if (row.cellStatus && row.cellStatus[docId]) { row.cellStatus = { ...row.cellStatus }; delete row.cellStatus[docId]; ch = true; }
  return ch;
}

// What placing constructs does in their rows, as copies of the rows it changes ([{ store, put }], each row once): the
// constructs given as they will be written. Nothing in the project is changed: every path that places a construct (placing,
// Compare import, split off a passage, Undo through tidyRefsOps) writes these with it.
/** @param {any} project @param {any[]} annos */
function placementOpsFor(project, annos) {
  const rows = new Map();
  annos.forEach(a => {
    if (!a || a.type !== 'second_order') return;
    (a.clusterIds || []).forEach(id => {
      const row = rows.get(id) || (project.clusters || []).find(c => c.id === id);
      if (!row) return;
      const copy = rows.has(id) ? row : { ...row };
      if (applyPlacementToRow(copy, a.docId) || rows.has(id)) rows.set(id, copy);
    });
  });
  return [...rows.values()].map(r => ({ store: 'clusters', put: r }));
}

// ======================= Undo of a change: put back what it changed that is still as it left it =======================
// Most undoable operations are recorded as a change: each record they touched, as it was before (null = it did not exist)
// and as they left it (null = they deleted it). Undo works out the way back from those two against the project as it is
// now, so nothing has to be written per operation, and a new field is covered without touching Undo:
//  - a record the operation made is deleted; one it deleted comes back (unless it is back already);
//  - a field the operation changed goes back if it is still as the operation left it; if it was changed since, the later
//    change is kept and named (kept). Objects are compared key by key (a construct's judgement in one row, an empty-cell
//    record of one study), lists of ids or of records with an id as sets (what the operation added is taken out, what it
//    removed is put back; what was added since stays).
// What comes back is then tidied against the project as it is now (tidyRefsOps): nothing returns pointing at a row, a
// construct or a study deleted in the meantime. (Row merge / split and study deletion keep their own Undo: they renumber
// rows / studies, carry later work over between rows, and bring back a PDF.)
const deepCopy = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
/** @param {any} project @param {string} store @param {any} id */
function recordOf(project, store, id) {
  if (store === 'meta') return id === 'loa_main' ? project.loa : undefined;
  const list = project[STORE_LIST[store]];
  return Array.isArray(list) ? list.find(r => r && r.id === id) : undefined;
}
const sameValue = (x, y) => (x === undefined || y === undefined ? x === y : stableJson(x) === stableJson(y));
const setItemKey = x => (isPlainObject(x) ? 'id:' + x.id : 'v:' + stableJson(x));
const isSetLike = list => list.every(x => x === null || typeof x !== 'object' || (isPlainObject(x) && x.id !== undefined && x.id !== null));
function revertValue(cur, before, after, path, kept) {
  if (sameValue(before, after)) return cur;           // not changed by the operation
  if (sameValue(cur, after)) return deepCopy(before); // not changed since
  const objOrNone = v => v === undefined || isPlainObject(v);
  if (isPlainObject(cur) && objOrNone(before) && objOrNone(after)) {
    const b = before || {}, a = after || {}, out = { ...cur };
    new Set([...Object.keys(b), ...Object.keys(a), ...Object.keys(cur)]).forEach(k => {
      const v = revertValue(cur[k], b[k], a[k], path + '.' + k, kept);
      if (v === undefined) delete out[k]; else out[k] = v;
    });
    return before === undefined && !Object.keys(out).length ? undefined : out;
  }
  const listOrNone = v => v === undefined || Array.isArray(v);
  if (Array.isArray(cur) && listOrNone(before) && listOrNone(after) && isSetLike([...cur, ...(before || []), ...(after || [])])) {
    const b = before || [], a = after || [];
    const bBy = new Map(b.map(x => [setItemKey(x), x])), aBy = new Map(a.map(x => [setItemKey(x), x]));
    const out = cur.filter(x => { const k = setItemKey(x); return !(aBy.has(k) && !bBy.has(k)); }) // what it added goes
      .map(x => { const k = setItemKey(x); return bBy.has(k) && aBy.has(k) && sameValue(x, aBy.get(k)) ? deepCopy(bBy.get(k)) : x; });
    const have = new Set(out.map(setItemKey));
    b.forEach(x => { const k = setItemKey(x); if (!aBy.has(k) && !have.has(k)) { out.push(deepCopy(x)); have.add(k); } }); // what it removed comes back
    // Nothing else changed since: exactly as before (in its order)
    if (out.length === b.length && out.every(x => bBy.has(setItemKey(x)) && sameValue(x, bBy.get(setItemKey(x))))) return deepCopy(b);
    return out;
  }
  kept.push(path);
  return cur;
}
// Returns the ops that undo the change, and what was kept because it was changed since ([{ store, id, path }];
// path '' = the whole record).
/** @param {{ records: { store: string, id: any, before: any, after: any }[] }} change @param {any} project */
function revertChange(change, project) {
  /** @type {{ store: string, put?: any, del?: any }[]} */ const ops = [];
  const kept = [];
  for (const r of change.records || []) {
    const cur = recordOf(project, r.store, r.id);
    if (r.before == null && r.after == null) continue;
    if (r.before == null) { if (cur) ops.push({ store: r.store, del: r.id }); continue; } // made by the operation
    if (r.after == null) { // deleted by the operation
      if (!cur) ops.push({ store: r.store, put: deepCopy(r.before) });
      else kept.push({ store: r.store, id: r.id, path: '' });
      continue;
    }
    if (!cur) { kept.push({ store: r.store, id: r.id, path: '' }); continue; } // deleted since: stays deleted
    const paths = [];
    const next = revertValue(cur, r.before, r.after, '', paths);
    if (!sameValue(next, cur)) ops.push({ store: r.store, put: next });
    paths.forEach(p => kept.push({ store: r.store, id: r.id, path: p.slice(1) }));
  }
  return { ops, kept };
}

// The ops, made consistent with the project they are written into (Undo, anything that brings records back): a construct
// keeps only placements in rows that exist (and per-row fields only for those); a quote keeps links only to constructs of its
// own study and has no place in rows; a construct or quote of a study that is not here is not written; a study keeps "same
// primary study as" only for another study here, and within-study relationships only between its own constructs; the
// model's map relations only between rows here; a row has no empty-cell record for a study with a construct in it; and a
// construct placed in a row does there what placing does (applyPlacementToRow).
// The records written are checked; when the ops also delete something, every record of the project is, so nothing is left
// pointing at what they delete (a quote linked since to a construct the Undo takes away, a relationship drawn to it…).
// Returns { ops, dropped } (dropped: what was not brought back or was let go, in words).
/** @param {any} project @param {{ store: string, put?: any, del?: any }[]} ops */
function tidyRefsOps(project, ops) {
  const maps = {};
  ['docs', 'annotations', 'clusters'].forEach(k => { maps[k] = new Map((project[k] || []).map(r => [r.id, r])); });
  let loa = project.loa || {};
  ops.forEach(o => {
    if (o.store === 'meta') { if (o.put && o.put.id === 'loa_main') loa = o.put; return; }
    const m = maps[o.store];
    if (!m) return;
    if ('del' in o) m.delete(o.del); else m.set(o.put.id, o.put);
  });
  let out = ops.map(o => ({ ...o }));
  const at = new Map();
  out.forEach((o, i) => { if (!('del' in o)) at.set(o.store + '|' + (o.store === 'meta' ? 'loa_main' : o.put.id), i); });
  const written = new Set(at.keys());
  const copied = new Set();
  // The record as it will be written, as a copy that may be changed (added to the ops if it was not in them)
  const edit = (store, id) => {
    const k = store + '|' + id;
    if (!at.has(k)) { out.push({ store, put: store === 'meta' ? loa : maps[store].get(id) }); at.set(k, out.length - 1); }
    const i = at.get(k);
    if (!copied.has(k)) {
      out[i] = { store, put: deepCopy(out[i].put) }; copied.add(k);
      if (store === 'meta') loa = out[i].put; else maps[store].set(id, out[i].put);
    }
    return out[i].put;
  };
  const dropped = [];
  // A record brought back loses what is gone since; one already here loses what these ops take away
  const note = (store, id, back, away) => dropped.push(written.has(store + '|' + id) ? back : away);
  const deletes = ops.some(o => 'del' in o);
  const toCheck = store => deletes ? [...maps[store].values()] : out.filter(o => o.store === store && !('del' in o)).map(o => o.put);
  const rowIds = new Set(maps.clusters.keys());
  // A construct or quote of a study that is not here is not written (and, if the project holds it already, deleted)
  const inProject = new Set((project.annotations || []).map(a => a.id));
  out = out.flatMap(o => {
    if (o.store !== 'annotations' || 'del' in o || maps.docs.has(o.put.docId)) return [o];
    dropped.push('an item of a study deleted since');
    maps.annotations.delete(o.put.id); at.delete('annotations|' + o.put.id);
    return inProject.has(o.put.id) ? [{ store: 'annotations', del: o.put.id }] : [];
  });
  out.forEach((o, i) => { if (!('del' in o)) at.set(o.store + '|' + (o.store === 'meta' ? 'loa_main' : o.put.id), i); });
  // Constructs and quotes
  toCheck('annotations').forEach(a0 => {
    let a = a0;
    const fix = () => (a === a0 ? (a = edit('annotations', a0.id)) : a);
    if (a.type === 'second_order') {
      const ids = Array.isArray(a.clusterIds) ? a.clusterIds : [];
      const live = [...new Set(ids.filter(id => rowIds.has(id)))];
      if (live.length !== ids.length) { if (ids.some(id => !rowIds.has(id))) note('annotations', a.id, 'a placement in a row deleted since', 'a placement in a row this undo removes'); fix().clusterIds = live; }
      ANNOTATION_ROW_FIELDS.forEach(k => {
        if (isPlainObject(a[k]) && Object.keys(a[k]).some(id => !live.includes(id))) fix()[k] = Object.fromEntries(Object.entries(a[k]).filter(([id]) => live.includes(id)));
      });
      // The line-of-argument mark goes with a ◇ judgement in that row
      if (isPlainObject(a.aspectUsedInLoa) && Object.keys(a.aspectUsedInLoa).some(id => a.aspectUsedInLoa[id] && (a.clusterRelations || {})[id] !== 'other_aspect')) {
        fix().aspectUsedInLoa = Object.fromEntries(Object.entries(a.aspectUsedInLoa).filter(([id, v]) => !v || (a.clusterRelations || {})[id] === 'other_aspect'));
      }
      if (Array.isArray(a.parentIds) && a.parentIds.length) fix().parentIds = [];
    } else {
      if (Array.isArray(a.clusterIds) && a.clusterIds.length) fix().clusterIds = [];
      ANNOTATION_ROW_FIELDS.forEach(k => { if (a[k] !== undefined && Object.keys(a[k] || {}).length) delete fix()[k]; });
      if (a.type === 'first_order' && Array.isArray(a.passages) && a.passages.length) delete fix().passages;
      if (a.type === 'first_order') {
        const own = id => { const p = maps.annotations.get(id); return !!p && p.type === 'second_order' && p.docId === a.docId; };
        const ps = Array.isArray(a.parentIds) ? a.parentIds : [];
        if (ps.some(id => !own(id))) { note('annotations', a.id, 'a link to a construct deleted since', "a quote's link to a construct this undo removes"); fix().parentIds = ps.filter(own); }
      }
    }
  });
  // What placing a construct does in its rows (only for constructs written: a placement already here did it when made)
  out.filter(o => o.store === 'annotations' && !('del' in o) && o.put.type === 'second_order').map(o => o.put).forEach(a => (a.clusterIds || []).forEach(rid => {
    const row = maps.clusters.get(rid);
    if (row && (row.baseDocId === '' || (row.cellStatus && row.cellStatus[a.docId]))) applyPlacementToRow(edit('clusters', rid), a.docId);
  }));
  const secs = [...maps.annotations.values()].filter(a => a && a.type === 'second_order');
  // Rows: no empty-cell record for a study with a construct in the row, nor for a study that is not here
  toCheck('clusters').forEach(c => {
    const stale = Object.keys(c.cellStatus || {}).filter(d => !maps.docs.has(d) || secs.some(a => a.docId === d && (a.clusterIds || []).includes(c.id)));
    if (stale.length) { const e = edit('clusters', c.id); e.cellStatus = { ...e.cellStatus }; stale.forEach(d => delete e.cellStatus[d]); }
  });
  // Studies
  toCheck('docs').forEach(d => {
    if (d.companionOf && (d.companionOf === d.id || !maps.docs.has(d.companionOf))) edit('docs', d.id).companionOf = '';
    const links = Array.isArray(d.conceptLinks) ? d.conceptLinks : [];
    if (!links.length) return;
    const own = new Set(secs.filter(a => a.docId === d.id).flatMap(a => [a.id, ...(a.passages || []).map(p => p.absorbed && p.absorbed.snapshot && p.absorbed.snapshot.id).filter(Boolean)]));
    const keep = links.filter(l => own.has(l.from) && own.has(l.to));
    if (keep.length !== links.length) { note('docs', d.id, 'a within-study relationship to a construct deleted since', 'a within-study relationship to a construct this undo removes'); edit('docs', d.id).conceptLinks = keep; }
  });
  // The model's map relations
  if ((deletes || written.has('meta|loa_main')) && Array.isArray(loa.links)) {
    const keep = liveRowLinks(loa.links, rowIds);
    if (keep.length !== loa.links.length) { note('meta', 'loa_main', 'a map relation to a row deleted since', 'a map relation to a row this undo removes'); edit('meta', 'loa_main').links = keep; }
  }
  return { ops: out, dropped: [...new Set(dropped)] };
}

// ======================= Merging and splitting 3rd Order rows (matrix.js) =======================
// What a merge / split writes, worked out from the project without changing it: the caller writes plan.ops (commitOps) and
// keeps plan.before / plan.after for Undo. helpers give the names used in the notes and the log: docName(id) (null for a
// study not here), relLabel(rel) ('Reciprocal'…), rowTitle(row). Without them, ids and relation keys are used (tests).
const MERGE_ROW_FIELDS = ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation', 'cellStatus', 'baseDocId', 'historyFrom', 'baselineChange'];
const pickFields = (c, fields) => { const o = {}; fields.forEach(f => { o[f] = c[f] === undefined ? undefined : deepCopy(c[f]); }); return o; };
const annRowState = (a, ids) => ({ id: a.id, member: ids.map(id => (a.clusterIds || []).includes(id)), keys: ANNOTATION_ROW_FIELDS.map(k => ids.map(id => (a[k] || {})[id])) });
// Text carried from another row is kept, marked with where it came from
const carryText = (into, from, title) => from && from.trim() ? (into && into.trim() ? into.trim() + '\n\n' : '') + `[From row "${title}"] ` + from.trim() : (into || '');
function rowPlanHelpers(project, h = {}) {
  return {
    docName: h.docName || (id => ((project.docs || []).some(d => d.id === id) ? String(id) : null)),
    relLabel: h.relLabel || (r => r),
    rowTitle: h.rowTitle || (c => (c && c.thirdOrderTitle && c.thirdOrderTitle.trim()) || '(Untitled row)')
  };
}
// A construct as a copy whose row fields can be changed (the record in the project is not touched)
const copyForRows = a => ({ ...a, clusterIds: [...(a.clusterIds || [])], clusterRelations: { ...(a.clusterRelations || {}) }, clusterComments: { ...(a.clusterComments || {}) } });

// Row src goes into row tgt. A judgement is a reading against the study that established the row (◆): when the two rows were
// established by different studies, a card's judgement in the source row does not carry over; it starts unjudged in the
// merged row and the earlier judgement is kept in its cell note, to be read again. A target row with "No single base" (null)
// stays so; one whose base is not set yet ('') takes the source row's. Texts of the source row are added, marked with their
// origin; empty-cell records are kept where the merged row still has nothing of that study; map relations follow the row.
/** @param {any} project @param {string} srcId @param {string} tgtId @param {any} [helpers] */
function planMergeRows(project, srcId, tgtId, helpers) {
  const H = rowPlanHelpers(project, helpers);
  const src = (project.clusters || []).find(c => c.id === srcId), tgt0 = (project.clusters || []).find(c => c.id === tgtId);
  if (!src || !tgt0 || src === tgt0) return null;
  const srcTitle = H.rowTitle(src), tgtTitle = H.rowTitle(tgt0);
  const secs0 = rowSecsIn(project, src.id);
  const ids = [src.id, tgt0.id];
  const loa = project.loa || {};
  const before = { src: deepCopy(src), tgt: pickFields(tgt0, MERGE_ROW_FIELDS), anns: secs0.map(a => annRowState(a, ids)), links: deepCopy(loa.links || []) };
  /** @type {{ store: string, put?: any, del?: any }[]} */ const ops = [];
  let moved = 0;
  const differing = [], rejudge = [];
  const tgtNoBase = tgt0.baseDocId === null;
  const srcBase = rowBaseIn(project, src), tgtBase = tgtNoBase ? null : (rowBaseIn(project, tgt0) || srcBase);
  const baseDiffers = srcBase !== tgtBase;
  const baseName = id => (id && H.docName(id)) || 'the row as a whole (no single base)';
  const studyName = id => H.docName(id) || 'Study';
  const rel = r => H.relLabel(r);
  const secs = secs0.map(copyForRows);
  for (const s of secs) {
    if (!s.clusterIds.includes(tgt0.id)) {
      moved++;
      // What the card takes into the merged row; nothing left there from an earlier placement comes back (putIntoRow)
      const from = rowFieldsOf(s, src.id);
      const rs = relationIn(project, s, src.id);
      const judged = rs !== 'unjudged' && rs !== 'baseline';
      const asNote = text => carryText(from.clusterComments || '', text, srcTitle);
      let next;
      if (baseDiffers && s.docId === tgtBase) {
        // The study that established the target row: its base (◆) there, not judged; a judgement from the source row goes into its note
        next = { clusterComments: (judged ? asNote(`judged ${rel(rs)} against ${baseName(srcBase)} there; establishes the merged row`) : from.clusterComments) || undefined };
      } else if (baseDiffers && rs === 'baseline') {
        // The study that established the source row: judged like any other study in the merged row
        rejudge.push(`${studyName(s.docId)} (p.${s.page})`);
        next = { clusterComments: asNote(`established that row; to judge against ${baseName(tgtBase)}`) };
      } else if (baseDiffers && rs !== 'unjudged') {
        rejudge.push(`${studyName(s.docId)} (p.${s.page})`);
        next = { clusterComments: asNote(`judged ${rel(rs)} against ${baseName(srcBase)} there; to judge again against ${baseName(tgtBase)}`) };
      } else {
        next = from; // same base: the judgement, note and line-of-argument mark carry over
      }
      putIntoRow(s, tgt0.id, next);
    } else {
      // Already in both rows: the target row's judgement stays; a different reading in the source row is kept as a note
      const rs = relationIn(project, s, src.id), rt = relationIn(project, s, tgt0.id);
      let carried = s.clusterComments[src.id] && s.clusterComments[src.id] !== s.clusterComments[tgt0.id] ? s.clusterComments[src.id] : '';
      if (rs !== rt && rs !== 'unjudged' && rs !== 'baseline') {
        carried = `judged ${rel(rs)} there` + (carried ? ` — ${carried}` : '');
        differing.push(`${studyName(s.docId)} (p.${s.page}): ${rel(rs)} in "${srcTitle}", ${rel(rt)} in "${tgtTitle}"`);
      }
      if (carried) { const there = rowFieldsOf(s, tgt0.id); putIntoRow(s, tgt0.id, { ...there, clusterComments: carryText(there.clusterComments, carried, srcTitle) }); }
    }
    takeOutOfRow(s, src.id); // the source row goes
    ops.push({ store: 'annotations', put: s });
  }
  const tgt = { ...tgt0, cellStatus: { ...(tgt0.cellStatus || {}) }, historyFrom: [...(tgt0.historyFrom || [])] };
  ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation'].forEach(k => { tgt[k] = carryText(tgt[k], src[k], srcTitle); });
  const movedIds = new Set(secs.map(s => s.id));
  const docsInTgt = new Set([...secs.filter(s => s.clusterIds.includes(tgt.id)), ...rowSecsIn(project, tgt.id).filter(a => !movedIds.has(a.id))].map(a => a.docId));
  Object.entries(src.cellStatus || {}).forEach(([docId, v]) => { if (!docsInTgt.has(docId) && !tgt.cellStatus[docId]) tgt.cellStatus[docId] = v; });
  Object.keys(tgt.cellStatus).forEach(docId => { if (docsInTgt.has(docId)) delete tgt.cellStatus[docId]; });
  if (!tgtNoBase && !rowBaseIn(project, tgt) && rowBaseIn(project, src)) tgt.baseDocId = src.baseDocId;
  // A target whose base was not set yet ('') takes the source row's choice also when it is "No single base" (null): with cards in
  // it and still '', the next study placed there would establish the merged row
  if (tgt.baseDocId === '' && src.baseDocId === null) tgt.baseDocId = null;
  if (tgt.baseDocId === '' && docsInTgt.size) tgt.baseDocId = (secs.find(s => s.clusterIds.includes(tgt.id)) || rowSecsIn(project, tgt.id)[0] || {}).docId || '';
  // Still to be re-read after study #1 changed: only if the merged row is established by the study that note is about
  const bc = src.baselineChange;
  if (bc && !tgt.baselineChange && (tgt.baseDocId === src.baseDocId || tgt.baseDocId === bc.fromDocId)) tgt.baselineChange = bc;
  tgt.historyFrom = [...new Set([...tgt.historyFrom, src.id, ...(src.historyFrom || [])])];
  ops.push({ store: 'clusters', put: tgt });
  const links = Array.isArray(loa.links) ? moveRowLinks(loa.links, src.id, tgt.id) : null;
  if (links) ops.push({ store: 'meta', put: { ...loa, links } });
  ops.push({ store: 'clusters', del: src.id });
  const after = { tgt: pickFields(tgt, MERGE_ROW_FIELDS), anns: secs.map(a => annRowState(a, ids)), links: deepCopy(links || loa.links || []) };
  return { ops, before, after, moved, alreadyThere: secs.length - moved, differing, rejudge, srcTitle, tgtTitle,
    srcBaseName: baseName(srcBase), tgtBaseName: baseName(tgtBase) };
}

// Cards secIds of row src go into a new row nw (a record not in the project yet), placed right below src; every row is
// numbered again. "No single base" stays so in the new row; otherwise the new row keeps the source row's base when that
// study's card moves with it, and is established by the first moved card's study when it does not. When the new row has
// another base, the moved cards start unjudged there (the earlier judgement kept in the card's note), as in a merge.
/** @param {any} project @param {string} srcId @param {string[]} secIds @param {any} newRow @param {any} [helpers] */
function planSplitRow(project, srcId, secIds, newRow, helpers) {
  const H = rowPlanHelpers(project, helpers);
  const src = (project.clusters || []).find(c => c.id === srcId);
  if (!src) return null;
  const secs0 = rowSecsIn(project, src.id).filter(s => secIds.includes(s.id));
  if (!secs0.length) return null;
  const srcTitle = H.rowTitle(src);
  const nw = { ...newRow, historyFrom: [src.id, ...(src.historyFrom || [])] };
  const ids = [src.id, nw.id];
  const beforeAnns = secs0.map(a => annRowState(a, ids));
  const srcBase = rowBaseIn(project, src);
  nw.baseDocId = src.baseDocId === null ? null : secs0.some(s => s.docId === srcBase) ? srcBase : secs0[0].docId;
  const newBase = rowBaseIn(project, nw);
  const baseChanges = src.baseDocId !== null && newBase !== srcBase;
  const baseName = id => (id && H.docName(id)) || 'the row as a whole (no single base)';
  const rel = r => H.relLabel(r);
  const rejudge = [];
  // Every card of the study that established the row moves: the row keeps its base, but the reviewer is told
  const baseGone = !!srcBase && !rowSecsIn(project, src.id).some(s => s.docId === srcBase && !secIds.includes(s.id));
  /** @type {{ store: string, put?: any, del?: any }[]} */ const ops = [];
  const secs = secs0.map(copyForRows);
  for (const s of secs) {
    const rs = relationIn(project, s, src.id); // read before the card leaves the row
    const from = takeOutOfRow(s, src.id);
    const judged = rs !== 'unjudged' && rs !== 'baseline';
    const asNote = text => carryText(from.clusterComments || '', text, srcTitle);
    let next;
    if (baseChanges && rs !== 'unjudged' && s.docId !== newBase) {
      rejudge.push(`${H.docName(s.docId) || 'Study'} (p.${s.page})`);
      next = { clusterComments: asNote(rs === 'baseline' ? `established that row; to judge against ${baseName(newBase)}` : `judged ${rel(rs)} against ${baseName(srcBase)} there; to judge again against ${baseName(newBase)}`) };
    } else if (baseChanges && s.docId === newBase) {
      next = { clusterComments: (judged ? asNote(`judged ${rel(rs)} against ${baseName(srcBase)} there; establishes the new row`) : from.clusterComments) || undefined };
    } else {
      next = from; // same base: the judgement, note and (with a ◇ judgement) line-of-argument mark carry over
    }
    putIntoRow(s, nw.id, next);
    ops.push({ store: 'annotations', put: s });
  }
  const order = (project.clusters || []).filter(c => c.id !== nw.id);
  order.splice(order.findIndex(c => c.id === src.id) + 1, 0, nw);
  order.forEach((c, i) => ops.push({ store: 'clusters', put: c === nw ? Object.assign(nw, { order: i }) : { ...c, order: i } }));
  return { ops, newRow: nw, before: { anns: beforeAnns }, after: { anns: secs.map(a => annRowState(a, ids)) }, rejudge, srcTitle,
    srcBaseName: baseName(srcBase), newBaseName: baseName(newBase), baseGone: baseGone ? (H.docName(srcBase) || '') : '' };
}

// ---- Undo of a row merge / split (undo-audit.js): put back what it changed and is still as it left it ----
// Worked out from the project without changing it; the caller tidies (tidyRefsOps) and writes the ops (commitOps). Later work
// is kept, and named in kept. entry: the undo entry the merge / split pushed (before / after of the cards' places, the rows'
// fields, the map relations).
const sameJ = (x, y) => JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y);
const rowOrderKey = c => c.order ?? c.createdAt ?? 0;
// The rows / studies of a list in their stored order (sorted in place, as at startup). Returns the list.
/** @param {any[]} list */
function sortRows(list) { return list.sort((x, y) => rowOrderKey(x) - rowOrderKey(y)); }
/** @param {any[]} list */
function sortStudies(list) { return list.sort((x, y) => (x.order ?? 999) - (y.order ?? 999)); }
// The writes that number the rows by their place in the list (only the rows whose number changes; copies)
/** @param {any[]} list @returns {DbOp[]} */
function rowOrderOps(list) { return list.flatMap((c, i) => c.order === i ? [] : [{ store: 'clusters', put: { ...c, order: i } }]); }
// The cards' places in the two rows; returns the cards' copies (and fills kept)
function revertRowCards(project, entry, ids, kept, splitBasesDiffer) {
  const isSplit = entry.type === 'row_split';
  const what = k => k === 'clusterRelations' ? 'a judgement' : k === 'clusterComments' ? 'a cell note' : 'a line-of-argument mark';
  const out = [];
  (entry.before.anns || []).forEach((b, i) => {
    const af = entry.after.anns[i];
    const orig = (project.annotations || []).find(x => x.id === b.id && x.type === 'second_order'); // not one switched to a quote since
    if (!orig || !af) return;
    const a = { ...orig, clusterIds: [...(orig.clusterIds || [])] };
    ids.forEach((rid, j) => {
      const nowIn = a.clusterIds.includes(rid);
      if (nowIn === af.member[j] && nowIn !== b.member[j]) a.clusterIds = b.member[j] ? [...a.clusterIds, rid] : a.clusterIds.filter(x => x !== rid);
    });
    ANNOTATION_ROW_FIELDS.forEach((k, ki) => ids.forEach((rid, j) => {
      const cur = (a[k] || {})[rid];
      if (sameJ(cur, af.keys[ki][j])) {
        if (b.keys[ki][j] === undefined) { if (a[k] && rid in a[k]) { a[k] = { ...a[k] }; delete a[k][rid]; } }
        else a[k] = { ...(a[k] || {}), [rid]: b.keys[ki][j] };
      } else if (isSplit && rid === entry.newId) {
        // Changed in the split-off row after the split: that row goes. The newer reading moves to the original row, unless the
        // original row has its own reading made since (kept; a note is added), or the two rows have different bases: a
        // judgement against another base, and the line-of-argument mark that goes with it, are not carried
        a[k] = { ...(a[k] || {}) };
        const srcIsAsBefore = sameJ(a[k][entry.srcId], b.keys[ki][0]);
        if ((k === 'clusterRelations' || k === 'aspectUsedInLoa') && splitBasesDiffer) {
          if (cur !== undefined) kept.push(`${what(k)} on p.${a.page} made in the split-off row against another base, not carried (the original row keeps its own)`);
        } else if (srcIsAsBefore) {
          if (cur === undefined) delete a[k][entry.srcId]; else a[k][entry.srcId] = cur;
          kept.push(`${what(k)} on p.${a.page} made in the split-off row, now in the original row`);
        } else if (k === 'clusterComments' && cur) {
          a[k][entry.srcId] = `${a[k][entry.srcId] ? a[k][entry.srcId] + '\n\n' : ''}[From the split-off row] ${cur}`;
          kept.push(`a cell note on p.${a.page} made in the split-off row, added to the one in the original row`);
        } else {
          kept.push(`${what(k)} on p.${a.page} made in the split-off row, not carried: the original row has its own`);
        }
        delete a[k][rid];
      } else if (!sameJ(cur, b.keys[ki][j])) kept.push(`${what(k)} on p.${a.page}`);
    }));
    out.push(a);
  });
  return out;
}
// Rows as they will be written: copies, what placing the cards does there (applyPlacementToRow), numbered again in order
function renumberedRowOps(rows, cards) {
  const copies = new Map(rows.map(r => [r.id, { ...r }]));
  cards.forEach(a => (a.clusterIds || []).forEach(id => { const r = copies.get(id); if (r) applyPlacementToRow(r, a.docId); }));
  return [...copies.values()].sort((x, y) => rowOrderKey(x) - rowOrderKey(y)).map((r, i) => ({ store: 'clusters', put: Object.assign(r, { order: i }) }));
}
/** @param {any} project @param {any} entry */
function planUndoRowMerge(project, entry) {
  const ids = [entry.srcId, entry.tgtId], kept = [];
  const cards = revertRowCards(project, entry, ids, kept, false);
  const rows = (project.clusters || []).map(c => {
    if (c.id !== entry.tgtId) return c;
    const t = { ...c };
    Object.keys(entry.before.tgt).forEach(f => {
      if (sameJ(t[f], entry.after.tgt[f])) { if (entry.before.tgt[f] === undefined) delete t[f]; else t[f] = deepCopy(entry.before.tgt[f]); }
      else kept.push(`"${f}" of the merged row`);
    });
    return t;
  });
  if (!rows.some(c => c.id === entry.srcId)) rows.push(deepCopy(entry.before.src)); // the source row takes its old place
  // Map relations: back to before, plus any added since, minus any removed since; never one to a row that is gone
  const loa = project.loa || {};
  const nowLinks = loa.links || [];
  const nowIds = new Set(nowLinks.map(l => l.id)), afterIds = new Set((entry.after.links || []).map(l => l.id));
  const added = nowLinks.filter(l => !afterIds.has(l.id));
  const removedSince = new Set([...afterIds].filter(id => !nowIds.has(id)));
  if (added.length) kept.push(`${added.length} concept-map relation(s) added since`);
  if (removedSince.size) kept.push(`${removedSince.size} concept-map relation(s) removed since`);
  const links = liveRowLinks([...(entry.before.links || []).filter(l => !removedSince.has(l.id)), ...added], new Set(rows.map(c => c.id)));
  return { ops: [...cards.map(a => ({ store: 'annotations', put: a })), ...renumberedRowOps(rows, cards), { store: 'meta', put: { ...loa, id: 'loa_main', links } }], kept: [...new Set(kept)] };
}
// Only the row the split created goes; every other row (including rows added since) stays. What was put into that row after
// the split is not lost: its cards go to the original row (a judgement against another base, and its mark, stay behind), its
// texts and empty-cell records are added there, and its map relations follow it.
/** @param {any} project @param {any} entry @param {any} [helpers] */
function planUndoRowSplit(project, entry, helpers) {
  const H = rowPlanHelpers(project, helpers);
  const ids = [entry.srcId, entry.newId], kept = [];
  const nw = (project.clusters || []).find(c => c.id === entry.newId);
  const src0 = (project.clusters || []).find(c => c.id === entry.srcId);
  const splitBasesDiffer = !!(nw && src0 && rowBaseIn(project, nw) !== rowBaseIn(project, src0));
  const cards = revertRowCards(project, entry, ids, kept, splitBasesDiffer);
  const cardOf = new Map(cards.map(a => [a.id, a]));
  let srcRow = src0 ? { ...src0 } : null;
  let loa = project.loa || {}, loaChanged = false;
  if (nw && srcRow) {
    const nwTitle = H.rowTitle(nw);
    (project.annotations || []).filter(x => x.type === 'second_order' && (x.clusterIds || []).includes(nw.id)).forEach(x => {
      const a = cardOf.get(x.id) || { ...x, clusterIds: [...x.clusterIds] };
      if (!(a.clusterIds || []).includes(nw.id)) return;
      const had = takeOutOfRow(a, nw.id);
      if (splitBasesDiffer) { delete had.clusterRelations; delete had.aspectUsedInLoa; } // a reading against the split-off row's base stays behind
      putIntoRow(a, srcRow.id, { ...had, ...rowFieldsOf(a, srcRow.id) }); // what it has in the original row already is kept
      if (!cardOf.has(a.id)) { cardOf.set(a.id, a); cards.push(a); }
      kept.push(`a card placed in "${nwTitle}" after the split (p.${a.page}), now in the original row`);
    });
    let carried = false;
    ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation'].forEach(f => {
      if ((nw[f] || '').trim()) { srcRow[f] = carryText(srcRow[f], nw[f], nwTitle); carried = true; }
    });
    if (carried) kept.push(`the texts written in "${nwTitle}", added to the original row`);
    let cellsCarried = 0;
    const hasCard = docId => [...cardOf.values(), ...(project.annotations || []).filter(x => !cardOf.has(x.id))]
      .some(x => x.type === 'second_order' && x.docId === docId && (x.clusterIds || []).includes(srcRow.id));
    Object.entries(nw.cellStatus || {}).forEach(([docId, v]) => {
      if ((srcRow.cellStatus && srcRow.cellStatus[docId]) || hasCard(docId)) return;
      srcRow.cellStatus = { ...(srcRow.cellStatus || {}), [docId]: v }; cellsCarried++;
    });
    if (cellsCarried) kept.push(`${cellsCarried} empty-cell note(s) of "${nwTitle}", now in the original row`);
    if ((loa.links || []).some(l => l.from === nw.id || l.to === nw.id)) {
      loa = { ...loa, links: moveRowLinks(loa.links, nw.id, srcRow.id) }; loaChanged = true;
      kept.push(`concept-map relations of "${nwTitle}", moved to the original row`);
    }
  }
  const rows = (project.clusters || []).filter(c => c.id !== entry.newId).map(c => (srcRow && c.id === srcRow.id ? srcRow : c));
  /** @type {{ store: string, put?: any, del?: any }[]} */
  const ops = [...cards.map(a => ({ store: 'annotations', put: a })), ...renumberedRowOps(rows, cards)];
  if (loaChanged) ops.push({ store: 'meta', put: loa });
  ops.push({ store: 'clusters', del: entry.newId });
  return { ops, kept: [...new Set(kept)] };
}

// ======================= Merge of a backup into the open project (backup.js) =======================
// Empty at every depth: an object counts as empty when all of its values are (e.g. appraisalItems { CASP: {} }, which the app
// creates as soon as a study's appraisal is looked at)
function isEmptyValue(v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).every(k => isEmptyValue(v[k]));
  return false;
}
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Lists of separate records (relations, team models, within-study links, set-aside items) are merged as a union: what is only
// in the backup is added, a record in both (same key) keeps the local version. Key per list field:
function unionItemContent(k, x) {
  if (k !== 'links' && k !== 'conceptLinks') return stableJson(x);
  const { id, from, to, ...rest } = x; // (id, from and to are in the key)
  return stableJson(rest);
}
function relationKey(x) {
  if (!x.from || !x.to) return 'id:' + x.id; // not a complete relation: only its id can tell it apart
  const pair = isDirectedLink(x.type) ? `${x.from}|${x.to}` : [x.from, x.to].sort().join('|');
  return `${pair}|${x.type}`;
}
const MERGE_UNION_KEYS = {
  // A relation is the same relation when it joins the same two items in the same way, whatever id each side gave it
  // (two reviewers drawing A ➔ B each make their own id); for one without direction, A–B and B–A are the same
  links: x => relationKey(x),
  conceptLinks: x => relationKey(x),
  teamModels: x => x.id || [x.reviewer, x.title, x.capturedAt].join('|'),
  peerSetAside: x => [x.peerId, x.reviewer, x.textKey].join('|')
};
// Copy fields from `incoming` into `local` only where `local` is empty; report fields that differ
// Keys that would change an object's prototype instead of a field (a JSON file from someone else can contain them)
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function mergeFillEmpty(local, incoming, skip = []) {
  const filled = [], conflicts = [];
  Object.keys(incoming || {}).forEach(k => {
    if (UNSAFE_KEYS.has(k) || skip.includes(k) || isEmptyValue(incoming[k])) return;
    if (MERGE_UNION_KEYS[k] && Array.isArray(incoming[k]) && Array.isArray(local[k])) {
      const keyOf = MERGE_UNION_KEYS[k], have = new Map(local[k].filter(Boolean).map(x => [keyOf(x), x]));
      // Each new item once, even if the file lists it twice
      const add = [], seen = new Set();
      incoming[k].forEach(x => { if (x && !have.has(keyOf(x)) && !seen.has(keyOf(x))) { seen.add(keyOf(x)); add.push(x); } });
      if (add.length) { local[k] = [...local[k], ...add]; filled.push(k); }
      // The same item on both sides with other content (e.g. a relation's note edited elsewhere): the local one stays, and it is
      // listed as a conflict, so the difference is seen. What the key already says (a relation's ends, and the id each side
      // gave it) is not a difference.
      if (incoming[k].some(x => x && have.has(keyOf(x)) && unionItemContent(k, have.get(keyOf(x))) !== unionItemContent(k, x))) conflicts.push(k);
      return;
    }
    if (isEmptyValue(local[k])) { local[k] = incoming[k]; filled.push(k); }
    else if (isPlainObject(local[k]) && isPlainObject(incoming[k])) {
      // Both have something (e.g. answers to some appraisal questions each): fill what is empty here, one level down
      const r = mergeFillEmpty(local[k], incoming[k]);
      if (r.filled.length) filled.push(k);
      r.conflicts.forEach(c => conflicts.push(`${k}.${c}`));
    }
    else if (stableJson(local[k]) !== stableJson(incoming[k])) conflicts.push(k); // same content in another key order is no conflict
  });
  return { filled, conflicts };
}
// Same item on both sides with different content: texts that are empty here are filled from the backup (a note or a Step B
// written on another computer); placements, judgements and ratings are not, since an empty value may be a decision made here.
const MERGE_FILL_TEXT = {
  annotations: ['note', 'nuanceNote', 'concordanceNote', 'notTranslatedNote'],
  clusters: ['thirdOrderTitle', 'translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation', 'cerqualLimNote', 'cerqualCohNote', 'cerqualAdeqNote', 'cerqualRelNote']
};
function mergeFillTexts(local, incoming, fields) {
  const filled = [];
  fields.forEach(k => {
    const v = incoming[k];
    if (typeof v === 'string' && v.trim() && !(typeof local[k] === 'string' && local[k].trim())) { local[k] = v; filled.push(k); }
  });
  return filled;
}
// As JSON.stringify would write it (a key whose value is undefined is left out, undefined in a list is null), with the keys
// sorted: a record read back from a file then equals the same record in memory
function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(x => x === undefined || typeof x === 'function' ? 'null' : stableJson(x)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function sameRecord(a, b) { return stableJson(a) === stableJson(b); }

// ======================= Similarity of two readers' extracts (compare.js) =======================
function computeTextSimilarity(strA, strB) {
  const clean = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = clean(strA);
  const b = clean(strB);
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) {
    // One selection inside the other: the same passage, read with a shorter or longer span. Only when the shorter one is a
    // passage of its own (8+ words, or 40% of the longer): a short phrase occurs in many unrelated quotes.
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    const shorter = a.length <= b.length ? a : b;
    const shortWords = shorter.split(/\s+/).length;
    const unspaced = shortWords === 1 && minLen >= 20; // Japanese / Chinese text has no spaces: count characters instead
    if (minLen > 12 && (shortWords >= 8 || unspaced || minLen / maxLen >= 0.4)) return Math.max(0.78, minLen / maxLen);
  }
  // Word token overlap (including 2-char clinical/regional abbreviations like RN, UK, IV, ED)
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length >= 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length >= 2));
  let wordScore = 0;
  if (wordsA.size > 0 && wordsB.size > 0) {
    let inter = 0;
    wordsA.forEach(w => { if (wordsB.has(w)) inter++; });
    // Dice, like the bigrams. The overlap with the shorter passage (inter / min) is used only when that passage is long
    // enough to mean something: two readers selecting overlapping stretches of the same paragraph should still pair, but a
    // two-word fragment ("moral distress") must not "match" any long quote that happens to contain both words.
    const minSize = Math.min(wordsA.size, wordsB.size);
    const dice = (2 * inter) / (wordsA.size + wordsB.size);
    wordScore = minSize >= 8 ? Math.max(dice, inter / minSize) : dice;
  }
  // Character bigram overlap (handles CJK/Japanese text without spaces and minor OCR/hyphenation diffs)
  const noSpaceA = a.replace(/\s+/g, '');
  const noSpaceB = b.replace(/\s+/g, '');
  let bigramScore = 0;
  if (noSpaceA.length >= 2 && noSpaceB.length >= 2) {
    const bgA = new Set();
    const bgB = new Set();
    for (let i = 0; i < noSpaceA.length - 1; i++) bgA.add(noSpaceA.slice(i, i + 2));
    for (let i = 0; i < noSpaceB.length - 1; i++) bgB.add(noSpaceB.slice(i, i + 2));
    let bgInter = 0;
    bgA.forEach(g => { if (bgB.has(g)) bgInter++; });
    // Dice coefficient: normalising by the shorter string alone let short fragments "match" unrelated long quotes
    bigramScore = (2 * bgInter) / (bgA.size + bgB.size);
  }
  return Math.max(wordScore, bigramScore);
}

// ======================= Line-of-argument map (loa.js) =======================
// Relations with a direction (A → B); the others are symmetric. Not every line of argument is a causal flow:
// themes can also nest in one another (encompasses) or be read through a metaphor.
const DIRECTED_LINK_TYPES = ['leads', 'encompasses', 'metaphor'];
function isDirectedLink(type) { return DIRECTED_LINK_TYPES.includes(type); }
// Several relations between the same two constructs (e.g. A ➔ B and A ⚡ B) are drawn side by side, not on top of each other:
// each gets an offset across the line between them (0 when it is the only one). Keyed by link id.
function linkPairOffsets(links, step = 22) {
  const groups = {};
  links.forEach(l => { const k = [l.from, l.to].sort().join('|'); (groups[k] = groups[k] || []).push(l); });
  const off = {};
  Object.values(groups).forEach(g => g.forEach((l, i) => {
    // Measured against the pair's sorted direction, so A→B and B→A also part
    const sign = [l.from, l.to].sort()[0] === l.from ? 1 : -1;
    off[l.id] = (i - (g.length - 1) / 2) * step * sign;
  }));
  return off;
}
// Columns of the left → right map: each construct's column is the longest chain of directed relations leading to it
// (cycles are broken for the ranking only); constructs joined only by ⇄ / ⚡ sit in their partner's column.
// ids: the constructs in the map; links: { id, from, to, type }. Returns { rank: { id: column }, leads: the directed links }.
function flowColumnRanks(ids, links) {
  // Every directed relation (leads to, encompasses, is understood through) sets the columns, left to right; a model built only
  // of ⊃ or ≈ would otherwise stack every construct in one column
  const leads = links.filter(l => isDirectedLink(l.type));
  // Drop back-edges (cycles) for ranking only
  const out = {}; ids.forEach(id => out[id] = []);
  const state3 = {}; const forward = new Set();
  leads.forEach(l => out[l.from].push(l));
  const dfs = id => {
    state3[id] = 1;
    out[id].forEach(l => {
      if (state3[l.to] === 1) return;           // back-edge
      forward.add(l.id);
      if (!state3[l.to]) dfs(l.to);
    });
    state3[id] = 2;
  };
  const hasIncoming = new Set(leads.map(l => l.to));
  [...ids.filter(id => !hasIncoming.has(id)), ...ids].forEach(id => { if (!state3[id]) dfs(id); });
  const rank = {}; ids.forEach(id => rank[id] = 0);
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    leads.filter(l => forward.has(l.id)).forEach(l => { if (rank[l.to] < rank[l.from] + 1) { rank[l.to] = rank[l.from] + 1; changed = true; } });
    if (!changed) break;
  }
  // Constructs joined only by ⇄ / ⚡ sit in the same column as their partner, along a chain of any length (A → B ⇄ C ⇄ D)
  const placed = new Set(leads.flatMap(l => [l.from, l.to]));
  const loose = links.filter(l => !isDirectedLink(l.type));
  for (let moved = true; moved;) {
    moved = false;
    loose.forEach(l => {
      if (!placed.has(l.from) && placed.has(l.to)) { rank[l.from] = rank[l.to]; placed.add(l.from); moved = true; }
      else if (!placed.has(l.to) && placed.has(l.from)) { rank[l.to] = rank[l.from]; placed.add(l.to); moved = true; }
    });
  }
  return { rank, leads };
}

// ======================= Text from PDFs and citations (studies-pdf.js) =======================
// Chinese / Japanese text has no spaces between words: where two text items meet between such characters, nothing is added
const CJK_CHAR = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
function joinSeparator(prev, next) {
  return CJK_CHAR.test(String(prev).slice(-1)) && CJK_CHAR.test(String(next).charAt(0)) ? '' : ' ';
}
function joinTextItems(strs) {
  let out = '';
  strs.forEach(t => { if (!t) return; out += (out ? joinSeparator(out, t) : '') + t; });
  return out;
}
// Lower-case particles that belong to a surname written after the given name (case-sensitive: "Van" at the start is a name)
const SURNAME_PARTICLES = new Set(['de', 'del', 'della', 'der', 'den', 'des', 'di', 'da', 'das', 'do', 'dos', 'du', 'la', 'le', 'van', 'von', 'ten', 'ter', 'zu']);
function extractSurnameFromAuthorString(rawAuthor) {
  if (!rawAuthor) return { surname: '', hasEtAl: true };
  const cleaned = String(rawAuthor)
    .replace(/[\d*†‡§¶✉]/g, '')
    .replace(/\b(MD|PhD|RN|PharmD|MSc|MPH|BSc|Prof|Dr)\b\.?/gi, '')
    // a title removed leaves an empty piece between commas ("Smith, John, PhD" -> "Smith, John,"): it is not another author
    .replace(/,(\s*,)+/g, ',').replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
  // Chinese / Japanese names put the family name first ("山田 太郎"), and authors are separated by 、 ， or ・: take the first
  // token of the first author; a name written without a space is kept whole (family and given name cannot be told apart)
  if (CJK_CHAR.test(cleaned)) {
    const authors = cleaned.split(/[、，,;・／/]|\band\b|&/).map(x => x.trim()).filter(Boolean);
    const first = authors[0] || '';
    return { surname: first.split(/[\s\u3000]+/)[0], hasEtAl: authors.length > 1 };
  }
  const multiAuthors = /;|,|\band\b|&/i.test(cleaned);
  const firstChunk = cleaned.split(/;|\band\b|&/i)[0].trim();
  if (firstChunk.includes(',')) {
    // "Surname, GivenName" format
    const surname = firstChunk.split(',')[0].trim().replace(/\s+[A-Z]{1,3}\.?$/, ''); // "Hernandez M" -> "Hernandez"
    // "Smith, John" is one author (its comma separates surname and given name): another author shows as ; / and / &, or a
    // further comma ("Smith, J, Lee, K")
    return { surname, hasEtAl: /;|\band\b|&/i.test(cleaned) || cleaned.split(',').length > 2 };
  }
  const parts = firstChunk.split(/\s+/).filter(Boolean);
  // Vancouver style ("Hamdan A", "De la Cruz M"): trailing initials -> the surname is everything before them
  const initialsLast = parts.length > 1 && /^[A-Z]{1,3}\.?$/.test(parts[parts.length - 1]);
  if (initialsLast) return { surname: parts.slice(0, -1).join(' '), hasEtAl: multiAuthors };
  // "Given Surname": the last word, with the lower-case particles before it ("Juan de la Cruz" -> "de la Cruz")
  let from = parts.length - 1;
  while (from > 1 && SURNAME_PARTICLES.has(parts[from - 1])) from--;
  return { surname: from >= 0 ? parts.slice(from).join(' ') : '', hasEtAl: multiAuthors };
}

// Publication years 1940–2039 (classic qualitative studies of the 1960s and 1970s included), one pattern for every stage
const YEAR_CORE = '19[4-9]\\d|20[0-3]\\d';
const YEAR_RE = new RegExp('(?:^|\\D)(' + YEAR_CORE + ')(?!\\d)');
// Year of a date in PDF metadata: ISO / XMP dates ("2021-03-01") and the PDF Info form ("D:20210301120000", where more
// digits follow the year, so YEAR_RE alone would not find it)
function yearFromPdfDate(raw) {
  const s = String(raw || '').trim();
  const pdf = s.match(new RegExp('^D:(' + YEAR_CORE + ')'));
  if (pdf) return pdf[1];
  const m = s.match(YEAR_RE);
  return m ? m[1] : '';
}
