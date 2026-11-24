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
const L = vm.runInContext(`({ applyOps, checkInvariants, planMergeRows, planSplitRow, purgeClusterRefs, revertChange, tidyRefsOps, recordOf,
  putIntoRow, takeOutOfRow, relationIn, rowSecsIn, stableJson })`, ctx);
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
function place(p, sid, rid) {
  const s = clone(sec(p, sid));
  L.putIntoRow(s, rid);
  write(p, [{ store: 'annotations', put: s }]);
}
function judge(p, sid, rid, rel) {
  const s = clone(sec(p, sid));
  s.clusterRelations = { ...s.clusterRelations, [rid]: rel };
  if (rel === 'other_aspect') s.aspectUsedInLoa = { ...(s.aspectUsedInLoa || {}), [rid]: true };
  write(p, [{ store: 'annotations', put: s }]);
}
const merge = (p, src, tgt) => { const plan = L.planMergeRows(p, src, tgt); L.applyOps(p, plan.ops); return plan; };
const split = (p, src, secIds, nid) => { const plan = L.planSplitRow(p, src, secIds, { id: nid, thirdOrderTitle: 'Split', baseDocId: '', cellStatus: {}, historyFrom: [] }); L.applyOps(p, plan.ops); return plan; };
// An undoable change, recorded as the app records it (beginChange / finishChange in undo-audit.js)
function recorded(p, keys, run, created = []) {
  const records = keys.map(({ store, id }) => ({ store, id, before: clone(L.recordOf(p, store, id)) ?? null }));
  run();
  created.forEach(k => records.push({ ...k, before: null }));
  records.forEach(r => { r.after = clone(L.recordOf(p, r.store, r.id)) ?? null; });
  return { records };
}
function deleteRow(p, rid) {
  const { ops } = L.purgeClusterRefs(p, rid);
  ops.push({ store: 'clusters', del: rid });
  return recorded(p, ops.map(o => ({ store: o.store, id: 'del' in o ? o.del : o.put.id })), () => L.applyOps(p, ops));
}
function unplace(p, sid, rid) {
  return recorded(p, [{ store: 'annotations', id: sid }], () => { const s = clone(sec(p, sid)); L.takeOutOfRow(s, rid); L.applyOps(p, [{ store: 'annotations', put: s }]); });
}
function deleteConstruct(p, sid) {
  const s = sec(p, sid);
  const quotes = p.annotations.filter(a => a.type === 'first_order' && (a.parentIds || []).includes(sid));
  const doc = p.docs.find(d => d.id === s.docId);
  const keys = [{ store: 'annotations', id: sid }, ...quotes.map(q => ({ store: 'annotations', id: q.id })), { store: 'docs', id: doc.id }];
  return recorded(p, keys, () => {
    const ops = quotes.map(q => ({ store: 'annotations', put: { ...q, parentIds: q.parentIds.filter(x => x !== sid) } }));
    ops.push({ store: 'docs', put: { ...doc, conceptLinks: (doc.conceptLinks || []).filter(l => l.from !== sid && l.to !== sid) } });
    ops.push({ store: 'annotations', del: sid });
    L.applyOps(p, ops);
  });
}
// A construct made (as splitting a passage off makes one): undoing it deletes it
function addConstruct(p, docId, id) {
  return recorded(p, [], () => L.applyOps(p, [{ store: 'annotations', put: { id, docId, type: 'second_order', page: '9', text: `made ${id}`, note: '', clusterIds: [], clusterRelations: {}, clusterComments: {}, passages: [] } }]),
    [{ store: 'annotations', id }]);
}
function linkQuote(p, qid, sid) { const q = clone(sec(p, qid)); q.parentIds = [...new Set([...(q.parentIds || []), sid])]; L.applyOps(p, [{ store: 'annotations', put: q }]); }
function relate(p, docId, from, to) {
  const d = clone(p.docs.find(x => x.id === docId));
  d.conceptLinks = [...(d.conceptLinks || []), { id: `k_${from}_${to}_${Math.random().toString(36).slice(2, 6)}`, from, to, type: 'leads' }];
  L.applyOps(p, [{ store: 'docs', put: d }]);
}
function markEmpty(p, rid, docId) {
  if (L.rowSecsIn(p, rid).some(a => a.docId === docId)) return;
  const c = clone(row(p, rid)); c.cellStatus = { ...c.cellStatus, [docId]: { status: 'absent', note: '' } }; L.applyOps(p, [{ store: 'clusters', put: c }]);
}
function undo(p, change) {
  const { ops, kept } = L.revertChange(change, p);
  const t = L.tidyRefsOps(p, ops);
  L.applyOps(p, t.ops);
  return { kept: plain(kept), dropped: plain(t.dropped) };
}
// The project's meaning, independent of list order and object identity
const meaning = p => L.stableJson({
  docs: [...p.docs].sort((a, b) => a.id.localeCompare(b.id)),
  annotations: [...p.annotations].sort((a, b) => a.id.localeCompare(b.id)).map(a => ({ ...a, clusterIds: [...(a.clusterIds || [])].sort(), parentIds: a.parentIds && [...a.parentIds].sort() })),
  clusters: [...p.clusters].sort((a, b) => a.id.localeCompare(b.id)),
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

// ---- Random walks: any order of the steps keeps the project consistent; Undo right after a step restores it exactly ----
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const STEPS = ['place', 'judge', 'merge', 'split', 'deleteRow', 'unplace', 'deleteConstruct', 'addConstruct', 'linkQuote', 'relate', 'markEmpty', 'undo', 'undo'];
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
      } else if (step === 'merge' && p.clusters.length > 1) {
        const a = pick(p.clusters), b = pick(p.clusters.filter(c => c !== a));
        merge(p, a.id, b.id);
      } else if (step === 'split' && p.clusters.some(c => L.rowSecsIn(p, c.id).length)) {
        const c = pick(p.clusters.filter(x => L.rowSecsIn(p, x.id).length));
        const cards = L.rowSecsIn(p, c.id);
        split(p, c.id, cards.filter(() => r() < 0.5).concat(cards[0]).map(s => s.id), `rs${seed}_${n++}`);
      } else if (step === 'linkQuote') {
        const q = pick(p.annotations.filter(a => a.type === 'first_order'));
        const own = secs.filter(a => a.docId === q.docId);
        if (own.length) linkQuote(p, q.id, pick(own).id);
      } else if (step === 'relate') {
        const d = pick(p.docs), own = secs.filter(a => a.docId === d.id);
        if (own.length > 1) { const a = pick(own); relate(p, d.id, a.id, pick(own.filter(x => x !== a)).id); }
      } else if (step === 'markEmpty' && p.clusters.length) {
        markEmpty(p, pick(p.clusters).id, pick(p.docs).id);
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
