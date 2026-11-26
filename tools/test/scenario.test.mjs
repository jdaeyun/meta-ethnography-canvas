// Scenario tests of the project's data rules, in Node without a browser (`npm run test:unit`, also run by `npm test`).
// app/js/logic.js holds the pure part of each change that touches several records (placing a construct, judging it, merging
// and splitting rows, deleting a row or a construct, Undo of a change, applying written ops to the project). Here those steps
// are chained on a small project, as a reviewer would chain them, and checkInvariants() runs after every step: a step that
// leaves a record pointing at something gone fails where it happens. Fixed scenarios check what each step means; seeded
// random walks (the seed is in the test name, so a failure can be replayed) find the combinations nobody thought of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/logic.js'), 'utf8'), ctx, { filename: 'app/js/logic.js' });
const L = vm.runInContext(`({ applyOps, checkInvariants, planMergeRows, planSplitRow, planUndoRowMerge, planUndoRowSplit, purgeDocRefs, purgeClusterRefs, rowDeletionOps, revertChange, tidyRefsOps, recordOf,
  putIntoRow, takeOutOfRow, relationIn, rowSecsIn, stableJson, opPlace, opUnplace, opJudge, opEmptyCellStatus, opEmptyCellNote, opSetRowBase,
  opRereadRow, opRowTeamStatus, opRowCerqual, opConfirmSeed, opMoveRow, opNotTranslated, opLinkQuote, opUnlinkQuote, opDeleteConstruct, opDeleteQuote,
  opAddConceptLink, opRemoveConceptLink, opAddPassage, opRemovePassage, opExtractedText, opConstructTeamStatus, opLabelSource, opWrapQuote })`, ctx);
// The names an operation's entries need (the app passes study names and judgement labels: OP_NAMES, undo-audit.js)
const H = { docName: id => `Study ${id}`, relLabel: r => `● ${r}` };
// An operation of logic.js, run as the app runs it (runOperation): its ops applied; null = nothing to do. Returns the result.
const run = (p, result) => { if (result) L.applyOps(p, result.ops); return result; };
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const plain = clone;

// ---- A small project: 3 studies, 3 constructs and a quote each, 3 rows established by study d1, two map relations ----
function makeProject() {
  const docs = ['d1', 'd2', 'd3'].map((id, i) => ({ id, name: id, order: i, conceptLinks: [] }));
  const annotations = [];
  docs.forEach(d => {
    for (let i = 1; i <= 3; i++) annotations.push({ id: `s_${d.id}_${i}`, docId: d.id, type: 'second_order', page: String(i), text: `${d.id} construct ${i}`, note: '', clusterIds: [], clusterRelations: {}, clusterComments: {}, passages: [] });
    annotations.push({ id: `q_${d.id}`, docId: d.id, type: 'first_order', page: '1', text: `${d.id} quote`, parentIds: [`s_${d.id}_1`] });
  });
  docs[1].conceptLinks = [{ id: 'k1', from: 's_d2_1', to: 's_d2_2', type: 'leads' }];
  const clusters = [1, 2, 3].map(i => ({ id: `r${i}`, thirdOrderTitle: `Row ${i}`, order: i - 1, baseDocId: 'd1', cellStatus: {}, historyFrom: [], translationSummary: `A${i}`, synthesisNote: `B${i}` }));
  clusters[0].cellStatus = { d3: { status: 'absent', note: 'checked' } };
  const loa = { id: 'loa_main', links: [{ id: 'm1', from: 'r1', to: 'r2', type: 'leads' }, { id: 'm2', from: 'r2', to: 'r3', type: 'reciprocal' }] };
  const p = { docs, annotations, clusters, logs: [], loa };
  // Study d1's constructs establish the three rows
  [1, 2, 3].forEach(i => place(p, `s_d1_${i}`, `r${i}`));
  return p;
}
const sec = (p, id) => p.annotations.find(a => a.id === id);
const row = (p, id) => p.clusters.find(c => c.id === id);
const assertConsistent = (p, step) => assert.deepEqual(plain(L.checkInvariants(p)), [], `after ${step}`);
// Written as the app writes: the ops are tidied (placing in a row does what placing does) and applied to the project
const write = (p, ops) => { L.applyOps(p, L.tidyRefsOps(p, ops).ops); };

