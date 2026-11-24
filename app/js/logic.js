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
  undo_extraction: { routine: true }
};
['quote_link', 'quote_unlink', 'order_switch', 'wrap', 'label_source', 'construct_label', 'place', 'unplace', 'passage_add', 'passage_absorb',
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

// ======================= Study ids from another file (backup.js merge, compare.js) =======================
// Another reviewer's file, or a backup, can call a study by another id. Every place a 3rd Order row names a study goes
// through here, so none is forgotten: its base (◆), its empty-cell records (keyed by study) and the re-reading note after
// study #1 changed. toLocal(id) gives this project's id (or the same id). Returns a new row object; an empty id stays as is.
function remapRowDocIds(row, toLocal) {
  const map = id => (id ? toLocal(id) || id : id);
  const out = { ...row };
  if ('baseDocId' in out) out.baseDocId = map(out.baseDocId);
  if (out.cellStatus && typeof out.cellStatus === 'object') {
    const cs = {};
    Object.keys(out.cellStatus).forEach(id => { cs[map(id)] = out.cellStatus[id]; });
    out.cellStatus = cs;
  }
  if (out.baselineChange && typeof out.baselineChange === 'object') {
    out.baselineChange = { ...out.baselineChange, fromDocId: map(out.baselineChange.fromDocId), toDocId: map(out.baselineChange.toDocId) };
  }
  return out;
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