// ---- Steps (each one as the app does it, on copies, then written) ----
// (the app's own operations: opPlace / opJudge … in logic.js)
function place(p, sid, rid) { run(p, L.opPlace(p, { secId: sid, rowId: rid }, H)); }
function judge(p, sid, rid, rel) {
  run(p, L.opJudge(p, { secId: sid, rowId: rid, rel }, H));
  // A ◇ the line of argument draws on (the tick in the drawer)
  if (rel === 'other_aspect' && L.relationIn(p, sec(p, sid), rid) === 'other_aspect') {
    const s = clone(sec(p, sid)); s.aspectUsedInLoa = { ...(s.aspectUsedInLoa || {}), [rid]: true }; L.applyOps(p, [{ store: 'annotations', put: s }]);
  }
}
// (the app keeps state.clusters in the rows' order after each write: so does this)
const sortRows = p => { p.clusters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); };
const merge = (p, src, tgt) => { const plan = L.planMergeRows(p, src, tgt); L.applyOps(p, plan.ops); sortRows(p); return plan; };
const split = (p, src, secIds, nid) => { const plan = L.planSplitRow(p, src, secIds, { id: nid, thirdOrderTitle: 'Split', baseDocId: '', cellStatus: {}, historyFrom: [] }); L.applyOps(p, plan.ops); sortRows(p); return plan; };
// An undoable change, recorded as the app records it (beginChange / finishChange in undo-audit.js)
function recorded(p, keys, run, created = []) {
  const records = keys.map(({ store, id }) => ({ store, id, before: clone(L.recordOf(p, store, id)) ?? null }));
  run();
  created.forEach(k => records.push({ ...k, before: null }));
  records.forEach(r => { r.after = clone(L.recordOf(p, r.store, r.id)) ?? null; });
  return { records };
}
function deleteRow(p, rid) {
  const { ops, row: was } = L.rowDeletionOps(p, rid);
  const keys = ops.filter(o => !(o.store === 'clusters' && !('del' in o))).map(o => ({ store: o.store, id: 'del' in o ? o.del : o.put.id }));
  const ch = recorded(p, keys, () => L.applyOps(p, ops));
  ch.records.find(r => r.store === 'clusters' && r.id === rid).before = clone(was); // (beginChange's `before`, as matrix.js gives it)
  return ch;
}
function unplace(p, sid, rid) {
  return recorded(p, [{ store: 'annotations', id: sid }], () => run(p, L.opUnplace(p, { secId: sid, rowId: rid }, H)));
}
function deleteConstruct(p, sid) {
  const s = sec(p, sid);
  const quotes = p.annotations.filter(a => a.type === 'first_order' && (a.parentIds || []).includes(sid));
  const doc = p.docs.find(d => d.id === s.docId);
  const keys = [{ store: 'annotations', id: sid }, ...quotes.map(q => ({ store: 'annotations', id: q.id })), { store: 'docs', id: doc.id }];
  return recorded(p, keys, () => run(p, L.opDeleteConstruct(p, { secId: sid }, H)));
}
// A construct made (as splitting a passage off makes one): undoing it deletes it
function addConstruct(p, docId, id) {
  return recorded(p, [], () => L.applyOps(p, [{ store: 'annotations', put: { id, docId, type: 'second_order', page: '9', text: `made ${id}`, note: '', clusterIds: [], clusterRelations: {}, clusterComments: {}, passages: [] } }]),
    [{ store: 'annotations', id }]);
}
function linkQuote(p, qid, sid) { run(p, L.opLinkQuote(p, { quoteId: qid, secId: sid }, H)); }
function relate(p, docId, from, to) {
  run(p, L.opAddConceptLink(p, { docId, link: { id: `k_${from}_${to}_${Math.random().toString(36).slice(2, 6)}`, from, to, type: 'leads' }, text: `${from} → ${to}` }, H));
}
function markEmpty(p, rid, docId, status = 'absent') { run(p, L.opEmptyCellStatus(p, { rowId: rid, docId, status }, H)); }
// A row merge / split as the app records it for Undo (matrix.js), and its Undo (undo-audit.js)
const mergeStep = (p, src, tgt) => { const plan = merge(p, src, tgt); return { type: 'row_merge', srcId: src, tgtId: tgt, before: plan.before, after: plan.after }; };
const splitStep = (p, src, ids, nid) => { const plan = split(p, src, ids, nid); return { type: 'row_split', srcId: src, newId: nid, before: plan.before, after: plan.after }; };
// A study removed with what names it (studies-pdf.js; its Undo also brings back the PDF, so it is tested in the browser)
function deleteStudy(p, docId) {
  const refs = L.purgeDocRefs(p, docId);
  L.applyOps(p, [{ store: 'docs', del: docId }, ...p.annotations.filter(a => a.docId === docId).map(a => ({ store: 'annotations', del: a.id })), ...refs.ops]);
}
function undo(p, change) {
  if (change.type === 'row_merge' || change.type === 'row_split') {
    const plan = change.type === 'row_merge' ? L.planUndoRowMerge(p, change) : L.planUndoRowSplit(p, change);
    const t = L.tidyRefsOps(p, plan.ops);
    L.applyOps(p, t.ops); sortRows(p);
    return { kept: plain(plan.kept), dropped: plain(t.dropped) };
  }
  const { ops, kept } = L.revertChange(change, p);
  const t = L.tidyRefsOps(p, ops);
  L.applyOps(p, t.ops); sortRows(p); // (a row brought back goes to its place, as undo-audit.js does)
  return { kept: plain(kept), dropped: plain(t.dropped) };
}
// The project's meaning, independent of list order and object identity
const meaning = p => L.stableJson({
  docs: [...p.docs].sort((a, b) => a.id.localeCompare(b.id)),
  annotations: [...p.annotations].sort((a, b) => a.id.localeCompare(b.id)).map(a => ({ ...a, clusterIds: [...(a.clusterIds || [])].sort(), parentIds: a.parentIds && [...a.parentIds].sort() })),
  // (rows by their place in the list, as the app shows them, not by the number: Undo of a merge / split numbers them 0, 1, 2 …
  // again, and two rows can share a number, e.g. a row made after another was deleted)
  clusters: p.clusters.map((c, i) => ({ ...c, order: i })).sort((a, b) => a.id.localeCompare(b.id)),
  links: [...(p.loa.links || [])].sort((a, b) => a.id.localeCompare(b.id))
});

test('scenario: place, judge, merge, split — what each step means for bases, judgements and notes', () => {
  const p = makeProject();
  assertConsistent(p, 'setup');
  assert.equal(L.relationIn(p, sec(p, 's_d1_1'), 'r1'), 'baseline', 'the study that established the row is its base (◆)');
  place(p, 's_d2_1', 'r1'); assertConsistent(p, 'place');
  assert.equal(L.relationIn(p, sec(p, 's_d2_1'), 'r1'), 'unjudged', 'a placement starts unjudged');
  place(p, 's_d3_1', 'r1'); assertConsistent(p, 'place in a row with an empty-cell record');
  assert.ok(!('d3' in row(p, 'r1').cellStatus), "placing a study's construct drops its empty-cell record in the row");
  judge(p, 's_d2_1', 'r1', 'reciprocal'); judge(p, 's_d3_1', 'r1', 'refutational'); assertConsistent(p, 'judge');
  // Merge r1 into r2 (both established by d1): judgements travel
  place(p, 's_d2_2', 'r2'); judge(p, 's_d2_2', 'r2', 'other_aspect');
  const m = merge(p, 'r1', 'r2'); assertConsistent(p, 'merge');
  assert.ok(!row(p, 'r1') && row(p, 'r2').historyFrom.includes('r1'), "the source row goes; the merged row's history includes it");
  assert.equal(sec(p, 's_d2_1').clusterRelations.r2, 'reciprocal', 'same base: a judgement carries over');
  assert.equal(m.moved, 3);
  assert.ok(row(p, 'r2').translationSummary.includes('[From row "Row 1"] A1'), "the source row's texts are added, marked");
  assert.deepEqual(plain(p.loa.links).map(l => [l.from, l.to]), [['r2', 'r3']], 'the relation between the two rows goes, the other follows');
  // Split d2's and d3's cards off r2: the new row is established by d2 (d1's cards stay), so d3's judgement starts over
  const sp = split(p, 'r2', ['s_d2_1', 's_d3_1'], 'r9'); assertConsistent(p, 'split');
  assert.equal(row(p, 'r9').baseDocId, 'd2');
  assert.equal(L.relationIn(p, sec(p, 's_d2_1'), 'r9'), 'baseline');
  assert.equal(L.relationIn(p, sec(p, 's_d3_1'), 'r9'), 'unjudged', 'a judgement against another base is not carried');
  assert.match(sec(p, 's_d3_1').clusterComments.r9, /judged refutational against d1 there/, '…it is kept in the cell note');
  assert.equal(sp.rejudge.length, 1);
  assert.deepEqual(p.clusters.map(c => [c.id, c.order]).sort((a, b) => a[1] - b[1]).map(x => x[0]), ['r2', 'r9', 'r3'], 'the new row sits below its source');
});

test('scenario: merging rows established by different studies starts the moved judgements over', () => {
  const p = makeProject();
  place(p, 's_d2_1', 'r3'); judge(p, 's_d2_1', 'r3', 'reciprocal');
  const c = clone(row(p, 'r1')); c.baseDocId = 'd2'; L.applyOps(p, [{ store: 'clusters', put: c }]); // r1 established by d2
  place(p, 's_d2_2', 'r1');
  const m = merge(p, 'r3', 'r1'); assertConsistent(p, 'merge across bases');
  assert.equal(L.relationIn(p, sec(p, 's_d1_3'), 'r1'), 'unjudged', "the source row's base card is judged like any other in the merged row");
  assert.equal(L.relationIn(p, sec(p, 's_d2_1'), 'r1'), 'baseline', "the target base study's card establishes the merged row");
  assert.match(sec(p, 's_d2_1').clusterComments.r1, /judged reciprocal against d1 there; establishes the merged row/);
  assert.equal(m.rejudge.length, 1);
});

test('scenario: merging keeps the source row\'s "No single base" for a target not set yet, and its re-reading note only with its base', () => {
  const p = makeProject();
  const nb = clone(row(p, 'r1')); nb.baseDocId = null; L.applyOps(p, [{ store: 'clusters', put: nb }]);
  L.applyOps(p, [{ store: 'clusters', put: { id: 'r0', thirdOrderTitle: 'Empty', order: 9, baseDocId: '', cellStatus: {}, historyFrom: [] } }]);
  merge(p, 'r1', 'r0'); assertConsistent(p, 'merge into a row not set yet');
  assert.equal(row(p, 'r0').baseDocId, null, 'no single base, not left unset');
  place(p, 's_d3_2', 'r0');
  assert.equal(L.relationIn(p, sec(p, 's_d3_2'), 'r0'), 'unjudged', 'a study placed later does not become its base');
  // Re-reading note (study #1 changed): carried only into a row established by the same study
  const q = makeProject();
  const flagged = clone(row(q, 'r1')); flagged.baselineChange = { fromDocId: 'd1', toDocId: 'd2', fromName: 'd1', toName: 'd2' }; L.applyOps(q, [{ store: 'clusters', put: flagged }]);
  const other = clone(row(q, 'r2')); other.baseDocId = 'd3'; L.applyOps(q, [{ store: 'clusters', put: other }]);
  merge(q, 'r1', 'r2');
  assert.ok(!row(q, 'r2').baselineChange, 'the merged row is established by d3: the note about d1 does not apply');
  const t = makeProject();
  const f2 = clone(row(t, 'r1')); f2.baselineChange = { fromDocId: 'd1', toDocId: 'd2' }; L.applyOps(t, [{ store: 'clusters', put: f2 }]);
  merge(t, 'r1', 'r2');
  assert.equal(row(t, 'r2').baselineChange.fromDocId, 'd1', 'same base: carried');
});

test('scenario: Undo of a row deletion, a removal from a row and a construct deletion gives back exactly what was there', () => {
  const p = makeProject();
  place(p, 's_d2_1', 'r1'); judge(p, 's_d2_1', 'r1', 'other_aspect');
  const start = meaning(p);
  const del = deleteRow(p, 'r1'); assertConsistent(p, 'delete row');
  assert.ok(!p.annotations.some(a => (a.clusterIds || []).includes('r1')) && !p.loa.links.some(l => l.from === 'r1'));
  assert.deepEqual(undo(p, del), { kept: [], dropped: [] }); assertConsistent(p, 'undo delete row');
  assert.equal(meaning(p), start, 'the row, its placements with their judgements and marks, and its map relation are back');
  const un = unplace(p, 's_d2_1', 'r1'); undo(p, un); assertConsistent(p, 'undo unplace');
  assert.equal(meaning(p), start);
  const dc = deleteConstruct(p, 's_d2_1'); assertConsistent(p, 'delete construct');
  assert.deepEqual(plain(sec(p, 'q_d2').parentIds), [], "its quote's link goes");
  assert.deepEqual(plain(p.docs[1].conceptLinks), [], 'its within-study relationship goes');
  undo(p, dc); assertConsistent(p, 'undo delete construct');
  assert.equal(meaning(p), start, 'the construct, its quote link and its within-study relationship are back');
});

test('scenario: Undo keeps what was changed after the operation, and brings nothing back into a row deleted since', () => {
  const p = makeProject();
  place(p, 's_d2_1', 'r1'); place(p, 's_d2_1', 'r2'); judge(p, 's_d2_1', 'r1', 'reciprocal');
  const del = deleteRow(p, 'r1');
  judge(p, 's_d2_1', 'r2', 'refutational'); // later work on the same construct, in another row
  const c = clone(row(p, 'r2')); c.synthesisNote = 'rewritten'; L.applyOps(p, [{ store: 'clusters', put: c }]);
  undo(p, del); assertConsistent(p, 'undo after later work');
  assert.equal(sec(p, 's_d2_1').clusterRelations.r1, 'reciprocal', 'the judgement in the deleted row is back');
  assert.equal(sec(p, 's_d2_1').clusterRelations.r2, 'refutational', 'the later judgement in another row is kept');
  assert.equal(row(p, 'r2').synthesisNote, 'rewritten');
  // A construct deleted, then the row it was in, then the construct's deletion undone: no placement in the gone row
  const q = makeProject();
  place(q, 's_d2_1', 'r1'); judge(q, 's_d2_1', 'r1', 'other_aspect');
  const dc = deleteConstruct(q, 's_d2_1');
  deleteRow(q, 'r1');
  const r = undo(q, dc); assertConsistent(q, 'undo construct after its row went');
  assert.deepEqual(plain(sec(q, 's_d2_1').clusterIds), []);
  assert.ok(!('r1' in (sec(q, 's_d2_1').aspectUsedInLoa || {})));
  assert.deepEqual(r.dropped, ['a placement in a row deleted since']);
  // A later edit of the very field the operation changed is kept and named
  const s = makeProject();
  place(s, 's_d2_1', 'r1'); judge(s, 's_d2_1', 'r1', 'reciprocal');
  const un = unplace(s, 's_d2_1', 'r1');
  place(s, 's_d2_1', 'r1'); judge(s, 's_d2_1', 'r1', 'refutational'); // placed again and judged differently since
  const r2 = undo(s, un); assertConsistent(s, 'undo over a newer reading');
  assert.equal(sec(s, 's_d2_1').clusterRelations.r1, 'refutational', 'the newer reading stays');
  assert.deepEqual(r2.kept.map(k => k.path), ['clusterRelations.r1']);
});

test('scenario: undoing the making of a construct lets go of what was linked to it since', () => {
  const p = makeProject();
  const ch = addConstruct(p, 'd2', 's_new');
  linkQuote(p, 'q_d2', 's_new'); relate(p, 'd2', 's_new', 's_d2_1'); place(p, 's_new', 'r1');
  assertConsistent(p, 'links to the new construct');
  const r = undo(p, ch); assertConsistent(p, 'undo the making of a construct linked since');
  assert.ok(!sec(p, 's_new'));
  assert.deepEqual(plain(sec(p, 'q_d2').parentIds), ['s_d2_1'], "the quote's other link stays");
  assert.ok(!p.docs[1].conceptLinks.some(l => l.from === 's_new' || l.to === 's_new'));
  assert.deepEqual(r.dropped.sort(), ["a quote's link to a construct this undo removes", 'a within-study relationship to a construct this undo removes']);
});

test('scenario: undoing a split whose new row has another base leaves a ◇ reading made there (and its mark) behind', () => {
  const p = makeProject();
  place(p, 's_d2_1', 'r1'); judge(p, 's_d2_1', 'r1', 'reciprocal');
  place(p, 's_d3_1', 'r1');
  const ch = splitStep(p, 'r1', ['s_d2_1', 's_d3_1'], 'rn'); // the new row is established by d2 (d1's card stays behind)
  assert.equal(row(p, 'rn').baseDocId, 'd2');
  judge(p, 's_d3_1', 'rn', 'other_aspect'); // read ◇ against d2 there, marked as used by the line of argument
  const r = undo(p, ch); assertConsistent(p, 'undo the split');
  const s3 = sec(p, 's_d3_1');
  assert.deepEqual(plain(s3.clusterIds), ['r1']);
  assert.ok(!(s3.aspectUsedInLoa || {}).r1, 'no mark without its ◇ judgement in the original row');
  assert.notEqual((s3.clusterRelations || {}).r1, 'other_aspect');
  assert.equal(sec(p, 's_d2_1').clusterRelations.r1, 'reciprocal', 'the judgement made before the split is back');
  assert.ok(r.kept.some(k => /against another base, not carried \(the original row keeps its own\)/.test(k)), r.kept.join(' | '));
});

// ---- Random walks: any order of the steps keeps the project consistent; Undo right after a step restores it exactly ----
test('operations: each says what it changes, and returns nothing when nothing changes', () => {
  const p = makeProject();
  // Placing clears the study's empty-cell record, with an entry for it, and the construct starts unjudged
  const pl = run(p, L.opPlace(p, { secId: 's_d3_1', rowId: 'r1' }, H));
  assert.deepEqual(plain(pl.entries.map(e => e.kind)), ['empty_cell', 'place']);
  assert.equal(row(p, 'r1').cellStatus.d3, undefined);
  assert.equal(L.relationIn(p, sec(p, 's_d3_1'), 'r1'), 'unjudged');
  assert.equal(L.opPlace(p, { secId: 's_d3_1', rowId: 'r1' }, H), null, 'placed already: nothing to do');
  assertConsistent(p, 'place');
  // An empty cell can only be recorded where the study has no construct
  assert.equal(L.opEmptyCellStatus(p, { rowId: 'r1', docId: 'd3', status: 'absent' }, H), null);
  run(p, L.opEmptyCellStatus(p, { rowId: 'r2', docId: 'd2', status: 'other_aspect' }, H));
  run(p, L.opEmptyCellNote(p, { rowId: 'r2', docId: 'd2', note: 'speaks to the family' }, H));
  assert.deepEqual(plain(row(p, 'r2').cellStatus.d2), { status: 'other_aspect', note: 'speaks to the family' });
  run(p, L.opEmptyCellStatus(p, { rowId: 'r2', docId: 'd2', status: '' }, H));
  assert.equal(row(p, 'r2').cellStatus.d2, undefined, 'back to "not yet checked"');
  // Judged other than ◇, the line-of-argument mark goes; the study that established the row is not judged
  judge(p, 's_d3_1', 'r1', 'other_aspect');
  assert.ok(sec(p, 's_d3_1').aspectUsedInLoa.r1);
  const j = run(p, L.opJudge(p, { secId: 's_d3_1', rowId: 'r1', rel: 'reciprocal' }, H));
  assert.ok(!sec(p, 's_d3_1').aspectUsedInLoa.r1 && /no longer marked/.test(j.entries[0].detail));
  assert.equal(L.opJudge(p, { secId: 's_d1_1', rowId: 'r1', rel: 'refutational' }, H), null, 'the base study (◆) is not judged');
  assertConsistent(p, 'judge');
  // Choosing study #1 as a row's base clears its re-reading note; "no single base" is a change from "not set yet"
  L.applyOps(p, [{ store: 'clusters', put: { ...row(p, 'r3'), baseDocId: 'd2', baselineChange: { fromName: 'd2', toName: 'd1' } } }]);
  const b = run(p, L.opSetRowBase(p, { rowId: 'r3', docId: 'd1' }, H));
  assert.ok(!row(p, 'r3').baselineChange && /re-reading note is cleared/.test(b.entries[0].detail));
  L.applyOps(p, [{ store: 'clusters', put: { ...row(p, 'r2'), baseDocId: '' } }]);
  assert.equal(run(p, L.opSetRowBase(p, { rowId: 'r2', docId: null }, H)).entries[0].fromVal, 'Not set yet');
  assert.equal(L.opSetRowBase(p, { rowId: 'r2', docId: null }, H), null);
  assert.equal(L.opRereadRow(p, { rowId: 'r1', why: '' }), null, 'nothing to re-read');
  // Team status, CERQual, seed confirmation: written only when something changes
  assert.ok(run(p, L.opRowTeamStatus(p, { rowId: 'r1', status: 'discuss', note: 'two readings' })));
  assert.equal(L.opRowTeamStatus(p, { rowId: 'r1', status: 'discuss', note: 'two readings' }), null);
  assert.equal(row(p, 'r1').concordanceStatus, 'discuss');
  const cq = run(p, L.opRowCerqual(p, { rowId: 'r1', values: { cerqualConfidence: 'Moderate', cerqualExplanation: '  thin data  ' } }));
  assert.equal(row(p, 'r1').cerqualExplanation, 'thin data', 'trimmed');
  assert.ok(/Moderate/.test(cq.entries[0].toVal));
  assert.equal(L.opRowCerqual(p, { rowId: 'r1', values: { cerqualConfidence: 'Moderate' } }), null);
  L.applyOps(p, [{ store: 'clusters', put: { ...row(p, 'r1'), autoSeeded: true } }]);
  run(p, L.opConfirmSeed(p, { rowId: 'r1' }));
  assert.equal(L.opConfirmSeed(p, { rowId: 'r1' }), null);
  // Moving a row past the next one on view (rows hidden by a filter are skipped)
  run(p, L.opMoveRow(p, { rowId: 'r1', direction: 1, visibleIds: ['r1', 'r3'] })); sortRows(p);
  assert.deepEqual(p.clusters.map(c => c.id), ['r2', 'r3', 'r1']);
  assert.equal(L.opMoveRow(p, { rowId: 'r1', direction: 1 }), null, 'the last row cannot move down');
  // Why a construct was not translated
  assert.ok(run(p, L.opNotTranslated(p, { secId: 's_d2_3', note: 'out of scope of the aim' }, H)));
  assert.equal(L.opNotTranslated(p, { secId: 's_d2_3', note: 'out of scope of the aim' }, H), null);
  assertConsistent(p, 'operations');
});

test('operations of Tab 1: links, passages, deletions, wrapping — each says what it changes', () => {
  const p = makeProject();
  assert.equal(L.opLinkQuote(p, { quoteId: 'q_d1', secId: 's_d2_1' }, H), null, 'a quote is linked only to constructs of its own study');
  run(p, L.opLinkQuote(p, { quoteId: 'q_d1', secId: 's_d1_2' }, H));
  assert.deepEqual(plain(sec(p, 'q_d1').parentIds), ['s_d1_1', 's_d1_2']);
  run(p, L.opUnlinkQuote(p, { quoteId: 'q_d1', secId: 's_d1_1' }));
  assert.deepEqual(plain(sec(p, 'q_d1').parentIds), ['s_d1_2']);
  run(p, L.opUnlinkQuote(p, { quoteId: 'q_d1', secId: null }));
  assert.deepEqual(plain(sec(p, 'q_d1').parentIds), [], 'unlinked from all');
  assert.equal(L.opUnlinkQuote(p, { quoteId: 'q_d1', secId: null }), null);
  // Passages: added and removed (removing is logged, with the construct's rows)
  run(p, L.opAddPassage(p, { secId: 's_d2_1', passage: { id: 'pp', text: 'again, in the discussion', page: '7' } }, H));
  const rm = run(p, L.opRemovePassage(p, { secId: 's_d2_1', passageId: 'pp' }, H));
  assert.equal(rm.entries[0].kind, 'passage_remove');
  assert.equal(L.opRemovePassage(p, { secId: 's_d2_1', passageId: 'pp' }, H), null);
  // Text, label source, team status: written only when something changes
  assert.equal(L.opExtractedText(p, { annoId: 's_d2_1', text: sec(p, 's_d2_1').text }, H), null);
  assert.ok(run(p, L.opExtractedText(p, { annoId: 's_d2_1', text: 'corrected wording' }, H)));
  assert.ok(run(p, L.opLabelSource(p, { secId: 's_d2_1', source: 'reviewer' }, H)));
  assert.equal(L.opLabelSource(p, { secId: 's_d2_1', source: 'reviewer' }, H), null);
  const t = run(p, L.opConstructTeamStatus(p, { secId: 's_d2_1', status: 'discuss', note: 'our note\nreason', action: 'Flagged for discussion' }, H));
  assert.equal(t.entries[0].action, 'Flagged for discussion');
  // Within-study relationships: only between constructs of that study; removed by id
  assert.equal(L.opAddConceptLink(p, { docId: 'd2', link: { id: 'x', from: 's_d2_1', to: 's_d3_1', type: 'leads' }, text: '' }, H), null);
  relate(p, 'd2', 's_d2_2', 's_d2_3');
  const k = p.docs.find(d => d.id === 'd2').conceptLinks.find(l => l.from === 's_d2_2');
  run(p, L.opRemoveConceptLink(p, { docId: 'd2', linkId: k.id, text: '' }, H));
  assert.ok(!p.docs.find(d => d.id === 'd2').conceptLinks.some(l => l.id === k.id));
  // Deleting a construct takes its quotes' links and its relationships with it
  const d = run(p, L.opDeleteConstruct(p, { secId: 's_d2_1' }, H));
  assert.ok(!sec(p, 's_d2_1') && !(sec(p, 'q_d2').parentIds || []).includes('s_d2_1') && !p.docs.find(x => x.id === 'd2').conceptLinks.length);
  assert.ok(/1 linked quote\(s\) unlinked/.test(d.entries[0].detail));
  // Wrapping a quote in a construct of the reviewer's wording; deleting a quote
  run(p, L.opWrapQuote(p, { quoteId: 'q_d2', construct: { id: 'w1', docId: 'd2', type: 'second_order', origin: 'wrapped_first_order', page: '1', text: 'q', note: 'Label', clusterIds: [], clusterRelations: {}, clusterComments: {}, passages: [] } }, H));
  assert.deepEqual(plain(sec(p, 'q_d2').parentIds), ['w1']);
  run(p, L.opDeleteQuote(p, { quoteId: 'q_d3' }, H));
  assert.ok(!sec(p, 'q_d3'));
  assertConsistent(p, 'operations of Tab 1');
});

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const STEPS = ['place', 'judge', 'merge', 'split', 'deleteRow', 'unplace', 'deleteConstruct', 'addConstruct', 'linkQuote', 'relate', 'markEmpty', 'deleteStudy',
  'moveRow', 'rowBase', 'rowTeam', 'undo', 'undo'];
for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946]) {
  test(`random walk (seed ${seed}): 80 steps, consistent after each; an immediate Undo restores the project exactly`, () => {
    const r = rng(seed);
    const pick = list => list[Math.floor(r() * list.length)];
    const p = makeProject();
    const undoable = [];
    let n = 0;
    for (let i = 0; i < 80; i++) {
      const step = pick(STEPS);
      const secs = p.annotations.filter(a => a.type === 'second_order');
      const placed = secs.filter(a => a.clusterIds.length);
      const label = `step ${i} (${step})`;
      if (step === 'place' && p.clusters.length) {
        place(p, pick(secs).id, pick(p.clusters).id);
      } else if (step === 'judge' && placed.length) {
        const s = pick(placed);
        judge(p, s.id, pick(s.clusterIds), pick(['reciprocal', 'refutational', 'other_aspect', 'unjudged']));
      } else if ((step === 'merge' && p.clusters.length > 1) || (step === 'split' && p.clusters.some(c => L.rowSecsIn(p, c.id).length))) {
        const before = meaning(p);
        let ch;
        if (step === 'merge') { const a = pick(p.clusters), b = pick(p.clusters.filter(c => c !== a)); ch = mergeStep(p, a.id, b.id); }
        else {
          const c = pick(p.clusters.filter(x => L.rowSecsIn(p, x.id).length));
          const cards = L.rowSecsIn(p, c.id);
          ch = splitStep(p, c.id, [...new Set(cards.filter(() => r() < 0.5).concat(cards[0]).map(s => s.id))], `rs${seed}_${n++}`);
        }
        assertConsistent(p, label);
        if (r() < 0.4) { // undone at once: exactly as before
          const u = undo(p, ch); assertConsistent(p, `${label}, undone at once`);
          assert.deepEqual(u, { kept: [], dropped: [] }, label);
          assert.equal(meaning(p), before, `${label}, undone at once`);
        } else undoable.push(ch);
      } else if (step === 'deleteStudy' && p.docs.length > 2) {
        deleteStudy(p, pick(p.docs).id);
      } else if (step === 'linkQuote') {
        const q = pick(p.annotations.filter(a => a.type === 'first_order'));
        const own = secs.filter(a => a.docId === q.docId);
        if (own.length) linkQuote(p, q.id, pick(own).id);
      } else if (step === 'relate') {
        const d = pick(p.docs), own = secs.filter(a => a.docId === d.id);
        if (own.length > 1) { const a = pick(own); relate(p, d.id, a.id, pick(own.filter(x => x !== a)).id); }
      } else if (step === 'markEmpty' && p.clusters.length) {
        markEmpty(p, pick(p.clusters).id, pick(p.docs).id, pick(['absent', 'other_aspect', '']));
      } else if (step === 'moveRow' && p.clusters.length > 1) {
        run(p, L.opMoveRow(p, { rowId: pick(p.clusters).id, direction: pick([-1, 1]) })); sortRows(p);
      } else if (step === 'rowBase' && p.clusters.length) {
        run(p, L.opSetRowBase(p, { rowId: pick(p.clusters).id, docId: pick([...p.docs.map(d => d.id), null]) }, H));
      } else if (step === 'rowTeam' && p.clusters.length) {
        run(p, L.opRowTeamStatus(p, { rowId: pick(p.clusters).id, status: pick(['pending', 'discuss', 'agreed']), note: pick(['', 'talked it through']) }));
      } else if (['deleteRow', 'unplace', 'deleteConstruct', 'addConstruct'].includes(step)) {
        const before = meaning(p);
        let ch = null;
        if (step === 'deleteRow' && p.clusters.length) ch = deleteRow(p, pick(p.clusters).id);
        if (step === 'unplace' && placed.length) { const s = pick(placed); ch = unplace(p, s.id, pick(s.clusterIds)); }
        if (step === 'deleteConstruct' && secs.length > 2) ch = deleteConstruct(p, pick(secs).id);
        if (step === 'addConstruct') ch = addConstruct(p, pick(p.docs).id, `s_add_${seed}_${n++}`);
        if (!ch) continue;
        assertConsistent(p, label);
        if (r() < 0.5) { // undone at once: exactly as before
          assert.deepEqual(undo(p, ch), { kept: [], dropped: [] }, label);
          assert.equal(meaning(p), before, `${label}, undone at once`);
        } else undoable.push(ch);
      } else if (step === 'undo' && undoable.length) {
        undo(p, undoable.pop()); // later, after other steps: whatever was kept, the project stays consistent
      }
      assertConsistent(p, label);
    }
  });
}
